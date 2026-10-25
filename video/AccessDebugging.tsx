import type {CSSProperties,ReactNode} from 'react';
import {AbsoluteFill,Easing,interpolate,useCurrentFrame} from 'remotion';
import {Activity,ArrowUp,Check,CheckCircle2,ChevronDown,ChevronLeft,ChevronRight,FileText,FolderOpen,LoaderCircle,LockKeyhole,MousePointer2,Plus,Search,Settings,ShieldCheck} from 'lucide-react';
import AgentResponse from '../src/AgentResponse';
import {beats,chapters,cueAt,deniedRequests,duration,incident,replies,seconds} from './incident';
import '../src/styles.css';
import '../src/workspace.css';
import './video.css';
const clamp={extrapolateLeft:'clamp',extrapolateRight:'clamp'} as const;
const ease=Easing.bezier(.22,1,.36,1);
const transition=30;
const [intro,question,logs,roles,datadog,finding,date,ending]=chapters;
function progress(frame:number,start:number,span=24){return interpolate(frame,[start,start+span],[0,1],{...clamp,easing:ease});}
function reveal(frame:number,start:number,span=24):CSSProperties {
  const value=progress(frame,start,span);
  return {opacity:value,transform:`translateY(${(1-value)*14}px)`};
}
// Adjacent scenes overlap for one second. The window, composer and progress
// trail remain in place while the conversation advances to the next result.
function Scene({frame,start,end,children}:{frame:number;start:number;end:number;children:ReactNode}){
  if(frame<start || frame>=end+transition)return null;
  const entering=progress(frame,start,transition),leaving=progress(frame,end,transition);
  return <div className="film-scene-layer" style={{opacity:entering*(1-leaving),transform:`translateY(${(1-entering)*24-leaving*24}px)`}}>{children}</div>;
}
function Pending({frame,start,end,text}:{frame:number;start:number;end:number;text:string}){
  if(frame<start || frame>end+20)return null;
  return <div className="film-pending" style={{opacity:progress(frame,start,18)*(1-progress(frame,end,20))}}><LoaderCircle size={22} style={{transform:`rotate(${frame*5}deg)`}}/><div><strong>{text}</strong><span>Following the evidence, one step at a time</span></div></div>;
}
function UI({name,frame,start=0}:{name:keyof typeof replies;frame:number;start?:number}){
  const chartStart=name==='errors'?beats.errorsChart:beats.outcomesChart;
  return <div className={`video-ui video-ui-${name}`} style={{...reveal(frame,start,28),'--chart-progress':progress(frame,chartStart,42)} as CSSProperties}><AgentResponse content={JSON.stringify(replies[name])} onFollow={()=>{}}/></div>;
}
function Cursor({frame,points,end}:{frame:number;points:{at:number;x:number;y:number;click?:boolean}[];end:number}){
  const next=points.findIndex(point=>point.at>frame);
  const a=next===-1?points[points.length-1]:points[Math.max(0,next-1)];
  const b=next===-1?a:points[next];
  const value=a===b?1:progress(frame,a.at,b.at-a.at);
  const clicked=points.find(point=>point.click && frame>=point.at && frame<point.at+24);
  const pulse=clicked?(frame-clicked.at)/24:0;
  return <div className="film-cursor" style={{left:a.x+(b.x-a.x)*value,top:a.y+(b.y-a.y)*value,opacity:progress(frame,points[0].at,12)*(1-progress(frame,end-18,18))}}>{clicked && <div className="cursor-pulse" style={{opacity:1-pulse,transform:`translate(-50%,-50%) scale(${.3+pulse})`}}/>}<MousePointer2 size={29} fill="#342443" stroke="white" strokeWidth={1.6}/></div>;
}
function rowStyles(frame:number,name:string,rows:number[]){
  return rows.map((at,index)=>{
    const value=progress(frame,at,24);
    const focus=interpolate(frame,[at,at+18,at+55,at+95],[0,.12,.12,0],clamp);
    const color=name==='roles'&&index>=2?'190,122,153':'149,117,181';
    return `.video-ui-${name} tbody tr:nth-child(${index+1}){opacity:${value};transform:translateY(${(1-value)*7}px);background:rgba(${color},${focus});}`;
  }).join('\n');
}
function Trail({frame}:{frame:number}){
  if(frame<logs.start)return null;
  const steps=[{label:'Access logs',start:logs.start,done:beats.logFinding+30},{label:'Roles & policy',start:roles.start,done:beats.roleFinding+30},{label:'Datadog',start:datadog.start,done:beats.outcomesChart+60}];
  return <div className="film-trail" style={reveal(frame,logs.start)}>{steps.map((step,index)=><div key={step.label} className={frame>=step.done?'complete':frame>=step.start?'active':''}><span>{frame>=step.done?<Check size={11}/>:index+1}</span>{step.label}{index<steps.length-1&&<ChevronRight size={11}/>}</div>)}</div>;
}
function DateScene({frame}:{frame:number}){
  const open=frame>=beats.calendarOpen && frame<beats.calendarClose+18;
  const selected=frame>=beats.dateSelect;
  return <div className="film-date">
    <div className="film-assistant"><span>✳</span> CHISTA</div>
    <UI name="date" frame={frame} start={date.start+18}/>
    {selected && <span className="date-value">Oct 21, 2026</span>}
    {open && <div className="film-calendar" style={{...reveal(frame,beats.calendarOpen,18),opacity:progress(frame,beats.calendarOpen,18)*(1-progress(frame,beats.calendarClose,18))}}>
      <div><ChevronLeft size={18}/><strong>October 2026</strong><ChevronRight size={18}/></div>
      <div className="calendar-grid">{['M','T','W','T','F','S','S'].map((day,index)=><span className="weekday" key={'week'+index}>{day}</span>)}
        {Array.from({length:3},(_,index)=><span key={'blank'+index}/>)}
        {Array.from({length:31},(_,index)=><span key={index} className={index===20?(selected?'selected':frame>=beats.dateHover?'hovered':''):''}>{index+1}</span>)}
      </div>
    </div>}
    {frame>=beats.datePrepared && <div className="date-confirmation" style={reveal(frame,beats.datePrepared)}><CheckCircle2 size={20}/> Prepared for chat. You choose when to send.</div>}
  </div>;
}
export function AccessDebugging(){
  const frame=useCurrentFrame();
  const cue=cueAt(frame);
  const typed=incident.prompt.slice(0,Math.floor(interpolate(frame,[beats.typeStart,beats.typeEnd],[0,incident.prompt.length],clamp)));
  const toolApproval=frame>=beats.approvalOpen&&frame<beats.approvalClose+24;
  const scale=interpolate(frame,[0,intro.end,roles.start,datadog.start,seconds(55),finding.start,date.start,duration],[.985,1,1,1,1.016,1.016,1,1],{...clamp,easing:Easing.inOut(Easing.cubic)});
  return <AbsoluteFill className="chista-film" style={{opacity:1-progress(frame,duration-24,23)}}>
    <style>{rowStyles(frame,'logs',beats.logRows)+rowStyles(frame,'roles',beats.roleRows)}</style>
    <div className="film-glow"/>
    {chapters.map(chapter=>frame>=chapter.start&&frame<chapter.end+24&&<div key={chapter.id} className="film-heading" style={{opacity:progress(frame,chapter.start+7,24)*(1-progress(frame,chapter.end,22))}}><span>{chapter.kicker}</span><h1>{chapter.title}</h1></div>)}
    <div className="film-window" style={{transform:`scale(${scale})`}}>
      <div className="film-titlebar"><div className="traffic"><i/><i/><i/></div><span><LockKeyhole size={13}/> Chista</span><span className="film-local"><ShieldCheck size={14}/> Safe debug session</span></div>
      <div className="film-app">
        <aside className="film-sidebar"><div className="film-brand"><span>✳</span> chista</div><div className="film-workspace">Access audit <ChevronDown size={14}/></div><div className="film-new"><Plus size={14}/> New session</div><small>DEBUG SESSIONS</small><div className="film-session"><i/>File access investigation</div><div className="film-sidebar-bottom"><Settings size={16}/> Settings</div></aside>
        <div className="film-main"><div className="film-breadcrumb">Access audit <ChevronRight size={13}/> Sessions <ChevronRight size={13}/> File access investigation</div>
          <div className="film-session-header"><span>File access investigation</span><span><FolderOpen size={15}/> Files & mappings</span></div>
          <Trail frame={frame}/>
          <div className="film-scene">
            <Scene frame={frame} start={intro.start} end={intro.end}><div className="film-welcome"><span>✳</span><h2>What are you debugging?</h2><p>A user. A file. An unexpected access denial.</p><div className="film-request"><FileText size={24}/><div><strong>Access denied</strong><small>“I could open this file yesterday.”</small></div><b>403</b></div></div></Scene>
            <Scene frame={frame} start={question.start} end={question.end}><div className="film-question"><div className="film-assistant"><span>✳</span> CHISTA</div><h2>Start with the question.</h2><p>Your workspace keeps the files and context together.</p>{frame>=beats.questionSent&&<div className="film-user-message" style={reveal(frame,beats.questionSent)}>{incident.prompt}</div>}</div></Scene>
            <Scene frame={frame} start={logs.start} end={logs.end}>
              <div className="film-evidence-header"><span><FileText size={18}/> access.log</span><span className="safe-chip"><ShieldCheck size={15}/> Identifiers masked locally</span></div>
              <Pending frame={frame} start={logs.start+20} end={beats.logReady} text="Reading sanitized access events…"/>
              <UI name="logs" frame={frame} start={beats.logReady}/>
              <div className="film-observation" style={reveal(frame,beats.logFinding)}><Search size={20}/><div><strong>Authentication succeeded. Authorization failed.</strong><p>Follow the group-membership change before the first 403.</p></div></div>
            </Scene>
            <Scene frame={frame} start={roles.start} end={roles.end}>
              <UI name="roles" frame={frame} start={roles.start+24}/>
              <div className="film-finding-inline" style={reveal(frame,beats.roleFinding)}><span className="finding-icon"><LockKeyhole size={24}/></span><div><strong>The role is valid. The required group is missing.</strong><p>Support membership does not satisfy this file’s Finance Ops policy.</p></div></div>
            </Scene>
            <Scene frame={frame} start={datadog.start} end={datadog.end}>
              <div className="film-source"><Activity size={20}/><strong>Datadog</strong><span>documents-api · 09:55–10:20</span><b>{frame>=beats.datadogReady?<Check size={14}/>:<LoaderCircle size={14} style={{transform:`rotate(${frame*4}deg)`}}/>}{frame<beats.approvalClose?'Approval required':frame<beats.datadogReady?'Retrieving events…':'Query complete'}</b></div>
              <Pending frame={frame} start={datadog.start+18} end={beats.datadogReady} text={frame<beats.approvalClose?'Prepare the Datadog query':'Retrieving the approved time window…'}/>
              <div className="film-metrics" style={reveal(frame,beats.datadogReady)}><div><span>Denied requests</span><strong>{Math.round(interpolate(frame,[beats.datadogReady,beats.datadogReady+36],[0,deniedRequests],clamp))}</strong></div><div><span>First denied request</span><strong>10:05</strong></div><div><span>Identity sync</span><strong>10:02</strong></div></div>
              <div className="film-chart-grid"><UI name="errors" frame={frame} start={beats.errorsChart}/><UI name="outcomes" frame={frame} start={beats.outcomesChart}/></div>
            </Scene>
            <Scene frame={frame} start={finding.start} end={finding.end}><div className="film-conclusion"><span className="film-check"><CheckCircle2 size={36}/></span><div className="finding-label">EVIDENCE-BACKED FINDING</div><h2 style={reveal(frame,finding.start+35)}>Missing Finance Ops membership.</h2><p style={reveal(frame,finding.start+80,36)}>The identity sync removed the group at <strong>10:02</strong>.<br/>The role still grants reads, but the file policy blocks access.</p><div className="film-next-step" style={reveal(frame,finding.start+155)}><ShieldCheck size={20}/><span>Verify the membership change before changing access.</span></div></div></Scene>
            <Scene frame={frame} start={date.start} end={date.end}><DateScene frame={frame}/></Scene>
            <Scene frame={frame} start={ending.start} end={ending.end}><div className="film-end"><span>✳</span><h2>Less guessing.<br/>More evidence.</h2><p>Chat. Investigate. Explore with OpenUI.</p><strong>chista</strong></div></Scene>
          </div>
          <div className="film-composer"><div className="film-composer-text">{frame>=question.start&&frame<beats.questionSent?<>{typed}<i className="typing-caret" style={{opacity:Math.floor(frame/15)%2}}/></>:frame>=beats.datePrepared?'Last successful access: 2026-10-21':'Message Chista…'}</div><div><span>Codex <ChevronDown size={12}/></span><span><Plus size={13}/> Add files</span><span className="film-review"><Check size={12}/> Review before sending</span><b><ArrowUp size={18}/></b></div></div>
          {toolApproval&&<div className="film-tool-shade" style={{opacity:1-progress(frame,beats.approvalClose,24)}}><div className="film-tool-modal" style={reveal(frame,beats.approvalOpen,24)}><span className="tool-modal-icon"><Activity size={23}/></span><h3>Run this MCP tool?</h3><p>Datadog · Search access logs</p><pre>{'service:documents-api\nfrom: 2026-10-22T09:55:00Z\nto:   2026-10-22T10:20:00Z'}</pre><div><span>Deny tool</span><strong>Approve tool once</strong></div></div></div>}
        </div>
      </div>
    </div>
    {frame>=question.start&&frame<question.end&&<Cursor frame={frame} end={seconds(13)} points={[{at:seconds(4.5),x:1110,y:841},{at:beats.typeEnd+15,x:1110,y:841},{at:beats.send,x:1728,y:904,click:true}]}/>}
    {toolApproval&&<Cursor frame={frame} end={beats.approvalClose+24} points={[{at:beats.approvalOpen+30,x:1410,y:720},{at:beats.approvalClick-30,x:1256,y:720},{at:beats.approvalClick,x:1256,y:720,click:true}]}/>}
    {frame>=date.start&&frame<date.end&&<Cursor frame={frame} end={date.end} points={[{at:seconds(74),x:1185,y:650},{at:beats.calendarOpen,x:1024,y:526,click:true},{at:beats.dateHover,x:813,y:747},{at:beats.dateSelect,x:813,y:747,click:true},{at:beats.calendarClose,x:813,y:747},{at:beats.useDate,x:730,y:586,click:true},{at:beats.datePrepared+15,x:1100,y:850}]}/>}
    <div className="film-caption" style={{opacity:.55+.45*progress(frame,cue.at,18)}}>{cue.text}</div>
    <div className="film-footer"><span>CHISTA</span><div>{chapters.slice(1,-1).map((step,index)=><i key={index} style={{background:frame>=step.start?'#9270b6':'#ded7e6'}}/>)}</div><small>Illustrative incident · sample data</small></div>
  </AbsoluteFill>;
}
