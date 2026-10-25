import { invoke } from '@tauri-apps/api/core';
export type McpStatus = {name: string; authStatus: string; available: boolean; failed: boolean};
export type ToolApproval = {server: string; tool: string; arguments: unknown};
export type ToolHooks = {
  approve: (tool: ToolApproval) => Promise<boolean>;
  sanitize: (text: string) => string;
  status: (servers: McpStatus[]) => void;
};
export type ToolEvent =
  | {type: 'tool_approval'; id: string; server: string; tool: string; arguments: unknown}
  | {type: 'tool_result'; id: string; result: unknown}
  | {type: 'mcp_status'; servers: McpStatus[]};

// Raw MCP results are accepted only here and sanitized before being returned to
// the native connector. They never become model messages or rendered responses.
export async function handleToolEvent(event: ToolEvent, hooks: ToolHooks | undefined, signal: AbortSignal) {
  if(event.type==='mcp_status') {if(!signal.aborted) hooks?.status(event.servers);return;}
  let response: unknown={approved:false};
  try {
    if(!hooks || signal.aborted) throw new Error('Tool handling unavailable');
    if(event.type==='tool_result') {
      const safe=hooks.sanitize(JSON.stringify(event.result));
      response={content:safe.length>60000?safe.slice(0,60000)+'\n[MCP result truncated locally at 60,000 characters]':safe};
    }
    else {
      const encoded=hooks.sanitize(JSON.stringify(event.arguments));
      if(encoded.length>100000) throw new Error('Tool arguments exceed the review limit');
      const args=JSON.parse(encoded);
      const approved=await hooks.approve({server:event.server,tool:event.tool,arguments:args});
      response={approved:approved && !signal.aborted,arguments:args};
    }
  } catch {response=event.type==='tool_result'?{content:'MCP result could not be sanitized.'}:{approved:false};}
  // Cancellation/closing a session expires the native request.
  await invoke('respond_agent_tool',{id:event.id,response}).catch(()=>{});
}
