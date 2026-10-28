import { isTauri } from '@tauri-apps/api/core';
import { Plus, Settings, ShieldCheck } from 'lucide-react';
import SessionNavItem from './sessions/SessionNavItem';
import WorkspaceSwitcher from './workspaces/WorkspaceSwitcher';
import type { Session, Workspace } from './workspaces/workspace';

type Props = {
  workspaces: Workspace[];
  workspace: Workspace;
  workspaceSessions: Session[];
  sessionId: string;
  selectWorkspace: (id: string) => void;
  createWorkspace: (name: string) => void;
  addSession: () => void;
  onOpenChat: () => void;
  onConfigure: () => void;
  onSettings: () => void;
  onSelectSession: (id: string) => void;
  onRenameSession: (id: string, name: string) => void;
};

export default function AppSidebar({
  workspaces,
  workspace,
  workspaceSessions,
  sessionId,
  selectWorkspace,
  createWorkspace,
  addSession,
  onOpenChat,
  onConfigure,
  onSettings,
  onSelectSession,
  onRenameSession,
}: Props) {
  return (
    <aside className="ide-nav">
      <div className="sidebar-brand">
        <a className="brand" href="#" onClick={onOpenChat}>
          <span className="brand-mark">✳</span> chista
        </a>
      </div>
      <WorkspaceSwitcher
        workspaces={workspaces}
        selected={workspace}
        onSelect={selectWorkspace}
        onConfigure={onConfigure}
        onCreate={createWorkspace}
      />
      <button className="new-chat" onClick={addSession}>
        <Plus size={15} /> New session
      </button>
      <div className="nav-label">DEBUG SESSIONS</div>
      <div className="session-nav">
        {workspaceSessions.map((s) => (
          <SessionNavItem
            key={s.id}
            session={s}
            selected={s.id === sessionId}
            onSelect={() => onSelectSession(s.id)}
            onRename={(name) => onRenameSession(s.id, name)}
          />
        ))}
      </div>
      <div className="sidebar-footer">
        <div className="sidebar-global-actions">
          <button aria-label="Settings" title="Settings" onClick={onSettings}>
            <Settings size={16} />
            Settings
          </button>
        </div>
        <div className="ide-privacy">
          <ShieldCheck size={20} />
          <strong>Safe Debug Sessions</strong>
          <p>Raw artifacts stay local. Only reviewed snapshots reach your chat.</p>
          <span>{isTauri() ? 'Desktop workspace' : 'Browser · local file review only'}</span>
        </div>
      </div>
    </aside>
  );
}
