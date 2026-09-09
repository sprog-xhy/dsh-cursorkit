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
import * as vscode from 'vscode';
import { HttpTransport } from '@dsh-cursorkit/client';

export interface RuntimeInfo {
  pid: number;
  port: number;
  token: string;
  protocolVersion: string;
  dshVersion: string;
}

export const DEFAULT_DSH_HOME = join(homedir(), '.dsh-cursorkit');

export type SidecarStatus = 'starting' | 'ready' | 'stopped' | 'error';

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

  /** 状态变化回调（panel/status 订阅）。 */
  onStatusChange: ((status: SidecarStatus, info?: RuntimeInfo) => void) | null = null;

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
    return join(this.dshHome, '.cursorkit', 'runtime.json');
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

    const patchPath = join(this.dshHome, 'profiles', 'cursorkit', 'cordis.patch.yml');
    this.proc = spawn(dshBin, ['--profile', 'cursorkit', '--patch', patchPath], {
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

    return this.waitForRuntime();
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

  /** 生成 cursorkit profile（幂等）。 */
  private async ensureProfile(): Promise<void> {
    const profileDir = join(this.dshHome, 'profiles', 'cursorkit');
    const pkgPath = join(profileDir, 'package.json');
    if (existsSync(pkgPath)) {
      this.log(`profile exists: ${profileDir}`);
      return;
    }
    await mkdir(profileDir, { recursive: true, mode: 0o700 });
    const absRepo = repoRoot();
    const hostPath = join(absRepo, 'packages', 'host-dsh');
    const protocolPath = join(absRepo, 'packages', 'protocol');
    const patch = this.readCordisPatch();
    await writeFile(
      pkgPath,
      JSON.stringify(
        {
          name: 'dsh-profile-cursorkit',
          private: true,
          dependencies: {
            '@dsh-cursorkit/host-dsh': `file:${hostPath}`,
            '@dsh-cursorkit/protocol': `file:${protocolPath}`,
          },
          dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    await writeFile(join(profileDir, 'cordis.patch.yml'), patch, { mode: 0o600 });
    this.log(`profile created: ${profileDir}`);
  }

  private readCordisPatch(): string {
    const candidates = [
      join(repoRoot(), 'packages', 'host-dsh', 'cordis.patch.yml'),
      join(__dirname, '..', '..', '..', '..', 'packages', 'host-dsh', 'cordis.patch.yml'),
    ];
    for (const c of candidates) {
      if (existsSync(c)) return readFileSync(c, 'utf8');
    }
    throw new Error('无法定位 host-dsh/cordis.patch.yml');
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
    this.onStatusChange?.(status, info);
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
    this.statusBar.dispose();
    this.output.dispose();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
