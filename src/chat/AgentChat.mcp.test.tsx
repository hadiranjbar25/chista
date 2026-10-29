// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { native, chatProps as props } from './testing/nativeChatHarness';
import AgentChat from './AgentChat';

it('keeps a native thread when an unrelated configured MCP server is unavailable', async () => {
  native.invoke.mockImplementation(async (_command, args) => {
    args.onEvent.onmessage({
      type: 'mcp_status',
      servers: [{ name: 'offline', available: false, failed: true, authStatus: 'unsupported' }],
    });
    return '{"text":"Answer","blocks":[]}';
  });
  const user = userEvent.setup();
  render(<AgentChat {...props} mode="codex" />);
  await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'First{Enter}');
  await screen.findByText('Answer');
  const first = native.invoke.mock.calls[0][1];
  await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'Follow up{Enter}');
  const next = native.invoke.mock.calls[1][1];
  expect(next.sessionKey).toBe(first.sessionKey);
  expect(next.systemPrompt).toBeNull();
  expect(JSON.parse(next.payload)).toEqual({ messages: [{ role: 'user', content: 'Follow up' }] });
  expect(native.close).not.toHaveBeenCalled();
});

it('reviews sanitized MCP arguments and returns only sanitized tool data to Codex', async () => {
  let event!: (event: unknown) => void;
  let finish!: (text: string) => void;
  native.invoke.mockImplementation((command, args) => {
    if (command === 'respond_agent_tool') return Promise.resolve();
    expect(command).toBe('agent_session_chat');
    event = args.onEvent.onmessage;
    args.onEvent.onmessage({ type: 'started' });
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const user = userEvent.setup();
  render(<AgentChat {...props} mode="codex" />);
  await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'Search MCP{Enter}');

  await act(async () =>
    event({
      type: 'tool_approval',
      id: 'approve-one',
      server: 'rag-e-khab',
      tool: 'search',
      arguments: { query: 'alex@example.com' },
    }),
  );
  const dialog = screen.getByRole('dialog', { name: 'Approve MCP tool' });
  expect(dialog.textContent).not.toContain('alex@example.com');
  expect(dialog.textContent).toContain('[CHAT_EMAIL_1]');
  await user.click(screen.getByRole('button', { name: 'Approve tool once' }));
  expect(native.invoke).toHaveBeenCalledWith(
    'respond_agent_tool',
    expect.objectContaining({
      id: 'approve-one',
      response: { approved: true, arguments: { query: '[CHAT_EMAIL_1]' } },
    }),
  );
  await act(async () =>
    event({
      type: 'tool_result',
      id: 'result-one',
      result: { content: [{ type: 'text', text: 'alex@example.com' }] },
    }),
  );
  const reply = native.invoke.mock.calls.find(
    ([command, args]) => command === 'respond_agent_tool' && args.id === 'result-one',
  )![1];
  expect(reply.response.content).not.toContain('alex@example.com');
  expect(reply.response.content).toContain('[CHAT_EMAIL_1]');
  await act(async () => finish('{"text":"Lookup complete","blocks":[]}'));
  expect(screen.getByText('Lookup complete')).toBeTruthy();
});

it('offers native Codex MCP sign-in for unauthenticated servers', async () => {
  native.invoke.mockImplementation(async (command, args) => {
    if (command === 'codex_mcp_sign_in')
      return 'Complete sign-in in Terminal, then return to Chista.';
    args.onEvent.onmessage({ type: 'started' });
    args.onEvent.onmessage({
      type: 'mcp_status',
      servers: [{ name: 'rag-e-khab', authStatus: 'notLoggedIn', available: true, failed: false }],
    });
    return '{"text":"Server needs sign-in.","blocks":[]}';
  });
  const user = userEvent.setup();
  render(<AgentChat {...props} mode="codex" />);
  await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'Connect MCP{Enter}');

  await user.click(await screen.findByRole('button', { name: 'Sign in' }));
  expect(native.invoke).toHaveBeenCalledWith('codex_mcp_sign_in', {
    executablePath: '',
    server: 'rag-e-khab',
  });
  expect(screen.getByRole('status').textContent).toContain('Complete sign-in in Terminal');
});

