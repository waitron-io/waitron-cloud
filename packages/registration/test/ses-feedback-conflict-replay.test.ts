import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fixture,config,keys} from './fixtures/mail-attempt.ts';
import {feedbackEvent,feedbackEnvelope} from './fixtures/ses-feedback.ts';
import {transaction} from '../src/transaction.ts';
import {admitMailAttempt} from '../src/mail-attempts.ts';
import {parseSesFeedback} from '../src/ses-feedback-event.ts';
import {applySesFeedback} from '../src/ses-feedback-store.ts';
import {SesFeedbackWorker} from '../src/ses-feedback-worker.ts';

async function setup(){
 const f=await fixture();try{
  const admitted=await transaction(f.pool,async c=>admitMailAttempt(c,await f.account('owner@example.test')));
  const event=feedbackEvent();event.mail.tags['waitron-attempt']=[admitted.attemptTag];
  return {...f,event};
 }catch(error){await f.close();throw error;}
}

for(const kind of ['recipient','provider'] as const)test(`a stored ${kind} binding conflict remains unacknowledged through all five exact deliveries`,async()=>{
 const f=await setup();try{
  const settings=config();
  if(kind==='provider'){
   assert.equal(await applySesFeedback(f.pool,settings,keys,parseSesFeedback(JSON.stringify(feedbackEnvelope(f.event)),settings)),'applied');
   f.event.mail.messageId='conflicting-provider';f.event.bounce.feedbackId='conflicting-feedback';
  }else{
   f.event.mail.destination=['other@example.test'];f.event.bounce.bouncedRecipients=[{emailAddress:'other@example.test'}];
  }
  const envelope=feedbackEnvelope(f.event);envelope.MessageId='conflicting-transport';const body=JSON.stringify(envelope),deleted:string[]=[];
  const queue={async receive(){return [{body,receiptHandle:'private-conflict-handle'}];},async delete(handle:string){deleted.push(handle);},close(){}};
  const worker=new SesFeedbackWorker({pool:f.pool,config:settings,recipientKeys:keys,queue});
  await assert.rejects(worker.runOnce(new AbortController().signal),/^Error: ses_feedback_conflict$/);
  const saved=(await f.pool.query('SELECT * FROM mail_feedback_receipts ORDER BY sns_id')).rows;
  // Transport deduplication keeps its existing meaning; the queue also needs the stored disposition.
  assert.equal(await applySesFeedback(f.pool,settings,keys,parseSesFeedback(body,settings)),'duplicate');
  for(let delivery=2;delivery<=5;delivery++){
   await assert.rejects(worker.runOnce(new AbortController().signal),/^Error: ses_feedback_conflict$/,`delivery ${delivery}`);
   assert.deepEqual(deleted,[]);
  }
  assert.deepEqual((await f.pool.query('SELECT * FROM mail_feedback_receipts ORDER BY sns_id')).rows,saved);
  const status=worker.status({observedAt:Date.now(),queueAgeSeconds:60,deadLetterCount:0,
   configurationRevision:settings.revision,configurationDrift:false});
  assert.equal(status.ready,false);assert.equal(status.failure,'ses_feedback_conflict');
  const counts=(await f.pool.query(`SELECT (SELECT count(*) FROM mail_feedback_events)::int AS events,
   (SELECT count(*) FROM mail_suppressions)::int AS blocks`)).rows[0];
  assert.deepEqual(counts,kind==='provider'?{events:1,blocks:1}:{events:0,blocks:0});
 }finally{await f.close();}
});

test('competing copies of one binding-conflict envelope all remain unacknowledged',async()=>{
 const f=await setup();try{
  f.event.mail.destination=['other@example.test'];f.event.bounce.bouncedRecipients=[{emailAddress:'other@example.test'}];
  const body=JSON.stringify(feedbackEnvelope(f.event)),deleted:string[]=[];
  const queue={async receive(){return [{body,receiptHandle:'private-conflict-handle'}];},async delete(handle:string){deleted.push(handle);},close(){}};
  const worker=new SesFeedbackWorker({pool:f.pool,config:config(),recipientKeys:keys,queue});
  const outcomes=await Promise.allSettled([worker.runOnce(new AbortController().signal),worker.runOnce(new AbortController().signal)]);
  assert.deepEqual(outcomes.map(r=>r.status==='rejected'?(r.reason as Error).message:r.value),['ses_feedback_conflict','ses_feedback_conflict']);
  assert.deepEqual(deleted,[]);assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM mail_feedback_receipts')).rows[0].n,1);
 }finally{await f.close();}
});

test('cancelling deletion retains committed feedback without recording an acknowledgement failure',async()=>{
 const f=await setup();try{
  const settings=config(),stop=new AbortController(),deleted:string[]=[],body=JSON.stringify(feedbackEnvelope(f.event));
  const queue={async receive(){return [{body,receiptHandle:'private-handle'}];},
   async delete(_handle:string,_signal:AbortSignal):Promise<void>{stop.abort();throw Error('private cancellation');},close(){}};
  const worker=new SesFeedbackWorker({pool:f.pool,config:settings,recipientKeys:keys,queue});
  const work=worker.runOnce(stop.signal);await assert.doesNotReject(work);assert.equal(await work,false);
  assert.equal(worker.status({observedAt:Date.now(),queueAgeSeconds:0,deadLetterCount:0,
   configurationRevision:settings.revision,configurationDrift:false}).failure,null);
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM mail_feedback_receipts')).rows[0].n,1);
  queue.delete=async handle=>{deleted.push(handle);};
  assert.equal(await worker.runOnce(new AbortController().signal),true);assert.deepEqual(deleted,['private-handle']);
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM mail_feedback_receipts')).rows[0].n,1);
 }finally{await f.close();}
});
