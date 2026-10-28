import {
  Activity,
  ArrowRight,
  FileCode2,
  FolderOpen,
  GitCompareArrows,
  LockKeyhole,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import FullscreenSection from '../components/FullscreenSection';
import type { EvidenceController } from './useEvidenceSession';

export default function ArtifactOverview({ evidence }: { evidence: EvidenceController }) {
  const { files, busy, importFiles, apply, total, selected, setTab, browseFiles, selectArtifact } =
    evidence;
  return (
    <>
      <div className="workspace-grid">
        <FullscreenSection title="Workspace files">
          <section>
            <div className="section-heading">
              <h2>
                Session artifacts <span className="count">{files.length}</span>
              </h2>
            </div>
            <button
              className="dropzone"
              disabled={busy}
              onClick={browseFiles}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void importFiles(e.dataTransfer.files);
              }}
            >
              <span className="upload-icon">
                <Upload size={25} />
              </span>
              <strong>{busy ? 'Sanitizing locally…' : 'Drop your files here'}</strong>
              <span>
                or <em>browse files</em> to start investigating
              </span>
              <small>CSV, TSV, JSON, LOG, TXT · up to 2 MB per file</small>
            </button>
            {files.length ? (
              <div className="artifact-list">
                {files.map((f) => (
                  <div className="artifact" key={f.id}>
                    <input
                      type="checkbox"
                      aria-label={`Include ${f.name}`}
                      checked={f.selected}
                      onChange={() =>
                        apply(
                          files.map((x) => (x.id === f.id ? { ...x, selected: !x.selected } : x)),
                        )
                      }
                    />
                    <span className="file-icon">
                      <FileCode2 size={21} />
                    </span>
                    <button className="artifact-name" onClick={() => selectArtifact(f.id)}>
                      <strong>{f.name}</strong>
                      <small>
                        {f.format.toUpperCase()} · {(new Blob([f.raw]).size / 1024).toFixed(1)} KB
                      </small>
                    </button>
                    <span className="redaction-count">
                      <ShieldCheck size={13} />
                      {f.redactions} redactions
                    </span>
                    <button
                      className="icon-button"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => apply(files.filter((x) => x.id !== f.id))}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-artifacts">
                <FolderOpen size={22} />
                <div>
                  <strong>A clean slate for your next investigation</strong>
                  <p>Import logs, CSV, TSV or JSON to review and sanitize your evidence.</p>
                </div>
              </div>
            )}
            <div className="section-heading next-heading">
              <h2>From files to focused context</h2>
            </div>
            <div className="feature-grid">
              <div>
                <ShieldCheck size={20} />
                <h3>Redact with confidence</h3>
                <p>Consistent placeholders keep relationships intact across artifacts.</p>
              </div>
              <div>
                <GitCompareArrows size={20} />
                <h3>Connect the evidence</h3>
                <p>Compare sanitized files and explore patterns with interactive views.</p>
              </div>
            </div>
          </section>
        </FullscreenSection>
        <aside className="session-card">
          <div className="section-heading">
            <h2>Session snapshot</h2>
            <Activity size={17} />
          </div>
          <div className="stat">
            <span>Imported artifacts</span>
            <strong>{files.length.toString().padStart(2, '0')}</strong>
          </div>
          <div className="stat">
            <span>Redactions applied</span>
            <strong className="purple">{total.toString().padStart(2, '0')}</strong>
          </div>
          <div className="stat">
            <span>Selected for context</span>
            <strong>{selected.length.toString().padStart(2, '0')}</strong>
          </div>
          <div className="local-note">
            <LockKeyhole size={16} />
            <div>
              <strong>On-device sanitization</strong>
              <p>Emails, IPs, secrets and sensitive fields are replaced locally.</p>
            </div>
          </div>
          <p className="review-note">
            Pattern detection can miss sensitive data. Always review before exporting.
          </p>
          <button
            className="primary full"
            disabled={!files.length}
            onClick={() => setTab('Redaction review')}
          >
            Review redactions <ArrowRight size={16} />
          </button>
        </aside>
      </div>
    </>
  );
}
