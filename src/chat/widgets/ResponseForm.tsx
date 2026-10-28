import { useId, useState } from 'react';
import type { FormField } from '../widgetSchema';
import { validField, type FieldValue } from './fieldValidation';

export function ResponseForm({
  title,
  fields,
  submitLabel,
  onSubmit,
}: {
  title: string;
  fields: FormField[];
  submitLabel: string;
  onSubmit: (text: string) => void;
}) {
  const formId = useId();
  const [values, setFieldValues] = useState<Record<string, FieldValue>>(() => Object.create(null));
  const set = (id: string, value: FieldValue) =>
    setFieldValues((previous) => Object.assign(Object.create(null), previous, { [id]: value }));
  const valid = fields.every((field) => validField(field, values[field.id]));
  return (
    <form
      className="response-widget generated-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        onSubmit(
          title +
            '\n' +
            fields
              .map((field) => {
                const value = values[field.id];
                return `${field.label}: ${field.type === 'checkbox' ? (value ? 'Yes' : 'No') : Array.isArray(value) ? value.join(', ') : value || 'Not specified'}`;
              })
              .join('\n'),
        );
      }}
    >
      <h3>{title}</h3>
      {fields.map((field) => {
        const label = field.label + (field.required ? ' *' : '');
        if (field.type === 'checkbox')
          return (
            <label className="generated-check" key={field.id}>
              <input
                type="checkbox"
                checked={values[field.id] === true}
                onChange={(event) => set(field.id, event.target.checked)}
              />
              {label}
            </label>
          );
        if (field.type === 'radio')
          return (
            <fieldset key={field.id}>
              <legend>{label}</legend>
              {field.options!.map((option) => (
                <label className="generated-check" key={option}>
                  <input
                    type="radio"
                    name={`${formId}-${field.id}`}
                    checked={values[field.id] === option}
                    onChange={() => set(field.id, option)}
                  />
                  {option}
                </label>
              ))}
            </fieldset>
          );
        return (
          <label className="generated-field" key={field.id}>
            <span>{label}</span>
            {field.type === 'select' || field.type === 'multiselect' ? (
              <select
                multiple={field.type === 'multiselect'}
                value={
                  (values[field.id] as string | string[]) ??
                  (field.type === 'multiselect' ? [] : '')
                }
                onChange={(event) =>
                  set(
                    field.id,
                    field.type === 'multiselect'
                      ? Array.from(event.target.selectedOptions, (option) => option.value)
                      : event.target.value,
                  )
                }
              >
                {field.type === 'select' && <option value="">Choose…</option>}
                {field.options!.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            ) : (
              <input
                type={field.type}
                value={String(values[field.id] ?? '')}
                maxLength={4000}
                min={field.type === 'number' ? field.min : undefined}
                max={field.type === 'number' ? field.max : undefined}
                step={field.type === 'number' ? 'any' : undefined}
                onChange={(event) => set(field.id, event.target.value)}
              />
            )}
          </label>
        );
      })}
      <button type="submit" disabled={!valid}>
        {submitLabel}
      </button>
      <p className="muted">Prepares a message for you to review and send. * Required</p>
    </form>
  );
}
