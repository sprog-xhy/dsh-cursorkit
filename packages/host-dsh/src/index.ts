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

import { probe, type CapabilityReport } from './capability.ts';
import { startServer, type ServerDeps, type ServerHandle } from './rpc/server.ts';
import { EventBus } from './rpc/sse.ts';
import { ApprovalBridge } from './bridge/approval-bridge.ts';
import { generateToken, writeRuntimeFile, removeRuntimeFile, readRuntimeFile, type RuntimeInfo } from './runtime-file.ts';
import { need, CapabilityMissingError } from './compat/ctx.ts';
import { sessions as sessionsCompat, agent as agentCompat } from './compat/sessions.ts';
import { translateRawEvent, type RawCkpEvent, type RawSessionEvent } from './bridge/session-bridge.ts';
import { registerDshAnswerer } from './bridge/dsh-approval-adapter.ts';
import { CKP_PROTOCOL_VERSION } from '@dsh-cursorkit/protocol';

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
export const inject = ['sessions', 'agentLoop'];

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
  const tokenFile = config.tokenFile ?? `${process.env.DSH_HOME ?? '.dsh'}/.cursorkit/runtime.json`;

  // 1. Capability probe — fail fast, never silently degrade.
  let report: CapabilityReport;
  try {
    const sessionsSvc = need<unknown>(ctx, 'sessions');
    const agentSvc = need<unknown>(ctx, 'agent');
    const version = (ctx as { dshVersion?: string; version?: string }).dshVersion ?? 'unknown';
    report = probe(ctx as never, { version, commit: undefined });
    if (!report.required.ok) {
      throw new CapabilityMissingError(report.required.missing);
    }
    log.info?.(`[cursorkit] capabilities ok: dsh=${version}, optional=${JSON.stringify(report.optional)}`);
    void sessionsSvc;
    void agentSvc;
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

  ctx.effect?.(() => {
    let disposed = false;
    void (async () => {
      try {
        const server = await startServer({
          token,
          capabilities: report,
          bus,
          approvals,
          sessions: sessionsCompat(ctx),
          agent: agentCompat(ctx),
          appVersion: report.dshVersion,
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
        const onEvent = (session: { id: string }, event: unknown) => {
          const translated = translateRawEvent(session.id, event as never);
          if (translated) bus.emit(translated as never);
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

        // 5. Bridge dsh approval seam → CKP approvals (when ctx.approval exists).
        const disposeAnswerer = registerDshAnswerer(ctx as never, { bridge: approvals, bus });
        listeners.push(disposeAnswerer);

        return async () => {
          disposed = true;
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
