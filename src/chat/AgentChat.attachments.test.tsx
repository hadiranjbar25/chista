// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { native, chatProps as props } from './testing/nativeChatHarness';
import AgentChat from './AgentChat';

const context = JSON.stringify({
  version: 1,
  mode: 'sanitized-context',
  artifacts: [{ artifact: 'artifact-1.log', content: 'Sanitized timeout evidence' }],
});
const attachments = {
  files: [{ id: 'first-file', name: 'requests.log', redactions: 2 }],
  context,
  busy: false,
  error: '',
};

it.each(['Enter', 'Send'])(
  'clears sent attachments on %s while retaining workspace evidence and CLI context',
  async (action) => {
    let finish!: (value: string) => void;
    native.invoke.mockResolvedValue('{"text":"Follow-up answer","blocks":[]}');
    native.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const user = userEvent.setup();
    const view = render(
      <AgentChat {...props} mode="codex" context={context} attachments={attachments} />,
    );
    await user.click(screen.getByRole('button', { name: /^requests\.log/ }));
    expect(screen.getByText('Sanitized attachments', { selector: 'strong' })).toBeTruthy();
    await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'Inspect the timeout');
    if (action === 'Enter') await user.keyboard('{Enter}');
    else await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.queryByRole('button', { name: 'Remove attachment requests.log' })).toBeNull();
    expect(screen.queryByText('Sanitized attachments', { selector: 'strong' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    const first = native.invoke.mock.calls[0][1];
    expect(first.payload).toContain('Sanitized timeout evidence');
    expect(first.payload).not.toContain('requests.log');
    expect(first.payload).not.toContain('first-file');
    expect(attachments.files).toHaveLength(1);
    await act(async () => finish('{"text":"First answer","blocks":[]}'));
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'Continue{Enter}');
    await screen.findByText('Follow-up answer');
    const followUp = native.invoke.mock.calls[1][1];
    expect(followUp.sessionKey).toBe(first.sessionKey);
    expect(followUp.systemPrompt).toBeNull();
    expect(JSON.parse(followUp.payload)).toEqual({
      messages: [{ role: 'user', content: 'Continue' }],
    });
    expect(native.close).not.toHaveBeenCalled();

    view.rerender(
      <AgentChat
        {...props}
        mode="codex"
        context="Updated evidence"
        attachments={{
          ...attachments,
          context: 'Updated evidence',
          files: [...attachments.files, { id: 'new-file', name: 'new.log', redactions: 0 }],
        }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Remove attachment new.log' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove attachment requests.log' })).toBeNull();
    expect(screen.queryByText('Sanitized attachments', { selector: 'strong' })).toBeNull();
  },
);

it('keeps pending file attachments when an outgoing preview is denied', async () => {
  const user = userEvent.setup();
  render(<AgentChat {...props} context={context} attachments={attachments} />);
  await user.click(screen.getByRole('checkbox', { name: 'Review before sending' }));
  await user.click(screen.getByRole('button', { name: 'Send' }));
  expect(screen.getByRole('dialog', { name: 'Approve outgoing request' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Deny / edit' }));
  expect(screen.getByRole('button', { name: 'Remove attachment requests.log' })).toBeTruthy();
  expect(native.invoke).not.toHaveBeenCalled();
});
