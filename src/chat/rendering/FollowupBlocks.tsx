import { useContext, useState } from 'react';
import { defineComponent } from '@openuidev/react-lang';
import { z } from 'zod/v4';
import FullscreenSection from '../../components/FullscreenSection';
import { calendarDate } from '../response';
import { FollowupContext } from './FollowupContext';
import { FOLLOWUP_INPUT_LIMIT } from '../responseConfig';

export const Followups = defineComponent({
  name: 'Followups',
  description: 'Suggested next messages, never automatic actions',
  props: z.object({ prompts: z.array(z.string()) }),
  component: ({ props }) => {
    const follow = useContext(FollowupContext);
    return (
      <FullscreenSection title="Follow-up controls">
        <div className="followups">
          {props.prompts.map((prompt, i) => (
            <button key={i} onClick={() => follow(prompt)}>
              {prompt} ↗
            </button>
          ))}
        </div>
      </FullscreenSection>
    );
  },
});
export const TextInput = defineComponent({
  name: 'TextInput',
  description: 'A text field that prepares a follow-up message for the user to send.',
  props: z.object({ title: z.string(), placeholder: z.string(), submitLabel: z.string() }),
  component: ({ props }) => {
    const [value, setValue] = useState('');
    const follow = useContext(FollowupContext);
    return (
      <FullscreenSection title={props.title} className="focus-widget">
        <form
          className="response-widget response-input"
          onSubmit={(event) => {
            event.preventDefault();
            if (value.trim()) follow(value.trim());
          }}
        >
          <label>
            <span>{props.title}</span>
            <textarea
              aria-label={props.title}
              placeholder={props.placeholder}
              value={value}
              maxLength={FOLLOWUP_INPUT_LIMIT}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          <button type="submit" disabled={!value.trim()}>
            {props.submitLabel}
          </button>
          <p className="muted">Adds your text to the message box. You choose when to send.</p>
        </form>
      </FullscreenSection>
    );
  },
});
export const DatePicker = defineComponent({
  name: 'DatePicker',
  description: 'A calendar date selector that prepares a follow-up message.',
  props: z.object({ title: z.string(), min: z.string(), max: z.string(), submitLabel: z.string() }),
  component: ({ props }) => {
    const [value, setValue] = useState('');
    const follow = useContext(FollowupContext);
    const valid =
      calendarDate.safeParse(value).success &&
      (!props.min || value >= props.min) &&
      (!props.max || value <= props.max);
    return (
      <FullscreenSection title={props.title} className="focus-widget">
        <form
          className="response-widget response-input response-date"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) follow(`${props.title}: ${value}`);
          }}
        >
          <label>
            <span>{props.title}</span>
            <input
              type="date"
              aria-label={props.title}
              value={value}
              min={props.min || undefined}
              max={props.max || undefined}
              required
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          <button type="submit" disabled={!valid}>
            {props.submitLabel}
          </button>
          <p className="muted">
            Adds the selected date to the message box. You choose when to send.
          </p>
        </form>
      </FullscreenSection>
    );
  },
});
