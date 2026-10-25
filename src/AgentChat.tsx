import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { ArrowRight, ShieldCheck, X } from 'lucide-react';
import { claudeProvider, codexProvider, claudePayload, streamingProse } from './integrations/claude';
import AgentResponse, { parseReply } from './AgentResponse';
import { useChatScroll } from './useChatScroll';
import { CliConversation, nativeTurnPreview, type NativeTurn } from './integrations/conversation';
import { ensureCliSignIn } from './integrations/signIn';
import { Sanitizer } from './safety';
import { hostedProvider, hostedBody, prepareRequest, type HostedConfig, type Message, type ModelRequest } from './integrations/providers';
import { McpConnections, type ConnectionState, type ServerConfig, type ToolRequest } from './integrations/mcp';
import type { Repository, Session, ChatAttachments } from './workspace';
type Pending = { kind: 'model'; request: ModelRequest; config: HostedConfig; mode: string; executablePath: string; turn?: NativeTurn } | { kind: 'tool'; request: ToolRequest; destination: string };
export default function AgentChat({active=true,repositories,session,context,mode,hosted,claudePath,codexPath='',onAgentChange,onSessionTitle,servers,connections,mcp,onModelStatus,onFiles,onAddFiles,attachments,onRemoveAttachment}: {
  active?: boolean; repositories: Repository[]; session: Session; context: string|null; mode: string; hosted: HostedConfig; claudePath: string; codexPath?: string; onAgentChange?: (mode: string) => void;
 attachments?: ChatAttachments; onRemoveAttachment?: (id: string) => void;
 onSessionTitle?: (title: string) => void; onFiles: () => void; onAddFiles: () => void;
  onModelStatus: (key: string, status: string) => void;
  servers: ServerConfig[]; connections: Record<string,ConnectionState>; mcp: McpConnections;
}) {
  const agentLabel = mode === 'hosted' ? hosted.model : mode === 'codex' ? 'Codex' : 'Claude Code';
  const executablePath = mode === 'codex' ? codexPath : claudePath;
  const repoSignature = JSON.stringify(repositories.map(r => [r.id,r.name,r.path]));
  const [messages,setMessages] = useState<Message[]>([]); const [prompt,setPrompt] = useState('');
  const [showAttachments,setShowAttachments] = useState(false);
  const [stream,setStream] = useState('');
  const [reviewBeforeSending,setReviewBeforeSending] = useState(true);
  const [authStatus,setAuthStatus] = useState('');
  const [pending,setPending] = useState<Pending|null>(null); const [busy,setBusy] = useState(false); const [notice,setNotice] = useState('');
  const [server,setServer] = useState(''); const [tool,setTool] = useState(''); const [args,setArgs] = useState('{}');
  const [toolResults,setToolResults] = useState<string[]>([]); const sanitizer = useRef(new Sanitizer('CHAT'));
  const composer=useRef<HTMLTextAreaElement>(null);
  const { content: conversation, paused: scrollPaused, jumpToLatest } = useChatScroll(active);
  const conversationState = useRef(new CliConversation());
  const abort = useRef<AbortController|null>(null); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current=false;abort.current?.abort();conversationState.current.reset(); }; }, []);
  useEffect(() => { setPending(null); }, [context, mode, claudePath, codexPath, hosted.endpoint, hosted.model, hosted.token, connections, repoSignature, attachments?.busy]);
  useEffect(() => { if (!active) { abort.current?.abort();setPending(null); } }, [active]);
  useEffect(() => {conversationState.current.reset(); return () => {abort.current?.abort();conversationState.current.reset();};}, [mode,claudePath,codexPath,context]);
  const canSend = !busy && !attachments?.busy && Boolean(prompt.trim() || attachments?.files.length);
  function sendMessage() {
    if (!canSend) return;
    try {
      if (mode === 'hosted') hostedProvider(hosted);
      if (mode === 'claude') claudeProvider(claudePath);
      if (mode === 'codex') codexProvider(codexPath);
      const request: Pending={kind:'model',request:prepareRequest(messages,prompt.trim() || 'Analyze the attached sanitized debug files.',context,sanitizer.current),config:{...hosted},mode,executablePath};
      if (mode !== 'hosted') request.turn=conversationState.current.prepare(mode,executablePath,request.request);
      if (reviewBeforeSending) setPending(request);
      else void execute(request);
    } catch(e) {setNotice(String(e));}
  }
  function reviewTool() {
    try {
      const parsed: unknown = JSON.parse(args); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Arguments must be a JSON object.');
      if (!connections[server]?.tools.some(t => t.name === tool)) throw new Error('Select a connected tool.');
      const sanitized = JSON.parse(sanitizer.current.sanitize(JSON.stringify(parsed),'json',[]));
      setPending({kind:'tool',request:{serverId:server,tool,arguments:sanitized,sessionId:session.id},destination:servers.find(s => s.id === server)?.url ?? ''});
    } catch {setNotice('Choose a connected tool and enter valid JSON object arguments.');}
  }
  async function execute(snapshot: Pending) {
    if (busy) return;
    setPending(null);setBusy(true);setNotice('');setStream('');
    try {
      if (snapshot.kind === 'model') {
        jumpToLatest();
        const provider = snapshot.mode === 'hosted' ? hostedProvider(snapshot.config) : snapshot.mode === 'codex' ? codexProvider(snapshot.executablePath,snapshot.turn) : claudeProvider(snapshot.executablePath,snapshot.turn);
        abort.current = new AbortController();
        const signal = abort.current.signal;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          if (snapshot.mode !== 'hosted') await ensureCliSignIn(snapshot.mode,snapshot.executablePath,signal,setAuthStatus);
          signal.throwIfAborted();
          timer = setTimeout(() => abort.current?.abort(),125_000);
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
      } else {
        mcp.approvals.approve(snapshot.request);
        const result = await mcp.call(snapshot.request);
        if (mounted.current) setToolResults(r => [...r,`${snapshot.request.tool}\n${sanitizer.current.text(JSON.stringify(result,null,2))}`]);
      }
    } catch (error) { if(snapshot.kind==='model' && snapshot.mode!=='hosted') conversationState.current.reset(); if (mounted.current && snapshot.kind === 'model') setMessages(snapshot.request.messages.slice(0,-1)); if (snapshot.kind === 'model' && snapshot.mode === 'hosted') onModelStatus(JSON.stringify([snapshot.config.endpoint,snapshot.config.model]),'Error · last request failed or cancelled'); if (mounted.current) setNotice(snapshot.kind === 'model' && snapshot.mode !== 'hosted' ? `${String(error)} No automatic retry was made.` : 'Request failed or was cancelled. Check integration status and permissions. No automatic retry was made.'); }
    finally { if (mounted.current) { setBusy(false);setStream('');setAuthStatus(''); } }
  }
  const available = connections[server]?.status === 'connected' ? connections[server].tools : [];
  return <section className="chat-view"><div className="chat-status">{context && !attachments?.files.length && <button className="context-chip" onClick={onFiles}><ShieldCheck size={14}/>{context.length.toLocaleString()} characters of reviewed context attached</button>}</div>
    <div ref={conversation} className="messages" role="log" aria-live="polite" aria-label="Conversation">{!messages.length && <div className="chat-welcome"><img className="welcome-app-icon" src="/chista-icon.png" alt="Chista" width={64} height={64}/><h1>What are you debugging?</h1><p>Describe the issue below. Add logs or data when you need evidence; review redactions before sharing.</p><p className="muted">{isTauri() ? 'The selected agent uses your existing CLI sign-in. Responses appear here with interactive charts and tables when useful.' : 'Open Chista desktop to connect your agent. You can import and review files locally in this browser.'}</p></div>}{messages.map((m,i)=><article className={'message '+m.role} key={i}><strong>{m.role==='user'?'You':'Chista'}</strong>{m.role==='assistant'?<AgentResponse content={m.content} onFollow={text=>{setPrompt(text);composer.current?.focus();}}/>:<p>{m.content}</p>}</article>)}{busy && stream && <article className="message assistant"><strong>{agentLabel}</strong><p style={{whiteSpace:"pre-wrap"}}>{stream}</p></article>}{busy && <p className="thinking" role="status">{authStatus || (stream?'Streaming response…':'Waiting for agent…')}</p>}</div>
    {servers.some(s=>connections[s.id]?.status==='connected') && <details className="tool-console"><summary>MCP tools · approval required for every invocation</summary><p className="muted">Tool results stay in this session and are never automatically forwarded to a model. No artifact is attached to tool arguments.</p><div className="form-grid"><label className="field">Server<select value={server} onChange={e => {setServer(e.target.value);setTool('');setPending(null);}}><option value="">Select connected server</option>{servers.filter(s => connections[s.id]?.status === 'connected').map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label><label className="field">Tool<select value={tool} onChange={e => {setTool(e.target.value);setPending(null);}}><option value="">Select tool</option>{available.map(t => <option key={t.name}>{t.name}</option>)}</select></label></div>{tool && <details><summary>Input schema</summary><pre>{JSON.stringify(available.find(t => t.name === tool)?.inputSchema,null,2)}</pre></details>}<label className="field">Arguments (JSON)<textarea value={args} onChange={e => {setArgs(e.target.value);setPending(null);}}/></label><button disabled={!tool || busy} onClick={reviewTool}>Review tool invocation</button>{toolResults.map((r,i) => <pre key={i}>{r}</pre>)}</details>}
    <form className="chat-composer" onSubmit={e=>{e.preventDefault();if(canSend)sendMessage();}}>{scrollPaused && <button type="button" className="jump-to-latest" onClick={jumpToLatest}>↓ Jump to latest</button>}{Boolean(attachments?.files.length) && <div className="chat-attachments">{attachments!.files.map(file=><div className="chat-attachment" key={file.id}><button type="button" className="attachment-preview" onClick={()=>setShowAttachments(value=>!value)} title="Preview sanitized attachments"><strong>{file.name}</strong><small>{file.redactions} redactions · ready</small></button><button type="button" disabled={busy || attachments?.busy} aria-label={`Remove attachment ${file.name}`} onClick={()=>onRemoveAttachment?.(file.id)}><X size={14}/></button></div>)}</div>}{attachments?.busy && <p className="muted" role="status">Sanitizing attachments locally…</p>}{attachments?.error && <p className="error" role="alert">{attachments.error}</p>}{showAttachments && attachments?.context && <div className="attachment-details"><div className="action-row"><strong>Sanitized attachments</strong><button type="button" onClick={onFiles}>Mappings &amp; redactions</button><button type="button" aria-label="Close attachment preview" onClick={()=>setShowAttachments(false)}><X size={14}/></button></div><p className="muted">Only this compacted content is sent. Original filenames and mappings stay local.</p><pre>{attachments.context}</pre></div>}<textarea ref={composer} aria-label="Message agent" value={prompt} disabled={busy} onChange={e=>{setPrompt(e.target.value);setPending(null);}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(canSend)sendMessage();}}} placeholder="Message Chista…"/><div className="composer-actions"><div className="composer-options">{onAgentChange && <select aria-label="Chat agent" value={mode} onChange={e=>onAgentChange(e.target.value)}><option value="claude">Claude Code</option><option value="codex">Codex</option>{hosted.endpoint && <option value="hosted">{hosted.model || 'Hosted provider'}</option>}</select>}<button type="button" disabled={busy || attachments?.busy} onClick={onAddFiles}>+ Add files</button><label className="review-toggle"><input type="checkbox" checked={reviewBeforeSending} disabled={busy} onChange={e=>{setReviewBeforeSending(e.target.checked);setPending(null);}}/>Review before sending</label></div>{busy?<button type="button" onClick={()=>abort.current?.abort()}>Stop</button>:<button type="submit" className="primary" disabled={!canSend}>Send <ArrowRight size={15}/></button>}</div></form>
    {notice && <div role="status" className="notice">{notice}</div>}{pending && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="Approve outgoing request"><div className="section-heading"><h2>{pending.kind === 'tool' ? 'Approve this tool call' : 'Review outgoing message'}</h2><button aria-label="Deny and close" onClick={() => setPending(null)}><X size={16}/></button></div><p>{pending.kind === 'tool' ? `Destination: ${pending.destination}. This tool may have side effects. Approval applies only to these arguments, once.` : pending.mode !== 'hosted' ? `Destination: ${pending.mode === 'codex' ? 'Codex' : 'Claude Code'} CLI → cloud provider. Only this reviewed conversation is sent; local mappings and repository files are excluded.` : `Destination: ${pending.config.endpoint} · model: ${pending.config.model}`}</p>{pending.kind==='model' && pending.turn?.systemPrompt===null && <p>Continuing this session: only the new message is sent. The agent retains the earlier conversation and instructions.</p>}<pre>{pending.kind === 'model' && pending.mode !== 'hosted' ? (pending.turn ? nativeTurnPreview(pending.turn) : claudePayload(pending.request)) : JSON.stringify(pending.kind === 'model' && pending.mode === 'hosted' ? hostedBody(pending.config.model,pending.request) : pending.request,null,2)}</pre><p>Pattern detection may miss sensitive values. Deny to edit anything you do not want to share.</p><div className="modal-actions"><button onClick={() => setPending(null)}>Deny / edit</button><button autoFocus className="primary" onClick={() => {if(pending) void execute(pending);}}>Approve {pending.kind === 'tool' ? 'tool call once' : 'and send'}</button></div></section></div>}</section>;
}
