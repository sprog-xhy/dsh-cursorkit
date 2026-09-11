/**
 * dsh-cursorkit-host plugin entry.
 *
 * Loads inside the dsh process, probes capabilities, starts an HTTP+SSE server
 * exposing the CKP protocol, and writes runtime.json for the desktop shell to
 * discover. All side effects are registered via ctx.effect so unloading the
 * plugin cleans everything up (doc §5.1).
 *
 * @module @dsh-cursorkit/host-dsh
 */

import { existsSync, readFileSync } from 'node:fs';
import { probe, type CapabilityReport } from './capability.ts';
import { startServer, type ServerDeps, type ServerHandle } from './rpc/server.ts';
import { EventBus } from './rpc/sse.ts';
import { ApprovalBridge } from './bridge/approval-bridge.ts';
import { generateToken, writeRuntimeFile, removeRuntimeFile, readRuntimeFile, type RuntimeInfo } from './runtime-file.ts';
import { need, CapabilityMissingError } from './compat/ctx.ts';
import { sessions as sessionsCompat, agents as agentsCompat } from './compat/sessions.ts';
import { translateRawEvent, SessionBridgeTracker, type RawCkpEvent, type RawSessionEvent } from './bridge/session-bridge.ts';
import { registerDshAnswerer } from './bridge/dsh-approval-adapter.ts';
import { attachAutoCheckpoint } from './checkpoint/auto-checkpoint.ts';
import { CKP_PROTOCOL_VERSION } from '@dsh-cursorkit/protocol';
import { dirname, join } from 'node:path';
import { SessionIndex, sessionIndexFile, cleanSessionTitle } from './session-index.ts';
import { scanTitlesOnDisk } from './session-titles.ts';
import { parseConfiguredDefaultModel, setConfiguredDefaultModel } from './rpc/router.ts';

/** Public API surface — plugin entry plus the pieces a host harness needs to
 * test, embed, or extend the server. */
export {
  probe,
  startServer,
  EventBus,
  ApprovalBridge,
  generateToken,
  writeRuntimeFile,
  removeRuntimeFile,
  readRuntimeFile,
  translateRawEvent,
  CapabilityMissingError,
  CKP_PROTOCOL_VERSION,
};
export type {
  CapabilityReport,
  ServerDeps,
  ServerHandle,
  RuntimeInfo,
  RawCkpEvent,
  RawSessionEvent,
};

export const name = 'dsh-cursorkit-host';
export const inject = ['sessions', 'agents', 'agentLoop', 'approval'];

export interface HostConfig {
  /** 0 = auto-assign; actual port is written to runtime.json. */
  port?: number;
  /** Absolute path to the runtime.json discovery file. */
  tokenFile?: string;
  /** Explicit token; when absent a fresh one is generated each start. */
  token?: string;
  /** Log verbosity. */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

/** Best-effort dsh version read: the app package.json reachable via the
 * heal'ed profile fallback, else 'unknown'. Never throws. */
function readDshVersion(): string {
  try {
    const home = process.env.DSH_HOME ?? `${process.env.HOME ?? ''}/.dsh`;
    const candidates = [
      `${home}/profiles/node_modules/@deepseek-ai/dsh/package.json`,
      `${home}/node_modules/@deepseek-ai/dsh/package.json`,
    ];
    for (const p of candidates) {
      try {
        const manifest = JSON.parse(readFileSync(p, 'utf8')) as { version?: string };
        if (manifest.version) return manifest.version;
      } catch {
        // try next candidate
      }
    }
  } catch {
    // fall through
  }
  return 'unknown';
}

/** Expand `$VAR` / `${VAR}` environment references in a path string. */
function expandEnv(path: string): string {
  return path.replace(/\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_m, braced: string, plain: string) => {
    const name = braced ?? plain;
    return process.env[name] ?? '';
  });
}

/** Cap on per-session history events replayed at startup (protects the ring). */
const HISTORY_REPLAY_MAX = 2000;

