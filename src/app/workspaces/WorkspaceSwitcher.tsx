import { WORKSPACE_NAME_LIMIT } from './workspaceConfig';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Plus, Settings } from 'lucide-react';
import type { Workspace } from './workspace';

export default function WorkspaceSwitcher({
  workspaces,
  selected,
  onSelect,
  onConfigure,
  onCreate,
}: {
  workspaces: Workspace[];
  selected: Workspace;
  onSelect: (id: string) => void;
  onConfigure: () => void;
  onCreate: (name: string) => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  function close() {
    if (menu.current) menu.current.open = false;
    setCreating(false);
    setName('');
  }
  useEffect(() => {
    const dismiss = (event: Event) => {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target) &&
        menu.current?.open
      )
        close();
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('focusin', dismiss);
    };
  }, []);
  return (
    <details
      ref={menu}
      className="workspace-switcher"
      onToggle={(e) => {
        if (!e.currentTarget.open) {
          setCreating(false);
          setName('');
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
          menu.current?.querySelector('summary')?.focus();
        }
      }}
    >
      <summary role="button" aria-label="Switch workspace" title="Switch or manage workspace">
        <span>{selected.name}</span>
        <ChevronDown size={14} />
      </summary>
      <div className="workspace-switcher-panel">
        {creating ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) {
                onCreate(name);
                close();
              }
            }}
          >
            <label htmlFor="new-workspace-name">New workspace</label>
            <input
              id="new-workspace-name"
              autoFocus
              aria-label="Workspace name"
              maxLength={WORKSPACE_NAME_LIMIT}
              placeholder="Workspace name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setName('');
                }}
              >
                Cancel
              </button>
              <button type="submit" disabled={!name.trim()}>
                Create workspace
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="workspace-switcher-list">
              {workspaces.map((w) => (
                <button
                  key={w.id}
                  aria-current={w.id === selected.id ? 'true' : undefined}
                  onClick={() => {
                    onSelect(w.id);
                    close();
                  }}
                >
                  <span>{w.name}</span>
                  {w.id === selected.id && <Check size={14} />}
                </button>
              ))}
            </div>
            <div className="workspace-switcher-actions">
              <button
                onClick={() => {
                  onConfigure();
                  close();
                }}
              >
                <Settings size={14} />
                Workspace config
              </button>
              <button onClick={() => setCreating(true)}>
                <Plus size={14} />
                New workspace
              </button>
            </div>
          </>
        )}
      </div>
    </details>
  );
}
