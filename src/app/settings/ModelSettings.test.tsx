// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: native.invoke }));
import ModelSettings from './ModelSettings';
import { useAgentSettings } from './useAgentSettings';
function Settings() {
  return <ModelSettings settings={useAgentSettings(vi.fn())} />;
}
beforeEach(() => {
  native.invoke
    .mockReset()
    .mockImplementation(async (_command, { agent }) => [
      { id: `${agent}-fixture`, label: `${agent} fixture` },
    ]);
});
afterEach(cleanup);
const agent = (name: string) =>
  within(screen.getByRole('radiogroup', { name: 'Active agent' })).getByRole('radio', { name });
async function openModels(user: ReturnType<typeof userEvent.setup>) {
  const trigger = screen.getByRole('button', { name: /^Model:/ });
  await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
  if (!screen.queryByRole('dialog', { name: 'Choose a model' })) await user.click(trigger);
  return screen.getByRole('dialog', { name: 'Choose a model' });
}
it('retains independent models while switching agents with visible choices', async () => {
  const user = userEvent.setup();
  render(<Settings />);
  let picker = await openModels(user);
  expect(native.invoke).toHaveBeenCalledWith('agent_models', {
    agent: 'codex',
    executablePath: '',
  });
  await user.click(within(picker).getByRole('radio', { name: 'codex fixture' }));
  await user.click(agent('Claude Code'));
  expect(screen.getByRole('button', { name: /Model: .*Claude CLI default model/ })).toBeTruthy();
  picker = await openModels(user);
  expect(within(picker).queryByRole('radio', { name: 'codex fixture' })).toBeNull();
  expect(native.invoke).toHaveBeenCalledWith('agent_models', {
    agent: 'claude',
    executablePath: '',
  });
  await user.click(within(picker).getByRole('radio', { name: 'claude fixture' }));
  await user.click(agent('Codex'));
  await openModels(user);
  expect(screen.getByRole('button', { name: 'Model: codex fixture' })).toBeTruthy();
  expect(screen.queryByRole('radio', { name: 'claude fixture' })).toBeNull();
});
it('offers validated custom models when discovery fails and restores the CLI default', async () => {
  native.invoke.mockRejectedValue(new Error('private provider error'));
  const user = userEvent.setup();
  render(<Settings />);
  expect(
    await screen.findByText(
      'Could not load models. Use the CLI default or enter a custom model ID.',
    ),
  ).toBeTruthy();
  expect(screen.queryByText('private provider error')).toBeNull();
  const picker = await openModels(user);
  await user.click(within(picker).getByRole('button', { name: 'Custom model…' }));
  await user.type(screen.getByRole('textbox', { name: 'Custom model ID' }), '--unsafe');
  await user.click(screen.getByRole('button', { name: 'Use model' }));
  expect(screen.getByRole('alert').textContent).toContain('valid model ID');
  await user.clear(screen.getByRole('textbox', { name: 'Custom model ID' }));
  await user.type(
    screen.getByRole('textbox', { name: 'Custom model ID' }),
    'provider/custom-model{Enter}',
  );
  expect(screen.getByRole('button', { name: 'Model: provider/custom-model' })).toBeTruthy();
  await user.click(
    within(await openModels(user)).getByRole('radio', { name: 'Codex CLI default model' }),
  );
  expect(screen.getByRole('button', { name: 'Model: Codex CLI default model' })).toBeTruthy();
});
it('ignores a stale catalog response when switching away and back', async () => {
  const replies: ((models: { id: string; label: string }[]) => void)[] = [];
  native.invoke.mockImplementation(async (_command, { agent }) =>
    agent === 'claude'
      ? [{ id: 'claude-current', label: 'Claude current' }]
      : new Promise((resolve) => replies.push(resolve)),
  );
  const user = userEvent.setup();
  render(<Settings />);
  expect((screen.getByRole('button', { name: /^Model:/ }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  await user.click(agent('Claude Code'));
  expect(
    within(await openModels(user)).getByRole('radio', { name: 'Claude current' }),
  ).toBeTruthy();
  await user.click(agent('Codex'));
  await act(async () => replies[1]([{ id: 'codex-current', label: 'Codex current' }]));
  const picker = await openModels(user);
  expect(within(picker).getByRole('radio', { name: 'Codex current' })).toBeTruthy();
  await act(async () => replies[0]([{ id: 'codex-stale', label: 'Codex stale' }]));
  expect(within(picker).queryByRole('radio', { name: 'Codex stale' })).toBeNull();
  expect(within(picker).queryByRole('radio', { name: 'Claude current' })).toBeNull();
});
it('reloads the model catalog when the executable path changes', async () => {
  native.invoke.mockImplementation(async (_command, { agent, executablePath }) => [
    {
      id: `${agent}-fixture`,
      label: executablePath ? `From ${executablePath}` : `${agent} fixture`,
    },
  ]);
  const user = userEvent.setup();
  render(<Settings />);
  await openModels(user);
  await user.keyboard('{Escape}');
  await user.click(agent('Claude Code'));
  expect(
    within(await openModels(user)).getByRole('radio', { name: 'claude fixture' }),
  ).toBeTruthy();
  await user.keyboard('{Escape}');
  await user.click(screen.getByText('Claude Code', { selector: 'strong' }));
  await user.type(
    screen.getByRole('textbox', { name: 'Executable path (optional)' }),
    '/custom/claude',
  );
  const picker = await openModels(user);
  expect(within(picker).getByRole('radio', { name: 'From /custom/claude' })).toBeTruthy();
  expect(native.invoke).toHaveBeenCalledWith('agent_models', {
    agent: 'claude',
    executablePath: '/custom/claude',
  });
  expect(within(picker).queryByRole('radio', { name: 'claude fixture' })).toBeNull();
});
