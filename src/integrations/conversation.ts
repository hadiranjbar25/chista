import { invoke, isTauri } from '@tauri-apps/api/core';
import { hostedBody, type Message, type ModelRequest } from './providers';

export type NativeTurn = { sessionKey: string; systemPrompt: string | null; payload: string };
// One instance per Chista session. No provider-owned thread IDs or raw files enter the UI.
export class CliConversation {
  private key = '';
  private token = '';
  private history: string | null = null;
  prepare(agent: string, executablePath: string, request: ModelRequest): NativeTurn {
    const messages = hostedBody('',request).messages;
    const systemPrompt = messages[0].content;
    const key = JSON.stringify([agent,executablePath,request.context,systemPrompt]);
    const history = JSON.stringify(request.messages.slice(0,-1));
    if (key !== this.key || (this.history !== null && this.history !== history)) this.reset();
    this.key = key;
    if (!this.token) this.token = crypto.randomUUID();
    return { sessionKey:this.token, systemPrompt:this.history === null ? systemPrompt : null,
      payload:JSON.stringify({messages:this.history === null ? messages.slice(1) : request.messages.slice(-1)},null,2) };
  }
  commit(turn: NativeTurn, history: Message[]) {
    if (turn.sessionKey === this.token) this.history = JSON.stringify(history);
  }
  reset() {
    const token=this.token;
    this.key='';this.token='';this.history=null;
    if(token && isTauri()) void invoke('close_agent_session',{sessionKey:token}).catch(()=>{});
  }
}
export function nativeTurnPreview(turn: NativeTurn) {
  return JSON.stringify({ ...(turn.systemPrompt !== null ? {systemPrompt:turn.systemPrompt} : {}), ...JSON.parse(turn.payload) },null,2);
}
