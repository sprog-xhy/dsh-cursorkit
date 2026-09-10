/**
 * dsh sidecar 生命周期管理（V2-DECISIONS D3/D24/D29）。
 *
 * - 数据目录：`settings.dshCursorkit.sidecar.dshHome` 或默认 `~/.dsh-cursorkit`
 * - profile：首次启动生成 `$DSH_HOME/profiles/cursorkit/`（package.json + cordis.patch.yml）
 * - 启动：`dsh --profile cursorkit` → 轮询 runtime.json（≤30s）→ HttpTransport
 * - 崩溃：自动重启（指数退避 ≤5 次）；停止：SIGTERM + 清理
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { activityLog, initActivityLog } from './activity-log.ts';
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
  profilePackageNeedsRepair,
  profilePatchNeedsRepair,
  syncProfileDeps,
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

/**
 * 解析 host-dsh / protocol 包目录。
 *
 * 两种运行形态：
 * - **开发（F5）**：扩展从仓库运行 → `<repo>/packages/{host-dsh,protocol}`
 * - **已安装 vsix**：仓库不在 → 使用随包内置的副本 `<ext>/bundled/{host-dsh,protocol}`
 *
 * 历史缺陷：原先一律用 `resolve(__dirname,'..','..','..')`，安装后解析成
 * `~/.vscode`（不存在 packages/）→ 依赖同步失败 → sidecar 永久起不来。
 */
export interface PackageDirs {
  hostDir: string;
  protocolDir: string;
}

/**
 * 从候选目录中挑出第一个可用的包目录（纯函数，便于测试）。
 * 判定：两个目录都必须有 package.json。
 */
export function pickPackageDirs(
  candidates: PackageDirs[],
  has: (path: string) => boolean = existsSync,
): PackageDirs | null {
  for (const c of candidates) {
    if (has(join(c.hostDir, 'package.json')) && has(join(c.protocolDir, 'package.json'))) return c;
  }
  return null;
}

/** 解析 host-dsh / protocol 包目录（开发仓库 或 内置副本）。 */
export function resolvePackageDirs(override?: string): PackageDirs {
  if (override && override.trim()) {
    const hostDir = resolve(override.trim());
    return { hostDir, protocolDir: resolve(hostDir, '..', 'protocol') };
  }
  const extDir = resolve(__dirname, '..');
  const picked = pickPackageDirs([
    // 开发：extensions/vscode/dist → 仓库根
    {
      hostDir: resolve(__dirname, '..', '..', '..', 'packages', 'host-dsh'),
      protocolDir: resolve(__dirname, '..', '..', '..', 'packages', 'protocol'),
    },
    // 已安装 vsix：随包内置副本（scripts/bundle-deps.mjs 生成）
    {
      hostDir: join(extDir, 'bundled', 'host-dsh'),
      protocolDir: join(extDir, 'bundled', 'protocol'),
    },
  ]);
  if (!picked) {
    throw new Error(
      '找不到 host-dsh / protocol 包（已尝试仓库 packages/ 与内置 bundled/）。\n' +
        '可在设置 dshCursorkit.sidecar.hostDshPath 指定 host-dsh 目录。',
    );
  }
  return picked;
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
    initActivityLog(this.dshHome);
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
    const { hostDir, protocolDir } = this.packageDirs();
    const hostPath = hostDir;
    const protocolPath = protocolDir;

    let needPkg = !existsSync(pkgPath);
    if (!needPkg) {
      // 依赖路径可能失效（先 F5 后装 vsix / 仓库被移动）→ 需要重写
      try {
        needPkg = profilePackageNeedsRepair(readFileSync(pkgPath, 'utf8'), hostPath, protocolPath);
        if (needPkg) this.log('profile package.json 依赖路径已变化，重写');
      } catch {
        needPkg = true;
      }
    }
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
      await this.syncDeps(dir);
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
    await this.syncDeps(dir);
  }

  /** 包目录（支持设置覆盖，便于自定义仓库位置）。 */
  private packageDirs(): { hostDir: string; protocolDir: string } {
    const override = vscode.workspace
      .getConfiguration('dshCursorkit.sidecar')
      .get<string>('hostDshPath', '');
    return resolvePackageDirs(override);
  }

  /** 同步 profile 依赖（缺失或源码变化时安装；共享实现，脚本亦复用）。 */
  private async syncDeps(dir: string): Promise<void> {
    try {
      const { hostDir, protocolDir } = this.packageDirs();
      const res = await syncProfileDeps({
        dir,
        hostDir,
        protocolDir,
        log: (m) => this.log(m),
      });
      this.log(res.installed ? 'profile deps installed' : 'profile deps ok');
    } catch (err) {
      // 依赖不可用时 sidecar 必然启动失败 → 直接抛出可读错误
      throw new Error(`${(err as Error).message}`);
    }
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
    // 同步落盘：便于命令行排障/监控（OutputChannel 只能在 GUI 看）
    activityLog(`sidecar | ${msg}`);
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
