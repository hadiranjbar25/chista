import type { AgentReply } from './response';

// Run after response validation and JSON parsing so quotes and newlines in local
// values stay data. Neither the original reply nor its masked history is changed.
export function restoreReply(reply: AgentReply, restore: (text: string) => string): AgentReply {
  const visit = (value: unknown, restoreKeys = false): unknown => {
    if (typeof value === 'string') return restore(value);
    if (Array.isArray(value)) return value.map((item) => visit(item, restoreKeys));
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          restoreKeys ? restore(key) : key,
          visit(item, restoreKeys),
        ]),
      );
    return value;
  };
  const displayed = visit(reply) as AgentReply;
  // Citation IDs are references, not display values.
  displayed.sources = reply.sources;
  reply.blocks.forEach((block, index) => {
    if (block.type === 'json') {
      const displayedBlock = displayed.blocks[index];
      if (displayedBlock.type === 'json')
        displayedBlock.content = JSON.stringify(visit(JSON.parse(block.content), true), null, 2);
    }
  });
  return displayed;
}
