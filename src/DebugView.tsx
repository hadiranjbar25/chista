import { createContext, useContext, useState } from 'react';
import { createLibrary, defineComponent, Renderer } from '@openuidev/react-lang';
import { z } from 'zod/v4';
import type { Artifact } from './safety';
const FollowUp = createContext<(filter: string) => void>(() => {});
const DebugPanel = defineComponent({
  name: 'DebugPanel', description: 'Local sanitized evidence, interactive severity chart, searchable event table and follow-up controls.',
  props: z.object({ lines: z.array(z.string()) }),
  component: ({ props }) => {
    const [filter, setFilter] = useState('ALL'); const [query, setQuery] = useState('');
    const follow = useContext(FollowUp);
    const severity = (line: string) => /ERROR|\b50[0-9]\b/i.test(line) ? 'ERROR' : /WARN/i.test(line) ? 'WARN' : 'INFO';
    const visible = props.lines.filter(l => (filter === 'ALL' || severity(l) === filter) && l.toLowerCase().includes(query.toLowerCase()));
    return <><div className="insight"><span className="spark">✦</span><div><strong>Your evidence, ready to explore.</strong><p>Local pattern matching found {props.lines.filter(l => severity(l) === 'ERROR').length} error lines. Select a severity to inspect the supporting context. No AI diagnosis has been generated.</p></div></div><div className="chart-card"><div className="section-heading"><h3>Event distribution</h3><span className="eyebrow">CLICK TO FILTER</span></div><div className="bars">{['INFO','WARN','ERROR'].map(s => { const count = props.lines.filter(l => severity(l) === s).length; return <button className={'bar-row '+(filter === s ? 'chosen' : '')} key={s} onClick={() => setFilter(filter === s ? 'ALL' : s)}><span>{s}</span><div><i className={s.toLowerCase()} style={{width: `${Math.max(2,count/Math.max(1,props.lines.length)*100)}%`}} /></div><b>{count}</b></button>; })}</div></div><div className="section-heading"><h3>Sanitized evidence <span className="count">{visible.length}</span></h3><input aria-label="Search sanitized evidence" placeholder="Search evidence…" value={query} onChange={e => setQuery(e.target.value)} /></div><div className="event-table"><table><thead><tr><th>LEVEL</th><th>EVENT / CONTEXT</th></tr></thead><tbody>{visible.slice(0,100).map((line,i) => <tr key={i}><td><span className={'severity '+severity(line).toLowerCase()}>{severity(line)}</span></td><td>{line}</td></tr>)}</tbody></table>{!visible.length && <p className="empty">No matching evidence.</p>}</div><div className="followups"><span>Explore next</span><button onClick={() => { setFilter('ERROR'); follow('Showing error evidence. Select artifacts to include them in your context preview.'); }}>Inspect errors ↗</button><button onClick={() => { setFilter('ALL'); setQuery('latency'); follow('Filtered evidence for latency. Values are source observations, not an AI diagnosis.'); }}>Explore latency ↗</button><button onClick={() => { setFilter('ALL'); setQuery(''); }}>Reset filters ↺</button></div></>;
  },
});
export const debugLibrary = createLibrary({ root: 'DebugPanel', components: [DebugPanel] });
export default function DebugView({ files, onFollow }: {files: Artifact[]; onFollow: (s: string) => void}) {
  const lines = files.filter(f => f.selected).flatMap(f => f.safe.split('\n').filter(Boolean)).slice(0,500);
  return <FollowUp.Provider value={onFollow}><Renderer library={debugLibrary} response={`root = DebugPanel(${JSON.stringify(lines)})`} isStreaming={false}/><p className="muted">Rendered with OpenUI · deterministic local analysis · up to 500 lines</p></FollowUp.Provider>;
}
