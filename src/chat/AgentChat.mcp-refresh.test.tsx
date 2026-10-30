// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { native, chatProps } from './testing/nativeChatHarness';
import AgentChat from './AgentChat';

it.each(['claude', 'codex'])(
  'refreshes %s after returning from login without replaying the conversation',
  async (mode) => {
    let authenticated = false;
    native.invoke.mockImplementation(async (command, args) => {
      if (command === `${mode}_mcp_sign_in`) {
        authenticated = true;
        return 'Complete sign-in in Terminal.';
      }
      if (command === 'refresh_agent_mcp')
        return [
          {
            name: 'fixture',
            authStatus: authenticated ? 'loggedIn' : 'notLoggedIn',
            available: authenticated,
            failed: false,
          },
        ];
      args.onEvent.onmessage({ type: 'started' });
      args.onEvent.onmessage({
        type: 'mcp_status',
        servers: [
          {
            name: 'fixture',
            authStatus: authenticated ? 'loggedIn' : 'notLoggedIn',
            available: authenticated,
            failed: false,
          },
        ],
      });
      return '{"text":"Answer","blocks":[]}';
    });
    const user = userEvent.setup();
    render(<AgentChat {...chatProps} mode={mode} />);
    await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'First{Enter}');
    await screen.findByText('Answer');
    const first = native.invoke.mock.calls[0][1];
    await user.click(screen.getByText('MCP connections · 0 available'));
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(native.close).not.toHaveBeenCalled();
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await screen.findByText('MCP connections · 1 available');
    expect(native.invoke).toHaveBeenCalledWith('refresh_agent_mcp', {
      agent: mode,
      executablePath: '',
      sessionKey: first.sessionKey,
      server: 'fixture',
    });
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
    await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'Continue{Enter}');
    const chats = native.invoke.mock.calls.filter(([command]) => command === 'agent_session_chat');
    expect(chats).toHaveLength(2);
    expect(chats[1][1].sessionKey).toBe(first.sessionKey);
    expect(chats[1][1].systemPrompt).toBeNull();
    expect(JSON.parse(chats[1][1].payload)).toEqual({
      messages: [{ role: 'user', content: 'Continue' }],
    });
  },
);

it('keeps the real disconnected state until a manual refresh confirms the connection', async () => {
  let finish!: (statuses: unknown[]) => void;
  native.invoke.mockImplementation(async (command, args) => {
    if (command === 'refresh_agent_mcp')
      return new Promise((resolve) => {
        finish = resolve;
      });
    args.onEvent.onmessage({
      type: 'mcp_status',
      servers: [{ name: 'fixture', authStatus: 'notLoggedIn', available: false, failed: false }],
    });
    return '{"text":"Answer","blocks":[]}';
  });
  const user = userEvent.setup();
  render(<AgentChat {...chatProps} />);
  await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'First{Enter}');
  await user.click(await screen.findByText('MCP connections · 0 available'));
  await user.click(screen.getByRole('button', { name: 'Refresh connections' }));
  expect(
    (screen.getByRole('button', { name: 'Refreshing connections…' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByText('MCP connections · 0 available')).toBeTruthy();
  await act(async () =>
    finish([{ name: 'fixture', authStatus: 'loggedIn', available: true, failed: false }]),
  );
  await screen.findByText('MCP connections · 1 available');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Refresh connections' })).toBeTruthy(),
  );
  expect(
    native.invoke.mock.calls.filter(([command]) => command === 'agent_session_chat'),
  ).toHaveLength(1);
});
