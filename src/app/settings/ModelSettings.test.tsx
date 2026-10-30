// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
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

it('loads the selected CLI automatically and retains independent selections for both agents', async () => {
  const user = userEvent.setup();
  render(<Settings />);
  await screen.findByRole('option', { name: 'codex fixture' });
  expect(native.invoke).toHaveBeenCalledWith('agent_models', {
    agent: 'codex',
    executablePath: '',
  });
  await user.selectOptions(screen.getByRole('combobox', { name: 'Model' }), 'codex-fixture');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Active agent' }), 'claude');
  expect((screen.getByRole('combobox', { name: 'Model' }) as HTMLSelectElement).value).toBe('');
  await screen.findByRole('option', { name: 'claude fixture' });
  expect(screen.queryByRole('option', { name: 'codex fixture' })).toBeNull();
  expect(native.invoke).toHaveBeenCalledWith('agent_models', {
    agent: 'claude',
    executablePath: '',
  });
  await user.selectOptions(screen.getByRole('combobox', { name: 'Model' }), 'claude-fixture');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Active agent' }), 'codex');
  await screen.findByRole('option', { name: 'codex fixture' });
  expect((screen.getByRole('combobox', { name: 'Model' }) as HTMLSelectElement).value).toBe(
    'codex-fixture',
  );
  expect(screen.queryByRole('option', { name: 'claude fixture' })).toBeNull();
});

it('supports custom models when discovery fails and rejects command flags', async () => {
  native.invoke.mockRejectedValue(new Error('private provider error'));
  const user = userEvent.setup();
  render(<Settings />);
  expect(
    await screen.findByText(
      'Could not load models. Use the CLI default or enter a custom model ID.',
    ),
  ).toBeTruthy();
  expect(screen.queryByText('private provider error')).toBeNull();
  await user.selectOptions(screen.getByRole('combobox', { name: 'Model' }), '__custom__');
  await user.type(screen.getByRole('textbox', { name: 'Custom model ID' }), '--unsafe');
  await user.click(screen.getByRole('button', { name: 'Use model' }));
  expect(screen.getByRole('alert').textContent).toContain('valid model ID');
  await user.clear(screen.getByRole('textbox', { name: 'Custom model ID' }));
  await user.type(
    screen.getByRole('textbox', { name: 'Custom model ID' }),
    'provider/custom-model{Enter}',
  );
  expect((screen.getByRole('combobox', { name: 'Model' }) as HTMLSelectElement).value).toBe(
    'provider/custom-model',
  );
  await user.selectOptions(screen.getByRole('combobox', { name: 'Model' }), '');
  expect((screen.getByRole('combobox', { name: 'Model' }) as HTMLSelectElement).value).toBe('');
});

it('ignores an older catalog response when switching away and back to an agent', async () => {
  const codexReplies: ((models: { id: string; label: string }[]) => void)[] = [];
  native.invoke.mockImplementation(async (_command, { agent }) => {
    if (agent === 'claude') return [{ id: 'claude-current', label: 'Claude current' }];
    return new Promise((resolve) => {
      codexReplies.push(resolve);
    });
  });
  const user = userEvent.setup();
  render(<Settings />);
  expect((screen.getByRole('combobox', { name: 'Model' }) as HTMLSelectElement).disabled).toBe(
    true,
  );
  await user.selectOptions(screen.getByRole('combobox', { name: 'Active agent' }), 'claude');
  await screen.findByRole('option', { name: 'Claude current' });
  await user.selectOptions(screen.getByRole('combobox', { name: 'Active agent' }), 'codex');
  await act(async () => codexReplies[1]([{ id: 'codex-current', label: 'Codex current' }]));
  await screen.findByRole('option', { name: 'Codex current' });
  await act(async () => codexReplies[0]([{ id: 'codex-stale', label: 'Codex stale' }]));
  expect(screen.queryByRole('option', { name: 'Codex stale' })).toBeNull();
  expect(screen.queryByRole('option', { name: 'Claude current' })).toBeNull();
});

it('reloads Claude models automatically when its executable path changes', async () => {
  native.invoke.mockImplementation(async (_command, { agent, executablePath }) => [
    {
      id: `${agent}-fixture`,
      label: executablePath ? `From ${executablePath}` : `${agent} fixture`,
    },
  ]);
  const user = userEvent.setup();
  render(<Settings />);
  await screen.findByRole('option', { name: 'codex fixture' });
  await user.selectOptions(screen.getByRole('combobox', { name: 'Active agent' }), 'claude');
  await screen.findByRole('option', { name: 'claude fixture' });
  await user.click(screen.getByText('Claude Code', { selector: 'strong' }));
  await user.type(
    screen.getByRole('textbox', { name: 'Executable path (optional)' }),
    '/custom/claude',
  );
  await screen.findByRole('option', { name: 'From /custom/claude' });
  expect(native.invoke).toHaveBeenCalledWith('agent_models', {
    agent: 'claude',
    executablePath: '/custom/claude',
  });
  expect(screen.queryByRole('option', { name: 'claude fixture' })).toBeNull();
  expect(screen.queryByRole('option', { name: 'codex fixture' })).toBeNull();
});
