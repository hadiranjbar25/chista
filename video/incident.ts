import type {AgentReply} from '../src/AgentResponse';

// Illustrative incident approved for the animation. Replace these sanitized
// observations together when adapting this film to a real investigation.
export const incident={
  illustrative:true,
  date:'2026-10-22',lastWorked:'2026-10-21',
  user:'[USER_1]',file:'[FILE_1]',role:'Viewer',
  userGroup:'Support',requiredGroup:'Finance Ops',
  permission:'file:read',
  prompt:'A user cannot open a file. Check the logs, permissions and roles, then correlate the errors in Datadog.',
  series:[
    {label:'09:55',value:0},{label:'10:00',value:0},{label:'10:05',value:3},
    {label:'10:10',value:7},{label:'10:15',value:4},{label:'10:20',value:0},
  ],
  allowedRequests:126,
};
export const deniedRequests=incident.series.reduce((sum,point)=>sum+point.value,0);
export const replies:Record<string,AgentReply>={
  logs:{text:'The request reaches the file service. Authorization returns 403.',blocks:[
    {type:'table',title:'Access log evidence',columns:['Time','Event','Result'],rows:[
      ['09:58:41','GET /files/[FILE_1]','200 · allowed'],
      ['10:02:03','Identity sync · Finance Ops removed','Group membership changed'],
      ['10:05:12','GET /files/[FILE_1]','403 · group requirement not met'],
      ['10:10:08','GET /files/[FILE_1]','403 · group requirement not met'],
    ]},
  ]},
  roles:{text:'The role permits reads. The file also requires a group the user no longer belongs to.',blocks:[
    {type:'table',title:'Roles & effective permissions',columns:['Check','Observed','Required','Outcome'],rows:[
      ['Workspace role',incident.role,'Viewer or higher','Pass'],
      ['Role permission',incident.permission,incident.permission,'Pass'],
      ['User group',incident.userGroup,incident.requiredGroup,'Missing'],
      ['File policy','Finance Ops only','Finance Ops membership','Blocked'],
    ]},
  ]},
  errors:{text:'',blocks:[{type:'chart',title:'403 responses over time',items:incident.series}]},
  outcomes:{text:'',blocks:[{type:'chart',title:'File-service responses',items:[
    {label:'Allowed · 200',value:incident.allowedRequests},{label:'Denied · 403',value:deniedRequests},
  ]}]},
  date:{text:'When did this user last have access?',blocks:[{type:'date',title:'Last successful access',min:'2026-10-01',max:'2026-10-31',submitLabel:'Use date'}]},
};
export const chapters=[
  {start:0,end:90,kicker:'CHISTA / SAFE DEBUGGING',title:'Why can’t this user open a file?',caption:'One question. Follow the evidence.'},
  {start:90,end:210,kicker:'01 / START WITH THE QUESTION',title:'Ask once. Keep the investigation in context.',caption:'One workspace. A focused debugging session.'},
  {start:210,end:360,kicker:'02 / INSPECT THE LOGS',title:'A denied request has a story.',caption:'Sensitive values are masked locally before sharing.'},
  {start:360,end:540,kicker:'03 / CHECK EFFECTIVE ACCESS',title:'A valid role is only part of the answer.',caption:'Compare the role, its permissions, and the file’s policy.'},
  {start:540,end:750,kicker:'04 / CORRELATE WITH DATADOG',title:'Put the permission failure on a timeline.',caption:'Approve the tool call. Inspect the resulting charts.'},
  {start:750,end:870,kicker:'05 / EXPLAIN THE FINDING',title:'The missing group explains the 403s.',caption:'A group membership change lines up with the first denied requests.'},
  {start:870,end:1050,kicker:'06 / ASK A BETTER FOLLOW-UP',title:'The next question becomes a date picker.',caption:'Choose when access last worked to narrow the audit window.'},
  {start:1050,end:1140,kicker:'CHISTA',title:'From access denied to a clear next step.',caption:'Context, evidence, and interactive answers. In one conversation.'},
] as const;
export const duration=1140;
export function chapterAt(frame:number){return chapters.find(chapter=>frame<chapter.end)??chapters[chapters.length-1];}
