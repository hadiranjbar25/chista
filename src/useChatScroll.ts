import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

// Follow either the document or the expanded chat's own scroll area.
export function useChatScroll(active: boolean) {
  const content = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const previousY = useRef(0);
  const [paused, setPaused] = useState(false);
  const frame=useCallback(()=>{
    const fullscreen=content.current?.closest<HTMLElement>('.focus-section.is-fullscreen');
    return fullscreen?.querySelector<HTMLElement>(':scope > .focus-content') ?? null;
  },[]);
  const follow = useCallback(() => {
    if (!active || !following.current) return;
    const target=frame();
    // Expanding an individual reply should leave the background chat still.
    if(!target && document.querySelector('.focus-section.is-fullscreen'))return;
    const end=Math.max(0,target?target.scrollHeight-target.clientHeight:document.documentElement.scrollHeight-window.innerHeight);
    const y=target?target.scrollTop:window.scrollY;
    if(end!==y){if(target)target.scrollTo({top:end,behavior:'instant'});else window.scrollTo({top:end,behavior:'instant'});}
    previousY.current=target?target.scrollTop:window.scrollY;
  }, [active,frame]);
  const jumpToLatest = useCallback(() => {
    following.current = true;
    setPaused(false);
    follow();
  }, [follow]);

  useLayoutEffect(() => { follow(); });
  useEffect(() => {
    if (!active) return;
    const target=frame();
    previousY.current=target?target.scrollTop:window.scrollY;
    const onScroll = (event: Event) => {
      const target=frame();
      if(target && event.target!==target)return;
      if(!target && document.querySelector('.focus-section.is-fullscreen'))return;
      if(!target && event.target instanceof HTMLElement && event.target!==document.documentElement && event.target!==document.body)return;
      const y=target?target.scrollTop:window.scrollY;
      const distance=target?target.scrollHeight-target.clientHeight-y:document.documentElement.scrollHeight-window.innerHeight-y;
      if (y < previousY.current - 1) following.current = false;
      else if (distance <= 40) following.current = true;
      previousY.current = y;
      setPaused(!following.current);
    };
    window.addEventListener('scroll',onScroll,{passive:true});
    document.addEventListener('scroll',onScroll,{passive:true,capture:true});
    window.addEventListener('resize',follow);
    window.addEventListener('chista:section-focus',follow);
    let disposed = false;
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => {
      if (!disposed) follow();
    });
    if (content.current) observer?.observe(content.current);
    return () => {
      disposed = true;
      window.removeEventListener('scroll',onScroll);
      document.removeEventListener('scroll',onScroll,true);
      window.removeEventListener('resize',follow);
      window.removeEventListener('chista:section-focus',follow);
      observer?.disconnect();
    };
  }, [active,follow,frame]);
  return { content, paused, jumpToLatest };
}
