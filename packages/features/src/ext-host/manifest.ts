/**
 * UI contribution manifest types (M5 T-052, contract fixed in GOAL §7).
 *
 * dsh plugins declare contributions via `ctx.cursorkit.ui.contribute(...)`;
 * the host aggregates them into a manifest served at `/v1/ui-contrib`. The
 * front-end `ext-host` dynamically imports the entry modules (ESM).
 *
 * MVP: renderers + commands only (doc §7: "MVP 只实现 renderers + commands").
 *
 * @module @dsh-cursorkit/features/ext-host
 */

export interface UiPanelContribution {
  id: string;
  title: string;
  icon?: string;
  mount: 'sidebar' | 'main' | 'rail';
  entry: string; // ESM module URL (relative to host)
}

export interface ToolRendererContribution {
  tool: string; // tool name, e.g. 'str_replace_editor'
  entry: string;
}

export interface SettingsContribution {
  id: string;
  title: string;
  entry: string;
}

export interface CommandContribution {
  id: string;
  title: string;
  keybinding?: string;
}

export interface StatusContribution {
  id: string;
  align: 'left' | 'right';
  entry: string;
}

export interface UiContribManifest {
  panels: UiPanelContribution[];
  renderers: ToolRendererContribution[];
  settings: SettingsContribution[];
  commands: CommandContribution[];
  status: StatusContribution[];
}

export const EMPTY_MANIFEST: UiContribManifest = {
  panels: [],
  renderers: [],
  settings: [],
  commands: [],
  status: [],
};

/** Fetch the contribution manifest from the host. */
export async function fetchUiContrib(baseUrl: string, token: string): Promise<UiContribManifest> {
  try {
    const res = await fetch(`${baseUrl}/v1/ui-contrib`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return EMPTY_MANIFEST;
    return (await res.json()) as UiContribManifest;
  } catch {
    return EMPTY_MANIFEST;
  }
}

/** Build the command palette entries from a manifest. */
export function manifestToCommands(manifest: UiContribManifest): Array<{ id: string; title: string; group: string }> {
  return manifest.commands.map((c) => ({
    id: c.id,
    title: c.title,
    group: '插件命令',
    ...(c.keybinding ? { keybinding: c.keybinding } : {}),
  }));
}
