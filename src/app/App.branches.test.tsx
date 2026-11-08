// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { native } from '../chat/testing/nativeChatHarness';
import App from './App';
it('creates a branch in the same workspace, preserves the original, and resumes it independently', async () => {
  localStorage.clear();
  let turns = 0;
  native.invoke.mockImplementation(async (command) => {
    if (command === 'agent_models') return [];
    expect(command).toBe('agent_session_chat');
    return JSON.stringify({
      text: ++turns === 1 ? 'Original analysis' : 'Independent branch analysis',
      blocks: [],
    });
  });
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('radio', { name: 'Investigate an error' }));
  await user.type(
    screen.getByRole('textbox', { name: 'Message agent' }),
    'Debug the failure{Enter}',
  );
  await screen.findByText('Original analysis');
  await user.click(screen.getByRole('button', { name: 'Branch from message 2' }));
  expect(screen.getByRole('heading', { name: 'Debug session 1 · branch' })).toBeTruthy();
  expect(screen.getByRole('complementary', { name: 'Branch checkpoint' }).textContent).toContain(
    'original session is preserved',
  );
  expect(
    screen.getByRole('radio', { name: 'Investigate an error' }).getAttribute('aria-checked'),
  ).toBe('true');
  expect(turns).toBe(1);
  await user.type(
    screen.getByRole('textbox', { name: 'Message agent' }),
    'Try a different cause{Enter}',
  );
  await screen.findByText('Independent branch analysis');
  await user.click(screen.getByRole('button', { name: /^Debug session 1$/ }));
  expect(within(screen.getByRole('log')).getByText('Original analysis')).toBeTruthy();
  expect(within(screen.getByRole('log')).queryByText('Independent branch analysis')).toBeNull();
  const calls = native.invoke.mock.calls.filter(([command]) => command === 'agent_session_chat');
  expect(calls[0][1].sessionKey).not.toBe(calls[1][1].sessionKey);
  expect(calls[1][1].workspaceId).toBe(calls[0][1].workspaceId);
});
