import { ArrowRight, Check, ShieldCheck } from 'lucide-react';
import { EVIDENCE_STEPS, EVIDENCE_TABS, type EvidenceTab } from './navigationConfig';

export default function EvidenceNavigation({
  tab,
  hasFiles,
  onSelect,
}: {
  tab: EvidenceTab;
  hasFiles: boolean;
  onSelect: (tab: EvidenceTab) => void;
}) {
  return (
    <>
      {' '}
      <div className="safety-banner">
        <ShieldCheck size={21} />
        <div>
          <strong>A safer path from raw data to useful context</strong>
          <span>
            Redact locally, inspect the mapping, then give sanitized context to your agent.
          </span>
        </div>
        <span className="pill">Mapping stays local</span>
      </div>
      <div className="steps">
        {EVIDENCE_STEPS.map((step, index) => (
          <div key={step}>
            <span className={hasFiles && index === 0 ? 'done' : ''}>
              {hasFiles && index === 0 ? <Check size={13} /> : `0${index + 1}`}
            </span>
            {step}
            {index < EVIDENCE_STEPS.length - 1 && <ArrowRight size={15} />}
          </div>
        ))}
      </div>
      <div className="tabs">
        {EVIDENCE_TABS.map(({ name, icon: Icon }) => (
          <button
            key={name}
            className={tab === name ? 'active' : ''}
            onClick={() => onSelect(name)}
          >
            <Icon size={16} /> {name}
          </button>
        ))}
      </div>
    </>
  );
}
