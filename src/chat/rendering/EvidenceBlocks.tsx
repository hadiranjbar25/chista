import { useState } from 'react';
import { defineComponent } from '@openuidev/react-lang';
import { z } from 'zod/v4';
import FullscreenSection from '../../components/FullscreenSection';
import { chartItem } from '../response';

export const Chart = defineComponent({
  name: 'EvidenceChart',
  description: 'Interactive bar chart of observed evidence',
  props: z.object({ title: z.string(), items: z.array(chartItem) }),
  component: ({ props }) => {
    const [selected, setSelected] = useState('');
    const max = Math.max(1, ...props.items.map((i) => i.value));
    return (
      <FullscreenSection title={props.title} className="focus-widget">
        <section className="response-widget">
          <h3>{props.title}</h3>
          {props.items.map((i, index) => (
            <button
              key={index}
              className={'bar-row ' + (selected === i.label ? 'chosen' : '')}
              onClick={() => setSelected(selected === i.label ? '' : i.label)}
            >
              <span>{i.label}</span>
              <div>
                <i style={{ width: `${(i.value / max) * 100}%` }} />
              </div>
              <b>{i.value}</b>
            </button>
          ))}
          {selected && <p className="muted">Selected: {selected}</p>}
        </section>
      </FullscreenSection>
    );
  },
});
export const Table = defineComponent({
  name: 'EvidenceTable',
  description: 'Searchable evidence table',
  props: z.object({
    title: z.string(),
    columns: z.array(z.string()),
    rows: z.array(z.array(z.string())),
  }),
  component: ({ props }) => {
    const [query, setQuery] = useState('');
    return (
      <FullscreenSection title={props.title} className="focus-widget">
        <section className="response-widget">
          <div className="section-heading">
            <h3>{props.title}</h3>
            <input
              aria-label={`Search ${props.title}`}
              placeholder="Filter rows…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="event-table">
            <table>
              <thead>
                <tr>
                  {props.columns.map((col, i) => (
                    <th key={i}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {props.rows
                  .filter((row) => row.join(' ').toLowerCase().includes(query.toLowerCase()))
                  .map((row, i) => (
                    <tr key={i}>
                      {props.columns.map((_, j) => (
                        <td key={j}>{row[j] ?? ''}</td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      </FullscreenSection>
    );
  },
});
