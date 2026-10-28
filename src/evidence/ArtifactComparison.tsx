import FullscreenSection from '../components/FullscreenSection';
import type { EvidenceController } from './useEvidenceSession';

export default function ArtifactComparison({ evidence }: { evidence: EvidenceController }) {
  const { files, left, right, pair, setPair } = evidence;
  return (
    <FullscreenSection title="Compare sanitized artifacts" className="focus-panel">
      <section className="panel">
        <div className="section-heading">
          <h2>Compare sanitized artifacts</h2>
          <span className="muted">Line-by-line comparison</span>
        </div>
        <div className="code-grid">
          {[0, 1].map((side) => {
            const file = side === 0 ? left : right;
            const other = side === 0 ? right : left;
            return (
              <FullscreenSection key={side} title={side === 0 ? 'Left artifact' : 'Right artifact'}>
                <select
                  aria-label={side === 0 ? 'Left artifact' : 'Right artifact'}
                  value={pair[side] ?? ''}
                  onChange={(e) =>
                    setPair((p) => {
                      const n = [...p];
                      n[side] = e.target.value;
                      return n;
                    })
                  }
                >
                  <option value="">Choose artifact</option>
                  {files.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <pre className="diff">
                  {file
                    ? file.safe.split('\n').map((line, i) => (
                        <div
                          key={i}
                          className={other && other.safe.split('\n')[i] !== line ? 'changed' : ''}
                        >
                          <span>{i + 1}</span>
                          {line || ' '}
                        </div>
                      ))
                    : 'Choose an artifact to compare.'}
                </pre>
              </FullscreenSection>
            );
          })}
        </div>
        <p className="muted">
          Highlighted lines differ at the same line position. Raw content is never used in this
          comparison.
        </p>
      </section>
    </FullscreenSection>
  );
}
