import { ShieldCheck } from 'lucide-react';
import type { McpStatus } from '../integrations/cliTools';

type StatusProps = {
  context: string | null;
  hasAttachments: boolean;
  mode: string;
  mcpServers: McpStatus[];
  onFiles: () => void;
  busy: boolean;
  refreshingMcp: boolean;
  refreshMcp: () => Promise<void>;
  signInMcp: (server: string) => Promise<void>;
};
export function ChatStatus({
  context,
  hasAttachments,
  mode,
  mcpServers,
  onFiles,
  busy,
  signInMcp,
  refreshingMcp,
  refreshMcp,
}: StatusProps) {
  return (
    <div className="chat-status">
      {context && !hasAttachments && (
        <button className="context-chip" onClick={onFiles}>
          <ShieldCheck size={14} />
          {context.length.toLocaleString()} characters of reviewed context attached
        </button>
      )}
      {(mode === 'codex' || mode === 'claude') && mcpServers.length > 0 && (
        <details className="mcp-connections">
          <summary>
            MCP connections ·{' '}
            {
              mcpServers.filter(
                (server) =>
                  server.available && !server.failed && server.authStatus !== 'notLoggedIn',
              ).length
            }{' '}
            available
          </summary>
          <div className="mcp-connection-toolbar">
            <button type="button" disabled={busy} onClick={() => void refreshMcp()}>
              {refreshingMcp ? 'Refreshing connections…' : 'Refresh connections'}
            </button>
          </div>
          <ul>
            {mcpServers.map((server) => (
              <li key={server.name}>
                <strong>{server.name}</strong>
                <div className="mcp-connection-actions">
                  <span>
                    {server.authStatus === 'notLoggedIn'
                      ? 'Sign-in required'
                      : server.failed
                        ? 'Connection failed'
                        : server.available
                          ? 'Tools available'
                          : 'No tools available'}
                  </span>
                  {server.authStatus === 'notLoggedIn' && (
                    <button disabled={busy} onClick={() => void signInMcp(server.name)}>
                      Sign in
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
