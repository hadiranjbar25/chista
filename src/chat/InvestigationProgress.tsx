import { Activity, CheckCircle2, Clock3, ShieldCheck, XCircle } from 'lucide-react';
import FullscreenSection from '../components/FullscreenSection';
import type { EvidenceSource, ToolActivity } from '../evidence/investigation';
const labels = {
  approval: 'Awaiting approval',
  running: 'Running',
  completed: 'Completed',
  denied: 'Denied',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
export default function InvestigationProgress({
  activities,
  evidence,
}: {
  activities: ToolActivity[];
  evidence: EvidenceSource[];
}) {
  if (!activities.length) return null;
  return (
    <FullscreenSection title="Investigation activity" className="focus-investigation">
      <section className="investigation-progress" aria-label="Investigation activity">
        <div className="investigation-caption">Tool activity</div>
        <ul>
          {activities.map((item) => {
            const source = evidence.find((source) => source.id === item.sourceId);
            const Icon =
              item.state === 'completed'
                ? CheckCircle2
                : item.state === 'approval'
                  ? ShieldCheck
                  : item.state === 'running'
                    ? Activity
                    : item.state === 'cancelled'
                      ? Clock3
                      : XCircle;
            return (
              <li key={item.id} className={`tool-step ${item.state}`}>
                <Icon size={15} />
                <div>
                  <strong>
                    {item.server} · {item.tool}
                  </strong>
                  <span>{labels[item.state]}</span>
                  {item.state === 'failed' && item.detail && (
                    <details>
                      <summary>View error details</summary>
                      <pre>{item.detail}</pre>
                    </details>
                  )}
                  {source && (
                    <details>
                      <summary>View sanitized evidence</summary>
                      <p className="muted">
                        Source: {source.id}
                        {source.truncated ? ' · truncated' : ''}
                      </p>
                      <pre>{source.content}</pre>
                    </details>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </FullscreenSection>
  );
}
export function EvidenceCitations({
  ids,
  evidence,
}: {
  ids: string[];
  evidence: EvidenceSource[];
}) {
  if (!ids.length) return null;
  return (
    <FullscreenSection title="Response sources" className="focus-investigation">
      <section className="evidence-citations" aria-label="Response sources">
        <strong>Sources</strong>
        {[...new Set(ids)].map((id) => {
          const source = evidence.find((item) => item.id === id);
          return source ? (
            <details key={id}>
              <summary>{source.title}</summary>
              <p className="muted">
                {source.id}
                {source.truncated ? ' · excerpt truncated' : ''}
              </p>
              <pre>{source.content}</pre>
            </details>
          ) : (
            <p className="muted" key={id}>
              Unavailable source: {id}
            </p>
          );
        })}
      </section>
    </FullscreenSection>
  );
}
