/**
 * 轮次分组测试（修复遗留项：同一轮的文本与工具调用视觉割裂）。
 */
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { groupByTurn, MessageList, MAX_DOM_ITEMS } from '../webview/src/components/MessageList.tsx';
import type { ChatItem } from '../webview/src/types.ts';

const mk = (id: string, role: ChatItem['role'], turn?: number): ChatItem => ({
  id,
  role,
  text: id,
  ...(turn !== undefined ? { turn } : {}),
});

describe('groupByTurn', () => {
  it('同一轮的条目归到一组（含工具调用）', () => {
    const groups = groupByTurn([
      mk('u1', 'user'),
      mk('a1', 'assistant', 1),
      mk('t1', 'tool', 1),
      mk('a2', 'assistant', 1),
      mk('u2', 'user'),
      mk('a3', 'assistant', 2),
    ]);
    expect(groups).toHaveLength(4);
    expect(groups[1].turn).toBe(1);
    expect(groups[1].items.map((i) => i.id)).toEqual(['a1', 't1', 'a2']);
    expect(groups[3].items.map((i) => i.id)).toEqual(['a3']);
  });

  it('无 turn 的条目各自成组（保留原始顺序）', () => {
    const groups = groupByTurn([mk('x', 'system'), mk('y', 'system')]);
    expect(groups).toHaveLength(2);
  });

  it('空数组 → 空结果', () => {
    expect(groupByTurn([])).toEqual([]);
  });

  it('turn 相同时不会跨轮合并（turn 变化即新组）', () => {
    const groups = groupByTurn([mk('a', 'assistant', 1), mk('b', 'assistant', 2)]);
    expect(groups).toHaveLength(2);
  });
});

describe('MessageList 渲染分组', () => {
  it('同一轮渲染为一个 .turn 容器', () => {
    const html = renderToStaticMarkup(
      h(MessageList, {
        items: [mk('a1', 'assistant', 1), mk('t1', 'tool', 1)],
        busy: false,
      }),
    );
    expect(html).toContain('turn turn-tagged');
    // 两个条目都在同一个 turn 容器内
    const turnStart = html.indexOf('turn turn-tagged');
    const turnEnd = html.indexOf('</div>', html.indexOf('tool-card'));
    expect(turnStart).toBeLessThan(turnEnd);
  });

  it('无 turn 的条目容器不带 turn-tagged', () => {
    const html = renderToStaticMarkup(h(MessageList, { items: [mk('s', 'system')], busy: false }));
    expect(html).toContain('class="turn "');
    expect(html).not.toContain('turn-tagged');
  });

  it('分组后仍保持 DOM 上限', () => {
    const items = Array.from({ length: MAX_DOM_ITEMS + 5 }, (_, i) => mk(`m${i}`, 'assistant', i));
    const html = renderToStaticMarkup(h(MessageList, { items, busy: false }));
    expect(html).toContain('已省略较早的 5 条消息');
  });
});
