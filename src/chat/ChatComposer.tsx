import ModelPicker from '../app/settings/ModelPicker';
import { useEffect, useState } from 'react';
import { ArrowRight, X } from 'lucide-react';
import FullscreenSection from '../components/FullscreenSection';
import type { AgentChatProps } from './chatTypes';
import type { ChatController } from './useAgentChat';

type Props = Pick<
  AgentChatProps,
  | 'onRemoveAttachment'
  | 'onFiles'
  | 'onAddFiles'
  | 'onAgentChange'
  | 'mode'
  | 'hosted'
  | 'model'
  | 'modelCatalog'
  | 'onModelChange'
  | 'onLoadModels'
> & { chat: ChatController };
export default function ChatComposer({
  chat,
  onRemoveAttachment,
  onFiles,
  onAddFiles,
  onAgentChange,
  mode,
  hosted,
  model = '',
  modelCatalog,
  onModelChange,
  onLoadModels,
}: Props) {
  const {
    canSend,
    sendMessage,
    scrollPaused,
    jumpToLatest,
    busy,
    composer,
    composerAttachments: attachments,
    prompt,
    setPrompt,
    setPending,
    reviewBeforeSending,
    setReviewBeforeSending,
    stop,
  } = chat;
  const [showAttachments, setShowAttachments] = useState(false);
  useEffect(() => {
    if (!attachments?.files.length) setShowAttachments(false);
  }, [attachments?.files.length]);
  return (
    <form
      className="chat-composer"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) sendMessage();
      }}
    >
      {scrollPaused && (
        <button type="button" className="jump-to-latest" onClick={jumpToLatest}>
          ↓ Jump to latest
        </button>
      )}
      {Boolean(attachments?.files.length) && (
        <div className="chat-attachments">
          {attachments!.files.map((file) => (
            <div className="chat-attachment" key={file.id}>
              <button
                type="button"
                className="attachment-preview"
                onClick={() => setShowAttachments((value) => !value)}
                title="Preview sanitized attachments"
              >
                <strong>{file.name}</strong>
                <small>{file.redactions} redactions · ready</small>
              </button>
              <button
                type="button"
                disabled={busy || attachments?.busy}
                aria-label={`Remove attachment ${file.name}`}
                onClick={() => onRemoveAttachment?.(file.id)}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      {attachments?.busy && (
        <p className="muted" role="status">
          Sanitizing attachments locally…
        </p>
      )}
      {attachments?.error && (
        <p className="error" role="alert">
          {attachments.error}
        </p>
      )}
      {showAttachments && attachments?.context && (
        <FullscreenSection title="Sanitized attachments">
          <div className="attachment-details">
            <div className="action-row">
              <strong>Sanitized attachments</strong>
              <button type="button" onClick={onFiles}>
                Mappings &amp; redactions
              </button>
              <button
                type="button"
                aria-label="Close attachment preview"
                onClick={() => setShowAttachments(false)}
              >
                <X size={14} />
              </button>
            </div>
            <p className="muted">
              Only this compacted content is sent. Original filenames and mappings stay local.
            </p>
            <pre>{attachments.context}</pre>
          </div>
        </FullscreenSection>
      )}
      <textarea
        ref={composer}
        aria-label="Message agent"
        value={prompt}
        disabled={busy}
        onChange={(e) => {
          setPrompt(e.target.value);
          setPending(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (canSend) sendMessage();
          }
        }}
        placeholder="Message Chista…"
      />
      <div className="composer-actions">
        <div className="composer-options">
          {onAgentChange && (
            <select
              aria-label="Chat agent"
              value={mode}
              onChange={(e) => onAgentChange(e.target.value)}
            >
              <option value="claude">Claude Code</option>
              <option value="codex">Codex</option>
              {hosted.endpoint && (
                <option value="hosted">{hosted.model || 'Hosted provider'}</option>
              )}
            </select>
          )}
          {(mode === 'claude' || mode === 'codex') &&
            onModelChange &&
            onLoadModels &&
            modelCatalog && (
              <ModelPicker
                key={mode}
                agent={mode}
                compact
                value={model}
                {...modelCatalog}
                onChange={onModelChange}
                onLoad={onLoadModels}
                disabled={busy}
              />
            )}
          <button type="button" disabled={busy || attachments?.busy} onClick={onAddFiles}>
            + Add files
          </button>
          <label className="review-toggle">
            <input
              type="checkbox"
              checked={reviewBeforeSending}
              disabled={busy}
              onChange={(e) => {
                setReviewBeforeSending(e.target.checked);
                setPending(null);
              }}
            />
            Review before sending
          </label>
        </div>
        {busy ? (
          <button type="button" onClick={stop}>
            Stop
          </button>
        ) : (
          <button type="submit" className="primary" disabled={!canSend}>
            Send <ArrowRight size={15} />
          </button>
        )}
      </div>
      {(mode === 'claude' || mode === 'codex') && modelCatalog?.error && (
        <p className="composer-model-status muted" role="status">
          {modelCatalog.error}
        </p>
      )}
    </form>
  );
}
