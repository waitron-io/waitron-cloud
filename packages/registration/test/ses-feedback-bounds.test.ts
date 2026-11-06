import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Pool,type PoolClient} from 'pg';
import {setTimeout as delay} from 'node:timers/promises';
import {SesFeedbackWorker} from '../src/ses-feedback-worker.ts';
import {admitMailAttempt} from '../src/mail-attempts.ts';
import {transaction} from '../src/transaction.ts';
import {lockMailScope} from '../src/recipient-suppression.ts';
import {fixture,config,keys} from './fixtures/mail-attempt.ts';
import {feedbackEnvelope,feedbackEvent} from './fixtures/ses-feedback.ts';

async function setup() {
 const f=await fixture();
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:1,application_name:f.schema+'_bounded',
  options:`-c search_path=${f.schema} -c statement_timeout=0 -c lock_timeout=0 -c transaction_timeout=0`});
 const acquired=new Set<PoolClient>();pool.on('acquire',client=>acquired.add(client));
 pool.on('connect',client=>client.on('error',()=>{}));
 pool.on('error',()=>{});
 try{
  const admission=await transaction(f.pool,async c=>admitMailAttempt(c,await f.account('owner@example.test')));
  const event=feedbackEvent();event.mail.tags['waitron-attempt']=[admission.attemptTag];
  const deleted:string[]=[],body=JSON.stringify(feedbackEnvelope(event));
  const queue={async receive(){return [{body,receiptHandle:'private-handle'}];},
   async delete(handle:string){deleted.push(handle);},close(){}};
  return {...f,pool,source:f.pool,deleted,queue,worker:new SesFeedbackWorker({pool,config:config(),recipientKeys:keys,queue}),
   async counts(){return (await f.pool.query(`SELECT (SELECT count(*) FROM mail_feedback_receipts)::int AS receipts,
    (SELECT count(*) FROM mail_feedback_events)::int AS events,(SELECT count(*) FROM mail_suppressions)::int AS blocks`)).rows[0];},
   async close(){
    // Fault-injection tests still own and close clients when the release guard is absent.
    for(const client of acquired)try{client.release(true);}catch{}
    await pool.end();await f.close();
   }};
 }catch(error){await pool.end();await f.close();throw error;}
}
function outcome(work:Promise<boolean>) {
 return work.then(value=>({value,error:null}),(error:unknown)=>({value:null,error:error instanceof Error?error.message:'non_error'}));
}
async function bounded(work:ReturnType<typeof outcome>) {
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([work,new Promise<'still running'>(resolve=>{timer=setTimeout(()=>resolve('still running'),6500);})]);}
 finally{clearTimeout(timer);}
}
async function noBackend(f:Awaited<ReturnType<typeof setup>>) {
 const deadline=performance.now()+2000;
 while(performance.now()<deadline){
  const r=await f.admin.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1',[f.schema+'_bounded']);
  if(r.rowCount===0)return;
  await delay(20);
 }
 assert.fail('expired feedback connection must leave PostgreSQL');
}

test('feedback deletion requires a commit visible through a separate observer pool',async()=>{
 const f=await setup();
 try{
  f.queue.delete=async handle=>{
   assert.deepEqual(await f.counts(),{receipts:1,events:1,blocks:1});
   f.deleted.push(handle);
  };
  await assert.doesNotReject(f.worker.runOnce(new AbortController().signal));
  assert.deepEqual(f.deleted,['private-handle']);
  assert.deepEqual(await f.counts(),{receipts:1,events:1,blocks:1});
 }finally{await f.close();}
});

test('feedback connection acquisition expires within the total budget and a late connection cannot process the message',async()=>{
 const f=await setup(),held=await f.pool.connect();let pending:ReturnType<typeof outcome>|undefined,released=false;
 try{
  pending=outcome(f.worker.runOnce(new AbortController().signal));
  assert.deepEqual(await bounded(pending),{value:null,error:'ses_feedback_processing_failed'});
  assert.deepEqual(f.deleted,[]);assert.deepEqual(await f.counts(),{receipts:0,events:0,blocks:0});
  held.release();released=true;
  await noBackend(f);
  assert.equal(f.pool.waitingCount,0);
  assert.deepEqual(f.deleted,[]);assert.deepEqual(await f.counts(),{receipts:0,events:0,blocks:0});
 }finally{if(!released)held.release();await pending;await f.close();}
});

test('feedback lock timeout closes its backend and leaves the message available for a successful replay',async()=>{
 const f=await setup(),blocker=await f.source.connect();let pending:ReturnType<typeof outcome>|undefined;
 try{
  await blocker.query('BEGIN');await lockMailScope(blocker,config().scope);
  pending=outcome(f.worker.runOnce(new AbortController().signal));
  assert.deepEqual(await bounded(pending),{value:null,error:'ses_feedback_processing_failed'});
  await noBackend(f);assert.equal(f.pool.totalCount,0);assert.deepEqual(f.deleted,[]);
  assert.deepEqual(await f.counts(),{receipts:0,events:0,blocks:0});
  await blocker.query('ROLLBACK');
  assert.equal(await f.worker.runOnce(new AbortController().signal),true);
  assert.deepEqual(f.deleted,['private-handle']);assert.deepEqual(await f.counts(),{receipts:1,events:1,blocks:1});
  const settings=(await f.pool.query('SHOW transaction_timeout')).rows[0];
  assert.deepEqual(settings,{transaction_timeout:'0'},'transaction-local limits cannot leak to later borrowers');
 }finally{await blocker.query('ROLLBACK');blocker.release();await pending;await f.close();}
});

