import { useEffect, useRef } from 'react';
import { Ellipsis, Files } from 'lucide-react';

type Props = {
  sessionName: string;
  canClose: boolean;
  showingFiles: boolean;
  onClose: () => void;
  onFiles: () => void;
};

export default function SessionToolbar({
  sessionName,
  canClose,
  showingFiles,
  onClose,
  onFiles,
}: Props) {
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
    <div className="workspace-toolbar">
      <h2>{sessionName}</h2>
      {canClose && (
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
              aria-label="Close session"
              onClick={() => {
                if (menu.current) menu.current.open = false;
                onClose();
              }}
            >
              Close session
            </button>
          </div>
        </details>
      )}
      <button className="workspace-files-button" aria-pressed={showingFiles} onClick={onFiles}>
        <Files size={15} />
        Files &amp; mappings
      </button>
    </div>
  );
}
