/**
 * Command palette controller (M3 T-043): Cmd+K global shortcut, command list
 * construction from app actions + sessions + manifest commands.
 *
 * @module @dsh-cursorkit/features/commands
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CkpClient } from '@dsh-cursorkit/client';
import type { CommandPaletteCommand } from '@dsh-cursorkit/ui-kit';
import { useSessionList } from '../hooks.ts';

export interface CommandActions {
  newSession: () => void;
  openSettings: () => void;
  openParallel: () => void;
  selectSession: (id: string) => void;
  /** Extra commands (e.g. from the ext-host manifest). */
  extraCommands?: CommandPaletteCommand[];
}

export interface CommandPaletteController {
  open: boolean;
  setOpen: (v: boolean) => void;
  commands: CommandPaletteCommand[];
  sessions: ReturnType<typeof useSessionList>['sessions'];
}

/**
 * Wire the command palette: listens for Cmd+K / Ctrl+K and builds the command
 * list from the app's actions, live sessions, and plugin contributions.
 */
export function useCommandPalette(client: CkpClient, actions: CommandActions): CommandPaletteController {
  const [open, setOpen] = useState(false);
  const { sessions } = useSessionList(client, 5000);

  // Global shortcut: Cmd+K / Ctrl+K toggles.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const commands: CommandPaletteCommand[] = useMemo(() => {
    const list: CommandPaletteCommand[] = [
      { id: 'new-session', title: '新建会话', group: '操作', run: actions.newSession },
      { id: 'open-settings', title: '打开设置', group: '操作', run: actions.openSettings },
      { id: 'open-parallel', title: '并行会话（best-of-n）', group: '操作', run: actions.openParallel },
      ...(actions.extraCommands ?? []),
    ];
    return list;
  }, [actions.newSession, actions.openSettings, actions.openParallel, actions.extraCommands]);

  const selectSession = useCallback(
    (id: string) => {
      actions.selectSession(id);
      setOpen(false);
    },
    [actions.selectSession],
  );
  void selectSession;

  return { open, setOpen, commands, sessions };
}
