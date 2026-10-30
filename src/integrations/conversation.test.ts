import { beforeEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke, isTauri: () => true }));
import { CliConversation, nativeTurnPreview } from './conversation';
import type { Message } from './providers';
beforeEach(() => native.invoke.mockReset().mockResolvedValue(undefined));
it('sends instructions once and previews only the new message for follow-ups', () => {
  const session = new CliConversation();
  const first = session.prepare('codex', '', {
    messages: [{ role: 'user', content: 'First' }],
    context: 'safe context',
  });
  expect(first.systemPrompt).toContain('You are Chista');
  expect(first.systemPrompt).toContain('chista_mcp_catalog');
  expect(first.payload).toContain('safe context');
  const history: Message[] = [
    { role: 'user', content: 'First' },
    { role: 'assistant', content: 'Answer' },
  ];
  session.commit(first, history);
  const next = session.prepare('codex', '', {
    messages: [...history, { role: 'user', content: 'Next' }],
    context: 'safe context',
  });
  expect(next.sessionKey).toBe(first.sessionKey);
  expect(next.systemPrompt).toBeNull();
  expect(JSON.parse(nativeTurnPreview(next))).toEqual({
    messages: [{ role: 'user', content: 'Next' }],
  });
});
it('isolates sessions and updates evidence without replaying instructions or history', () => {
  const one = new CliConversation();
  const two = new CliConversation();
  const request = {
    messages: [{ role: 'user' as const, content: 'Question' }],
    context: 'context A',
  };
  const first = one.prepare('claude', '', request);
  const other = two.prepare('claude', '', request);
  expect(first.systemPrompt).toContain('installed Claude Code CLI');
  expect(first.systemPrompt).toContain('native MCP tools');
  expect(first.systemPrompt).not.toContain('No tools are available');
  expect(other.sessionKey).not.toBe(first.sessionKey);
  one.commit(first, [...request.messages, { role: 'assistant', content: 'Answer' }]);
  const history: Message[] = [...request.messages, { role: 'assistant', content: 'Answer' }];
  const next = one.prepare('claude', '', {
    messages: [...history, { role: 'user', content: 'Next' }],
    context: 'context B',
  });
  expect(next.sessionKey).toBe(first.sessionKey);
  expect(next.systemPrompt).toBeNull();
  expect(native.invoke).not.toHaveBeenCalled();
  expect(next.payload).toContain('context B');
  expect(next.payload).not.toContain('context A');
  expect(next.payload).not.toContain('Question');
  const continued: Message[] = [
    ...history,
    { role: 'user', content: 'Next' },
    { role: 'assistant', content: 'New answer' },
  ];
  one.commit(next, continued);
  const followUp = one.prepare('claude', '', {
    messages: [...continued, { role: 'user', content: 'Continue' }],
    context: 'context B',
  });
  expect(JSON.parse(followUp.payload)).toEqual({
    messages: [{ role: 'user', content: 'Continue' }],
  });
  const removed = one.prepare('claude', '', {
    messages: [...continued, { role: 'user', content: 'No files now' }],
    context: null,
  });
  expect(removed.sessionKey).toBe(first.sessionKey);
  expect(removed.payload).toContain('context has been removed');
  expect(removed.payload).not.toContain('context B');
  one.reset();
  expect(native.invoke).toHaveBeenCalledWith('close_agent_session', {
    sessionKey: first.sessionKey,
  });
  one.commit(next, request.messages);
  expect(one.prepare('codex', '', request).systemPrompt).not.toBeNull();
});

it('does not restart a thread when later redaction discoveries change earlier UI messages', () => {
  const session = new CliConversation();
  const first = session.prepare('codex', '', {
    messages: [{ role: 'user', content: 'Inspect record-123' }],
    context: null,
  });
  session.commit(first, [
    { role: 'user', content: 'Inspect record-123' },
    { role: 'assistant', content: 'Found record-123' },
  ]);
  const next = session.prepare('codex', '', {
    messages: [
      { role: 'user', content: 'Inspect [SENSITIVE_1]' },
      { role: 'assistant', content: 'Found [SENSITIVE_1]' },
      { role: 'user', content: 'Continue' },
    ],
    context: null,
  });
  expect(next.sessionKey).toBe(first.sessionKey);
  expect(next.systemPrompt).toBeNull();
  expect(JSON.parse(next.payload)).toEqual({ messages: [{ role: 'user', content: 'Continue' }] });
});

it('does not mark a denied preview as delivered and reconnects after history is truncated', () => {
  const session = new CliConversation();
  const request = {
    messages: [{ role: 'user' as const, content: 'Question' }],
    context: 'Context',
  };
  const denied = session.prepare('codex', '', request);
  const retried = session.prepare('codex', '', request);
  expect(retried.systemPrompt).not.toBeNull();
  expect(retried.payload).toContain('Context');
  session.commit(retried, [...request.messages, { role: 'assistant', content: 'Answer' }]);
  const reset = session.prepare('codex', '', request);
  expect(reset.sessionKey).not.toBe(denied.sessionKey);
  expect(reset.systemPrompt).not.toBeNull();
});

it('sends repository names once and updates selection within the same native thread', () => {
  const conversation = new CliConversation();
  const question: Message = { role: 'user', content: 'What is the name of this repo?' };
  const first = conversation.prepare('codex', '', {
    messages: [question],
    context: null,
    repositoryNames: ['chista'],
  });
  expect(JSON.parse(first.payload).messages[0].content).toContain('"chista"');
  const history: Message[] = [
    question,
    { role: 'assistant', content: 'The selected repository is chista.' },
  ];
  conversation.commit(first, history);
  const followUp = conversation.prepare('codex', '', {
    messages: [...history, { role: 'user', content: 'Continue' }],
    context: null,
    repositoryNames: ['chista'],
  });
  expect(followUp.sessionKey).toBe(first.sessionKey);
  expect(JSON.parse(followUp.payload)).toEqual({
    messages: [{ role: 'user', content: 'Continue' }],
  });
  const changed = conversation.prepare('codex', '', {
    messages: [...history, { role: 'user', content: 'Which repo now?' }],
    context: null,
    repositoryNames: ['payments'],
  });
  expect(changed.sessionKey).toBe(first.sessionKey);
  expect(changed.systemPrompt).toBeNull();
  expect(changed.payload).toContain('payments');
  expect(changed.payload).not.toContain('chista');
  expect(changed.payload).not.toContain('What is the name');
  conversation.commit(changed, [
    ...history,
    { role: 'user', content: 'Which repo now?' },
    { role: 'assistant', content: 'payments' },
  ]);
  const removed = conversation.prepare('codex', '', {
    messages: [
      ...history,
      { role: 'user', content: 'Which repo now?' },
      { role: 'assistant', content: 'payments' },
      { role: 'user', content: 'And now?' },
    ],
    context: null,
  });
  expect(removed.sessionKey).toBe(first.sessionKey);
  expect(removed.payload).toContain('No repository folders are currently selected');
});
