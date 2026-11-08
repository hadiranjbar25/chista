import {
  Circle,
  CircleDot,
  CircleCheck,
  CircleAlert,
  Search,
  GitCompareArrows,
  FileText,
  MessageSquare,
} from 'lucide-react';
import ChoiceGroup from '../components/ChoiceGroup';
import { PLAYBOOKS } from './playbooks';
import type { ChatController } from './useAgentChat';
const statuses = [
  { value: 'pending', label: 'Pending', icon: <Circle size={14} /> },
  { value: 'in_progress', label: 'In progress', icon: <CircleDot size={14} /> },
  { value: 'completed', label: 'Done', icon: <CircleCheck size={14} /> },
  { value: 'blocked', label: 'Blocked', icon: <CircleAlert size={14} /> },
];
const icons = [Search, GitCompareArrows, FileText];
export default function InvestigationPlan({ chat }: { chat: ChatController }) {
  const disabled = chat.busy || chat.refreshingMcp || chat.openingMcpLogin;
  const completed = chat.tasks.filter((task) => task.status === 'completed').length;
  return (
    <section className="investigation-plan" aria-label="Investigation plan">
      <div className="plan-heading">
        <div>
          <h2>How would you like to investigate?</h2>
          <p>Choose a starting point, then describe the issue in chat.</p>
        </div>
        <span className="plan-hint">Or type a /command</span>
      </div>
      <ChoiceGroup
        label="Debugging playbook"
        className="playbook-choices"
        value={chat.playbookId ?? ''}
        disabled={disabled}
        onChange={chat.selectPlaybook}
        options={[
          {
            value: '',
            label: 'Free-form investigation',
            description: 'Start with a question and follow the evidence.',
            icon: <MessageSquare size={18} />,
          },
          ...PLAYBOOKS.map((playbook, index) => {
            const Icon = icons[index];
            return {
              value: playbook.id,
              label: playbook.label,
              description: playbook.description,
              icon: <Icon size={18} />,
            };
          }),
        ]}
      />
      {chat.tasks.length > 0 && (
        <div className="checklist-content">
          <div className="checklist-heading">
            <h3>Investigation checklist</h3>
            <div>
              <span>
                {completed} of {chat.tasks.length} complete
              </span>
              <progress aria-label="Checklist progress" value={completed} max={chat.tasks.length} />
            </div>
          </div>
          <p className="checklist-hint">
            Update a step directly as you review it. Agent-reported results still need your
            judgment.
          </p>
          <ol>
            {chat.tasks.map((task, index) => (
              <li key={task.id} className={`checklist-step checklist-step-${task.status}`}>
                <span className="step-number" aria-hidden="true">
                  {task.status === 'completed' ? (
                    <CircleCheck size={18} />
                  ) : (
                    String(index + 1).padStart(2, '0')
                  )}
                </span>
                <div className="step-body">
                  <strong>{task.title}</strong>
                  {task.reportedBy && (
                    <small>
                      {task.reportedBy === 'user' ? 'Confirmed by you' : 'Agent-reported'}
                    </small>
                  )}
                  {(task.detail || Boolean(task.sources?.length)) && (
                    <details>
                      <summary>
                        Review details
                        {task.sources?.length
                          ? ` · ${task.sources.length} source${task.sources.length > 1 ? 's' : ''}`
                          : ''}
                      </summary>
                      {task.detail && <p>{task.detail}</p>}
                      {task.sources?.length ? <p>Sources: {task.sources.join(', ')}</p> : null}
                    </details>
                  )}
                </div>
                <ChoiceGroup
                  label={`Status: ${task.title}`}
                  value={task.status}
                  options={statuses}
                  onChange={(status) => chat.changeTask(task.id, status)}
                  disabled={disabled}
                  className="task-status-choices"
                />
              </li>
            ))}
          </ol>
          <p className="plan-footnote">
            The playbook is included in your next request. Tool approvals and redaction stay in
            place.
          </p>
        </div>
      )}
    </section>
  );
}
