import { useState } from 'react';
import { validDate } from './fieldValidation';

export function DateRange({
  title,
  submitLabel,
  onSubmit,
}: {
  title: string;
  submitLabel: string;
  onSubmit: (text: string) => void;
}) {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const valid = validDate(start) && validDate(end) && start <= end;
  return (
    <form
      className="response-widget generated-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onSubmit(`${title}: ${start} to ${end}`);
      }}
    >
      <h3>{title}</h3>
      <div className="date-range-fields">
        <label className="generated-field">
          Start date
          <input
            type="date"
            value={start}
            max={end || undefined}
            onChange={(event) => setStart(event.target.value)}
          />
        </label>
        <label className="generated-field">
          End date
          <input
            type="date"
            value={end}
            min={start || undefined}
            onChange={(event) => setEnd(event.target.value)}
          />
        </label>
      </div>
      {start && end && start > end && <p role="alert">End date must be on or after start date.</p>}
      <button type="submit" disabled={!valid}>
        {submitLabel}
      </button>
      <p className="muted">Adds this range to the composer without sending.</p>
    </form>
  );
}
