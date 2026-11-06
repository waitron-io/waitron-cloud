import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Pool} from 'pg';
import {SesFeedbackWorker} from '../src/ses-feedback-worker.ts';
import {config,keys} from './fixtures/mail-attempt.ts';

function fixture() {
 const pool=new Pool();let now=100000;
 const queue={async receive(_signal:AbortSignal):Promise<{body:string;receiptHandle:string}[]>{return [];},async delete(){},close(){}};
 const settings=config();
 const worker=new SesFeedbackWorker({pool,config:settings,recipientKeys:keys,queue,now:()=>now});
 assert.equal(typeof worker.status,'function','The bounded aggregate health report is missing');
 const sample=()=>({observedAt:now,queueAgeSeconds:0,deadLetterCount:0,configurationRevision:settings.revision,configurationDrift:false});
 return {pool,queue,worker,sample,setTime(value:number){now=value;},get now(){return now;},
  async poll(){await worker.runOnce(new AbortController().signal);},async close(){await pool.end();}};
}
function status(f:ReturnType<typeof fixture>,sample:unknown=f.sample()) {
 assert.equal(typeof f.worker.status,'function','The bounded aggregate health report is missing');
 return f.worker.status(sample);
}

test('health requires a successful poll from both consumer slots before reporting ready',async()=>{
 const f=fixture();try{
  assert.equal(status(f).state,'starting');assert.equal(status(f).ready,false);
  await f.poll();assert.equal(status(f).ready,false);
  await f.poll();
  assert.deepEqual(status(f),{observedAt:100000,ready:true,state:'ready',failure:null,activeConsumers:0,
   lastPollAgeMs:0,lastCommitAgeMs:null,queueAgeSeconds:0,deadLetterCount:0,configurationRevision:config().revision});
 }finally{await f.close();}
});

test('a third overlapping receive is refused before any queue or database work',async()=>{
 const f=fixture();const pending:(()=>void)[]=[];let receives=0;
 f.queue.receive=async()=>{receives++;await new Promise<void>(resolve=>pending.push(resolve));return [];};
 const work:Promise<boolean>[]=[];
 try{
  work.push(f.worker.runOnce(new AbortController().signal),f.worker.runOnce(new AbortController().signal));
  assert.equal(receives,2);
  const third=f.worker.runOnce(new AbortController().signal);work.push(third);
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{await assert.rejects(Promise.race([third,new Promise<never>((_resolve,reject)=>{
   timer=setTimeout(()=>reject(Error('test_receive_did_not_refuse')),500);
  })]),/^Error: ses_feedback_concurrency_failed$/);}finally{clearTimeout(timer);}
  assert.equal(receives,2);assert.equal(status(f).activeConsumers,2);
 }finally{pending.forEach(resolve=>resolve());await Promise.allSettled(work);await f.close();}
});

test('an error in one consumer stays visible when the other consumer polls successfully',async()=>{
 const f=fixture();try{
  f.queue.receive=async()=>{throw Error('private recipient and token');};
  await assert.rejects(f.poll(),/^Error: ses_feedback_receive_failed$/);
  f.queue.receive=async()=>[];await f.poll();
  const failed=status(f);assert.equal(failed.ready,false);assert.equal(failed.state,'failed');
  assert.equal(failed.failure,'ses_feedback_receive_failed');assert.doesNotMatch(JSON.stringify(failed),/private|token|recipient/);
  await f.poll();assert.equal(status(f).ready,true);assert.equal(status(f).failure,null);
 }finally{await f.close();}
});

test('a failed parse is a fixed failed state rather than a fresh healthy poll',async()=>{
 const f=fixture();try{
  await f.poll();await f.poll();
  f.queue.receive=async()=>[{body:'private broken payload',receiptHandle:'private handle'}];
  await assert.rejects(f.poll(),/^Error: ses_feedback_parse_failed$/);
  assert.equal(status(f).state,'failed');assert.equal(status(f).failure,'ses_feedback_parse_failed');
  assert.equal(status(f).ready,false);assert.doesNotMatch(JSON.stringify(status(f)),/private|payload|handle/);
 }finally{await f.close();}
});

