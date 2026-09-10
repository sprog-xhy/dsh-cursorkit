/**
 * 组件渲染冒烟测试（react-dom/server）。
 *
 * 目的：在无浏览器环境下真实验证组件树可渲染、分支正确、类名符合预期。
 * 用 createElement 而非 JSX（扩展侧 tsconfig 未开 jsx，避免额外构建配置）。
 */
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TopBar } from '../webview/src/components/TopBar.tsx';
import { MessageList } from '../webview/src/components/MessageList.tsx';
import { MessageItem } from '../webview/src/components/MessageItem.tsx';
import { Composer } from '../webview/src/components/Composer.tsx';
import { ThinkingBlock } from '../webview/src/components/ThinkingBlock.tsx';
import { ToolCallCard } from '../webview/src/components/ToolCallCard.tsx';
import { Panel } from '../webview/src/components/Panel.tsx';
import { ChangeCard } from '../webview/src/components/ChangeCard.tsx';
import { Composer } from '../webview/src/components/Composer.tsx';
import {
  SessionsPanel,
  ModelsPanel,
  ReviewPanel,
  CheckpointsPanel,
  SettingsPanel,
} from '../webview/src/components/panels.tsx';
import type { ChatItem } from '../webview/src/types.ts';

const noop = (): void => undefined;

describe('TopBar', () => {
  const base = {
    status: 'ready' as const,
    model: 'kimi-k2.7-code',
    sidecarInfo: ':42599 · dsh 0.1.1-rc.2',
    activeSessionId: 'session-abc123',
    changesCount: 2,
    activePanel: 'models',
    onToggleSessions: noop,
    onNewSession: noop,
    onToggleReview: noop,
    onToggleModels: noop,
    onToggleSettings: noop,
    onToggleCheckpoints: noop,
  };

  it('渲染状态点/模型/改动计数', () => {
    const html = renderToStaticMarkup(h(TopBar, base));
    expect(html).toContain('status-ready');
    expect(html).toContain('kimi-k2.7-code');
    expect(html).toContain('改动 2');
  });

  it('当前打开的模型面板按钮高亮（active）', () => {
    const html = renderToStaticMarkup(h(TopBar, base));
    expect(html).toContain('tb-btn active');
  });

  it('无改动时不显示计数', () => {
    const html = renderToStaticMarkup(h(TopBar, { ...base, changesCount: 0, activePanel: null }));
    expect(html).toContain('改动');
    expect(html).not.toContain('改动 0');
  });

  it('错误状态渲染对应类', () => {
    const html = renderToStaticMarkup(h(TopBar, { ...base, status: 'error' as const }));
    expect(html).toContain('status-error');
  });
});

describe('MessageItem 各角色', () => {
  const mk = (role: ChatItem['role'], extra: Partial<ChatItem> = {}): ChatItem => ({
    id: 'x',
    role,
    text: '内容',
    ...extra,
  });

  it('user：右对齐气泡', () => {
    const html = renderToStaticMarkup(h(MessageItem, { item: mk('user') }));
    expect(html).toContain('msg-user-bubble');
  });

  it('assistant：正文 + 复制按钮', () => {
    const html = renderToStaticMarkup(h(MessageItem, { item: mk('assistant', { text: '**粗体**' }) }));
    expect(html).toContain('msg-assistant');
    expect(html).toContain('<b>粗体</b>');
    expect(html).toContain('msg-copy');
  });

  it('tool：渲染工具卡片', () => {
    const html = renderToStaticMarkup(h(MessageItem, { item: mk('tool', { text: 'bash ls', status: 'done' }) }));
    expect(html).toContain('tool-card');
    expect(html).toContain('bash ls');
  });

  it('thinking：渲染折叠块', () => {
    const html = renderToStaticMarkup(h(MessageItem, { item: mk('thinking', { text: '在想' }) }));
    expect(html).toContain('thinking-block');
  });

  it('system error：错误分级类', () => {
    const html = renderToStaticMarkup(h(MessageItem, { item: mk('system', { text: 'boom', level: 'error' }) }));
    expect(html).toContain('msg-system-text error');
  });

  it('system stopped：停止分级类', () => {
    const html = renderToStaticMarkup(h(MessageItem, { item: mk('system', { text: '已停止', level: 'stopped' }) }));
    expect(html).toContain('stopped');
  });
});

