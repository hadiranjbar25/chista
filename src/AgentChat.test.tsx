// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ invoke: vi.fn(), auth: vi.fn(), close: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (command: string, args: unknown) => command==='close_agent_session' ? (native.close(args),Promise.resolve()) : command.endsWith('_auth_status') ? native.auth(command,args) : native.invoke(command,args),
  Channel: class { onmessage: (event: unknown) => void = () => {}; },
}));
import AgentChat from './AgentChat';
beforeEach(() => { native.auth.mockResolvedValue(true); });
afterEach(() => { cleanup(); native.invoke.mockReset(); native.close.mockReset(); native.auth.mockReset(); native.auth.mockResolvedValue(true); });
const props = {
  repositories: [],
  context: 'Reviewed evidence: 2 timeouts', mode: 'claude', claudePath: '',
  hosted: { endpoint: '', model: '', token: '' },
  onModelStatus: vi.fn(), onFiles: vi.fn(), onAddFiles: vi.fn(),
};
it.each(['claude','codex'])('%s requires approval and renders generated OpenUI', async agent => {
  let finish!: (text: string) => void;
  native.invoke.mockImplementation((command, args) => {
    expect(command).toBe('agent_session_chat');
    expect(args.agent).toBe(agent);
    args.onEvent.onmessage({ type: 'started' });
    args.onEvent.onmessage({ type: 'delta', text: '{"text":"Two timeouts found' });
    return new Promise(resolve => { finish = resolve; });
  });
  const user = userEvent.setup(); render(<AgentChat {...props} mode={agent}/>);
  await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'Investigate alex@example.com{Enter}');
  const review = screen.getByRole('dialog');
  expect(review.textContent).toContain('Reviewed evidence: 2 timeouts');
  expect(review.textContent).not.toContain('alex@example.com');
  expect(native.invoke).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Approve and send' }));
  expect(await screen.findByText('Two timeouts found')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
  await act(async () => finish(JSON.stringify({ text: 'Two timeouts found', blocks: [
    { type: 'chart', title: 'Observed errors', items: [{ label: 'Timeout', value: 2 }] },
    { type: 'followups', prompts: ['Inspect retries'] },
  ] })));
  expect(screen.getByRole('heading', { name: 'Observed errors' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: /Inspect retries/ }));
  expect((screen.getByRole('textbox', { name: 'Message agent' }) as HTMLTextAreaElement).value).toBe('Inspect retries');
});
it('cancels a native request when its session becomes inactive', async () => {
  let reject!: (error: Error) => void;
  native.invoke.mockImplementation((command, args) => {
    if (command === 'cancel_agent_chat') { reject(new Error('Request cancelled')); return Promise.resolve(); }
    args.onEvent.onmessage({ type: 'started' });
    return new Promise((_resolve, fail) => { reject = fail; });
  });
  const user = userEvent.setup(); const view = render(<AgentChat {...props} active/>);
  await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'Debug this{Enter}');
  await user.click(screen.getByRole('button', { name: 'Approve and send' }));
  await act(async () => view.rerender(<AgentChat {...props} active={false}/>));
  expect(native.invoke).toHaveBeenCalledWith('cancel_agent_chat', expect.objectContaining({ requestId: expect.any(String) }));
});

it('switching providers revokes pending approval without sending', async () => {
  const user=userEvent.setup(); const view=render(<AgentChat {...props}/>);
  await user.type(screen.getByRole('textbox',{name:'Message agent'}),'Check timeouts{Enter}');
  expect(screen.getByRole('dialog').textContent).toContain('Claude Code CLI');
  view.rerender(<AgentChat {...props} mode="codex" codexPath="/usr/local/bin/codex"/>);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(native.invoke).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button',{name:'Send'}));
  expect(screen.getByRole('dialog').textContent).toContain('Codex CLI');
});

