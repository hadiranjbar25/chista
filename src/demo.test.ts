import {describe,it,expect} from 'vitest';
import {buildDemoReply,demoContext,demoQuestion} from './demo';
import {responseSchema} from './AgentResponse';
describe('guided demo evidence',()=>{
 it('derives sample findings and valid widgets from sanitized context',()=>{
  const context=demoContext();const reply=responseSchema.parse(JSON.parse(buildDemoReply(demoQuestion,context)));
  expect(reply.text).toContain('2 of 5 sampled requests failed (40%)');expect(reply.text).toContain('3,000 ms');expect(reply.text).toContain('2,000 ms');
  for(const raw of ['alex@example.com','sam@example.com','sk-demoSecret123456','10.0.1.24'])expect(context+JSON.stringify(reply)).not.toContain(raw);
  expect(reply.blocks.some(b=>b.type==='chart'&&b.items.some(i=>i.label==='Configured timeout'&&i.value===2000))).toBe(true);
 });
 it('answers supported follow-ups differently and does not invent a diagnosis without evidence',()=>{
  const context=demoContext();const latency=JSON.parse(buildDemoReply('Show latency',context));expect(latency.text).toContain('Latency breakdown');
  const empty=JSON.parse(buildDemoReply('Debug',null));expect(empty.text).not.toContain('40%');
  const custom=JSON.stringify({artifacts:[{artifact:'a.log',content:'INFO all healthy'}]});expect(JSON.parse(buildDemoReply('Debug',custom)).text).toContain('no root cause is assumed');
 });
});
