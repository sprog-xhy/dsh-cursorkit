import type { CSSProperties } from 'react';
import { colors, fonts, radii } from './lib/theme.ts';
import { Spinner } from './primitives/Spinner.tsx';

export interface MessageBubbleProps {
  role: 'user' | 'assistant';
  text: string;
  /** Streaming in progress — shows a subtle trailing indicator. */
  pending?: boolean;
  /** Error state — red styling + note. Accepts boolean or message string. */
  error?: boolean | string;
  className?: string;
}

/**
 * Chat message bubble. User: right-aligned blue. Assistant: left-aligned
 * white card. Pure presentation — text is rendered verbatim (whitespace
 * preserved); Markdown-aware rendering lives in `Markdown`.
 */
export function MessageBubble({ role, text, pending, error, className }: MessageBubbleProps) {
  const isUser = role === 'user';

  const bubble: CSSProperties = isUser
    ? {
        alignSelf: 'flex-end',
        backgroundColor: colors.blue,
        color: '#fff',
        border: 'none',
        borderBottomRightRadius: 4,
        maxWidth: '82%',
      }
    : {
        alignSelf: 'flex-start',
        backgroundColor: colors.surface,
        color: colors.text,
        border: `1px solid ${colors.border}`,
        borderBottomLeftRadius: 4,
        maxWidth: '92%',
      };

  const container: CSSProperties = {
    display: 'flex',
    width: '100%',
    marginBottom: 10,
  };

  return (
    <div
      className={className ? `ck-msg-${role} ${className}` : `ck-msg-${role}`}
      style={isUser ? { ...container, justifyContent: 'flex-end' } : container}
    >
      <div
        style={{
          ...bubble,
          padding: '8px 12px',
          borderRadius: radii.lg,
          fontSize: 13.5,
          lineHeight: 1.65,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          opacity: error ? 1 : pending ? 0.75 : 1,
          boxShadow: 'none',
          fontFamily: fonts.sans,
          ...(error
            ? {
                borderColor: colors.redBorder,
                backgroundColor: isUser ? colors.red : colors.redSoft,
                color: isUser ? '#fff' : colors.redDark,
              }
            : null),
        }}
      >
        {text}
        {pending && !error && (
          <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 6, verticalAlign: 'middle' }}>
            <Spinner size={10} color={isUser ? '#ffffff' : colors.blue} />
          </span>
        )}
        {error && (
          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              fontStyle: 'italic',
              color: isUser ? '#fecaca' : colors.redDark,
            }}
          >
            {typeof error === 'string' ? error : '发送失败'}
          </div>
        )}
      </div>
    </div>
  );
}
