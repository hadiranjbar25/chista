// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { native, chatProps as props } from './testing/nativeChatHarness';
import AgentChat from './AgentChat';

it('sends chat immediately but still approves curl API requests and sanitizes response evidence', async () => {
  let event!: (value: unknown) => void;
  let finish!: (value: string) => void;
  const onEvidence = vi.fn();
  native.invoke.mockImplementation((command, args) => {
    if (command === 'respond_agent_tool') return Promise.resolve();
    event = args.onEvent.onmessage;
    event({ type: 'started' });
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const user = userEvent.setup();
  render(<AgentChat {...props} mode="codex" onEvidence={onEvidence} />);
  expect(
    (screen.getByRole('checkbox', { name: 'Review before sending' }) as HTMLInputElement).checked,
  ).toBe(false);
  await user.type(
    screen.getByRole('textbox', { name: 'Message agent' }),
    'curl https://example.com/api{Enter}',
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(native.invoke.mock.calls[0][1].systemPrompt).toContain('chista_http_request');
  await act(async () =>
    event({
      type: 'tool_approval',
      kind: 'http',
      id: 'http:approve',
      callId: 'http',
      server: 'HTTP',
      tool: 'request',
      arguments: {
        url: 'https://example.com/api',
        method: 'GET',
        headers: { Authorization: 'Bearer private-token' },
      },
    }),
  );
  const review = screen.getByRole('dialog', { name: 'Approve API request' });
  expect(review.textContent).toContain('curl');
  expect(review.textContent).not.toContain('private-token');
  await user.click(screen.getByRole('button', { name: 'Approve tool once' }));
  const approval = native.invoke.mock.calls.find(
    ([command, args]) => command === 'respond_agent_tool' && args.id === 'http:approve',
  )![1];
  expect(approval.response.approved).toBe(true);
  expect(approval.response.arguments.url).toBe('https://example.com/api');
  await act(async () =>
    event({
      type: 'tool_result',
      kind: 'http',
      id: 'http:result',
      callId: 'http',
      server: 'HTTP',
      tool: 'request',
      success: true,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 403,
              body: { email: 'private@example.com', account_id: 'record-123' },
            }),
          },
        ],
      },
    }),
  );
  const source = onEvidence.mock.calls[0][0];
  expect(source.kind).toBe('http');
  expect(source.id).toMatch(/^http-/);
  expect(source.content).toContain('403');
  expect(source.content).not.toContain('private@example.com');
  expect(source.content).not.toContain('record-123');
  await act(async () =>
    finish(JSON.stringify({ text: 'The API returned 403.', blocks: [], sources: [source.id] })),
  );
  expect(screen.getByText('The API returned 403.')).toBeTruthy();
});
