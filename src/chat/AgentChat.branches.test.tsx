// @vitest-environment jsdom
import { useState } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { native, chatProps } from './testing/nativeChatHarness';
import AgentChat from './AgentChat';
import type { InvestigationBranch } from './checkpoints';

it.each(['claude', 'codex'])(
  '%s forks the chosen prefix into a fresh native conversation and preserves the original',
  async (mode) => {
    let turn = 0;
    native.invoke.mockImplementation(async (command) => {
      expect(command).toBe('agent_session_chat');
      return JSON.stringify({
        text: ['Original finding', 'Later finding', 'Branch finding'][turn++],
        blocks: [],
      });
    });
    function Harness() {
      const [branch, setBranch] = useState<InvestigationBranch>();
      const [context, setContext] = useState('Checkpoint evidence');
      return (
        <>
          <div hidden={Boolean(branch)}>
            <AgentChat
              {...chatProps}
              mode={mode}
              context={context}
              active={!branch}
              onBranch={setBranch}
            />
            <button onClick={() => setContext('Later evidence')}>Change context</button>
          </div>
          {branch && (
            <>
              <AgentChat
                {...chatProps}
                mode={mode}
                context={branch.context}
                initialBranch={branch}
              />
              <button onClick={() => setBranch(undefined)}>Return to original</button>
            </>
          )}
        </>
      );
    }
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('checkbox', { name: 'Review before sending' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Message agent' }),
      'Original question{Enter}',
    );
    await user.click(screen.getByRole('button', { name: 'Approve and send' }));
    await screen.findByText('Original finding');
    const first = native.invoke.mock.calls[0][1];
    await user.click(screen.getByRole('button', { name: 'Change context' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Message agent' }),
      'Later question{Enter}',
    );
    await user.click(screen.getByRole('button', { name: 'Approve and send' }));
    await screen.findByText('Later finding');
    await user.click(screen.getByRole('button', { name: 'Branch from message 2' }));
    expect(native.invoke).toHaveBeenCalledTimes(2);
    expect(native.close).not.toHaveBeenCalled();
    expect(within(screen.getByRole('log')).queryByText('Later finding')).toBeNull();
    expect(
      (screen.getByRole('checkbox', { name: 'Review before sending' }) as HTMLInputElement).checked,
    ).toBe(true);
    await user.type(
      screen.getByRole('textbox', { name: 'Message agent' }),
      'Try another hypothesis{Enter}',
    );
    const preview = screen.getByRole('dialog', { name: 'Approve outgoing request' });
    expect(preview.textContent).toContain('Checkpoint evidence');
    expect(preview.textContent).not.toContain('Later evidence');
    expect(preview.textContent).not.toContain('Later question');
    expect(preview.textContent).toContain('Do not replay earlier tool calls');
    await user.click(screen.getByRole('button', { name: 'Approve and send' }));
    await screen.findByText('Branch finding');
    const branchCall = native.invoke.mock.calls[2][1];
    expect(branchCall.sessionKey).not.toBe(first.sessionKey);
    expect(branchCall.systemPrompt).toBeTruthy();
    expect(branchCall.payload).toContain('Original question');
    expect(branchCall.payload).not.toContain('Later question');
    await user.click(screen.getByRole('button', { name: 'Return to original' }));
    expect(screen.getByText('Later finding')).toBeTruthy();
    expect(screen.queryByText('Branch finding')).toBeNull();
  },
);
it('prevents branching an in-flight request or a pending outgoing approval', async () => {
  let finish!: (text: string) => void;
  native.invoke.mockImplementation((_command, args) => {
    args.onEvent.onmessage({ type: 'started' });
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const onBranch = vi.fn();
  const user = userEvent.setup();
  render(<AgentChat {...chatProps} onBranch={onBranch} />);
  await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'Investigate{Enter}');
  const button = await screen.findByRole('button', { name: 'Branch from message 1' });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  await user.click(button);
  expect(onBranch).not.toHaveBeenCalled();
  await act(async () => finish('{"text":"Done","blocks":[]}'));
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  await user.click(screen.getByRole('checkbox', { name: 'Review before sending' }));
  await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'Continue{Enter}');
  expect((button as HTMLButtonElement).disabled).toBe(true);
});
