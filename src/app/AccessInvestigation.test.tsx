// @vitest-environment jsdom
// Exercise the complete app with real fixture evidence and a simulated agent.
// The installed CLI + actual HTTP MCP path is checked separately by the smoke script.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (command: string, args: unknown) => native.invoke(command, args),
  Channel: class {
    onmessage: (event: unknown) => void = () => {};
  },
}));
import App from './App';
// @ts-expect-error Node-only test fixture, not part of the application bundle.
import { incidentTool } from '../../demo/scripts/access-incident-mcp.mjs';
beforeEach(() => {
  localStorage.clear();
  native.invoke.mockReset();
});
afterEach(cleanup);
it('imports and masks evidence, investigates access, renders cited UI, and sends a selected date into the next approved query', async () => {
  const waiting = new Map<string, (value: any) => void>();
  const queries: { tool: string; arguments: any }[] = [];
  const requests: any[] = [];
  const receipts: string[] = [];
  let call = 0;
  async function tool(args: any, name: string, input: any) {
    queries.push({ tool: name, arguments: input });
    const id = `call-${++call}`;
    const approved = new Promise<any>((resolve) => waiting.set(id + ':approve', resolve));
    args.onEvent.onmessage({
      type: 'tool_approval',
      id: id + ':approve',
      callId: id,
      server: 'chista-access-test',
      tool: name,
      arguments: input,
    });
    const decision = await approved;
    if (!decision.approved) throw Error('Test expected explicit approval');
    args.onEvent.onmessage({
      type: 'tool_progress',
      callId: id,
      server: 'chista-access-test',
      tool: name,
      state: 'running',
    });
    const received = new Promise<any>((resolve) => waiting.set(id + ':result', resolve));
    args.onEvent.onmessage({
      type: 'tool_result',
      id: id + ':result',
      callId: id,
      server: 'chista-access-test',
      tool: name,
      success: true,
      result: incidentTool(name, decision.arguments),
    });
    const safe = await received;
    receipts.push(safe.content);
    const envelope = JSON.parse(safe.content);
    return {
      id: envelope.sourceId,
      value: JSON.parse(JSON.parse(envelope.result).content[0].text),
    };
  }
  native.invoke.mockImplementation(async (command, args) => {
    if (command === 'agent_models') return [];
    if (command.endsWith('_auth_status')) return true;
    if (command === 'close_agent_session') return;
    if (command === 'respond_agent_tool') {
      waiting.get(args.id)!(args.response);
      waiting.delete(args.id);
      return;
    }
    expect(command).toBe('agent_session_chat');
    requests.push(args);
    args.onEvent.onmessage({ type: 'started' });
    args.onEvent.onmessage({
      type: 'mcp_status',
      servers: [
        { name: 'chista-access-test', authStatus: 'unsupported', available: true, failed: false },
      ],
    });
    const selectedDate = JSON.parse(args.payload)
      .messages.at(-1)
      .content.match(/2026-10-21/)
      ? '2026-10-21'
      : '2026-10-22';
    if (requests.length === 1) {
      const access = await tool(args, 'access_events', { date: selectedDate });
      const permissions = await tool(args, 'effective_access', { date: selectedDate });
      const metrics = await tool(args, 'datadog_responses', {
        from: `${selectedDate}T09:55:00Z`,
        to: `${selectedDate}T10:20:00Z`,
      });
      const blocked = !permissions.value.groups.includes(permissions.value.requiredGroup);
      const reply = {
        text: `Illustrative evidence: ${permissions.value.requiredGroup} membership is ${blocked ? 'missing' : 'present'}.`,
        sessionTitle: 'File access investigation',
        sources: ['artifact-1.log', access.id, permissions.id, metrics.id],
        blocks: [
          {
            type: 'table',
            title: 'Effective access checks',
            columns: ['Check', 'Observed', 'Outcome'],
            rows: [
              ['Role', permissions.value.role, 'Pass'],
              ['Permission', permissions.value.permissions.join(', '), 'Pass'],
              ['Required group', permissions.value.requiredGroup, blocked ? 'Missing' : 'Pass'],
            ],
          },
          {
            type: 'chart',
            title: 'Denied requests over time',
            items: metrics.value.points.map((p: any) => ({
              label: p.timestamp.slice(11, 16),
              value: p.denied,
            })),
          },
          {
            type: 'chart',
            title: 'File-service outcomes',
            items: [
              { label: 'Allowed', value: metrics.value.totalAllowed },
              { label: 'Denied', value: metrics.value.totalDenied },
            ],
          },
          { type: 'date', title: 'Last successful access', min: '2026-10-21', max: '2026-10-22' },
        ],
      };
      args.onEvent.onmessage({ type: 'delta', text: JSON.stringify(reply).slice(0, -2) });
      return JSON.stringify(reply);
    }
    const metrics = await tool(args, 'datadog_responses', {
      from: `${selectedDate}T00:00:00Z`,
      to: `${selectedDate}T23:59:59Z`,
    });
    return JSON.stringify({
      text: `Illustrative follow-up: ${metrics.value.totalDenied} denied and ${metrics.value.totalAllowed} allowed responses on ${selectedDate}.`,
      sources: [metrics.id],
      blocks: [],
    });
  });
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('checkbox', { name: 'Review before sending' }));
  await user.click(screen.getByRole('button', { name: '+ Add files' }));
  const raw = readFileSync(resolve('demo/fixtures/access-denied/access.log'), 'utf8');
  const file = new File([raw], 'private-access.log', { type: 'text/plain' });
  Object.defineProperty(file, 'text', { value: async () => raw });
  await user.upload(screen.getByLabelText('Import debug files'), file);
  await user.type(
    screen.getByRole('textbox', { name: 'Message agent' }),
    'Investigate doc-42 access on 2026-10-22{Enter}',
  );
  const preview = screen.getByRole('dialog', { name: 'Approve outgoing request' });
  expect(preview.textContent).not.toContain('alex@example.com');
  expect(preview.textContent).not.toContain('private-access.log');
  expect(preview.textContent).toContain('[EMAIL_1]');
  await user.click(screen.getByRole('button', { name: 'Approve and send' }));
  for (let i = 0; i < 3; i++) {
    const approval = await screen.findByRole('dialog', { name: 'Approve MCP tool' });
    await user.click(within(approval).getByRole('button', { name: 'Approve tool once' }));
  }
  expect(await screen.findByRole('heading', { name: 'Effective access checks' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Denied requests over time' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'File-service outcomes' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Denied 14' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Allowed 126' })).toBeTruthy();
  expect(screen.getAllByText('Completed')).toHaveLength(3);
  for (const receipt of receipts) {
    expect(receipt).not.toContain('alex@example.com');
  }
  expect(receipts[0]).toContain('[EMAIL_1]');
  expect(screen.queryByText(/Unavailable source:/)).toBeNull();
  fireEvent.change(screen.getByLabelText('Last successful access'), {
    target: { value: '2026-10-21' },
  });
  await user.click(screen.getByRole('button', { name: 'Use date' }));
  expect(requests).toHaveLength(1);
  expect(
    (screen.getByRole('textbox', { name: 'Message agent' }) as HTMLTextAreaElement).value,
  ).toContain('2026-10-21');
  await user.click(screen.getByRole('button', { name: 'Send' }));
  await user.click(screen.getByRole('button', { name: 'Approve and send' }));
  const next = await screen.findByRole('dialog', { name: 'Approve MCP tool' });
  expect(next.textContent).toContain('2026-10-21T00:00:00Z');
  await user.click(within(next).getByRole('button', { name: 'Approve tool once' }));
  await screen.findByRole('button', { name: 'Send' });
  const follow = await screen.findByText(/Illustrative follow-up:/);
  expect(follow.textContent).toBe(
    'Illustrative follow-up: 0 denied and 42 allowed responses on 2026-10-21.',
  );
  expect(requests[1].systemPrompt).toBeNull();
  expect(queries.at(-1)!.arguments.from).toBe('2026-10-21T00:00:00Z');
  await user.click(screen.getByRole('button', { name: 'Files & mappings' }));
  await user.click(screen.getByRole('button', { name: 'Mappings' }));
  const mappings = screen.getByRole('region', { name: 'Local redaction mappings' });
  expect(within(mappings).getAllByText('alex@example.com')).toHaveLength(1);
  expect(mappings.textContent).toContain('chista-access-test · access_events');
}, 15000);
