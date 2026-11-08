import InvestigationPlan from './InvestigationPlan';
import { useAgentChat } from './useAgentChat';
import type { AgentChatProps } from './chatTypes';
import ChatMessages from './ChatMessages';
import ChatComposer from './ChatComposer';
import { ChatStatus } from './McpConnections';
import ToolReview from './ToolReview';
import RequestReview from './RequestReview';

export default function AgentChat(props: AgentChatProps) {
  const chat = useAgentChat(props);
  return (
    <section className="chat-view">
      <ChatStatus
        context={props.context}
        hasAttachments={Boolean(props.attachments?.files.length)}
        mode={props.mode}
        mcpServers={chat.mcpServers}
        onFiles={props.onFiles}
        busy={chat.busy || chat.refreshingMcp || chat.openingMcpLogin}
        refreshingMcp={chat.refreshingMcp}
        refreshMcp={chat.refreshMcp}
        signInMcp={chat.signInMcp}
      />
      {props.initialBranch && (
        <aside className="branch-context" aria-label="Branch checkpoint">
          <p>
            Branched through message {props.initialBranch.messageIndex + 1}. The original session is
            preserved. External API or MCP actions are not undone.
          </p>
          {props.onUseWorkspaceEvidence ? (
            <>
              <p>
                This branch uses the evidence and redaction settings captured at that checkpoint.
              </p>
              <button onClick={props.onUseWorkspaceEvidence} disabled={chat.busy}>
                Use current workspace evidence
              </button>
            </>
          ) : (
            <p>Using current workspace evidence with this branch's redaction settings.</p>
          )}
        </aside>
      )}
      <InvestigationPlan chat={chat} />
      <ChatMessages chat={chat} />
      <ChatComposer {...props} chat={chat} />
      {chat.toolApproval && (
        <ToolReview tool={chat.toolApproval} onDecide={chat.decideTool} onStop={chat.stop} />
      )}
      {chat.notice && (
        <div role="status" className="notice">
          {chat.notice}
        </div>
      )}
      {chat.reconnectRequired && (
        <div className="notice">
          <p>The agent connection ended. Your context will not be resent until you reconnect.</p>
          <button onClick={chat.reconnect}>Reconnect with context</button>
        </div>
      )}
      {chat.pending && (
        <RequestReview
          pending={chat.pending}
          onDeny={() => chat.setPending(null)}
          onApprove={() => {
            if (chat.pending) void chat.execute(chat.pending);
          }}
        />
      )}
    </section>
  );
}