test('several individually short database statements cannot reset the five-second total processing budget',async()=>{
 const f=await setup();let pending:ReturnType<typeof outcome>|undefined;
 try{
  await f.source.query(`CREATE FUNCTION slow_feedback_write() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN PERFORM pg_sleep(2.8); RETURN NEW; END $$;
   CREATE TRIGGER slow_feedback_event BEFORE INSERT ON mail_feedback_events FOR EACH ROW EXECUTE FUNCTION slow_feedback_write();
   CREATE TRIGGER slow_feedback_receipt BEFORE INSERT ON mail_feedback_receipts FOR EACH ROW EXECUTE FUNCTION slow_feedback_write()`);
  pending=outcome(f.worker.runOnce(new AbortController().signal));
  assert.deepEqual(await bounded(pending),{value:null,error:'ses_feedback_processing_failed'});
  await noBackend(f);assert.equal(f.pool.totalCount,0);assert.deepEqual(f.deleted,[]);
  assert.deepEqual(await f.counts(),{receipts:0,events:0,blocks:0});
 }finally{await pending;await f.close();}
});

test('a stalled deferred commit cannot acknowledge or commit later after the processing budget expires',async()=>{
 const f=await setup();let pending:ReturnType<typeof outcome>|undefined;
 try{
  await f.source.query(`CREATE FUNCTION slow_feedback_commit() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN PERFORM pg_sleep(7); RETURN NEW; END $$;
   CREATE CONSTRAINT TRIGGER slow_feedback_commit AFTER INSERT ON mail_feedback_receipts
   DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION slow_feedback_commit()`);
  pending=outcome(f.worker.runOnce(new AbortController().signal));
  assert.deepEqual(await bounded(pending),{value:null,error:'ses_feedback_processing_failed'});
  await noBackend(f);assert.equal(f.pool.totalCount,0);assert.deepEqual(f.deleted,[]);
  assert.deepEqual(await f.counts(),{receipts:0,events:0,blocks:0});
 }finally{await pending;await f.close();}
});

test('time spent acquiring a connection reduces the remaining transaction budget',async()=>{
 const f=await setup(),held=await f.pool.connect();let pending:ReturnType<typeof outcome>|undefined,released=false;
 try{
  await f.source.query(`CREATE FUNCTION delayed_feedback_write() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN PERFORM pg_sleep(3.5); RETURN NEW; END $$;
   CREATE TRIGGER delayed_feedback_write BEFORE INSERT ON mail_feedback_events FOR EACH ROW EXECUTE FUNCTION delayed_feedback_write()`);
  const started=performance.now();
  pending=outcome(f.worker.runOnce(new AbortController().signal));
  await delay(2500);held.release();released=true;
  assert.deepEqual(await bounded(pending),{value:null,error:'ses_feedback_processing_failed'});
  assert.ok(performance.now()-started<6500,'acquisition and transaction share one deadline');
  await noBackend(f);assert.equal(f.pool.totalCount,0);assert.deepEqual(f.deleted,[]);
  assert.deepEqual(await f.counts(),{receipts:0,events:0,blocks:0});
 }finally{if(!released)held.release();await pending;await f.close();}
});

test('database disconnection during processing retains the message and a fresh connection can replay it',async()=>{
 const f=await setup(),blocker=await f.source.connect();let pending:ReturnType<typeof outcome>|undefined;
 try{
  await blocker.query('BEGIN');await lockMailScope(blocker,config().scope);
  pending=outcome(f.worker.runOnce(new AbortController().signal));
  const deadline=performance.now()+3000;let pid:number|undefined;
  while(performance.now()<deadline){
   const r=await f.admin.query(`SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND wait_event='advisory'`,[f.schema+'_bounded']);
   if(r.rowCount){pid=r.rows[0].pid;break;}await delay(10);
  }
  assert.ok(pid,'feedback must reach its real database lock before disconnection');
  await f.admin.query('SELECT pg_terminate_backend($1)',[pid]);
  assert.deepEqual(await bounded(pending),{value:null,error:'ses_feedback_processing_failed'});
  await noBackend(f);assert.equal(f.pool.totalCount,0);assert.deepEqual(f.deleted,[]);
  assert.deepEqual(await f.counts(),{receipts:0,events:0,blocks:0});
  await blocker.query('ROLLBACK');
  assert.equal(await f.worker.runOnce(new AbortController().signal),true);
  assert.deepEqual(f.deleted,['private-handle']);assert.deepEqual(await f.counts(),{receipts:1,events:1,blocks:1});
 }finally{await blocker.query('ROLLBACK');blocker.release();await pending;await f.close();}
});
