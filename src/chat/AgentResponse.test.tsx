import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AgentResponse from './AgentResponse';
import { parseReply, responseSchema } from './response';
describe('generated OpenUI replies', () => {
  it('renders agent-selected text, chart, table and followups through OpenUI', () => {
    const content = JSON.stringify({
      text: 'Two errors were observed.',
      blocks: [
        { type: 'chart', title: 'Status counts', items: [{ label: 'Errors', value: 2 }] },
        { type: 'table', title: 'Evidence', columns: ['Status'], rows: [['ERROR']] },
        { type: 'followups', prompts: ['Explain errors'] },
      ],
    });
    const html = renderToStaticMarkup(<AgentResponse content={content} onFollow={() => {}} />);
    for (const text of ['Two errors were observed.', 'Status counts', 'Evidence', 'Explain errors'])
      expect(html).toContain(text);
  });
  it('falls back to text for malformed or unsupported UI and escapes HTML', () => {
    const content = '<script>alert(1)</script>';
    expect(parseReply(content)).toEqual({ text: content, blocks: [] });
    const html = renderToStaticMarkup(<AgentResponse content={content} onFollow={() => {}} />);
    expect(html).not.toContain('<script>');
    expect(
      responseSchema.safeParse({ text: 'test', blocks: [{ type: 'script', source: 'alert(1)' }] })
        .success,
    ).toBe(false);
    expect(
      responseSchema.safeParse({
        text: 'test',
        blocks: [{ type: 'chart', title: 'test', items: [{ label: 'x', value: -1 }] }],
      }).success,
    ).toBe(false);
  });
});

it('validates calendar dates and rejects inverted date bounds', () => {
  const accepts = (min: string, max?: string) =>
    responseSchema.safeParse({
      text: 'Pick a date',
      blocks: [{ type: 'date', title: 'Date', min, max }],
    }).success;
  expect(accepts('2024-02-29', '2024-03-01')).toBe(true);
  expect(accepts('2025-02-29')).toBe(false);
  expect(accepts('2026-04-31')).toBe(false);
  expect(accepts('2026-10-31', '2026-10-01')).toBe(false);
  expect(accepts('10/24/2026')).toBe(false);
});
