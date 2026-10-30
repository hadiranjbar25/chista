// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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

it('loads CLI choices on demand and retains independent selections for both agents', async () => {
  const user = userEvent.setup();
  render(<Settings />);
  expect(native.invoke).not.toHaveBeenCalled();
  await user.click(screen.getByRole('combobox', { name: 'Model' }));
  await screen.findByRole('option', { name: 'codex fixture' });
  expect(native.invoke).toHaveBeenCalledWith('agent_models', {
    agent: 'codex',
    executablePath: '',
  });
  await user.selectOptions(screen.getByRole('combobox', { name: 'Model' }), 'codex-fixture');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Active agent' }), 'claude');
  expect((screen.getByRole('combobox', { name: 'Model' }) as HTMLSelectElement).value).toBe('');
  await user.click(screen.getByRole('combobox', { name: 'Model' }));
  await screen.findByRole('option', { name: 'claude fixture' });
  await user.selectOptions(screen.getByRole('combobox', { name: 'Model' }), 'claude-fixture');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Active agent' }), 'codex');
  expect((screen.getByRole('combobox', { name: 'Model' }) as HTMLSelectElement).value).toBe(
    'codex-fixture',
  );
});

it('supports custom models when discovery fails and rejects command flags', async () => {
  native.invoke.mockRejectedValue(new Error('private provider error'));
  const user = userEvent.setup();
  render(<Settings />);
  await user.click(screen.getByRole('button', { name: 'Refresh models' }));
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
