// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: native.invoke,
  Channel: class { onmessage: (event: unknown) => void = () => {}; },
}));
import AgentChat from './AgentChat';
import { McpConnections } from './integrations/mcp';
afterEach(() => { cleanup(); native.invoke.mockReset(); });
const props = {
  repositories: [], session: { id: 'session', name: 'Investigation', repoIds: [] },
  context: 'Reviewed evidence: 2 timeouts', mode: 'claude', claudePath: '',
  hosted: { endpoint: '', model: '', token: '' }, servers: [], connections: {},
  mcp: new McpConnections(() => {}), onModelStatus: vi.fn(), onFiles: vi.fn(), onSettings: vi.fn(),
};
it.each(['claude','codex'])('%s requires approval and renders generated OpenUI', async agent => {
  let finish!: (text: string) => void;
  native.invoke.mockImplementation((command, args) => {
    expect(command).toBe(`${agent}_chat`);
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

it('offers native sign-in without a repository and preserves a failed draft for retry', async () => {
  native.invoke.mockImplementation(async command => {
    if(command==='claude_sign_in') return 'Complete sign-in in Terminal.';
    throw new Error('Claude Code is not signed in. Choose Sign in to Claude.');
  });
  const user=userEvent.setup();render(<AgentChat {...props}/>);
  await user.type(screen.getByRole('textbox',{name:'Message agent'}),'Check this timeout{Enter}');
  await user.click(screen.getByRole('button',{name:'Approve and send'}));
  await user.click(await screen.findByRole('button',{name:'Open Claude sign-in'}));
  expect(native.invoke).toHaveBeenCalledWith('claude_sign_in',{executablePath:''});
  expect((screen.getByRole('textbox',{name:'Message agent'}) as HTMLTextAreaElement).value).toBe('Check this timeout');
  await user.click(screen.getByRole('button',{name:'Send'}));
  const body=JSON.parse(screen.getByRole('dialog').querySelector('pre')!.textContent!);
  expect(body.messages.filter((m:{content:string})=>m.content==='Check this timeout')).toHaveLength(1);
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
