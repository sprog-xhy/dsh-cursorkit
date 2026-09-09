/**
 * @dsh-cursorkit/features — page-level containers wiring the store (client)
 * to the presentation components (ui-kit).
 */

export { App, type AppProps, type RailTab } from './App.tsx';
export { ChatView, type ChatViewProps } from './chat/ChatView.tsx';
export { SessionsSidebar, type SessionsSidebarProps } from './sessions/SessionsSidebar.tsx';
export { ChangesPanel } from './changes/ChangesPanel.tsx';
export { CheckpointsPanel } from './checkpoints/CheckpointsPanel.tsx';
export { SettingsView, type SettingsTab } from './settings/SettingsView.tsx';
export { buildTrajectory, groupBySource, type TrajectoryItem } from './trajectory/trajectory.ts';
export { bindClient, useCkpClient, useSession, useSessionList, useSessionState } from './hooks.ts';
