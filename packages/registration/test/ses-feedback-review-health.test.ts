import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Pool} from 'pg';
import {SesFeedbackWorker} from '../src/ses-feedback-worker.ts';
import {runSesFeedbackConsumer} from '../src/ses-feedback-service.ts';
import {config,keys} from './fixtures/mail-attempt.ts';

function fixture(){
 const pool=new Pool(),settings=config(),stop=new AbortController(),statuses:ReturnType<SesFeedbackWorker['status']>[]=[];
 const queue={async receive(_signal:AbortSignal):Promise<{body:string;receiptHandle:string}[]>{return [];},async delete(){},close(){}};
 return {pool,queue,stop,statuses,options:{pool,queue,config:settings,recipientKeys:keys,signal:stop.signal,
  sample:()=>({observedAt:Date.now(),queueAgeSeconds:0,deadLetterCount:0,configurationRevision:settings.revision,configurationDrift:false}),
  onStatus:(status:ReturnType<SesFeedbackWorker['status']>)=>statuses.push(status)}};
}

test('the last one-shot status refuses readiness after the owned resources close',async()=>{
 const f=fixture();await runSesFeedbackConsumer({...f.options,once:true});
 assert.equal(f.pool.ended,true);assert.ok(f.statuses.some(s=>s.ready));
 assert.equal(f.statuses.at(-1)!.ready,false);assert.equal(f.statuses.at(-1)!.state,'stopped');
 assert.equal(f.statuses.at(-1)!.failure,null);
});

test('cancelling healthy long polls does not turn a clean stop into a receive failure',async()=>{
 const f=fixture();let entered:()=>void=()=>{},receives=0;
 const polling=new Promise<void>(resolve=>{entered=resolve;});
 f.queue.receive=async signal=>{if(++receives===2)entered();return new Promise<never>((_resolve,reject)=>{
  signal.addEventListener('abort',()=>reject(Error('private cancellation')),{once:true});});};
 const work=runSesFeedbackConsumer(f.options);await polling;f.stop.abort();await work;
 assert.equal(f.statuses.at(-1)!.state,'stopped');assert.equal(f.statuses.at(-1)!.failure,null);
});

test('unreadable collector objects report stale samples without stopping the consumer',async()=>{
 const f=fixture(),sample=new Proxy({},{ownKeys(){throw Error('private collector failure');}});
 await assert.doesNotReject(runSesFeedbackConsumer({...f.options,once:true,sample:()=>sample}));
 assert.ok(f.statuses.some(s=>s.state==='stale'));assert.ok(f.statuses.every(s=>!s.ready));
 assert.doesNotMatch(JSON.stringify(f.statuses),/private|collector failure/);assert.equal(f.pool.ended,true);
});

test('a stopped receive preserves an earlier real failure rather than clearing it',async()=>{
 const f=fixture(),worker=new SesFeedbackWorker(f.options);try{
  f.queue.receive=async()=>{throw Error('private actual failure');};
  await assert.rejects(worker.runOnce(new AbortController().signal),/^Error: ses_feedback_receive_failed$/);
  f.queue.receive=async()=>[];await worker.runOnce(new AbortController().signal);
  let entered:()=>void=()=>{};const polling=new Promise<void>(resolve=>{entered=resolve;});
  f.queue.receive=async signal=>{entered();return new Promise<never>((_resolve,reject)=>{
   signal.addEventListener('abort',()=>reject(Error('private cancellation')),{once:true});});};
  const work=worker.runOnce(f.stop.signal);await polling;f.stop.abort();
  await assert.doesNotReject(work);assert.equal(await work,false);
  assert.equal(worker.status(f.options.sample()).failure,'ses_feedback_receive_failed');
 }finally{await f.pool.end();}
});

test('a readiness snapshot carries its producer observation time for an independent stale-output check',async()=>{
 const f=fixture(),worker=new SesFeedbackWorker({...f.options,now:()=>100000});try{
  await worker.runOnce(new AbortController().signal);await worker.runOnce(new AbortController().signal);
  const snapshot=worker.status({...f.options.sample(),observedAt:100000});
  assert.equal(snapshot.ready,true);assert.equal(snapshot.observedAt,100000);
 }finally{await f.pool.end();}
});
