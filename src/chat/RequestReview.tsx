import { X } from 'lucide-react';
import FullscreenSection from '../components/FullscreenSection';
import { claudePayload } from '../integrations/claude';
import { nativeTurnPreview } from '../integrations/conversation';
import { hostedBody } from '../integrations/providers';
import type { PendingRequest } from './chatTypes';

export default function RequestReview({
  pending,
  onDeny,
  onApprove,
}: {
  pending: PendingRequest;
  onDeny: () => void;
  onApprove: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Approve outgoing request"
      >
        <div className="section-heading">
          <h2>Review outgoing message</h2>
          <button aria-label="Deny and close" onClick={onDeny}>
            <X size={16} />
          </button>
        </div>
        <p>
          {pending.mode !== 'hosted'
            ? `Destination: ${pending.mode === 'codex' ? 'Codex' : 'Claude Code'} CLI → cloud provider. Only this reviewed conversation is sent; local mappings and repository files are excluded.`
            : `Destination: ${pending.config.endpoint} · model: ${pending.config.model}`}
        </p>
        {pending.turn?.systemPrompt === null && (
          <p>
            Continuing this session: only the new message is sent. The agent retains the earlier
            conversation and instructions.
          </p>
        )}
        <FullscreenSection title="Outgoing request">
          <pre>
            {pending.mode !== 'hosted'
              ? pending.turn
                ? nativeTurnPreview(pending.turn)
                : claudePayload(pending.request)
              : JSON.stringify(hostedBody(pending.config.model, pending.request), null, 2)}
          </pre>
        </FullscreenSection>
        <p>
          Pattern detection may miss sensitive values. Deny to edit anything you do not want to
          share.
        </p>
        <div className="modal-actions">
          <button onClick={onDeny}>Deny / edit</button>
          <button autoFocus className="primary" onClick={onApprove}>
            Approve and send
          </button>
        </div>
      </section>
    </div>
  );
}
