// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { samples } from './test-fixtures';
beforeEach(()=>localStorage.clear());afterEach(cleanup);
async function importEvidence(user: ReturnType<typeof userEvent.setup>) {
  const files=samples.map(sample=>{
    const file=new File([sample.raw],sample.name,{type:'text/plain'});
    Object.defineProperty(file,'text',{value:async()=>sample.raw});
    return file;
  });
  await user.upload(screen.getByLabelText('Import debug files'),files);
  expect(await screen.findByText('3 artifact(s) imported and sanitized locally.')).toBeTruthy();
}
const repos=[{id:'api',name:'API',path:'/repos/api'},{id:'web',name:'Web',path:'/repos/web'}];
describe('conversation workspace',()=>{
  it('opens a real chat with no demo controls and explains desktop requirements',async()=>{
    const user=userEvent.setup();render(<App/>);
    expect(screen.getByRole('heading',{name:'What are you debugging?'})).toBeTruthy();
    expect(screen.getByRole('button',{name:'Settings'}).closest('header')).toBeTruthy();
    expect(screen.queryByRole('button',{name:'Debug this issue'})).toBeNull();
    await user.type(screen.getByRole('textbox',{name:'Message agent'}),'Help me investigate{Enter}');
    expect(await screen.findByText(/Codex chat requires the Tauri desktop app/)).toBeTruthy();
    expect(screen.getByRole('log').querySelectorAll('.message')).toHaveLength(0);
    await user.click(screen.getByRole('button',{name:'Agent settings'}));
    const selector=screen.getByLabelText('Active agent') as HTMLSelectElement;
    expect(selector.value).toBe('codex');
    expect(Array.from(selector.options).map(o=>o.value)).toEqual(['claude','codex','hosted']);
  });
  it('switches between Claude and Codex from chat and Settings',async()=>{
    const user=userEvent.setup();render(<App/>);
    await user.type(screen.getByRole('textbox',{name:'Message agent'}),'Investigate timeouts');
    await user.selectOptions(screen.getByRole('combobox',{name:'Chat agent'}),'codex');
    expect(screen.getByText('Codex · CLI chat')).toBeTruthy();
    expect((screen.getByRole('textbox',{name:'Message agent'}) as HTMLTextAreaElement).value).toBe('Investigate timeouts');
    await user.click(screen.getByRole('button',{name:'Agent settings'}));
    expect((screen.getByLabelText('Active agent') as HTMLSelectElement).value).toBe('codex');
    await user.selectOptions(screen.getByLabelText('Active agent'),'claude');
    await user.click(screen.getByRole('button',{name:'Back to chat'}));
    expect((screen.getByRole('combobox',{name:'Chat agent'}) as HTMLSelectElement).value).toBe('claude');
  });
  it('keeps artifacts, mappings and conversation scoped to independent sessions',async()=>{
    const user=userEvent.setup();render(<App/>);
    await user.click(screen.getByRole('button',{name:'Files & mappings'}));
    await importEvidence(user);
    await user.click(screen.getByRole('button',{name:'Mappings'}));
    const mapping=screen.getByRole('region',{name:'Local redaction mappings'});
    expect(within(mapping).getByText('alex@example.com')).toBeTruthy();
    await user.click(screen.getByRole('button',{name:'Settings'}));
    await user.click(screen.getByRole('button',{name:'Models'}));
    await user.click(screen.getByRole('button',{name:'Back to chat'}));
    await user.click(screen.getByRole('button',{name:'Files & mappings'}));
    expect(screen.getByRole('region',{name:'Local redaction mappings'})).toBeTruthy();
    await user.click(screen.getByRole('button',{name:'New session'}));
    await user.click(screen.getByRole('button',{name:'Files & mappings'}));
    expect(within(screen.getByRole('main')).queryByText('checkout-production.log')).toBeNull();
    await user.click(screen.getByRole('button',{name:'Debug session 1'}));
    expect(screen.getByRole('region',{name:'Local redaction mappings'})).toBeTruthy();
  });
  it('hands off only a reviewed snapshot and revokes it when evidence changes',async()=>{
    const user=userEvent.setup();render(<App/>);
    await user.click(screen.getByRole('button',{name:'Files & mappings'}));
    await importEvidence(user);
    await user.click(screen.getByRole('button',{name:'Prepare context'}));
    const preview=screen.getByRole('dialog',{name:'Review context before export'});
    expect(preview.textContent).not.toContain('alex@example.com');
    expect((within(preview).getByRole('button',{name:'Attach to session chat'}) as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(preview).getByRole('checkbox'));
    await user.click(within(preview).getByRole('button',{name:'Attach to session chat'}));
    expect(screen.getByRole('button',{name:/characters of reviewed context attached/})).toBeTruthy();
    expect(screen.getByRole('log',{name:'Conversation'}).textContent).not.toContain('alex@example.com');
    await user.click(screen.getByRole('button',{name:'Files & mappings'}));
    await user.click(screen.getByRole('button',{name:'Remove requests.csv'}));
    await user.click(screen.getByRole('button',{name:'Back to chat'}));
    expect(screen.queryByRole('button',{name:/characters of reviewed context attached/})).toBeNull();
  });
  it('includes multiple repos without making repos own sessions',async()=>{
    localStorage.setItem('chista.repositories.v1',JSON.stringify(repos));
    const user=userEvent.setup();render(<App/>);
    await user.click(screen.getByRole('button',{name:'Repos · 0'}));
    await user.click(screen.getByRole('checkbox',{name:'API /repos/api'}));
    await user.click(screen.getByRole('checkbox',{name:'Web /repos/web'}));
    await user.click(screen.getByRole('button',{name:'New session'}));
    expect((screen.getByRole('checkbox',{name:'API /repos/api'}) as HTMLInputElement).checked).toBe(false);
    await user.click(screen.getByRole('button',{name:'Debug session 1'}));
    expect(screen.getByText('Included repositories · 2')).toBeTruthy();
    await user.click(screen.getByRole('button',{name:'Settings'}));await user.click(screen.getByRole('button',{name:'Models'}));
    await user.selectOptions(screen.getByLabelText('Active agent'),'claude');await user.click(screen.getByRole('button',{name:'Back to chat'}));
    await user.click(screen.getByRole('checkbox',{name:'Web /repos/web'}));
    expect(screen.getByText('Included repositories · 1')).toBeTruthy();
    await user.click(screen.getByRole('checkbox',{name:'API /repos/api'}));
    expect(screen.getByText('Included repositories · 0')).toBeTruthy();
    expect(screen.queryByText(/sign-in & terminal/)).toBeNull();
  });
  it('migrates project metadata into the independent repository catalog',async()=>{
    localStorage.setItem('chista.projects.v1',JSON.stringify(repos));const user=userEvent.setup();render(<App/>);
    expect(localStorage.getItem('chista.projects.v1')).toBeNull();
    expect(localStorage.getItem('chista.repositories.v1')).toContain('/repos/api');
    await user.click(screen.getByRole('button',{name:'Repos · 0'}));await user.click(screen.getByRole('button',{name:'Manage repos'}));
    await user.type(screen.getByLabelText('Repository name',{selector:'input:not([aria-label])'}),'Worker');
    await user.type(screen.getByLabelText('Repository directory'),'/repos/worker');await user.click(screen.getByRole('button',{name:'Add repository'}));
    await user.click(screen.getByRole('button',{name:'Back to chat'}));
    expect(screen.queryByRole('button',{name:'Debug session 2'})).toBeNull();
    expect(screen.getByRole('checkbox',{name:'Worker /repos/worker'})).toBeTruthy();
  });
  it('previews the exact sanitized hosted request before any remote send',async()=>{
    const user=userEvent.setup();render(<App/>);
    await user.click(screen.getByRole('button',{name:'Settings'}));await user.click(screen.getByRole('button',{name:'Models'}));
    await user.type(screen.getByLabelText('HTTPS endpoint'),'https://provider.example.com/chat');
    await user.type(screen.getByLabelText('Model identifier'),'debug-model');await user.click(screen.getByRole('button',{name:'Use hosted provider'}));
    await user.click(screen.getByRole('button',{name:'Back to chat'}));
    await user.type(screen.getByRole('textbox',{name:'Message agent'}),'Check alex@example.com{Enter}');
    const preview=screen.getByRole('dialog',{name:'Approve outgoing request'});
    expect(preview.textContent).not.toContain('alex@example.com');expect(preview.textContent).toContain('[CHAT_EMAIL_1]');expect(preview.textContent).toContain('debug-model');
    await user.click(within(preview).getByRole('button',{name:'Deny / edit'}));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

it('renames a session in the sidebar, supports cancelling, and keeps sessions separate', async () => {
  const user=userEvent.setup();render(<App/>);
  await user.click(screen.getByRole('button',{name:'Rename Debug session 1'}));
  const name=screen.getByRole('textbox',{name:'Session name'});
  await user.clear(name);await user.type(name,'Checkout timeouts{Enter}');
  expect(screen.getByRole('button',{name:'Checkout timeouts'})).toBeTruthy();
  expect(screen.getByRole('heading',{name:'Checkout timeouts'})).toBeTruthy();
  await user.click(screen.getByRole('button',{name:'Rename Checkout timeouts'}));
  await user.clear(screen.getByRole('textbox',{name:'Session name'}));
  await user.type(screen.getByRole('textbox',{name:'Session name'}),'Discard this{Escape}');
  expect(screen.getByRole('button',{name:'Checkout timeouts'})).toBeTruthy();
  await user.click(screen.getByRole('button',{name:'New session'}));
  expect(screen.getByRole('button',{name:'Checkout timeouts'})).toBeTruthy();
  expect(screen.getByRole('heading',{name:/Debug session/})).toBeTruthy();
});
