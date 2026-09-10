/**
 * dsh sidecar 生命周期管理（V2-DECISIONS D3/D24/D29）。
 *
 * - 数据目录：`settings.dshCursorkit.sidecar.dshHome` 或默认 `~/.dsh-cursorkit`
 * - profile：首次启动生成 `$DSH_HOME/profiles/cursorkit/`（package.json + cordis.patch.yml）
 * - 启动：`dsh --profile cursorkit` → 轮询 runtime.json（≤30s）→ HttpTransport
 * - 崩溃：自动重启（指数退避 ≤5 次）；停止：SIGTERM + 清理
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import {
  DEFAULT_DSH_HOME,
  PATCH_FILENAME,
  buildProfilePackage,
  buildProfilePatch,
  profileDir,
  profilePatchNeedsRepair,
  RUNTIME_RELATIVE,
} from './profile-config.ts';
import * as vscode from 'vscode';
import { HttpTransport } from '@dsh-cursorkit/client';

export interface RuntimeInfo {
  pid: number;
  port: number;
  token: string;
  protocolVersion: string;
  dshVersion: string;
}

export type SidecarStatus = 'starting' | 'ready' | 'stopped' | 'error';

/** sidecar 状态监听器。 */
export type SidecarStatusListener = (status: SidecarStatus, info?: RuntimeInfo) => void;

/** 从环境读取宿主包根目录（monorepo 开发）或发布后 node_modules。 */
function repoRoot(): string {
  // dist/extension.js → extensions/vscode/dist → repo root
  return resolve(__dirname, '..', '..', '..');
}

export class SidecarManager implements vscode.Disposable {
  private proc: ChildProcess | null = null;
  private runtime: RuntimeInfo | null = null;
  private restartCount = 0;
  private stopping = false;
  private status: SidecarStatus = 'stopped';
  private readonly output: vscode.OutputChannel;
  private readonly statusBar: vscode.StatusBarItem;
  private restartTimer: NodeJS.Timeout | null = null;

  /** 状态变化监听（多订阅：Chat 面板 + 侧边栏视图可同时订阅）。 */
  private readonly statusListeners = new Set<SidecarStatusListener>();

