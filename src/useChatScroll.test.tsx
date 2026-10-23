// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useChatScroll } from './useChatScroll';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function Chat({ active = true, text = 'Answer' }) {
  const { content, paused, jumpToLatest } = useChatScroll(active);
  return <><div ref={content}>{text}</div>{paused && <button onClick={jumpToLatest}>Jump to latest</button>}</>;
}
function viewport() {
  let height = 2000;
  let y = 0;
  let resized = () => {};
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockImplementation(() => height);
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
  vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => y);
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation((options) => {
    y = (options as ScrollToOptions).top ?? y;
  });
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback; }
    observe() {} disconnect() {}
  });
  return {
    scroll,
    grow(next: number) { height = next; act(() => resized()); },
    move(next: number) { y = next; fireEvent.scroll(window); },
  };
}
it('follows growing output, pauses for reading, and resumes on request or at the bottom', () => {
  const page = viewport();
  const view = render(<Chat/>);
  expect(page.scroll).toHaveBeenLastCalledWith({ top: 1400, behavior: 'instant' });
  page.grow(2400);
  expect(page.scroll).toHaveBeenLastCalledWith({ top: 1800, behavior: 'instant' });
  page.move(1200);
  expect(screen.getByRole('button')).toBeTruthy();
  page.scroll.mockClear();
  page.grow(2800);
  view.rerender(<Chat text="More streaming text"/>);
  expect(page.scroll).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button'));
  expect(page.scroll).toHaveBeenLastCalledWith({ top: 2200, behavior: 'instant' });
  expect(screen.queryByRole('button')).toBeNull();
  page.move(1000);
  page.move(2200);
  page.grow(3000);
  expect(page.scroll).toHaveBeenLastCalledWith({ top: 2400, behavior: 'instant' });
});
it('never scrolls for hidden sessions or their late layout changes', () => {
  const page = viewport();
  const view = render(<Chat active={false}/>);
  page.grow(2400);
  expect(page.scroll).not.toHaveBeenCalled();
  view.rerender(<Chat/>);
  expect(page.scroll).toHaveBeenCalled();
  view.rerender(<Chat active={false}/>);
  page.scroll.mockClear();
  page.grow(3000);
  // A disconnected observer can still have an already queued callback.
  // React's hidden session must not affect the active conversation.
  expect(page.scroll).not.toHaveBeenCalled();
});
