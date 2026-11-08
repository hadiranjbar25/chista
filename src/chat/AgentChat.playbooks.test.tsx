// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { native, chatProps } from './testing/nativeChatHarness';
import AgentChat from './AgentChat';
const context = JSON.stringify({
  mode: 'sanitized-context',
  artifacts: [{ artifact: 'artifact-1.log', content: 'Observed timeout', omittedCharacters: 0 }],
});
it.each(['claude', 'codex'])(
  '%s reviews the expanded playbook and displays only sourced task completions',
  async (mode) => {
    native.invoke.mockResolvedValue(
      JSON.stringify({
        text: 'Observed a timeout.',
        blocks: [],
        tasks: [
          { task: 'evidence', status: 'completed', sources: ['artifact-1.log'] },
          { task: 'hypotheses', status: 'completed', sources: ['invented-source'] },
        ],
      }),
    );
    const user = userEvent.setup();
    render(<AgentChat {...chatProps} context={context} mode={mode} />);
    await user.selectOptions(screen.getByLabelText('Debugging playbook'), 'investigate-error');
    expect(screen.getAllByRole('combobox', { name: /^Status:/ })).toHaveLength(4);
    expect(native.invoke).not.toHaveBeenCalled();
    await user.click(screen.getByLabelText('Review before sending'));
    await user.type(
      screen.getByLabelText('Message agent'),
      'Investigate private@example.com{Enter}',
    );
    const dialog = screen.getByRole('dialog', { name: 'Approve outgoing request' });
    expect(dialog.textContent).toContain('Chista playbook');
    expect(dialog.textContent).toContain('grants no permissions');
    expect(dialog.textContent).not.toContain('private@example.com');
    expect(native.invoke).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Approve and send' }));
    await screen.findByText('Observed a timeout.');
    expect(
      (screen.getByLabelText('Status: Inspect supporting evidence') as HTMLSelectElement).value,
    ).toBe('completed');
    expect(
      (screen.getByLabelText('Status: Evaluate competing hypotheses') as HTMLSelectElement).value,
    ).toBe('blocked');
    expect(screen.getByText(/reported completion without/)).toBeTruthy();
    // The conversation shows the user's prompt, rather than the expanded internal procedure.
    expect(screen.getByRole('log').textContent).not.toContain('Checklist:');
    await user.selectOptions(
      screen.getByLabelText('Status: Evaluate competing hypotheses'),
      'completed',
    );
    expect(screen.getByText('Confirmed by you')).toBeTruthy();
  },
);
it('revokes stale previews when the playbook or checklist changes, without executing tools', async () => {
  const user = userEvent.setup();
  render(<AgentChat {...chatProps} />);
  await user.selectOptions(screen.getByLabelText('Debugging playbook'), 'incident-report');
  await user.click(screen.getByLabelText('Review before sending'));
  await user.type(screen.getByLabelText('Message agent'), 'Draft a report{Enter}');
  expect(screen.getByRole('dialog')).toBeTruthy();
  await user.selectOptions(screen.getByLabelText('Status: Assess observed impact'), 'blocked');
  expect(screen.queryByRole('dialog')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Send' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  await user.selectOptions(screen.getByLabelText('Debugging playbook'), 'compare-traces');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(native.invoke).not.toHaveBeenCalled();
});
it('blocks unregistered slash commands locally and disables task changes during execution', async () => {
  let finish!: (text: string) => void;
  native.invoke.mockImplementation((_command, args) => {
    args.onEvent.onmessage({ type: 'started' });
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const user = userEvent.setup();
  render(<AgentChat {...chatProps} />);
  await user.type(screen.getByLabelText('Message agent'), '/unregistered run code{Enter}');
  expect(native.invoke).not.toHaveBeenCalled();
  expect(screen.getByText(/Unknown playbook command/)).toBeTruthy();
  await user.clear(screen.getByLabelText('Message agent'));
  await user.type(
    screen.getByLabelText('Message agent'),
    '/compare-traces compare the requests{Enter}',
  );
  expect((screen.getByLabelText('Debugging playbook') as HTMLSelectElement).disabled).toBe(true);
  expect(
    (screen.getByLabelText('Status: Identify comparable traces') as HTMLSelectElement).disabled,
  ).toBe(true);
  await act(async () => finish('{"text":"Need two traces.","blocks":[]}'));
});