  /** 订阅 sidecar 状态变化（返回注销函数）。 */
  onStatusChange(listener: SidecarStatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status, this.runtime ?? undefined);
    return () => this.statusListeners.delete(listener);
  }

  constructor(context: vscode.ExtensionContext) {
    this.output = vscode.window.createOutputChannel('DSH CursorKit Sidecar');
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBar.show();
    context.subscriptions.push(this.output, this.statusBar);
  }

  get dshHome(): string {
    const cfg = vscode.workspace.getConfiguration('dshCursorkit.sidecar');
    const home = cfg.get<string>('dshHome', '');
    return home.trim() || DEFAULT_DSH_HOME;
  }

  private runtimeFile(): string {
    return join(this.dshHome, RUNTIME_RELATIVE);
  }

  /** 探测本机 dsh 版本（PATH 上查找）。 */
  findDsh(): string | null {
    const candidates = ['dsh'];
    for (const bin of candidates) {
      try {
        execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 8000, stdio: 'pipe' });
        return bin;
      } catch {
        // try next
      }
    }
    return null;
  }

  /** 启动 sidecar（幂等：已有存活实例则复用）。 */
  async start(): Promise<RuntimeInfo> {
    if (this.runtime && this.isAlive(this.runtime.pid)) {
      this.setStatus('ready', this.runtime);
      return this.runtime;
    }
    const existing = this.readRuntimeFile();
    if (existing && this.isAlive(existing.pid)) {
      this.runtime = existing;
      this.restartCount = 0;
      this.setStatus('ready', existing);
      this.log(`复用已有 sidecar pid=${existing.pid} port=${existing.port}`);
      return existing;
    }
    return this.spawn();
  }

  private async spawn(): Promise<RuntimeInfo> {
    const dshBin = this.findDsh();
    if (!dshBin) {
      this.setStatus('error');
      throw new Error(
        '未找到 dsh。请先安装：npm i -g @deepseek-ai/dsh@0.1.1-rc.2\n' +
          '（本扩展固定 dsh 0.1.1-rc.2，V2-DECISIONS D2）',
      );
    }
    this.setStatus('starting');
    this.log(`spawn dsh (profile=cursorkit, dshHome=${this.dshHome})`);
    await this.ensureProfile();

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      DSH_HOME: this.dshHome,
      DSH_PERMISSION_MODE: this.permissionMode(),
    };
    // 覆盖 ambient DSH_HOME：独立数据目录，绝不污染主环境
    delete env.CK_DSH_HOME;

    // profile 目录的 cordis.patch.yml 由 dsh 自动加载（无需 --patch）
    this.proc = spawn(dshBin, ['--profile', 'cursorkit'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.proc.stdout?.on('data', (d: Buffer) => this.log(`[dsh] ${d.toString().trimEnd()}`));
    this.proc.stderr?.on('data', (d: Buffer) => this.log(`[dsh:err] ${d.toString().trimEnd()}`));
    this.proc.on('exit', (code) => this.handleExit(code));
    this.proc.on('error', (err) => {
      this.setStatus('error');
      this.log(`spawn error: ${err.message}`);
    });

    try {
      return await this.waitForRuntime();
    } catch (err) {
      // 启动失败不要把 dsh 进程留在后台（否则下次启动会看到半死实例）
      this.killProc('startup-failed');
      throw err;
    }
  }

  private async waitForRuntime(): Promise<RuntimeInfo> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const info = this.readRuntimeFile();
      if (info && this.isAlive(info.pid)) {
        this.runtime = info;
        this.restartCount = 0;
        this.setStatus('ready', info);
        this.log(`sidecar ready pid=${info.pid} port=${info.port} dsh=${info.dshVersion}`);
        return info;
      }
      await sleep(300);
    }
    this.setStatus('error');
    throw new Error('sidecar 启动超时（30s）。请查看 Output 面板 "DSH CursorKit Sidecar"');
  }

  /** 生成 cursorkit profile（幂等；patch 内容缺失 agent-loop 时重建）。 */
  private async ensureProfile(): Promise<void> {
    const dir = profileDir(this.dshHome);
    const pkgPath = join(dir, 'package.json');
    const patchPath = join(dir, PATCH_FILENAME);
    const absRepo = repoRoot();
    const hostPath = join(absRepo, 'packages', 'host-dsh');
    const protocolPath = join(absRepo, 'packages', 'protocol');

    const needPkg = !existsSync(pkgPath);
    let needPatch = !existsSync(patchPath);
    if (!needPatch) {
      try {
        needPatch = profilePatchNeedsRepair(readFileSync(patchPath, 'utf8'));
      } catch {
        needPatch = true;
      }
    }
    if (!needPkg && !needPatch) {
      this.log(`profile ok: ${dir}`);
      return;
    }

    await mkdir(dir, { recursive: true, mode: 0o700 });
    if (needPkg) {
      await writeFile(pkgPath, buildProfilePackage(hostPath, protocolPath), { mode: 0o600 });
    }
    if (needPatch) {
      await writeFile(patchPath, buildProfilePatch(), { mode: 0o600 });
      this.log(`profile patch ${needPkg ? 'created' : 'repaired'}: ${patchPath}`);
    }
    this.log(`profile ready: ${dir}`);
  }

  private permissionMode(): string {
    return vscode.workspace
      .getConfiguration('dshCursorkit.permission')
      .get<string>('mode', 'danger-full-access');
  }

  private readRuntimeFile(): RuntimeInfo | null {
    try {
      const raw = readFileSync(this.runtimeFile(), 'utf8');
      const p = JSON.parse(raw) as Partial<RuntimeInfo>;
      if (typeof p.pid !== 'number' || typeof p.port !== 'number' || typeof p.token !== 'string') {
        return null;
      }
      return {
        pid: p.pid,
        port: p.port,
        token: p.token,
        protocolVersion: p.protocolVersion ?? 'unknown',
        dshVersion: p.dshVersion ?? 'unknown',
      };
    } catch {
      return null;
    }
  }

  private isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /** 结束 sidecar 进程（幂等）。 */
  private killProc(reason: string): void {
    const proc = this.proc;
    this.proc = null;
    if (proc && !proc.killed) {
      this.log(`kill sidecar (${reason})`);
      try {
        proc.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }
  }

  private handleExit(code: number | null): void {
    this.runtime = null;
    if (this.stopping) return;
    this.setStatus('error');
    if (this.restartCount < 5) {
      this.restartCount += 1;
      const delay = Math.min(2 ** this.restartCount * 500, 8000);
      this.log(`sidecar 退出 (code=${code})，${delay}ms 后第 ${this.restartCount}/5 次重启`);
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        if (!this.stopping) void this.spawn().catch((e) => this.log(`重启失败: ${e.message}`));
      }, delay);
    } else {
      this.log('sidecar 重启超过 5 次，停止自动重启。请查看 Output 日志。');
    }
  }

  private setStatus(status: SidecarStatus, info?: RuntimeInfo): void {
    this.status = status;
    switch (status) {
      case 'starting':
        this.statusBar.text = '$(sync~spin) DSH: starting…';
        break;
      case 'ready':
        this.statusBar.text = `$(sparkle) DSH ${info?.dshVersion ?? ''} :${info?.port ?? '?'}`;
        break;
      case 'stopped':
        this.statusBar.text = '$(circle-slash) DSH: stopped';
        break;
      case 'error':
        this.statusBar.text = '$(error) DSH: error';
        break;
    }
    for (const listener of this.statusListeners) {
      try {
        listener(status, info);
      } catch {
        /* 单个监听抛错不影响其他 */
      }
    }
  }

  /** 就绪后创建 CKP transport。 */
  createTransport(): HttpTransport {
    if (!this.runtime) throw new Error('sidecar 未就绪');
    return new HttpTransport({
      baseUrl: `http://127.0.0.1:${this.runtime.port}`,
      token: this.runtime.token,
    });
  }

  get runtimeInfo(): RuntimeInfo | null {
    return this.runtime;
  }

  get currentStatus(): SidecarStatus {
    return this.status;
  }

  private log(msg: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] ${msg}`);
  }

  dispose(): void {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.proc && !this.proc.killed) {
      this.log('stopping sidecar (SIGTERM)');
      try {
        this.proc.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }
    this.status = 'stopped';
    this.statusListeners.clear();
    this.statusBar.dispose();
    this.output.dispose();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
