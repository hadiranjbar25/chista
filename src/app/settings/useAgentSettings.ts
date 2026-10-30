import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { hostedProvider, type HostedConfig } from '../../integrations/providers';

import {
  emptyModelCatalog,
  type CliAgent,
  type ModelCatalog,
  type ModelChoice,
} from '../../integrations/models';

export function useAgentSettings(setNotice: (notice: string) => void) {
  const [mode, setMode] = useState('codex');
  const [claudePath, setClaudePath] = useState('');
  const [claudeStatus, setClaudeStatus] = useState('Not checked');
  const [codexPath, setCodexPath] = useState('');
  const [codexStatus, setCodexStatus] = useState('Not checked');
  const [claudeModel, setClaudeModel] = useState('');
  const [codexModel, setCodexModel] = useState('');
  const [modelCatalogs, setModelCatalogs] = useState<Record<CliAgent, ModelCatalog>>({
    claude: emptyModelCatalog(),
    codex: emptyModelCatalog(),
  });
  const catalogVersions = useRef({ claude: 0, codex: 0 });
  useEffect(() => {
    catalogVersions.current.claude++;
    setModelCatalogs((all) => ({ ...all, claude: emptyModelCatalog() }));
  }, [claudePath]);
  useEffect(() => {
    catalogVersions.current.codex++;
    setModelCatalogs((all) => ({ ...all, codex: emptyModelCatalog() }));
  }, [codexPath]);
  async function loadModels(agent: CliAgent, refresh = false) {
    const catalog = modelCatalogs[agent];
    if (!refresh && (catalog.loading || catalog.loaded)) return;
    const version = ++catalogVersions.current[agent];
    setModelCatalogs((all) => ({ ...all, [agent]: { ...emptyModelCatalog(), loading: true } }));
    try {
      if (!isTauri()) throw new Error('Desktop required');
      const options = await invoke<ModelChoice[]>('agent_models', {
        agent,
        executablePath: agent === 'claude' ? claudePath : codexPath,
      });
      if (catalogVersions.current[agent] === version)
        setModelCatalogs((all) => ({
          ...all,
          [agent]: { options, loading: false, loaded: true, error: '' },
        }));
    } catch {
      if (catalogVersions.current[agent] === version)
        setModelCatalogs((all) => ({
          ...all,
          [agent]: {
            ...all[agent],
            loading: false,
            loaded: false,
            error: 'Could not load models. Use the CLI default or enter a custom model ID.',
          },
        }));
    }
  }
  const activeModelPath = mode === 'claude' ? claudePath : codexPath;
  useEffect(() => {
    if (isTauri() && (mode === 'claude' || mode === 'codex')) void loadModels(mode, true);
    // Only a change of agent/executable should reload the catalog, not the
    // loading/result state updates produced by the lookup itself.
  }, [mode, activeModelPath]);
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
    claudeModel,
    setClaudeModel,
    codexModel,
    setCodexModel,
    modelCatalogs,
    loadModels,
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
