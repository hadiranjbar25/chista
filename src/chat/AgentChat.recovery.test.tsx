// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { native, chatProps } from './testing/nativeChatHarness';
import AgentChat from './AgentChat';

it.each(['claude', 'codex'])(
  'continues %s after a recoverable provider error without resending the failed prompt',
  async (mode) => {
    let turn = 0;
    native.invoke.mockImplementation(async (_command, args) => {
      args.onEvent.onmessage({ type: 'started' });
      if (++turn === 1) {
        args.onEvent.onmessage({ type: 'session_retained' });
        throw new Error('Provider rate limit');
      }
      return '{"text":"Continued","blocks":[]}';
    });
    const user = userEvent.setup();
    render(<AgentChat {...chatProps} mode={mode} />);
    await user.type(
      screen.getByRole('textbox', { name: 'Message agent' }),
      'Original question{Enter}',
    );
    await screen.findByText(/Provider rate limit.*No automatic retry/);
    expect(native.invoke).toHaveBeenCalledTimes(1);
    const first = native.invoke.mock.calls[0][1];
    await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'New question{Enter}');
    await screen.findByText('Continued');
    const next = native.invoke.mock.calls[1][1];
    expect(next.sessionKey).toBe(first.sessionKey);
    expect(next.systemPrompt).toBeNull();
    expect(JSON.parse(next.payload)).toEqual({
      messages: [{ role: 'user', content: 'New question' }],
    });
    expect(native.close).not.toHaveBeenCalled();
  },
);

it.each(['claude', 'codex'])(
  'continues %s after an acknowledged Stop without replaying history',
  async (mode) => {
    let emit!: (event: unknown) => void;
    let reject!: (error: Error) => void;
    let turns = 0;
    native.invoke.mockImplementation((command, args) => {
      if (command === 'cancel_agent_chat') {
        emit({ type: 'session_retained' });
        reject(new Error('Request cancelled. The conversation is ready for your next message.'));
        return Promise.resolve();
      }
      emit = args.onEvent.onmessage;
      emit({ type: 'started' });
      if (++turns > 1) return Promise.resolve('{"text":"Continued","blocks":[]}');
      return new Promise<string>((_resolve, fail) => {
        reject = fail;
      });
    });
    const user = userEvent.setup();
    render(<AgentChat {...chatProps} mode={mode} />);
    await user.type(
      screen.getByRole('textbox', { name: 'Message agent' }),
      'Original question{Enter}',
    );
    const first = native.invoke.mock.calls[0][1];
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull());
    expect(native.close).not.toHaveBeenCalled();
    await user.type(
      screen.getByRole('textbox', { name: 'Message agent' }),
      'Continue differently{Enter}',
    );
    await screen.findByText('Continued');
    const next = native.invoke.mock.calls.filter(
      ([command]) => command === 'agent_session_chat',
    )[1][1];
    expect(next.sessionKey).toBe(first.sessionKey);
    expect(next.systemPrompt).toBeNull();
    expect(JSON.parse(next.payload)).toEqual({
      messages: [{ role: 'user', content: 'Continue differently' }],
    });
  },
);

it.each(['claude', 'codex'])(
  'requires explicit reconnection before %s can replay context after losing its process',
  async (mode) => {
    native.invoke
      .mockRejectedValueOnce(new Error('Agent session closed before completion.'))
      .mockResolvedValue('{"text":"Reconnected","blocks":[]}');
    const user = userEvent.setup();
    render(<AgentChat {...chatProps} mode={mode} />);
    await user.type(
      screen.getByRole('textbox', { name: 'Message agent' }),
      'Original question{Enter}',
    );
    await screen.findByText(/Agent session closed.*No automatic retry/);
    const first = native.invoke.mock.calls[0][1];
    await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'Continue{Enter}');
    expect(native.invoke).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Reconnect with context' }));
    expect(native.invoke).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Reconnected');
    const next = native.invoke.mock.calls[1][1];
    expect(next.sessionKey).not.toBe(first.sessionKey);
    expect(next.systemPrompt).not.toBeNull();
    expect(next.payload).toContain('Original question');
  },
);

it('retains sanitized CLI failure details without a tool callback and sends only the next message', async () => {
  native.invoke
    .mockRejectedValueOnce(
      JSON.stringify({
        code: 'session_retained',
        message: 'Claude could not complete the request.',
        detail: { errors: ['401 Unauthorized for alex@example.com, Bearer sk-fixture123456'] },
      }),
    )
    .mockResolvedValue('{"text":"Continued","blocks":[]}');
  const user = userEvent.setup();
  render(<AgentChat {...chatProps} />);
  await user.type(
    screen.getByRole('textbox', { name: 'Message agent' }),
    'Original question{Enter}',
  );
  await user.click(await screen.findByText('View error details'));
  expect(screen.getByText(/401 Unauthorized/).textContent).toContain('[CHAT_EMAIL_1]');
  expect(document.body.textContent).not.toContain('alex@example.com');
  expect(document.body.textContent).not.toContain('sk-fixture123456');
  expect(screen.queryByRole('button', { name: 'Reconnect with context' })).toBeNull();
  const first = native.invoke.mock.calls[0][1];
  await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'New question{Enter}');
  await screen.findByText('Continued');
  const next = native.invoke.mock.calls[1][1];
  expect(next.sessionKey).toBe(first.sessionKey);
  expect(next.systemPrompt).toBeNull();
  expect(JSON.parse(next.payload)).toEqual({
    messages: [{ role: 'user', content: 'New question' }],
  });
  expect(screen.getByText(/401 Unauthorized/)).toBeTruthy();
});
