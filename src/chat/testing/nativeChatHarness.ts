import { cleanup } from '@testing-library/react';
import { beforeEach, afterEach, vi } from 'vitest';

const native = vi.hoisted(() => ({ invoke: vi.fn(), auth: vi.fn(), close: vi.fn() }));
export { native };
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (command: string, args: unknown) =>
    command === 'close_agent_session'
      ? (native.close(args), Promise.resolve())
      : command.endsWith('_auth_status')
        ? native.auth(command, args)
        : native.invoke(command, args),
  Channel: class {
    onmessage: (event: unknown) => void = () => {};
  },
}));
beforeEach(() => {
  native.auth.mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  native.invoke.mockReset();
  native.close.mockReset();
  native.auth.mockReset();
  native.auth.mockResolvedValue(true);
});
export const chatProps = {
  repositories: [],
  context: 'Reviewed evidence: 2 timeouts',
  mode: 'claude',
  claudePath: '',
  hosted: { endpoint: '', model: '', token: '' },
  onModelStatus: vi.fn(),
  onFiles: vi.fn(),
  onAddFiles: vi.fn(),
};
