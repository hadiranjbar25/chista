import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { ArrowRight, Terminal, ShieldCheck, X } from 'lucide-react';
import { claudeProvider, claudePayload, streamingProse } from './integrations/claude';
import { buildDemoReply, demoQuestion } from './demo';
import AgentResponse, { parseReply } from './AgentResponse';
import { Sanitizer } from './safety';
import { demoProvider, hostedProvider, hostedBody, prepareRequest, type HostedConfig, type Message, type ModelRequest } from './integrations/providers';
import { McpConnections, type ConnectionState, type ServerConfig, type ToolRequest } from './integrations/mcp';
import type { Repository, Session } from './workspace';
type Pending = { kind: 'model'; request: ModelRequest; config: HostedConfig; mode: string; executablePath: string } | { kind: 'tool'; request: ToolRequest; destination: string };
export default function AgentChat({active=true,repositories,session,context,mode,hosted,claudePath,servers,connections,mcp,onModelStatus,onFiles,onSettings,onRunDemo}: {
  active?: boolean; repositories: Repository[]; session: Session; context: string|null; mode: string; hosted: HostedConfig; claudePath: string;
  onRunDemo: () => void; onFiles: () => void; onSettings: () => void;
  onModelStatus: (key: string, status: string) => void;
  servers: ServerConfig[]; connections: Record<string,ConnectionState>; mcp: McpConnections;
}) {
  const [launchRepoId,setLaunchRepoId] = useState('');
  const launchRepo = repositories.find(r => r.id===launchRepoId) ?? repositories[0];
  const repoSignature = JSON.stringify(repositories.map(r => [r.id,r.name,r.path]));
  const [messages,setMessages] = useState<Message[]>(()=>session.demo ? [{role:'user',content:demoQuestion},{role:'assistant',content:buildDemoReply(demoQuestion,context)}] : []); const [prompt,setPrompt] = useState('');
  const [stream,setStream] = useState('');
  const [pending,setPending] = useState<Pending|null>(null); const [busy,setBusy] = useState(false); const [notice,setNotice] = useState('');
  const [server,setServer] = useState(''); const [tool,setTool] = useState(''); const [args,setArgs] = useState('{}');
  const [toolResults,setToolResults] = useState<string[]>([]); const sanitizer = useRef(new Sanitizer('CHAT'));
  const composer=useRef<HTMLTextAreaElement>(null); const bottom=useRef<HTMLDivElement>(null);
  useEffect(()=>{bottom.current?.scrollIntoView?.({block:'end',behavior:'smooth'});},[messages,busy,stream]);
  const abort = useRef<AbortController|null>(null); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current=false;abort.current?.abort(); }; }, []);
  useEffect(() => { setPending(null); }, [context, mode, claudePath, hosted.endpoint, hosted.model, hosted.token, connections, repoSignature, launchRepo?.id]);
  useEffect(() => { if (!active) { abort.current?.abort();setPending(null); } }, [active]);
  useEffect(() => () => abort.current?.abort(), [mode,claudePath]);
  async function launch() {
    setBusy(true);setNotice('');
    try { if (!isTauri()) throw new Error('Open the Tauri desktop app to launch Claude Code.');
      if (!launchRepo?.path) throw new Error('Include a repository in this session before launching Claude Code.');
      const result = await invoke<string>('launch_claude',{repoPath:launchRepo.path,executablePath:claudePath});setNotice(result);
    } catch(e) {setNotice(String(e));} finally {setBusy(false);}
  }
  function reviewMessage() {
    try {
      if (mode === 'hosted') hostedProvider(hosted);
      if (mode === 'claude') claudeProvider(claudePath);
      const request: Pending={kind:'model',request:prepareRequest(messages,prompt,context,sanitizer.current),config:{...hosted},mode,executablePath:claudePath};
      if(mode==='demo') void execute(request); else setPending(request);
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
        const provider = snapshot.mode === 'hosted' ? hostedProvider(snapshot.config) : snapshot.mode === 'claude' ? claudeProvider(snapshot.executablePath) : demoProvider;
        abort.current = new AbortController(); const timer = setTimeout(() => abort.current?.abort(),125_000);
        try {
          if (snapshot.mode === 'hosted') onModelStatus(JSON.stringify([snapshot.config.endpoint,snapshot.config.model]),'Connecting…');
          setMessages(snapshot.request.messages);
          const reply = await provider.complete(snapshot.request,abort.current.signal, text => { if(mounted.current) setStream(sanitizer.current.text(streamingProse(text))); });
          if (snapshot.mode === 'hosted') onModelStatus(JSON.stringify([snapshot.config.endpoint,snapshot.config.model]),'Connected · last request succeeded');
          if (mounted.current) {setMessages([...snapshot.request.messages,{role:'assistant',content:sanitizer.current.sanitize(JSON.stringify(parseReply(reply)),'json',[])}]);setPrompt('');}
        } finally { clearTimeout(timer); }
      } else {
        mcp.approvals.approve(snapshot.request);
        const result = await mcp.call(snapshot.request);
        if (mounted.current) setToolResults(r => [...r,`${snapshot.request.tool}\n${sanitizer.current.text(JSON.stringify(result,null,2))}`]);
      }
    } catch (error) { if (snapshot.kind === 'model' && snapshot.mode === 'hosted') onModelStatus(JSON.stringify([snapshot.config.endpoint,snapshot.config.model]),'Error · last request failed or cancelled'); if (mounted.current) setNotice(snapshot.kind === 'model' && snapshot.mode === 'claude' ? `${String(error)} No automatic retry was made.` : 'Request failed or was cancelled. Check integration status and permissions. No automatic retry was made.'); }
    finally { if (mounted.current) { setBusy(false);setStream(''); } }
  }
  const available = connections[server]?.status === 'connected' ? connections[server].tools : [];
  return <section className="chat-view"><div className="chat-status"><span className="pill">{mode==='demo'?(session.demo?'Sample incident · demo analysis':'Demo · no AI connected'):mode==='claude'?'Claude Code · CLI chat':hosted.model}</span>{context && <button className="context-chip" onClick={onFiles}><ShieldCheck size={14}/>{context.length.toLocaleString()} characters of reviewed context attached</button>}</div>
    {mode==='claude' && <details className="terminal-options"><summary>Claude Code · sign-in &amp; terminal</summary><p>Chat below to stream Claude’s answers and generate interactive results. Sign in through Claude’s native terminal flow if needed.</p><label className="field">Launch repository<select value={launchRepo?.id??''} onChange={e=>setLaunchRepoId(e.target.value)} disabled={!repositories.length}>{!repositories.length && <option value="">No included repositories</option>}{repositories.map(repo=><option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label><div className="action-row"><button disabled={busy || !launchRepo?.path} onClick={()=>void launch()}>Launch Claude Code <Terminal size={15}/></button><button onClick={onSettings}>Choose chat provider</button></div><p className="muted">In-app chat sends only your approved message and sanitized context, with repository access and tools disabled. The separate terminal uses Claude’s native repository permissions.</p>{context && <details><summary>Sanitized context for Claude Code</summary><button onClick={async()=>{try{await navigator.clipboard.writeText(context);setNotice('Sanitized context copied. The local mapping was not copied.');}catch{setNotice('Clipboard unavailable. Select the sanitized text below to copy.');}}}>Copy sanitized context for Claude</button><pre>{context}</pre></details>}</details>}
    <div className="messages" role="log" aria-live="polite" aria-label="Conversation">{!messages.length && <div className="chat-welcome"><span className="welcome-mark">✳</span><h1>Find out why checkout failed.</h1><p>Try a complete debugging session. No setup, API key or uploads needed.</p><div className="demo-incident"><div className="eyebrow">SAMPLE INCIDENT · FICTIONAL DATA</div><h2>Checkout errors spiked at 09:42</h2><p>A payment request timed out. You have application logs, request data and service configuration. Find the likely failure path and what to investigate next.</p><div className="demo-artifacts"><span>▤ Application log</span><span>▦ Requests CSV</span><span>⌘ Service config</span></div><div className="action-row"><button className="primary" disabled={busy} onClick={onRunDemo}>Debug this issue <ArrowRight size={16}/></button><span className="muted">Local simulation · real interactive results</span></div></div><div className="suggestions"><button onClick={()=>{setPrompt('Help me investigate a failing request');composer.current?.focus();}}>Start my own investigation</button><button onClick={onFiles}>Add my debug files</button></div></div>}{messages.map((m,i)=><article className={'message '+m.role} key={i}><strong>{m.role==='user'?'You':'Chista'}</strong>{m.role==='assistant'?<AgentResponse content={m.content} onFollow={text=>{setPrompt(text);composer.current?.focus();}}/>:<p>{m.content}</p>}</article>)}{busy && stream && <article className="message assistant"><strong>Claude</strong><p style={{whiteSpace:"pre-wrap"}}>{stream}</p></article>}{busy && <p className="thinking" role="status">Working…</p>}<div ref={bottom}/></div>
    {servers.some(s=>connections[s.id]?.status==='connected') && <details className="tool-console"><summary>MCP tools · approval required for every invocation</summary><p className="muted">Tool results stay in this session and are never automatically forwarded to a model. No artifact is attached to tool arguments.</p><div className="form-grid"><label className="field">Server<select value={server} onChange={e => {setServer(e.target.value);setTool('');setPending(null);}}><option value="">Select connected server</option>{servers.filter(s => connections[s.id]?.status === 'connected').map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label><label className="field">Tool<select value={tool} onChange={e => {setTool(e.target.value);setPending(null);}}><option value="">Select tool</option>{available.map(t => <option key={t.name}>{t.name}</option>)}</select></label></div>{tool && <details><summary>Input schema</summary><pre>{JSON.stringify(available.find(t => t.name === tool)?.inputSchema,null,2)}</pre></details>}<label className="field">Arguments (JSON)<textarea value={args} onChange={e => {setArgs(e.target.value);setPending(null);}}/></label><button disabled={!tool || busy} onClick={reviewTool}>Review tool invocation</button>{toolResults.map((r,i) => <pre key={i}>{r}</pre>)}</details>}
    <form className="chat-composer" onSubmit={e=>{e.preventDefault();if(prompt.trim()&&!busy)reviewMessage();}}><textarea ref={composer} aria-label="Message agent" value={prompt} disabled={busy} onChange={e=>{setPrompt(e.target.value);setPending(null);}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(prompt.trim()&&!busy)reviewMessage();}}} placeholder="Message Chista…"/><div className="composer-actions"><button type="button" onClick={onFiles}>+ Add files</button><span className="muted">{mode==='demo'?'Demo mode':'Outgoing requests are reviewed before sending'}</span>{busy?<button type="button" onClick={()=>abort.current?.abort()}>Stop</button>:<button type="submit" className="primary" disabled={!prompt.trim()}>Send <ArrowRight size={15}/></button>}</div></form>
    {notice && <div role="status" className="notice">{notice}</div>}{pending && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="Approve outgoing request"><div className="section-heading"><h2>{pending.kind === 'tool' ? 'Approve this tool call' : 'Review outgoing message'}</h2><button aria-label="Deny and close" onClick={() => setPending(null)}><X size={16}/></button></div><p>{pending.kind === 'tool' ? `Destination: ${pending.destination}. This tool may have side effects. Approval applies only to these arguments, once.` : pending.mode === 'demo' ? 'Demo only — nothing leaves this device.' : pending.mode === 'claude' ? 'Destination: Claude Code CLI → its configured cloud provider. Only this reviewed conversation is sent; local mappings and repository files are excluded.' : `Destination: ${pending.config.endpoint} · model: ${pending.config.model}`}</p><pre>{pending.kind === 'model' && pending.mode === 'claude' ? claudePayload(pending.request) : JSON.stringify(pending.kind === 'model' && pending.mode === 'hosted' ? hostedBody(pending.config.model,pending.request) : pending.request,null,2)}</pre><p>Pattern detection may miss sensitive values. Deny to edit anything you do not want to share.</p><div className="modal-actions"><button onClick={() => setPending(null)}>Deny / edit</button><button autoFocus className="primary" onClick={() => {if(pending) void execute(pending);}}>Approve {pending.kind === 'tool' ? 'tool call once' : pending.mode === 'demo' ? 'demo response' : 'and send'}</button></div></section></div>}</section>;
}
