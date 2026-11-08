import { PLAYBOOKS } from './playbooks';
import type { ChatController } from './useAgentChat';
const statuses = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Completed',
  blocked: 'Blocked',
};
export default function InvestigationPlan({ chat }: { chat: ChatController }) {
  const disabled = chat.busy || chat.refreshingMcp || chat.openingMcpLogin;
  return (
    <section className="investigation-plan" aria-label="Investigation plan">
      <label className="field">
        Debugging playbook
        <select
          aria-label="Debugging playbook"
          value={chat.playbookId ?? ''}
          disabled={disabled}
          onChange={(e) => chat.selectPlaybook(e.target.value)}
        >
          <option value="">Free-form investigation</option>
          {PLAYBOOKS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} · {p.command}
            </option>
          ))}
        </select>
      </label>
      {chat.playbookId && (
        <p className="muted">
          {PLAYBOOKS.find((p) => p.id === chat.playbookId)?.description} The playbook is included in
          your next reviewed request.
        </p>
      )}
      {chat.tasks.length > 0 && (
        <>
          <div className="section-heading">
            <strong>Investigation checklist</strong>
            <span>
              {chat.tasks.filter((t) => t.status === 'completed').length} / {chat.tasks.length}{' '}
              complete
            </span>
          </div>
          <p className="muted">
            Agent updates are progress reports. A cited source supports a completion report; it does
            not independently verify it. You can confirm statuses yourself. Tasks grant no tool
            permissions.
          </p>
          <ol>
            {chat.tasks.map((task) => (
              <li key={task.id}>
                <div>
                  <strong>{task.title}</strong>
                  {task.detail && <p>{task.detail}</p>}
                  {task.reportedBy && (
                    <small>
                      {task.reportedBy === 'user' ? 'Confirmed by you' : 'Agent-reported'}
                      {task.sources?.length ? ` · Sources: ${task.sources.join(', ')}` : ''}
                    </small>
                  )}
                </div>
                <select
                  aria-label={`Status: ${task.title}`}
                  value={task.status}
                  disabled={disabled}
                  onChange={(e) => chat.changeTask(task.id, e.target.value)}
                >
                  {Object.entries(statuses).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
