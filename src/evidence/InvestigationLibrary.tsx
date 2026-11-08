import { useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { z } from 'zod/v4';
import type { EvidenceController } from './useEvidenceSession';
import type { EvidenceSource } from './investigation';
import {
  investigationBundle,
  sealInvestigation,
  openInvestigation,
  downloadFile,
} from './investigationVault';

const EMPTY_CONVERSATIONS: import('../integrations/providers').Message[][] = [];
const auditSchema = z
  .array(
    z
      .object({
        sequence: z.number().int().positive(),
        time: z.number().nonnegative(),
        kind: z.enum(['agent', 'http', 'mcp']),
        state: z.string().max(50),
      })
      .strict(),
  )
  .max(2000);
export default function InvestigationLibrary({
  evidence,
  sources,
  workspaceId,
  conversations = EMPTY_CONVERSATIONS,
}: {
  evidence: EvidenceController;
  sources: EvidenceSource[];
  workspaceId?: string;
  conversations?: import('../integrations/providers').Message[][];
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [audit, setAudit] = useState<z.infer<typeof auditSchema>>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);
  useEffect(() => {
    setPreview(null);
    setApproved(false);
  }, [evidence.files, evidence.terms, sources, conversations, audit]);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setNotice('');
    try {
      await action();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Investigation operation failed.');
    } finally {
      setBusy(false);
      setPassword('');
    }
  }
  async function history() {
    if (!isTauri()) {
      setNotice('Audit history requires the desktop app.');
      return;
    }
    setAudit(
      auditSchema.parse(await invoke('read_audit_history', { workspaceId: workspaceId ?? '' })),
    );
  }
  function bundle() {
    return investigationBundle(
      evidence.files,
      sources,
      evidence.sanitizer.current,
      audit,
      conversations,
    );
  }
  return (
    <section className="panel">
      <h2>Saved investigations & sharing</h2>
      <p>
        Save a sanitized investigation or reusable redaction profile as an encrypted file you
        control. Keep the passphrase separately; Chista cannot recover it. Raw artifacts and
        reversal mappings are excluded. Profiles contain your exact custom values and stay
        encrypted.
      </p>
      <label className="field">
        File passphrase · at least 12 characters
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <div className="action-row">
        <button
          disabled={busy || password.length < 12}
          onClick={() =>
            void run(async () => {
              const encrypted = await sealInvestigation(
                { kind: 'investigation', version: 1, context: bundle() },
                password,
              );
              downloadFile(encrypted, 'investigation.chista');
              setNotice('Encrypted investigation saved. Nothing was uploaded.');
            })
          }
        >
          Save encrypted investigation
        </button>
        <button
          disabled={busy || password.length < 12}
          onClick={() =>
            void run(async () => {
              const encrypted = await sealInvestigation(
                {
                  kind: 'redaction-profile',
                  version: 1,
                  terms: evidence.terms
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean),
                },
                password,
              );
              downloadFile(encrypted, 'redaction-profile.chista');
              setNotice('Encrypted redaction profile saved.');
            })
          }
        >
          Save encrypted profile
        </button>
        <label className="field">
          Open encrypted investigation or profile
          <input
            type="file"
            accept=".chista"
            disabled={busy || password.length < 12}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              void run(async () => {
                if (file.size > 1_600_000)
                  throw new Error('Encrypted file exceeds the import limit.');
                const saved = await openInvestigation(await file.text(), password);
                if (saved.kind === 'redaction-profile') {
                  const terms = saved.terms.join('\n');
                  evidence.setTerms(terms);
                  evidence.apply(evidence.files, terms);
                  setNotice(
                    'Profile applied locally to this workspace. Review the updated redactions.',
                  );
                } else {
                  // Decrypted data remains untrusted. Re-sanitize before preview; attaching still needs review.
                  const safe = evidence.sanitizer.current.sanitize(saved.context, 'json', []);
                  if (evidence.files.length >= 20)
                    throw new Error('Remove an artifact before opening another investigation.');
                  evidence.apply([
                    ...evidence.files,
                    {
                      id: crypto.randomUUID(),
                      name: 'Saved investigation',
                      format: 'json',
                      raw: safe,
                      safe: '',
                      redactions: 0,
                      selected: true,
                    },
                  ]);
                  setNotice(
                    'Investigation reopened as local evidence. Review and prepare context before attaching to chat.',
                  );
                }
              });
            }}
          />
        </label>
        <button
          disabled={busy}
          onClick={() => {
            setPreview(bundle());
            setApproved(false);
          }}
        >
          Preview sanitized share bundle
        </button>
      </div>
      {preview !== null && (
        <section role="dialog" aria-label="Review investigation bundle" aria-modal="false">
          <h3>
            Outbound data preview · {new TextEncoder().encode(preview).length.toLocaleString()}{' '}
            bytes
          </h3>
          <p>
            This exact JSON will be downloaded for manual sharing. No upload or public link is
            created. Check for secrets missed by automatic redaction.
          </p>
          <pre>{preview}</pre>
          <label>
            <input
              type="checkbox"
              checked={approved}
              onChange={(e) => setApproved(e.target.checked)}
            />{' '}
            I reviewed this exact payload for sensitive data.
          </label>
          <button
            disabled={!approved}
            onClick={() => {
              downloadFile(preview, 'sanitized-investigation.json');
              setPreview(null);
            }}
          >
            Export sanitized bundle
          </button>
          <button onClick={() => setPreview(null)}>Close bundle preview</button>
        </section>
      )}
      <details>
        <summary>Read-only action audit history</summary>
        <p>
          Native agent, HTTP and MCP approval/result events for this workspace. The latest 2,000
          records stay in memory for this app run. No prompts, credentials, arguments or result
          bodies are recorded. Refresh before saving or exporting to include the current history.
        </p>
        <button disabled={busy} onClick={() => void run(history)}>
          Refresh audit history
        </button>
        <table>
          <thead>
            <tr>
              <th>Sequence</th>
              <th>Time</th>
              <th>Action</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((row) => (
              <tr key={row.sequence}>
                <td>{row.sequence}</td>
                <td>{new Date(row.time).toLocaleString()}</td>
                <td>{row.kind}</td>
                <td>{row.state}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
