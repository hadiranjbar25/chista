import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { ArrowRight, Terminal, ShieldCheck, X } from 'lucide-react';
import { Sanitizer } from './safety';
import { demoProvider, hostedProvider, hostedBody, prepareRequest, type HostedConfig, type Message, type ModelRequest } from './integrations/providers';
import { McpConnections, type ConnectionState, type ServerConfig, type ToolRequest } from './integrations/mcp';
import type { Project, Session } from './workspace';
type Pending = { kind: 'model'; request: ModelRequest; config: HostedConfig; mode: string } | { kind: 'tool'; request: ToolRequest; destination: string };
export default function AgentChat({project,session,context,mode,hosted,claudePath,servers,connections,mcp,onModelStatus}: {
  project: Project; session: Session; context: string|null; mode: string; hosted: HostedConfig; claudePath: string;
  onModelStatus: (key: string, status: string) => void;
  servers: ServerConfig[]; connections: Record<string,ConnectionState>; mcp: McpConnections;
}) {
  const [messages,setMessages] = useState<Message[]>([]); const [prompt,setPrompt] = useState('');
  const [pending,setPending] = useState<Pending|null>(null); const [busy,setBusy] = useState(false); const [notice,setNotice] = useState('');
  const [server,setServer] = useState(''); const [tool,setTool] = useState(''); const [args,setArgs] = useState('{}');
  const [toolResults,setToolResults] = useState<string[]>([]); const sanitizer = useRef(new Sanitizer('CHAT'));
  const abort = useRef<AbortController|null>(null); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current=false;abort.current?.abort(); }; }, []);
  useEffect(() => { setPending(null); }, [context, mode, hosted.endpoint, hosted.model, hosted.token, connections, project.path]);
  async function launch() {
    setBusy(true);setNotice('');
    try { if (!isTauri()) throw new Error('Open the Tauri desktop app to launch Claude Code.');
      const result = await invoke<string>('launch_claude',{projectPath:project.path,executablePath:claudePath});setNotice(result);
    } catch(e) {setNotice(String(e));} finally {setBusy(false);}
  }
  function reviewMessage() {
    try {
      if (mode === 'hosted') hostedProvider(hosted);
      setPending({kind:'model',request:prepareRequest(messages,prompt,context,sanitizer.current),config:{...hosted},mode});
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
  async function approve() {
    if (!pending || busy) return;
    const snapshot=pending;setPending(null);setBusy(true);setNotice('');
    try {
      if (snapshot.kind === 'model') {
        const provider = snapshot.mode === 'hosted' ? hostedProvider(snapshot.config) : demoProvider;
        abort.current = new AbortController(); const timer = setTimeout(() => abort.current?.abort(),60_000);
        try {
          if (snapshot.mode === 'hosted') onModelStatus(JSON.stringify([snapshot.config.endpoint,snapshot.config.model]),'Connecting…');
          const reply = await provider.complete(snapshot.request,abort.current.signal);
          if (snapshot.mode === 'hosted') onModelStatus(JSON.stringify([snapshot.config.endpoint,snapshot.config.model]),'Connected · last request succeeded');
          if (mounted.current) {setMessages([...snapshot.request.messages,{role:'assistant',content:sanitizer.current.text(reply)}]);setPrompt('');}
        } finally { clearTimeout(timer); }
      } else {
        mcp.approvals.approve(snapshot.request);
        const result = await mcp.call(snapshot.request);
        if (mounted.current) setToolResults(r => [...r,`${snapshot.request.tool}\n${sanitizer.current.text(JSON.stringify(result,null,2))}`]);
      }
    } catch { if (snapshot.kind === 'model' && snapshot.mode === 'hosted') onModelStatus(JSON.stringify([snapshot.config.endpoint,snapshot.config.model]),'Error · last request failed or cancelled'); if (mounted.current) setNotice('Request failed or was cancelled. Check integration status and permissions. No automatic retry was made.'); }
    finally { if (mounted.current) setBusy(false); }
  }
  const available = connections[server]?.status === 'connected' ? connections[server].tools : [];
  return <section className="chat-view"><div className="section-heading"><div><h2>Agent · {session.name}</h2><p className="muted">{project.name} / {session.name} · history stays in this session</p></div><span className="pill">{mode === 'claude' ? 'Claude Code · external terminal' : mode === 'hosted' ? 'Hosted provider · manual send' : 'Demo mode · no model connected'}</span></div><div className="context-strip"><ShieldCheck size={17}/>{context ? `${context.length.toLocaleString()} characters of reviewed context attached` : 'No debug files attached. Review a sanitized snapshot in Safe Debug first.'}</div>
    {mode === 'claude' ? <div className="panel terminal-card"><Terminal size={28}/><h2>Continue with Claude Code</h2><p>Open its interactive terminal in <code>{project.path || 'a project directory (set in Projects)'}</code>. Claude handles sign-in, project trust and its own tool permissions. Chista does not collect Claude credentials.</p><p>Chista passes no debug files, chat or context to the terminal. Claude can access files already in the selected project using its native permissions; keep raw debug files outside that agent-accessible directory.</p><button className="primary" disabled={busy || !project.path} onClick={() => void launch()}>Launch Claude Code <Terminal size={15}/></button>{context && <details><summary>Sanitized context for Claude Code</summary><p>Copy this reviewed payload into the Claude terminal. Original values and the redaction mapping are not included.</p><button onClick={async () => {try {await navigator.clipboard.writeText(context);setNotice("Sanitized context copied. Paste it into Claude Code; the local mapping was not copied.");} catch {setNotice("Clipboard access is unavailable. Select and copy the sanitized preview below.");}}}>Copy sanitized context for Claude</button><pre>{context}</pre></details>}</div> : <><div className="messages">{!messages.length && <div className="empty"><h2>Investigate this session</h2><p>{mode === 'demo' ? 'Demo mode: responses are local workflow suggestions, not model output.' : 'Review every outgoing request before sending to your configured hosted service.'}</p></div>}{messages.map((m,i) => <article className={'message '+m.role} key={i}><strong>{m.role === 'user' ? 'You · sanitized' : mode === 'demo' ? 'Demo assistant' : 'Assistant'}</strong><p>{m.content}</p></article>)}</div><label className="field">Session message<textarea value={prompt} onChange={e => {setPrompt(e.target.value);setPending(null);}} placeholder="Ask about the reviewed evidence…"/></label><div className="action-row"><span className="muted">Prompt and history are sanitized; you review the exact payload.</span><button className="primary" disabled={!prompt.trim() || busy} onClick={reviewMessage}>Review request <ArrowRight size={15}/></button>{busy && <button onClick={() => abort.current?.abort()}>Cancel model request</button>}</div></>}
    <details className="tool-console"><summary>MCP tools · approval required for every invocation</summary><p className="muted">Tool results stay in this session and are never automatically forwarded to a model. No artifact is attached to tool arguments.</p><div className="form-grid"><label className="field">Server<select value={server} onChange={e => {setServer(e.target.value);setTool('');setPending(null);}}><option value="">Select connected server</option>{servers.filter(s => connections[s.id]?.status === 'connected').map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label><label className="field">Tool<select value={tool} onChange={e => {setTool(e.target.value);setPending(null);}}><option value="">Select tool</option>{available.map(t => <option key={t.name}>{t.name}</option>)}</select></label></div>{tool && <details><summary>Input schema</summary><pre>{JSON.stringify(available.find(t => t.name === tool)?.inputSchema,null,2)}</pre></details>}<label className="field">Arguments (JSON)<textarea value={args} onChange={e => {setArgs(e.target.value);setPending(null);}}/></label><button disabled={!tool || busy} onClick={reviewTool}>Review tool invocation</button>{toolResults.map((r,i) => <pre key={i}>{r}</pre>)}</details>
    {notice && <div role="status" className="notice">{notice}</div>}{pending && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="Approve outgoing request"><div className="section-heading"><h2>{pending.kind === 'tool' ? 'Approve this tool call' : 'Review outgoing message'}</h2><button aria-label="Deny and close" onClick={() => setPending(null)}><X size={16}/></button></div><p>{pending.kind === 'tool' ? `Destination: ${pending.destination}. This tool may have side effects. Approval applies only to these arguments, once.` : pending.mode === 'demo' ? 'Demo only — nothing leaves this device.' : `Destination: ${pending.config.endpoint} · model: ${pending.config.model}`}</p><pre>{JSON.stringify(pending.kind === 'model' && pending.mode === 'hosted' ? hostedBody(pending.config.model,pending.request) : pending.request,null,2)}</pre><p>Pattern detection may miss sensitive values. Deny to edit anything you do not want to share.</p><div className="modal-actions"><button onClick={() => setPending(null)}>Deny / edit</button><button autoFocus className="primary" onClick={() => void approve()}>Approve {pending.kind === 'tool' ? 'tool call once' : pending.mode === 'demo' ? 'demo response' : 'and send'}</button></div></section></div>}</section>;
}
