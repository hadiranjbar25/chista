import { useEffect, useRef, useState } from 'react';
import { Cpu, Settings } from 'lucide-react';
import AppSidebar from './AppSidebar';
import SessionToolbar from './sessions/SessionToolbar';
import SafeSession, { type SafeSessionHandle } from '../evidence/SafeSession';
import AgentChat from '../chat/AgentChat';
import { Sanitizer } from '../evidence/safety';
import type { EvidenceSource } from '../evidence/investigation';
import FullscreenSection, { exitSectionFullscreen } from '../components/FullscreenSection';
import { useWorkspaceCatalog } from './workspaces/useWorkspaceCatalog';
import { useAgentSettings } from './settings/useAgentSettings';
import ModelSettings from './settings/ModelSettings';
import GeneralSettings from './settings/GeneralSettings';
import {
  newWorkspace,
  newSession,
  renameSession,
  workspaceRepositories,
  type Session,
  type ChatAttachments,
} from './workspaces/workspace';
import WorkspaceSettings from './workspaces/WorkspaceSettings';
import '../styles/workspace.css';
type Route = 'Workspace config' | 'Sessions' | 'Artifacts' | 'Settings';
export default function App() {
  const workspaceSanitizers = useRef(new Map<string, Sanitizer>());
  const [toolEvidence, setToolEvidence] = useState<Record<string, EvidenceSource[]>>({});
  function sanitizerFor(id: string) {
    let value = workspaceSanitizers.current.get(id);
    if (!value) {
      value = new Sanitizer();
      workspaceSanitizers.current.set(id, value);
    }
    return value;
  }
  const filePickers = useRef(new Map<string, SafeSessionHandle>());
  const [notice, setNotice] = useState('');
  const {
    repositories,
    workspaces,
    setWorkspaces,
    workspaceId,
    setWorkspaceId,
    pickingRepository,
    addRepository,
    toggleRepository,
    removeRepository,
  } = useWorkspaceCatalog(setNotice);
  const [sessions, setSessions] = useState<Session[]>(() =>
    workspaces.map((w) => newSession('Debug session 1', w.id)),
  );

  const [sessionId, setSessionId] = useState(() => sessions[0].id);
  const [route, setRoute] = useState<Route>('Sessions');
  const [sessionTab, setSessionTab] = useState<'safe' | 'chat'>('chat');
  const [settingsPage, setSettingsPage] = useState<'General' | 'Models'>('General');
  useEffect(
    () => exitSectionFullscreen(),
    [route, sessionId, workspaceId, sessionTab, settingsPage],
  );
  const [attachments, setAttachments] = useState<Record<string, ChatAttachments>>({});
  const [contexts, setContexts] = useState<Record<string, string | null>>({});
  const agentSettings = useAgentSettings(setNotice);
  const {
    mode,
    setMode,
    claudePath,
    codexPath,
    hosted,
    setModelStatuses,
    claudeModel,
    setClaudeModel,
    codexModel,
    setCodexModel,
    modelCatalogs,
    loadModels,
  } = agentSettings;
  const workspace = workspaces.find((w) => w.id === workspaceId)!;
  const workspaceSessions = sessions.filter((s) => s.workspaceId === workspaceId);
  function selectWorkspace(id: string) {
    setWorkspaceId(id);
    setSessionId(sessions.find((s) => s.workspaceId === id)!.id);
    setRoute('Sessions');
    setSessionTab('chat');
  }
  function createWorkspace(workspaceName: string) {
    if (!workspaceName.trim()) return;
    const w = newWorkspace(workspaceName);
    const s = newSession('Debug session 1', w.id);
    setWorkspaces((all) => [...all, w]);
    setSessions((all) => [...all, s]);
    setWorkspaceId(w.id);
    setSessionId(s.id);
    setRoute('Sessions');
    setSessionTab('chat');
  }
  const session = sessions.find((s) => s.id === sessionId)!;
  function addSession() {
    const s = newSession(
      `Debug session ${Math.max(0, ...workspaceSessions.map((s) => Number(s.name.match(/\d+$/)?.[0]) || 0)) + 1}`,
      workspaceId,
    );
    setSessions((all) => [...all, s]);
    setSessionId(s.id);
    setSessionTab('chat');
    setRoute('Sessions');
  }
  function removeSession() {
    const remaining = workspaceSessions.filter((item) => item.id !== sessionId);
    const next = remaining[0] ?? newSession('Debug session 1', workspaceId);
    setSessions((all) => {
      const kept = all.filter((item) => item.id !== sessionId);
      return remaining.length ? kept : [...kept, next];
    });
    setSessionId(next.id);
    setSessionTab('chat');
    setRoute('Sessions');
    setNotice(
      remaining.length
        ? 'Session removed. Workspace files were kept.'
        : 'Session removed. Started a fresh session. Workspace files were kept.',
    );
  }
  return (
    <div className="ide">
      <AppSidebar
        workspaces={workspaces}
        workspace={workspace}
        workspaceSessions={workspaceSessions}
        sessionId={sessionId}
        selectWorkspace={selectWorkspace}
        createWorkspace={createWorkspace}
        addSession={addSession}
        onOpenChat={() => {
          setRoute('Sessions');
          setSessionTab('chat');
        }}
        onConfigure={() => setRoute('Workspace config')}
        onSettings={() => setRoute('Settings')}
        onSelectSession={(id) => {
          setSessionId(id);
          setRoute('Sessions');
          setSessionTab('chat');
        }}
        onRenameSession={(id, name) =>
          setSessions((all) =>
            all.map((item) => (item.id === id ? renameSession(item, name, 'user') : item)),
          )
        }
      />
      <div className="ide-body">
        <header className="ide-header">
          <div>
            {workspace.name}
            <span>/</span>
            {route}
            {route === 'Settings' && (
              <>
                <span>/</span>
                {settingsPage}
              </>
            )}
            {session && ['Sessions', 'Artifacts'].includes(route) && (
              <>
                <span>/</span>
                {session.name}
              </>
            )}
          </div>
        </header>
        <div className="ide-content">
          {notice && (
            <div className="notice" role="status">
              {notice}
              <button onClick={() => setNotice('')}>Dismiss</button>
            </div>
          )}
          {route === 'Workspace config' && (
            <WorkspaceSettings
              workspace={workspace}
              workspaces={workspaces}
              repositories={repositories}
              pickingRepository={pickingRepository}
              addRepository={addRepository}
              toggleRepository={toggleRepository}
              removeRepository={removeRepository}
            />
          )}
          {['Sessions', 'Artifacts'].includes(route) && (
            <SessionToolbar
              key={sessionId + sessionTab}
              sessionName={session.name}
              showingFiles={sessionTab === 'safe'}
              onRemove={removeSession}
              onFiles={() => {
                setSessionTab('safe');
                setRoute('Sessions');
              }}
            />
          )}
          {/* One local evidence store per workspace; each debug chat keeps its own history. */}
          {workspaces.map((w) => (
            <div
              key={w.id}
              className="embedded-safe"
              hidden={
                w.id !== workspaceId ||
                !(route === 'Artifacts' || (route === 'Sessions' && sessionTab === 'safe'))
              }
            >
              <FullscreenSection title="Files & mappings">
                <SafeSession
                  sharedSanitizer={sanitizerFor(w.id)}
                  extraEvidence={toolEvidence[w.id] ?? []}
                  ref={(handle) => {
                    if (handle) filePickers.current.set(w.id, handle);
                    else filePickers.current.delete(w.id);
                  }}
                  onAttachments={(value) =>
                    setAttachments((all) =>
                      JSON.stringify(all[w.id]) === JSON.stringify(value)
                        ? all
                        : { ...all, [w.id]: value },
                    )
                  }
                  onOpenChat={() => {
                    setWorkspaceId(w.id);
                    setRoute('Sessions');
                    setSessionTab('chat');
                  }}
                  onContext={(value) =>
                    setContexts((all) => (all[w.id] === value ? all : { ...all, [w.id]: value }))
                  }
                />
              </FullscreenSection>
            </div>
          ))}
          {sessions.map((s) => {
            const w = workspaces.find((w) => w.id === s.workspaceId)!;
            const included = workspaceRepositories(w, repositories);
            const active = s.id === sessionId && w.id === workspaceId;
            return (
              <div key={s.id} hidden={!active || route !== 'Sessions' || sessionTab !== 'chat'}>
                <FullscreenSection title="Agent chat" className="focus-chat">
                  <AgentChat
                    sharedSanitizer={sanitizerFor(w.id)}
                    onEvidence={(source) =>
                      setToolEvidence((all) => ({ ...all, [w.id]: [...(all[w.id] ?? []), source] }))
                    }
                    onSessionTitle={(name) =>
                      setSessions((all) =>
                        all.map((item) =>
                          item.id === s.id ? renameSession(item, name, 'agent') : item,
                        ),
                      )
                    }
                    active={active && route === 'Sessions' && sessionTab === 'chat'}
                    onAddFiles={() => filePickers.current.get(w.id)?.openFilePicker()}
                    onFiles={() => {
                      setRoute('Sessions');
                      setSessionTab('safe');
                    }}
                    repositories={included}
                    context={attachments[w.id]?.context ?? contexts[w.id] ?? null}
                    attachments={attachments[w.id]}
                    onRemoveAttachment={(id) => filePickers.current.get(w.id)?.removeAttachment(id)}
                    mode={mode}
                    hosted={hosted}
                    model={mode === 'claude' ? claudeModel : codexModel}
                    modelCatalog={mode === 'claude' ? modelCatalogs.claude : modelCatalogs.codex}
                    onModelChange={mode === 'claude' ? setClaudeModel : setCodexModel}
                    onLoadModels={(refresh) => {
                      if (mode === 'claude' || mode === 'codex') void loadModels(mode, refresh);
                    }}
                    claudePath={claudePath}
                    codexPath={codexPath}
                    onAgentChange={setMode}
                    onModelStatus={(key, status) =>
                      setModelStatuses((all) => ({ ...all, [key]: status }))
                    }
                  />
                </FullscreenSection>
              </div>
            );
          })}
          {route === 'Settings' && (
            <nav className="session-tabs" aria-label="Settings sections">
              {(
                [
                  { name: 'General', icon: Settings },
                  { name: 'Models', icon: Cpu },
                ] as const
              ).map(({ name, icon: Icon }) => (
                <button
                  key={name}
                  aria-label={name}
                  aria-current={settingsPage === name ? 'page' : undefined}
                  className={settingsPage === name ? 'active' : ''}
                  onClick={() => {
                    setSettingsPage(name);
                    setNotice('');
                  }}
                >
                  <Icon size={15} />
                  {name}
                </button>
              ))}
            </nav>
          )}
          {route === 'Settings' && settingsPage === 'Models' && (
            <ModelSettings settings={agentSettings} />
          )}
          {route === 'Settings' && settingsPage === 'General' && (
            <GeneralSettings setNotice={setNotice} />
          )}
        </div>
      </div>
    </div>
  );
}
