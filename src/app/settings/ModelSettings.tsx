import { Terminal } from 'lucide-react';
import FullscreenSection from '../../components/FullscreenSection';
import type { AgentSettings } from './useAgentSettings';

export default function ModelSettings({ settings }: { settings: AgentSettings }) {
  const {
    mode,
    setMode,
    claudePath,
    setClaudePath,
    claudeStatus,
    setClaudeStatus,
    codexPath,
    setCodexPath,
    codexStatus,
    setCodexStatus,
    hosted,
    hostedDraft,
    setHostedDraft,
    modelStatuses,
    checkClaude,
    checkCodex,
    signInClaude,
    configureHosted,
    clearHosted,
  } = settings;
  return (
    <FullscreenSection title="Models & agents" className="focus-page">
      <section className="agent-settings">
        <div className="page-heading">
          <div className="view-title">
            <div className="eyebrow">AGENT SETUP</div>
            <h1>Models & agents</h1>
            <p>Switch between Claude Code, Codex and a hosted provider. No local models.</p>
          </div>
        </div>
        <label className="field">
          Active agent
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="claude">Claude Code · in-app chat</option>
            <option value="codex">Codex · in-app chat</option>
            <option value="hosted" disabled={!hosted.endpoint}>
              Hosted chat provider{!hosted.endpoint ? ' · configure below' : ''}
            </option>
          </select>
        </label>
        <div className="agent-list">
          <details className="agent-setting">
            <summary>
              <Terminal size={16} />
              <span>
                <strong>Claude Code</strong>
                <small>Native sign-in · streaming chat</small>
              </span>
              {mode === 'claude' && <span className="pill">Active</span>}
            </summary>
            <div className="agent-setting-body">
              <label className="field">
                Executable path (optional)
                <input
                  value={claudePath}
                  onChange={(e) => {
                    setClaudePath(e.target.value);
                    setClaudeStatus('Not checked');
                  }}
                  placeholder="Auto-detect, or /absolute/path/to/claude"
                />
              </label>
              <div className="action-row">
                <button onClick={() => void checkClaude()}>Check installation &amp; sign-in</button>
                <button onClick={signInClaude}>Sign in to Claude</button>
              </div>
              <p className="status-text" role="status">
                {claudeStatus}
              </p>
              <p className="muted">
                Sign-in opens automatically when needed. Supports MCP tools and HTTP API requests,
                with approval before each call and sanitized results. MCP servers come from the
                CLI’s user configuration; chat shows connection status and a Sign in button.
              </p>
            </div>
          </details>
          <details className="agent-setting">
            <summary>
              <Terminal size={16} />
              <span>
                <strong>Codex</strong>
                <small>Native sign-in · streaming chat</small>
              </span>
              {mode === 'codex' && <span className="pill">Active</span>}
            </summary>
            <div className="agent-setting-body">
              <label className="field">
                Codex executable path (optional)
                <input
                  value={codexPath}
                  onChange={(e) => {
                    setCodexPath(e.target.value);
                    setCodexStatus('Not checked');
                  }}
                  placeholder="Auto-detect, or /absolute/path/to/codex"
                />
              </label>
              <button onClick={() => void checkCodex()}>Check Codex installation</button>
              <p className="status-text" role="status">
                {codexStatus}
              </p>
              <p className="muted">
                Sign-in opens automatically when needed. Supports MCP tools and HTTP API requests,
                with approval before each call and sanitized results. MCP servers come from the
                CLI’s user configuration; chat shows connection status and a Sign in button.
              </p>
            </div>
          </details>
          <details className="agent-setting">
            <summary>
              <Terminal size={16} />
              <span>
                <strong>Hosted chat provider</strong>
                <small>Connect your own cloud provider</small>
              </span>
              {mode === 'hosted' && <span className="pill">Active</span>}
            </summary>
            <div className="agent-setting-body">
              <p className="muted">Configuration and API token stay in memory for this app run.</p>
              <label className="field">
                HTTPS endpoint
                <input
                  value={hostedDraft.endpoint}
                  onChange={(e) => setHostedDraft((d) => ({ ...d, endpoint: e.target.value }))}
                  placeholder="https://provider.example.com/v1/chat/completions"
                />
              </label>
              <label className="field">
                Model identifier
                <input
                  value={hostedDraft.model}
                  onChange={(e) => setHostedDraft((d) => ({ ...d, model: e.target.value }))}
                />
              </label>
              <label className="field">
                Provider API token · not CLI credentials
                <input
                  type="password"
                  autoComplete="off"
                  value={hostedDraft.token}
                  onChange={(e) => setHostedDraft((d) => ({ ...d, token: e.target.value }))}
                />
              </label>
              <div className="action-row">
                <button onClick={configureHosted}>Use hosted provider</button>
                <button onClick={clearHosted}>Clear</button>
              </div>
              <p className="muted">
                Status:{' '}
                {hosted.endpoint
                  ? (modelStatuses[JSON.stringify([hosted.endpoint, hosted.model])] ??
                    'Configured · access not verified')
                  : 'Not configured'}
              </p>
            </div>
          </details>
        </div>
      </section>
    </FullscreenSection>
  );
}
