// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { native, chatProps as props } from './testing/nativeChatHarness';
import AgentChat from './AgentChat';

it('renders successive live chunks while the native request is still pending', async () => {
  let emit!: (event: unknown) => void;
  let finish!: (text: string) => void;
  native.invoke.mockImplementation((_command, args) => {
    emit = args.onEvent.onmessage;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const user = userEvent.setup();
  render(<AgentChat {...props} />);
  await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'Debug timeout{Enter}');

  expect(
    (screen.getByRole('textbox', { name: 'Message agent' }) as HTMLTextAreaElement).value,
  ).toBe('');
  expect(screen.getByRole('log').textContent).toContain('Debug timeout');

  await act(async () => emit({ type: 'delta', text: '{"text":"First' }));
  expect(screen.getByText('First')).toBeTruthy();
  expect(screen.getByText('Streaming response…')).toBeTruthy();
  await act(async () => emit({ type: 'delta', text: ' second' }));
  expect(screen.getByText('First second')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
  await act(async () => finish('{"text":"First second","blocks":[]}'));
  expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  expect(screen.getAllByText('First second')).toHaveLength(1);
});

it('clears the composer on Send before the response arrives', async () => {
  let finish!: (text: string) => void;
  native.invoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const user = userEvent.setup();
  render(<AgentChat {...props} />);
  const composer = screen.getByRole('textbox', { name: 'Message agent' }) as HTMLTextAreaElement;
  await user.type(composer, 'Investigate the timeout');
  await user.click(screen.getByRole('button', { name: 'Send' }));
  expect(composer.value).toBe('');
  expect(screen.getByRole('log').textContent).toContain('Investigate the timeout');
  expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
  await act(async () => finish('{"text":"Done","blocks":[]}'));
  expect(composer.value).toBe('');
});

it('takes a sanitized session title from the first agent response only', async () => {
  const onSessionTitle = vi.fn();
  native.invoke
    .mockResolvedValueOnce(
      '{"text":"First answer","blocks":[],"sessionTitle":"Timeout for alex@example.com"}',
    )
    .mockResolvedValueOnce('{"text":"Next answer","blocks":[],"sessionTitle":"Different title"}');
  const user = userEvent.setup();
  render(<AgentChat {...props} onSessionTitle={onSessionTitle} />);

  await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'Debug timeout{Enter}');
  await screen.findByText('First answer');
  expect(onSessionTitle).toHaveBeenCalledWith('Timeout for [CHAT_EMAIL_1]');
  await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'Continue{Enter}');
  await screen.findByText('Next answer');
  expect(onSessionTitle).toHaveBeenCalledTimes(1);
});

it('sends attachment-only messages with sanitized context and no filename metadata', async () => {
  native.invoke.mockResolvedValue('{"text":"Checked attachment","blocks":[]}');
  const context = '{"artifacts":[{"id":"artifact-1","excerpt":"[EMAIL_1] timeout"}]}';
  const attachments = {
    files: [{ id: 'local-file', name: 'alex@example.com.log', redactions: 1 }],
    context,
    busy: false,
    error: '',
  };
  const user = userEvent.setup();
  const view = render(
    <AgentChat {...props} context={context} attachments={{ ...attachments, busy: true }} />,
  );
  expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<AgentChat {...props} context={context} attachments={attachments} />);

  await user.click(screen.getByRole('button', { name: 'Send' }));
  expect(await screen.findByText('Checked attachment')).toBeTruthy();
  expect(native.invoke.mock.calls[0][1].payload).toContain('[EMAIL_1] timeout');
  expect(native.invoke.mock.calls[0][1].payload).not.toContain('alex@example.com.log');
  expect(native.invoke.mock.calls[0][1].payload).not.toContain('local-file');
});

