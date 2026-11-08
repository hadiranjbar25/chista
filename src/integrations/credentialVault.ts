import { invoke, isTauri } from '@tauri-apps/api/core';
export async function saveCredential(account: string, secret: string) {
  if (!isTauri()) throw new Error('Open Chista desktop to save provider credentials.');
  await invoke('store_credential', { account, secret });
}
export const removeCredential = (account: string) => invoke('delete_credential', { account });
