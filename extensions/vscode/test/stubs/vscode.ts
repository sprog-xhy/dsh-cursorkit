/**
 * 测试用 vscode API 桩（仅覆盖扩展实际使用的接口）。
 * 目的：在 node 里真正执行 activate()/deactivate()，捕获激活期错误。
 */
import { EventEmitter as NodeEmitter } from 'node:events';

export const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();
export const registeredProviders: { kind: string; id: string }[] = [];
export const infoMessages: string[] = [];
export const errorMessages: string[] = [];
export const executedCommands: { command: string; args: unknown[] }[] = [];

class Uri {
  constructor(
    readonly scheme: string,
    readonly path: string,
    readonly query = '',
  ) {}
  static file(p: string): Uri {
    return new Uri('file', p);
  }
  static parse(s: string): Uri {
    const m = /^([a-z-]+):\/?(.*)$/.exec(s);
    return m ? new Uri(m[1], m[2]) : new Uri('file', s);
  }
  static from(parts: { scheme: string; path: string; query?: string }): Uri {
    return new Uri(parts.scheme, parts.path, parts.query ?? '');
  }
  static joinPath(base: Uri, ...segs: string[]): Uri {
    const joined = [base.path, ...segs].join('/').replace(/\/+/g, '/');
    return new Uri(base.scheme, joined);
  }
  get fsPath(): string {
    return this.path;
  }
  toString(): string {
    return `${this.scheme}:${this.path}${this.query ? `?${this.query}` : ''}`;
  }
}

class Emitter<T> {
  private readonly inner = new NodeEmitter();
  readonly event = (listener: (e: T) => void): { dispose(): void } => {
    this.inner.on('e', listener);
    return { dispose: () => this.inner.off('e', listener) };
  };
  fire(value: T): void {
    this.inner.emit('e', value);
  }
  dispose(): void {
    this.inner.removeAllListeners();
  }
}

export const window = {
  createOutputChannel: (name: string) => ({
    name,
    appendLine: (): void => undefined,
    dispose: (): void => undefined,
  }),
  createStatusBarItem: () => ({ text: '', show: (): void => undefined, dispose: (): void => undefined }),
  showErrorMessage: async (msg: string) => {
    errorMessages.push(msg);
    return undefined;
  },
  showInformationMessage: async (msg: string) => {
    infoMessages.push(msg);
    return undefined;
  },
  showWarningMessage: async (msg: string) => {
    infoMessages.push(msg);
    return undefined;
  },
  showInputBox: async () => undefined,
  setStatusBarMessage: (_text: string, _timeout?: number) => ({ dispose: (): void => undefined }),
  showQuickPick: async () => undefined,
  showTextDocument: async () => ({ edit: async () => true }),
  withProgress: async (_opts: unknown, task: (p: unknown, t: unknown) => Promise<unknown>) =>
    task({ report: (): void => undefined }, { isCancellationRequested: false }),
  registerWebviewViewProvider: (id: string, _p: unknown) => {
    registeredProviders.push({ kind: 'webviewView', id });
    return { dispose: (): void => undefined };
  },
  registerTreeDataProvider: (id: string, _p: unknown) => {
    registeredProviders.push({ kind: 'tree', id });
    return { dispose: (): void => undefined };
  },
  createWebviewPanel: (viewType: string, title: string) => {
    const panel = {
      viewType,
      title,
      iconPath: undefined as unknown,
      webview: {
        html: '',
        options: {},
        cspSource: 'vscode-webview://test',
        postMessage: async () => true,
        onDidReceiveMessage: () => ({ dispose: (): void => undefined }),
        asWebviewUri: (u: Uri) => u,
      },
      onDidDispose: () => ({ dispose: (): void => undefined }),
      reveal: (): void => undefined,
      dispose: (): void => undefined,
    };
    return panel;
  },
  activeTextEditor: undefined,
  showWarningMessageModal: undefined,
};

export const commands = {
  registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
    registeredCommands.set(id, handler);
    return { dispose: (): void => undefined };
  },
  executeCommand: async (command: string, ...args: unknown[]) => {
    executedCommands.push({ command, args });
    return undefined;
  },
};

export const languages = {
  registerInlineCompletionItemProvider: (_selector: unknown, _provider: unknown) => {
    registeredProviders.push({ kind: 'inlineCompletion', id: '**' });
    return { dispose: (): void => undefined };
  },
};

const configValues: Record<string, unknown> = {
  'dshCursorkit.sidecar.autoStart': false, // 测试中不启动真实 sidecar
  'dshCursorkit.sidecar.dshHome': '',
  'dshCursorkit.chat.defaultModel': 'wps/moonshot/kimi-k2.7-code',
  'dshCursorkit.tab.enabled': true,
  'dshCursorkit.tab.debounceMs': 200,
  'dshCursorkit.permission.mode': 'danger-full-access',
};

export const workspace = {
  workspaceFolders: [{ uri: Uri.file('/tmp/ws'), name: 'ws', index: 0 }],
  textDocuments: [],
  getConfiguration: (section?: string) => ({
    get: <T>(key: string, fallback?: T): T => {
      const full = section ? `${section}.${key}` : key;
      return (configValues[full] as T) ?? (fallback as T);
    },
    update: async (): Promise<void> => undefined,
  }),
  getWorkspaceFolder: () => ({ uri: Uri.file('/tmp/ws'), name: 'ws', index: 0 }),
  openTextDocument: async () => ({ uri: Uri.file('/tmp/ws/a.ts'), getText: () => '', languageId: 'typescript' }),
  registerTextDocumentContentProvider: (scheme: string) => {
    registeredProviders.push({ kind: 'contentProvider', id: scheme });
    return { dispose: (): void => undefined };
  },
  onDidChangeConfiguration: () => ({ dispose: (): void => undefined }),
};

export const env = { appRoot: '/tmp/vscode' };

export class TreeItem {
  description?: string;
  tooltip?: string;
  iconPath?: unknown;
  command?: unknown;
  constructor(
    public label: string,
    public collapsibleState?: number,
  ) {}
}

export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
export class ThemeIcon {
  constructor(public id: string) {}
}
export const ViewColumn = { Beside: -2, Active: -1, One: 1 };
export const StatusBarAlignment = { Left: 1, Right: 2 };
export const ConfigurationTarget = { Global: 1, Workspace: 2 };
export const ProgressLocation = { Window: 10, Notification: 15 };
export const InlineCompletionTriggerKind = { Invoke: 0, Automatic: 1 };

export { Uri, Emitter };
export const EventEmitter = Emitter;
export type Disposable = { dispose(): void };
export type ExtensionContext = {
  subscriptions: { dispose(): void }[];
  extensionUri: Uri;
  secrets: { get(k: string): Promise<string | undefined>; store(k: string, v: string): Promise<void> };
  globalState: { get<T>(k: string, d?: T): T; update(k: string, v: unknown): Promise<void> };
};
