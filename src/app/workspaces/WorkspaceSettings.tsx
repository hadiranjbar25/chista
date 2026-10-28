import { FolderOpen } from 'lucide-react';
import FullscreenSection from '../../components/FullscreenSection';
import type { Repository, Workspace } from './workspace';

type Props = {
  workspace: Workspace;
  workspaces: Workspace[];
  repositories: Repository[];
  pickingRepository: boolean;
  addRepository: () => Promise<void>;
  toggleRepository: (id: string) => void;
  removeRepository: (id: string) => void;
};

export default function WorkspaceSettings({
  workspace,
  workspaces,
  repositories,
  pickingRepository,
  addRepository,
  toggleRepository,
  removeRepository,
}: Props) {
  return (
    <>
      <div className="page-heading">
        <div className="view-title">
          <div className="eyebrow">WORKSPACE</div>
          <h1>Workspace configuration</h1>
          <p>
            Choose repos for {workspace.name}. All debug sessions in this workspace use these repos.
          </p>
        </div>
      </div>
      <div className="management-grid">
        <FullscreenSection title="Workspace repositories" className="focus-panel">
          <section className="panel">
            <h2>Included repositories · {workspace.repoIds.length}</h2>
            {!repositories.length && <p className="empty">No repositories registered yet.</p>}
            {repositories.map((repo) => (
              <div className="repo-entry" key={repo.id}>
                <label className="repo-membership">
                  <input
                    type="checkbox"
                    aria-label={`${repo.name} ${repo.path}`}
                    checked={workspace.repoIds.includes(repo.id)}
                    onChange={() => toggleRepository(repo.id)}
                  />
                  Include in {workspace.name}
                </label>
                <div className="repository-location">
                  <strong>{repo.name}</strong>
                  <small>{repo.path}</small>
                </div>
                <span className="muted">
                  Included in {workspaces.filter((w) => w.repoIds.includes(repo.id)).length}{' '}
                  workspace(s)
                </span>
                <button onClick={() => removeRepository(repo.id)}>Remove repo</button>
              </div>
            ))}
          </section>
        </FullscreenSection>
        <FullscreenSection title="Add a repository" className="focus-panel">
          <section className="panel">
            <h2>Add a repository</h2>
            <p>Select its folder. The folder name becomes the repository name.</p>
            <button
              className="primary"
              disabled={pickingRepository}
              onClick={() => void addRepository()}
            >
              <FolderOpen size={16} />
              {pickingRepository ? 'Choosing folder…' : 'Choose folder'}
            </button>
            <p className="muted">
              Register an existing local checkout for this workspace. Chista does not clone or
              upload repository files.
            </p>
          </section>
        </FullscreenSection>
      </div>
    </>
  );
}
