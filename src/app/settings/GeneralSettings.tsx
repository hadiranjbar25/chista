import { WORKSPACE_STORAGE_KEYS } from '../workspaces/workspaceConfig';
import FullscreenSection from '../../components/FullscreenSection';

export default function GeneralSettings({ setNotice }: { setNotice: (notice: string) => void }) {
  return (
    <>
      <div className="page-heading">
        <div className="view-title">
          <div className="eyebrow">PREFERENCES & PRIVACY</div>
          <h1>Data &amp; privacy</h1>
          <p>See what stays in memory, what is saved, and how to remove it.</p>
        </div>
      </div>
      <FullscreenSection title="Data handling" className="focus-panel">
        <section className="panel settings-list">
          <h2>Data handling</h2>
          <div>
            <strong>Raw artifacts and redaction mappings</strong>
            <span>
              Memory only; scoped to each workspace and shared by its debug sessions. Closing a
              session keeps workspace evidence.
            </span>
          </div>
          <div>
            <strong>Repository names and directory paths</strong>
            <span>
              Saved on this device to restore your repo list. No repository files are read by
              Chista.
            </span>
          </div>
          <div>
            <strong>Chat and context</strong>
            <span>
              Kept in memory unless you explicitly save an encrypted investigation or export a
              reviewed bundle. Sanitization always runs locally.
            </span>
          </div>
          <div>
            <strong>Claude Code</strong>
            <span>
              In-app chat uses the installed CLI with sanitized context and individually approved
              MCP/API tools. Shell and repository file tools are disabled. Each session keeps an
              isolated CLI connection; closing the session releases it.
            </span>
          </div>
          <div>
            <strong>Codex API requests</strong>
            <span>
              Uses local curl after you approve the URL, method, headers, and body. API results are
              sanitized before reaching Codex. Request previews are off by default; tool approvals
              remain required.
            </span>
          </div>
          <div>
            <strong>Sanitization</strong>
            <span>
              Pattern based; review every export and outgoing request. Custom sensitive values and
              encrypted profiles are available in Files & mappings.
            </span>
          </div>
          <div>
            <strong>Provider and MCP credentials</strong>
            <span>
              Chista-managed credentials are stored in the OS credential store. Manage provider
              tokens in Models and connector credentials in Workspace security. Native CLI sign-in
              remains managed by the CLI.
            </span>
          </div>
          <div>
            <strong>Saved investigations and profiles</strong>
            <span>
              Encrypted files are saved only when you choose Save in Files &amp; mappings. Delete
              them using your file manager. Chista does not upload or synchronize them.
            </span>
          </div>
          <button
            onClick={() => {
              try {
                localStorage.removeItem(WORKSPACE_STORAGE_KEYS.repositories);
                localStorage.removeItem(WORKSPACE_STORAGE_KEYS.legacyProjects);
                setNotice(
                  'Saved repository metadata cleared. Current repos remain in memory; further edits save them again.',
                );
              } catch {
                setNotice('Could not clear browser storage.');
              }
            }}
          >
            Forget saved repository metadata
          </button>
        </section>
      </FullscreenSection>
    </>
  );
}
