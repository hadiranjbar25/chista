import {expect,it} from 'vitest';
import {contextEvidence,partialReply,updateActivity} from './investigation';
it('publishes complete validated blocks at every stream boundary, never incomplete or unsupported UI',()=>{
  const table={type:'table',title:'Access evidence',columns:['Event'],rows:[['A bracket ] and escaped "quote"']]};
  const chart={type:'chart',title:'Observed 403s',items:[{label:'Denied',value:14}]};
  const raw=JSON.stringify({text:'An example: "blocks":[] is prose.',blocks:[table,chart]});
  const firstEnd=raw.indexOf(JSON.stringify(table))+JSON.stringify(table).length;
  for(let i=0;i<firstEnd;i++)expect(partialReply(raw.slice(0,i)).blocks).toEqual([]);
  expect(partialReply(raw.slice(0,firstEnd)).blocks).toEqual([table]);
  expect(partialReply(raw)).toEqual({text:'An example: "blocks":[] is prose.',blocks:[table,chart]});
  expect(partialReply('{"text":"safe","blocks":[{"type":"script","source":"alert(1)"}]}').blocks).toEqual([]);
  expect(partialReply('{"text":"safe","blocks":[{"type":"chart","title":"x","items":[{"label":"bad","value":-1}]}]}').blocks).toEqual([]);
});
it('keeps evidence aliases and truncation notices without raw filenames or unrelated context',()=>{
  expect(contextEvidence('anything')).toEqual([]);
  expect(contextEvidence(JSON.stringify({mode:'sanitized-context',artifacts:[{artifact:'artifact-1.log',content:'safe',omittedCharacters:10},{artifact:'/private/name.log',content:'no'}]}))).toEqual([{id:'artifact-1.log',title:'artifact-1.log',content:'safe',kind:'artifact',truncated:true}]);
});
it('does not revive terminal tool calls when late progress arrives',()=>{
  const done={id:'one',server:'test',tool:'query',state:'cancelled' as const};
  expect(updateActivity([done],{...done,state:'running'})).toEqual([done]);
});
