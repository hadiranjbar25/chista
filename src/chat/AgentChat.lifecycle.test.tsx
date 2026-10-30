// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { native, chatProps as props } from './testing/nativeChatHarness';
import AgentChat from './AgentChat';
import { useAgentChat } from './useAgentChat';

it.each(['claude', 'codex'])('%s requires approval and renders generated OpenUI', async (agent) => {
  let finish!: (text: string) => void;
  native.invoke.mockImplementation((command, args) => {
    expect(command).toBe('agent_session_chat');
    expect(args.agent).toBe(agent);
    args.onEvent.onmessage({ type: 'started' });
    args.onEvent.onmessage({ type: 'delta', text: '{"text":"Two timeouts found' });
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const user = userEvent.setup();
  render(<AgentChat {...props} mode={agent} />);
  await user.click(screen.getByRole('checkbox', { name: 'Review before sending' }));
  await user.type(
    screen.getByRole('textbox', { name: 'Message agent' }),
    'Investigate alex@example.com{Enter}',
  );
  const review = screen.getByRole('dialog');
  expect(review.textContent).toContain('Reviewed evidence: 2 timeouts');
  expect(review.textContent).not.toContain('alex@example.com');
  expect(native.invoke).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Approve and send' }));
  expect(await screen.findByText('Two timeouts found')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
  await act(async () =>
    finish(
      JSON.stringify({
        text: 'Two timeouts found',
        blocks: [
          { type: 'chart', title: 'Observed errors', items: [{ label: 'Timeout', value: 2 }] },
          { type: 'followups', prompts: ['Inspect retries'] },
        ],
      }),
    ),
  );
  expect(screen.getByRole('heading', { name: 'Observed errors' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: /Inspect retries/ }));
  expect(
    (screen.getByRole('textbox', { name: 'Message agent' }) as HTMLTextAreaElement).value,
  ).toBe('Inspect retries');
});

it.each(['claude', 'codex'])(
  'keeps %s running across view navigation without replaying its prompt',
  async (mode) => {
    let finish!: (reply: string) => void;
    let emit!: (event: unknown) => void;
    native.invoke.mockImplementation((command, args) => {
      if (command === 'respond_agent_tool') return Promise.resolve();
      emit = args.onEvent.onmessage;
      args.onEvent.onmessage({ type: 'started' });
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    });
    const user = userEvent.setup();
    const view = render(<AgentChat {...props} mode={mode} active />);
    await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'Debug this{Enter}');
    const first = native.invoke.mock.calls[0][1];
    view.rerender(<AgentChat {...props} mode={mode} active={false} />);
    expect(native.invoke).toHaveBeenCalledTimes(1);
    expect(native.close).not.toHaveBeenCalled();
    await act(async () =>
      emit({
        type: 'tool_approval',
        id: 'hidden-tool',
        server: 'fixture',
        tool: 'lookup',
        arguments: {},
      }),
    );
    await waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith(
        'respond_agent_tool',
        expect.objectContaining({
          id: 'hidden-tool',
          response: expect.objectContaining({ approved: false }),
        }),
      ),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => finish('{"text":"Finished while hidden","blocks":[]}'));
    view.rerender(<AgentChat {...props} mode={mode} active />);
    await screen.findByText('Finished while hidden');
    native.invoke.mockResolvedValue('{"text":"Next answer","blocks":[]}');
    await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'Follow up{Enter}');
    const next = native.invoke.mock.calls.filter(
      ([command]) => command === 'agent_session_chat',
    )[1][1];
    expect(next.sessionKey).toBe(first.sessionKey);
    expect(next.systemPrompt).toBeNull();
    expect(JSON.parse(next.payload)).toEqual({
      messages: [{ role: 'user', content: 'Follow up' }],
    });
  },
);

it('cancels active work and releases the native conversation when the session is removed', async () => {
  let reject!: (reason: Error) => void;
  let turns = 0;
  native.invoke.mockImplementation((command, args) => {
    if (command === 'cancel_agent_chat') {
      reject(new Error('Cancelled'));
      return Promise.resolve();
    }
    args.onEvent.onmessage({ type: 'started' });
    if (++turns === 1) return Promise.resolve('{"text":"First answer","blocks":[]}');
    return new Promise((_resolve, fail) => {
      reject = fail;
    });
  });
  const user = userEvent.setup();
  const view = render(<AgentChat {...props} mode="codex" />);
  await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'First{Enter}');
  await screen.findByText('First answer');
  const first = native.invoke.mock.calls[0][1];
  await user.type(
    screen.getByRole('textbox', { name: 'Message agent' }),
    'Long-running follow-up{Enter}',
  );
  await act(async () => view.unmount());
  expect(native.invoke).toHaveBeenCalledWith(
    'cancel_agent_chat',
    expect.objectContaining({ requestId: expect.any(String) }),
  );
  expect(native.close).toHaveBeenCalledWith({ sessionKey: first.sessionKey });
});

it('switching providers revokes pending approval without sending', async () => {
  const user = userEvent.setup();
  const view = render(<AgentChat {...props} />);
  await user.click(screen.getByRole('checkbox', { name: 'Review before sending' }));
  await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'Check timeouts{Enter}');
  expect(screen.getByRole('dialog').textContent).toContain('Claude Code CLI');
  view.rerender(<AgentChat {...props} mode="codex" codexPath="/usr/local/bin/codex" />);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(native.invoke).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Send' }));
  expect(screen.getByRole('dialog').textContent).toContain('Codex CLI');
});

