import { useState, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import './fullscreen.css';

let current: symbol | null = null;
let origin:{x:number;y:number}|null=null;
const listeners=new Set<()=>void>();
function subscribe(listener:()=>void) {listeners.add(listener);return ()=>{listeners.delete(listener);};}
function select(id:symbol|null) {
  if(current===id)return;
  if(current===null && id!==null)origin={x:window.scrollX,y:window.scrollY};
  const restore=id===null?origin:null;
  if(id===null)origin=null;
  current=id;listeners.forEach(listener=>listener());
  if(restore)queueMicrotask(()=>{
    if(current!==null)return;
    if(window.scrollX!==restore.x || window.scrollY!==restore.y)window.scrollTo({left:restore.x,top:restore.y,behavior:'instant'});
    window.dispatchEvent(new Event('chista:section-focus'));
  });
}
export function exitSectionFullscreen() {select(null);}

// Keep the same DOM and React subtree when expanding. The browser's popover
// top layer avoids ancestor clipping without portals or remounting controls.
export default function FullscreenSection({title,children,className=''}: {title:string;children:ReactNode;className?:string}) {
  const [id]=useState(()=>Symbol('section'));
  const expanded=useSyncExternalStore(subscribe,()=>current,()=>null)===id;
  const root=useRef<HTMLDivElement>(null);
  const button=useRef<HTMLButtonElement>(null);
  const topLayer=typeof HTMLElement!=='undefined' && typeof HTMLElement.prototype.showPopover==='function';
  useLayoutEffect(()=>{
    if(!expanded || !root.current)return;
    const element=root.current;
    const expandButton=button.current;
    const overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    const ancestors:HTMLElement[]=[];
    for(let node:HTMLElement|null=element;node?.parentElement && node!==document.body;node=node.parentElement){
      node.parentElement.classList.add('fullscreen-ancestor');ancestors.push(node.parentElement);
    }
    const onKey=(event:KeyboardEvent)=>{
      if(current!==id || event.defaultPrevented)return;
      if(event.key==='Escape'){event.preventDefault();select(null);return;}
      if(event.key!=='Tab')return;
      const focusable=Array.from(element.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]')).filter(control=>{
        if(control.closest('[hidden]'))return false;
        const closed=control.closest('details:not([open])');
        return (!closed || control.tagName==='SUMMARY') && getComputedStyle(control).display!=='none' && getComputedStyle(control).visibility!=='hidden';
      });
      const first=focusable[0],last=focusable.at(-1);
      if(event.shiftKey && (document.activeElement===first || !element.contains(document.activeElement))){event.preventDefault();last?.focus();}
      else if(!event.shiftKey && (document.activeElement===last || !element.contains(document.activeElement))){event.preventDefault();first?.focus();}
    };
    document.addEventListener('keydown',onKey);
    let disposed=false;
    queueMicrotask(()=>{
      if(disposed || current!==id)return;
      if(!element.isConnected || element.closest('[hidden]')){select(null);return;}
      if(topLayer && !element.matches(':popover-open')){try{element.showPopover();}catch{element.removeAttribute('popover');}}
      button.current?.focus({preventScroll:true});
      window.dispatchEvent(new Event('chista:section-focus'));
    });
    return ()=>{
      disposed=true;
      document.removeEventListener('keydown',onKey);
      if(topLayer && element.matches(':popover-open'))element.hidePopover();
      document.body.style.overflow=overflow;
      ancestors.forEach(ancestor=>ancestor.classList.remove('fullscreen-ancestor'));
      queueMicrotask(()=>{if(current===null && expandButton?.isConnected)expandButton.focus({preventScroll:true});});
      window.dispatchEvent(new Event('chista:section-focus'));
    };
  },[expanded,id,topLayer]);
  useLayoutEffect(()=>()=>{if(current===id)select(null);},[id]);
  return <div ref={root} className={`focus-section ${className}${expanded?' is-fullscreen':''}`} popover={expanded && topLayer?'manual':undefined} role={expanded?'dialog':undefined} aria-modal={expanded?true:undefined} aria-label={expanded?title:undefined}>
    <div className="focus-tools"><span>{title}</span><button ref={button} type="button" className="section-expand-button" aria-label={`${expanded?'Restore':'Expand'} ${title}`} title={expanded?'Restore · Esc':'Full screen'} aria-expanded={expanded} onClick={()=>select(expanded?null:id)}>{expanded?<Minimize2 size={15}/>:<Maximize2 size={15}/>}</button></div>
    <div className="focus-content">{children}</div>
  </div>;
}