/**
 * Translate each live session's recovered log into the bus (bounded). This
 * gives a reconnecting client a full-rebuild source after a host restart.
 */
async function replaySessionHistory(ctx: HostCtx, bus: EventBus, log: HostCtx['logger']): Promise<void> {
  const sessionsSvc = optionalView(ctx, 'sessions') as {
    list?: () => Array<{ id: string; events?: readonly unknown[] }>;
  } | undefined;
  if (!sessionsSvc?.list) {
    log?.debug?.('[cursorkit] replay: no sessions.list');
    return;
  }
  let sessions: Array<{ id: string; events?: readonly unknown[] }> = [];
  try {
    sessions = sessionsSvc.list();
  } catch (err) {
    log?.warn?.('[cursorkit] replay: sessions.list threw', err);
    return;
  }
  log?.info?.(`[cursorkit] replay: ${sessions.length} live sessions`);
  for (const s of sessions) {
    let events: readonly unknown[] = [];
    try {
      events = s.events ?? [];
    } catch (err) {
      continue;
    }
    log?.debug?.(`[cursorkit] replay: session ${s.id} has ${events.length} events`);
    const window = events.slice(-HISTORY_REPLAY_MAX);
    let emitted = 0;
    for (const raw of window) {
      const translated = translateRawEvent(s.id, raw as never);
      if (translated) {
        bus.emit(translated as never);
        emitted++;
      }
    }
    log?.info?.(`[cursorkit] replay: session ${s.id} emitted ${emitted} CKP events (from ${window.length} dsh events)`);
  }
}

function optionalView(ctx: unknown, path: string): unknown {
  try {
    return getPath(ctx, path);
  } catch {
    return undefined;
  }
}

function getPath(obj: unknown, path: string): unknown {
  try {
    return path.split('.').reduce<unknown>((acc, key) => {
      if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
      return undefined;
    }, obj);
  } catch {
    return undefined;
  }
}

/** Minimal ctx-like surface we depend on (typed loosely — dsh is upstream). */
export interface HostCtx {
  sessions?: unknown;
  agentLoop?: unknown;
  on?: (event: string, listener: (...args: never[]) => void) => unknown;
  effect?: (fn: (() => void | Promise<void>) | (() => () => void)) => unknown;
  logger?: {
    debug?: (...args: unknown[]) => void;
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
  };
  [key: string]: unknown;
}

