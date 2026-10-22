export type Project = { id: string; name: string; path: string };
export type Session = { id: string; projectId: string; name: string };
export const newSession = (projectId: string, name: string): Session => ({ id: crypto.randomUUID(), projectId, name });
export function sessionsFor(sessions: Session[], projectId: string) { return sessions.filter(s => s.projectId === projectId); }
// Deliberately persist no artifacts, chat, reviewed context, provider tokens or MCP tokens.
export function loadProjects(): Project[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem('chista.projects.v1') ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((p): p is Project => p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.path === 'string');
  } catch { return []; }
}
