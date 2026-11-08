import type { Message } from '../integrations/providers';
import type { EvidenceSource, ToolActivity } from '../evidence/investigation';
import type { Sanitizer } from '../evidence/safety';
import type { InvestigationTask, PlaybookId } from './playbooks';

export type Checkpoint = {
  repositoryNames: string[];
  context: string | null;
  sources: EvidenceSource[];
  tasks: InvestigationTask[];
  playbookId?: PlaybookId;
  sanitizer: Sanitizer;
};
export type InvestigationBranch = Checkpoint & {
  reviewBeforeSending?: boolean;
  displayPrompts: Record<number, string>;
  checkpoints: Record<number, Checkpoint>;
  messages: Message[];
  responseSources: Record<number, EvidenceSource[]>;
  activities: Record<number, ToolActivity[]>;
  messageIndex: number;
};
export function branchCheckpoint(
  messages: Message[],
  index: number,
  checkpoint: Checkpoint,
  responseSources: Record<number, EvidenceSource[]>,
  activities: Record<number, ToolActivity[]>,
  checkpoints: Record<number, Checkpoint> = {},
  displayPrompts: Record<number, string> = {},
): InvestigationBranch {
  if (!Number.isInteger(index) || index < 0 || index >= messages.length)
    throw new Error('Choose an available message checkpoint.');
  const prefix = <T>(items: Record<number, T>, through = index) =>
    Object.fromEntries(Object.entries(items).filter(([key]) => Number(key) <= through));
  return {
    ...checkpoint,
    repositoryNames: [...checkpoint.repositoryNames],
    // Keep inherited masks, but give discoveries in this branch a distinct namespace.
    sanitizer: checkpoint.sanitizer.fork(
      'BRANCH_' +
        crypto
          .randomUUID()
          .replace(/\d/g, (digit) => String.fromCharCode(71 + Number(digit)))
          .replace(/-/g, '')
          .toUpperCase(),
    ),
    messages: messages.slice(0, index + 1).map((m) => ({ ...m })),
    sources: checkpoint.sources.map((source) => ({ ...source })),
    tasks: checkpoint.tasks.map((task) => ({ ...task, sources: task.sources?.slice() })),
    displayPrompts: prefix(displayPrompts),
    checkpoints: prefix(checkpoints),
    responseSources: prefix(responseSources),
    activities: prefix(activities, messages[index].role === 'user' ? index - 1 : index),
    messageIndex: index,
  };
}
