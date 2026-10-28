import { ArrowRight, X } from 'lucide-react';
import FullscreenSection from '../components/FullscreenSection';
import { CONTEXT_BUDGETS } from './contextConfig';
import type { EvidenceController } from './useEvidenceSession';

export default function ContextPreview({ evidence }: { evidence: EvidenceController }) {
  const {
    preview,
    setPreview,
    budget,
    changeBudget,
    approved,
    setApproved,
    attachContext,
    download,
  } = evidence;
  if (preview === null) return null;
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Review context before export"
      >
        <div className="section-heading">
          <div>
            <div className="eyebrow">YOU CONTROL WHAT LEAVES</div>
            <h2>Review compacted context</h2>
          </div>
          <button
            autoFocus
            className="icon-button"
            aria-label="Close preview"
            onClick={() => setPreview(null)}
          >
            <X />
          </button>
        </div>
        <p>
          Only this sanitized payload is exported or attached to the agent. The
          original-to-placeholder mapping stays on this device. File names are replaced with generic
          identifiers. Duplicate lines are removed and excerpts share a character budget.
        </p>
        <label className="budget">
          Content budget{' '}
          <select value={budget} onChange={(e) => changeBudget(Number(e.target.value))}>
            {CONTEXT_BUDGETS.map((value) => (
              <option key={value} value={value}>
                {value.toLocaleString('en-US')} characters
              </option>
            ))}
          </select>
          <span>{preview.length.toLocaleString()} total characters including metadata</span>
        </label>
        <FullscreenSection title="Context preview">
          <pre>{preview}</pre>
        </FullscreenSection>
        <label className="check-label">
          <input
            type="checkbox"
            checked={approved}
            onChange={(e) => setApproved(e.target.checked)}
          />{' '}
          I reviewed this payload for sensitive information.
        </label>
        <div className="modal-actions">
          <span>Export or attach this reviewed snapshot to session chat.</span>
          <button className="secondary" disabled={!approved} onClick={attachContext}>
            Attach to session chat
          </button>
          <button className="primary" disabled={!approved} onClick={download}>
            Export reviewed JSON <ArrowRight size={16} />
          </button>
        </div>
      </section>
    </div>
  );
}
