import { useAgentChat } from './useAgentChat';
import type { AgentChatProps } from './chatTypes';
import ChatMessages from './ChatMessages';
import ChatComposer from './ChatComposer';
import { ChatStatus, McpSignIn } from './McpConnections';
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
      />
      <ChatMessages chat={chat} />
      <McpSignIn
        mode={props.mode}
        mcpServers={chat.mcpServers}
        busy={chat.busy}
        signInMcp={chat.signInMcp}
      />
      <ChatComposer {...props} chat={chat} />
      {chat.toolApproval && (
        <ToolReview tool={chat.toolApproval} onDecide={chat.decideTool} onStop={chat.stop} />
      )}
      {chat.notice && (
        <div role="status" className="notice">
          {chat.notice}
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
