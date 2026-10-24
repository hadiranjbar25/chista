import { createContext, useContext, useState } from 'react';
import { createLibrary, defineComponent, Renderer } from '@openuidev/react-lang';
import { z } from 'zod/v4';
const item = z.object({label:z.string().max(200),value:z.number().finite().nonnegative()});
export const responseSchema = z.object({text:z.string().max(40000),sessionTitle:z.string().trim().min(1).max(60).optional().catch(undefined),blocks:z.array(z.discriminatedUnion('type',[
  z.object({type:z.literal('chart'),title:z.string().max(200),items:z.array(item).max(30)}),
  z.object({type:z.literal('table'),title:z.string().max(200),columns:z.array(z.string().max(100)).min(1).max(8),rows:z.array(z.array(z.string().max(2000)).max(8)).max(100)}),
  z.object({type:z.literal('followups'),prompts:z.array(z.string().max(500)).max(5)}),
])).max(8)});
export type AgentReply = z.infer<typeof responseSchema>;
export const uiInstructions = `Respond with a JSON object {"text":"your answer","blocks":[]}. Write the top-level text field first so it can stream immediately, then write blocks. On your first response, also include a sessionTitle field: a concise 3–6 word name for this debugging session, at most 60 characters, based only on the sanitized conversation. Avoid personal identifiers and secrets in the title. Use blocks only when useful. Supported blocks: {"type":"chart","title":"...","items":[{"label":"...","value":1}]}, {"type":"table","title":"...","columns":["..."],"rows":[["..."]]}, {"type":"followups","prompts":["..."]}. Charts must use observed numeric evidence, never invented values. Max 8 blocks, 30 chart items, 100 table rows, 8 columns, 5 followups. Plain text is also accepted. Never emit HTML, JavaScript, tool calls or URLs for execution.`;
export function parseReply(content: string): AgentReply {
  try {return responseSchema.parse(JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g,'')));}
  catch {return {text:content,blocks:[]};}
}
const Follow = createContext<(prompt:string)=>void>(()=>{});
const Chart = defineComponent({name:'EvidenceChart',description:'Interactive bar chart of observed evidence',props:z.object({title:z.string(),items:z.array(item)}),component:({props})=>{
  const [selected,setSelected]=useState('');const max=Math.max(1,...props.items.map(i=>i.value));
  return <section className="response-widget"><h3>{props.title}</h3>{props.items.map((i,index)=><button key={index} className={'bar-row '+(selected===i.label?'chosen':'')} onClick={()=>setSelected(selected===i.label?'':i.label)}><span>{i.label}</span><div><i style={{width:`${i.value/max*100}%`}}/></div><b>{i.value}</b></button>)}{selected && <p className="muted">Selected: {selected}</p>}</section>;
}});
const Table = defineComponent({name:'EvidenceTable',description:'Searchable evidence table',props:z.object({title:z.string(),columns:z.array(z.string()),rows:z.array(z.array(z.string()))}),component:({props})=>{
  const [query,setQuery]=useState('');return <section className="response-widget"><div className="section-heading"><h3>{props.title}</h3><input aria-label={`Search ${props.title}`} placeholder="Filter rows…" value={query} onChange={e=>setQuery(e.target.value)}/></div><div className="event-table"><table><thead><tr>{props.columns.map((col,i)=><th key={i}>{col}</th>)}</tr></thead><tbody>{props.rows.filter(row=>row.join(' ').toLowerCase().includes(query.toLowerCase())).map((row,i)=><tr key={i}>{props.columns.map((_,j)=><td key={j}>{row[j]??''}</td>)}</tr>)}</tbody></table></div></section>;
}});
const Followups = defineComponent({name:'Followups',description:'Suggested next messages, never automatic actions',props:z.object({prompts:z.array(z.string())}),component:({props})=>{const follow=useContext(Follow);return <div className="followups">{props.prompts.map((prompt,i)=><button key={i} onClick={()=>follow(prompt)}>{prompt} ↗</button>)}</div>;}});
const Reply = defineComponent({name:'Reply',description:'Text and optional interactive evidence',props:z.object({text:z.string(),blocks:z.array(z.union([Chart.ref,Table.ref,Followups.ref]))}),component:({props,renderNode})=><div className="agent-reply"><p>{props.text}</p>{renderNode(props.blocks)}</div>});
export const responseLibrary=createLibrary({root:'Reply',components:[Reply,Chart,Table,Followups]});
export function replyProgram(reply:AgentReply) {
  const q=JSON.stringify;
  const blocks=reply.blocks.map(b=>b.type==='chart'?`EvidenceChart(${q(b.title)}, ${q(b.items)})`:b.type==='table'?`EvidenceTable(${q(b.title)}, ${q(b.columns)}, ${q(b.rows)})`:`Followups(${q(b.prompts)})`);
  return `root = Reply(${q(reply.text)}, [${blocks.join(', ')}])`;
}
export default function AgentResponse({content,onFollow}:{content:string;onFollow:(prompt:string)=>void}) {
  const reply=parseReply(content);const [failed,setFailed]=useState(false);
  return failed?<p>{reply.text}</p>:<Follow.Provider value={onFollow}><Renderer library={responseLibrary} response={replyProgram(reply)} isStreaming={false} onError={errors=>{if(errors.some(e=>e.severity!=='warning'))setFailed(true);}}/></Follow.Provider>;
}
