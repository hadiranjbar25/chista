// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChoiceGroup from './ChoiceGroup';
afterEach(cleanup);
it('supports keyboard selection, skips disabled choices, and never submits its enclosing form', async () => {
  const submit = vi.fn();
  function Choices() {
    const [value, setValue] = useState('one');
    return (
      <form onSubmit={submit}>
        <ChoiceGroup
          label="Workflow"
          value={value}
          onChange={setValue}
          options={[
            { value: 'one', label: 'First' },
            { value: 'two', label: 'Unavailable', disabled: true },
            { value: 'three', label: 'Third' },
          ]}
        />
      </form>
    );
  }
  const user = userEvent.setup();
  render(<Choices />);
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'First' }));
  await user.keyboard('{ArrowRight}');
  expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Third' }));
  expect(screen.getByRole('radio', { name: 'Third' }).getAttribute('aria-checked')).toBe('true');
  await user.keyboard('{Home}');
  expect(screen.getByRole('radio', { name: 'First' }).getAttribute('aria-checked')).toBe('true');
  await user.keyboard('{Enter}');
  expect(submit).not.toHaveBeenCalled();
});
it('blocks interaction while its parent workflow is busy', async () => {
  const change = vi.fn();
  const user = userEvent.setup();
  render(
    <ChoiceGroup
      label="Workflow"
      value="one"
      onChange={change}
      disabled
      options={[
        { value: 'one', label: 'First' },
        { value: 'two', label: 'Second' },
      ]}
    />,
  );
  await user.click(screen.getByRole('radio', { name: 'Second' }));
  expect(change).not.toHaveBeenCalled();
});