it.each(['claude', 'codex'])(
  'opens %s native sign-in and resumes the approved message once',
  async (agent) => {
    native.auth.mockResolvedValueOnce(false).mockResolvedValue(true);
    native.invoke.mockImplementation(async (command) => {
      if (command === `${agent}_sign_in`) return 'Sign in in Terminal';
      return '{"text":"Investigation complete","blocks":[]}';
    });
    const user = userEvent.setup();
    render(<AgentChat {...props} mode={agent} />);
    await user.click(screen.getByRole('checkbox', { name: 'Review before sending' }));
    expect(screen.queryByText(/sign-in & terminal/)).toBeNull();
    await user.type(
      screen.getByRole('textbox', { name: 'Message agent' }),
      'Check this timeout{Enter}',
    );
    expect(native.auth).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Approve and send' }));
    expect(await screen.findByText(/Your message will continue automatically/)).toBeTruthy();
    expect(native.invoke.mock.calls.map((c) => c[0])).toEqual([`${agent}_sign_in`]);
    expect(await screen.findByText('Investigation complete', {}, { timeout: 4000 })).toBeTruthy();
    expect(native.invoke.mock.calls.map((c) => c[0])).toEqual([
      `${agent}_sign_in`,
      'agent_session_chat',
    ]);
    expect(screen.getByRole('log').querySelectorAll('.message.user')).toHaveLength(1);
  },
);

it('stopping sign-in preserves the draft and prevents a deferred send', async () => {
  native.auth.mockResolvedValue(false);
  native.invoke.mockResolvedValue('Sign in in Terminal');
  const user = userEvent.setup();
  render(<AgentChat {...props} />);
  await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'Keep this draft{Enter}');

  await user.click(screen.getByRole('button', { name: 'Stop' }));
  expect(
    (screen.getByRole('textbox', { name: 'Message agent' }) as HTMLTextAreaElement).value,
  ).toBe('Keep this draft');
  expect(native.invoke.mock.calls.map((c) => c[0])).toEqual(['claude_sign_in']);
  expect(screen.getByRole('log').querySelectorAll('.message')).toHaveLength(0);
});

it.each(['claude', 'codex'])(
  '%s can skip the preview while still sanitizing, then enable review again',
  async (agent) => {
    native.invoke.mockResolvedValue('{"text":"Done","blocks":[]}');
    const user = userEvent.setup();
    render(<AgentChat {...props} mode={agent} />);
    const toggle = screen.getByRole('checkbox', { name: 'Review before sending' });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    await user.type(
      screen.getByRole('textbox', { name: 'Message agent' }),
      'Investigate alex@example.com{Enter}',
    );
    expect(await screen.findByText('Done')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(native.invoke).toHaveBeenCalledTimes(1);
    const [command, args] = native.invoke.mock.calls[0];
    expect(command).toBe('agent_session_chat');
    expect(args.agent).toBe(agent);
    expect(args.payload).not.toContain('alex@example.com');
    expect(args.payload).toContain('[CHAT_EMAIL_1]');
    expect(args.payload).toContain('Reviewed evidence: 2 timeouts');
    await user.click(toggle);
    await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'Check again{Enter}');
    expect(screen.getByRole('dialog', { name: 'Approve outgoing request' })).toBeTruthy();
    expect(native.invoke).toHaveBeenCalledTimes(1);
  },
);

it.each(['claude', 'codex'])(
  '%s keeps the same session and sends updated context without replaying history',
  async (agent) => {
    native.invoke.mockResolvedValue('{"text":"Answer","blocks":[]}');
    const user = userEvent.setup();
    const view = render(<AgentChat {...props} mode={agent} />);

    await user.type(
      screen.getByRole('textbox', { name: 'Message agent' }),
      'First question{Enter}',
    );
    await screen.findByText('Answer');
    const first = native.invoke.mock.calls[0][1];
    expect(first.systemPrompt).toContain('You are Chista');
    view.rerender(<AgentChat {...props} mode={agent} active={false} />);
    view.rerender(<AgentChat {...props} mode={agent} />);
    await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'Follow up{Enter}');
    expect(native.invoke.mock.calls[1][1]).toEqual(
      expect.objectContaining({ sessionKey: first.sessionKey, systemPrompt: null }),
    );
    expect(JSON.parse(native.invoke.mock.calls[1][1].payload)).toEqual({
      messages: [{ role: 'user', content: 'Follow up' }],
    });
    view.rerender(<AgentChat {...props} mode={agent} context="Changed evidence" />);
    expect(native.close).not.toHaveBeenCalled();
    await user.type(
      screen.getByRole('textbox', { name: 'Message agent' }),
      'With new evidence{Enter}',
    );
    const next = native.invoke.mock.calls[2][1];
    expect(next.sessionKey).toBe(first.sessionKey);
    expect(next.systemPrompt).toBeNull();
    expect(next.payload).toContain('Changed evidence');
    expect(next.payload).not.toContain('First question');
    expect(next.payload).not.toContain('Follow up');
    expect(next.payload).not.toContain('Reviewed evidence: 2 timeouts');
  },
);

it('transmits a prompt once when Send is triggered twice before React rerenders', async () => {
  let finish!: (reply: string) => void;
  native.invoke.mockImplementation((_command, args) => {
    args.onEvent.onmessage({ type: 'started' });
    return new Promise<string>((resolve) => {
      finish = resolve;
    });
  });
  const { result } = renderHook(() => useAgentChat(props));
  act(() => result.current.setPrompt('One question'));
  const send = result.current.sendMessage;
  act(() => {
    send();
    send();
  });
  await waitFor(() => expect(native.invoke).toHaveBeenCalledTimes(1));
  expect(result.current.messages).toEqual([{ role: 'user', content: 'One question' }]);
  await act(async () => finish('{"text":"Answer","blocks":[]}'));
  expect(result.current.busy).toBe(false);
});
