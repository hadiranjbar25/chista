// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

async function removeCurrentSession(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Session actions' }));
  await user.click(screen.getByRole('button', { name: 'Remove session' }));
}

it('removes the only session and its draft while keeping workspace evidence and mappings', async () => {
  const user = userEvent.setup();
  render(<App />);
  const raw = 'email,status\nalex@example.com,error';
  const file = new File([raw], 'requests.csv', { type: 'text/csv' });
  Object.defineProperty(file, 'text', { value: async () => raw });
  await user.click(screen.getByRole('button', { name: '+ Add files' }));
  await user.upload(screen.getByLabelText('Import debug files'), file);
  await screen.findByRole('button', { name: 'Remove attachment requests.csv' });
  await user.type(
    screen.getByRole('textbox', { name: 'Message agent' }),
    'Discard this investigation',
  );
  await user.click(screen.getByRole('button', { name: 'Rename Debug session 1' }));
  await user.clear(screen.getByRole('textbox', { name: 'Session name' }));
  await user.type(screen.getByRole('textbox', { name: 'Session name' }), 'Remove me{Enter}');
  await removeCurrentSession(user);
  expect(screen.queryByRole('button', { name: 'Remove me' })).toBeNull();
  expect(
    (screen.getByRole('textbox', { name: 'Message agent' }) as HTMLTextAreaElement).value,
  ).toBe('');
  expect(screen.getByRole('status').textContent).toContain('Started a fresh session');
  expect(screen.getByRole('button', { name: 'Remove attachment requests.csv' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Files & mappings' }));
  await user.click(screen.getByRole('button', { name: 'Mappings' }));
  expect(screen.getByRole('region', { name: 'Local redaction mappings' }).textContent).toContain(
    'alex@example.com',
  );
});

it('selects an existing session and preserves its draft when another session is removed', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'Keep the first draft');
  await user.click(screen.getByRole('button', { name: 'New session' }));
  await user.type(
    screen.getByRole('textbox', { name: 'Message agent' }),
    'Remove the second draft',
  );
  await removeCurrentSession(user);
  expect(screen.queryByRole('button', { name: 'Debug session 2' })).toBeNull();
  expect(screen.getByRole('heading', { name: 'Debug session 1' })).toBeTruthy();
  expect(
    (screen.getByRole('textbox', { name: 'Message agent' }) as HTMLTextAreaElement).value,
  ).toBe('Keep the first draft');
  expect(screen.getByRole('button', { name: 'Session actions' })).toBeTruthy();
});

it('keeps another workspace’s sessions when removing the last session in the active workspace', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.type(
    screen.getByRole('textbox', { name: 'Message agent' }),
    'Keep my original workspace',
  );
  await user.click(screen.getByRole('button', { name: 'Switch workspace' }));
  await user.click(screen.getByRole('button', { name: 'New workspace' }));
  await user.type(screen.getByRole('textbox', { name: 'Workspace name' }), 'Payments');
  await user.click(screen.getByRole('button', { name: 'Create workspace' }));
  await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'Remove Payments draft');
  await removeCurrentSession(user);
  expect(
    (screen.getByRole('textbox', { name: 'Message agent' }) as HTMLTextAreaElement).value,
  ).toBe('');
  await user.click(screen.getByRole('button', { name: 'Switch workspace' }));
  await user.click(screen.getByRole('button', { name: 'My workspace' }));
  expect(
    (screen.getByRole('textbox', { name: 'Message agent' }) as HTMLTextAreaElement).value,
  ).toBe('Keep my original workspace');
});
