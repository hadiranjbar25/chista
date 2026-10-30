import { useCallback, useState } from 'react';
import type { ChatAttachments } from '../app/workspaces/workspace';

// Composer chips are a per-conversation send queue. Consuming them must not
// remove workspace evidence or revoke context already delivered to the CLI.
export function useComposerAttachments(attachments?: ChatAttachments) {
  const [sentIds, setSentIds] = useState(() => new Set<string>());
  const files = attachments?.files.filter((file) => !sentIds.has(file.id)) ?? [];
  const consumeAttachments = useCallback((ids: readonly string[]) => {
    if (ids.length) setSentIds((previous) => new Set([...previous, ...ids]));
  }, []);
  return {
    composerAttachments: attachments
      ? { ...attachments, files, context: files.length ? attachments.context : null }
      : undefined,
    consumeAttachments,
  };
}
