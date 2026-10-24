import { useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import type { Session } from './workspace';

export default function SessionNavItem({ session, selected, onSelect, onRename }: {
  session: Session; selected: boolean; onSelect: () => void; onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const cancelled = useRef(false);
  function edit() { cancelled.current = false; setDraft(session.name); setEditing(true); }
  function save() {
    if (!cancelled.current && draft.trim()) onRename(draft.trim());
    setEditing(false);
  }
  return <div className={'session-nav-row' + (selected ? ' chosen' : '')}>
    {editing ? <form onSubmit={event => { event.preventDefault(); save(); }}>
      <input autoFocus aria-label="Session name" maxLength={60} value={draft}
        onFocus={event => event.target.select()} onChange={event => setDraft(event.target.value)}
        onBlur={save} onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); cancelled.current = true; setEditing(false); }
          if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault();
        }}/>
    </form> : <>
      <button className="session-select" aria-current={selected ? 'page' : undefined} title={session.name} onClick={onSelect} onDoubleClick={edit}><span className="green-dot"/><span>{session.name}</span></button>
      <button className="session-rename" aria-label={`Rename ${session.name}`} title="Rename session" onClick={edit}><Pencil size={12}/></button>
    </>}
  </div>;
}
