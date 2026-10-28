import { WORKSPACE_STORAGE_KEYS } from './workspaceConfig';
import { useEffect, useState } from 'react';
import { selectRepositoryFolder } from '../../integrations/repositories';
import { loadRepositories, loadWorkspaces, type Repository } from './workspace';

export function useWorkspaceCatalog(setNotice: (notice: string) => void) {
  const [repositories, setRepositories] = useState<Repository[]>(loadRepositories);
  const [workspaces, setWorkspaces] = useState(() => loadWorkspaces(repositories));
  const [pickingRepository, setPickingRepository] = useState(false);
  const [workspaceId, setWorkspaceId] = useState(() => workspaces[0].id);
  useEffect(() => {
    try {
      localStorage.setItem(WORKSPACE_STORAGE_KEYS.repositories, JSON.stringify(repositories));
      localStorage.removeItem(WORKSPACE_STORAGE_KEYS.legacyProjects);
    } catch {
      setNotice('Repository metadata could not be saved. This workspace remains usable in memory.');
    }
  }, [repositories, setNotice]);
  useEffect(() => {
    try {
      localStorage.setItem(WORKSPACE_STORAGE_KEYS.workspaces, JSON.stringify(workspaces));
    } catch {
      setNotice('Workspace metadata could not be saved.');
    }
  }, [workspaces, setNotice]);
  async function addRepository() {
    if (pickingRepository) return;
    setPickingRepository(true);
    try {
      const selected = await selectRepositoryFolder();
      if (!selected) return;
      const existing = repositories.find((repo) => repo.path === selected.path);
      const repo = existing ?? { id: crypto.randomUUID(), ...selected };
      if (!existing) setRepositories((all) => [...all, repo]);
      setWorkspaces((all) =>
        all.map((w) =>
          w.id === workspaceId && !w.repoIds.includes(repo.id)
            ? { ...w, repoIds: [...w.repoIds, repo.id] }
            : w,
        ),
      );
      setNotice('Repository added to this workspace.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not select the repository folder.');
    } finally {
      setPickingRepository(false);
    }
  }
  function toggleRepository(repoId: string) {
    setWorkspaces((all) =>
      all.map((w) =>
        w.id === workspaceId
          ? {
              ...w,
              repoIds: w.repoIds.includes(repoId)
                ? w.repoIds.filter((id) => id !== repoId)
                : [...w.repoIds, repoId],
            }
          : w,
      ),
    );
  }
  function removeRepository(repoId: string) {
    setRepositories((all) => all.filter((r) => r.id !== repoId));
    setWorkspaces((all) =>
      all.map((w) => ({ ...w, repoIds: w.repoIds.filter((id) => id !== repoId) })),
    );
  }
  return {
    repositories,
    workspaces,
    setWorkspaces,
    workspaceId,
    setWorkspaceId,
    pickingRepository,
    addRepository,
    toggleRepository,
    removeRepository,
  };
}
