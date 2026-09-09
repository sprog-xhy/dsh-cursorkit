import { describe, expect, it } from 'vitest';
import { loadExtHost, type ExtHostRuntime } from '../src/ext-host/runtime.ts';
import { EMPTY_MANIFEST, type UiContribManifest } from '../src/ext-host/manifest.ts';

describe('loadExtHost', () => {
  it('loads nothing from an empty manifest', async () => {
    const rt: ExtHostRuntime = await loadExtHost(EMPTY_MANIFEST);
    expect(rt.renderers).toEqual([]);
    expect(rt.commands).toEqual([]);
    expect(rt.failed).toEqual([]);
  });

  it('loads renderer and command entries via dynamic import', async () => {
    // Real fixture modules on disk (relative to this test file).
    const rendererUrl = new URL('./fixtures/renderer-entry.mjs', import.meta.url).href;
    const commandUrl = new URL('./fixtures/command-entry.mjs', import.meta.url).href;
    const manifest: UiContribManifest = {
      ...EMPTY_MANIFEST,
      renderers: [{ tool: 'str_replace_editor', entry: rendererUrl }],
      commands: [{ id: 'c1', title: 'X', keybinding: 'Cmd+X', entry: commandUrl }],
    };
    const rt: ExtHostRuntime = await loadExtHost(manifest);
    expect(rt.renderers).toHaveLength(1);
    expect(rt.renderers[0]?.tool).toBe('str_replace_editor');
    expect(rt.commands).toHaveLength(1);
    expect(rt.commands[0]?.id).toBe('c1');
    expect(rt.failed).toEqual([]);
  });

  it('collects failures for missing entries without throwing', async () => {
    const manifest: UiContribManifest = {
      ...EMPTY_MANIFEST,
      renderers: [{ tool: 'missing', entry: 'file:///nonexistent/renderer.mjs' }],
      commands: [{ id: 'c2', title: 'Y', entry: 'file:///nonexistent/cmd.mjs' }],
    };
    const rt: ExtHostRuntime = await loadExtHost(manifest);
    expect(rt.renderers).toHaveLength(0);
    expect(rt.commands).toHaveLength(0);
    expect(rt.failed.length).toBe(2);
    expect(rt.failed.some((f) => f.id === 'renderer:missing')).toBe(true);
  });

  it('records manifest-only commands without an entry', async () => {
    const manifest: UiContribManifest = {
      ...EMPTY_MANIFEST,
      commands: [{ id: 'c3', title: '静态命令' }],
    };
    const rt: ExtHostRuntime = await loadExtHost(manifest);
    expect(rt.commands).toHaveLength(1);
    expect(rt.commands[0]?.entry).toBeUndefined();
    expect(rt.failed).toEqual([]);
  });
});
