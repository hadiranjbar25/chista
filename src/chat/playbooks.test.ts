import { expect, it } from 'vitest';
import { PLAYBOOKS, preparePlaybook, newTasks, applyTaskUpdates } from './playbooks';
import { parseReply } from './response';
import { Sanitizer } from '../evidence/safety';
it('expands only registered playbooks and preserves free-form requests', () => {
  expect(preparePlaybook('Inspect this', undefined, []).prompt).toBe('Inspect this');
  for (const playbook of PLAYBOOKS) {
    const prepared = preparePlaybook(`${playbook.command} Investigate failures`, undefined, []);
    expect(prepared.playbookId).toBe(playbook.id);
    expect(prepared.tasks).toHaveLength(4);
    expect(prepared.prompt).toContain('Investigate failures');
    expect(prepared.prompt).toContain('grants no permissions');
  }
  expect(() => preparePlaybook('/unregistered execute code', undefined, [])).toThrow(
    'Unknown playbook',
  );
});
it('does not allow malformed task reports to invalidate normal responses or grant permissions', () => {
  const parsed = parseReply(
    JSON.stringify({
      text: 'Answer',
      blocks: [],
      tasks: [{ task: 'evidence', status: 'completed', permissions: 'allow-all' }],
    }),
  );
  expect(parsed.text).toBe('Answer');
  expect(parsed.tasks).toBeUndefined();
  const tasks = newTasks('investigate-error');
  expect(
    applyTaskUpdates(
      tasks,
      [{ task: 'unknown', status: 'completed', sources: ['s1'] }],
      new Set(['s1']),
    ),
  ).toEqual(tasks);
  const unsupported = applyTaskUpdates(
    tasks,
    [{ task: 'evidence', status: 'completed', sources: ['invented'] }],
    new Set(['s1']),
  );
  expect(unsupported.find((t) => t.id === 'evidence')?.status).toBe('blocked');
  const supported = applyTaskUpdates(
    tasks,
    [{ task: 'evidence', status: 'completed', sources: ['s1', 'invented'] }],
    new Set(['s1']),
  );
  expect(supported.find((t) => t.id === 'evidence')).toMatchObject({
    status: 'completed',
    sources: ['s1'],
    reportedBy: 'agent',
  });
});
it('keeps registered task references through sanitization while masking sensitive details', () => {
  const sanitizer = new Sanitizer();
  const prepared = preparePlaybook('/investigate-error token=opaque-secret', undefined, []);
  const safePrompt = sanitizer.text(prepared.prompt);
  expect(safePrompt).not.toContain('opaque-secret');
  expect(safePrompt).toContain('"task":"evidence"');
  const content = sanitizer.sanitize(
    JSON.stringify({
      text: 'Answer',
      blocks: [],
      tasks: [{ task: 'evidence', status: 'blocked', detail: 'email=private@example.com' }],
    }),
    'json',
    [],
  );
  expect(content).not.toContain('private@example.com');
  expect(parseReply(content).tasks?.[0].task).toBe('evidence');
});
