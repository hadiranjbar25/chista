import { z } from 'zod/v4';

const title = z.string().trim().min(1).max(200);
export const formField = z
  .object({
    id: z
      .string()
      .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/)
      .refine((id) => !['constructor', 'prototype'].includes(id)),
    label: title,
    type: z.enum(['text', 'number', 'select', 'multiselect', 'radio', 'checkbox', 'date', 'time']),
    required: z.boolean().optional(),
    options: z.array(title).min(1).max(30).optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
  })
  .refine(
    (field) =>
      !['select', 'multiselect', 'radio'].includes(field.type) || Boolean(field.options?.length),
    'Choice fields need options.',
  )
  .refine(
    (field) => field.min === undefined || field.max === undefined || field.min <= field.max,
    'Invalid numeric bounds.',
  )
  .refine(
    (field) => !field.options || new Set(field.options).size === field.options.length,
    'Options must be unique.',
  );
export const formBlock = z
  .object({
    type: z.literal('form'),
    title,
    fields: z.array(formField).min(1).max(10),
    submitLabel: z.string().min(1).max(60).optional(),
  })
  .refine(
    (form) => new Set(form.fields.map((field) => field.id)).size === form.fields.length,
    'Field IDs must be unique.',
  );
export const codeBlock = z.object({
  type: z.literal('code'),
  title,
  language: z.string().max(40).optional(),
  content: z.string().max(20000),
});
export const jsonBlock = z.object({
  type: z.literal('json'),
  title,
  content: z
    .string()
    .max(20000)
    .refine((content) => {
      try {
        JSON.parse(content);
        return true;
      } catch {
        return false;
      }
    }, 'Expected JSON text.'),
});
export type FormField = z.infer<typeof formField>;
