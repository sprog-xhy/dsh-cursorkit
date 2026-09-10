import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { zstdDecompressSync } from 'node:zlib';
import {
  deriveFromEvents,
  titleFromSessionFile,
  scanTitlesOnDisk,
  decompressSessionLog,
} from '../src/session-titles.ts';

const USER_MSG = (text: string, kind = 'user') => ({
  type: 'user/message',
  data: { source: { kind }, content: [{ type: 'text', text }] },
});

describe('会话标题回填', () => {
  it('优先 session/title 并清洗模式提示', () => {
    expect(deriveFromEvents([USER_MSG('问题'), { type: 'session/title', data: { title: '修白屏 [模式: Agent] xx' } }])).toBe(
      '修白屏',
    );
  });

  it('无 title 事件时取首条真实用户消息', () => {
    expect(deriveFromEvents([USER_MSG('系统提示', 'plugin'), USER_MSG('帮我改配色\n\n[模式: Ask] yy')])).toBe('帮我改配色');
  });

  it('只有系统注入 → 无标题', () => {
    expect(deriveFromEvents([USER_MSG('skills', 'skill-catalog')])).toBeUndefined();
  });

  it('能从真实 zstd 会话文件里读出标题', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ck-title-'));
    const file = join(dir, 'session.jsonl.zstd');
    const jsonl = [JSON.stringify(USER_MSG('解释项目架构')), JSON.stringify({ type: 'turn/start', data: {} })].join('\n');
    writeFileSync(file, execFileSync('zstd', ['-c'], { input: jsonl }));
    expect(titleFromSessionFile(file)).toBe('解释项目架构');
  });

  it('损坏文件不抛错（返回 undefined）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ck-title-'));
    const file = join(dir, 'bad.jsonl.zstd');
    writeFileSync(file, 'not zstd');
    expect(titleFromSessionFile(file)).toBeUndefined();
  });

  it('scanTitlesOnDisk 只处理需要补的 id', () => {
    const home = mkdtempSync(join(tmpdir(), 'ck-home-'));
    const wsDir = join(home, 'sessions', '--ws--');
    for (const id of ['s1', 's2']) {
      mkdirSync(join(wsDir, id), { recursive: true });
      writeFileSync(
        join(wsDir, id, 'session.jsonl.zstd'),
        execFileSync('zstd', ['-c'], { input: `${JSON.stringify(USER_MSG(`问题-${id}`))}\n` }),
      );
    }
    const found = scanTitlesOnDisk(join(home, 'sessions'), new Set(['s1']));
    expect(found.get('s1')).toBe('问题-s1');
    expect(found.has('s2')).toBe(false);
  });
});

describe('多帧 zstd 会话日志（实测 dsh 每次追加写一帧）', () => {
  it('逐帧解压：多帧日志能读全（Node 单帧 API 只解第一帧）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ck-frames-'));
    const file = join(dir, 'multi.jsonl.zstd');
    // 三次追加 → 三个 zstd 帧
    const frames = [
      JSON.stringify({ type: 'session', data: {} }),
      JSON.stringify(USER_MSG('多帧会话标题')),
      JSON.stringify({ type: 'turn/start', data: {} }),
    ].map((l) => execFileSync('zstd', ['-c'], { input: `${l}\n` })); // 每行一个事件（含换行）
    writeFileSync(file, Buffer.concat(frames));

    const buf = readFileSync(file);
    expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]));
    // 单帧 API 的局限（文档化这个坑）
    expect(zstdDecompressSync(buf).toString('utf8').split('\n').filter(Boolean).length).toBe(1);
    // 我们的实现能读全
    expect(decompressSessionLog(buf).toString('utf8').split('\n').filter(Boolean).length).toBe(3);
    expect(titleFromSessionFile(file)).toBe('多帧会话标题');
  });
});
