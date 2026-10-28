// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { samples } from '../testing/test-fixtures';
const folderPicker = vi.hoisted(() => vi.fn());
vi.mock('../integrations/repositories', () => ({ selectRepositoryFolder: folderPicker }));
beforeEach(() => {
  localStorage.clear();
  folderPicker.mockReset();
  folderPicker.mockResolvedValue(null);
});
afterEach(cleanup);
async function importEvidence(user: ReturnType<typeof userEvent.setup>) {
  const files = samples.map((sample) => {
    const file = new File([sample.raw], sample.name, { type: 'text/plain' });
    Object.defineProperty(file, 'text', { value: async () => sample.raw });
    return file;
  });
  await user.upload(screen.getByLabelText('Import debug files'), files);
  expect(await screen.findByText('3 artifact(s) imported and sanitized locally.')).toBeTruthy();
}
async function clickAction(user: ReturnType<typeof userEvent.setup>, name: string) {
  const action = screen.queryByRole('button', { name });
  if (!action) await user.click(screen.getByRole('button', { name: 'Session actions' }));
  await user.click(screen.getByRole('button', { name }));
}
const repos = [
  { id: 'api', name: 'API', path: '/repos/api' },
  { id: 'web', name: 'Web', path: '/repos/web' },
];

it('keeps hosted settings across navigation, clears credentials, and never saves them locally', async () => {
  const user = userEvent.setup();
  render(<App />);
  async function openModels() {
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Models' }));
    await user.click(screen.getByText('Hosted chat provider', { selector: 'strong' }));
  }
  await openModels();
  await user.type(screen.getByLabelText('HTTPS endpoint'), 'https://provider.example.com/chat');
  await user.type(screen.getByLabelText('Model identifier'), 'debug-model');
  await user.type(
    screen.getByLabelText('Provider API token · not CLI credentials'),
    'private-test-token',
  );
  await user.click(screen.getByRole('button', { name: 'Use hosted provider' }));
  await user.click(screen.getByRole('link', { name: '✳ chista' }));
  expect((screen.getByRole('combobox', { name: 'Chat agent' }) as HTMLSelectElement).value).toBe(
    'hosted',
  );

  await openModels();
  expect((screen.getByLabelText('Model identifier') as HTMLInputElement).value).toBe('debug-model');
  expect(
    (screen.getByLabelText('Provider API token · not CLI credentials') as HTMLInputElement).value,
  ).toBe('private-test-token');
  expect(JSON.stringify(localStorage)).not.toContain('private-test-token');
  expect(JSON.stringify(localStorage)).not.toContain('provider.example.com');
  await user.click(screen.getByRole('button', { name: 'Clear' }));
  expect((screen.getByLabelText('HTTPS endpoint') as HTMLInputElement).value).toBe('');
  expect(
    (screen.getByLabelText('Provider API token · not CLI credentials') as HTMLInputElement).value,
  ).toBe('');
  expect((screen.getByLabelText('Active agent') as HTMLSelectElement).value).toBe('codex');
});

