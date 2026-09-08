/**
 * @dsh-cursorkit/ui-kit — pure-presentation React components for the
 * dsh-cursorkit desktop client.
 *
 * No business logic, no store wiring, no external UI dependencies: every
 * component renders from props only.
 */

export * from './primitives/index.ts';

export * from './MessageBubble.tsx';
export * from './Markdown.tsx';
export * from './ThinkingBlock.tsx';
export * from './ToolCallCard.tsx';
export * from './ApprovalCard.tsx';
export * from './DiffView.tsx';
export * from './FileChangeList.tsx';
export * from './CheckpointTimeline.tsx';
export * from './TrajectoryPanel.tsx';
export * from './SessionList.tsx';
export * from './Composer.tsx';
export * from './StatusBar.tsx';
export * from './MessageList.tsx';
export * from './CommandPalette.tsx';
export * from './ErrorBoundary.tsx';

export * from './lib/diff-parse.ts';
export * from './lib/format.ts';
