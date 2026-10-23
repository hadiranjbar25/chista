import { describe, expect, it, vi } from 'vitest';
import { Sanitizer } from '../safety';
import { endpoint } from './transport';
import { hostedBody, hostedProvider, prepareRequest } from './providers';
import { ApprovalGate, McpConnections, type ConnectionState, type ToolRequest } from './mcp';
const request: ToolRequest = {serverId:'server',sessionId:'one',tool:'lookup',arguments:{id:'42'}};
describe('outgoing integration boundaries', () => {
  it('requires one-time approval bound to tool, arguments and session', () => {
    const gate = new ApprovalGate();expect(() => gate.consume(request)).toThrow();gate.approve(request);
    expect(() => gate.consume({...request,sessionId:'other'})).toThrow();expect(() => gate.consume({...request,arguments:{id:'43'}})).toThrow();
    gate.consume(request);expect(() => gate.consume(request)).toThrow();gate.approve(request);gate.clear();expect(() => gate.consume(request)).toThrow();
  });
  it('allows hosted HTTPS and MCP loopback but rejects URL credentials and unsafe schemes', () => {
    expect(endpoint('https://host.example/chat').hostname).toBe('host.example');expect(endpoint('http://127.0.0.1:3000/mcp',true).port).toBe('3000');
    for(const url of ['file:///etc/passwd','http://remote.example/mcp','https://token@host.example/mcp','https://host.example/mcp?token=secret','https://localhost/chat'])expect(() => endpoint(url)).toThrow();
  });
  it('sends exactly the preview body and no artifact metadata or raw secrets', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:'Observed a timeout.'}}]}),{status:200}));
    const config = {endpoint:'https://host.example/chat',model:'hosted-debugger',token:'memory-token'};
    const provider = hostedProvider(config,send);const prepared = prepareRequest([],'Check alex@example.com token=secret123','reviewed sanitized excerpt',new Sanitizer());
    expect(send).not.toHaveBeenCalled();await provider.complete(prepared,new AbortController().signal);
    const body = String(send.mock.calls[0][1]?.body);
    expect(JSON.parse(body)).toEqual(hostedBody(config.model,prepared));expect(body).not.toContain('alex@example.com');expect(body).not.toContain('secret123');expect(body).not.toContain('memory-token');expect(body).not.toContain('projectPath');
  });
  it('surfaces hosted failures without echoing remote response secrets', async () => {
    const provider = hostedProvider({endpoint:'https://host.example/chat',model:'x',token:''},vi.fn<typeof fetch>().mockResolvedValue(new Response('sensitive server text',{status:401})));
    await expect(provider.complete({messages:[],context:null},new AbortController().signal)).rejects.toThrow('HTTP 401');
  });
});
describe('MCP protocol connection', () => {
  it('initializes, discovers tools, requires approval, calls and disconnects using the SDK', async () => {
    const methods: string[]=[];const states: ConnectionState[]=[];
    const send: typeof fetch = vi.fn(async (_url, init) => {
      if(init?.method==='GET')return new Response(null,{status:405});
      if(init?.method==='DELETE')return new Response(null,{status:200});
      const msg=JSON.parse(String(init?.body));methods.push(msg.method);
      if(msg.method==='notifications/initialized')return new Response(null,{status:202});
      const result=msg.method==='initialize' ? {protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}} : msg.method==='tools/list' ? {tools:[{name:'lookup',inputSchema:{type:'object',properties:{id:{type:'string'}}}}]} : {content:[{type:'text',text:'found'}]};
      return new Response(JSON.stringify({jsonrpc:'2.0',id:msg.id,result}),{headers:{'Content-Type':'application/json','Mcp-Session-Id':'fixture-session'}});
    });
    const manager=new McpConnections((_id,s) => states.push(s),send);
    await manager.connect({id:'server',name:'Fixture',url:'https://fixture.example/mcp'});
    expect(states.at(-1)?.status).toBe('connected');expect(states.at(-1)?.tools[0].name).toBe('lookup');
    expect(methods).toContain('initialize');expect(methods).toContain('tools/list');expect(methods).not.toContain('tools/call');
    await expect(manager.call(request)).rejects.toThrow('approval');manager.approvals.approve(request);await manager.call(request);
    expect(methods.filter(m => m==='tools/call')).toHaveLength(1);await expect(manager.call(request)).rejects.toThrow('approval');
    await manager.disconnect('server');expect(states.at(-1)?.status).toBe('disconnected');
  });
  it('reports connection failure without pretending tools are available', async () => {
    const states:ConnectionState[]=[];const manager=new McpConnections((_id,s) => states.push(s),vi.fn<typeof fetch>().mockRejectedValue(new Error('private diagnostic')));
    await manager.connect({id:'s',name:'Unavailable',url:'https://fixture.example/mcp'});
    expect(states.at(-1)?.status).toBe('error');expect(states.at(-1)?.tools).toEqual([]);expect(states.at(-1)?.error).not.toContain('private diagnostic');
  });
});
