import { expect, it } from 'vitest';
import { Sanitizer } from '../evidence/safety';
import { branchCheckpoint, type Checkpoint } from './checkpoints';
import { newTasks } from './playbooks';
it('branches only the selected prefix, preserves a private redaction profile and excludes later activity', () => {
  const sanitizer = new Sanitizer();
  sanitizer.setTerms(['private-host']);
  sanitizer.text('private-host private@example.com');
  const checkpoint: Checkpoint = {
    repositoryNames: ['Project'],
    context: 'old evidence',
    sources: [],
    tasks: newTasks('investigate-error'),
    playbookId: 'investigate-error',
    sanitizer,
  };
  const messages = [
    { role: 'user' as const, content: 'First' },
    { role: 'assistant' as const, content: 'Answer' },
    { role: 'user' as const, content: 'Later' },
  ];
  const branch = branchCheckpoint(
    messages,
    0,
    checkpoint,
    { 0: [], 1: [], 2: [] },
    { 0: [{ id: 'future-tool', server: 'MCP', tool: 'write', state: 'denied' }] },
    { 0: checkpoint, 2: checkpoint },
    { 0: 'First', 2: 'Later' },
  );
  expect(branch.messages).toEqual([messages[0]]);
  expect(branch.activities).toEqual({});
  expect(branch.checkpoints[2]).toBeUndefined();
  expect(branch.displayPrompts[2]).toBeUndefined();
  expect(branch.sanitizer).not.toBe(sanitizer);
  sanitizer.setTerms(['new-host']);
  expect(branch.sanitizer.text('private-host')).not.toContain('private-host');
  branch.tasks[0].status = 'completed';
  branch.messages[0].content = 'Different';
  expect(checkpoint.tasks[0].status).toBe('pending');
  expect(messages[0].content).toBe('First');
  expect(() => branchCheckpoint(messages, 999, checkpoint, {}, {})).toThrow('available');
});
it('keeps new redaction placeholders distinct across sibling investigations', () => {
  const sanitizer = new Sanitizer();
  const checkpoint: Checkpoint = {
    repositoryNames: [],
    context: null,
    sources: [],
    tasks: [],
    sanitizer,
  };
  const messages = [{ role: 'user' as const, content: 'Investigate' }];
  const left = branchCheckpoint(messages, 0, checkpoint, {}, {});
  const right = branchCheckpoint(messages, 0, checkpoint, {}, {});
  const leftMask = left.sanitizer.text('left@example.com');
  const rightMask = right.sanitizer.text('right@example.com');
  expect(leftMask).not.toBe(rightMask);
  expect(left.sanitizer.restore(leftMask)).toBe('left@example.com');
  expect(right.sanitizer.restore(leftMask)).toBe(leftMask);
  expect(sanitizer.mappings()).toEqual([]);
});