export function apply(ctx: HostCtx, config: HostConfig = {}): void {
  const log = ctx.logger ?? console;
  const token = config.token ?? generateToken();
  const tokenFile = expandEnv(config.tokenFile ?? `${process.env.DSH_HOME ?? '.dsh'}/.cursorkit/runtime.json`);

  // 1. Capability probe — fail fast, never silently degrade.
  let report: CapabilityReport;
  try {
    need<unknown>(ctx, 'sessions');
    need<unknown>(ctx, 'agents');
    const version = readDshVersion();
    report = probe(ctx as never, { version, commit: undefined });
    if (!report.required.ok) {
      throw new CapabilityMissingError(report.required.missing);
    }
    log.info?.(`[cursorkit] capabilities ok: dsh=${version}, optional=${JSON.stringify(report.optional)}`);
  } catch (err) {
    if (err instanceof CapabilityMissingError) {
      log.error?.('[cursorkit] refusing to start: missing capabilities', err.missing);
      throw err;
    }
    throw err;
  }

  // 2. Start the RPC server via ctx.effect (auto-closed on unload).
  const bus = new EventBus();
  const approvals = new ApprovalBridge({ bus });
  /**
   * 会话 → 模型（落盘持久化）：
   * dsh 的 session 不记录模型选择，重启后 session.get 无从回读；
   * 这里持久化到 runtime.json 同目录，重启后仍能准确跟踪。
   */
  const dshHome = dirname(tokenFile).replace(/\/\.cursorkit$/, '');
  const sessionIndex = new SessionIndex({
    file: sessionIndexFile(dshHome),
    onWarn: (m) => log.warn?.(`[cursorkit] ${m}`),
  });
  // Cross-process ring snapshot: surviving a host restart with incremental
  // replay instead of forcing every client to full-rebuild.
  const busSnapshotFile = `${tokenFile}.bus.json`;
  let restoredBus = false;

  ctx.effect?.(() => {
    let disposed = false;

    // Save the ring synchronously on termination signals so a subsequent host
    // process can serve incremental replay (doc §5.6 / §9.5).
    const onSignal = () => {
      try {
        bus.saveSnapshotSync(busSnapshotFile);
      } catch {
        // ignore on shutdown paths
      }
    };
    process.on('SIGTERM', onSignal);
    process.on('SIGINT', onSignal);

    void (async () => {
      try {
        // Restore the previous process's event ring (best-effort).
        restoredBus = await bus.restoreSnapshot(busSnapshotFile);
        if (restoredBus) {
          await bus.clearSnapshot(busSnapshotFile);
          log.info?.(`[cursorkit] restored event bus snapshot: seq=${bus.lastSeq}, events=${bus.replayFrom(0)?.length ?? 0}`);
        }

        // 默认模型：跟随 dsh 配置（settings.yaml 的 agent-default-model.model），
        // 不在扩展里硬编码 —— 否则用户改了 dsh 配置而扩展仍用旧默认。
        try {
          const settingsPath = join(dshHome, 'settings.yaml');
          if (existsSync(settingsPath)) {
            const configured = parseConfiguredDefaultModel(readFileSync(settingsPath, 'utf8'));
            setConfiguredDefaultModel(configured);
            if (configured) log?.info?.(`[cursorkit] 默认模型（来自 settings.yaml）：${configured}`);
          }
        } catch (err) {
          log?.warn?.(`[cursorkit] 读取默认模型失败: ${String(err)}`);
        }

        // 历史会话标题回填（后台一次性）：标题捕获是后加的能力，
        // 之前创建的会话在列表里只有 id。直接读磁盘日志补上。
        setTimeout(() => {
          try {
            const need = new Set(
              sessionIndex
                .all()
                .filter(([, e]) => !e.title)
                .map(([id]) => id),
            );
            if (need.size === 0) return;
            const found = scanTitlesOnDisk(join(dshHome, 'sessions'), need);
            for (const [id, title] of found) sessionIndex.setTitle(id, title);
            log?.info?.(`[cursorkit] 标题回填：${found.size}/${need.size} 个历史会话`);
          } catch (err) {
            log?.warn?.(`[cursorkit] 标题回填失败: ${String(err)}`);
          }
        }, 1500).unref?.();

        const server = await startServer({
          token,
          capabilities: report,
          bus,
          approvals,
          sessions: sessionsCompat(ctx),
          agents: agentsCompat(ctx),
          appVersion: report.dshVersion,
          sessionIndex,
          dshHome,
        });

        if (disposed) {
          await server.close();
          return;
        }

        // 3. Write runtime.json (removed on unload).
        const info = {
          pid: process.pid,
          port: server.port,
          token,
          protocolVersion: CKP_PROTOCOL_VERSION,
          dshVersion: report.dshVersion,
          dshCommit: report.dshCommit,
          startedAt: new Date().toISOString(),
          pidfile: `${tokenFile}.pid`,
        };
        await writeRuntimeFile(tokenFile, info);
        log.info?.(`[cursorkit] CKP server listening on 127.0.0.1:${server.port} (runtime.json: ${tokenFile})`);

        // 4. Bridge dsh session/event firehose → CKP events.
        const listeners: unknown[] = [];
        const bridgeTracker = new SessionBridgeTracker();
        const onEvent = (session: { id: string }, event: unknown) => {
          const raw = event as never;
          // 会话标题落盘（dsh 生成，供会话列表显示）
          if ((raw as RawSessionEvent).type === 'session/title') {
            const title = cleanSessionTitle(
              String(((raw as RawSessionEvent).data as { title?: string } | undefined)?.title ?? ''),
            );
            if (title) sessionIndex.setTitle(session.id, title);
          }
          // 首条真实用户消息 → 作为标题兜底（dsh 的标题是异步生成的，列表先有内容更友好）
          if ((raw as RawSessionEvent).type === 'user/message' && !sessionIndex.titleOf(session.id)) {
            const d = ((raw as RawSessionEvent).data ?? {}) as {
              source?: { kind?: string };
              content?: { type?: string; text?: string }[];
            };
            if (d.source?.kind === 'user') {
              const text = (d.content ?? [])
                .map((b) => (typeof b?.text === 'string' ? b.text : ''))
                .join('');
              const fallback = cleanSessionTitle(text);
              if (fallback) sessionIndex.setTitle(session.id, fallback);
            }
          }
          const translated = translateRawEvent(session.id, raw);
          if (translated) bus.emit(translated as never);
          // tool/result 成功时 bridge 只产出 tool.output；再补一条 tool.done，
          // 否则前端工具卡永远停在"运行中"（实测 bug）。
          if (
            translated &&
            (translated as { type?: string }).type === 'tool.output' &&
            (raw as RawSessionEvent).type === 'tool/result'
          ) {
            const ev = translated as unknown as {
              callId?: string;
              sessionId: string;
              turn?: number;
              step?: number;
            };
            bus.emit({
              sessionId: session.id,
              type: 'tool.done',
              callId: ev.callId,
              status: 'success',
              turn: ev.turn,
              step: ev.step,
            } as never);
          }
          // Track tool/call for file.changed inference on the matching result.
          if ((raw as RawSessionEvent).type?.startsWith('tool/call')) {
            bridgeTracker.noteCall(raw as RawSessionEvent);
          }
          const fileChange = bridgeTracker.maybeFileChange(session.id, raw as RawSessionEvent);
          if (fileChange) bus.emit(fileChange as never);
        };
        const onCreated = (session: { id: string }) => {
          bus.emit({
            sessionId: session.id,
            type: 'session.started',
            workspace: '',
            model: undefined,
          } as never);
        };
        if (typeof ctx.on === 'function') {
          const h1 = ctx.on('session/event' as never, onEvent as never);
          const h2 = ctx.on('session/created' as never, onCreated as never);
          listeners.push(h1, h2);
        }

        // 4b. Replay recovered session history into the bus so a reconnecting
        // client can full-rebuild after a host restart (doc §9.5 GAP path).
        // Bounded to the last HISTORY_REPLAY_MAX events per session.
        // Skipped when a cross-process ring snapshot was restored: the ring
        // already carries the recent window, and re-emitting recovered dsh
        // history would assign fresh seqs to old events.
        if (!restoredBus) {
          await replaySessionHistory(ctx, bus, log);
        }

        // 5. Bridge dsh approval seam → CKP approvals (when ctx.approval exists).
        const disposeAnswerer = registerDshAnswerer(ctx as never, { bridge: approvals, bus });
        listeners.push(disposeAnswerer);

        // 6. Auto-checkpoint: when the bridge infers a file.changed, snapshot
        // the workspace (throttled) so the user can restore before the write.
        const resolveWorkspace = (sessionId: string): string | undefined => {
          const s = sessionsCompat(ctx).get(sessionId);
          return s?.header?.cwd;
        };
        const disposeAutoCheckpoint = attachAutoCheckpoint(bus, resolveWorkspace, { throttleMs: 60_000 });
        listeners.push(disposeAutoCheckpoint);

        return async () => {
          disposed = true;
          process.removeListener('SIGTERM', onSignal);
          process.removeListener('SIGINT', onSignal);
          // Persist the ring so the next host process can replay incrementally.
          try {
            await bus.saveSnapshot(busSnapshotFile);
          } catch (err) {
            log.warn?.('[cursorkit] failed to save bus snapshot:', err);
          }
          await server.close();
          approvals.close();
          await removeRuntimeFile(tokenFile);
        };
      } catch (err) {
        log.error?.('[cursorkit] failed to start server:', err);
        throw err;
      }
    })();

    return () => {
      disposed = true;
    };
  });
}
