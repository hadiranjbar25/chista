import { invoke } from '@tauri-apps/api/core';
import type { EvidenceSource, ToolActivity } from '../evidence/investigation';
export type McpStatus = { name: string; authStatus: string; available: boolean; failed: boolean };
export type ToolApproval = { server: string; tool: string; arguments: unknown };
export type ToolHooks = {
  approve: (tool: ToolApproval) => Promise<boolean>;
  sanitize: (text: string) => string;
  status: (servers: McpStatus[]) => void;
  activity?: (activity: ToolActivity) => void;
  evidence?: (source: EvidenceSource) => void;
};
export type ToolEvent =
  | {
      type: 'tool_progress';
      callId: string;
      server: string;
      tool: string;
      state: 'running' | 'denied';
    }
  | {
      type: 'tool_approval';
      id: string;
      callId?: string;
      server: string;
      tool: string;
      arguments: unknown;
    }
  | {
      type: 'tool_result';
      id: string;
      callId?: string;
      server?: string;
      tool?: string;
      success?: boolean;
      result: unknown;
    }
  | { type: 'mcp_status'; servers: McpStatus[] };

// MCP text parts may themselves contain JSON. Discover structured sensitive
// fields there before serializing the outer envelope (e.g. name or user_id).
function sanitizedResult(result: unknown, sanitize: (text: string) => string) {
  if (
    result &&
    typeof result === 'object' &&
    Array.isArray((result as { content?: unknown }).content)
  ) {
    const value = result as Record<string, unknown>;
    const content = (value.content as unknown[]).flatMap((part) => {
      if (!part || typeof part !== 'object') return [];
      const item = part as Record<string, unknown>;
      if (item.type !== 'text' || typeof item.text !== 'string') return [];
      let text = item.text;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* Plain text uses the outer sanitizer. */
      }
      if (parsed && typeof parsed === 'object') text = sanitize(text);
      return [{ type: 'text', text }];
    });
    return sanitize(
      JSON.stringify({
        content,
        structuredContent: value.structuredContent,
        isError: value.isError,
      }),
    );
  }
  return sanitize(JSON.stringify(result));
}
// Raw MCP results are accepted only here and sanitized before inference or UI.
export async function handleToolEvent(
  event: ToolEvent,
  hooks: ToolHooks | undefined,
  signal: AbortSignal,
) {
  if (event.type === 'mcp_status') {
    if (!signal.aborted) hooks?.status(event.servers);
    return;
  }
  const labels = () =>
    JSON.parse(
      hooks!.sanitize(
        JSON.stringify({ server: event.server ?? 'MCP', tool: event.tool ?? 'lookup' }),
      ),
    ) as { server: string; tool: string };
  if (event.type === 'tool_progress') {
    if (hooks && !signal.aborted)
      hooks.activity?.({ id: event.callId, ...labels(), state: event.state });
    return;
  }
  let response: unknown = { approved: false };
  const callId = event.callId ?? event.id.replace(/:(approve|result)$/, '');
  try {
    if (!hooks || signal.aborted) throw new Error('Tool handling unavailable');
    if (event.type === 'tool_result') {
      const safe = sanitizedResult(event.result, hooks.sanitize);
      const truncated = safe.length > 60000;
      const content = truncated
        ? safe.slice(0, 60000) + '\n[MCP result truncated locally at 60,000 characters]'
        : safe;
      if (event.success === true && event.server && event.tool) {
        const source: EvidenceSource = {
          id: `mcp-${crypto.randomUUID()}`,
          title: `${labels().server} · ${labels().tool}`,
          content,
          kind: 'mcp',
          truncated,
        };
        hooks.evidence?.(source);
        response = {
          content: JSON.stringify({
            sourceId: source.id,
            source: source.title,
            truncated,
            result: content,
          }),
        };
        hooks.activity?.({ id: callId, ...labels(), state: 'completed', sourceId: source.id });
      } else {
        response = { content };
        if (event.callId)
          hooks.activity?.({
            id: callId,
            ...labels(),
            state: event.success === true ? 'completed' : 'failed',
          });
      }
    } else {
      const encoded = hooks.sanitize(JSON.stringify(event.arguments));
      if (encoded.length > 100000) throw new Error('Tool arguments exceed the review limit');
      const args = JSON.parse(encoded);
      hooks.activity?.({ id: callId, ...labels(), state: 'approval' });
      const approved = await hooks.approve({ ...labels(), arguments: args });
      response = { approved: approved && !signal.aborted, arguments: args };
      if (!approved || signal.aborted)
        hooks.activity?.({
          id: callId,
          ...labels(),
          state: signal.aborted ? 'cancelled' : 'denied',
        });
    }
  } catch {
    response =
      event.type === 'tool_result'
        ? { content: 'MCP result could not be sanitized.', success: false }
        : { approved: false };
    if (hooks)
      hooks.activity?.({
        id: callId,
        server: 'MCP',
        tool: 'lookup',
        state: signal.aborted ? 'cancelled' : 'failed',
      });
  }
  await invoke('respond_agent_tool', { id: event.id, response }).catch(() => {});
}
