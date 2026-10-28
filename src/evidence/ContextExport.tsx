import { ArrowRight, CheckCheck, LockKeyhole } from 'lucide-react';

export default function ContextExport({
  selectedCount,
  prepareContext,
}: {
  selectedCount: number;
  prepareContext: () => void;
}) {
  return (
    <>
      {' '}
      <footer>
        <div>
          <span className="footer-icon">
            <CheckCheck size={19} />
          </span>
          <div>
            <strong>
              {selectedCount
                ? `${selectedCount} artifact${selectedCount > 1 ? 's' : ''} selected for context`
                : 'Your next insight starts here'}
            </strong>
            <span>Compact, review, then export. You stay in control.</span>
          </div>
        </div>
        <button className="primary" disabled={!selectedCount} onClick={prepareContext}>
          Prepare context <ArrowRight size={16} />
        </button>
      </footer>
      <div className="bottom-caption">
        <LockKeyhole size={12} /> Artifacts stay in memory · only reviewed context can be attached
        to chat
      </div>
    </>
  );
}
