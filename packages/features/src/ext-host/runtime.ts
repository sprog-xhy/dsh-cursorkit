/**
 * Ext-host runtime (M5 T-052): dynamically load plugin UI contributions.
 *
 * Given a UiContribManifest, resolves each `entry` (ESM module URL) via
 * dynamic import and exposes the loaded renderers/commands. Entries that
 * fail to load are skipped with a warning — one bad plugin must not break
 * the app (doc P5: fail loud but contained).
 *
 * Pure browser/runtime module — no React required for the loader itself.
 *
 * @module @dsh-cursorkit/features/ext-host/runtime
 */

import type { UiContribManifest, ToolRendererContribution, CommandContribution } from './manifest.ts';

export interface LoadedRenderer {
  tool: string;
  /** Module's default export or a `render` export. */
  entry: unknown;
}

export interface LoadedCommand {
  id: string;
  title: string;
  keybinding?: string;
  /** Module's default export or a `run` export. */
  entry: unknown;
}

export interface ExtHostRuntime {
  renderers: LoadedRenderer[];
  commands: LoadedCommand[];
  failed: Array<{ id: string; error: string }>;
}

/** Import a module, preferring default export, then named, then module ns. */
async function importEntry<T>(url: string): Promise<T | undefined> {
  const mod = (await import(/* @vite-ignore */ url)) as Record<string, unknown> & { default?: unknown };
  if (mod.default !== undefined && mod.default !== null) return mod.default as T;
  if (mod.render !== undefined) return mod.render as T;
  if (mod.run !== undefined) return mod.run as T;
  return mod as T;
}

/**
 * Load every renderer and command from a manifest. Entries are resolved
 * concurrently; failures are collected, never thrown.
 */
export async function loadExtHost(manifest: UiContribManifest): Promise<ExtHostRuntime> {
  const renderers: LoadedRenderer[] = [];
  const commands: LoadedCommand[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  const rendererJobs = manifest.renderers.map(async (r: ToolRendererContribution) => {
    try {
      const entry = await importEntry(r.entry);
      if (entry !== undefined) renderers.push({ tool: r.tool, entry });
      else failed.push({ id: `renderer:${r.tool}`, error: 'module resolved but exported nothing usable' });
    } catch (err) {
      failed.push({ id: `renderer:${r.tool}`, error: err instanceof Error ? err.message : String(err) });
    }
  });

  const commandJobs = manifest.commands.map(async (c: CommandContribution) => {
    try {
      if (!c.entry) {
        // Documented contract: commands may be manifest-only (front-end
        // provides run via renderers); record without a module.
        commands.push({ id: c.id, title: c.title, keybinding: c.keybinding, entry: undefined });
        return;
      }
      const entry = await importEntry(c.entry);
      if (entry !== undefined) commands.push({ id: c.id, title: c.title, keybinding: c.keybinding, entry });
      else failed.push({ id: `command:${c.id}`, error: 'module resolved but exported nothing usable' });
    } catch (err) {
      failed.push({ id: `command:${c.id}`, error: err instanceof Error ? err.message : String(err) });
    }
  });

  await Promise.all([...rendererJobs, ...commandJobs]);
  return { renderers, commands, failed };
}