it('renders an agent-generated OpenUI text box and prepares a follow-up without auto-sending', async () => {
  native.invoke.mockResolvedValue(
    JSON.stringify({
      text: 'Describe what happened.',
      blocks: [
        {
          type: 'input',
          title: 'Debug details',
          placeholder: 'Paste a short description',
          submitLabel: 'Use details',
        },
      ],
    }),
  );
  const user = userEvent.setup();
  render(<AgentChat {...props} />);

  await user.type(
    screen.getByRole('textbox', { name: 'Message agent' }),
    'Show me a text box{Enter}',
  );
  const field = await screen.findByRole('textbox', { name: 'Debug details' });
  expect((screen.getByRole('button', { name: 'Use details' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  await user.type(field, 'Timeout for alex@example.com');
  await user.click(screen.getByRole('button', { name: 'Use details' }));
  expect(
    (screen.getByRole('textbox', { name: 'Message agent' }) as HTMLTextAreaElement).value,
  ).toBe('Timeout for alex@example.com');
  expect(native.invoke).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: 'Send' }));
  expect(native.invoke.mock.calls[1][1].payload).not.toContain('alex@example.com');
  expect(native.invoke.mock.calls[1][1].payload).toContain('[CHAT_EMAIL_1]');
});

it('renders an OpenUI date picker with bounds and prepares the selected date without sending', async () => {
  native.invoke.mockResolvedValue(
    JSON.stringify({
      text: 'Choose the incident date.',
      blocks: [{ type: 'date', title: 'Incident date', min: '2026-10-01', max: '2026-10-31' }],
    }),
  );
  const user = userEvent.setup();
  render(<AgentChat {...props} />);

  await user.type(
    screen.getByRole('textbox', { name: 'Message agent' }),
    'Show a date picker{Enter}',
  );
  const date = await screen.findByLabelText('Incident date');
  const useDate = screen.getByRole('button', { name: 'Use date' }) as HTMLButtonElement;
  expect(useDate.disabled).toBe(true);
  fireEvent.change(date, { target: { value: '2026-11-01' } });
  expect(useDate.disabled).toBe(true);
  fireEvent.change(date, { target: { value: '2026-10-24' } });
  expect(useDate.disabled).toBe(false);
  await user.click(useDate);
  expect(
    (screen.getByRole('textbox', { name: 'Message agent' }) as HTMLTextAreaElement).value,
  ).toBe('Incident date: 2026-10-24');
  expect(native.invoke).toHaveBeenCalledTimes(1);
});

it('shows complete OpenUI blocks during streaming without enabling follow-up controls early', async () => {
  let event!: (value: unknown) => void, finish!: (value: string) => void;
  native.invoke.mockImplementation((_command, args) => {
    event = args.onEvent.onmessage;
    event({ type: 'started' });
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const user = userEvent.setup();
  render(<AgentChat {...props} mode="codex" />);

  await user.type(
    screen.getByRole('textbox', { name: 'Message agent' }),
    'Show observed errors{Enter}',
  );
  const chart = {
    type: 'chart',
    title: 'Live response counts',
    items: [{ label: 'Denied', value: 14 }],
  };
  await act(async () =>
    event({
      type: 'delta',
      text: `{"text":"Observed denials.","blocks":[${JSON.stringify(chart)},{"type":"date","title":"Last access"`,
    }),
  );
  expect(await screen.findByRole('heading', { name: 'Live response counts' })).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: 'Denied 14' }) as HTMLButtonElement).closest('fieldset')!
      .disabled,
  ).toBe(true);
  expect(screen.queryByLabelText('Last access')).toBeNull();
  await act(async () =>
    finish(
      JSON.stringify({
        text: 'Observed denials.',
        blocks: [chart, { type: 'date', title: 'Last access' }],
      }),
    ),
  );
  expect(screen.getByLabelText('Last access')).toBeTruthy();
  expect(screen.queryByRole('group', { name: 'Generating interactive response' })).toBeNull();
});

it('preserves a follow-up prepared from an earlier response while the next answer is arriving', async () => {
  let finish!: (value: string) => void;
  native.invoke.mockResolvedValueOnce(
    JSON.stringify({
      text: 'Choose a next step.',
      blocks: [{ type: 'followups', prompts: ['Inspect the earlier day'] }],
    }),
  );
  const user = userEvent.setup();
  render(<AgentChat {...props} />);

  await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'First question{Enter}');
  await screen.findByText('Choose a next step.');
  native.invoke.mockImplementation((_command, args) => {
    args.onEvent.onmessage({ type: 'started' });
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'Second question{Enter}');
  await user.click(screen.getByRole('button', { name: /Inspect the earlier day/ }));
  await act(async () => finish('{"text":"Second answer","blocks":[]}'));
  expect(
    (screen.getByRole('textbox', { name: 'Message agent' }) as HTMLTextAreaElement).value,
  ).toBe('Inspect the earlier day');
});
