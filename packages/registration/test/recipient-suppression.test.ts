import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';
import {test} from 'node:test';
import {transaction} from '../src/transaction.ts';
import {admitMailAttempt} from '../src/mail-attempts.ts';
import {lockMailScope,recipientIsSuppressed} from '../src/recipient-suppression.ts';
import {fixture,config,keys,rotated} from './fixtures/mail-attempt.ts';
const digest=(key:string)=>createHmac('sha256',Buffer.from(key,'hex')).update(JSON.stringify(['waitron-mail-recipient-v1','original@example.test'])).digest('hex');

test('scope lock requires a transaction and serialises every key version until commit',async()=>{
 const f=await fixture(),held=await f.pool.connect(),other=await f.pool.connect();let waiting:Promise<void>|undefined;
 try{
  await assert.rejects(lockMailScope(held,config().scope),/mail_transaction_required/);
  await assert.rejects(recipientIsSuppressed(held,config().scope,[]),/mail_transaction_required/);
  await held.query('BEGIN');await lockMailScope(held,config().scope);
  await other.query('BEGIN');let acquired=false;
  const otherPid=(await other.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  waiting=lockMailScope(other,config().scope).then(()=>{acquired=true;});void waiting.catch(()=>{});
  let blocked=false;const until=performance.now()+3000;
  do{blocked=(await f.admin.query('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked',[otherPid])).rows[0].blocked;if(!blocked)await setImmediate();}while(!blocked&&performance.now()<until);
  assert.equal(blocked,true,'second connection waits on the shared scope lock');assert.equal(acquired,false);
  await transaction(f.pool,c=>lockMailScope(c,config('eu-west-3').scope));
  await held.query('COMMIT');await waiting;assert.equal(acquired,true);
 }finally{await held.query('ROLLBACK');await other.query('ROLLBACK');await waiting;held.release();other.release();await f.close();}
});

test('old-version suppression covers new admissions and both purposes only within its country/provider scope',async()=>{
 const f=await fixture();try{
  const input=await f.account();const admitted=await transaction(f.pool,c=>admitMailAttempt(c,input));
  const event=randomUUID();
  await f.pool.query(`INSERT INTO mail_feedback_events(id,attempt_tag,country,provider_account_id,region,recipient_identity,event_identity,kind,event_time)
   VALUES($1,$2,'ES','123456789012','eu-north-1',repeat('a',64),'bounce-1','hard_bounce',clock_timestamp())`,[event,admitted.attemptTag]);
  await f.pool.query(`INSERT INTO mail_suppressions(country,provider_account_id,region,key_id,digest,reason,event_id)
   VALUES('ES','123456789012','eu-north-1','v1',$1,'hard_bounce',$2)`,[digest(keys.keys.v1),event]);
  const refs=[{keyId:'v2',digest:digest(rotated.keys.v2)},{keyId:'v1',digest:digest(keys.keys.v1)}];
  assert.equal(await transaction(f.pool,c=>recipientIsSuppressed(c,config().scope,refs)),true);
  assert.equal(await transaction(f.pool,c=>recipientIsSuppressed(c,config('eu-west-3').scope,refs)),false);
  assert.equal(await transaction(f.pool,c=>recipientIsSuppressed(c,config('eu-north-1','FR').scope,refs)),false);
  assert.equal(await transaction(f.pool,c=>recipientIsSuppressed(c,config().scope,[{keyId:'v1',digest:'b'.repeat(64)}])),false);
  const fresh=await f.account();await assert.rejects(transaction(f.pool,c=>admitMailAttempt(c,{...fresh,recipientKeys:rotated})),/mail_recipient_suppressed/);
 }finally{await f.close();}
});

test('suppression refuses an empty recipient-reference list inside a transaction',async()=>{
 const f=await fixture();try{
  await assert.rejects(transaction(f.pool,c=>recipientIsSuppressed(c,config().scope,[])),/mail_keys_unavailable/);
 }finally{await f.close();}
});

test('admission takes the shared scope lock before locking a queue row',async()=>{
 const f=await fixture(),held=await f.pool.connect(),worker=await f.pool.connect(),probe=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  const input=await f.account();await held.query('BEGIN');await lockMailScope(held,input.config.scope);
  const blocker=(await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  await worker.query('BEGIN');const pid=(await worker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  pending=admitMailAttempt(worker,input);void pending.catch(()=>{});
  let blocked=false;const until=performance.now()+3000;
  do{blocked=(await f.admin.query('SELECT $2=ANY(pg_blocking_pids($1)) AS blocked',[pid,blocker])).rows[0].blocked;if(!blocked)await setImmediate();}while(!blocked&&performance.now()<until);
  assert.equal(blocked,true,'admission waits on our scope lock');
  await probe.query('BEGIN');assert.equal((await probe.query('SELECT id FROM email_outbox WHERE id=$1 FOR UPDATE NOWAIT',[input.claim.outboxId])).rowCount,1);
  await probe.query('ROLLBACK');await held.query('ROLLBACK');await pending;
 }finally{await probe.query('ROLLBACK');await held.query('ROLLBACK');await pending?.catch(()=>{});await worker.query('ROLLBACK');probe.release();held.release();worker.release();await f.close();}
});
