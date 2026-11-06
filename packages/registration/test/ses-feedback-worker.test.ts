import assert from 'node:assert/strict';
import {test} from 'node:test';
import {admitMailAttempt} from '../src/mail-attempts.ts';
import {transaction} from '../src/transaction.ts';
import {lockMailScope} from '../src/recipient-suppression.ts';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture,config,keys} from './fixtures/mail-attempt.ts';
import {feedbackEnvelope,feedbackEvent} from './fixtures/ses-feedback.ts';

async function workerModule() {
 // Assert the missing behavior before opening a database fixture.
 return import('../src/ses-feedback-worker.ts').catch(()=>assert.fail('The SES feedback queue consumer is missing'));
}
async function setup() {
 const f=await fixture();
 try {
  const admission=await transaction(f.pool,async c=>admitMailAttempt(c,await f.account('owner@example.test')));
  const event=feedbackEvent();event.mail.tags['waitron-attempt']=[admission.attemptTag];
  return {...f,body:JSON.stringify(feedbackEnvelope(event))};
 } catch(error){await f.close();throw error;}
}
async function counts(f:Awaited<ReturnType<typeof setup>>) {
 return (await f.pool.query(`SELECT (SELECT count(*) FROM mail_feedback_receipts)::int AS receipts,
  (SELECT count(*) FROM mail_feedback_events)::int AS events,(SELECT count(*) FROM mail_suppressions)::int AS blocks`)).rows[0];
}
function queue(body:string) {
 const deleted:string[]=[];
 return {deleted,async receive(_signal:AbortSignal){return [{body,receiptHandle:'private-handle'}];},
  async delete(handle:string,_signal:AbortSignal){deleted.push(handle);},close(){}};
}

test('queue deletion observes feedback committed through another database connection',async()=>{
 const {SesFeedbackWorker}=await workerModule(),f=await setup();
 try {
  const q=queue(f.body),observed:unknown[]=[];
  q.delete=async handle=>{observed.push(await counts(f));q.deleted.push(handle);};
  const w=new SesFeedbackWorker({pool:f.pool,config:config(),recipientKeys:keys,queue:q});
  assert.equal(await w.runOnce(new AbortController().signal),true);
  assert.deepEqual(observed,[{receipts:1,events:1,blocks:1}]);
  assert.deepEqual(q.deleted,['private-handle']);
 }finally{await f.close();}
});

test('malformed queue input remains unacknowledged and creates no database result',async()=>{
 const {SesFeedbackWorker}=await workerModule(),f=await setup();
 try {
  const q=queue('private raw recipient and token');
  const w=new SesFeedbackWorker({pool:f.pool,config:config(),recipientKeys:keys,queue:q});
  await assert.rejects(w.runOnce(new AbortController().signal),/^Error: ses_feedback_parse_failed$/);
  assert.deepEqual(q.deleted,[]);assert.deepEqual(await counts(f),{receipts:0,events:0,blocks:0});
 }finally{await f.close();}
});

test('commit refusal rolls back feedback and never acknowledges; retry commits once',async()=>{
 const {SesFeedbackWorker}=await workerModule(),f=await setup();
 try {
  await f.pool.query(`CREATE FUNCTION refuse_feedback_commit() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN RAISE EXCEPTION 'private database failure'; END $$;
   CREATE CONSTRAINT TRIGGER refuse_feedback_commit AFTER INSERT ON mail_feedback_receipts
   DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION refuse_feedback_commit()`);
  const q=queue(f.body),w=new SesFeedbackWorker({pool:f.pool,config:config(),recipientKeys:keys,queue:q});
  await assert.rejects(w.runOnce(new AbortController().signal),/^Error: ses_feedback_processing_failed$/);
  assert.deepEqual(q.deleted,[]);assert.deepEqual(await counts(f),{receipts:0,events:0,blocks:0});
  await f.pool.query('DROP TRIGGER refuse_feedback_commit ON mail_feedback_receipts');
  assert.equal(await w.runOnce(new AbortController().signal),true);
  assert.deepEqual(q.deleted,['private-handle']);assert.deepEqual(await counts(f),{receipts:1,events:1,blocks:1});
 }finally{await f.close();}
});

test('delete failure after commit replays without another durable effect',async()=>{
 const {SesFeedbackWorker}=await workerModule(),f=await setup();
 try {
  const q=queue(f.body);let fail=true;
  q.delete=async handle=>{if(fail)throw Error('private receipt handle');q.deleted.push(handle);};
  const w=new SesFeedbackWorker({pool:f.pool,config:config(),recipientKeys:keys,queue:q});
  await assert.rejects(w.runOnce(new AbortController().signal),/^Error: ses_feedback_acknowledgement_failed$/);
  assert.deepEqual(await counts(f),{receipts:1,events:1,blocks:1});assert.deepEqual(q.deleted,[]);
  fail=false;assert.equal(await w.runOnce(new AbortController().signal),true);
  assert.deepEqual(await counts(f),{receipts:1,events:1,blocks:1});assert.deepEqual(q.deleted,['private-handle']);
 }finally{await f.close();}
});

