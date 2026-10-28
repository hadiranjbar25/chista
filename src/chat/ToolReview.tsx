import FullscreenSection from '../components/FullscreenSection';
import type { ToolApproval } from '../integrations/cliTools';

export default function ToolReview({
  tool,
  onDecide,
  onStop,
}: {
  tool: ToolApproval;
  onDecide: (approved: boolean) => void;
  onStop: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <section className="modal" role="dialog" aria-modal="true" aria-label="Approve MCP tool">
        <h2>Run this MCP tool?</h2>
        <p>
          {tool.server} · {tool.tool}
        </p>
        <p>
          These locally sanitized arguments will be sent to the server. This tool may change remote
          data.
        </p>
        <FullscreenSection title="Tool arguments">
          <pre>{JSON.stringify(tool.arguments, null, 2)}</pre>
        </FullscreenSection>
        <div className="modal-actions">
          <button onClick={() => onDecide(false)}>Deny tool</button>
          <button className="primary" onClick={() => onDecide(true)}>
            Approve tool once
          </button>
          <button onClick={onStop}>Stop</button>
        </div>
      </section>
    </div>
  );
}