describe('conversation workspace', () => {
  it('opens a real chat with no demo controls and explains desktop requirements', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole('heading', { name: 'What are you debugging?' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Settings' }).closest('.sidebar-footer'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Debug this issue' })).toBeNull();
    expect(screen.getByRole('link', { name: '✳ chista' })).toBeTruthy();
    expect(within(screen.getByRole('banner')).queryByRole('button')).toBeNull();
    expect(screen.queryByText('Codex · CLI chat')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add debug files' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Agent settings' })).toBeNull();
    expect(screen.getByRole('img', { name: 'Chista' })).toBeTruthy();
    await user.type(
      screen.getByRole('textbox', { name: 'Message agent' }),
      'Help me investigate{Enter}',
    );
    expect(await screen.findByText(/Codex chat requires the Tauri desktop app/)).toBeTruthy();
    expect(screen.getByRole('log').querySelectorAll('.message')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Models' }));
    expect(
      within(screen.getByRole('navigation', { name: 'Settings sections' }))
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['General', 'Models']);
    const selector = screen.getByLabelText('Active agent') as HTMLSelectElement;
    expect(selector.value).toBe('codex');
    expect(Array.from(selector.options).map((o) => o.value)).toEqual(['claude', 'codex', 'hosted']);
  });
  it('switches between Claude and Codex from chat and Settings', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'Investigate timeouts');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Chat agent' }), 'codex');
    expect((screen.getByRole('combobox', { name: 'Chat agent' }) as HTMLSelectElement).value).toBe(
      'codex',
    );
    expect(
      (screen.getByRole('textbox', { name: 'Message agent' }) as HTMLTextAreaElement).value,
    ).toBe('Investigate timeouts');
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Models' }));
    expect((screen.getByLabelText('Active agent') as HTMLSelectElement).value).toBe('codex');
    await user.selectOptions(screen.getByLabelText('Active agent'), 'claude');
    await user.click(screen.getByRole('link', { name: '✳ chista' }));
    expect((screen.getByRole('combobox', { name: 'Chat agent' }) as HTMLSelectElement).value).toBe(
      'claude',
    );
  });
  it('shares files and mappings across workspace sessions', async () => {
    const user = userEvent.setup();
    render(<App />);
    await clickAction(user, 'Files & mappings');
    await importEvidence(user);
    await user.click(screen.getByRole('button', { name: 'Mappings' }));
    const mapping = screen.getByRole('region', { name: 'Local redaction mappings' });
    expect(within(mapping).getByText('alex@example.com')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Models' }));
    await user.click(screen.getByRole('link', { name: '✳ chista' }));
    await clickAction(user, 'Files & mappings');
    expect(screen.getByRole('region', { name: 'Local redaction mappings' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'New session' }));
    await clickAction(user, 'Files & mappings');
    expect(screen.getByRole('region', { name: 'Local redaction mappings' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Debug session 1' }));
    await clickAction(user, 'Files & mappings');
    expect(screen.getByRole('region', { name: 'Local redaction mappings' })).toBeTruthy();
  });
  it('hands off only a reviewed snapshot and revokes it when evidence changes', async () => {
    const user = userEvent.setup();
    render(<App />);
    await clickAction(user, 'Files & mappings');
    await importEvidence(user);
    await user.click(screen.getByRole('button', { name: 'Prepare context' }));
    const preview = screen.getByRole('dialog', { name: 'Review context before export' });
    expect(preview.textContent).not.toContain('alex@example.com');
    expect(
      (within(preview).getByRole('button', { name: 'Attach to session chat' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await user.click(within(preview).getByRole('checkbox'));
    await user.click(within(preview).getByRole('button', { name: 'Attach to session chat' }));
    expect(
      screen.getByRole('button', { name: /characters of reviewed context attached/ }),
    ).toBeTruthy();
    expect(screen.getByRole('log', { name: 'Conversation' }).textContent).not.toContain(
      'alex@example.com',
    );
    await user.click(screen.getByRole('button', { name: 'New session' }));
    expect(
      screen.getByRole('button', { name: /characters of reviewed context attached/ }),
    ).toBeTruthy();

    await clickAction(user, 'Files & mappings');
    await user.click(screen.getByRole('button', { name: 'Remove requests.csv' }));
    await user.click(screen.getByRole('link', { name: '✳ chista' }));
    expect(
      screen.queryByRole('button', { name: /characters of reviewed context attached/ }),
    ).toBeNull();
  });
  it('shares workspace repositories across debug sessions', async () => {
    localStorage.setItem('chista.repositories.v1', JSON.stringify(repos));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Switch workspace' }));
    await user.click(screen.getByRole('button', { name: 'Workspace config' }));
    await user.click(screen.getByRole('checkbox', { name: 'API /repos/api' }));
    await user.click(screen.getByRole('checkbox', { name: 'Web /repos/web' }));
    await user.click(screen.getByRole('button', { name: 'New session' }));
    expect(screen.queryByRole('checkbox', { name: 'API /repos/api' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Switch workspace' }));
    await user.click(screen.getByRole('button', { name: 'Workspace config' }));
    expect(
      (screen.getByRole('checkbox', { name: 'API /repos/api' }) as HTMLInputElement).checked,
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Debug session 1' }));
    await user.click(screen.getByRole('button', { name: 'Switch workspace' }));
    await user.click(screen.getByRole('button', { name: 'Workspace config' }));
    expect(screen.getByText('Included repositories · 2')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Models' }));
    await user.selectOptions(screen.getByLabelText('Active agent'), 'claude');
    await user.click(screen.getByRole('link', { name: '✳ chista' }));
    await user.click(screen.getByRole('button', { name: 'Switch workspace' }));
    await user.click(screen.getByRole('button', { name: 'Workspace config' }));
    await user.click(screen.getByRole('checkbox', { name: 'Web /repos/web' }));
    expect(screen.getByText('Included repositories · 1')).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: 'API /repos/api' }));
    expect(screen.getByText('Included repositories · 0')).toBeTruthy();
    expect(screen.queryByText(/sign-in & terminal/)).toBeNull();
  });
  it('migrates project metadata into the independent repository catalog', async () => {
    localStorage.setItem('chista.projects.v1', JSON.stringify(repos));
    const user = userEvent.setup();
    render(<App />);
    expect(localStorage.getItem('chista.projects.v1')).toBeNull();
    expect(localStorage.getItem('chista.repositories.v1')).toContain('/repos/api');
    await user.click(screen.getByRole('button', { name: 'Switch workspace' }));
    await user.click(screen.getByRole('button', { name: 'Workspace config' }));
    folderPicker.mockResolvedValueOnce({ name: 'worker', path: '/repos/worker' });
    await user.click(screen.getByRole('button', { name: 'Choose folder' }));
    await user.click(screen.getByRole('link', { name: '✳ chista' }));
    expect(screen.queryByRole('button', { name: 'Debug session 2' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Switch workspace' }));
    await user.click(screen.getByRole('button', { name: 'Workspace config' }));
    expect(screen.getByRole('checkbox', { name: 'worker /repos/worker' })).toBeTruthy();
  });
  it('previews the exact sanitized hosted request before any remote send', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Models' }));
    await user.click(screen.getByText('Hosted chat provider', { selector: 'strong' }));
    await user.type(screen.getByLabelText('HTTPS endpoint'), 'https://provider.example.com/chat');
    await user.type(screen.getByLabelText('Model identifier'), 'debug-model');
    await user.click(screen.getByRole('button', { name: 'Use hosted provider' }));
    await user.click(screen.getByRole('link', { name: '✳ chista' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Message agent' }),
      'Check alex@example.com{Enter}',
    );
    const preview = screen.getByRole('dialog', { name: 'Approve outgoing request' });
    expect(preview.textContent).not.toContain('alex@example.com');
    expect(preview.textContent).toContain('[EMAIL_1]');
    expect(preview.textContent).toContain('debug-model');
    await user.click(within(preview).getByRole('button', { name: 'Deny / edit' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

it('renames a session in the sidebar, supports cancelling, and keeps sessions separate', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: 'Rename Debug session 1' }));
  const name = screen.getByRole('textbox', { name: 'Session name' });
  await user.clear(name);
  await user.type(name, 'Checkout timeouts{Enter}');
  expect(screen.getByRole('button', { name: 'Checkout timeouts' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Checkout timeouts' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Rename Checkout timeouts' }));
  await user.clear(screen.getByRole('textbox', { name: 'Session name' }));
  await user.type(screen.getByRole('textbox', { name: 'Session name' }), 'Discard this{Escape}');
  expect(screen.getByRole('button', { name: 'Checkout timeouts' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'New session' }));
  expect(screen.getByRole('button', { name: 'Checkout timeouts' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: /Debug session/ })).toBeTruthy();
});

it.each(['+ Add files'])(
  '%s attaches sanitized files in the active chat composer',
  async (label) => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'New session' }));
    const inputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
    const picker = vi.fn();
    expect(inputs).toHaveLength(1);
    inputs[0].addEventListener('click', picker);
    await user.click(screen.getByRole('button', { name: label }));
    expect(picker).toHaveBeenCalledTimes(1);
    // Cancelling the native picker leaves the conversation visible.
    expect(screen.getByRole('textbox', { name: 'Message agent' })).toBeTruthy();
    const file = new File(['email,status\nalex@example.com,error'], 'error.csv', {
      type: 'text/csv',
    });
    Object.defineProperty(file, 'text', {
      value: async () => 'email,status\nalex@example.com,error',
    });
    await user.upload(inputs[0], file);
    expect(await screen.findByRole('button', { name: 'Remove attachment error.csv' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Message agent' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^error\.csv/ }));
    const preview = document.querySelector('.attachment-details pre')!;
    expect(preview.textContent).toContain('[EMAIL_1]');
    expect(preview.textContent).not.toContain('alex@example.com');
    expect(preview.textContent).not.toContain('error.csv');
    await user.click(screen.getByRole('button', { name: 'Debug session 1' }));
    expect(screen.getByRole('button', { name: 'Remove attachment error.csv' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Debug session 2' }));
    await user.click(screen.getByRole('button', { name: 'Remove attachment error.csv' }));
    expect(screen.queryByRole('button', { name: 'Remove attachment error.csv' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
  },
);

it('shows failed imports in the composer without attaching raw data', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '+ Add files' }));
  const file = new File(['{broken-json'], 'broken.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => '{broken-json' });
  await user.upload(screen.getByLabelText('Import debug files'), file);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByRole('textbox', { name: 'Message agent' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Remove attachment broken.json' })).toBeNull();
  expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
});

it('accepts TSV attachments and previews sanitized tab-separated content inline', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '+ Add files' }));
  const data = 'email\tstatus\nalex@example.com\ttimeout';
  const file = new File([data], 'events.tsv', { type: 'text/tab-separated-values' });
  Object.defineProperty(file, 'text', { value: async () => data });
  await user.upload(screen.getByLabelText('Import debug files'), file);
  await user.click(await screen.findByRole('button', { name: /^events\.tsv/ }));
  const preview = document.querySelector('.attachment-details pre')!;
  const payload = JSON.parse(preview.textContent!);
  expect(payload.artifacts[0].content).toContain('[EMAIL_1]\ttimeout');
  expect(preview.textContent).not.toContain('alex@example.com');
  expect(screen.getByRole('textbox', { name: 'Message agent' })).toBeTruthy();
});

it('opens Files & mappings directly from the page toolbar', async () => {
  const user = userEvent.setup();
  render(<App />);
  expect(
    screen.getByRole('button', { name: 'Files & mappings' }).closest('.workspace-toolbar'),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Session actions' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Files & mappings' }));
  expect(screen.getByRole('button', { name: 'Mappings' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Back to chat' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Debug session 1' }));
  expect(screen.getByRole('textbox', { name: 'Message agent' })).toBeTruthy();
});

it('isolates workspace evidence and drafts while preserving evidence after closing a debug session', async () => {
  const user = userEvent.setup();
  render(<App />);

  const file = new File(['email,status\nalex@example.com,error'], 'shared.csv', {
    type: 'text/csv',
  });
  Object.defineProperty(file, 'text', {
    value: async () => 'email,status\nalex@example.com,error',
  });
  await user.click(screen.getByRole('button', { name: '+ Add files' }));
  await user.upload(screen.getByLabelText('Import debug files'), file);
  await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'First investigation');
  await user.click(screen.getByRole('button', { name: 'New session' }));
  expect(
    (screen.getByRole('textbox', { name: 'Message agent' }) as HTMLTextAreaElement).value,
  ).toBe('');
  expect(screen.getByRole('button', { name: 'Remove attachment shared.csv' })).toBeTruthy();
  await clickAction(user, 'Close session');
  expect(
    (screen.getByRole('textbox', { name: 'Message agent' }) as HTMLTextAreaElement).value,
  ).toBe('First investigation');
  expect(screen.getByRole('button', { name: 'Remove attachment shared.csv' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Switch workspace' }));
  await user.click(screen.getByRole('button', { name: 'New workspace' }));
  await user.type(screen.getByRole('textbox', { name: 'Workspace name' }), 'Payments');
  await user.click(screen.getByRole('button', { name: 'Create workspace' }));
  expect(screen.queryByRole('button', { name: 'Remove attachment shared.csv' })).toBeNull();
  expect(
    (screen.getByRole('textbox', { name: 'Message agent' }) as HTMLTextAreaElement).value,
  ).toBe('');
  await clickAction(user, 'Files & mappings');
  await user.click(screen.getByRole('button', { name: 'Mappings' }));
  expect(screen.queryByText('alex@example.com')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Switch workspace' }));
  await user.click(screen.getByRole('button', { name: 'My workspace' }));
  expect(screen.getByRole('button', { name: 'Remove attachment shared.csv' })).toBeTruthy();
  expect(
    (screen.getByRole('textbox', { name: 'Message agent' }) as HTMLTextAreaElement).value,
  ).toBe('First investigation');
  expect(localStorage.getItem('chista.workspaces.v1')).toContain('Payments');
  expect(JSON.stringify(localStorage)).not.toContain('alex@example.com');
});

it('cancels folder selection without adding a repo and reuses an existing folder', async () => {
  localStorage.setItem('chista.repositories.v1', JSON.stringify(repos));
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: 'Switch workspace' }));
  await user.click(screen.getByRole('button', { name: 'Workspace config' }));
  expect(screen.queryByLabelText('Repository directory')).toBeNull();
  expect(screen.queryByLabelText('Repository name')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Choose folder' }));
  expect(screen.getByRole('heading', { name: 'Included repositories · 0' })).toBeTruthy();
  folderPicker.mockResolvedValueOnce({ name: 'API', path: '/repos/api' });
  await user.click(screen.getByRole('button', { name: 'Choose folder' }));
  expect(screen.getByRole('heading', { name: 'Included repositories · 1' })).toBeTruthy();
  expect(JSON.parse(localStorage.getItem('chista.repositories.v1')!)).toHaveLength(2);
  folderPicker.mockRejectedValueOnce(new Error('Picker unavailable'));
  await user.click(screen.getByRole('button', { name: 'Choose folder' }));
  expect(screen.getByRole('status').textContent).toContain('Picker unavailable');
});
