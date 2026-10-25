import {expect,it} from 'vitest';
import {responseSchema} from '../src/AgentResponse';
import {chapterAt,chapters,deniedRequests,duration,incident,replies} from './incident';
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
  expect(chapterAt(900).title).toContain('date picker');
  expect(replies.date.blocks[0].type).toBe('date');
});
