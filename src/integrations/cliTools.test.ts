import {beforeEach,expect,it,vi} from 'vitest';
const native=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:native.invoke}));
import {handleToolEvent,type ToolHooks} from './cliTools';
import {Sanitizer} from '../safety';
beforeEach(()=>native.invoke.mockReset().mockResolvedValue(undefined));
function hooks(approved=true):ToolHooks {
  const sanitizer=new Sanitizer('MCP');
  return {approve:vi.fn().mockResolvedValue(approved),sanitize:text=>sanitizer.sanitize(text,'json',[]),status:vi.fn()};
}
it('requires approval of sanitized tool arguments and sanitizes returned data before inference',async()=>{
  const toolHooks=hooks();
  const signal=new AbortController().signal;
  await handleToolEvent({type:'tool_approval',id:'call:approve',server:'rag-e-khab',tool:'search',arguments:{email:'alex@example.com'}},toolHooks,signal);
  const prompt=vi.mocked(toolHooks.approve).mock.calls[0][0];
  expect(JSON.stringify(prompt.arguments)).not.toContain('alex@example.com');
  expect(native.invoke.mock.calls[0][1].response.approved).toBe(true);
  expect(native.invoke.mock.calls[0][1].response.arguments).toEqual(prompt.arguments);
  await handleToolEvent({type:'tool_result',id:'call:result',result:{content:[{type:'text',text:'alex@example.com'}]}},toolHooks,signal);
  const response=native.invoke.mock.calls[1][1].response.content;
  expect(response).not.toContain('alex@example.com');
  expect(response).toContain('[MCP_EMAIL_1]');
});
it('denies calls on user rejection, cancellation or missing tool handling',async()=>{
  const event={type:'tool_approval' as const,id:'one',server:'test',tool:'write',arguments:{}};
  await handleToolEvent(event,hooks(false),new AbortController().signal);
  const controller=new AbortController();controller.abort();
  await handleToolEvent(event,hooks(),controller.signal);
  await handleToolEvent(event,undefined,new AbortController().signal);
  for(const [,args] of native.invoke.mock.calls)expect(args.response.approved).toBe(false);
});