describe('MessageList', () => {
  it('空态显示引导文案', () => {
    const html = renderToStaticMarkup(h(MessageList, { items: [], busy: false }));
    expect(html).toContain('empty-title');
  });

  it('busy 时显示生成中指示', () => {
    const html = renderToStaticMarkup(h(MessageList, { items: [], busy: true }));
    expect(html).toContain('typing');
  });

  it('超过 DOM 上限时提示省略条数', () => {
    const items: ChatItem[] = Array.from({ length: 520 }, (_, i) => ({
      id: `m-${i}`,
      role: 'assistant' as const,
      text: `t${i}`,
    }));
    const html = renderToStaticMarkup(h(MessageList, { items, busy: false }));
    expect(html).toContain('已省略较早的 20 条消息');
    // DOM 上限：只渲染尾部 500 条（首条 t0 不应出现）
    expect(html).not.toContain('>t0<');
  });
});

describe('Composer', () => {
  const props = {
    value: '',
    onChange: noop,
    onSend: noop,
    onStop: noop,
    busy: false,
    mode: 'agent' as const,
    onModeChange: noop,
    ready: true,
    status: 'ready' as const,
    textareaRef: { current: null } as React.RefObject<HTMLTextAreaElement>,
  };

  it('就绪时按模式给出占位提示', () => {
    const html = renderToStaticMarkup(h(Composer, props));
    expect(html).toContain('描述任务，可跨多个文件');
    expect(html).toContain('mode-btn active');
  });

  it('未就绪时提示正在连接并禁用', () => {
    const html = renderToStaticMarkup(h(Composer, { ...props, ready: false, status: 'starting' as const }));
    expect(html).toContain('正在连接 dsh sidecar');
    expect(html).toContain('disabled');
  });

  it('连接错误时给出排障指引', () => {
    const html = renderToStaticMarkup(h(Composer, { ...props, ready: false, status: 'error' as const }));
    expect(html).toContain('sidecar 连接失败');
  });

  it('busy 时显示停止按钮', () => {
    const html = renderToStaticMarkup(h(Composer, { ...props, busy: true }));
    expect(html).toContain('btn-stop');
  });
});

describe('ThinkingBlock / ToolCallCard / Panel', () => {
  it('ThinkingBlock 默认折叠（不显示正文）', () => {
    const html = renderToStaticMarkup(h(ThinkingBlock, { text: '秘密推理' }));
    expect(html).toContain('thinking-toggle');
    expect(html).not.toContain('秘密推理');
  });

  it('ToolCallCard：read 工具用 read 色，完成态', () => {
    const html = renderToStaticMarkup(h(ToolCallCard, { name: 'read a.ts', status: 'done' }));
    expect(html).toContain('--ds-tl-read');
    expect(html).toContain('完成');
  });

  it('ToolCallCard：bash 工具用 run 色且运行中', () => {
    const html = renderToStaticMarkup(h(ToolCallCard, { name: 'bash ls', status: 'running' }));
    expect(html).toContain('--ds-tl-run');
    expect(html).toContain('运行中');
  });

  it('ToolCallCard：失败态用 fail 色', () => {
    const html = renderToStaticMarkup(h(ToolCallCard, { name: 'bash x', status: 'failed' }));
    expect(html).toContain('--ds-tl-fail');
    expect(html).toContain('失败');
  });

  it('Panel：无子项显示空态文案', () => {
    const html = renderToStaticMarkup(h(Panel, { title: 'T', onClose: noop, emptyText: '空空如也' }));
    expect(html).toContain('空空如也');
  });

  it('Panel：有子项时渲染内容而非空态', () => {
    const html = renderToStaticMarkup(
      h(Panel, { title: 'T', onClose: noop, emptyText: '空空如也' }, h('div', null, '子项')),
    );
    expect(html).toContain('子项');
    expect(html).not.toContain('空空如也');
  });
});

