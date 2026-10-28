import { z } from 'zod/v4';
import { formBlock, codeBlock, jsonBlock } from './widgetSchema';

export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(value + 'T00:00:00Z');
    return (
      value.slice(0, 4) !== '0000' &&
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, 'Use a valid calendar date in YYYY-MM-DD format.');
const dateBlock = z
  .object({
    type: z.literal('date'),
    title: z.string().min(1).max(200),
    min: calendarDate.optional(),
    max: calendarDate.optional(),
    submitLabel: z.string().min(1).max(60).optional(),
  })
  .refine(
    (value) => !value.min || !value.max || value.min <= value.max,
    'Minimum date must not exceed maximum date.',
  );
export const chartItem = z.object({
  label: z.string().max(200),
  value: z.number().finite().nonnegative(),
});
export const responseSchema = z.object({
  text: z.string().max(40000),
  sources: z.array(z.string().min(1).max(100)).max(20).optional(),
  sessionTitle: z.string().trim().min(1).max(60).optional().catch(undefined),
  blocks: z
    .array(
      z.discriminatedUnion('type', [
        z.object({
          type: z.literal('chart'),
          title: z.string().max(200),
          items: z.array(chartItem).max(30),
        }),
        z.object({
          type: z.literal('table'),
          title: z.string().max(200),
          columns: z.array(z.string().max(100)).min(1).max(8),
          rows: z.array(z.array(z.string().max(2000)).max(8)).max(100),
        }),
        dateBlock,
        formBlock,
        codeBlock,
        jsonBlock,
        z.object({
          type: z.literal('dateRange'),
          title: z.string().min(1).max(200),
          submitLabel: z.string().min(1).max(60).optional(),
        }),
        z.object({
          type: z.literal('input'),
          title: z.string().min(1).max(200),
          placeholder: z.string().max(200).optional(),
          submitLabel: z.string().max(60).optional(),
        }),
        z.object({ type: z.literal('followups'), prompts: z.array(z.string().max(500)).max(5) }),
      ]),
    )
    .max(8),
});
export type AgentReply = z.infer<typeof responseSchema>;
export function parseReply(content: string): AgentReply {
  try {
    return responseSchema.parse(JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, '')));
  } catch {
    return { text: content, blocks: [] };
  }
}
