import { invoke, isTauri } from '@tauri-apps/api/core';
import { hostedBody, type Message, type ModelRequest } from './providers';
import { NO_TOOLS_INSTRUCTION, CODEX_TOOLS_INSTRUCTION } from './cliInstructions';

export type NativeTurn = { sessionKey: string; systemPrompt: string | null; payload: string };
// One instance per Chista session. No provider-owned thread IDs or raw files enter the UI.
export class CliConversation {
  private key = '';
  private token = '';
  private historyLength: number | null = null;
  private context: string | null = null;
  private preparedContexts = new WeakMap<NativeTurn, string | null>();
  prepare(agent: string, executablePath: string, request: ModelRequest): NativeTurn {
    const messages = hostedBody('', request).messages;
    const systemPrompt =
      agent === 'codex'
        ? messages[0].content.replace(NO_TOOLS_INSTRUCTION, CODEX_TOOLS_INSTRUCTION)
        : messages[0].content;
    const key = JSON.stringify([agent, executablePath, systemPrompt]);
    // Redaction discoveries may change earlier UI text. They do not mean that
    // the native thread disappeared or that its whole history needs replaying.
    if (
      key !== this.key ||
      (this.historyLength !== null && this.historyLength !== request.messages.length - 1)
    )
      this.reset();
    this.key = key;
    if (!this.token) this.token = crypto.randomUUID();
    const initial = this.historyLength === null;
    const updates =
      request.context !== this.context
        ? [
            {
              role: 'user',
              content: request.context
                ? `Updated sanitized debug context (replaces the previous attached snapshot):\n${request.context}`
                : 'The attached debug context has been removed. Do not rely on earlier attached excerpts as current evidence.',
            },
          ]
        : [];
    const turn = {
      sessionKey: this.token,
      systemPrompt: initial ? systemPrompt : null,
      payload: JSON.stringify(
        { messages: initial ? messages.slice(1) : [...updates, ...request.messages.slice(-1)] },
        null,
        2,
      ),
    };
    this.preparedContexts.set(turn, request.context);
    return turn;
  }
  commit(turn: NativeTurn, history: Message[]) {
    if (turn.sessionKey === this.token && this.preparedContexts.has(turn)) {
      this.historyLength = history.length;
      this.context = this.preparedContexts.get(turn) ?? null;
      this.preparedContexts.delete(turn);
    }
  }
  reset() {
    const token = this.token;
    this.key = '';
    this.token = '';
    this.historyLength = null;
    this.context = null;
    this.preparedContexts = new WeakMap();
    if (token && isTauri())
      void invoke('close_agent_session', { sessionKey: token }).catch(() => {});
  }
}
export function nativeTurnPreview(turn: NativeTurn) {
  return JSON.stringify(
    {
      ...(turn.systemPrompt !== null ? { systemPrompt: turn.systemPrompt } : {}),
      ...JSON.parse(turn.payload),
    },
    null,
    2,
  );
}
