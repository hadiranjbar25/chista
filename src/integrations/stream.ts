// Incremental chat-completions SSE parser. Byte and event boundaries may split UTF-8/JSON.
export async function readChatStream(
  response: Response,
  signal: AbortSignal,
  onText?: (text: string) => void,
): Promise<string> {
  if (!response.body) throw new Error('Provider returned no response stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '',
    content = '',
    total = 0,
    finished = false;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  function event(frame: string) {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    if (data === '[DONE]') {
      finished = true;
      return;
    }
    let value;
    try {
      value = JSON.parse(data);
    } catch {
      throw new Error('Provider returned an invalid stream event.');
    }
    if (value.error) throw new Error('Provider reported a streaming error.');
    const choice = value.choices?.find(
      (item: { index?: number }) => item.index === 0 || item.index === undefined,
    );
    const delta = choice?.delta?.content;
    if (typeof delta === 'string') {
      content += delta;
      onText?.(content);
    }
    if (choice?.finish_reason && choice.finish_reason !== 'stop')
      throw new Error('Provider stopped before completing the response.');
    if (choice?.finish_reason === 'stop') finished = true;
  }
  try {
    signal.throwIfAborted();
    while (!finished) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) {
        buffer += decoder.decode();
        break;
      }
      total += value.length;
      if (total > 4_000_000) throw new Error('Provider response exceeded the size limit.');
      buffer += decoder.decode(value, { stream: true });
      // Normalize CRLF only after a complete line, preserving a trailing split CR.
      buffer = buffer.replace(/\r\n/g, '\n');
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        event(frame);
        if (finished) break;
      }
    }
    if (!finished && buffer.trim()) event(buffer.replace(/\r\n/g, '\n'));
    if (!finished || !content) throw new Error('Provider stream ended without a complete answer.');
    return content;
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
