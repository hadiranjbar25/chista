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
    await screen.findByText(/Provider rate limit/);
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

it('reconnects after a lost process rather than pretending the old native history survived', async () => {
  native.invoke
    .mockRejectedValueOnce(new Error('Agent session closed before completion.'))
    .mockResolvedValue('{"text":"Reconnected","blocks":[]}');
  const user = userEvent.setup();
  render(<AgentChat {...chatProps} />);
  await user.type(
    screen.getByRole('textbox', { name: 'Message agent' }),
    'Original question{Enter}',
  );
  await screen.findByText(/Agent session closed/);
  const first = native.invoke.mock.calls[0][1];
  await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'Continue{Enter}');
  await screen.findByText('Reconnected');
  const next = native.invoke.mock.calls[1][1];
  expect(next.sessionKey).not.toBe(first.sessionKey);
  expect(next.systemPrompt).not.toBeNull();
});
