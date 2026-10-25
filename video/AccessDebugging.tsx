import type {CSSProperties,ReactNode} from 'react';
import {AbsoluteFill,Easing,interpolate,useCurrentFrame} from 'remotion';
import {Activity,ArrowUp,CalendarDays,Check,CheckCircle2,ChevronDown,ChevronLeft,ChevronRight,FileText,FolderOpen,LockKeyhole,MessagesSquare,MousePointer2,Plus,Search,Settings,ShieldCheck} from 'lucide-react';
import AgentResponse from '../src/AgentResponse';
import {chapterAt,chapters,deniedRequests,duration,incident,replies} from './incident';
import '../src/styles.css';
import '../src/workspace.css';
import './video.css';
const clamp={extrapolateLeft:'clamp',extrapolateRight:'clamp'} as const;
const ease=Easing.bezier(.22,1,.36,1);
function reveal(frame:number,start:number,span=20):CSSProperties {
  const progress=interpolate(frame,[start,start+span],[0,1],{...clamp,easing:ease});
  return {opacity:progress,transform:`translateY(${(1-progress)*18}px)`};
}
function UI({name,frame,start=0}:{name:keyof typeof replies;frame:number;start?:number}){
  return <div className={`video-ui video-ui-${name}`} style={reveal(frame,start)}><AgentResponse content={JSON.stringify(replies[name])} onFollow={()=>{}}/></div>;
}
function Cursor({frame,points}:{frame:number;points:{at:number;x:number;y:number;click?:boolean}[]}){
  const next=points.findIndex(point=>point.at>frame);
  const a=next===-1?points[points.length-1]:points[Math.max(0,next-1)];
  const b=next===-1?a:points[next];
  const progress=a===b?1:interpolate(frame,[a.at,b.at],[0,1],{...clamp,easing:ease});
  const x=a.x+(b.x-a.x)*progress,y=a.y+(b.y-a.y)*progress;
  const clicked=points.find(point=>point.click && frame>=point.at && frame<point.at+18);
  const pulse=clicked?(frame-clicked.at)/18:0;
  return <div className="film-cursor" style={{left:x,top:y,opacity:frame<points[0].at?0:1}}>{clicked && <div className="cursor-pulse" style={{opacity:1-pulse,transform:`translate(-50%,-50%) scale(${.3+pulse})`}}/>}<MousePointer2 size={29} fill="#342443" stroke="white" strokeWidth={1.6}/></div>;
}
function Bubble({children}:{children:ReactNode}){return <div className="film-user-message">{children}</div>;}
function DateScene({frame}:{frame:number}){
  const open=frame>=915 && frame<987;
  const selected=frame>=975;
  return <div className="film-date" style={reveal(frame,870)}>
    <div className="film-assistant"><span>✳</span> CHISTA</div>
    <UI name="date" frame={frame}/>
    {selected && <span className="date-value">Oct 21, 2026</span>}
    {open && <div className="film-calendar" style={reveal(frame,915,12)}>
      <div><ChevronLeft size={18}/><strong>October 2026</strong><ChevronRight size={18}/></div>
      <div className="calendar-grid">{['M','T','W','T','F','S','S'].map((day,index)=><span className="weekday" key={'week'+index}>{day}</span>)}
        {Array.from({length:3},(_,index)=><span key={'blank'+index}/>)}
        {Array.from({length:31},(_,index)=><span key={index} className={index===20 && selected?'selected':''}>{index+1}</span>)}
      </div>
    </div>}
    {frame>=1008 && <div className="date-confirmation" style={reveal(frame,1008)}><CheckCircle2 size={20}/> Prepared for chat. You choose when to send.</div>}
  </div>;
}
export function AccessDebugging(){
  const frame=useCurrentFrame();
  const chapter=chapterAt(frame);
  const entering=interpolate(frame,[chapter.start,chapter.start+18],[0,1],{...clamp,easing:ease});
  const fadeOut=interpolate(frame,[duration-16,duration-1],[1,0],clamp);
  const typed=incident.prompt.slice(0,Math.floor(interpolate(frame,[110,176],[0,incident.prompt.length],clamp)));
  const datadog=frame>=540&&frame<750;
  const toolApproval=frame>=548&&frame<590;
  const date=frame>=870&&frame<1050;
  const sceneScale=interpolate(frame,[chapter.start,chapter.end],[1.018,1],clamp);
  return <AbsoluteFill className="chista-film" style={{opacity:fadeOut}}>
    <div className="film-glow"/>
    <div className="film-heading" style={{opacity:entering,transform:`translateY(${(1-entering)*12}px)`}}><span>{chapter.kicker}</span><h1>{chapter.title}</h1></div>
    <div className="film-window" style={{transform:`scale(${sceneScale})`}}>
      <div className="film-titlebar"><div className="traffic"><i/><i/><i/></div><span><LockKeyhole size={13}/> Chista</span><span className="film-local"><ShieldCheck size={14}/> Safe debug session</span></div>
      <div className="film-app">
        <aside className="film-sidebar"><div className="film-brand"><span>✳</span> chista</div><div className="film-workspace">Access audit <ChevronDown size={14}/></div><div className="film-new"><Plus size={14}/> New session</div><small>DEBUG SESSIONS</small><div className="film-session"><i/>File access investigation</div><div className="film-sidebar-bottom"><Settings size={16}/> Settings</div></aside>
        <div className="film-main"><div className="film-breadcrumb">Access audit <ChevronRight size={13}/> Sessions <ChevronRight size={13}/> File access investigation</div>
          <div className="film-session-header"><span>File access investigation</span><span><FolderOpen size={15}/> Files & mappings</span></div>
          <div className="film-scene">
            {frame<90 && <div className="film-welcome" style={reveal(frame,6,24)}><span>✳</span><h2>What are you debugging?</h2><p>A user. A file. An unexpected access denial.</p><div className="film-request"><FileText size={24}/><div><strong>Access denied</strong><small>“I could open this file yesterday.”</small></div><b>403</b></div></div>}
            {frame>=90&&frame<210 && <div className="film-question" style={reveal(frame,90)}><div className="film-assistant"><span>✳</span> CHISTA</div><h2>Start with the question.</h2><p>Your workspace keeps the files and context together.</p>{frame>=185&&<Bubble>{incident.prompt}</Bubble>}</div>}
            {frame>=210&&frame<360 && <div style={reveal(frame,210)}><div className="film-evidence-header"><span><FileText size={18}/> access.log</span><span className="safe-chip"><ShieldCheck size={15}/> Identifiers masked locally</span></div><UI name="logs" frame={frame} start={225}/><div className="film-observation" style={reveal(frame,285)}><Search size={20}/><div><strong>Authentication succeeded. Authorization failed.</strong><p>Follow the group-membership change before the first 403.</p></div></div></div>}
            {frame>=360&&frame<540 && <div style={reveal(frame,360)}><UI name="roles" frame={frame}/><div className="film-finding-inline" style={reveal(frame,440)}><span className="finding-icon"><LockKeyhole size={24}/></span><div><strong>The role is valid. The required group is missing.</strong><p>Support membership does not satisfy this file’s Finance Ops policy.</p></div></div></div>}
            {datadog && <div style={reveal(frame,540)}><div className="film-source"><Activity size={20}/><strong>Datadog</strong><span>documents-api · 09:55–10:20</span><b><Check size={14}/> Approved once</b></div><div className="film-metrics"><div><span>Denied requests</span><strong>{Math.round(interpolate(frame,[590,620],[0,deniedRequests],clamp))}</strong></div><div><span>First denied request</span><strong>10:05</strong></div><div><span>Identity sync</span><strong>10:02</strong></div></div><div className="film-chart-grid" style={{...reveal(frame,594),'--chart-progress':interpolate(frame,[594,627],[0,1],{...clamp,easing:ease})} as CSSProperties}><UI name="errors" frame={frame}/><UI name="outcomes" frame={frame}/></div></div>}
            {frame>=750&&frame<870 && <div className="film-conclusion" style={reveal(frame,750)}><span className="film-check"><CheckCircle2 size={36}/></span><div className="finding-label">EVIDENCE-BACKED FINDING</div><h2>Missing Finance Ops membership.</h2><p>The identity sync removed the group at <strong>10:02</strong>.<br/>The role still grants reads, but the file policy blocks access.</p><div className="film-next-step"><ShieldCheck size={20}/><span>Verify the membership change before changing access.</span></div></div>}
            {date&&<DateScene frame={frame}/>}
            {frame>=1050 && <div className="film-end" style={reveal(frame,1050)}><span>✳</span><h2>Less guessing.<br/>More evidence.</h2><p>Chat. Investigate. Explore with OpenUI.</p><strong>chista</strong></div>}
          </div>
          <div className="film-composer"><div className="film-composer-text">{frame>=90&&frame<185?<>{typed}<i className="typing-caret" style={{opacity:Math.floor(frame/12)%2}}/></>:frame>=1008&&frame<1050?'Last successful access: 2026-10-21':'Message Chista…'}</div><div><span>Codex <ChevronDown size={12}/></span><span><Plus size={13}/> Add files</span><span className="film-review"><Check size={12}/> Review before sending</span><b><ArrowUp size={18}/></b></div></div>
          {toolApproval&&<div className="film-tool-shade"><div className="film-tool-modal" style={reveal(frame,548,10)}><span className="tool-modal-icon"><Activity size={23}/></span><h3>Run this MCP tool?</h3><p>Datadog · Search access logs</p><pre>{'service:documents-api\nfrom: 2026-10-22T09:55:00Z\nto:   2026-10-22T10:20:00Z'}</pre><div><span>Deny tool</span><strong>Approve tool once</strong></div></div></div>}
        </div>
      </div>
    </div>
    {frame>=90&&frame<210 && <Cursor frame={frame} points={[{at:96,x:1110,y:841},{at:164,x:1690,y:904},{at:181,x:1728,y:904,click:true},{at:207,x:1728,y:904}]}/>}
    {toolApproval && <Cursor frame={frame} points={[{at:552,x:1410,y:720},{at:580,x:1256,y:720,click:true}]}/>}
    {date && <Cursor frame={frame} points={[{at:900,x:1185,y:650},{at:914,x:1024,y:526,click:true},{at:956,x:813,y:747},{at:974,x:813,y:747,click:true},{at:986,x:813,y:747},{at:1008,x:730,y:586,click:true},{at:1035,x:1100,y:850}]}/>}
    <div className="film-caption" style={{opacity:entering}}>{chapter.caption}</div>
    <div className="film-footer"><span>CHISTA</span><div>{chapters.slice(1,-1).map((step,index)=><i key={index} style={{background:frame>=step.start?'#9270b6':'#ded7e6'}}/>)}</div><small>Illustrative incident · sample data</small></div>
  </AbsoluteFill>;
}
