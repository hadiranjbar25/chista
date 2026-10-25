import {expect,it} from 'vitest';
import {responseSchema} from '../src/AgentResponse';
import {beats,chapterAt,chapters,deniedRequests,duration,fps,incident,renderDuration,renderFps,replies} from './incident';
it('uses valid OpenUI blocks and reconciles chart totals with the illustrative incident',()=>{
  expect(incident.illustrative).toBe(true);
  for(const reply of Object.values(replies))expect(responseSchema.safeParse(reply).success).toBe(true);
  expect(deniedRequests).toBe(14);
  expect(incident.allowedRequests+deniedRequests).toBe(140);
  expect(incident.lastWorked<incident.date).toBe(true);
});
it('has a continuous timeline and a date-picker follow-up before the final scene',()=>{
  expect(chapters[0].start).toBe(0);
  for(let i=1;i<chapters.length;i++)expect(chapters[i].start).toBe(chapters[i-1].end);
  expect(chapters.at(-1)!.end).toBe(duration);
  expect(chapterAt(beats.calendarOpen).id).toBe('date');
  expect(replies.date.blocks[0].type).toBe('date');
});

it('leaves time to read checks and makes the query and date actions happen in order',()=>{
  expect(duration).toBe(90*30);
  const rolePhase=chapters.find(chapter=>chapter.id==='roles')!;
  expect(rolePhase.end-rolePhase.start).toBeGreaterThanOrEqual(14*30);
  for(let i=1;i<beats.roleRows.length;i++)expect(beats.roleRows[i]-beats.roleRows[i-1]).toBeGreaterThanOrEqual(2*30);
  expect(beats.approvalClick-beats.approvalOpen).toBeGreaterThanOrEqual(4*30);
  expect(beats.datadogReady).toBeGreaterThan(beats.approvalClose);
  expect(beats.errorsChart).toBeGreaterThan(beats.datadogReady);
  expect(beats.outcomesChart-beats.errorsChart).toBeGreaterThanOrEqual(3*30);
  expect(beats.dateSelect-beats.calendarOpen).toBeGreaterThanOrEqual(4*30);
  expect(beats.useDate).toBeGreaterThan(beats.calendarClose);
  expect(beats.datePrepared).toBeGreaterThan(beats.useDate);
});

it("samples the same 90-second storyboard at 60 fps",()=>{
  expect(renderFps).toBe(60);
  expect(renderDuration).toBe(5400);
  expect(renderDuration/renderFps).toBe(duration/fps);
});
