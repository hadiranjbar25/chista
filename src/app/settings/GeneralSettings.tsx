import { WORKSPACE_STORAGE_KEYS } from '../workspaces/workspaceConfig';
import FullscreenSection from '../../components/FullscreenSection';

export default function GeneralSettings({ setNotice }: { setNotice: (notice: string) => void }) {
  return (
    <>
      <div className="page-heading">
        <div className="view-title">
          <div className="eyebrow">PREFERENCES & PRIVACY</div>
          <h1>Settings</h1>
          <p>Clear boundaries for your debugging workspace.</p>
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
            <strong>Chat, context and integration tokens</strong>
            <span>
              Memory only. Review before sending is optional; sanitization always runs locally.
            </span>
          </div>
          <div>
            <strong>Claude Code</strong>
            <span>
              In-app chat uses the installed CLI with tools disabled and sanitized context only.
              Each session keeps an isolated CLI connection; closing the session releases it.
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
              Pattern based; review every export and outgoing request. Custom sensitive values can
              be added in Safe Debug.
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