it('keeps tool evidence, states and cited artifacts attached to their original turn', async () => {
  let event!: (value: unknown) => void, finish!: (value: string) => void;
  native.invoke.mockImplementation((command, args) => {
    if (command === 'respond_agent_tool') return Promise.resolve();
    event = args.onEvent.onmessage;
    event({ type: 'started' });
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const context = JSON.stringify({
    mode: 'sanitized-context',
    artifacts: [
      { artifact: 'artifact-1.log', content: 'original sanitized evidence', omittedCharacters: 0 },
    ],
  });
  const user = userEvent.setup();
  const view = render(<AgentChat {...props} context={context} mode="codex" />);

  await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'Check access{Enter}');
  await act(async () =>
    event({
      type: 'tool_approval',
      id: 'call:approve',
      callId: 'call',
      server: 'audit',
      tool: 'access_events',
      arguments: { date: '2026-10-22' },
    }),
  );
  expect(screen.getByText('Awaiting approval')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Approve tool once' }));
  await act(async () =>
    event({
      type: 'tool_progress',
      callId: 'call',
      server: 'audit',
      tool: 'access_events',
      state: 'running',
    }),
  );
  expect(screen.getByText('Running')).toBeTruthy();
  await act(async () =>
    event({
      type: 'tool_result',
      id: 'call:result',
      callId: 'call',
      server: 'audit',
      tool: 'access_events',
      success: true,
      result: { content: [{ type: 'text', text: 'alex@example.com status=403' }] },
    }),
  );
  const receipt = JSON.parse(
    native.invoke.mock.calls.find(
      ([command, args]) => command === 'respond_agent_tool' && args.id === 'call:result',
    )![1].response.content,
  );
  expect(screen.getByText('Completed')).toBeTruthy();
  expect(screen.queryByText('alex@example.com status=403')).toBeNull();
  await act(async () =>
    finish(
      JSON.stringify({
        text: 'Authorization denied.',
        sources: ['artifact-1.log', receipt.sourceId, 'made-up-source'],
        blocks: [],
      }),
    ),
  );
  expect(screen.getByText('Unavailable source: made-up-source')).toBeTruthy();
  view.rerender(
    <AgentChat
      {...props}
      context={JSON.stringify({
        mode: 'sanitized-context',
        artifacts: [
          { artifact: 'artifact-1.log', content: 'replacement evidence', omittedCharacters: 0 },
        ],
      })}
      mode="codex"
    />,
  );
  expect(screen.getByText('original sanitized evidence')).toBeTruthy();
  expect(screen.queryByText('replacement evidence')).toBeNull();
});

it('retains denied and interrupted calls without claiming they completed', async () => {
  let event!: (value: unknown) => void, reject!: (error: Error) => void;
  native.invoke.mockImplementation((command, args) => {
    if (command === 'respond_agent_tool') return Promise.resolve();
    if (command === 'cancel_agent_chat') {
      reject(new Error('cancelled'));
      return Promise.resolve();
    }
    event = args.onEvent.onmessage;
    event({ type: 'started' });
    return new Promise((_resolve, fail) => {
      reject = fail;
    });
  });
  const user = userEvent.setup();
  render(<AgentChat {...props} mode="codex" />);

  await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'Check access{Enter}');
  await act(async () =>
    event({
      type: 'tool_approval',
      id: 'one:approve',
      callId: 'one',
      server: 'audit',
      tool: 'access',
      arguments: {},
    }),
  );
  await user.click(screen.getByRole('button', { name: 'Deny tool' }));
  expect(screen.getByText('Denied')).toBeTruthy();
  await act(async () =>
    event({
      type: 'tool_progress',
      callId: 'two',
      server: 'datadog',
      tool: 'query',
      state: 'running',
    }),
  );
  await user.click(screen.getByRole('button', { name: 'Stop' }));
  expect(await screen.findByText('Cancelled')).toBeTruthy();
  expect(screen.queryByText('Completed')).toBeNull();
  expect(screen.getByText('Denied')).toBeTruthy();
});
