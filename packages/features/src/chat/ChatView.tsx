/**
 * ChatView: the main conversation surface (doc §5 主区).
 * Message stream + tool-call cards + approval cards + composer.
 *
 * @module @dsh-cursorkit/features/chat
 */

import { useRef, useEffect } from 'react';
import type { CkpClient } from '@dsh-cursorkit/client';
import { useSession } from '../hooks.ts';
import {
  ApprovalCard,
  Composer,
  MessageBubble,
  MessageList,
  ThinkingBlock,
  ToolCallCard,
} from '@dsh-cursorkit/ui-kit';

export interface ChatViewProps {
  client: CkpClient;
  sessionId?: string;
}

export function ChatView({ client, sessionId }: ChatViewProps) {
  const { state, send, cancel, respondApproval } = useSession(client, sessionId);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new content.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [state?.messages.length, state?.thinking.length, state?.toolCalls]);

  if (!sessionId || !state) {
    return <div style={styles.placeholder}>选择一个会话开始对话，或新建一个。</div>;
  }

  const running = state.status === 'running' || state.status === 'awaiting-approval';

  return (
    <div style={styles.chat}>
      <div style={styles.stream}>
        <MessageList
          messages={state.messages.filter((m) => m.role !== 'tool')}
          renderMessage={(m) => (
            <MessageBubble
              key={m.id}
              role={m.role === 'user' ? 'user' : 'assistant'}
              text={m.text}
              pending={m.pending}
              error={m.error}
            />
          )}
        />

        {/* thinking blocks */}
        {state.thinking.map((t) => (
          <ThinkingBlock key={t.id} text={t.text} defaultOpen={t.done} />
        ))}

        {/* tool call cards — experience core */}
        {Object.values(state.toolCalls).map((tc) => (
          <ToolCallCard key={tc.callId} call={tc} />
        ))}

        {/* approval cards — experience core */}
        {state.approvals.map((a) => (
          <ApprovalCard
            key={a.id}
            approval={a}
            onRespond={(d) => void respondApproval(a.id, d)}
            countdownMs={a.expiresAt - Date.now()}
          />
        ))}

        {state.status === 'error' && <div style={styles.error}>会话出错（见工具卡片错误详情）</div>}
        {state.status === 'cancelled' && <div style={styles.hint}>已取消</div>}
        <div ref={bottomRef} />
      </div>

      <div style={styles.composerWrap}>
        <Composer
          disabled={!sessionId}
          onSend={(text) => void send(text)}
          placeholder={running ? 'Agent 运行中…' : '输入消息，Enter 发送'}
        />
        {running && (
          <button onClick={() => void cancel()} style={styles.cancelBtn}>
            停止
          </button>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  chat: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 },
  stream: { flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 },
  placeholder: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 14 },
  composerWrap: { padding: '10px 16px', borderTop: '1px solid #e5e7eb', backgroundColor: '#fff', display: 'flex', gap: 8, alignItems: 'center' },
  cancelBtn: { border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#b91c1c', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12.5 },
  error: { color: '#b91c1c', fontSize: 12.5, padding: '6px 10px', backgroundColor: '#fef2f2', borderRadius: 6 },
  hint: { color: '#9ca3af', fontSize: 12.5 },
};
