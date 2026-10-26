import {responseSchema, type AgentReply} from './AgentResponse';
import {streamingProse} from './integrations/claude';
export type EvidenceSource={id:string;title:string;content:string;kind:'artifact'|'mcp';truncated?:boolean};
export type ToolActivity={id:string;server:string;tool:string;state:'approval'|'running'|'completed'|'denied'|'failed'|'cancelled';sourceId?:string};
export function updateActivity(items:ToolActivity[],next:ToolActivity){
  const existing=items.find(item=>item.id===next.id);
  // Late events cannot revive a completed or cancelled operation.
  if(existing && ['completed','denied','failed','cancelled'].includes(existing.state))return items;
  return existing?items.map(item=>item.id===next.id?{...item,...next}:item):[...items,next];
}
export function contextEvidence(context:string|null):EvidenceSource[]{
  if(!context)return [];
  try{
    const parsed=JSON.parse(context);
    if(parsed.mode!=='sanitized-context'||!Array.isArray(parsed.artifacts))return [];
    return (parsed.artifacts as unknown[]).filter((a:unknown):a is {artifact:string;content:string;omittedCharacters:number}=>{
      if(!a||typeof a!=='object')return false;
      const item=a as Record<string,unknown>;
      return typeof item.artifact==='string'&&/^artifact-\d+\.(csv|tsv|json|log|txt)$/.test(item.artifact)&&typeof item.content==='string';
    }).slice(0,20).map(a=>({id:a.artifact,title:a.artifact,content:a.content,kind:'artifact',truncated:a.omittedCharacters>0}));
  }catch{return [];}
}
// Only complete, schema-validated blocks are published while JSON is arriving.
// Brackets inside strings and nested form fields must not terminate a block.
export function partialReply(raw:string):AgentReply{
  const text=streamingProse(raw),clean=raw.replace(/^```(?:json)?\s*/,'');
  const blocks:AgentReply['blocks']=[];
  let quoted=false,escaped=false,depth=0,blocksStart=-1;
  // Locate a top-level blocks property, not a quoted example in the prose.
  for(let i=0;i<clean.length;i++){
    const c=clean[i];
    if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
    if(c==='"'){
      if(depth===1){const match=/^"blocks"\s*:\s*\[/.exec(clean.slice(i));if(match){blocksStart=i+match[0].length;break;}}
      quoted=true;
    }else if(c==='{')depth++;else if(c==='}')depth--;
  }
  if(blocksStart<0)return {text,blocks};
  let start=-1;depth=0;quoted=false;escaped=false;
  for(let i=blocksStart;i<clean.length && blocks.length<8;i++){
    const c=clean[i];
    if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
    if(c==='"'){quoted=true;continue;}
    if(c==='{'||c==='['){if(depth===0)start=i;depth++;}
    else if(c==='}'||c===']'){
      if(depth===0)break;
      depth--;
      if(depth===0&&start>=0){
        try{const parsed=responseSchema.safeParse({text:'',blocks:[JSON.parse(clean.slice(start,i+1))]});if(parsed.success)blocks.push(parsed.data.blocks[0]);}catch{/* Incomplete/unsupported blocks never render. */}
        start=-1;
      }
    }
  }
  return {text,blocks};
}
