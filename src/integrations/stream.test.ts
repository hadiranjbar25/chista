import { describe, expect, it } from 'vitest';
import { readChatStream } from './stream';
const encoder = new TextEncoder();
const delta = (text: string) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\r\n\r\n`;
describe('hosted streaming', () => {
  it('delivers partial text before completion across split UTF-8 and SSE boundaries', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
        },
      }),
    );
    const updates: string[] = [];
    let done = false;
    const promise = readChatStream(response, new AbortController().signal, (text) =>
      updates.push(text),
    ).then((value) => {
      done = true;
      return value;
    });
    const bytes = encoder.encode(delta('Héllo'));
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updates).toEqual(['Héllo']);
    expect(done).toBe(false);
    controller.enqueue(encoder.encode(delta(' world') + 'data: [DONE]\n\n'));
    expect(await promise).toBe('Héllo world');
  });
  it('cancels pending reads without waiting for another chunk', async () => {
    const signal = new AbortController();
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
    );
    const result = readChatStream(response, signal.signal);
    signal.abort();
    await expect(result).rejects.toThrow();
    expect(cancelled).toBe(true);
  });
  it('rejects truncated and failed streams without exposing remote diagnostics', async () => {
    const signal = new AbortController().signal;
    await expect(readChatStream(new Response(delta('partial')), signal)).rejects.toThrow(
      'complete answer',
    );
    await expect(
      readChatStream(new Response('data: {"error":"secret token"}\n\n'), signal),
    ).rejects.toThrow('streaming error');
    await expect(
      readChatStream(new Response('data: secret token\n\n'), signal),
    ).rejects.not.toThrow('secret token');
  });
});
