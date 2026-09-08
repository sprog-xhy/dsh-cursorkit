import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { Message } from '@dsh-cursorkit/protocol';
import { MessageBubble } from './MessageBubble.tsx';

export interface MessageListProps {
  messages: Message[];
  /**
   * Custom per-message renderer (overrides the default MessageBubble).
   * Default maps user/assistant/tool roles onto MessageBubble.
   */
  renderMessage?: (m: Message) => ReactNode;
  className?: string;
}

/**
 * Simple message list — a plain map render with auto-scroll to bottom.
 *
 * NOTE: no virtual scrolling yet. Per the M1 plan this gets replaced by
 * @tanstack/react-virtual once message counts demand it (see docs §8.1 /
 * §8.2: 1000+ messages at 60fps). Keep the API identical when swapping.
 */
export function MessageList({ messages, renderMessage, className }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll on new content. Purely presentational; the "pause follow
  // while user scrolled up" behavior belongs to a future container.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  return (
    <div
      className={className ? `ck-message-list ${className}` : 'ck-message-list'}
      style={{ display: 'flex', flexDirection: 'column' }}
    >
      {messages.map((m) =>
        renderMessage ? (
          <div key={m.id}>{renderMessage(m)}</div>
        ) : (
          <MessageBubble
            key={m.id}
            role={m.role === 'user' ? 'user' : 'assistant'}
            text={m.text}
            pending={m.pending}
            error={m.error ? m.error : undefined}
          />
        ),
      )}
      <div ref={bottomRef} />
    </div>
  );
}
