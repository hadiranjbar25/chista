// @vitest-environment jsdom
import { it, expect } from 'vitest';

it('keeps manual session names when an agent title arrives later', async () => {
  const { renameSession, newSession } = await import('./workspace');
  const session=newSession('Debug session 1');
  const generated=renameSession(session,'Checkout timeouts','agent');
  expect(generated.name).toBe('Checkout timeouts');
  expect(renameSession(generated,'Later title','agent')).toBe(generated);
  const manual=renameSession(session,'My investigation','user');
  expect(renameSession(manual,'Agent title','agent')).toBe(manual);
  expect(renameSession(manual,'   ','user')).toBe(manual);
});

it('restores workspace membership without persisting debug evidence', async () => {
  const {loadWorkspaces,newWorkspace,workspaceRepositories,newSession}=await import('./workspace');
  const repos=[{id:'api',name:'API',path:'/repos/api'}];
  const a={...newWorkspace('Backend'),repoIds:['api','missing']};
  const b=newWorkspace('Frontend');
  localStorage.setItem('chista.workspaces.v1',JSON.stringify([a,b,a]));
  const restored=loadWorkspaces(repos);
  expect(restored).toHaveLength(2);
  expect(restored[0].repoIds).toEqual(['api']);
  expect(workspaceRepositories(restored[1],repos)).toEqual([]);
  expect(newSession('Investigate',a.id).workspaceId).toBe(a.id);
  localStorage.setItem('chista.workspaces.v1','invalid');
  expect(loadWorkspaces(repos)[0].name).toBe('My workspace');
  localStorage.clear();
});
