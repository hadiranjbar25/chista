// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ModelPicker from './ModelPicker';
afterEach(cleanup);
const props = {
  agent: 'claude' as const,
  value: '',
  options: [
    { id: 'model-fast', label: 'Fast model' },
    { id: 'model-deep', label: 'Deep model' },
  ],
  loading: false,
  error: '',
  onChange: vi.fn(),
  onLoad: vi.fn(),
};
it('searches models and selects with Enter without sending the surrounding chat form', async () => {
  const submit = vi.fn(),
    change = vi.fn();
  const user = userEvent.setup();
  render(
    <form onSubmit={submit}>
      <ModelPicker {...props} compact onChange={change} />
    </form>,
  );
  await user.click(screen.getByRole('button', { name: /^Chat model:/ }));
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search models' }));
  await user.type(screen.getByRole('textbox', { name: 'Search models' }), 'model-deep{Enter}');
  expect(change).toHaveBeenCalledExactlyOnceWith('model-deep');
  expect(submit).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Chat model:/ }));
});
it('supports Escape, outside clicks and closing when the chat becomes busy', async () => {
  const user = userEvent.setup();
  const view = render(
    <>
      <ModelPicker {...props} />
      <button>Outside</button>
    </>,
  );
  const open = () => user.click(screen.getByRole('button', { name: /^Model:/ }));
  await open();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  await open();
  await user.click(screen.getByRole('button', { name: 'Outside' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  await open();
  view.rerender(
    <>
      <ModelPicker {...props} disabled />
      <button>Outside</button>
    </>,
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  expect((screen.getByRole('button', { name: /^Model:/ }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});
it('keeps custom-model entry available when a search has no match', async () => {
  const user = userEvent.setup();
  const change = vi.fn();
  render(<ModelPicker {...props} onChange={change} />);
  await user.click(screen.getByRole('button', { name: /^Model:/ }));
  await user.type(screen.getByRole('textbox', { name: 'Search models' }), 'custom/model');
  const picker = screen.getByRole('dialog', { name: 'Choose a model' });
  expect(within(picker).getByText('No matching models.')).toBeTruthy();
  await user.click(within(picker).getByRole('button', { name: 'Custom model…' }));
  expect((screen.getByRole('textbox', { name: 'Custom model ID' }) as HTMLInputElement).value).toBe(
    'custom/model',
  );
  await user.click(screen.getByRole('button', { name: 'Use model' }));
  expect(change).toHaveBeenCalledExactlyOnceWith('custom/model');
});
