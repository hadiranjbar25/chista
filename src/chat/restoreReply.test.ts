import { expect, it } from 'vitest';
import { Sanitizer } from '../evidence/safety';
import { parseReply } from './response';
import { restoreReply } from './restoreReply';

it('restores display values across widgets without mutating history or breaking nested JSON', () => {
  const sanitizer = new Sanitizer('LOCAL');
  const original = 'a "quoted" value\nwith \\ backslashes <script>literal</script>';
  const mask = sanitizer.placeholder(original, 'SENSITIVE');
  const reply = parseReply(
    JSON.stringify({
      text: `Found ${mask}`,
      sources: [mask],
      sessionTitle: mask,
      blocks: [
        { type: 'table', title: mask, columns: ['Name'], rows: [[mask]] },
        { type: 'chart', title: mask, items: [{ label: mask, value: 3 }] },
        { type: 'code', title: 'Code', content: mask },
        { type: 'json', title: 'Data', content: JSON.stringify({ [mask]: [mask] }) },
        { type: 'followups', prompts: [`Investigate ${mask}`] },
      ],
    }),
  );
  const snapshot = JSON.stringify(reply);
  const displayed = restoreReply(reply, (text) => sanitizer.restore(text));
  expect(displayed.text).toBe(`Found ${original}`);
  expect(displayed.sessionTitle).toBe(original);
  expect(displayed.sources).toEqual([mask]);
  expect(displayed.blocks[0]).toMatchObject({ title: original, rows: [[original]] });
  expect(displayed.blocks[1]).toMatchObject({ items: [{ label: original, value: 3 }] });
  expect(displayed.blocks[2]).toMatchObject({ content: original });
  const json = displayed.blocks[3];
  expect(json.type).toBe('json');
  if (json.type === 'json') expect(JSON.parse(json.content)).toEqual({ [original]: [original] });
  expect(displayed.blocks[4]).toMatchObject({ prompts: [`Investigate ${original}`] });
  expect(JSON.stringify(reply)).toBe(snapshot);
});
