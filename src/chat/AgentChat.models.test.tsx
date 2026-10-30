// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { native, chatProps } from './testing/nativeChatHarness';
import AgentChat from './AgentChat';

it.each(['claude', 'codex'])(
  'sends the selected %s model and retains history across a model switch',
  async (mode) => {
    native.invoke.mockResolvedValue('{"text":"Answer","blocks":[]}');
    const user = userEvent.setup();
    const view = render(<AgentChat {...chatProps} mode={mode} model="fixture-one" />);
    await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'First{Enter}');
    await screen.findByText('Answer');
    const first = native.invoke.mock.calls[0][1];
    expect(first.model).toBe('fixture-one');
    view.rerender(<AgentChat {...chatProps} mode={mode} model="fixture-two" />);
    await user.type(screen.getByRole('textbox', { name: 'Message agent' }), 'Next{Enter}');
    expect(native.invoke.mock.calls[1][1].model).toBe('fixture-two');
    expect(native.invoke.mock.calls[1][1].sessionKey).not.toBe(first.sessionKey);
    expect(native.invoke.mock.calls[1][1].payload).toContain('First');
    expect(native.invoke.mock.calls[1][1].payload).toContain('Answer');
  },
);
