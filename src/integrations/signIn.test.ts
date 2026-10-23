import { afterEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
import { ensureCliSignIn } from './signIn';
afterEach(() => { native.invoke.mockReset(); vi.useRealTimers(); });
it('does not open login for a signed-in agent', async () => {
  native.invoke.mockResolvedValue(true);
  await ensureCliSignIn('codex','/bin/codex',new AbortController().signal,vi.fn());
  expect(native.invoke.mock.calls.map(c=>c[0])).toEqual(['codex_auth_status']);
});
it('cancels an in-flight status check without launching login afterward', async () => {
  let finish!: (value:boolean)=>void;
  native.invoke.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const controller=new AbortController();
  const result=ensureCliSignIn('claude','',controller.signal,vi.fn());
  controller.abort();
  await expect(result).rejects.toThrow();
  finish(false);
  await Promise.resolve();
  expect(native.invoke).toHaveBeenCalledTimes(1);
});
it('bounds the sign-in wait and launches the terminal only once', async () => {
  vi.useFakeTimers();native.invoke.mockResolvedValue(false);
  const result=ensureCliSignIn('codex','',new AbortController().signal,vi.fn());
  const failed=expect(result).rejects.toThrow('sign-in timed out');
  await vi.advanceTimersByTimeAsync(300_000);
  await failed;
  expect(native.invoke.mock.calls.filter(c=>c[0]==='codex_sign_in')).toHaveLength(1);
});
