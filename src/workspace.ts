export type Repository = { id: string; name: string; path: string };
export type Session = { id: string; repoIds: string[]; name: string; nameSource?: 'agent' | 'user' };
export const newSession = (name: string): Session => ({ id: crypto.randomUUID(), repoIds: [], name });
export function sessionRepositories(session: Session, repositories: Repository[]) {
  return repositories.filter(repo => session.repoIds.includes(repo.id));
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