test('a changed duplicate stays unacknowledged and cannot overwrite original feedback',async()=>{
 const {SesFeedbackWorker}=await workerModule(),f=await setup();
 try {
  const q=queue(f.body),w=new SesFeedbackWorker({pool:f.pool,config:config(),recipientKeys:keys,queue:q});
  await w.runOnce(new AbortController().signal);
  q.deleted.length=0;const saved=(await f.pool.query('SELECT * FROM mail_feedback_receipts')).rows;
  const envelope=JSON.parse(f.body);envelope.extra='changed transport';
  q.receive=async()=>[{body:JSON.stringify(envelope),receiptHandle:'changed-private-handle'}];
  await assert.rejects(w.runOnce(new AbortController().signal),/^Error: ses_feedback_conflict$/);
  assert.deepEqual(q.deleted,[]);assert.deepEqual((await f.pool.query('SELECT * FROM mail_feedback_receipts')).rows,saved);
  assert.deepEqual(await counts(f),{receipts:1,events:1,blocks:1});
 }finally{await f.close();}
});

test('two consumers after visibility expiry acknowledge one durable feedback effect',async()=>{
 const {SesFeedbackWorker}=await workerModule(),f=await setup();
 try {
  const a=queue(f.body),b=queue(f.body);
  b.receive=async()=>[{body:f.body,receiptHandle:'second-private-handle'}];
  const first=new SesFeedbackWorker({pool:f.pool,config:config(),recipientKeys:keys,queue:a});
  const second=new SesFeedbackWorker({pool:f.pool,config:config(),recipientKeys:keys,queue:b});
  assert.deepEqual(await Promise.all([first.runOnce(new AbortController().signal),second.runOnce(new AbortController().signal)]),[true,true]);
  assert.deepEqual(a.deleted,['private-handle']);assert.deepEqual(b.deleted,['second-private-handle']);
  assert.deepEqual(await counts(f),{receipts:1,events:1,blocks:1});
 }finally{await f.close();}
});

test('recorded unresolved feedback can be acknowledged without guessing a recipient',async()=>{
 const {SesFeedbackWorker}=await workerModule(),f=await setup();
 try {
  const event=feedbackEvent(),q=queue(JSON.stringify(feedbackEnvelope(event)));
  const w=new SesFeedbackWorker({pool:f.pool,config:config(),recipientKeys:keys,queue:q});
  assert.equal(await w.runOnce(new AbortController().signal),true);
  assert.deepEqual(await counts(f),{receipts:1,events:0,blocks:0});assert.deepEqual(q.deleted,['private-handle']);
 }finally{await f.close();}
});

test('shutdown before receive starts no queue work; shutdown after receive creates no result',async()=>{
 const {SesFeedbackWorker}=await workerModule(),f=await setup();
 try {
  const stop=new AbortController(),q=queue(f.body);let receives=0;
  q.receive=async signal=>{assert.equal(signal,stop.signal);receives++;stop.abort();return [{body:f.body,receiptHandle:'private-handle'}];};
  const w=new SesFeedbackWorker({pool:f.pool,config:config(),recipientKeys:keys,queue:q});
  assert.equal(await w.runOnce(stop.signal),false);assert.equal(await w.runOnce(stop.signal),false);
  assert.equal(receives,1);assert.deepEqual(q.deleted,[]);assert.deepEqual(await counts(f),{receipts:0,events:0,blocks:0});
 }finally{await f.close();}
});

test('empty polls return idle and transport failures expose only fixed diagnostics',async()=>{
 const {SesFeedbackWorker}=await workerModule(),f=await setup();
 try {
  const q=queue(f.body);q.receive=async()=>[];
  const w=new SesFeedbackWorker({pool:f.pool,config:config(),recipientKeys:keys,queue:q});
  assert.equal(await w.runOnce(new AbortController().signal),false);
  q.receive=async()=>{throw Error('private response body');};
  await assert.rejects(w.runOnce(new AbortController().signal),/^Error: ses_feedback_receive_failed$/);
  assert.deepEqual(q.deleted,[]);assert.deepEqual(await counts(f),{receipts:0,events:0,blocks:0});
 }finally{await f.close();}
});

test('an oversized receive batch remains entirely unacknowledged',async()=>{
 const {SesFeedbackWorker}=await workerModule(),f=await setup();
 try {
  const q=queue(f.body);q.receive=async()=>[{body:f.body,receiptHandle:'first'},{body:f.body,receiptHandle:'second'}];
  const w=new SesFeedbackWorker({pool:f.pool,config:config(),recipientKeys:keys,queue:q});
  await assert.rejects(w.runOnce(new AbortController().signal),/^Error: ses_feedback_receive_failed$/);
  assert.deepEqual(q.deleted,[]);assert.deepEqual(await counts(f),{receipts:0,events:0,blocks:0});
 }finally{await f.close();}
});


test('shutdown while database work waits leaves the eventual commit unacknowledged',async()=>{
 const {SesFeedbackWorker}=await workerModule(),f=await setup();
 const blocker=await f.pool.connect();let pending:Promise<boolean>|undefined;
 try {
  await blocker.query('BEGIN');await lockMailScope(blocker,config().scope);
  const stop=new AbortController(),q=queue(f.body);
  const w=new SesFeedbackWorker({pool:f.pool,config:config(),recipientKeys:keys,queue:q});
  pending=w.runOnce(stop.signal);
  const deadline=performance.now()+2000;let blocked=false;
  while(performance.now()<deadline){
   const r=await f.admin.query(`SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event='advisory'`,[f.schema]);
   if(r.rowCount){blocked=true;break;}await delay(10);
  }
  assert.equal(blocked,true,'feedback must reach the actual database lock wait');
  assert.deepEqual(q.deleted,[]);stop.abort();await blocker.query('ROLLBACK');
  assert.equal(await pending,false);assert.deepEqual(q.deleted,[]);
  assert.deepEqual(await counts(f),{receipts:1,events:1,blocks:1});
 }finally{await blocker.query('ROLLBACK');blocker.release();await pending?.catch(()=>{});await f.close();}
});