describe('面板组件', () => {
  it('SessionsPanel：空态 + 相对时间', () => {
    const empty = renderToStaticMarkup(
      h(SessionsPanel, {
        sessions: [],
        activeSessionId: '',
        onSwitch: noop,
        onNew: noop,
        onClose: noop,
      }),
    );
    expect(empty).toContain('暂无会话');

    const withData = renderToStaticMarkup(
      h(SessionsPanel, {
        sessions: [{ id: 'session-1', workspace: '/w/proj', createdAt: Date.now() }],
        activeSessionId: 'session-1',
        onSwitch: noop,
        onNew: noop,
        onClose: noop,
      }),
    );
    expect(withData).toContain('session-1');
    expect(withData).toContain('刚刚');
    expect(withData).toContain('panel-dot on');
  });

  it('ModelsPanel：标记当前模型', () => {
    const html = renderToStaticMarkup(
      h(ModelsPanel, {
        models: [
          { id: 'moonshot/kimi-k2.7-code', name: 'k', provider: 'wps' },
          { id: 'deepseek-v4-flash', name: 'd', provider: 'deepseek' },
        ],
        current: 'wps/moonshot/kimi-k2.7-code',
        onSelect: noop,
        onClose: noop,
      }),
    );
    expect(html).toContain('wps/moonshot/kimi-k2.7-code');
    expect(html).toContain('panel-row active');
    expect(html).toContain('deepseek');
  });

  it('ReviewPanel：状态 chip + 增删双色', () => {
    const html = renderToStaticMarkup(
      h(ReviewPanel, {
        changes: [{ path: 'a.ts', additions: 3, deletions: 1, status: 'modified' }],
        onDiff: noop,
        onReject: noop,
        onOpen: noop,
        onClose: noop,
      }),
    );
    expect(html).toContain('修改');
    expect(html).toContain('stat-add');
    expect(html).toContain('stat-del');
    expect(html).toContain('+3');
    expect(html).toContain('-1');
  });

  it('ReviewPanel：行数未知时不显示误导性的 -0', () => {
    const html = renderToStaticMarkup(
      h(ReviewPanel, {
        changes: [{ path: 'b.ts', additions: 0, deletions: 0, status: 'modified' }],
        onDiff: noop,
        onReject: noop,
        onOpen: noop,
        onClose: noop,
      }),
    );
    expect(html).not.toContain('-0');
    expect(html).toContain('—');
  });

  it('ReviewPanel：只有新增时不显示 -0', () => {
    const html = renderToStaticMarkup(
      h(ReviewPanel, {
        changes: [{ path: 'c.ts', additions: 5, deletions: 0, status: 'added' }],
        onDiff: noop,
        onReject: noop,
        onOpen: noop,
        onClose: noop,
      }),
    );
    expect(html).toContain('+5');
    expect(html).not.toContain('-0');
    expect(html).toContain('新增');
  });

  it('CheckpointsPanel：空态', () => {
    const html = renderToStaticMarkup(
      h(CheckpointsPanel, { checkpoints: [], onRollback: noop, onClose: noop }),
    );
    expect(html).toContain('暂无 checkpoint');
  });

  it('SettingsPanel：数据未到时显示读取中（不再整块消失）', () => {
    const html = renderToStaticMarkup(h(SettingsPanel, { data: null, onToggleTab: noop, onClose: noop }));
    expect(html).toContain('读取设置中');
  });

  it('SettingsPanel：有数据时显示 Tab 开关与 Rules', () => {
    const html = renderToStaticMarkup(
      h(SettingsPanel, {
        data: {
          rules: { global: 'g', project: [{ name: 'ts.mdc', globs: ['**/*.ts'] }] },
          config: { permissionMode: 'danger-full-access', tabEnabled: false },
        },
        onToggleTab: noop,
        onClose: noop,
      }),
    );
    expect(html).toContain('已关闭');
    expect(html).toContain('ts.mdc');
    expect(html).toContain('danger-full-access');
    expect(html).toContain('~/.cursorrules');
  });
});

describe('内联改动卡片与会话标题（Cursor 化）', () => {
  it('ChangeCard：显示文件名/统计/diff+撤销按钮', () => {
    const html = renderToStaticMarkup(
      h(ChangeCard, {
        path: 'src/components/App.tsx',
        additions: 12,
        deletions: 3,
        status: 'modified',
        onDiff: noop,
        onRevert: noop,
        onOpen: noop,
      }),
    );
    expect(html).toContain('>App.tsx<'); // 可见文本只显示文件名
    expect(html).toContain('title="src/components/App.tsx"'); // 全路径放 tooltip
    expect(html).toContain('+12');
    expect(html).toContain('-3');
    expect(html).toContain('查看差异');
    expect(html).toContain('撤销');
  });

  it('ChangeCard：新增文件用「新增」标签且无 -0', () => {
    const html = renderToStaticMarkup(
      h(ChangeCard, {
        path: 'a.ts',
        additions: 5,
        deletions: 0,
        status: 'created',
        onDiff: noop,
        onRevert: noop,
        onOpen: noop,
      }),
    );
    expect(html).toContain('新增');
    expect(html).not.toContain('-0');
  });

  it('MessageItem：role=change 渲染改动卡片', () => {
    const html = renderToStaticMarkup(
      h(MessageItem, {
        item: { id: 'c1', role: 'change', text: 'b.ts', path: 'b.ts', additions: 2, deletions: 1 },
      }),
    );
    expect(html).toContain('change-card');
  });

  it('SessionsPanel：优先显示标题，无标题回退到 id', () => {
    const html = renderToStaticMarkup(
      h(SessionsPanel, {
        sessions: [
          { id: 'session-abcdef123456', workspace: '/w/p', summary: '解释项目架构' },
          { id: 'session-999999', workspace: '/w/p' },
        ],
        activeSessionId: 'session-abcdef123456',
        onSwitch: noop,
        onNew: noop,
        onClose: noop,
      }),
    );
    expect(html).toContain('解释项目架构');
    expect(html).toContain('session-999999'.slice(0, 14));
  });

  it('TopBar：显示会话标题（无标题时回退 id 前缀）', () => {
    const base = {
      status: 'ready' as const,
      model: 'kimi-k2.7-code',
      sidecarInfo: ':1',
      activeSessionId: 'session-abcdef',
      changesCount: 0,
      activePanel: null,
      onToggleSessions: noop,
      onNewSession: noop,
      onToggleReview: noop,
      onToggleModels: noop,
      onToggleSettings: noop,
      onToggleCheckpoints: noop,
    };
    expect(renderToStaticMarkup(h(TopBar, { ...base, activeSessionLabel: '修复白屏' }))).toContain('修复白屏');
    expect(renderToStaticMarkup(h(TopBar, base))).toContain('session-');
  });
});

