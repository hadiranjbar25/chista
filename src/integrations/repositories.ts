import { invoke, isTauri } from '@tauri-apps/api/core';

export async function selectRepositoryFolder(): Promise<{ name: string; path: string } | null> {
  if (!isTauri()) throw new Error('Open Chista desktop to select a repository folder.');
  return invoke('select_repository_folder');
}
