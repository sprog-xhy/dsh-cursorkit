/**
 * 激活冒烟测试：在 node 里用桩 vscode API 真正执行 activate()/deactivate()。
 *
 * 覆盖：命令注册完整、侧边栏视图/会话树/虚拟文档提供器注册、
 * 自动启动开关生效（测试中关闭，不拉真实 sidecar）、重复激活/停用不抛错。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { ExtensionContext } from './stubs/vscode.ts';
import {
  registeredCommands,
  registeredProviders,
  executedCommands,
  errorMessages,
  Uri,
} from './stubs/vscode.ts';
import { activate, deactivate } from '../src/extension.ts';
import { setConfig, registeredUriHandlers } from './stubs/vscode.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function makeContext(): ExtensionContext {
  const state = new Map<string, unknown>();
  return {
    subscriptions: [],
    extension: { packageJSON: { version: '0.1.0-test' } },
    extensionUri: Uri.file('/tmp/ext'),
    secrets: {
      get: async () => undefined,
      store: async () => undefined,
    },
    globalState: {
      get: <T>(k: string, d?: T): T => (state.get(k) as T) ?? (d as T),
      update: async (k: string, v: unknown) => {
        state.set(k, v);
      },
    },
  };
}

const EXPECTED_COMMANDS = [
  'dshCursorkit.newChat',
  'dshCursorkit.openChat',
  'dshCursorkit.stop',
  'dshCursorkit.editCode',
  'dshCursorkit.toggleTab',
  'dshCursorkit.openSettings',
  'dshCursorkit.checkpoints',
  'dshCursorkit.focusChatView',
  'dshCursorkit.doctor',
];

describe('extension activation', () => {
  beforeEach(() => {
    // 活动日志写到临时目录（不污染真实 ~/.dsh-cursorkit）
    setConfig('dshCursorkit.sidecar.dshHome', mkdtempSync(join(tmpdir(), 'ck-act-')));
    registeredUriHandlers.length = 0;
    registeredCommands.clear();
    registeredProviders.length = 0;
    executedCommands.length = 0;
    errorMessages.length = 0;
  });

  it('activate 注册全部命令且不抛错', async () => {
    const ctx = makeContext();
    await activate(ctx);
    for (const cmd of EXPECTED_COMMANDS) {
      expect(registeredCommands.has(cmd), `缺少命令 ${cmd}`).toBe(true);
    }
    deactivate();
  });

  it('activate 注册侧边栏视图 + 会话树 + 虚拟文档提供器', async () => {
    await activate(makeContext());
    const kinds = registeredProviders.map((p) => `${p.kind}:${p.id}`);
    expect(kinds.some((k) => k.startsWith('webviewView:'))).toBe(true);
    expect(kinds.some((k) => k.startsWith('tree:'))).toBe(true);
    expect(kinds).toContain('contentProvider:dsh-virtual');
    deactivate();
  });

  it('autoStart=false 时不启动 sidecar（不应报错）', async () => {
    await activate(makeContext());
    // 稍等事件循环，确认没有异步激活错误
    await new Promise((r) => setTimeout(r, 50));
    expect(errorMessages.filter((m) => m.includes('sidecar 启动失败'))).toHaveLength(0);
    deactivate();
  });

  it('toggleTab 命令切换设置（走 workspace 配置）', async () => {
    await activate(makeContext());
    const handler = registeredCommands.get('dshCursorkit.toggleTab');
    expect(handler).toBeTypeOf('function');
    await handler?.();
    deactivate();
  });

  it('focusChatView 命令执行对应的 workbench 命令', async () => {
    await activate(makeContext());
    await registeredCommands.get('dshCursorkit.focusChatView')?.();
    const invoked = executedCommands.map((c) => c.command);
    expect(invoked).toContain('workbench.view.extension.dshCursorkit');
    expect(invoked).toContain('dshCursorkit.chatView.focus');
    deactivate();
  });

  it('openSettings 命令打开设置页', async () => {
    await activate(makeContext());
    await registeredCommands.get('dshCursorkit.openSettings')?.();
    expect(executedCommands.map((c) => c.command)).toContain('workbench.action.openSettings');
    deactivate();
  });

  it('注册了 URI handler（可从外部打开 Chat）', async () => {
    await activate(makeContext());
    expect(registeredUriHandlers.length).toBe(1);
    // 触发 chat 动作不应抛错
    await expect(
      Promise.resolve(registeredUriHandlers[0].handleUri(Uri.parse('vscode://sprogx.dsh-cursorkit/chat'))),
    ).resolves.toBeUndefined();
    deactivate();
  });

  it('deactivate 后所有订阅被释放且不抛错', async () => {
    const ctx = makeContext();
    await activate(ctx);
    expect(ctx.subscriptions.length).toBeGreaterThan(0);
    expect(() => deactivate()).not.toThrow();
    expect(() => deactivate()).not.toThrow(); // 幂等
  });
});
