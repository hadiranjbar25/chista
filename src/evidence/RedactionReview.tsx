import { ShieldCheck } from 'lucide-react';
import FullscreenSection from '../components/FullscreenSection';
import type { EvidenceController } from './useEvidenceSession';

export default function RedactionReview({ evidence }: { evidence: EvidenceController }) {
  const { current, files, setActive, setRaw, terms, setTerms, apply, setNotice, raw } = evidence;
  return (
    <FullscreenSection title="Review redactions" className="focus-panel">
      <section className="panel">
        <div className="section-heading">
          <h2>Review redactions</h2>
          <select
            aria-label="Artifact to review"
            value={current?.id ?? ''}
            onChange={(e) => {
              setActive(e.target.value);
              setRaw(false);
            }}
          >
            {files.map((f) => (
              <option value={f.id} key={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div className="rules">
          <label>
            Additional sensitive values <span>One exact value per line; applied to all files.</span>
            <textarea
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              placeholder="Internal hostname, customer name…"
            />
          </label>
          <button
            className="secondary"
            onClick={() => {
              apply(files);
              setNotice('Custom redactions applied across the session.');
            }}
          >
            Apply redactions
          </button>
        </div>
        {current ? (
          <>
            <div className="section-heading">
              <span className="redaction-count">
                <ShieldCheck size={14} />
                {current.redactions} replacements · consistent across files
              </span>
              <label className="check-label">
                <input type="checkbox" checked={raw} onChange={(e) => setRaw(e.target.checked)} />{' '}
                Show original locally
              </label>
            </div>
            <div className={raw ? 'code-grid' : ''}>
              {raw && (
                <FullscreenSection title="Original file · local only">
                  <div>
                    <h3>Original · sensitive · local only</h3>
                    <pre>{current.raw}</pre>
                  </div>
                </FullscreenSection>
              )}
              <FullscreenSection title="Sanitized preview">
                <div>
                  <h3>Sanitized preview</h3>
                  <pre>{current.safe}</pre>
                </div>
              </FullscreenSection>
            </div>
          </>
        ) : (
          <p className="empty">Import an artifact to review its redactions.</p>
        )}
      </section>
    </FullscreenSection>
  );
}