it.each(['claude','codex'])('opens %s native sign-in and resumes the approved message once', async agent => {
  native.auth.mockResolvedValueOnce(false).mockResolvedValue(true);
  native.invoke.mockImplementation(async command => {
    if (command === `${agent}_sign_in`) return 'Sign in in Terminal';
    return '{"text":"Investigation complete","blocks":[]}';
  });
  const user=userEvent.setup();render(<AgentChat {...props} mode={agent}/>);
  expect(screen.queryByText(/sign-in & terminal/)).toBeNull();
  await user.type(screen.getByRole('textbox',{name:'Message agent'}),'Check this timeout{Enter}');
  expect(native.auth).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button',{name:'Approve and send'}));
  expect(await screen.findByText(/Your message will continue automatically/)).toBeTruthy();
  expect(native.invoke.mock.calls.map(c=>c[0])).toEqual([`${agent}_sign_in`]);
  expect(await screen.findByText('Investigation complete', {}, {timeout:4000})).toBeTruthy();
  expect(native.invoke.mock.calls.map(c=>c[0])).toEqual([`${agent}_sign_in`,'agent_session_chat']);
  expect(screen.getByRole('log').querySelectorAll('.message.user')).toHaveLength(1);
});
it('stopping sign-in preserves the draft and prevents a deferred send', async () => {
  native.auth.mockResolvedValue(false);
  native.invoke.mockResolvedValue('Sign in in Terminal');
  const user=userEvent.setup();render(<AgentChat {...props}/>);
  await user.type(screen.getByRole('textbox',{name:'Message agent'}),'Keep this draft{Enter}');
  await user.click(screen.getByRole('button',{name:'Approve and send'}));
  await user.click(screen.getByRole('button',{name:'Stop'}));
  expect((screen.getByRole('textbox',{name:'Message agent'}) as HTMLTextAreaElement).value).toBe('Keep this draft');
  expect(native.invoke.mock.calls.map(c=>c[0])).toEqual(['claude_sign_in']);
  expect(screen.getByRole('log').querySelectorAll('.message')).toHaveLength(0);
});

it('renders successive live chunks while the native request is still pending',async()=>{
  let emit!: (event:unknown)=>void;
  let finish!: (text:string)=>void;
  native.invoke.mockImplementation((_command,args)=>{emit=args.onEvent.onmessage;return new Promise(resolve=>{finish=resolve;});});
  const user=userEvent.setup();render(<AgentChat {...props}/>);
  await user.type(screen.getByRole('textbox',{name:'Message agent'}),'Debug timeout{Enter}');
  await user.click(screen.getByRole('button',{name:'Approve and send'}));
  await act(async()=>emit({type:'delta',text:'{"text":"First'}));
  expect(screen.getByText('First')).toBeTruthy();
  expect(screen.getByText('Streaming response…')).toBeTruthy();
  await act(async()=>emit({type:'delta',text:' second'}));
  expect(screen.getByText('First second')).toBeTruthy();
  expect(screen.getByRole('button',{name:'Stop'})).toBeTruthy();
  await act(async()=>finish('{"text":"First second","blocks":[]}'));
  expect(screen.queryByRole('button',{name:'Stop'})).toBeNull();
  expect(screen.getAllByText('First second')).toHaveLength(1);
});

it.each(['claude','codex'])('%s can skip the preview while still sanitizing, then enable review again', async agent => {
  native.invoke.mockResolvedValue('{"text":"Done","blocks":[]}');
  const user=userEvent.setup();render(<AgentChat {...props} mode={agent}/>);
  const toggle=screen.getByRole('checkbox',{name:'Review before sending'});
  expect((toggle as HTMLInputElement).checked).toBe(true);
  await user.click(toggle);
  await user.type(screen.getByRole('textbox',{name:'Message agent'}),'Investigate alex@example.com{Enter}');
  expect(await screen.findByText('Done')).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(native.invoke).toHaveBeenCalledTimes(1);
  const [command,args]=native.invoke.mock.calls[0];
  expect(command).toBe('agent_session_chat');
    expect(args.agent).toBe(agent);
  expect(args.payload).not.toContain('alex@example.com');
  expect(args.payload).toContain('[CHAT_EMAIL_1]');
  expect(args.payload).toContain('Reviewed evidence: 2 timeouts');
  await user.click(toggle);
  await user.type(screen.getByRole('textbox',{name:'Message agent'}),'Check again{Enter}');
  expect(screen.getByRole('dialog',{name:'Approve outgoing request'})).toBeTruthy();
  expect(native.invoke).toHaveBeenCalledTimes(1);
});

