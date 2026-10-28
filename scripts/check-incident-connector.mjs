// Exercise the installed Codex connector against the real HTTP fixture.
// No turn/start is sent: this checks MCP discovery/calls without AI inference,
// credentials, global config changes, or access to production MCP servers.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createIncidentServer } from './access-incident-mcp.mjs';
const directory = await mkdtemp(join(tmpdir(), 'chista-mcp-check-'));
const server = createIncidentServer();
let child, lines;
const pending = new Map();
let sequence = 0;
function rpc(method, params) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out: ${method}`));
    }, 30000);
    pending.set(id, {
      resolve: (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  child = spawn(
    process.env.CHISTA_CODEX_BINARY ?? 'codex',
    [
      'app-server',
      '--stdio',
      '--strict-config',
      '-c',
      'default_permissions="chista"',
      '-c',
      'permissions.chista.filesystem={":minimal"="read",":workspace_roots"="read"}',
      '-c',
      'permissions.chista.network.enabled=false',
      '-c',
      'project_doc_max_bytes=0',
      '-c',
      'features.shell_tool=false',
      '-c',
      'features.shell_snapshot=false',
      '-c',
      'features.apps=false',
      '-c',
      'features.plugins=false',
      '-c',
      'features.hooks=false',
      '-c',
      'features.multi_agent=false',
      '-c',
      'features.skip_host_skill_discovery=true',
      '-c',
      'analytics.enabled=false',
    ],
    { cwd: directory, stdio: ['pipe', 'pipe', 'ignore'] },
  );
  const ended = new Promise((resolve) => child.once('close', resolve));
  child.once('error', () => {
    for (const entry of pending.values())
      entry.reject(new Error('Could not start installed Codex CLI.'));
    pending.clear();
  });
  child.once('exit', () => {
    for (const entry of pending.values()) entry.reject(new Error('Codex connector exited.'));
    pending.clear();
  });
  lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const entry = pending.get(message.id);
    if (entry) {
      pending.delete(message.id);
      if (message.error)
        entry.reject(
          new Error(
            'Codex connector rejected an RPC request. Update the CLI and inspect its native configuration.',
          ),
        );
      else entry.resolve(message.result);
    }
    // Refuse any server-initiated approval/tool request. This smoke check only
    // issues the three fixture tools directly; it never runs an agent turn.
    else if (message.id !== undefined && message.method)
      child.stdin.write(
        JSON.stringify({
          id: message.id,
          error: { code: -32601, message: 'Not supported in connector smoke check' },
        }) + '\n',
      );
  });
  await rpc('initialize', {
    clientInfo: { name: 'chista-incident-check', version: '1.0.0' },
    capabilities: { experimentalApi: true },
  });
  child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  const effective = await rpc('config/read', { cwd: directory, includeLayers: false });
  // Keep existing transport fields valid, but disable every inherited server.
  // URLs and credentials from config/read never enter stdout or a model turn.
  const servers = Object.fromEntries(
    Object.entries(effective.config?.mcp_servers ?? {}).map(([name, value]) => [
      name,
      {
        ...Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null)),
        enabled: false,
      },
    ]),
  );
  servers['chista-access-test'] = { url, enabled: true, startup_timeout_sec: 10 };
  const started = await rpc('thread/start', {
    cwd: directory,
    ephemeral: true,
    approvalPolicy: 'never',
    permissions: 'chista',
    environments: [],
    baseInstructions: 'Connector-only test. Never run inference.',
    config: { mcp_servers: servers, mcp_optional_startup_grace_ms: 0 },
  });
  const threadId = started.thread.id;
  const inventory = await rpc('mcpServerStatus/list', {
    threadId,
    limit: 100,
    detail: 'toolsAndAuthOnly',
  });
  const fixture = inventory.data.find((server) => server.name === 'chista-access-test');
  const names = Object.keys(fixture?.tools ?? {});
  for (const tool of ['access_events', 'effective_access', 'datadog_responses'])
    if (!names.includes(tool)) throw new Error(`Fixture tool missing: ${tool}`);
  async function call(tool, args) {
    const result = await rpc('mcpServer/tool/call', {
      threadId,
      server: 'chista-access-test',
      tool,
      arguments: args,
    });
    if (result.isError) throw new Error(`Fixture call failed: ${tool}`);
    const text = result.content?.find((item) => item.type === 'text')?.text;
    if (!text) throw new Error(`Fixture returned no text: ${tool}`);
    return JSON.parse(text);
  }
  const access = await call('access_events', { date: '2026-10-22' });
  const permissions = await call('effective_access', { date: '2026-10-22' });
  const response = await call('datadog_responses', {
    from: '2026-10-22T09:55:00Z',
    to: '2026-10-22T10:20:00Z',
  });
  const previous = await call('datadog_responses', {
    from: '2026-10-21T00:00:00Z',
    to: '2026-10-21T23:59:59Z',
  });
  if (
    !access.illustrative ||
    permissions.groups.includes(permissions.requiredGroup) ||
    response.totalDenied !== 14 ||
    response.totalAllowed !== 126 ||
    previous.totalDenied !== 0
  )
    throw new Error('Incident evidence did not reconcile.');
  console.log(
    JSON.stringify(
      {
        result: 'passed',
        illustrative: true,
        tools: names,
        denied: response.totalDenied,
        allowed: response.totalAllowed,
        previousDayDenied: previous.totalDenied,
        inferenceRan: false,
        globalConfigChanged: false,
      },
      null,
      2,
    ),
  );
  child.stdin.end();
  const timeout = setTimeout(() => child.kill('SIGTERM'), 1500);
  await ended;
  clearTimeout(timeout);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  for (const entry of pending.values()) entry.reject(new Error('Connector check closed.'));
  pending.clear();
  lines?.close();
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      const kill = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 2000);
      child.once('close', () => {
        clearTimeout(kill);
        resolve();
      });
    });
  }
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