describe('Cursor 对齐：消息操作 / 排队 / 会话管理', () => {
  const base = { id: 'x', role: 'assistant' as const, text: 'hi' };

  it('助手消息：复制 / 重新生成 / 回滚到此', () => {
    const html = renderToStaticMarkup(
      h(MessageItem, {
        item: { ...base, retryText: '原始问题' },
        onRetry: noop,
        checkpointId: 'session-1-2',
        onRestore: noop,
      }),
    );
    expect(html).toContain('复制');
    expect(html).toContain('重新生成');
    expect(html).toContain('回滚到此');
  });

  it('助手消息没有 checkpoint 时不显示回滚按钮', () => {
    const html = renderToStaticMarkup(h(MessageItem, { item: { ...base, retryText: 'q' }, onRetry: noop }));
    expect(html).not.toContain('回滚到此');
  });

  it('用户消息：复制 / 编辑重发', () => {
    const html = renderToStaticMarkup(
      h(MessageItem, { item: { id: 'u', role: 'user', text: '帮我改配置' }, onEdit: noop }),
    );
    expect(html).toContain('编辑重发');
    expect(html).toContain('帮我改配置');
  });

  it('Composer：生成中显示排队数、发送按钮可用（排队发送）', () => {
    const html = renderToStaticMarkup(
      h(Composer, {
        value: '排队的内容',
        onChange: noop,
        onSend: noop,
        onStop: noop,
        busy: true,
        mode: 'agent' as const,
        onModeChange: noop,
        ready: true,
        status: 'ready' as const,
        textareaRef: { current: null },
        queued: 2,
      }),
    );
    expect(html).toContain('排队 2');
    expect(html).not.toContain('disabled=""'); // 生成中不应禁用发送
  });

  it('Composer：@ 提及候选列表渲染', () => {
    const html = renderToStaticMarkup(
      h(Composer, {
        value: '@chat',
        onChange: noop,
        onSend: noop,
        onStop: noop,
        busy: false,
        mode: 'ask' as const,
        onModeChange: noop,
        ready: true,
        status: 'ready' as const,
        textareaRef: { current: null },
        fileResults: ['src/chat/controller.ts', 'src/chat/view.ts'],
      }),
    );
    // 未触发 syncMention（无输入事件）时下拉不显示，但不应报错
    expect(html).toContain('composer');
  });

  it('Panel：条件渲染产生的 falsy 子元素不应破坏空态（回归）', () => {
    const empty = renderToStaticMarkup(
      h(Panel, {
        title: '会话',
        onClose: noop,
        emptyText: '暂无会话',
        children: [false, null, undefined],
      }),
    );
    expect(empty).toContain('暂无会话');
  });

  it('SessionsPanel：显示搜索框（会话较多时）与重命名/删除入口', () => {
    const sessions = Array.from({ length: 4 }, (_, i) => ({
      id: `session-${i}`,
      workspace: '/w',
      summary: `标题 ${i}`,
    }));
    const html = renderToStaticMarkup(
      h(SessionsPanel, { sessions, activeSessionId: 'session-0', onSwitch: noop, onNew: noop, onClose: noop }),
    );
    expect(html).toContain('panel-search');
    expect(html).toContain('改名');
    expect(html).toContain('删除');
  });
});
