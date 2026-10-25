import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { ArrowRight, ShieldCheck, X } from 'lucide-react';
import { claudeProvider, codexProvider, claudePayload, streamingProse } from './integrations/claude';
import AgentResponse, { parseReply } from './AgentResponse';
import { useChatScroll } from './useChatScroll';
import FullscreenSection, { exitSectionFullscreen } from './FullscreenSection';
import { CliConversation, nativeTurnPreview, type NativeTurn } from './integrations/conversation';
import { ensureCliSignIn } from './integrations/signIn';
import type { ToolApproval, McpStatus } from './integrations/cliTools';
import { Sanitizer } from './safety';
import { hostedProvider, hostedBody, prepareRequest, type HostedConfig, type Message, type ModelRequest } from './integrations/providers';
import type { Repository, ChatAttachments } from './workspace';
type Pending = { request: ModelRequest; config: HostedConfig; mode: string; executablePath: string; turn?: NativeTurn };
export default function AgentChat({active=true,repositories,context,mode,hosted,claudePath,codexPath='',onAgentChange,onSessionTitle,onModelStatus,onFiles,onAddFiles,attachments,onRemoveAttachment}: {
  active?: boolean; repositories: Repository[]; context: string|null; mode: string; hosted: HostedConfig; claudePath: string; codexPath?: string; onAgentChange?: (mode: string) => void;
 attachments?: ChatAttachments; onRemoveAttachment?: (id: string) => void;
 onSessionTitle?: (title: string) => void; onFiles: () => void; onAddFiles: () => void;
  onModelStatus: (key: string, status: string) => void;
}) {
  const agentLabel = mode === 'hosted' ? hosted.model : mode === 'codex' ? 'Codex' : 'Claude Code';
  const executablePath = mode === 'codex' ? codexPath : claudePath;
  const repoSignature = JSON.stringify(repositories.map(r => [r.id,r.name,r.path]));
  const [messages,setMessages] = useState<Message[]>([]); const [prompt,setPrompt] = useState('');
  const [showAttachments,setShowAttachments] = useState(false);
  const [stream,setStream] = useState('');
  const [reviewBeforeSending,setReviewBeforeSending] = useState(true);
  const [authStatus,setAuthStatus] = useState('');
  const [toolApproval,setToolApproval]=useState<ToolApproval|null>(null);
  const [mcpServers,setMcpServers]=useState<McpStatus[]>([]);
  useEffect(()=>setMcpServers([]),[mode,codexPath]);
  const toolDecision=useRef<((approved:boolean)=>void)|null>(null);
  function decideTool(approved:boolean) {toolDecision.current?.(approved);toolDecision.current=null;setToolApproval(null);}
  useEffect(()=>()=>{toolDecision.current?.(false);},[]);

  const [pending,setPending] = useState<Pending|null>(null); const [busy,setBusy] = useState(false); const [notice,setNotice] = useState('');
  const sanitizer = useRef(new Sanitizer('CHAT'));
  const composer=useRef<HTMLTextAreaElement>(null);
  const { content: conversation, paused: scrollPaused, jumpToLatest } = useChatScroll(active);
  const conversationState = useRef(new CliConversation());
  const abort = useRef<AbortController|null>(null); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current=false;abort.current?.abort();conversationState.current.reset(); }; }, []);
  useEffect(() => { setPending(null); }, [context, mode, claudePath, codexPath, hosted.endpoint, hosted.model, hosted.token, repoSignature, attachments?.busy]);
  useEffect(() => { if (!active) { abort.current?.abort();setPending(null);decideTool(false); } }, [active]);
  useEffect(() => {conversationState.current.reset(); return () => {abort.current?.abort();conversationState.current.reset();};}, [mode,claudePath,codexPath,context]);
  const canSend = !busy && !attachments?.busy && Boolean(prompt.trim() || attachments?.files.length);
  function sendMessage() {
    if (!canSend) return;
    try {
      if (mode === 'hosted') hostedProvider(hosted);
      if (mode === 'claude') claudeProvider(claudePath);
      if (mode === 'codex') codexProvider(codexPath);
      const request: Pending={request:prepareRequest(messages,prompt.trim() || 'Analyze the attached sanitized debug files.',context,sanitizer.current),config:{...hosted},mode,executablePath};
      if(mode==='codex' && mcpServers.some(server=>!server.available || server.authStatus==='notLoggedIn')) conversationState.current.reset();
      if (mode !== 'hosted') request.turn=conversationState.current.prepare(mode,executablePath,request.request);
      if (reviewBeforeSending) setPending(request);
      else void execute(request);
    } catch(e) {setNotice(String(e));}
  }
  async function execute(snapshot: Pending) {
    if (busy) return;
    setPending(null);setBusy(true);setNotice('');setStream('');
    try {
      jumpToLatest();
      const provider = snapshot.mode === 'hosted' ? hostedProvider(snapshot.config) : snapshot.mode === 'codex' ? codexProvider(snapshot.executablePath,snapshot.turn,{
        sanitize:text=>sanitizer.current.sanitize(text,'json',[]),
        status:setMcpServers,
        approve:tool=>new Promise<boolean>(resolve=>{toolDecision.current=resolve;setToolApproval(tool);}),
      }) : claudeProvider(snapshot.executablePath,snapshot.turn);
      abort.current = new AbortController();
      const signal = abort.current.signal;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        if (snapshot.mode !== 'hosted') await ensureCliSignIn(snapshot.mode,snapshot.executablePath,signal,setAuthStatus);
        signal.throwIfAborted();
        timer = setTimeout(() => abort.current?.abort(),600_000);
        if (snapshot.mode === 'hosted') onModelStatus(JSON.stringify([snapshot.config.endpoint,snapshot.config.model]),'Connecting…');
        setMessages(snapshot.request.messages);
        const reply = await provider.complete(snapshot.request,abort.current.signal, text => { if(mounted.current) setStream(sanitizer.current.text(streamingProse(text))); });
        if (snapshot.mode === 'hosted') onModelStatus(JSON.stringify([snapshot.config.endpoint,snapshot.config.model]),'Connected · last request succeeded');
        if (mounted.current) {
          const content = sanitizer.current.sanitize(JSON.stringify(parseReply(reply)),'json',[]);
          const title = parseReply(content).sessionTitle;
          if (title && !snapshot.request.messages.some(message=>message.role==='assistant')) onSessionTitle?.(title);
          const next: Message[]=[...snapshot.request.messages,{role:'assistant',content}];
          if(snapshot.turn) conversationState.current.commit(snapshot.turn,next);
          setMessages(next);setPrompt('');
        }
      } finally { clearTimeout(timer); }
    } catch (error) { if(snapshot.mode!=='hosted') conversationState.current.reset(); if (mounted.current) setMessages(snapshot.request.messages.slice(0,-1)); if (snapshot.mode === 'hosted') onModelStatus(JSON.stringify([snapshot.config.endpoint,snapshot.config.model]),'Error · last request failed or cancelled'); if (mounted.current) setNotice(snapshot.mode !== 'hosted' ? `${String(error)} No automatic retry was made.` : 'Request failed or was cancelled. Check integration status and permissions. No automatic retry was made.'); }
    finally { if (mounted.current) { setBusy(false);setStream('');setAuthStatus('');decideTool(false); } }
  }
  return <section className="chat-view"><div className="chat-status">{context && !attachments?.files.length && <button className="context-chip" onClick={onFiles}><ShieldCheck size={14}/>{context.length.toLocaleString()} characters of reviewed context attached</button>}</div>
    <div ref={conversation} className="messages" role="log" aria-live="polite" aria-label="Conversation">{!messages.length && <div className="chat-welcome"><span className="welcome-mark" role="img" aria-label="Chista">✳</span><h1>What are you debugging?</h1><p>Describe the issue below. Add logs or data when you need evidence; review redactions before sharing.</p><p className="muted">{isTauri() ? 'The selected agent uses your existing CLI sign-in. Responses appear here with interactive charts and tables when useful.' : 'Open Chista desktop to connect your agent. You can import and review files locally in this browser.'}</p></div>}{messages.map((m,i)=><article className={'message '+m.role} key={i}><strong>{m.role==='user'?'You':'Chista'}</strong>{m.role==='assistant'?<AgentResponse content={m.content} onFollow={text=>{exitSectionFullscreen();setPrompt(text);queueMicrotask(()=>composer.current?.focus());}}/>:<p>{m.content}</p>}</article>)}{busy && stream && <article className="message assistant"><strong>{agentLabel}</strong><p style={{whiteSpace:"pre-wrap"}}>{stream}</p></article>}{busy && <p className="thinking" role="status">{authStatus || (stream?'Streaming response…':'Waiting for agent…')}</p>}</div>

    {mode==='codex' && mcpServers.some(server=>!server.available || server.authStatus==='notLoggedIn') && <div className="mcp-sign-in">{mcpServers.filter(server=>!server.available || server.authStatus==='notLoggedIn').map(server=><div key={server.name}><span>{server.name} · {server.authStatus==='notLoggedIn'?'Sign-in required':server.failed?'Connection failed':'No tools available'}</span>{server.authStatus==='notLoggedIn' && <button disabled={busy} onClick={async()=>{try{setNotice(await invoke<string>('codex_mcp_sign_in',{executablePath:codexPath,server:server.name}));conversationState.current.reset();}catch{setNotice('Could not open MCP sign-in. Run Codex MCP login in your terminal.');}}}>Sign in</button>}</div>)}</div>}
    <form className="chat-composer"  onSubmit={e=>{e.preventDefault();if(canSend)sendMessage();}}>{scrollPaused && <button type="button" className="jump-to-latest" onClick={jumpToLatest}>↓ Jump to latest</button>}{Boolean(attachments?.files.length) && <div className="chat-attachments">{attachments!.files.map(file=><div className="chat-attachment" key={file.id}><button type="button" className="attachment-preview" onClick={()=>setShowAttachments(value=>!value)} title="Preview sanitized attachments"><strong>{file.name}</strong><small>{file.redactions} redactions · ready</small></button><button type="button" disabled={busy || attachments?.busy} aria-label={`Remove attachment ${file.name}`} onClick={()=>onRemoveAttachment?.(file.id)}><X size={14}/></button></div>)}</div>}{attachments?.busy && <p className="muted" role="status">Sanitizing attachments locally…</p>}{attachments?.error && <p className="error" role="alert">{attachments.error}</p>}{showAttachments && attachments?.context && <FullscreenSection title="Sanitized attachments"><div className="attachment-details"><div className="action-row"><strong>Sanitized attachments</strong><button type="button" onClick={onFiles}>Mappings &amp; redactions</button><button type="button" aria-label="Close attachment preview" onClick={()=>setShowAttachments(false)}><X size={14}/></button></div><p className="muted">Only this compacted content is sent. Original filenames and mappings stay local.</p><pre>{attachments.context}</pre></div></FullscreenSection>}<textarea ref={composer} aria-label="Message agent" value={prompt} disabled={busy} onChange={e=>{setPrompt(e.target.value);setPending(null);}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(canSend)sendMessage();}}} placeholder="Message Chista…"/><div className="composer-actions"><div className="composer-options">{onAgentChange && <select aria-label="Chat agent" value={mode} onChange={e=>onAgentChange(e.target.value)}><option value="claude">Claude Code</option><option value="codex">Codex</option>{hosted.endpoint && <option value="hosted">{hosted.model || 'Hosted provider'}</option>}</select>}<button type="button" disabled={busy || attachments?.busy} onClick={onAddFiles}>+ Add files</button><label className="review-toggle"><input type="checkbox" checked={reviewBeforeSending} disabled={busy} onChange={e=>{setReviewBeforeSending(e.target.checked);setPending(null);}}/>Review before sending</label></div>{busy?<button type="button" onClick={()=>{decideTool(false);abort.current?.abort();}}>Stop</button>:<button type="submit" className="primary" disabled={!canSend}>Send <ArrowRight size={15}/></button>}</div></form>
    {toolApproval && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="Approve MCP tool"><h2>Run this MCP tool?</h2><p>{toolApproval.server} · {toolApproval.tool}</p><p>These locally sanitized arguments will be sent to the server. This tool may change remote data.</p><FullscreenSection title="Tool arguments"><pre>{JSON.stringify(toolApproval.arguments,null,2)}</pre></FullscreenSection><div className="modal-actions"><button onClick={()=>decideTool(false)}>Deny tool</button><button className="primary" onClick={()=>decideTool(true)}>Approve tool once</button><button onClick={()=>{decideTool(false);abort.current?.abort();}}>Stop</button></div></section></div>}
    {notice && <div role="status" className="notice">{notice}</div>}{pending && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="Approve outgoing request"><div className="section-heading"><h2>Review outgoing message</h2><button aria-label="Deny and close" onClick={() => setPending(null)}><X size={16}/></button></div><p>{pending.mode !== 'hosted' ? `Destination: ${pending.mode === 'codex' ? 'Codex' : 'Claude Code'} CLI → cloud provider. Only this reviewed conversation is sent; local mappings and repository files are excluded.` : `Destination: ${pending.config.endpoint} · model: ${pending.config.model}`}</p>{pending.turn?.systemPrompt===null && <p>Continuing this session: only the new message is sent. The agent retains the earlier conversation and instructions.</p>}<FullscreenSection title="Outgoing request"><pre>{pending.mode !== 'hosted' ? (pending.turn ? nativeTurnPreview(pending.turn) : claudePayload(pending.request)) : JSON.stringify(hostedBody(pending.config.model,pending.request),null,2)}</pre></FullscreenSection><p>Pattern detection may miss sensitive values. Deny to edit anything you do not want to share.</p><div className="modal-actions"><button onClick={() => setPending(null)}>Deny / edit</button><button autoFocus className="primary" onClick={() => {if(pending) void execute(pending);}}>Approve and send</button></div></section></div>}</section>;
}
