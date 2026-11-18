import assert from 'node:assert/strict';
import {test} from 'node:test';
import {awaitAnswerable} from '../src/gateway-status.ts';

const hostname='staff.cafe.example.test';
const ready=new Set([hostname]),unready=new Set<string>();

test('every gateway in every cell must report the name before the check can start',async()=>{
 let reads=0;
 const status={async read(cell:string){
  if(cell==='source')return [ready,ready];
  return ++reads===1?[ready,unready]:[ready,ready];
 }};
 await awaitAnswerable(status,['source','destination'],hostname,{signal:new AbortController().signal,giveUpAt:Date.now()+1000,pollMs:1});
 assert.equal(reads,2);
});
test('a cell with no reported gateway and a gateway missing the name both time out',async()=>{
 for(const reported of [[],[unready]]){
  const status={async read(){return reported;}};
  await assert.rejects(awaitAnswerable(status,['source'],hostname,{signal:new AbortController().signal,giveUpAt:Date.now()+25,pollMs:1}),/challenge_not_answerable/);
 }
});
test('an unanswered status read still gives up at the deadline',async()=>{
 const status={read:()=>new Promise<ReadonlySet<string>[]>(()=>{})};
 await assert.rejects(awaitAnswerable(status,['source'],hostname,{signal:new AbortController().signal,giveUpAt:Date.now()+25}),/challenge_not_answerable/);
});
test('a status reader that throws synchronously holds the order until the readiness deadline',async()=>{
 const status={read():Promise<ReadonlySet<string>[]> {throw Error('unreadable status');}};
 await assert.rejects(awaitAnswerable(status,['source'],hostname,{signal:new AbortController().signal,giveUpAt:Date.now()+25,pollMs:1}),/challenge_not_answerable/);
});
