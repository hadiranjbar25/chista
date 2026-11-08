import { useEffect, useState } from 'react';
import { Sanitizer } from '../../evidence/safety';
import { invoke, isTauri } from '@tauri-apps/api/core';

export default function WorkspaceSecurity({ workspaceId }: { workspaceId: string }) {
  const [origins, setOrigins] = useState('');
  const [servers, setServers] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [notice, setNotice] = useState('');
  const [agent, setAgent] = useState('codex');
  const [path, setPath] = useState('');
  const [configuration, setConfiguration] = useState('');
  const [credentialServer, setCredentialServer] = useState('');
  const [secret, setSecret] = useState('');
  useEffect(() => {
    if (!isTauri()) return;
    let mounted = true;
    void invoke<{ origins: string[]; servers: string[] }>('read_workspace_security', {
      workspaceId,
    })
      .then((policy) => {
        if (
          !mounted ||
          !Array.isArray(policy.origins) ||
          !Array.isArray(policy.servers) ||
          ![...policy.origins, ...policy.servers].every((value) => typeof value === 'string')
        )
          return;
        setOrigins(policy.origins.join('\n'));
        setServers(policy.servers.join('\n'));
      })
      .catch(() => {
        if (mounted) setNotice('Could not read active workspace permissions.');
      });
    return () => {
      mounted = false;
    };
  }, [workspaceId]);
  async function preview() {
    try {
      const value = await invoke('preview_mcp_configuration', {
        workspaceId,
        agent,
        executablePath: path,
      });
      setConfiguration(new Sanitizer().sanitize(JSON.stringify(value), 'json', []));
      setReviewed(false);
    } catch {
      setNotice('Could not inspect native MCP configuration. Check the CLI installation and path.');
    }
  }
  async function saveSecret(remove = false) {
    try {
      if (!credentialServer.trim()) throw new Error('Enter an MCP server name.');
      const account = `mcp:${workspaceId}:${credentialServer.trim()}`;
      if (remove) await invoke('delete_credential', { account });
      else {
        const parsed = JSON.parse(secret) as Record<string, unknown>;
        if (
          !parsed ||
          Array.isArray(parsed) ||
          Object.keys(parsed).some((k) => !['env', 'http_headers'].includes(k)) ||
          Object.values(parsed).some(
            (v) =>
              !v ||
              typeof v !== 'object' ||
              Array.isArray(v) ||
              Object.values(v).some((x) => typeof x !== 'string'),
          )
        )
          throw new Error('Use JSON containing env or http_headers with string values.');
        await invoke('store_credential', { account, secret: JSON.stringify(parsed) });
      }
      setSecret('');
      setNotice(
        remove
          ? 'MCP credential deleted. Reapply permissions to close active connectors.'
          : 'MCP credential stored in the OS credential store. Reapply permissions to reconnect.',
      );
    } catch {
      setNotice('Could not update MCP credentials. Check the JSON and OS credential store.');
    }
  }
  const lines = (text: string) =>
    text
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  async function apply() {
    try {
      if (!isTauri()) throw new Error('Workspace permissions require Chista desktop.');
      await invoke('configure_workspace_security', {
        workspaceId,
        origins: lines(origins),
        servers: lines(servers),
      });
      setNotice(
        'Workspace permissions updated for this app run. Existing native sessions closed; reconnect before continuing.',
      );
      setReviewed(false);
    } catch (error) {
      setNotice(String(error));
    }
  }
  return (
    <section className="panel">
      <h2>Workspace security · read-only by default</h2>
      <p>
        Chat agents have no shell or repository filesystem tools. Every HTTP or MCP tool call
        requires a separate approval of its arguments. Agent output cannot change these permissions.
      </p>
      <label className="field">
        Local debugging origins · one exact origin per line
        <textarea
          value={origins}
          onChange={(e) => {
            setOrigins(e.target.value);
            setReviewed(false);
          }}
          placeholder="http://127.0.0.1:8080"
        />
      </label>
      <p>
        These origins may access private addresses. Redirects remain disabled. Exceptions apply only
        to this workspace and expire when the app exits.
      </p>
      <label className="field">
        Approved MCP servers · agent:name, one per line
        <textarea
          placeholder="codex:project-tools"
          value={servers}
          onChange={(e) => {
            setServers(e.target.value);
            setReviewed(false);
          }}
        />
      </label>
      <p>
        Before enabling a connector, inspect its exact command, arguments, environment and endpoint
        in the native CLI configuration. Starting a stdio connector executes that configured program
        with your OS account permissions; remote connectors make network connections. Enable only a
        connector scoped to this project. Chista cannot restrict what an external MCP server does
        internally.
      </p>
      <label className="field">
        Inspect native MCP configuration
        <select
          value={agent}
          onChange={(e) => {
            setAgent(e.target.value);
            setConfiguration('');
            setReviewed(false);
          }}
        >
          <option value="codex">Codex</option>
          <option value="claude">Claude</option>
        </select>
        <input
          aria-label="CLI path for configuration preview"
          value={path}
          onChange={(e) => {
            setPath(e.target.value);
            setConfiguration('');
            setReviewed(false);
          }}
          placeholder="Optional executable path"
        />
      </label>
      <button onClick={() => void preview()}>Preview connector commands and arguments</button>
      {configuration && <pre>{configuration}</pre>}
      <details>
        <summary>MCP credentials · OS credential store</summary>
        <p>
          Keep Chista-managed credentials here, rather than in frontend storage or command
          arguments. Use JSON with env and/or http_headers string values. Existing CLI-owned
          credentials remain managed by that CLI.
        </p>
        <label className="field">
          MCP credential server name
          <input value={credentialServer} onChange={(e) => setCredentialServer(e.target.value)} />
        </label>
        <label className="field">
          MCP credential JSON
          <input
            type="password"
            autoComplete="new-password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
        </label>
        <button onClick={() => void saveSecret()}>Store MCP credential</button>
        <button onClick={() => void saveSecret(true)}>Delete MCP credential</button>
      </details>
      <pre>{JSON.stringify({ origins: lines(origins), servers: lines(servers) }, null, 2)}</pre>
      <label>
        <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />{' '}
        I reviewed these destinations and the native connector startup commands and approve them for
        this workspace.
      </label>
      <button
        disabled={!reviewed || (lines(servers).length > 0 && !configuration)}
        onClick={() => void apply()}
      >
        Apply workspace permissions
      </button>
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
