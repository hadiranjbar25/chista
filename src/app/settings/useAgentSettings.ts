import { useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { hostedProvider, type HostedConfig } from '../../integrations/providers';

export function useAgentSettings(setNotice: (notice: string) => void) {
  const [mode, setMode] = useState('codex');
  const [claudePath, setClaudePath] = useState('');
  const [claudeStatus, setClaudeStatus] = useState('Not checked');
  const [codexPath, setCodexPath] = useState('');
  const [codexStatus, setCodexStatus] = useState('Not checked');
  const [hosted, setHosted] = useState<HostedConfig>({ endpoint: '', model: '', token: '' });
  const [hostedDraft, setHostedDraft] = useState<HostedConfig>({
    endpoint: '',
    model: '',
    token: '',
  });
  const [modelStatuses, setModelStatuses] = useState<Record<string, string>>({});
  async function checkClaude() {
    setClaudeStatus('Checking…');
    try {
      if (!isTauri())
        throw new Error('Desktop required; use the desktop app for agent connections.');
      const path = await invoke<string>('claude_status', { executablePath: claudePath });
      const signedIn = await invoke<boolean>('claude_auth_status', { executablePath: claudePath });
      setClaudeStatus(
        `${signedIn ? 'Signed in' : 'Not signed in — choose Sign in to Claude'} · ${path}`,
      );
    } catch (e) {
      setClaudeStatus(String(e));
    }
  }
  async function checkCodex() {
    setCodexStatus('Checking…');
    try {
      if (!isTauri()) throw new Error('Open the desktop app to check Codex.');
      const path = await invoke<string>('codex_status', { executablePath: codexPath });
      setCodexStatus(`Available: ${path}. Sign-in is managed in Terminal.`);
    } catch (e) {
      setCodexStatus(String(e));
    }
  }

  const signInClaude = async () => {
    try {
      if (!isTauri()) throw new Error('Open Chista desktop to sign in.');
      setClaudeStatus(await invoke<string>('claude_sign_in', { executablePath: claudePath }));
    } catch (error) {
      setClaudeStatus(String(error));
    }
  };
  const configureHosted = () => {
    try {
      hostedProvider(hostedDraft);
      setHosted({ ...hostedDraft });
      setModelStatuses((all) => ({
        ...all,
        [JSON.stringify([hostedDraft.endpoint, hostedDraft.model])]:
          'Configured · access not verified',
      }));
      setMode('hosted');
      setNotice(
        'Provider configured, not yet connected. The first reviewed request verifies access.',
      );
    } catch (e) {
      setNotice(String(e));
    }
  };
  const clearHosted = () => {
    setHosted({ endpoint: '', model: '', token: '' });
    setHostedDraft({ endpoint: '', model: '', token: '' });
    if (mode === 'hosted') setMode('codex');
  };
  return {
    mode,
    setMode,
    claudePath,
    setClaudePath,
    claudeStatus,
    setClaudeStatus,
    codexPath,
    setCodexPath,
    codexStatus,
    setCodexStatus,
    hosted,
    hostedDraft,
    setHostedDraft,
    modelStatuses,
    setModelStatuses,
    checkClaude,
    checkCodex,
    signInClaude,
    configureHosted,
    clearHosted,
  };
}

export type AgentSettings = ReturnType<typeof useAgentSettings>;
