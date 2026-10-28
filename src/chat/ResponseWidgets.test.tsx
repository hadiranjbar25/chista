// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import AgentResponse from './AgentResponse';
import { responseSchema } from './response';
afterEach(cleanup);
it('renders validated form controls through OpenUI and collects a single follow-up', async () => {
  const user = userEvent.setup();
  const follow = vi.fn();
  render(
    <AgentResponse
      onFollow={follow}
      content={JSON.stringify({
        text: 'Choose filters.',
        blocks: [
          {
            type: 'form',
            title: 'Debug filters',
            fields: [
              {
                id: 'env',
                label: 'Environment',
                type: 'select',
                options: ['Production', 'Staging'],
                required: true,
              },
              {
                id: 'services',
                label: 'Services',
                type: 'multiselect',
                options: ['API', 'Worker'],
                required: true,
              },
              {
                id: 'severity',
                label: 'Severity',
                type: 'radio',
                options: ['Error', 'Warning'],
                required: true,
              },
              { id: 'count', label: 'Retries', type: 'number', min: 0, max: 5, required: true },
              { id: 'warnings', label: 'Include warnings', type: 'checkbox' },
              { id: 'note', label: 'Notes', type: 'text' },
              { id: 'day', label: 'Day', type: 'date', required: true },
              { id: 'time', label: 'Time', type: 'time', required: true },
            ],
          },
        ],
      })}
    />,
  );
  const button = screen.getByRole('button', { name: 'Use in chat' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  await user.selectOptions(screen.getByLabelText('Environment *'), 'Production');
  await user.selectOptions(screen.getByLabelText('Services *'), ['API', 'Worker']);
  await user.click(screen.getByLabelText('Error'));
  await user.type(screen.getByLabelText('Retries *'), '7');
  await user.click(screen.getByLabelText('Include warnings'));
  await user.type(screen.getByLabelText('Notes'), 'Check slow requests');
  fireEvent.change(screen.getByLabelText('Day *'), { target: { value: '2026-10-24' } });
  fireEvent.change(screen.getByLabelText('Time *'), { target: { value: '12:30' } });
  expect(button.disabled).toBe(true);
  await user.clear(screen.getByLabelText('Retries *'));
  await user.type(screen.getByLabelText('Retries *'), '3');
  expect(follow).not.toHaveBeenCalled();
  await user.click(button);
  expect(follow).toHaveBeenCalledExactlyOnceWith(
    'Debug filters\nEnvironment: Production\nServices: API, Worker\nSeverity: Error\nRetries: 3\nInclude warnings: Yes\nNotes: Check slow requests\nDay: 2026-10-24\nTime: 12:30',
  );
});
it('rejects reversed date ranges and preserves calendar dates in follow-ups', async () => {
  const user = userEvent.setup();
  const follow = vi.fn();
  render(
    <AgentResponse
      onFollow={follow}
      content={JSON.stringify({
        text: 'Choose dates',
        blocks: [{ type: 'dateRange', title: 'Incident window' }],
      })}
    />,
  );
  const button = screen.getByRole('button', { name: 'Use range' }) as HTMLButtonElement;
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-10-24' } });
  fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-10-23' } });
  expect(button.disabled).toBe(true);
  expect(screen.getByRole('alert')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-10-25' } });
  await user.click(button);
  expect(follow).toHaveBeenCalledExactlyOnceWith('Incident window: 2026-10-24 to 2026-10-25');
});
it('displays and copies code literally and formats JSON without executing markup', async () => {
  const user = userEvent.setup();
  render(
    <AgentResponse
      onFollow={vi.fn()}
      content={JSON.stringify({
        text: 'Evidence',
        blocks: [
          {
            type: 'code',
            title: 'Snippet',
            language: 'html',
            content: '<script>throw new Error("never run")</script>',
          },
          { type: 'json', title: 'Payload', content: '{"count":3,"tag":"<img src=x>"}' },
        ],
      })}
    />,
  );
  expect(document.querySelector('.agent-reply script')).toBeNull();
  expect(document.querySelector('.agent-reply img')).toBeNull();
  expect(document.querySelectorAll('.code-viewer pre')[1].textContent).toBe(
    '{\n  "count": 3,\n  "tag": "<img src=x>"\n}',
  );
  await user.click(screen.getAllByRole('button', { name: 'Copy' })[0]);
  expect(await navigator.clipboard.readText()).toBe(
    '<script>throw new Error("never run")</script>',
  );
});
it('rejects invalid forms and malformed JSON at the response boundary', () => {
  const accepts = (block: unknown) =>
    responseSchema.safeParse({ text: 'Test', blocks: [block] }).success;
  expect(
    accepts({
      type: 'form',
      title: 'Filters',
      fields: [{ id: 'env', label: 'Environment', type: 'select' }],
    }),
  ).toBe(false);
  expect(
    accepts({
      type: 'form',
      title: 'Filters',
      fields: [{ id: 'n', label: 'Number', type: 'number', min: 10, max: 1 }],
    }),
  ).toBe(false);
  expect(
    accepts({
      type: 'form',
      title: 'Filters',
      fields: [
        { id: 'x', label: 'A', type: 'text' },
        { id: 'x', label: 'B', type: 'text' },
      ],
    }),
  ).toBe(false);
  expect(
    accepts({
      type: 'form',
      title: 'Filters',
      fields: [{ id: 'constructor', label: 'A', type: 'text' }],
    }),
  ).toBe(false);
  expect(accepts({ type: 'json', title: 'Payload', content: '{broken' })).toBe(false);
});
