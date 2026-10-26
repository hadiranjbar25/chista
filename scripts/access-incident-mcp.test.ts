import {afterEach,expect,it} from 'vitest';
import type {Server} from 'node:http';
// @ts-expect-error Node-only test fixture; not shipped in the desktop bundle.
import {createIncidentServer} from './access-incident-mcp.mjs';
const servers:Server[]=[];
afterEach(async()=>{for(const server of servers.splice(0))await new Promise<void>(resolve=>server.close(()=>resolve()));});
async function start(datadog='ok'){
  const server=createIncidentServer({datadog}) as Server;servers.push(server);
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();if(!address||typeof address==='string')throw Error('Missing test port');
  const url=`http://127.0.0.1:${address.port}/mcp`;
  const call=async(method:string,params:unknown={})=>(await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})})).json();
  return {url,call};
}
it('serves a real MCP handshake, evidence tools, reconciling charts and a date-filtered follow-up',async()=>{
  const {call}=await start();
  expect((await call('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}})).result.serverInfo.name).toContain('illustrative');
  const list=await call('tools/list');
  expect(list.result.tools.map((t:{name:string})=>t.name)).toEqual(['access_events','effective_access','datadog_responses']);
  const tool=async(name:string,args:unknown)=>JSON.parse((await call('tools/call',{name,arguments:args})).result.content[0].text);
  const access=await tool('access_events',{date:'2026-10-22'}),permissions=await tool('effective_access',{date:'2026-10-22'});
  expect(access.illustrative).toBe(true);expect(access.events[1].authentication).toBe('succeeded');
  expect(permissions.permissions).toContain('file:read');expect(permissions.groups).not.toContain(permissions.requiredGroup);
  const current=await tool('datadog_responses',{from:'2026-10-22T09:55:00Z',to:'2026-10-22T10:20:00Z'});
  expect(current.totalDenied).toBe(14);expect(current.totalAllowed).toBe(126);
  const earlier=await tool('datadog_responses',{from:'2026-10-21T00:00:00Z',to:'2026-10-21T23:59:59Z'});
  expect(earlier.totalDenied).toBe(0);expect(earlier.totalAllowed).toBe(42);
  const oldAccess=await tool('effective_access',{date:'2026-10-21'});expect(oldAccess.groups).toContain(oldAccess.requiredGroup);
});
it('reports missing permissions and unavailable services without substituting success data',async()=>{
  for(const scenario of ['denied','unavailable']){
    const {call}=await start(scenario);
    const result=await call('tools/call',{name:'datadog_responses',arguments:{from:'2026-10-22T09:55:00Z',to:'2026-10-22T10:20:00Z'}});
    if(scenario==='denied')expect(result.result.isError).toBe(true);else expect(result.error.code).toBe(-32603);
    expect(JSON.stringify(result)).not.toContain('totalDenied');
  }
});
it('rejects cross-origin callers, unexpected tools and invalid windows',async()=>{
  const {url,call}=await start();
  expect((await fetch(url,{method:'POST',headers:{Origin:'https://untrusted.example'},body:'{}'})).status).toBe(403);
  expect((await call('tools/call',{name:'write_permissions'})).result.isError).toBe(true);
  expect((await call('tools/call',{name:'datadog_responses',arguments:{from:'no',to:'no'}})).result.isError).toBe(true);
  const missing=await call('tools/call',{name:'datadog_responses',arguments:{from:'2026-10-24T00:00:00Z',to:'2026-10-24T23:59:59Z'}});
  expect(missing.result.isError).toBe(true);expect(JSON.stringify(missing)).not.toContain('totalDenied');
});
