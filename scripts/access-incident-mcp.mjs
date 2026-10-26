import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
const dates=['2026-10-21','2026-10-22'];
const dateSchema={type:'string',enum:dates,description:'Illustrative incident day, in UTC.'};
const tools=[
  {name:'access_events',description:'Read illustrative file access and identity-sync events. Test data only, not a live audit system.',inputSchema:{type:'object',properties:{date:dateSchema},required:['date'],additionalProperties:false}},
  {name:'effective_access',description:'Read the illustrative user role, permissions, groups and file policy for doc-42. Test data only.',inputSchema:{type:'object',properties:{date:dateSchema},required:['date'],additionalProperties:false}},
  {name:'datadog_responses',description:'Query illustrative Datadog-shaped response counts. This fixture does not contact Datadog. Supply an explicit UTC time window.',inputSchema:{type:'object',properties:{from:{type:'string',format:'date-time'},to:{type:'string',format:'date-time'}},required:['from','to'],additionalProperties:false}},
].map(tool=>({...tool,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}}));
const stamp=(date,time)=>`${date}T${time}:00Z`;
export function incidentTool(name,args,datadog='ok'){
  if(!args||typeof args!=='object'||Array.isArray(args))return failure('Arguments must be an object.');
  const base={illustrative:true,system:'chista-access-test',file:'doc-42',email:'alex@example.com'};
  if(name==='access_events'||name==='effective_access'){
    if(Object.keys(args).some(key=>key!=='date')||!dates.includes(args.date))return failure('Choose 2026-10-21 or 2026-10-22; the fixture has no other dates.');
    const previous=args.date===dates[0];
    if(name==='effective_access')return success({...base,date:args.date,role:'Viewer',permissions:['file:read'],groups:previous?['Support','Finance Ops']:['Support'],requiredGroup:'Finance Ops',policy:'file:read AND Finance Ops membership',decision:previous?'allow':'deny'});
    return success({...base,date:args.date,events:previous?[
      {timestamp:stamp(args.date,'09:58'),event:'GET /files/doc-42',authentication:'succeeded',authorization:'allowed',status:200},
    ]:[
      {timestamp:stamp(args.date,'10:02'),event:'identity_sync',removedGroup:'Finance Ops'},
      {timestamp:stamp(args.date,'10:05'),event:'GET /files/doc-42',authentication:'succeeded',authorization:'required_group_missing',status:403},
      {timestamp:stamp(args.date,'10:10'),event:'GET /files/doc-42',authentication:'succeeded',authorization:'required_group_missing',status:403},
    ]});
  }
  if(name==='datadog_responses'){
    if(datadog==='denied')return failure('Illustrative test failure: permission denied for Datadog logs. No response counts were retrieved.');
    if(datadog==='unavailable')throw new Error('Illustrative test failure: Datadog transport unavailable.');
    const from=Date.parse(args.from),to=Date.parse(args.to);
    if(Object.keys(args).some(key=>!['from','to'].includes(key))||!Number.isFinite(from)||!Number.isFinite(to)||from>to||to-from>2*86400000||!String(args.from).endsWith('Z')||!String(args.to).endsWith('Z'))return failure('Use an ordered UTC window ending in Z, at most two days long.');
    const points=dates.flatMap((date,day)=>['09:55','10:00','10:05','10:10','10:15','10:20'].map((time,i)=>({timestamp:stamp(date,time),allowed:(day?[20,25,18,15,18,30]:[6,8,8,7,6,7])[i],denied:day?[0,0,3,7,4,0][i]:0}))).filter(point=>Date.parse(point.timestamp)>=from&&Date.parse(point.timestamp)<=to);
    if(!points.length)return failure('No illustrative evidence exists for this window. This fixture covers sample bins on October 21 and 22, 2026; no counts were retrieved.');
    return success({illustrative:true,system:'chista-access-test',service:'documents-api',scope:'Service-wide counts, not filtered to a particular user or file.',query:{from:args.from,to:args.to},points,totalAllowed:points.reduce((n,p)=>n+p.allowed,0),totalDenied:points.reduce((n,p)=>n+p.denied,0)});
  }
  return failure('Unknown tool.');
}
function success(value){return {content:[{type:'text',text:JSON.stringify(value)}],isError:false};}
function failure(message){return {content:[{type:'text',text:message}],isError:true};}
// Stateless Streamable HTTP fixture. JSON responses; no sampling, writes or credentials.
export function createIncidentServer({datadog='ok'}={}){
  if(!['ok','denied','unavailable'].includes(datadog))throw new Error('Unknown Datadog test scenario.');
  return createServer(async(req,res)=>{
    const host=String(req.headers.host??'');
    if(!/^127\.0\.0\.1:\d+$/.test(host)||req.headers.origin){res.writeHead(403).end();return;}
    if(req.url!=='/mcp'){res.writeHead(404).end();return;}
    if(req.method!=='POST'){res.writeHead(405,{Allow:'POST'}).end();return;}
    let id=null;
    const send=(payload,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(payload));};
    try{
      let body='';for await(const chunk of req){body+=chunk;if(body.length>64000){res.writeHead(413).end();return;}}
      let message;try{message=JSON.parse(body);}catch{send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}},400);return;}
      if(!message||Array.isArray(message)||message.jsonrpc!=='2.0'||typeof message.method!=='string'){send({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid request'}},400);return;}
      id=message.id??null;
      if(!('id' in message)){res.writeHead(202).end();return;}
      let result;
      switch(message.method){
        case 'initialize':result={protocolVersion:['2025-03-26','2025-06-18','2025-11-25'].includes(message.params?.protocolVersion)?message.params.protocolVersion:'2025-11-25',capabilities:{tools:{listChanged:false}},serverInfo:{name:'Chista illustrative access incident',version:'1.0.0'},instructions:'All results are illustrative test evidence. Never represent this server as production Datadog.'};break;
        case 'ping':result={};break;
        case 'tools/list':result={tools};break;
        case 'tools/call':result=incidentTool(message.params?.name,message.params?.arguments??{},datadog);break;
        default:send({jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}});return;
      }
      send({jsonrpc:'2.0',id,result});
    }catch{if(!res.headersSent)send({jsonrpc:'2.0',id,error:{code:-32603,message:'Illustrative test service unavailable'}});}
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const port=Number(process.env.CHISTA_TEST_MCP_PORT??4318);
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Use a port between 1024 and 65535.');
  const server=createIncidentServer({datadog:process.env.CHISTA_TEST_DATADOG??'ok'});
  server.on('error',error=>{console.error(error.message);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log(`Illustrative test MCP only · http://127.0.0.1:${port}/mcp · no Datadog connection`));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit()));
}
