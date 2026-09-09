import { describe, expect, it } from 'vitest';
import { EMPTY_MANIFEST, manifestToCommands } from '../src/ext-host/manifest.ts';

describe('ext-host manifest', () => {
  it('empty manifest maps to no commands', () => {
    expect(manifestToCommands(EMPTY_MANIFEST)).toEqual([]);
  });

  it('maps commands with keybindings into palette entries', () => {
    const manifest = {
      ...EMPTY_MANIFEST,
      commands: [
        { id: 'c1', title: '查看状态', keybinding: 'Cmd+Shift+S' },
        { id: 'c2', title: '无快捷键命令' },
      ],
    };
    const entries = manifestToCommands(manifest);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ id: 'c1', title: '查看状态', group: '插件命令', keybinding: 'Cmd+Shift+S' });
    expect(entries[1]).toMatchObject({ id: 'c2', title: '无快捷键命令' });
  });

  it('empty manifest shape stays stable', () => {
    expect(Object.keys(EMPTY_MANIFEST).sort()).toEqual(['commands', 'panels', 'renderers', 'settings', 'status']);
  });
});
