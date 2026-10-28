import { beforeEach, expect, it, vi } from 'vitest';
const bridge = vi.hoisted(() => ({ invoke: vi.fn(), desktop: true }));
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => bridge.desktop,
  invoke: bridge.invoke,
  Channel: class {
    onmessage: (event: unknown) => void = () => {};
  },
}));
import { claudeProvider, codexProvider, claudePayload, streamingProse } from './claude';
import { prepareRequest } from './providers';
import { Sanitizer } from '../evidence/safety';
beforeEach(() => {
  bridge.desktop = true;
  bridge.invoke.mockReset();
});
it.each(['claude', 'codex'] as const)(
  '%s sends exactly the reviewed sanitized payload and handles message events',
  async (agent) => {
    const provider = agent === 'codex' ? codexProvider : claudeProvider;
    const request = prepareRequest(
      [],
      'Investigate alex@example.com',
      'user=[EMAIL_1]',
      new Sanitizer('CHAT'),
    );
    const updates: string[] = [];
    bridge.invoke.mockImplementation(async (command, args) => {
      expect(command).toBe(`${agent}_chat`);
      expect(args.payload).toBe(claudePayload(request));
      expect(args.payload).not.toContain('alex@example.com');
      expect(args.repoPath).toBeUndefined();
      args.onEvent.onmessage({ type: 'started' });
      args.onEvent.onmessage({ type: 'delta', text: '{"text":"Check ' });
      args.onEvent.onmessage({ type: 'replace', text: '{"text":"Check timeouts","blocks":[]}' });
      return '{"text":"Check timeouts","blocks":[]}';
    });
    const answer = await provider('').complete(request, new AbortController().signal, (text) =>
      updates.push(streamingProse(text)),
    );
    expect(updates).toEqual(['Check ', 'Check timeouts']);
    expect(JSON.parse(answer).text).toBe('Check timeouts');
  },
);
it('cancels even when Stop arrives before native startup acknowledgement', async () => {
  const controller = new AbortController();
  let finish!: (value: string) => void;
  bridge.invoke.mockImplementation((command, args) => {
    if (command === 'cancel_agent_chat') {
      finish('late answer');
      return Promise.resolve();
    }
    const response = new Promise<string>((resolve) => {
      finish = resolve;
    });
    controller.abort();
    args.onEvent.onmessage({ type: 'started' });
    return response;
  });
  await expect(
    claudeProvider('').complete({ messages: [], context: null }, controller.signal),
  ).rejects.toThrow();
  expect(bridge.invoke).toHaveBeenCalledWith(
    'cancel_agent_chat',
    expect.objectContaining({ requestId: expect.any(String) }),
  );
});
it('does not start aborted requests and never substitutes demo responses on bridge errors', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    claudeProvider('').complete({ messages: [], context: null }, controller.signal),
  ).rejects.toThrow();
  expect(bridge.invoke).not.toHaveBeenCalled();
  bridge.invoke.mockRejectedValue(new Error('Sign in through Claude'));
  await expect(
    claudeProvider('').complete({ messages: [], context: null }, new AbortController().signal),
  ).rejects.toThrow('Sign in through Claude');
});
it('rejects browser use and safely extracts partial escaped prose', () => {
  bridge.desktop = false;
  expect(() => claudeProvider('')).toThrow('desktop');
  expect(streamingProse('{"text":"Line\\n\\"quoted\\" \\u0061')).toBe('Line\n"quoted" a');
  expect(streamingProse('{"text":"Wait\\u00')).toBe('Wait');
  expect(streamingProse('{"blocks":[')).toBe('');
});
