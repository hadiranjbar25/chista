import { useEffect, useRef } from 'react';
import { Ellipsis, Files, Trash2 } from 'lucide-react';

type Props = {
  sessionName: string;
  showingFiles: boolean;
  onRemove: () => void;
  onFiles: () => void;
};

export default function SessionToolbar({ sessionName, showingFiles, onRemove, onFiles }: Props) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    // WebKit may report a null relatedTarget when a menu button is clicked.
    // Dismiss on outside pointer/focus events, not blur, so its click can finish.
    const dismiss = (event: Event) => {
      const element = menu.current;
      if (element && event.target instanceof Node && !element.contains(event.target)) {
        element.open = false;
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('focusin', dismiss);
    };
  }, []);
  return (
    <div className={`workspace-toolbar${showingFiles ? ' workspace-toolbar-files' : ''}`}>
      <h2>{sessionName}</h2>
      <details
        ref={menu}
        className="session-actions-menu"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.currentTarget.open = false;
            event.currentTarget.querySelector('summary')?.focus();
          }
        }}
      >
        <summary role="button" aria-label="Session actions" title="Session actions">
          <Ellipsis size={18} />
        </summary>
        <div className="session-actions-list">
          <button
            aria-label="Remove session"
            onClick={() => {
              if (menu.current) menu.current.open = false;
              onRemove();
            }}
          >
            <Trash2 size={14} />
            Remove session
          </button>
        </div>
      </details>
      <button className="workspace-files-button" aria-pressed={showingFiles} onClick={onFiles}>
        <Files size={15} />
        Files &amp; mappings
      </button>
    </div>
  );
}
