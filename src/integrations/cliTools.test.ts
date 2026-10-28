import { beforeEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
import { handleToolEvent, type ToolHooks } from './cliTools';
import { Sanitizer } from '../evidence/safety';
beforeEach(() => native.invoke.mockReset().mockResolvedValue(undefined));
function hooks(approved = true): ToolHooks {
  const sanitizer = new Sanitizer('MCP');
  return {
    approve: vi.fn().mockResolvedValue(approved),
    sanitize: (text) => sanitizer.sanitize(text, 'json', []),
    status: vi.fn(),
  };
}
it('requires approval of sanitized tool arguments and sanitizes returned data before inference', async () => {
  const toolHooks = hooks();
  const signal = new AbortController().signal;
  await handleToolEvent(
    {
      type: 'tool_approval',
      id: 'call:approve',
      server: 'rag-e-khab',
      tool: 'search',
      arguments: { email: 'alex@example.com' },
    },
    toolHooks,
    signal,
  );
  const prompt = vi.mocked(toolHooks.approve).mock.calls[0][0];
  expect(JSON.stringify(prompt.arguments)).not.toContain('alex@example.com');
  expect(native.invoke.mock.calls[0][1].response.approved).toBe(true);
  expect(native.invoke.mock.calls[0][1].response.arguments).toEqual(prompt.arguments);
  await handleToolEvent(
    {
      type: 'tool_result',
      id: 'call:result',
      result: { content: [{ type: 'text', text: 'alex@example.com' }] },
    },
    toolHooks,
    signal,
  );
  const response = native.invoke.mock.calls[1][1].response.content;
  expect(response).not.toContain('alex@example.com');
  expect(response).toContain('[MCP_EMAIL_1]');
});
it('denies calls on user rejection, cancellation or missing tool handling', async () => {
  const event = {
    type: 'tool_approval' as const,
    id: 'one',
    server: 'test',
    tool: 'write',
    arguments: {},
  };
  await handleToolEvent(event, hooks(false), new AbortController().signal);
  const controller = new AbortController();
  controller.abort();
  await handleToolEvent(event, hooks(), controller.signal);
  await handleToolEvent(event, undefined, new AbortController().signal);
  for (const [, args] of native.invoke.mock.calls) expect(args.response.approved).toBe(false);
});
it('masks arbitrary identifier fields in tool approvals and nested result text', async () => {
  const toolHooks = { ...hooks(), evidence: vi.fn() };
  const signal = new AbortController().signal;
  await handleToolEvent(
    {
      type: 'tool_approval',
      id: 'identifiers:approve',
      server: 'audit',
      tool: 'lookup',
      arguments: { id: 'record-123', tenant_id: 'tenant-456', ID: 7 },
    },
    toolHooks,
    signal,
  );
  const approved = vi.mocked(toolHooks.approve).mock.calls[0][0].arguments as Record<
    string,
    string
  >;
  for (const key of ['id', 'tenant_id', 'ID']) {
    expect(approved[key]).toMatch(/^\[MCP_SENSITIVE_\d+\]$/);
  }
  await handleToolEvent(
    {
      type: 'tool_result',
      id: 'identifiers:result',
      success: true,
      server: 'audit',
      tool: 'lookup',
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ id: 'record-123', tenant_id: 'tenant-456', ID: 7 }),
          },
        ],
      },
    },
    toolHooks,
    signal,
  );
  const source = toolHooks.evidence.mock.calls[0][0];
  expect(source.content).not.toContain('record-123');
  expect(source.content).not.toContain('tenant-456');
  expect(source.content).toContain(approved.id);
  expect(source.content).toContain(approved.ID);
  const receipt = native.invoke.mock.calls.at(-1)![1].response.content;
  expect(receipt).not.toContain('record-123');
  expect(receipt).not.toContain('tenant-456');
});
it('records lifecycle and source receipts using the same masking map as imported artifacts', async () => {
  const shared = new Sanitizer();
  const imported = shared.sanitize(
    '{"email":"alex@example.com","name":"Alice Example","user_id":"person-42"}',
    'json',
    [],
  );
  const activity = vi.fn(),
    evidence = vi.fn();
  const toolHooks = {
    ...hooks(),
    sanitize: (text: string) => shared.sanitize(text, 'json', []),
    activity,
    evidence,
  };
  const signal = new AbortController().signal;
  await handleToolEvent(
    {
      type: 'tool_approval',
      id: 'request:one:approve',
      callId: 'request:one',
      server: 'audit',
      tool: 'access',
      arguments: { date: '2026-10-22' },
    },
    toolHooks,
    signal,
  );
  await handleToolEvent(
    {
      type: 'tool_progress',
      callId: 'request:one',
      server: 'audit',
      tool: 'access',
      state: 'running',
    },
    toolHooks,
    signal,
  );
  await handleToolEvent(
    {
      type: 'tool_result',
      id: 'request:one:result',
      callId: 'request:one',
      server: 'audit',
      tool: 'access',
      success: true,
      result: {
        content: [
          {
            type: 'text',
            text: '{"email":"alex@example.com","name":"Alice Example","user_id":"person-42"}',
          },
          { type: 'image', data: 'BINARY' },
        ],
      },
    },
    toolHooks,
    signal,
  );
  expect(activity.mock.calls.map(([item]) => item.state)).toEqual([
    'approval',
    'running',
    'completed',
  ]);
  const source = evidence.mock.calls[0][0];
  for (const raw of ['alex@example.com', 'Alice Example', 'person-42', 'BINARY'])
    expect(source.content).not.toContain(raw);
  expect(source.content).toContain(JSON.parse(imported).email);
  const receipt = JSON.parse(native.invoke.mock.calls.at(-1)![1].response.content);
  expect(receipt.sourceId).toBe(source.id);
  expect(activity.mock.calls.at(-1)![0].sourceId).toBe(source.id);
});
it('never records failed or cancelled tool results as successful evidence', async () => {
  const activity = vi.fn(),
    evidence = vi.fn(),
    controller = new AbortController();
  const toolHooks = { ...hooks(), activity, evidence };
  const event = {
    type: 'tool_result' as const,
    id: 'one:result',
    callId: 'one',
    server: 'datadog',
    tool: 'query',
    success: false,
    result: { isError: true, content: [{ type: 'text', text: 'Permission denied' }] },
  };
  await handleToolEvent(event, toolHooks, controller.signal);
  expect(activity.mock.calls[0][0].state).toBe('failed');
  expect(evidence).not.toHaveBeenCalled();
  controller.abort();
  await handleToolEvent({ ...event, success: true }, toolHooks, controller.signal);
  expect(evidence).not.toHaveBeenCalled();
  expect(activity.mock.calls.at(-1)![0].state).toBe('cancelled');
});
it('fails closed if structured text cannot be sanitized', async () => {
  const evidence = vi.fn(),
    activity = vi.fn();
  const toolHooks = {
    ...hooks(),
    evidence,
    activity,
    sanitize: (text: string) => {
      if (text.startsWith('{"name"')) throw Error('sanitizer failed');
      return new Sanitizer().sanitize(text, 'json', []);
    },
  };
  await handleToolEvent(
    {
      type: 'tool_result',
      id: 'one:result',
      callId: 'one',
      server: 'audit',
      tool: 'query',
      success: true,
      result: { content: [{ type: 'text', text: '{"name":"Private Name"}' }] },
    },
    toolHooks,
    new AbortController().signal,
  );
  expect(evidence).not.toHaveBeenCalled();
  expect(activity.mock.calls[0][0].state).toBe('failed');
  expect(native.invoke.mock.calls[0][1].response.success).toBe(false);
  expect(JSON.stringify(native.invoke.mock.calls)).not.toContain('Private Name');
});
