/**
 * SessionIndex 测试。
 * 修复：dsh 重启后旧会话不载入内存 → 历史会话消失、无法继续。
 * 索引落盘后：session.list 能列出历史、session.get 不再 NOT_FOUND、send 可 resume。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionIndex, MAX_ENTRIES, sessionIndexFile, cleanSessionTitle } from '../src/session-index.ts';

let dir: string;
let file: string;
const entry = { model: 'wps/moonshot/kimi-k2.7-code', workspace: '/w/p', createdAt: 1000 };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ck-index-'));
  file = join(dir, 'session-index.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('SessionIndex', () => {
  it('set/get/modelOf 语义', () => {
    const idx = new SessionIndex({ file, debounceMs: 1 });
    idx.set('s1', entry);
    expect(idx.get('s1')).toEqual(entry);
    expect(idx.modelOf('s1')).toBe(entry.model);
    expect(idx.get('missing')).toBeUndefined();
  });

  it('落盘后新实例可读（重启后历史会话仍可列出）', async () => {
    const a = new SessionIndex({ file, debounceMs: 1 });
    a.set('s1', entry);
    a.set('s2', { model: 'deepseek/deepseek-v4-flash', workspace: '/w/q', createdAt: 2000 });
    await a.flush();

    const b = new SessionIndex({ file });
    expect(b.size).toBe(2);
    expect(b.get('s2')?.workspace).toBe('/w/q');
    // all() 按创建时间倒序（新的在前）
    expect(b.all().map(([id]) => id)).toEqual(['s2', 's1']);
  });

  it('文件不存在/损坏时静默为空', () => {
    expect(new SessionIndex({ file: join(dir, 'nope.json') }).size).toBe(0);
    writeFileSync(file, '{bad', 'utf8');
    expect(new SessionIndex({ file }).size).toBe(0);
  });

  it('跳过结构不合法的条目', () => {
    writeFileSync(file, JSON.stringify({ good: entry, bad: { workspace: '/x' }, nul: null }), 'utf8');
    const idx = new SessionIndex({ file });
    expect(idx.size).toBe(1);
    expect(idx.get('good')?.model).toBe(entry.model);
  });

  it('超上限丢弃最旧', () => {
    const idx = new SessionIndex({ file, debounceMs: 1 });
    for (let i = 0; i < MAX_ENTRIES + 5; i++) idx.set(`s${i}`, { ...entry, createdAt: i });
    expect(idx.size).toBe(MAX_ENTRIES);
    expect(idx.get('s0')).toBeUndefined();
  });

  it('写盘失败只告警', async () => {
    const warns: string[] = [];
    const badParent = join(dir, 'afile');
    writeFileSync(badParent, 'x', 'utf8');
    const idx = new SessionIndex({
      file: join(badParent, 'sub', 'session-index.json'),
      onWarn: (m) => warns.push(m),
      debounceMs: 1,
    });
    idx.set('s1', entry);
    await idx.flush();
    expect(warns.length).toBeGreaterThan(0);
  });

  it('sessionIndexFile 与 runtime.json 同目录', () => {
    expect(sessionIndexFile('/home/u/.dsh-cursorkit')).toBe('/home/u/.dsh-cursorkit/.cursorkit/session-index.json');
  });
});

describe('SessionIndex: 会话标题', () => {
  it('setTitle 更新已有条目的标题（保留 model/workspace）', async () => {
    const idx = new SessionIndex({ file, debounceMs: 1 });
    idx.set('s1', entry);
    idx.setTitle('s1', '解释项目架构');
    expect(idx.titleOf('s1')).toBe('解释项目架构');
    expect(idx.get('s1')?.model).toBe(entry.model);
    expect(idx.get('s1')?.workspace).toBe(entry.workspace);
  });

  it('索引里没有该会话时创建"仅标题"条目', () => {
    const idx = new SessionIndex({ file, debounceMs: 1 });
    idx.setTitle('new-session', '来自 dsh CLI 的会话');
    expect(idx.titleOf('new-session')).toBe('来自 dsh CLI 的会话');
    expect(idx.get('new-session')?.model).toBe('');
  });

  it('标题落盘并可回读（重启后会话列表仍有标题）', async () => {
    const a = new SessionIndex({ file, debounceMs: 1 });
    a.set('s1', entry);
    a.setTitle('s1', '我的会话标题');
    await a.flush();
    const b = new SessionIndex({ file });
    expect(b.titleOf('s1')).toBe('我的会话标题');
  });
});

describe('cleanSessionTitle', () => {
  it('剥掉我们的模式提示（dsh 标题被污染的场景）', () => {
    expect(cleanSessionTitle('解释项目架构 [模式: Agent] 如果这个请求需要改动代码…')).toBe('解释项目架构');
    expect(cleanSessionTitle('修一下白屏 [模式: Ask] 只回答…')).toBe('修一下白屏');
  });

  it('保留干净的标题', () => {
    expect(cleanSessionTitle('解释项目架构')).toBe('解释项目架构');
  });

  it('压缩空白并截断到 80 字符', () => {
    expect(cleanSessionTitle('a\n\n  b')).toBe('a b');
    expect(cleanSessionTitle('x'.repeat(200)).length).toBe(80);
  });

  it('全空返回空串（调用方不应写入）', () => {
    expect(cleanSessionTitle('   ')).toBe('');
  });
});