test('successful activity in another slot cannot hide a receive past its request budget',async()=>{
 const f=fixture();let release:()=>void=()=>{};let waiting:Promise<boolean>|undefined;
 try{
  await f.poll();await f.poll();
  f.queue.receive=async()=>{await new Promise<void>(resolve=>{release=resolve;});return [];};
  waiting=f.worker.runOnce(new AbortController().signal);
  f.queue.receive=async()=>[];f.setTime(115000);await f.poll();
  assert.equal(status(f).state,'stale');assert.equal(status(f).ready,false);
  assert.equal(status(f).activeConsumers,1);
 }finally{release();await waiting;await f.close();}
});

test('idle poll freshness expires at the conservative budget even with a fresh queue sample',async()=>{
 const f=fixture();try{
  await f.poll();await f.poll();f.setTime(134999);assert.equal(status(f).ready,true);
  f.setTime(135000);assert.equal(status(f).state,'stale');assert.equal(status(f).ready,false);
 }finally{await f.close();}
});

test('missing stale or future operational samples cannot report ready despite fresh polls',async()=>{
 const f=fixture();try{
  await f.poll();await f.poll();const original=f.sample();
  for(const sample of [undefined,null,{...original,observedAt:64999},{...original,observedAt:100001}]){
   assert.equal(status(f,sample===undefined?null:sample).state,'stale');
   assert.equal(status(f,sample===undefined?null:sample).ready,false);
  }
  f.setTime(135000);await f.poll();await f.poll();assert.equal(status(f,original).ready,false);
 }finally{await f.close();}
});

test('health validates counts drift and revision without copying extra diagnostic fields',async()=>{
 const f=fixture();try{
  await f.poll();await f.poll();
  for(const patch of [{queueAgeSeconds:-1},{queueAgeSeconds:NaN},{queueAgeSeconds:Infinity},{queueAgeSeconds:0.5},
   {deadLetterCount:-1},{deadLetterCount:1.5},{deadLetterCount:Number.MAX_SAFE_INTEGER+1},
   {configurationDrift:'false'},{observedAt:NaN},{configurationRevision:null}]){
   const result=status(f,{...f.sample(),...patch});assert.equal(result.ready,false);
   assert.equal(result.queueAgeSeconds,null);assert.equal(result.deadLetterCount,null);
  }
  const result=status(f,{...f.sample(),queueAgeSeconds:7200,deadLetterCount:9,raw:'private-secret'});
  assert.equal(result.ready,true);assert.equal(result.queueAgeSeconds,7200);assert.equal(result.deadLetterCount,9);
  assert.doesNotMatch(JSON.stringify(result),/raw|private-secret/);
 }finally{await f.close();}
});

test('configuration revision changes and observed drift close readiness without inventing alert thresholds',async()=>{
 const f=fixture();try{
  await f.poll();await f.poll();
  for(const patch of [{configurationDrift:true},{configurationRevision:'different-revision'}]){
   const result=status(f,{...f.sample(),...patch});assert.equal(result.state,'drift');assert.equal(result.ready,false);
   assert.equal(result.configurationRevision,config().revision);
  }
 }finally{await f.close();}
});

test('a stopped consumer cannot keep reporting ready through another consumer',async()=>{
 const f=fixture();try{
  const stop=new AbortController();await f.worker.runOnce(stop.signal);await f.poll();
  assert.equal(status(f).ready,true);stop.abort();
  assert.equal(status(f).state,'stopped');assert.equal(status(f).ready,false);
 }finally{await f.close();}
});

test('a backwards clock cannot make old activity look fresh',async()=>{
 const f=fixture();try{
  await f.poll();await f.poll();f.setTime(99999);
  assert.equal(status(f).ready,false);assert.equal(status(f).state,'stale');
 }finally{await f.close();}
});

test('collector accessors cannot execute or inject private diagnostics into a health report',async()=>{
 const f=fixture();let invoked=false;
 try{
  await f.poll();await f.poll();
  const sample=Object.defineProperty({...f.sample()},'observedAt',{get(){invoked=true;throw Error('private sample');}});
  let result:ReturnType<typeof status>|undefined;
  assert.doesNotThrow(()=>{result=status(f,sample);});
  assert.equal(invoked,false);assert.equal(result!.ready,false);assert.equal(result!.state,'stale');
  assert.equal(result!.queueAgeSeconds,null);assert.doesNotMatch(JSON.stringify(result),/private/);
 }finally{await f.close();}
});

test('aggregate poll freshness reports the older consumer rather than hiding it behind the newest poll',async()=>{
 const f=fixture();try{
  await f.poll();f.setTime(110000);await f.poll();
  assert.equal(status(f).lastPollAgeMs,10000);assert.equal(status(f).ready,true);
 }finally{await f.close();}
});
