// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { native, chatProps as props } from './testing/nativeChatHarness';
import AgentChat from './AgentChat';
import { Sanitizer } from '../evidence/safety';

it('restores masked repository names locally during streaming and after completion', async () => {
  const sanitizer = new Sanitizer();
  const context = sanitizer.sanitize('{"name":"chista"}', 'json', []);
  let emit!: (event: unknown) => void;
  let finish!: (reply: string) => void;
  native.invoke.mockImplementation((_command, args) => {
    emit = args.onEvent.onmessage;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const view = render(
    <AgentChat
      {...props}
      mode="codex"
      context={context}
      sharedSanitizer={sanitizer}
      repositories={[{ id: 'repo-local', name: 'chista', path: '/private/chista' }]}
    />,
  );
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'Which repo?{Enter}');
  await act(async () => emit({ type: 'delta', text: '{"text":"Repository name: [SENSITIVE_' }));
  expect(screen.queryByText('Repository name: chista.')).toBeNull();
  await act(async () => emit({ type: 'delta', text: '1].' }));
  expect(screen.getByText('Repository name: chista.')).toBeTruthy();
  expect(screen.getByText('Streaming response…')).toBeTruthy();
  await act(async () => finish('{"text":"Repository name: [SENSITIVE_1].","blocks":[]}'));
  await screen.findByText('Repository name: chista.');
  const outgoing = native.invoke.mock.calls[0][1].payload;
  expect(outgoing).not.toContain('chista');
  expect(outgoing).toContain('[SENSITIVE_1]');
  expect(outgoing).not.toContain('/private/chista');
  expect(sanitizer.sanitize('{"name":"chista"}', 'json', [])).toBe(context);
  // A new native thread receives full history, which must still contain masks.
  view.rerender(
    <AgentChat
      {...props}
      mode="claude"
      context={context}
      sharedSanitizer={sanitizer}
      repositories={[{ id: 'repo-local', name: 'chista', path: '/private/chista' }]}
    />,
  );
  native.invoke.mockResolvedValue('{"text":"Still [SENSITIVE_1].","blocks":[]}');
  await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'And chista?{Enter}');
  await screen.findByText('Still chista.');
  const followup = native.invoke.mock.calls[1][1];
  expect(followup.payload).not.toContain('chista');
  expect(followup.payload).toContain('[SENSITIVE_1]');
  expect(
    JSON.parse(followup.payload).messages.some(
      (message: { role: string; content: string }) =>
        message.role === 'assistant' && message.content.includes('[SENSITIVE_1]'),
    ),
  ).toBe(true);
});

it.each(['codex', 'claude'])(
  'gives %s the folder name without exposing its local path or internal ID',
  async (agent) => {
    native.invoke.mockResolvedValue('{"text":"The selected repository is chista.","blocks":[]}');
    const user = userEvent.setup();
    const view = render(
      <AgentChat
        {...props}
        mode={agent}
        repositories={[
          { id: 'internal-repo-id', name: 'chista', path: '/Users/alex/private-projects/chista' },
        ]}
      />,
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Message agent' }),
      'What is the name of this repo?{Enter}',
    );
    await screen.findByText('The selected repository is chista.');
    const first = native.invoke.mock.calls[0][1];
    const outgoing = JSON.parse(first.payload).messages;
    expect(
      outgoing.some((message: { content: string }) => message.content.includes('"chista"')),
    ).toBe(true);
    expect(first.payload).not.toContain('/Users/alex');
    expect(first.payload).not.toContain('internal-repo-id');

    await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'Continue{Enter}');
    expect(native.invoke.mock.calls[1][1].sessionKey).toBe(first.sessionKey);
    expect(JSON.parse(native.invoke.mock.calls[1][1].payload)).toEqual({
      messages: [{ role: 'user', content: 'Continue' }],
    });
    await screen.findByRole('button', { name: 'Send' });
    view.rerender(
      <AgentChat
        {...props}
        mode={agent}
        repositories={[{ id: 'new-internal-id', name: 'payments', path: '/private/payments' }]}
      />,
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Message agent' }),
      'Which repo now?{Enter}',
    );
    const update = native.invoke.mock.calls[2][1];
    expect(update.sessionKey).toBe(first.sessionKey);
    expect(update.systemPrompt).toBeNull();
    expect(update.payload).toContain('payments');
    expect(update.payload).not.toContain('/private/payments');
    expect(update.payload).not.toContain('What is the name');
  },
);
