// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: native.invoke }));
import WorkspaceSecurity from './WorkspaceSecurity';
afterEach(cleanup);
beforeEach(() =>
  native.invoke.mockReset().mockResolvedValue({
    servers: [{ name: 'tools', command: 'project-mcp', arguments: ['--read-only'] }],
  }),
);
it('requires review and command preview before workspace connector approval', async () => {
  const user = userEvent.setup();
  render(<WorkspaceSecurity workspaceId="project-a" />);
  const apply = screen.getByRole('button', {
    name: 'Apply workspace permissions',
  }) as HTMLButtonElement;
  expect(apply.disabled).toBe(true);
  await user.type(
    screen.getByLabelText('Approved MCP servers · agent:name, one per line'),
    'codex:tools',
  );
  await user.click(screen.getByRole('checkbox'));
  expect(apply.disabled).toBe(true);
  await user.click(
    screen.getByRole('button', { name: 'Preview connector commands and arguments' }),
  );
  expect(screen.getByText(/project-mcp/)).toBeTruthy();
  expect(apply.disabled).toBe(true);
  await user.click(screen.getByRole('checkbox'));
  await user.click(apply);
  expect(native.invoke).toHaveBeenCalledWith('configure_workspace_security', {
    workspaceId: 'project-a',
    origins: [],
    servers: ['codex:tools'],
  });
  await user.type(
    screen.getByLabelText('Local debugging origins · one exact origin per line'),
    'http://127.0.0.1:8080',
  );
  expect(apply.disabled).toBe(true);
});
it('stores MCP credentials only through native credential storage and clears the form', async () => {
  const user = userEvent.setup();
  render(<WorkspaceSecurity workspaceId="project-a" />);
  await user.click(screen.getByText('MCP credentials · OS credential store'));
  await user.type(screen.getByLabelText('MCP credential server name'), 'tools');
  const input = screen.getByLabelText('MCP credential JSON') as HTMLInputElement;
  await user.click(input);
  await user.paste('{"http_headers":{"Authorization":"Bearer private-token"}}');
  await user.click(screen.getByRole('button', { name: 'Store MCP credential' }));
  expect(native.invoke).toHaveBeenCalledWith('store_credential', {
    account: 'mcp:project-a:tools',
    secret: '{"http_headers":{"Authorization":"Bearer private-token"}}',
  });
  expect(input.value).toBe('');
  expect(JSON.stringify(localStorage)).not.toContain('private-token');
});
