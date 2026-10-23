import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import { hostedBody, type ModelProvider, type ModelRequest } from './providers';

export function claudePayload(request: ModelRequest): string {
  return JSON.stringify({ messages: hostedBody('', request).messages }, null, 2);
}

type ClaudeEvent = { type: 'started' } | { type: 'delta'; text: string };
export function claudeProvider(executablePath: string): ModelProvider {
  if (!isTauri()) throw new Error('Claude Code chat requires the Tauri desktop app. Browser preview supports demo mode.');
  return {
    id: 'claude', label: 'Claude Code', mode: 'claude',
    async complete(request, signal, onText) {
      signal.throwIfAborted();
      const requestId = crypto.randomUUID();
      const events = new Channel<ClaudeEvent>();
      let started = false;
      let finished = false;
      let text = '';
      const cancel = () => {
        if (started && !finished) void invoke('cancel_claude_chat', { requestId }).catch(() => {});
      };
      events.onmessage = event => {
        if (finished) return;
        if (event.type === 'started') { started = true; if (signal.aborted) cancel(); }
        if (event.type === 'delta' && !signal.aborted) { text += event.text; onText?.(text); }
      };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        const result = await invoke<string>('claude_chat', { requestId, executablePath, payload: claudePayload(request), onEvent: events });
        signal.throwIfAborted();
        return result;
      } finally {
        finished = true;
        signal.removeEventListener('abort', cancel);
      }
    },
  };
}

// Display only the growing prose field while structured JSON is incomplete.
// Full JSON is validated by AgentResponse before any interactive component renders.
export function streamingProse(raw: string): string {
  const clean = raw.replace(/^```(?:json)?\s*/, '');
  if (!clean.trimStart().startsWith('{')) return clean;
  const match = /"text"\s*:\s*"/.exec(clean);
  if (!match) return '';
  const value = clean.slice(match.index + match[0].length);
  let result = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '"') break;
    if (value[i] !== '\\') { result += value[i]; continue; }
    const next = value[++i];
    if (!next) break;
    if (next === 'u') {
      const hex = value.slice(i + 1, i + 5);
      if (!/^[0-9a-f]{4}$/i.test(hex)) break;
      result += String.fromCharCode(parseInt(hex, 16)); i += 4;
    } else result += ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' } as Record<string, string>)[next] ?? next;
  }
  return result;
}
