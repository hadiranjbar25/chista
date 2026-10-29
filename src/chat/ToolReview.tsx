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
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={tool.kind === 'http' ? 'Approve API request' : 'Approve MCP tool'}
      >
        <h2>{tool.kind === 'http' ? 'Send this API request?' : 'Run this MCP tool?'}</h2>
        <p>
          {tool.server} · {tool.tool}
        </p>
        <p>
          {tool.kind === 'http'
            ? 'Review the exact URL, method, headers, and body below. Chista will send these sanitized values using curl. This request may change remote data. Redirects are not followed.'
            : 'These locally sanitized arguments will be sent to the server. This tool may change remote data.'}
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
