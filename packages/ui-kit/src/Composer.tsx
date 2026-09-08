import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { colors, fonts, radii } from './lib/theme.ts';
import { PaperclipIcon } from './lib/icons.tsx';
import { Button } from './primitives/Button.tsx';

export interface ComposerProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

/**
 * Message composer. Multiline textarea that auto-grows; Enter sends,
 * Shift+Enter inserts a newline (IME-composition safe — Enter during Chinese
 * input does not send). Attachment button is a disabled placeholder for the
 * M1 图片/文件 attachment pipeline.
 */
export function Composer({ onSend, disabled = false, placeholder, className }: ComposerProps) {
  const [text, setText] = useState('');
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const canSend = !disabled && text.trim().length > 0;

  const autosize = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  };

  const send = () => {
    const value = text.trim();
    if (!value || disabled) return;
    onSend(value);
    setText('');
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (ta) ta.style.height = 'auto';
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div
      className={className ? `ck-composer ${className}` : 'ck-composer'}
      style={{
        border: `1px solid ${colors.borderStrong}`,
        borderRadius: radii.xl,
        backgroundColor: colors.surface,
        padding: '6px 8px 4px',
        fontFamily: fonts.sans,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
        <button
          type="button"
          disabled
          title="附件（即将支持）"
          aria-label="添加附件（即将支持）"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 30,
            height: 30,
            border: 'none',
            background: 'none',
            borderRadius: radii.md,
            color: colors.textMuted,
            opacity: 0.5,
            cursor: 'not-allowed',
            flexShrink: 0,
            marginBottom: 2,
          }}
        >
          <PaperclipIcon size={16} />
        </button>
        <textarea
          ref={taRef}
          value={text}
          disabled={disabled}
          placeholder={placeholder ?? '输入消息…'}
          rows={1}
          onChange={(e) => {
            setText(e.target.value);
            autosize();
          }}
          onKeyDown={onKeyDown}
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            resize: 'none',
            backgroundColor: 'transparent',
            color: colors.text,
            fontSize: 13.5,
            lineHeight: 1.6,
            maxHeight: 160,
            minHeight: 30,
            padding: '5px 4px',
            fontFamily: fonts.sans,
            opacity: disabled ? 0.6 : 1,
          }}
        />
        <Button
          size="sm"
          disabled={!canSend}
          onClick={send}
          style={{ marginBottom: 2, flexShrink: 0 }}
        >
          发送
        </Button>
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '2px 4px 2px',
          fontSize: 11,
          color: colors.textMuted,
        }}
      >
        <span>/ 命令 · @ 提及</span>
        <span>{text.length > 0 ? `${text.length} 字` : ''}</span>
      </div>
    </div>
  );
}
