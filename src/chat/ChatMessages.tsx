import { Fragment } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import AgentResponse from './AgentResponse';
import InvestigationProgress from './InvestigationProgress';
import { partialReply } from '../evidence/investigation';
import { exitSectionFullscreen } from '../components/FullscreenSection';
import type { ChatController } from './useAgentChat';

export default function ChatMessages({ chat }: { chat: ChatController }) {
  const {
    conversation,
    messages,
    responseSources,
    sources,
    setPrompt,
    composer,
    activities,
    busy,
    stream,
    agentLabel,
    authStatus,
  } = chat;
  const growing = partialReply(stream);
  return (
    <div
      ref={conversation}
      className="messages"
      role="log"
      aria-live="polite"
      aria-label="Conversation"
    >
      {!messages.length && (
        <div className="chat-welcome">
          <span className="welcome-mark" role="img" aria-label="Chista">
            ✳
          </span>
          <h1>What are you debugging?</h1>
          <p>
            Describe the issue below. Add logs or data when you need evidence; review redactions
            before sharing.
          </p>
          <p className="muted">
            {isTauri()
              ? 'The selected agent uses your existing CLI sign-in. Responses appear here with interactive charts and tables when useful.'
              : 'Open Chista desktop to connect your agent. You can import and review files locally in this browser.'}
          </p>
        </div>
      )}
      {messages.map((m, i) => (
        <Fragment key={i}>
          <article className={'message ' + m.role}>
            <strong>{m.role === 'user' ? 'You' : 'Chista'}</strong>
            {m.role === 'assistant' ? (
              <AgentResponse
                content={m.content}
                evidence={responseSources[i] ?? sources}
                onFollow={(text) => {
                  exitSectionFullscreen();
                  setPrompt(text);
                  queueMicrotask(() => composer.current?.focus());
                }}
              />
            ) : (
              <p>{m.content}</p>
            )}
          </article>
          <InvestigationProgress activities={activities[i] ?? []} evidence={sources} />
        </Fragment>
      ))}
      {busy && stream && (
        <article className="message assistant">
          <strong>{agentLabel}</strong>
          <p style={{ whiteSpace: 'pre-wrap' }}>{growing.text}</p>
          {growing.blocks.length > 0 && (
            <fieldset
              disabled
              className="streaming-widgets"
              aria-label="Generating interactive response"
            >
              <AgentResponse
                content={JSON.stringify({ ...growing, text: '' })}
                onFollow={() => {}}
              />
            </fieldset>
          )}
        </article>
      )}
      {busy && (
        <p className="thinking" role="status">
          {authStatus || (stream ? 'Streaming response…' : 'Waiting for agent…')}
        </p>
      )}
    </div>
  );
}
