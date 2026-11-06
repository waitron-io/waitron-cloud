import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {SesFeedbackWorker} from '../src/ses-feedback-worker.ts';
import {admitMailAttempt} from '../src/mail-attempts.ts';
import {transaction} from '../src/transaction.ts';
import {lockMailScope} from '../src/recipient-suppression.ts';
import {fixture,config,keys} from './fixtures/mail-attempt.ts';
import {feedbackEnvelope,feedbackEvent} from './fixtures/ses-feedback.ts';

async function setup() {
 const f=await fixture();let now=100000;
 try{
  const admission=await transaction(f.pool,async c=>admitMailAttempt(c,await f.account('owner@example.test')));
  const event=feedbackEvent();event.mail.tags['waitron-attempt']=[admission.attemptTag];
  const body=JSON.stringify(feedbackEnvelope(event)),deleted:string[]=[],settings=config();
  const queue={async receive():Promise<{body:string;receiptHandle:string}[]>{return [];},
   async delete(handle:string){deleted.push(handle);},close(){}};
  const worker=new SesFeedbackWorker({pool:f.pool,config:settings,recipientKeys:keys,queue,now:()=>now});
  await worker.runOnce(new AbortController().signal);await worker.runOnce(new AbortController().signal);
  return {...f,body,deleted,queue,worker,setTime(value:number){now=value;},
   status(){return worker.status({observedAt:now,queueAgeSeconds:0,deadLetterCount:0,
    configurationRevision:settings.revision,configurationDrift:false});}};
 }catch(error){await f.close();throw error;}
}

test('a real lock wait exceeding the processing budget closes readiness while its poll is still fresh',async()=>{
 const f=await setup(),blocker=await f.pool.connect();let work:Promise<boolean>|undefined;
 try{
  await blocker.query('BEGIN');await lockMailScope(blocker,config().scope);
  f.queue.receive=async()=>[{body:f.body,receiptHandle:'private-handle'}];
  work=f.worker.runOnce(new AbortController().signal);
  const until=performance.now()+2000;let blocked=false;
  while(performance.now()<until){
   if((await f.admin.query(`SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event='advisory'`,[f.schema])).rowCount){blocked=true;break;}
   await delay(10);
  }
  assert.equal(blocked,true);assert.equal(f.status().ready,true);
  f.setTime(105000);assert.equal(f.status().state,'stale');assert.equal(f.status().ready,false);
  assert.equal(f.status().lastCommitAgeMs,null);assert.deepEqual(f.deleted,[]);
 }finally{await blocker.query('ROLLBACK');blocker.release();await work;await f.close();}
});

test('health records durable commit separately from acknowledgement and uses the delete phase deadline',async()=>{
 const f=await setup();let release:()=>void=()=>{},entered:()=>void=()=>{};
 const deleting=new Promise<void>(resolve=>{entered=resolve;});let work:Promise<boolean>|undefined;
 try{
  f.queue.receive=async()=>{f.setTime(110000);return [{body:f.body,receiptHandle:'private-handle'}];};
  f.queue.delete=async handle=>{entered();await new Promise<void>(resolve=>{release=resolve;});f.deleted.push(handle);};
  work=f.worker.runOnce(new AbortController().signal);await deleting;
  const committed=await f.pool.query('SELECT count(*)::int AS n FROM mail_feedback_receipts');
  assert.equal(committed.rows[0].n,1);assert.deepEqual(f.deleted,[]);
  f.setTime(120000);assert.equal(f.status().lastCommitAgeMs,10000);assert.equal(f.status().ready,true);
  f.setTime(125000);assert.equal(f.status().state,'stale');assert.equal(f.status().ready,false);
 }finally{release();await work;await f.close();}
});

test('a failed delete retains committed freshness and failure until its consumer slot recovers by replay',async()=>{
 const f=await setup();try{
  f.queue.receive=async()=>[{body:f.body,receiptHandle:'private-handle'}];
  f.queue.delete=async()=>{throw Error('private provider response');};
  await assert.rejects(f.worker.runOnce(new AbortController().signal),/^Error: ses_feedback_acknowledgement_failed$/);
  f.setTime(101000);assert.equal(f.status().lastCommitAgeMs,1000);
  f.queue.receive=async()=>[];await f.worker.runOnce(new AbortController().signal);
  assert.equal(f.status().ready,false);assert.equal(f.status().failure,'ses_feedback_acknowledgement_failed');
  f.queue.receive=async()=>[{body:f.body,receiptHandle:'replacement-handle'}];
  f.queue.delete=async handle=>{f.deleted.push(handle);};
  await f.worker.runOnce(new AbortController().signal);
  assert.equal(f.status().ready,true);assert.equal(f.status().lastCommitAgeMs,0);
  assert.deepEqual(f.deleted,['replacement-handle']);
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM mail_feedback_receipts')).rows[0].n,1);
  assert.doesNotMatch(JSON.stringify(f.status()),/private|provider response|replacement-handle/);
 }finally{await f.close();}
});
