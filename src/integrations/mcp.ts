import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { desktopFetch, endpoint } from './transport';
export type ServerConfig = { id: string; name: string; url: string };
export type ConnectionState = { status: 'disconnected' | 'connecting' | 'connected' | 'error'; tools: Tool[]; error?: string };
export type ToolRequest = { serverId: string; tool: string; arguments: Record<string, unknown>; sessionId: string };
export class ApprovalGate {
  private approved = new Set<string>();
  approve(request: ToolRequest) { this.approved.add(JSON.stringify(request)); }
  consume(request: ToolRequest) { const key = JSON.stringify(request); if (!this.approved.delete(key)) throw new Error('This exact tool call requires approval.'); }
  clear() { this.approved.clear(); }
}
export class McpConnections {
  private clients = new Map<string, Client>();
  private generations = new Map<string, number>();
  readonly approvals = new ApprovalGate();
  constructor(private update: (id: string, state: ConnectionState) => void, private send: typeof fetch = desktopFetch) {}
  async connect(config: ServerConfig, token = '') {
    await this.disconnect(config.id);
    const generation = this.generations.get(config.id) ?? 0;
    const client = new Client({ name: 'chista', version: '0.2.0' }, { capabilities: {} });
    this.clients.set(config.id, client);
    this.update(config.id, { status: 'connecting', tools: [] });
    const current = () => this.clients.get(config.id) === client && this.generations.get(config.id) === generation;
    client.onclose = () => { if (current()) { this.clients.delete(config.id); this.update(config.id, {status:'disconnected',tools:[]}); } };
    client.onerror = () => { if (current()) this.update(config.id, {status:'error',tools:[],error:'MCP transport error. Reconnect to refresh tools.'}); };
    try {
      const transport = new StreamableHTTPClientTransport(endpoint(config.url, true), { fetch: this.send, requestInit: { headers: token ? { Authorization: `Bearer ${token}` } : {}, redirect: 'error' } });
      await client.connect(transport, { timeout: 15_000 });
      const tools: Tool[] = []; let cursor: string | undefined; let pages = 0;
      do { const page = await client.listTools({cursor}, {timeout:15_000}); tools.push(...page.tools); cursor = page.nextCursor; if (++pages > 100 || tools.length > 1000) throw new Error('Tool limit exceeded'); } while(cursor);
      if (current()) this.update(config.id, {status:'connected',tools}); else await client.close();
    } catch {
      if (this.generations.get(config.id) === generation) { this.clients.delete(config.id); this.update(config.id, {status:'error',tools:[],error:'Connection failed. Verify the Streamable HTTP endpoint and access token. OAuth-only and stdio servers are not supported in this MVP.'}); }
      await client.close().catch(() => {});
    }
  }
  async disconnect(id: string) {
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
    const client = this.clients.get(id); this.clients.delete(id); this.approvals.clear();
    this.update(id, {status:'disconnected',tools:[]});
    if (client) await client.close().catch(() => {});
  }
  async call(request: ToolRequest) {
    this.approvals.consume(request);
    const client = this.clients.get(request.serverId); if (!client) throw new Error('Server is disconnected.');
    const result = await client.callTool({name:request.tool, arguments:request.arguments}, undefined, {timeout:30_000});
    return result;
  }
  dispose() { for (const id of this.clients.keys()) void this.disconnect(id); }
}
