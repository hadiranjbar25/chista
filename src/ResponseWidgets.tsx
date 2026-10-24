import { useId, useState } from 'react';
import { z } from 'zod/v4';

const title = z.string().trim().min(1).max(200);
export const formField = z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/).refine(id=>!['constructor','prototype'].includes(id)), label: title,
  type: z.enum(['text','number','select','multiselect','radio','checkbox','date','time']),
  required: z.boolean().optional(), options: z.array(title).min(1).max(30).optional(),
  min: z.number().finite().optional(), max: z.number().finite().optional(),
}).refine(field => !['select','multiselect','radio'].includes(field.type) || Boolean(field.options?.length), 'Choice fields need options.')
  .refine(field => field.min === undefined || field.max === undefined || field.min <= field.max, 'Invalid numeric bounds.')
  .refine(field => !field.options || new Set(field.options).size === field.options.length, 'Options must be unique.');
export const formBlock = z.object({type:z.literal('form'),title,fields:z.array(formField).min(1).max(10),submitLabel:z.string().min(1).max(60).optional()})
  .refine(form => new Set(form.fields.map(field=>field.id)).size===form.fields.length, 'Field IDs must be unique.');
export const codeBlock = z.object({type:z.literal('code'),title,language:z.string().max(40).optional(),content:z.string().max(20000)});
export const jsonBlock = z.object({type:z.literal('json'),title,content:z.string().max(20000).refine(content=>{try{JSON.parse(content);return true;}catch{return false;}},'Expected JSON text.')});
export type FormField = z.infer<typeof formField>;
type Value = string | string[] | boolean;
export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date=new Date(value+'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10)===value;
}
function validField(field: FormField, value: Value | undefined) {
  if (field.type==='checkbox') return !field.required || value===true;
  if (field.type==='multiselect') return Array.isArray(value) ? (!field.required || value.length>0) && value.every(item=>field.options?.includes(item)) : !field.required;
  const text=typeof value==='string'?value.trim():'';
  if(!text) return !field.required;
  if(field.type==='number') return Number.isFinite(Number(text)) && (field.min===undefined || Number(text)>=field.min) && (field.max===undefined || Number(text)<=field.max);
  if(field.type==='date') return validDate(text);
  if(field.type==='time') return /^([01]\d|2[0-3]):[0-5]\d$/.test(text);
  if(['select','radio'].includes(field.type)) return Boolean(field.options?.includes(text));
  return true;
}
export function ResponseForm({title,fields,submitLabel,onSubmit}:{title:string;fields:FormField[];submitLabel:string;onSubmit:(text:string)=>void}) {
  const formId=useId();
  const [values,setValues]=useState<Record<string,Value>>(()=>Object.create(null));
  const set=(id:string,value:Value)=>setValues(previous=>Object.assign(Object.create(null),previous,{[id]:value}));
  const valid=fields.every(field=>validField(field,values[field.id]));
  return <form className="response-widget generated-form" onSubmit={event=>{
    event.preventDefault();if(!valid)return;
    onSubmit(title+'\n'+fields.map(field=>{
      const value=values[field.id];
      return `${field.label}: ${field.type==='checkbox'?(value?'Yes':'No'):Array.isArray(value)?value.join(', '):value || 'Not specified'}`;
    }).join('\n'));
  }}><h3>{title}</h3>{fields.map(field=>{
    const label=field.label+(field.required?' *':'');
    if(field.type==='checkbox')return <label className="generated-check" key={field.id}><input type="checkbox" checked={values[field.id]===true} onChange={event=>set(field.id,event.target.checked)}/>{label}</label>;
    if(field.type==='radio')return <fieldset key={field.id}><legend>{label}</legend>{field.options!.map(option=><label className="generated-check" key={option}><input type="radio" name={`${formId}-${field.id}`} checked={values[field.id]===option} onChange={()=>set(field.id,option)}/>{option}</label>)}</fieldset>;
    return <label className="generated-field" key={field.id}><span>{label}</span>{field.type==='select' || field.type==='multiselect'?<select multiple={field.type==='multiselect'} value={values[field.id] as string | string[] ?? (field.type==='multiselect'?[]:'')} onChange={event=>set(field.id,field.type==='multiselect'?Array.from(event.target.selectedOptions,option=>option.value):event.target.value)}>{field.type==='select' && <option value="">Choose…</option>}{field.options!.map(option=><option key={option}>{option}</option>)}</select>:<input type={field.type} value={String(values[field.id]??'')} maxLength={4000} min={field.type==='number'?field.min:undefined} max={field.type==='number'?field.max:undefined} step={field.type==='number'?'any':undefined} onChange={event=>set(field.id,event.target.value)}/>}</label>;
  })}<button type="submit" disabled={!valid}>{submitLabel}</button><p className="muted">Prepares a message for you to review and send. * Required</p></form>;
}
export function DateRange({title,submitLabel,onSubmit}:{title:string;submitLabel:string;onSubmit:(text:string)=>void}) {
  const [start,setStart]=useState('');const [end,setEnd]=useState('');
  const valid=validDate(start)&&validDate(end)&&start<=end;
  return <form className="response-widget generated-form" onSubmit={event=>{event.preventDefault();if(valid)onSubmit(`${title}: ${start} to ${end}`);}}><h3>{title}</h3><div className="date-range-fields"><label className="generated-field">Start date<input type="date" value={start} max={end||undefined} onChange={event=>setStart(event.target.value)}/></label><label className="generated-field">End date<input type="date" value={end} min={start||undefined} onChange={event=>setEnd(event.target.value)}/></label></div>{start && end && start>end && <p role="alert">End date must be on or after start date.</p>}<button type="submit" disabled={!valid}>{submitLabel}</button><p className="muted">Adds this range to the composer without sending.</p></form>;
}
export function CodeViewer({title,language,content}:{title:string;language:string;content:string}) {
  const [copied,setCopied]=useState('');
  return <section className="response-widget code-viewer"><div className="action-row"><h3>{title}</h3>{language && <span className="pill">{language}</span>}<button type="button" onClick={async()=>{try{await navigator.clipboard.writeText(content);setCopied('Copied');}catch{setCopied('Select the text to copy.');}}}>Copy</button><span role="status">{copied}</span></div><pre><code>{content}</code></pre></section>;
}
