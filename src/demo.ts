import Papa from 'papaparse';
import { compact, samples, Sanitizer, sanitizeArtifacts, type Artifact } from './safety';
import type { AgentReply } from './AgentResponse';
export const demoQuestion = 'Checkout started failing around 09:42. What does the evidence show, and what should I check next?';
export function demoArtifacts(sanitizer = new Sanitizer()): Artifact[] {
  return sanitizeArtifacts(samples.map((file,index)=>({...file,id:`demo-${index}`,safe:'',redactions:0,selected:true})),sanitizer,[]);
}
export function demoContext() { return compact(demoArtifacts(),12000); }
export function buildDemoReply(prompt: string, context: string | null): string {
  let artifacts: {artifact:string;content:string}[]=[];
  try { const parsed=JSON.parse(context??'{}');if(Array.isArray(parsed.artifacts))artifacts=parsed.artifacts.filter((a:unknown):a is {artifact:string;content:string}=>!!a && typeof a==='object' && 'content' in a && typeof a.content==='string' && 'artifact' in a && typeof a.artifact==='string'); } catch { /* no context */ }
  const lines=artifacts.flatMap(a=>a.content.split('\n')).filter(Boolean);
  const rows=artifacts.filter(a=>a.artifact.endsWith('.csv')).flatMap(a=>Papa.parse<Record<string,string>>(a.content,{header:true,skipEmptyLines:true}).data).filter(r=>r.status && r.latency_ms && Number.isFinite(Number(r.latency_ms)));
  let timeout=0;
  for(const artifact of artifacts.filter(a=>a.artifact.endsWith('.json'))) {try{const config=JSON.parse(artifact.content);if(typeof config.timeout_ms==='number')timeout=config.timeout_ms;}catch{/* excerpt may be truncated */}}
  const errors=rows.filter(r=>Number(r.status)>=500);const latency=rows.map(r=>Number(r.latency_ms));
  const rich=rows.length>0 && timeout>0;
  const paymentEvidence=lines.some(line=>/payment timeout/i.test(line));
  const intro='Demo response — no model was contacted. Findings below are calculated from the sanitized artifacts; suggested causes still need verification.';
  let text=intro;const blocks:AgentReply['blocks']=[];
  const q=prompt.toLowerCase();
  if(rich) {
    const fraction=Math.round(errors.length/rows.length*100);
    const over=errors.filter(r=>Number(r.latency_ms)>timeout).length;
    if(/next|fix|check|debug|failing|investigat/.test(q)) {
      text+=`\n\nFinding: ${errors.length} of ${rows.length} sampled requests failed (${fraction}%). The highest recorded latency is ${Math.max(...latency).toLocaleString('en-US')} ms; the configured timeout is ${timeout.toLocaleString('en-US')} ms. ${over} failed request(s) exceeded that timeout.\n\nWorking hypothesis: ${paymentEvidence?'the upstream payment service is taking longer than the checkout timeout allows. The logs report a payment timeout':'some requests are exceeding the configured timeout'}. These files do not establish the underlying cause.\n\nNext checks:\n1. ${paymentEvidence?'Inspect payment-service traces around the reported timeout':'Inspect upstream traces around the failed requests'} and correlate the masked identities.\n2. Check upstream saturation, network latency and the retry policy.\n3. Reproduce in staging before changing timeouts; confirm retries cannot duplicate payments.`;
    } else if(/latency|slow|timeout/.test(q)) {
      text+=`\n\nLatency breakdown: ${latency.filter(v=>v>timeout).length} of ${rows.length} sampled requests exceed the ${timeout.toLocaleString('en-US')} ms timeout. The slowest request took ${Math.max(...latency).toLocaleString('en-US')} ms. This is consistent with timeout failures, but does not establish their underlying cause.`;
    } else if(/table|evidence|request/.test(q)) {
      text+='\n\nHere are the sampled requests. Compare the HTTP status with latency and the configured timeout. Repeated placeholders represent the same original identity across files.';
    } else {
      text+=`\n\nI can explore this sample’s request failures, latency and next checks. The sample contains ${errors.length} failed requests out of ${rows.length}. Use the follow-up controls to inspect those observations. This demo does not answer arbitrary questions like a connected model.`;
    }
    blocks.push({type:'chart',title:'Request latency vs timeout (ms)',items:[...rows.slice(0,10).map((r,i)=>({label:`${r.time} · ${r.status} · #${i+1}`,value:Number(r.latency_ms)})),{label:'Configured timeout',value:timeout}]});
    blocks.push({type:'table',title:'Request evidence',columns:['Time','HTTP status','Latency (ms)','Masked identity','Timeout'],rows:rows.slice(0,30).map(r=>[r.time,r.status,r.latency_ms,r.email??'',Number(r.latency_ms)>timeout?'Exceeded':'Within limit'])});
    blocks.push({type:'followups',prompts:['Show the latency breakdown','Show the requests as a table','What should I check next?']});
  } else if(lines.length) {
    text+='\n\nHere is the evidence available in your reviewed context. There is not enough structured request and timeout data for the sample diagnosis; no root cause is assumed.';
    if(!/table|list/.test(q))blocks.push({type:'chart',title:'Log levels in reviewed context',items:['ERROR','WARN','INFO'].map(label=>({label,value:lines.filter(line=>new RegExp(`\\b${label}\\b`,'i').test(line)).length}))});
    blocks.push({type:'table',title:'Reviewed evidence',columns:['Line','Sanitized content'],rows:lines.slice(0,12).map((line,i)=>[String(i+1),line])});
    blocks.push({type:'followups',prompts:['Show the evidence as a table','What should I check next?']});
  } else {
    text+='\n\nTry “Debug this issue” in a new session for a complete checkout incident, or add and review your own files. Configure a hosted provider in Settings for real AI answers.';
    blocks.push({type:'followups',prompts:['How do I add debug context?','What can you help me investigate?']});
  }
  return JSON.stringify({text,blocks} satisfies AgentReply);
}
