import type { AgentReply } from '../../src/chat/response';

// Illustrative incident approved for the animation. Replace these sanitized
// observations together when adapting this film to a real investigation.
export const incident = {
  illustrative: true,
  date: '2026-10-22',
  lastWorked: '2026-10-21',
  user: '[USER_1]',
  file: '[FILE_1]',
  role: 'Viewer',
  userGroup: 'Support',
  requiredGroup: 'Finance Ops',
  permission: 'file:read',
  prompt:
    'A user cannot open a file. Check the logs, permissions and roles, then correlate the errors in Datadog.',
  series: [
    { label: '09:55', value: 0 },
    { label: '10:00', value: 0 },
    { label: '10:05', value: 3 },
    { label: '10:10', value: 7 },
    { label: '10:15', value: 4 },
    { label: '10:20', value: 0 },
  ],
  allowedRequests: 126,
};
export const deniedRequests = incident.series.reduce((sum, point) => sum + point.value, 0);
export const replies: Record<string, AgentReply> = {
  logs: {
    text: 'I’ll inspect the access events and their authorization decisions.',
    blocks: [
      {
        type: 'table',
        title: 'Access log evidence',
        columns: ['Time', 'Event', 'Result'],
        rows: [
          ['09:58:41', 'GET /files/[FILE_1]', '200 · allowed'],
          ['10:02:03', 'Identity sync · Finance Ops removed', 'Group membership changed'],
          ['10:05:12', 'GET /files/[FILE_1]', '403 · group requirement not met'],
          ['10:10:08', 'GET /files/[FILE_1]', '403 · group requirement not met'],
        ],
      },
    ],
  },
  roles: {
    text: 'Let’s check the role, its permissions, and the file policy.',
    blocks: [
      {
        type: 'table',
        title: 'Roles & effective permissions',
        columns: ['Check', 'Observed', 'Required', 'Outcome'],
        rows: [
          ['Workspace role', incident.role, 'Viewer or higher', 'Pass'],
          ['Role permission', incident.permission, incident.permission, 'Pass'],
          ['User group', incident.userGroup, incident.requiredGroup, 'Missing'],
          ['File policy', 'Finance Ops only', 'Finance Ops membership', 'Blocked'],
        ],
      },
    ],
  },
  errors: {
    text: '',
    blocks: [{ type: 'chart', title: '403 responses over time', items: incident.series }],
  },
  outcomes: {
    text: '',
    blocks: [
      {
        type: 'chart',
        title: 'File-service responses',
        items: [
          { label: 'Allowed · 200', value: incident.allowedRequests },
          { label: 'Denied · 403', value: deniedRequests },
        ],
      },
    ],
  },
  date: {
    text: 'When did this user last have access?',
    blocks: [
      {
        type: 'date',
        title: 'Last successful access',
        min: '2026-10-01',
        max: '2026-10-31',
        submitLabel: 'Use date',
      },
    ],
  },
};
// Keep the storyboard on its original 30-frame timebase; sample motion at 60 fps.
export const fps = 30;
export const renderFps = 60;
export const seconds = (value: number) => Math.round(value * fps);
export const chapters = [
  {
    id: 'intro',
    start: 0,
    end: 4,
    kicker: 'CHISTA / SAFE DEBUGGING',
    title: 'Why can’t this user open a file?',
    caption: 'One question. Follow the evidence.',
  },
  {
    id: 'question',
    start: 4,
    end: 14,
    kicker: '01 / START WITH THE QUESTION',
    title: 'Give the investigation its context.',
    caption: 'Describe the problem in plain language.',
  },
  {
    id: 'logs',
    start: 14,
    end: 28,
    kicker: '02 / INSPECT THE LOGS',
    title: 'Start with the access events.',
    caption: 'Read the sanitized log evidence.',
  },
  {
    id: 'roles',
    start: 28,
    end: 44,
    kicker: '03 / CHECK EFFECTIVE ACCESS',
    title: 'Check each condition, one by one.',
    caption: 'Verify the role, its permissions, and the file policy.',
  },
  {
    id: 'datadog',
    start: 44,
    end: 63,
    kicker: '04 / CORRELATE WITH DATADOG',
    title: 'Put the failure on a timeline.',
    caption: 'Review the query before allowing tool access.',
  },
  {
    id: 'finding',
    start: 63,
    end: 72,
    kicker: '05 / EXPLAIN THE FINDING',
    title: 'Connect the evidence to the cause.',
    caption: 'Verify the membership change before modifying access.',
  },
  {
    id: 'date',
    start: 72,
    end: 85,
    kicker: '06 / NARROW THE NEXT QUERY',
    title: 'Ask when access last worked.',
    caption: 'A date picker makes the follow-up precise.',
  },
  {
    id: 'end',
    start: 85,
    end: 90,
    kicker: 'CHISTA',
    title: 'A clear finding. A focused next step.',
    caption: 'Context, evidence, and interactive answers. In one conversation.',
  },
].map((chapter) => ({ ...chapter, start: seconds(chapter.start), end: seconds(chapter.end) }));
export const beats = {
  typeStart: seconds(5),
  typeEnd: seconds(9.5),
  send: seconds(11.2),
  questionSent: seconds(11.7),
  logReady: seconds(16),
  logRows: [18, 19.8, 21.6, 23.4].map(seconds),
  logFinding: seconds(25),
  roleRows: [30, 32, 34, 36].map(seconds),
  roleFinding: seconds(39),
  approvalOpen: seconds(45),
  approvalClick: seconds(50),
  approvalClose: seconds(51),
  datadogReady: seconds(53),
  errorsChart: seconds(54),
  outcomesChart: seconds(57.2),
  dateHover: seconds(77.5),
  calendarOpen: seconds(75),
  dateSelect: seconds(79.5),
  calendarClose: seconds(80.4),
  useDate: seconds(81.8),
  datePrepared: seconds(82.3),
};
export const duration = chapters[chapters.length - 1].end;
export const renderDuration = (duration * renderFps) / fps;
export function chapterAt(frame: number) {
  return chapters.find((chapter) => frame < chapter.end) ?? chapters[chapters.length - 1];
}
export const cues = [
  { at: 0, text: 'This user opened the file yesterday. Today, access is denied.' },
  { at: seconds(4), text: 'Describe the problem in plain language.' },
  { at: beats.send, text: 'The question is sent. Chista starts with the evidence.' },
  { at: seconds(14), text: 'Read the locally sanitized access log.' },
  { at: beats.logRows[0], text: 'The file opened successfully before the identity sync.' },
  { at: beats.logRows[1], text: 'At 10:02, the sync removed Finance Ops membership.' },
  { at: beats.logRows[2], text: 'The next file requests return 403.' },
  {
    at: beats.logFinding,
    text: 'Authentication succeeded. The file’s authorization check failed.',
  },
  { at: seconds(28), text: 'Now check the user’s effective access.' },
  { at: beats.roleRows[0], text: '1. The Viewer role is valid for this workspace.' },
  { at: beats.roleRows[1], text: '2. The role includes the required file:read permission.' },
  { at: beats.roleRows[2], text: '3. The user belongs to Support. Finance Ops is missing.' },
  { at: beats.roleRows[3], text: '4. The file policy requires Finance Ops membership.' },
  { at: beats.roleFinding, text: 'The role is valid. The missing group blocks this file.' },
  { at: seconds(44), text: 'Use Datadog to inspect the surrounding file-service events.' },
  { at: beats.approvalOpen, text: 'Review the exact query and time window before approving.' },
  { at: beats.approvalClose, text: 'The approved query retrieves the surrounding events.' },
  { at: beats.datadogReady, text: 'The query returned 140 file-service responses.' },
  { at: beats.errorsChart, text: 'First, plot the denied requests over time.' },
  { at: beats.outcomesChart, text: 'Then compare 14 denials with 126 successful responses.' },
  { at: seconds(61), text: 'The first denials follow the 10:02 group-membership change.' },
  { at: seconds(63), text: 'Connect the audit event, file policy, and 403 responses.' },
  { at: seconds(68), text: 'Verify the membership change before modifying access.' },
  { at: seconds(72), text: 'Ask when access last worked to narrow the next audit window.' },
  { at: beats.calendarOpen, text: 'Open the calendar and choose the last successful day.' },
  { at: beats.dateSelect, text: 'October 21 becomes the starting point for the follow-up.' },
  { at: beats.datePrepared, text: 'The date is prepared in chat. The user chooses when to send.' },
  { at: seconds(85), text: 'Keep the context. Follow the evidence. Choose the next step.' },
];
export function cueAt(frame: number) {
  return [...cues].reverse().find((cue) => cue.at <= frame) ?? cues[0];
}
