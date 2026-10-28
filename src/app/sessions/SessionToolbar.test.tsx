// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SessionToolbar from './SessionToolbar';

afterEach(cleanup);

it('dismisses session actions on Escape and outside interaction without closing the session', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(
    <SessionToolbar
      sessionName="Investigation"
      canClose
      showingFiles={false}
      onClose={onClose}
      onFiles={() => {}}
    />,
  );
  const trigger = screen.getByRole('button', { name: 'Session actions' });
  const menu = trigger.closest('details')!;

  await user.click(trigger);
  expect(menu.open).toBe(true);
  await user.keyboard('{Escape}');
  expect(menu.open).toBe(false);
  expect(document.activeElement).toBe(trigger);

  await user.click(trigger);
  await user.click(screen.getByRole('heading', { name: 'Investigation' }));
  expect(menu.open).toBe(false);
  expect(onClose).not.toHaveBeenCalled();
});

it('closes the selected session without losing the menu click', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(
    <SessionToolbar
      sessionName="Investigation"
      canClose
      showingFiles={false}
      onClose={onClose}
      onFiles={() => {}}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Session actions' }));
  await user.click(screen.getByRole('button', { name: 'Close session' }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Session actions' }).closest('details')!.open).toBe(
    false,
  );
});
