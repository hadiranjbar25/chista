// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import FullscreenSection from './FullscreenSection';
import AgentResponse from '../chat/AgentResponse';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('preserves controls, traps keyboard focus and restores the layout with Escape', async () => {
  const user = userEvent.setup();
  render(
    <FullscreenSection title="Editor">
      <input aria-label="Notes" defaultValue="Keep this" />
    </FullscreenSection>,
  );
  const input = screen.getByRole('textbox');
  await user.type(input, ' text');
  await user.click(screen.getByRole('button', { name: 'Expand Editor' }));
  expect(screen.getByRole('dialog', { name: 'Editor' })).toBeTruthy();
  expect(screen.getByRole('textbox')).toBe(input);
  expect(document.body.style.overflow).toBe('hidden');
  await user.click(input);
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Restore Editor' }));
  await user.tab({ shift: true });
  expect(document.activeElement).toBe(input);
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Keep this text');
  expect(document.body.style.overflow).toBe('');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Expand Editor' }));
});

it('keeps only one expanded section and cleans up when an expanded section unmounts', async () => {
  const user = userEvent.setup();
  const view = render(
    <FullscreenSection title="Outer">
      <FullscreenSection title="Inner">
        <input aria-label="Value" />
      </FullscreenSection>
    </FullscreenSection>,
  );
  await user.click(screen.getByRole('button', { name: 'Expand Outer' }));
  await user.click(screen.getByRole('button', { name: 'Expand Inner' }));
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(screen.getByRole('dialog', { name: 'Inner' })).toBeTruthy();
  view.unmount();
  expect(document.body.style.overflow).toBe('');
  expect(document.querySelector('.fullscreen-ancestor')).toBeNull();
});

it('preserves an OpenUI table filter and form values through expand and restore', async () => {
  const user = userEvent.setup();
  render(
    <AgentResponse
      onFollow={() => {}}
      content={JSON.stringify({
        text: 'Evidence',
        blocks: [
          { type: 'table', title: 'Requests', columns: ['Status'], rows: [['ERROR'], ['INFO']] },
          { type: 'input', title: 'Investigation note' },
        ],
      })}
    />,
  );
  const search = screen.getByRole('textbox', { name: 'Search Requests' });
  await user.type(search, 'ERROR');
  await user.click(screen.getByRole('button', { name: 'Expand Requests' }));
  expect(screen.getByRole('textbox', { name: 'Search Requests' })).toBe(search);
  expect(screen.queryByRole('cell', { name: 'INFO' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Restore Requests' }));
  const note = screen.getByRole('textbox', { name: 'Investigation note' });
  await user.type(note, 'Inspect retries');
  await user.click(screen.getByRole('button', { name: 'Expand Investigation note' }));
  await act(async () => {});
  expect((note as HTMLTextAreaElement).value).toBe('Inspect retries');
  await user.keyboard('{Escape}');
  expect(screen.getByRole('textbox', { name: 'Investigation note' })).toBe(note);
});

it('restores the original page position after nested expansion', async () => {
  let y = 400;
  vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => y);
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation((options) => {
    y = (options as ScrollToOptions).top ?? 0;
  });
  const user = userEvent.setup();
  render(
    <FullscreenSection title="Page">
      <FullscreenSection title="Card">Content</FullscreenSection>
    </FullscreenSection>,
  );
  await user.click(screen.getByRole('button', { name: 'Expand Page' }));
  y = 0;
  await user.click(screen.getByRole('button', { name: 'Expand Card' }));
  await user.keyboard('{Escape}');
  expect(scroll).toHaveBeenLastCalledWith({ left: 0, top: 400, behavior: 'instant' });
});
