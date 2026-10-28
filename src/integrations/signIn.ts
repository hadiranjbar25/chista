import { invoke } from '@tauri-apps/api/core';

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cancel = () => reject(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
  });
}
function delay(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const cancel = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, 2000);
    signal.addEventListener('abort', cancel, { once: true });
  });
}

// Authentication happens before sending anything. Retain the exact approved
// snapshot; never retry a model request that may already have reached the agent.
export async function ensureCliSignIn(
  agent: string,
  executablePath: string,
  signal: AbortSignal,
  onStatus: (text: string) => void,
) {
  const label = agent === 'codex' ? 'Codex' : 'Claude Code';
  const check = () => {
    signal.throwIfAborted();
    return abortable(invoke<boolean>(`${agent}_auth_status`, { executablePath }), signal);
  };
  onStatus(`Checking ${label} sign-in…`);
  if (await check()) {
    onStatus('');
    return;
  }
  signal.throwIfAborted();
  onStatus(
    `Sign in to ${label} in the terminal window. Your message will continue automatically. You can stop here to cancel.`,
  );
  await abortable(invoke(`${agent}_sign_in`, { executablePath }), signal);
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await delay(signal);
    if (await check()) {
      onStatus('');
      return;
    }
  }
  throw new Error(`${label} sign-in timed out. Your draft is saved; send it when you’re ready.`);
}
