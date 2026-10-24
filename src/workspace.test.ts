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
