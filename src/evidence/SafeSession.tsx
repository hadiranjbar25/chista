import { X } from 'lucide-react';
import { useEvidenceSession } from './useEvidenceSession';
import type { SafeSessionProps } from './evidenceTypes';
import ArtifactOverview from './ArtifactOverview';
import RedactionReview from './RedactionReview';
import ArtifactComparison from './ArtifactComparison';
import EvidenceNavigation from './EvidenceNavigation';
import ContextExport from './ContextExport';
import ContextPreview from './ContextPreview';
import RedactionMappings from './RedactionMappings';
import DebugView from './DebugView';
import FullscreenSection from '../components/FullscreenSection';
import { ARTIFACT_FILE_ACCEPT } from './artifactConfig';
export type { SafeSessionHandle } from './evidenceTypes';

export default function SafeSession(props: SafeSessionProps) {
  const evidence = useEvidenceSession(props);
  const { files, tab, error, notice } = evidence;
  const extraEvidence = props.extraEvidence ?? [];
  return (
    <div className="app">
      <div className="main-shell">
        <main>
          <EvidenceNavigation
            tab={tab}
            hasFiles={files.length > 0}
            onSelect={(value) => {
              evidence.setTab(value);
              evidence.setRaw(false);
            }}
          />
          {error && (
            <div role="alert" className="error">
              {error}
              <button onClick={() => evidence.setError('')} aria-label="Dismiss error">
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="notice">
              {notice}
              <button onClick={() => evidence.setNotice('')} aria-label="Dismiss notice">
                <X size={14} />
              </button>
            </div>
          )}

          {tab === 'Overview' && <ArtifactOverview evidence={evidence} />}
          {tab === 'Redaction review' && <RedactionReview evidence={evidence} />}
          {tab === 'Compare artifacts' && <ArtifactComparison evidence={evidence} />}
          {tab === 'Mappings' && (
            <RedactionMappings
              mappings={evidence.sanitizer.current.mappings()}
              files={[
                ...files,
                ...extraEvidence.map((source) => ({
                  id: source.id,
                  name: source.title,
                  format: 'json',
                  raw: '',
                  safe: source.content,
                  redactions: 0,
                  selected: false,
                })),
              ]}
            />
          )}
          {tab === 'Debug workspace' && (
            <FullscreenSection title="Debug workspace" className="focus-panel">
              <section className="panel">
                <div className="section-heading">
                  <h2>Debug workspace</h2>
                  <span className="pill">OpenUI · sanitized evidence</span>
                </div>
                {evidence.selected.length ? (
                  <DebugView files={files} onFollow={evidence.setNotice} />
                ) : (
                  <p className="empty">
                    Select artifacts in Overview to explore sanitized evidence.
                  </p>
                )}
              </section>
            </FullscreenSection>
          )}

          <ContextExport
            selectedCount={evidence.selected.length}
            prepareContext={evidence.prepareContext}
          />
        </main>
      </div>
      <input
        aria-label="Import debug files"
        ref={evidence.input}
        type="file"
        multiple
        accept={ARTIFACT_FILE_ACCEPT}
        hidden
        onChange={(e) => {
          const attach = evidence.chatPicker.current;
          evidence.chatPicker.current = false;
          if (e.target.files?.length) {
            evidence.setTab('Overview');
            void evidence.importFiles(e.target.files, attach);
          }
        }}
      />
      <ContextPreview evidence={evidence} />
    </div>
  );
}
