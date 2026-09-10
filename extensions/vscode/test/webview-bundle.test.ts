// @vitest-environment happy-dom
/**
 * webview 打包产物运行时测试（真 DOM）。
 *
 * 目的：复现"面板空白"这类问题 —— 静态检查（typecheck/构建）都过，
 * 但真实 webview 里 React 运行时抛错 → 白屏。
 * 这里用 happy-dom 加载 `dist/webview/chat.js`（用户实际看到的那份产物），
 * 打桩 `acquireVsCodeApi`，断言界面真的渲染出来了。
 *
 * 需要先构建前端（node scripts/build-all.mjs）；未构建时跳过。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const BUNDLE = join(__dirname, '..', 'dist', 'webview', 'chat.js');
const hasBundle = existsSync(BUNDLE);

describe.skipIf(!hasBundle)('webview 打包产物（真 DOM 渲染）', () => {
  it('加载 chat.js 后应渲染出顶栏与输入框（不是白屏）', async () => {
    const { Window } = await import('happy-dom');
    const window = new Window({ url: 'https://webview.test/' });
    const document = window.document;
    document.body.innerHTML = '<div id="root"></div>';

    // 打桩 webview API（VSCode 注入的 acquireVsCodeApi）
    const posted: unknown[] = [];
    const g = globalThis as unknown as Record<string, unknown>;
    g.window = window;
    g.document = document;
    g.navigator = window.navigator;
    g.HTMLElement = window.HTMLElement;
    g.Element = window.Element;
    g.Node = window.Node;
    g.Event = window.Event;
    g.CustomEvent = window.CustomEvent;
    g.MessageEvent = window.MessageEvent;
    g.requestAnimationFrame = (cb: (t: number) => void): number =>
      window.setTimeout(() => cb(Date.now()), 0) as unknown as number;
    g.cancelAnimationFrame = (id: number): void => window.clearTimeout(id);
    g.acquireVsCodeApi = () => ({
      postMessage: (m: unknown) => posted.push(m),
      getState: () => undefined,
      setState: () => undefined,
    });

    const code = readFileSync(BUNDLE, 'utf8');
    // 关键：用 vm 沙箱执行，**故意不提供 Node 的 process/require**
    // —— webview 里没有这些全局；真实白屏事故就是 `process is not defined`
    //    （Vite lib 模式不替换 process.env.NODE_ENV，React CJS 构建里带着它）
    const sandbox: Record<string, unknown> = {
      window,
      document: window.document,
      navigator: window.navigator,
      location: window.location,
      HTMLElement: window.HTMLElement,
      Element: window.Element,
      Node: window.Node,
      Event: window.Event,
      CustomEvent: window.CustomEvent,
      MessageEvent: window.MessageEvent,
      MessageChannel: (window as unknown as { MessageChannel?: unknown }).MessageChannel,
      requestAnimationFrame: (cb: (t: number) => void): number =>
        window.setTimeout(() => cb(Date.now()), 0) as unknown as number,
      cancelAnimationFrame: (id: number): void => window.clearTimeout(id),
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
      queueMicrotask: (cb: () => void): void => queueMicrotask(cb),
      acquireVsCodeApi: () => ({
        postMessage: (m: unknown) => posted.push(m),
        getState: () => undefined,
        setState: () => undefined,
      }),
      console,
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: 'chat.js' });

    // 等待 React 首次渲染
    await new Promise((r) => setTimeout(r, 100));

    const html = document.body.innerHTML;
    expect(html.length, '渲染结果为空 → 面板会白屏').toBeGreaterThan(200);
    expect(html).toContain('DSH CursorKit');
    expect(document.querySelector('.topbar')).toBeTruthy();
    expect(document.querySelector('.composer')).toBeTruthy();
    expect(document.querySelector('.messages')).toBeTruthy();
  }, 30_000);
});
