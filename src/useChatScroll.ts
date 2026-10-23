import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

// The conversation uses the document scrollbar; keep the composer and latest
// response visible, but stop following as soon as the reader scrolls upward.
export function useChatScroll(active: boolean) {
  const content = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const previousY = useRef(0);
  const [paused, setPaused] = useState(false);
  const follow = useCallback(() => {
    if (!active || !following.current) return;
    const end = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    if (end !== window.scrollY) window.scrollTo({ top: end, behavior: 'instant' });
    previousY.current = window.scrollY;
  }, [active]);
  const jumpToLatest = useCallback(() => {
    following.current = true;
    setPaused(false);
    follow();
  }, [follow]);

  useLayoutEffect(() => { follow(); });
  useEffect(() => {
    if (!active) return;
    previousY.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const distance = document.documentElement.scrollHeight - window.innerHeight - y;
      if (y < previousY.current - 1) following.current = false;
      else if (distance <= 40) following.current = true;
      previousY.current = y;
      setPaused(!following.current);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', follow);
    // OpenUI charts/tables can change size after the final message renders.
    let disposed = false;
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => {
      if (!disposed) follow();
    });
    if (content.current) observer?.observe(content.current);
    return () => {
      disposed = true;
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', follow);
      observer?.disconnect();
    };
  }, [active, follow]);
  return { content, paused, jumpToLatest };
}
