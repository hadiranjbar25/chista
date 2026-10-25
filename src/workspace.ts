export type Repository = { id: string; name: string; path: string };
export type Workspace = { id: string; name: string; repoIds: string[] };
export type Session = { id: string; workspaceId: string; name: string; nameSource?: 'agent' | 'user' };
export const newSession = (name: string, workspaceId = 'default'): Session => ({ id: crypto.randomUUID(), workspaceId, name });
export const newWorkspace = (name: string): Workspace => ({ id: crypto.randomUUID(), name: name.trim().slice(0,60), repoIds: [] });
export function workspaceRepositories(workspace: Workspace, repositories: Repository[]) {
  return repositories.filter(repo => workspace.repoIds.includes(repo.id));
}
export function loadWorkspaces(repositories: Repository[]): Workspace[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem('chista.workspaces.v1') ?? 'null');
    if (Array.isArray(saved)) {
      const seen=new Set<string>();
      const valid=saved.filter((w): w is Workspace => {
        if(!w || typeof w.id!=='string' || !w.id || seen.has(w.id) || typeof w.name!=='string' || !w.name.trim() || !Array.isArray(w.repoIds) || !w.repoIds.every((id: unknown)=>typeof id==='string')) return false;
        seen.add(w.id);return true;
      }).map(w=>({...w,repoIds:w.repoIds.filter(id=>repositories.some(r=>r.id===id))}));
      if(valid.length) return valid;
    }
  } catch { /* Recover with the existing repo catalog. */ }
  return [newWorkspace('My workspace')];
}
// Migrate saved project metadata without persisting artifacts, chat or credentials.
export function loadRepositories(): Repository[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem('chista.repositories.v1') ?? localStorage.getItem('chista.projects.v1') ?? '[]');
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.filter((repo): repo is Repository => {
      if (!repo || typeof repo.id !== 'string' || typeof repo.name !== 'string' || typeof repo.path !== 'string' || seen.has(repo.id)) return false;
      seen.add(repo.id); return true;
    });
  } catch { return []; }
}

export function renameSession(session: Session, name: string, source: 'agent' | 'user'): Session {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!clean || (source === 'agent' && session.nameSource)) return session;
  return { ...session, name: clean, nameSource: source };
}

// Local display metadata plus sanitized context only; never raw artifact contents.
export type ChatAttachments = {
  files: { id: string; name: string; redactions: number }[];
  context: string | null;
  busy: boolean;
  error: string;
};
