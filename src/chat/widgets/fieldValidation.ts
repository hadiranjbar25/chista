import type { FormField } from '../widgetSchema';

export type FieldValue = string | string[] | boolean;
export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validField(field: FormField, value: FieldValue | undefined) {
  if (field.type === 'checkbox') return !field.required || value === true;
  if (field.type === 'multiselect')
    return Array.isArray(value)
      ? (!field.required || value.length > 0) &&
          value.every((item) => field.options?.includes(item))
      : !field.required;
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return !field.required;
  if (field.type === 'number')
    return (
      Number.isFinite(Number(text)) &&
      (field.min === undefined || Number(text) >= field.min) &&
      (field.max === undefined || Number(text) <= field.max)
    );
  if (field.type === 'date') return validDate(text);
  if (field.type === 'time') return /^([01]\d|2[0-3]):[0-5]\d$/.test(text);
  if (['select', 'radio'].includes(field.type)) return Boolean(field.options?.includes(text));
  return true;
}
