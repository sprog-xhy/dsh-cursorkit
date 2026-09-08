import { useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@dsh-cursorkit/protocol';
import { colors, fonts, radii } from './lib/theme.ts';
import { formatRelativeTime } from './lib/format.ts';

export interface CommandPaletteCommand {
  id: string;
  title: string;
  group?: string;
  run: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: CommandPaletteCommand[];
  /** Optional sessions shown as a "会话" group (activate = close the palette). */
  sessions?: Session[];
  className?: string;
}

interface Entry {
  key: string;
  title: string;
  group: string;
  kind: 'command' | 'session';
  run: () => void;
  /** For session entries: relative time label. */
  meta?: string;
}

const MAX_VISIBLE = 50;

/**
 * Command palette: modal overlay + filter input + keyboard navigation
 * (↑/↓ select, Enter run, Esc close). Pure presentation — command actions
 * come from props.
 */
export function CommandPalette({ open, onClose, commands, sessions = [], className }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const entries: Entry[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: Entry[] = [];
    const visible: Array<{ title: string; group: string; id: string; kind: 'command' | 'session'; meta?: string; run: () => void }> = [];

    for (const c of commands) {
      if (!q || c.title.toLowerCase().includes(q)) {
        visible.push({ title: c.title, group: c.group ?? '命令', id: c.id, kind: 'command', run: c.run });
      }
    }
    for (const s of sessions) {
      const hay = `${s.summary ?? ''} ${s.id}`.toLowerCase();
      if (!q || hay.includes(q)) {
        visible.push({
          title: s.summary && s.summary.length > 0 ? s.summary : `会话 ${s.id.slice(0, 8)}`,
          group: '会话',
          id: s.id,
          kind: 'session',
          meta: formatRelativeTime(s.updatedAt),
          run: () => undefined, // selecting a session just closes; wiring is caller-side
        });
      }
    }

    let lastGroup: string | null = null;
    for (const v of visible.slice(0, MAX_VISIBLE)) {
      if (v.group !== lastGroup) {
        out.push({ key: `g:${v.group}`, title: '', group: v.group, kind: 'command', run: () => undefined });
        lastGroup = v.group;
      }
      out.push({
        key: `${v.kind}:${v.id}`,
        title: v.title,
        group: v.group,
        kind: v.kind,
        meta: v.meta,
        run: v.run,
      });
    }
    return out;
  }, [commands, sessions, query]);

  // Reset selection whenever the filtered set changes.
  useEffect(() => setSelected(0), [query, entries.length]);

  // Autofocus input when opened.
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      inputRef.current?.focus();
    }
  }, [open]);

  // Keep the selected row visible.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector(`[data-index="${selected}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  // Global keyboard handling while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, entries.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const entry = entries[selected];
        if (entry) {
          entry.run();
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, entries, selected, onClose]);

  if (!open) return null;

  return (
    <div
      className={className ? `ck-palette ${className}` : 'ck-palette'}
      role="dialog"
      aria-modal="true"
      aria-label="命令面板"
      onMouseDown={(e) => {
        // Click on the backdrop closes the palette.
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        backgroundColor: 'rgba(24, 24, 27, 0.4)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingTop: '16vh',
        fontFamily: fonts.sans,
      }}
    >
      <div
        style={{
          width: 560,
          maxWidth: '92vw',
          backgroundColor: colors.surface,
          borderRadius: radii.xl,
          boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
          overflow: 'hidden',
          border: `1px solid ${colors.border}`,
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="输入命令或搜索会话…"
          style={{
            width: '100%',
            border: 'none',
            outline: 'none',
            padding: '12px 14px',
            fontSize: 14,
            color: colors.text,
            backgroundColor: colors.surface,
            borderBottom: `1px solid ${colors.border}`,
            fontFamily: fonts.sans,
          }}
        />
        <div ref={listRef} style={{ maxHeight: 340, overflowY: 'auto', padding: '4px 0' }}>
          {entries.length === 0 && (
            <div style={{ padding: '18px 14px', textAlign: 'center', color: colors.textMuted, fontSize: 12.5 }}>
              无匹配命令
            </div>
          )}
          {entries.map((entry, i) => {
            const isGroup = entry.title === '';
            const active = i === selected;
            return (
              <div
                key={entry.key}
                data-index={i}
                role="button"
                tabIndex={-1}
                onMouseEnter={() => setSelected(i)}
                onClick={() => {
                  entry.run();
                  onClose();
                }}
                style={{
                  padding: isGroup ? '8px 14px 3px' : '7px 14px',
                  fontSize: isGroup ? 10.5 : 13,
                  fontWeight: isGroup ? 600 : 400,
                  letterSpacing: isGroup ? 0.4 : 0,
                  textTransform: isGroup ? 'uppercase' : 'none',
                  color: isGroup ? colors.textMuted : active ? colors.blueDark : colors.text,
                  backgroundColor: active ? colors.blueSoft : 'transparent',
                  cursor: isGroup ? 'default' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                {isGroup ? (
                  entry.group
                ) : (
                  <>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {entry.title}
                    </span>
                    {entry.meta && (
                      <span style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.mono, whiteSpace: 'nowrap' }}>
                        {entry.meta}
                      </span>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