it('takes a sanitized session title from the first agent response only', async () => {
  const onSessionTitle=vi.fn();
  native.invoke.mockResolvedValueOnce('{"text":"First answer","blocks":[],"sessionTitle":"Timeout for alex@example.com"}')
    .mockResolvedValueOnce('{"text":"Next answer","blocks":[],"sessionTitle":"Different title"}');
  const user=userEvent.setup();render(<AgentChat {...props} onSessionTitle={onSessionTitle}/>);
  await user.click(screen.getByRole('checkbox',{name:'Review before sending'}));
  await user.type(screen.getByRole('textbox',{name:'Message agent'}),'Debug timeout{Enter}');
  await screen.findByText('First answer');
  expect(onSessionTitle).toHaveBeenCalledWith('Timeout for [CHAT_EMAIL_1]');
  await user.type(screen.getByRole('textbox',{name:'Message agent'}),'Continue{Enter}');
  await screen.findByText('Next answer');
  expect(onSessionTitle).toHaveBeenCalledTimes(1);
});

it('sends attachment-only messages with sanitized context and no filename metadata', async () => {
  native.invoke.mockResolvedValue('{"text":"Checked attachment","blocks":[]}');
  const context='{"artifacts":[{"id":"artifact-1","excerpt":"[EMAIL_1] timeout"}]}';
  const attachments={files:[{id:'local-file',name:'alex@example.com.log',redactions:1}],context,busy:false,error:''};
  const user=userEvent.setup();const view=render(<AgentChat {...props} context={context} attachments={{...attachments,busy:true}}/>);
  expect((screen.getByRole('button',{name:'Send'}) as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<AgentChat {...props} context={context} attachments={attachments}/>);
  await user.click(screen.getByRole('checkbox',{name:'Review before sending'}));
  await user.click(screen.getByRole('button',{name:'Send'}));
  expect(await screen.findByText('Checked attachment')).toBeTruthy();
  expect(native.invoke.mock.calls[0][1].payload).toContain('[EMAIL_1] timeout');
  expect(native.invoke.mock.calls[0][1].payload).not.toContain('alex@example.com.log');
  expect(native.invoke.mock.calls[0][1].payload).not.toContain('local-file');
});

it('renders an agent-generated OpenUI text box and prepares a follow-up without auto-sending', async () => {
  native.invoke.mockResolvedValue(JSON.stringify({text:'Describe what happened.',blocks:[{type:'input',title:'Debug details',placeholder:'Paste a short description',submitLabel:'Use details'}]}));
  const user=userEvent.setup();render(<AgentChat {...props}/>);
  await user.click(screen.getByRole('checkbox',{name:'Review before sending'}));
  await user.type(screen.getByRole('textbox',{name:'Message agent'}),'Show me a text box{Enter}');
  const field=await screen.findByRole('textbox',{name:'Debug details'});
  expect((screen.getByRole('button',{name:'Use details'}) as HTMLButtonElement).disabled).toBe(true);
  await user.type(field,'Timeout for alex@example.com');
  await user.click(screen.getByRole('button',{name:'Use details'}));
  expect((screen.getByRole('textbox',{name:'Message agent'}) as HTMLTextAreaElement).value).toBe('Timeout for alex@example.com');
  expect(native.invoke).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button',{name:'Send'}));
  expect(native.invoke.mock.calls[1][1].payload).not.toContain('alex@example.com');
  expect(native.invoke.mock.calls[1][1].payload).toContain('[CHAT_EMAIL_1]');
});

it('renders an OpenUI date picker with bounds and prepares the selected date without sending', async () => {
  native.invoke.mockResolvedValue(JSON.stringify({text:'Choose the incident date.',blocks:[{type:'date',title:'Incident date',min:'2026-10-01',max:'2026-10-31'}]}));
  const user=userEvent.setup();render(<AgentChat {...props}/>);
  await user.click(screen.getByRole('checkbox',{name:'Review before sending'}));
  await user.type(screen.getByRole('textbox',{name:'Message agent'}),'Show a date picker{Enter}');
  const date=await screen.findByLabelText('Incident date');
  const useDate=screen.getByRole('button',{name:'Use date'}) as HTMLButtonElement;
  expect(useDate.disabled).toBe(true);
  fireEvent.change(date,{target:{value:'2026-11-01'}});
  expect(useDate.disabled).toBe(true);
  fireEvent.change(date,{target:{value:'2026-10-24'}});
  expect(useDate.disabled).toBe(false);
  await user.click(useDate);
  expect((screen.getByRole('textbox',{name:'Message agent'}) as HTMLTextAreaElement).value).toBe('Incident date: 2026-10-24');
  expect(native.invoke).toHaveBeenCalledTimes(1);
});

it.each(['claude','codex'])('%s keeps an idle session for follow-ups and resets on context changes', async agent=>{
  native.invoke.mockResolvedValue('{"text":"Answer","blocks":[]}');
  const user=userEvent.setup();const view=render(<AgentChat {...props} mode={agent}/>);
  await user.click(screen.getByRole('checkbox',{name:'Review before sending'}));
  await user.type(screen.getByRole('textbox',{name:'Message agent'}),'First question{Enter}');
  await screen.findByText('Answer');
  const first=native.invoke.mock.calls[0][1];
  expect(first.systemPrompt).toContain('You are Chista');
  view.rerender(<AgentChat {...props} mode={agent} active={false}/>);
  view.rerender(<AgentChat {...props} mode={agent}/>);
  await user.type(screen.getByRole('textbox',{name:'Message agent'}),'Follow up{Enter}');
  expect(native.invoke.mock.calls[1][1]).toEqual(expect.objectContaining({sessionKey:first.sessionKey,systemPrompt:null}));
  expect(JSON.parse(native.invoke.mock.calls[1][1].payload)).toEqual({messages:[{role:'user',content:'Follow up'}]});
  view.rerender(<AgentChat {...props} mode={agent} context="Changed evidence"/>);
  expect(native.close).toHaveBeenCalledWith({sessionKey:first.sessionKey});
  await user.type(screen.getByRole('textbox',{name:'Message agent'}),'With new evidence{Enter}');
  const next=native.invoke.mock.calls[2][1];
  expect(next.sessionKey).not.toBe(first.sessionKey);expect(next.systemPrompt).toContain('You are Chista');
  expect(next.payload).toContain('Changed evidence');
});

it('reviews sanitized MCP arguments and returns only sanitized tool data to Codex',async()=>{
  let event!: (event:unknown)=>void;
  let finish!: (text:string)=>void;
  native.invoke.mockImplementation((command,args)=>{
    if(command==='respond_agent_tool')return Promise.resolve();
    expect(command).toBe('agent_session_chat');
    event=args.onEvent.onmessage;
    args.onEvent.onmessage({type:'started'});
    return new Promise(resolve=>{finish=resolve;});
  });
  const user=userEvent.setup();render(<AgentChat {...props} mode="codex"/>);
  await user.type(screen.getByRole('textbox',{name:'Message agent'}),'Search MCP{Enter}');
  await user.click(screen.getByRole('button',{name:'Approve and send'}));
  await act(async()=>event({type:'tool_approval',id:'approve-one',server:'rag-e-khab',tool:'search',arguments:{query:'alex@example.com'}}));
  const dialog=screen.getByRole('dialog',{name:'Approve MCP tool'});
  expect(dialog.textContent).not.toContain('alex@example.com');
  expect(dialog.textContent).toContain('[CHAT_EMAIL_1]');
  await user.click(screen.getByRole('button',{name:'Approve tool once'}));
  expect(native.invoke).toHaveBeenCalledWith('respond_agent_tool',expect.objectContaining({id:'approve-one',response:{approved:true,arguments:{query:'[CHAT_EMAIL_1]'}}}));
  await act(async()=>event({type:'tool_result',id:'result-one',result:{content:[{type:'text',text:'alex@example.com'}]}}));
  const reply=native.invoke.mock.calls.find(([command,args])=>command==='respond_agent_tool'&&args.id==='result-one')![1];
  expect(reply.response.content).not.toContain('alex@example.com');
  expect(reply.response.content).toContain('[CHAT_EMAIL_1]');
  await act(async()=>finish('{"text":"Lookup complete","blocks":[]}'));
  expect(screen.getByText('Lookup complete')).toBeTruthy();
});

it('offers native Codex MCP sign-in for unauthenticated servers',async()=>{
  native.invoke.mockImplementation(async(command,args)=>{
    if(command==='codex_mcp_sign_in')return 'Complete sign-in in Terminal, then return to Chista.';
    args.onEvent.onmessage({type:'started'});
    args.onEvent.onmessage({type:'mcp_status',servers:[{name:'rag-e-khab',authStatus:'notLoggedIn',available:true,failed:false}]});
    return '{"text":"Server needs sign-in.","blocks":[]}';
  });
  const user=userEvent.setup();render(<AgentChat {...props} mode="codex"/>);
  await user.type(screen.getByRole('textbox',{name:'Message agent'}),'Connect MCP{Enter}');
  await user.click(screen.getByRole('button',{name:'Approve and send'}));
  await user.click(await screen.findByRole('button',{name:'Sign in'}));
  expect(native.invoke).toHaveBeenCalledWith('codex_mcp_sign_in',{executablePath:'',server:'rag-e-khab'});
  expect(screen.getByRole('status').textContent).toContain('Complete sign-in in Terminal');
});

it('shows complete OpenUI blocks during streaming without enabling follow-up controls early',async()=>{
  let event!:(value:unknown)=>void,finish!:(value:string)=>void;
  native.invoke.mockImplementation((_command,args)=>{event=args.onEvent.onmessage;event({type:'started'});return new Promise(resolve=>{finish=resolve;});});
  const user=userEvent.setup();render(<AgentChat {...props} mode="codex"/>);
  await user.click(screen.getByRole('checkbox',{name:'Review before sending'}));
  await user.type(screen.getByRole('textbox',{name:'Message agent'}),'Show observed errors{Enter}');
  const chart={type:'chart',title:'Live response counts',items:[{label:'Denied',value:14}]};
  await act(async()=>event({type:'delta',text:`{"text":"Observed denials.","blocks":[${JSON.stringify(chart)},{"type":"date","title":"Last access"`}));
  expect(await screen.findByRole('heading',{name:'Live response counts'})).toBeTruthy();
  expect((screen.getByRole('button',{name:'Denied 14'}) as HTMLButtonElement).closest('fieldset')!.disabled).toBe(true);
  expect(screen.queryByLabelText('Last access')).toBeNull();
  await act(async()=>finish(JSON.stringify({text:'Observed denials.',blocks:[chart,{type:'date',title:'Last access'}]})));
  expect(screen.getByLabelText('Last access')).toBeTruthy();
  expect(screen.queryByRole('group',{name:'Generating interactive response'})).toBeNull();
});

it('keeps tool evidence, states and cited artifacts attached to their original turn',async()=>{
  let event!:(value:unknown)=>void,finish!:(value:string)=>void;
  native.invoke.mockImplementation((command,args)=>{
    if(command==='respond_agent_tool')return Promise.resolve();
    event=args.onEvent.onmessage;event({type:'started'});return new Promise(resolve=>{finish=resolve;});
  });
  const context=JSON.stringify({mode:'sanitized-context',artifacts:[{artifact:'artifact-1.log',content:'original sanitized evidence',omittedCharacters:0}]});
  const user=userEvent.setup();const view=render(<AgentChat {...props} context={context} mode="codex"/>);
  await user.click(screen.getByRole('checkbox',{name:'Review before sending'}));
  await user.type(screen.getByRole('textbox',{name:'Message agent'}),'Check access{Enter}');
  await act(async()=>event({type:'tool_approval',id:'call:approve',callId:'call',server:'audit',tool:'access_events',arguments:{date:'2026-10-22'}}));
  expect(screen.getByText('Awaiting approval')).toBeTruthy();
  await user.click(screen.getByRole('button',{name:'Approve tool once'}));
  await act(async()=>event({type:'tool_progress',callId:'call',server:'audit',tool:'access_events',state:'running'}));
  expect(screen.getByText('Running')).toBeTruthy();
  await act(async()=>event({type:'tool_result',id:'call:result',callId:'call',server:'audit',tool:'access_events',success:true,result:{content:[{type:'text',text:'alex@example.com status=403'}]}}));
  const receipt=JSON.parse(native.invoke.mock.calls.find(([command,args])=>command==='respond_agent_tool'&&args.id==='call:result')![1].response.content);
  expect(screen.getByText('Completed')).toBeTruthy();expect(screen.queryByText('alex@example.com status=403')).toBeNull();
  await act(async()=>finish(JSON.stringify({text:'Authorization denied.',sources:['artifact-1.log',receipt.sourceId,'made-up-source'],blocks:[]})));
  expect(screen.getByText('Unavailable source: made-up-source')).toBeTruthy();
  view.rerender(<AgentChat {...props} context={JSON.stringify({mode:'sanitized-context',artifacts:[{artifact:'artifact-1.log',content:'replacement evidence',omittedCharacters:0}]})} mode="codex"/>);
  expect(screen.getByText('original sanitized evidence')).toBeTruthy();
  expect(screen.queryByText('replacement evidence')).toBeNull();
});

it('retains denied and interrupted calls without claiming they completed',async()=>{
  let event!:(value:unknown)=>void,reject!:(error:Error)=>void;
  native.invoke.mockImplementation((command,args)=>{
    if(command==='respond_agent_tool')return Promise.resolve();
    if(command==='cancel_agent_chat'){reject(new Error('cancelled'));return Promise.resolve();}
    event=args.onEvent.onmessage;event({type:'started'});return new Promise((_resolve,fail)=>{reject=fail;});
  });
  const user=userEvent.setup();render(<AgentChat {...props} mode="codex"/>);
  await user.click(screen.getByRole('checkbox',{name:'Review before sending'}));
  await user.type(screen.getByRole('textbox',{name:'Message agent'}),'Check access{Enter}');
  await act(async()=>event({type:'tool_approval',id:'one:approve',callId:'one',server:'audit',tool:'access',arguments:{}}));
  await user.click(screen.getByRole('button',{name:'Deny tool'}));
  expect(screen.getByText('Denied')).toBeTruthy();
  await act(async()=>event({type:'tool_progress',callId:'two',server:'datadog',tool:'query',state:'running'}));
  await user.click(screen.getByRole('button',{name:'Stop'}));
  expect(await screen.findByText('Cancelled')).toBeTruthy();
  expect(screen.queryByText('Completed')).toBeNull();
  expect(screen.getByText('Denied')).toBeTruthy();
});
it('preserves a follow-up prepared from an earlier response while the next answer is arriving',async()=>{
  let finish!:(value:string)=>void;
  native.invoke.mockResolvedValueOnce(JSON.stringify({text:'Choose a next step.',blocks:[{type:'followups',prompts:['Inspect the earlier day']}]}));
  const user=userEvent.setup();render(<AgentChat {...props}/>);
  await user.click(screen.getByRole('checkbox',{name:'Review before sending'}));
  await user.type(screen.getByRole('textbox',{name:'Message agent'}),'First question{Enter}');
  await screen.findByText('Choose a next step.');
  native.invoke.mockImplementation((_command,args)=>{args.onEvent.onmessage({type:'started'});return new Promise(resolve=>{finish=resolve;});});
  await user.type(screen.getByRole('textbox',{name:'Message agent'}),'Second question{Enter}');
  await user.click(screen.getByRole('button',{name:/Inspect the earlier day/}));
  await act(async()=>finish('{"text":"Second answer","blocks":[]}'));
  expect((screen.getByRole('textbox',{name:'Message agent'}) as HTMLTextAreaElement).value).toBe('Inspect the earlier day');
});
