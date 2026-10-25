import { beforeEach, expect, it, vi } from 'vitest';
const native=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:native.invoke,isTauri:()=>true}));
import { CliConversation, nativeTurnPreview } from './conversation';
import type { Message } from './providers';
beforeEach(()=>native.invoke.mockReset().mockResolvedValue(undefined));
it('sends instructions once and previews only the new message for follow-ups',()=>{
  const session=new CliConversation();
  const first=session.prepare('codex','',{messages:[{role:'user',content:'First'}],context:'safe context'});
  expect(first.systemPrompt).toContain('You are Chista');expect(first.systemPrompt).toContain('chista_mcp_catalog');expect(first.payload).toContain('safe context');
  const history:Message[]=[{role:'user',content:'First'},{role:'assistant',content:'Answer'}];
  session.commit(first,history);
  const next=session.prepare('codex','',{messages:[...history,{role:'user',content:'Next'}],context:'safe context'});
  expect(next.sessionKey).toBe(first.sessionKey);expect(next.systemPrompt).toBeNull();
  expect(JSON.parse(nativeTurnPreview(next))).toEqual({messages:[{role:'user',content:'Next'}]});
});
it('isolates sessions and resets when context, instructions or history differ',()=>{
  const one=new CliConversation();const two=new CliConversation();
  const request={messages:[{role:'user' as const,content:'Question'}],context:'context A'};
  const first=one.prepare('claude','',request);const other=two.prepare('claude','',request);
  expect(first.systemPrompt).toContain('No tools are available');
  expect(other.sessionKey).not.toBe(first.sessionKey);
  one.commit(first,[...request.messages,{role:'assistant',content:'Answer'}]);
  const next=one.prepare('claude','',{...request,context:'context B'});
  expect(next.sessionKey).not.toBe(first.sessionKey);expect(next.systemPrompt).not.toBeNull();
  expect(native.invoke).toHaveBeenCalledWith('close_agent_session',{sessionKey:first.sessionKey});
  one.reset();one.commit(next,request.messages);
  expect(one.prepare('codex','',request).systemPrompt).not.toBeNull();
});
