/**
 * SessionIndex 测试。
 * 修复：dsh 重启后旧会话不载入内存 → 历史会话消失、无法继续。
 * 索引落盘后：session.list 能列出历史、session.get 不再 NOT_FOUND、send 可 resume。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionIndex, MAX_ENTRIES, sessionIndexFile } from '../src/session-index.ts';

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
