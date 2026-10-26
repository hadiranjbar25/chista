import { useMemo, useState } from 'react';
import FullscreenSection from './FullscreenSection';
import { LockKeyhole } from 'lucide-react';
import type { Artifact, RedactionMapping } from './safety';
export function activeMappings(mappings: RedactionMapping[], files: Artifact[]) {
  // Count whole placeholder tokens: EMAIL_1 must not match EMAIL_10.
  const usage = new Map<string, { occurrences: number; artifacts: string[] }>();
  for (const file of files) {
    for (const token of file.safe.match(/\[[A-Z_]+_\d+\]/g) ?? []) {
      const entry = usage.get(token) ?? { occurrences: 0, artifacts: [] };
      entry.occurrences++;
      if (!entry.artifacts.includes(file.name)) entry.artifacts.push(file.name);
      usage.set(token,entry);
    }
  }
  return mappings.filter(m => usage.has(m.placeholder)).map(m => ({...m,...usage.get(m.placeholder)!}));
}
export default function RedactionMappings({mappings, files}: {mappings: RedactionMapping[]; files: Artifact[]}) {
  const [query,setQuery] = useState(''); const [hideOriginals,setHideOriginals] = useState(false);
  const rows = useMemo(() => activeMappings(mappings, files),[mappings,files]);
  const filtered = rows.filter(row => `${row.placeholder} ${row.original} ${row.artifacts.join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  return <FullscreenSection title="Redaction mappings" className="focus-panel"><section className="panel mapping-panel" aria-label="Local redaction mappings"><div className="section-heading"><h2>Redaction mappings <span className="count">{rows.length}</span></h2><span className="pill"><LockKeyhole size={12}/> On this device only</span></div><p>See which original value each placeholder represents across workspace artifacts and tool results. Your agent receives the placeholders and sanitized data; this mapping is never attached or exported.</p><div className="mapping-controls"><label className="field">Search mappings<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Original value, placeholder or artifact…"/></label><label className="check-label"><input type="checkbox" checked={hideOriginals} onChange={e => setHideOriginals(e.target.checked)}/> Hide original values</label></div><div className="mapping-table"><table><thead><tr><th scope="col">PLACEHOLDER · AGENT SEES</th><th scope="col">ORIGINAL · LOCAL ONLY</th><th scope="col">OCCURRENCES</th><th scope="col">ARTIFACTS</th></tr></thead><tbody>{filtered.map(row => <tr key={row.placeholder}><td><code>{row.placeholder}</code></td><td className="original-value">{hideOriginals ? '••••••••' : row.original}</td><td>{row.occurrences}</td><td>{row.artifacts.map(name => <div key={name}>{name}</div>)}</td></tr>)}</tbody></table></div>{!filtered.length && <p className="empty">{rows.length ? 'No matching mappings.' : 'No masked values in this session yet. Import artifacts or load a sample session.'}</p>}<p className="muted">Mappings cover current artifacts and sanitized MCP evidence, including artifacts not selected for context. Removing an artifact removes its unused entries from this view. Values remain in memory for consistent placeholders until the session closes.</p></section></FullscreenSection>;
}
