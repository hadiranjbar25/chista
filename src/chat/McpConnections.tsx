import { ShieldCheck } from 'lucide-react';
import type { McpStatus } from '../integrations/cliTools';

type StatusProps = {
  context: string | null;
  hasAttachments: boolean;
  mode: string;
  mcpServers: McpStatus[];
  onFiles: () => void;
};
export function ChatStatus({ context, hasAttachments, mode, mcpServers, onFiles }: StatusProps) {
  return (
    <div className="chat-status">
      {context && !hasAttachments && (
        <button className="context-chip" onClick={onFiles}>
          <ShieldCheck size={14} />
          {context.length.toLocaleString()} characters of reviewed context attached
        </button>
      )}
      {mode === 'codex' && mcpServers.length > 0 && (
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
          <ul>
            {mcpServers.map((server) => (
              <li key={server.name}>
                <strong>{server.name}</strong>
                <span>
                  {server.authStatus === 'notLoggedIn'
                    ? 'Sign-in required'
                    : server.failed
                      ? 'Connection failed'
                      : server.available
                        ? 'Tools available'
                        : 'No tools available'}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
export function McpSignIn({
  mode,
  mcpServers,
  busy,
  signInMcp,
}: {
  mode: string;
  mcpServers: McpStatus[];
  busy: boolean;
  signInMcp: (server: string) => Promise<void>;
}) {
  return (
    mode === 'codex' &&
    mcpServers.some((server) => !server.available || server.authStatus === 'notLoggedIn') && (
      <div className="mcp-sign-in">
        {mcpServers
          .filter((server) => !server.available || server.authStatus === 'notLoggedIn')
          .map((server) => (
            <div key={server.name}>
              <span>
                {server.name} ·{' '}
                {server.authStatus === 'notLoggedIn'
                  ? 'Sign-in required'
                  : server.failed
                    ? 'Connection failed'
                    : 'No tools available'}
              </span>
              {server.authStatus === 'notLoggedIn' && (
                <button disabled={busy} onClick={() => void signInMcp(server.name)}>
                  Sign in
                </button>
              )}
            </div>
          ))}
      </div>
    )
  );
}
