import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setImmediate} from 'node:timers/promises';
import {createSession} from '@waitron-cloud/identity';
import {randomUUID} from 'node:crypto';
import {EmailOutbox,EmailWorker} from '../src/email-outbox.ts';
import {admitMailAttempt} from '../src/mail-attempts.ts';
import {applySesFeedback} from '../src/ses-feedback-store.ts';
import {parseSesFeedback} from '../src/ses-feedback-event.ts';
import {feedbackEvent,feedbackEnvelope} from './fixtures/ses-feedback.ts';
import {RelayWorker} from '../src/relay-worker.ts';
import {mailRecipientRefs} from '../src/mail-attempts.ts';
import {lockMailScope,recipientIsSuppressed} from '../src/recipient-suppression.ts';
import {transaction} from '../src/transaction.ts';
import {fixture as relayFixture} from './fixtures/relay-worker.ts';
import {config,keys} from './fixtures/mail-attempt.ts';

const adminModule=await import('../src/mail-suppression-admin.ts').catch(error=>{
 if(error.code==='ERR_MODULE_NOT_FOUND')return {MailSuppressionAdmin:undefined};throw error;
});
async function actor(f:Awaited<ReturnType<typeof relayFixture>>,permitted=true){
 const id=randomUUID();await f.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[id]);
 if(permitted)await f.pool.query("INSERT INTO platform_permissions(account_id,permission) VALUES($1,'mail.suppression.unblock')",[id]);
 const session=await transaction(f.pool,c=>createSession(c,id));return {id,sessionToken:session.token,csrfToken:session.csrfToken};
}
const outbox=new EmailOutbox({activeKeyId:'payload',keys:{payload:'77'.repeat(32)}});
async function sharedBlock(f:Awaited<ReturnType<typeof relayFixture>>){
 const id=await transaction(f.pool,c=>outbox.enqueue(c,'password_changed',{email:'owner@example.test'})),claim=randomUUID();
 await f.pool.query("UPDATE email_outbox SET status='processing',claim_id=$2,lease_until=clock_timestamp()+interval '1 minute',attempts=1 WHERE id=$1",[id,claim]);
 const admission=await transaction(f.pool,c=>admitMailAttempt(c,{config:config(),recipientKeys:keys,recipient:'owner@example.test',claim:{purpose:'cloud-account-email',outboxId:id,claimId:claim,attempt:1}}));
 await f.pool.query("UPDATE email_outbox SET status='sent',payload=NULL,key_id=NULL,claim_id=NULL,lease_until=NULL,finished_at=clock_timestamp() WHERE id=$1",[id]);
 const raw=feedbackEvent();raw.mail.tags['waitron-attempt']=[admission.attemptTag];
 const event=parseSesFeedback(JSON.stringify(feedbackEnvelope(raw)),config());
 assert.equal(await applySesFeedback(f.pool,config(),keys,event),'applied');return event;
}
function service(f:Awaited<ReturnType<typeof relayFixture>>,provider={async query(){return [] as string[];},async remove(..._args:unknown[]){}},extra={}){
 return new adminModule.MailSuppressionAdmin!(f.pool,{ses:{config:config(),recipientKeys:keys},legacyKeys:f.config.suppressionKeys,provider,...extra});
}
async function request(_f:Awaited<ReturnType<typeof relayFixture>>,admin:ReturnType<typeof service>,operator:Awaited<ReturnType<typeof actor>>){
 const state=await admin.inspect(operator,config().scope,'owner@example.test');
 return admin.request(operator,config().scope,'owner@example.test',state.revision,'address_verified');
}

test('new blocking evidence advances the revision and refuses a stale operator request',async()=>{
 const f=await relayFixture();try{
  const event=await sharedBlock(f),operator=await actor(f),admin=service(f);
  const before=await admin.inspect(operator,config().scope,'owner@example.test');
  assert.equal(await applySesFeedback(f.pool,config(),keys,{...event,snsId:'revision-new',eventId:'revision-new',contentDigest:'e'.repeat(64)}),'applied');
  const after=await admin.inspect(operator,config().scope,'owner@example.test');
  assert.ok(after.revision>before.revision,'a genuinely new blocker advances the operator revision');
  await assert.rejects(admin.request(operator,config().scope,'owner@example.test',before.revision,'address_verified'),/mail_revision_conflict/);
 }finally{await f.close();}
});

test('provider work releases database locks and a blocker committed during it wins',async()=>{
 const f=await relayFixture();try{
  const event=await sharedBlock(f),operator=await actor(f);let committed=false;
  const admin=service(f,{async query(){if(!committed){assert.equal(await applySesFeedback(f.pool,config(),keys,{...event,snsId:'during-provider',eventId:'during-provider',contentDigest:'f'.repeat(64)}),'applied');committed=true;}return [];},async remove(){}});
  const op=await request(f,admin,operator),observation=await admin.reconcile(operator,op.operationId,'owner@example.test',new AbortController().signal);
  assert.equal(committed,true,'an independent feedback transaction commits during the provider query');
  assert.equal(await admin.finish(operator,op.operationId,observation),'blocked');
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_suppressions')).rows[0].count,'2');
 }finally{await f.close();}
});

test('a failed audit commit rolls back both stores and a lost acknowledgement can retry once',async()=>{
 const f=await relayFixture();try{
  await sharedBlock(f);const operator=await actor(f),admin=service(f);
  await new RelayWorker(f.pool,{...f.config,ses:{config:config(),recipientKeys:keys}}).suppress('owner@example.test');
  const op=await request(f,admin,operator),observation=await admin.reconcile(operator,op.operationId,'owner@example.test',new AbortController().signal);
  await f.pool.query("CREATE FUNCTION reject_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test_audit_failure'; END $$");
  await f.pool.query('CREATE TRIGGER reject_test_audit BEFORE INSERT ON mail_unblock_outcomes FOR EACH ROW EXECUTE FUNCTION reject_test_audit()');
  await assert.rejects(admin.finish(operator,op.operationId,observation),/test_audit_failure/);
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_suppressions')).rows[0].count,'1');assert.equal((await f.pool.query('SELECT count(*) FROM relay_suppressions')).rows[0].count,'1');
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_unblock_outcomes')).rows[0].count,'0');
  await f.pool.query('DROP TRIGGER reject_test_audit ON mail_unblock_outcomes');
  assert.equal(await admin.finish(operator,op.operationId,observation),'cleared');assert.equal(await admin.finish(operator,op.operationId,observation),'cleared');
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_unblock_outcomes')).rows[0].count,'1');
  for(const sql of ['DELETE FROM mail_unblock_outcomes',"UPDATE mail_unblock_outcomes SET result='blocked'",'TRUNCATE mail_unblock_outcomes CASCADE'])await assert.rejects(f.pool.query(sql),/mail_binding_immutable/);
 }finally{await f.close();}
});

test('session expiry during a real scope lock wait rolls back removal',async()=>{
 const f=await relayFixture(),held=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  await sharedBlock(f);const operator=await actor(f),admin=service(f),op=await request(f,admin,operator);
  const observation=await admin.reconcile(operator,op.operationId,'owner@example.test',new AbortController().signal);
  await held.query('BEGIN');await lockMailScope(held,config().scope);const blocker=(await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  await f.pool.query("UPDATE cloud_sessions SET absolute_expires_at=clock_timestamp()+interval '400 milliseconds' WHERE account_id=$1",[operator.id]);
  pending=admin.finish(operator,op.operationId,observation);void pending.catch(()=>{});
  let waiting=false;const until=performance.now()+3000;
  do{waiting=(await f.pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))",[f.schema,blocker])).rowCount!==0;if(!waiting)await setImmediate();}while(!waiting&&performance.now()<until);
  assert.equal(waiting,true,'the actual finisher waits on the held scope lock');
  await assert.doesNotReject(f.pool.query('SELECT event_id FROM mail_suppressions FOR UPDATE NOWAIT'),'the initial scope wait precedes every suppression write');
  while(!(await held.query('SELECT clock_timestamp()>=absolute_expires_at AS expired FROM cloud_sessions WHERE account_id=$1',[operator.id])).rows[0].expired)await setImmediate();
  await held.query('ROLLBACK');await assert.rejects(pending,/session_expired/);
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_suppressions')).rows[0].count,'1');assert.equal((await f.pool.query('SELECT count(*) FROM mail_unblock_outcomes')).rows[0].count,'0');
 }finally{await held.query('ROLLBACK');await pending?.catch(()=>{});held.release();await f.close();}
});

test('an observation cannot clear a different operation and a restart can obtain fresh evidence',async()=>{
 const f=await relayFixture();try{
  await sharedBlock(f);const operator=await actor(f),admin=service(f),a=await request(f,admin,operator),b=await request(f,admin,operator);
  const observation=await admin.reconcile(operator,a.operationId,'owner@example.test',new AbortController().signal);
  assert.equal(await admin.finish(operator,b.operationId,observation),'blocked');
  const restarted=service(f),fresh=await restarted.reconcile(operator,a.operationId,'owner@example.test',new AbortController().signal);
  assert.equal(await restarted.finish(operator,a.operationId,fresh),'cleared');
 }finally{await f.close();}
});

test('provider observation expiry during a suppression row wait rolls back the clear',async()=>{
 const f=await relayFixture(),held=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  await sharedBlock(f);const operator=await actor(f),admin=service(f,undefined,{observationTtlMs:500}),op=await request(f,admin,operator);
  const observation=await admin.reconcile(operator,op.operationId,'owner@example.test',new AbortController().signal);
  await held.query('BEGIN');await held.query('SELECT 1 FROM mail_suppressions FOR UPDATE');const blocker=(await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  pending=admin.finish(operator,op.operationId,observation);void pending.catch(()=>{});
  let waiting=false;const until=performance.now()+3000;
  do{waiting=(await f.pool.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))',[f.schema,blocker])).rowCount!==0;if(!waiting)await setImmediate();}while(!waiting&&performance.now()<until);
  assert.equal(waiting,true,'the actual delete waits for the independent row lock');
  await new Promise(r=>setTimeout(r,550));await held.query('ROLLBACK');
  await assert.rejects(pending,/mail_provider_observation_expired/);
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_suppressions')).rows[0].count,'1');assert.equal((await f.pool.query('SELECT count(*) FROM mail_unblock_outcomes')).rows[0].count,'0');
 }finally{await held.query('ROLLBACK');await pending?.catch(()=>{});held.release();await f.close();}
});

test('a new blocker elsewhere in the scope invalidates an otherwise unchanged destination snapshot',async()=>{
 const f=await relayFixture();try{
  await sharedBlock(f);const operator=await actor(f),admin=service(f),op=await request(f,admin,operator);
  const observation=await admin.reconcile(operator,op.operationId,'owner@example.test',new AbortController().signal);
  await new RelayWorker(f.pool,{...f.config,ses:{config:config(),recipientKeys:keys}}).suppress('another@example.test');
  assert.equal(await admin.finish(operator,op.operationId,observation),'blocked');
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_suppressions')).rows[0].count,'1');
 }finally{await f.close();}
});

test('an unscoped replacement of a mapped local lifetime invalidates provider evidence without changing the scope revision',async()=>{
 const f=await relayFixture();try{
  await sharedBlock(f);const operator=await actor(f),admin=service(f),worker=new RelayWorker(f.pool,{...f.config,ses:{config:config(),recipientKeys:keys}});
  await worker.suppress('owner@example.test');const op=await request(f,admin,operator),before=await admin.inspect(operator,config().scope,'owner@example.test');
  const observation=await admin.reconcile(operator,op.operationId,'owner@example.test',new AbortController().signal);
  await f.pool.query('DELETE FROM relay_suppressions');await new RelayWorker(f.pool,f.config).suppress('owner@example.test');
  assert.equal((await admin.inspect(operator,config().scope,'owner@example.test')).revision,before.revision);
  assert.equal(await admin.finish(operator,op.operationId,observation),'blocked');
  assert.equal((await f.pool.query('SELECT count(*) FROM relay_suppressions')).rows[0].count,'1');
  assert.equal((await f.pool.query('SELECT diagnostic FROM mail_unblock_outcomes WHERE operation_id=$1',[op.operationId])).rows[0].diagnostic,'evidence_changed');
 }finally{await f.close();}
});

test('manual removal waits for the local legacy lock before taking the shared scope lock',async()=>{
 const f=await relayFixture(),held=await f.pool.connect(),probe=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  await sharedBlock(f);const operator=await actor(f),admin=service(f),op=await request(f,admin,operator);
  const observation=await admin.reconcile(operator,op.operationId,'owner@example.test',new AbortController().signal);
  await held.query('BEGIN');await held.query("SELECT pg_advisory_xact_lock(hashtextextended(current_schema()||':relay-suppression',0))");const blocker=(await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  pending=admin.finish(operator,op.operationId,observation);void pending.catch(()=>{});
  let waiting=false;const until=performance.now()+3000;
  do{waiting=(await f.pool.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))',[f.schema,blocker])).rowCount!==0;if(!waiting)await setImmediate();}while(!waiting&&performance.now()<until);
  assert.equal(waiting,true,'the actual finisher waits on the local suppression lock');
  await probe.query('BEGIN');const scope=config().scope;
  const available=(await probe.query('SELECT pg_try_advisory_xact_lock(hashtext(current_schema()),hashtext($1)) AS available',[JSON.stringify(['waitron-mail-scope-v1',scope.country,scope.providerAccountId,scope.region])])).rows[0].available;
  assert.equal(available,true,'the waiting finisher has not taken the scope lock first');
  await probe.query('ROLLBACK');await held.query('ROLLBACK');assert.equal(await pending,'cleared');
 }finally{await probe.query('ROLLBACK');await held.query('ROLLBACK');await pending?.catch(()=>{});probe.release();held.release();await f.close();}
});

test('a retained shared key revoked during provider work refuses removal without committing an outcome',async()=>{
 const f=await relayFixture();try{
  await sharedBlock(f);const operator=await actor(f),admin=service(f),op=await request(f,admin,operator);
  const observation=await admin.reconcile(operator,op.operationId,'owner@example.test',new AbortController().signal);
  await f.pool.query('UPDATE mail_recipient_key_versions SET revoked=true');
  await assert.rejects(admin.finish(operator,op.operationId,observation),/mail_keys_unavailable/);
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_suppressions')).rows[0].count,'1');assert.equal((await f.pool.query('SELECT count(*) FROM mail_unblock_outcomes')).rows[0].count,'0');
 }finally{await f.close();}
});

test('mapped legacy and shared blockers clear together without resurrecting old queues, attempts or feedback',async()=>{
 const f=await relayFixture();try{
  const event=await sharedBlock(f),operator=await actor(f),admin=service(f);
  const worker=new RelayWorker(f.pool,{...f.config,ses:{config:config(),recipientKeys:keys}});await worker.suppress('owner@example.test');
  await worker.suppress('unrelated@example.test');
  const venue=await f.venue(),oldRelay=await venue.submit({recipient:'owner@example.test'});await worker.runOnce();assert.equal((await f.row(oldRelay.messageId)).state,'failed');
  const oldAccount=await transaction(f.pool,c=>outbox.enqueue(c,'password_changed',{email:'owner@example.test'}));let sends=0;
  const send=async()=>{sends++;},account=new EmailWorker(f.pool,outbox,{sendVerification:send,sendPasswordReset:send,sendPasswordChanged:send,sendServiceAlert:send},{ses:{config:config(),recipientKeys:keys}});
  await account.runOnce();assert.equal((await f.pool.query('SELECT status FROM email_outbox WHERE id=$1',[oldAccount])).rows[0].status,'failed');assert.equal(sends,0);
  const op=await request(f,admin,operator),before=(await f.pool.query('SELECT (SELECT count(*) FROM email_outbox) AS account,(SELECT count(*) FROM relay_messages) AS relay,(SELECT count(*) FROM mail_attempts) AS attempts')).rows[0];
  const observation=await admin.reconcile?.(operator,op.operationId,'owner@example.test',new AbortController().signal);
  assert.notEqual(observation,undefined,'provider reconciliation yields privately registered evidence');
  assert.equal(await admin.finish(operator,op.operationId,observation),'cleared');
  assert.deepEqual((await f.pool.query('SELECT (SELECT count(*) FROM email_outbox) AS account,(SELECT count(*) FROM relay_messages) AS relay,(SELECT count(*) FROM mail_attempts) AS attempts')).rows[0],before);
  assert.equal((await f.pool.query('SELECT count(*) FROM relay_suppressions')).rows[0].count,'1','unrelated legacy block retained');
  assert.equal((await f.row(oldRelay.messageId)).state,'failed');assert.equal((await f.row(oldRelay.messageId)).payload,null);
  assert.deepEqual((await f.pool.query('SELECT status,payload FROM email_outbox WHERE id=$1',[oldAccount])).rows[0],{status:'failed',payload:null});
  assert.equal(await applySesFeedback(f.pool,config(),keys,event),'duplicate');
  assert.equal(await applySesFeedback(f.pool,config(),keys,{...event,snsId:'new-transport',contentDigest:'b'.repeat(64)}),'duplicate');
  assert.equal((await admin.inspect(operator,config().scope,'owner@example.test')).blocked,false);
  const restarted=service(f);assert.equal(await restarted.finish(operator,op.operationId,{}),'cleared','committed acknowledgement is idempotent after restart');
  const fresh=await venue.submit({recipient:'owner@example.test'});await worker.runOnce();assert.equal((await f.row(fresh.messageId)).state,'accepted');
  const freshAccount=await transaction(f.pool,c=>outbox.enqueue(c,'password_changed',{email:'owner@example.test'}));await account.runOnce();
  assert.equal((await f.pool.query('SELECT status FROM email_outbox WHERE id=$1',[freshAccount])).rows[0].status,'sent');assert.equal(sends,1);
  assert.equal(await applySesFeedback(f.pool,config(),keys,{...event,snsId:'new-blocking-transport',eventId:'new-blocking-event',contentDigest:'c'.repeat(64)}),'applied');
  assert.equal((await admin.inspect(operator,config().scope,'owner@example.test')).blocked,true,'new evidence can block again');
  const outcomes=(await f.pool.query('SELECT * FROM mail_unblock_outcomes')).rows;assert.equal(outcomes.length,1);assert.equal(outcomes[0].result,'cleared');assert.equal(outcomes[0].operator_id,operator.id);
 }finally{await f.close();}
});

for(const mode of ['error','partial','unmapped','foreign','new-block','forged','expired','restart','revoked','wrong-actor','wrong-recipient'] as const)test(`manual reconciliation keeps suppression for ${mode}`,async()=>{
 const f=await relayFixture();try{
  const event=await sharedBlock(f),operator=await actor(f);let queries=0;
  const provider={async query(){queries++;return mode==='error'?['BOUNCE']:mode==='partial'?(queries===1?['BOUNCE','COMPLAINT']:['COMPLAINT']):[];},async remove(){if(mode==='error')throw Error('provider-private-error');}};
  const admin=service(f,provider,mode==='expired'?{observationTtlMs:1}:{}),worker=new RelayWorker(f.pool,{...f.config,ses:{config:config(),recipientKeys:keys}});
  if(mode==='unmapped')await new RelayWorker(f.pool,f.config).suppress('owner@example.test');
  else {await worker.suppress('owner@example.test');if(mode==='foreign')await new RelayWorker(f.pool,{...f.config,ses:{config:config('eu-north-1','FR'),recipientKeys:keys}}).suppress('owner@example.test');}
  const op=await request(f,admin,operator);
  const observation=await admin.reconcile?.(operator,op.operationId,'owner@example.test',new AbortController().signal);
  assert.notEqual(observation,undefined,'provider reconciliation yields evidence even for a fixed failed outcome');
  if(mode==='new-block')assert.equal(await applySesFeedback(f.pool,config(),keys,{...event,snsId:'late-block',eventId:'late-block',contentDigest:'d'.repeat(64)}),'applied');
  if(mode==='expired')await new Promise(r=>setTimeout(r,5));
  if(mode==='revoked')await f.pool.query('DELETE FROM platform_permissions WHERE account_id=$1',[operator.id]);
  if(mode==='wrong-actor')await assert.rejects(admin.finish(await actor(f),op.operationId,observation),/permission_denied/);
  else if(mode==='wrong-recipient')await assert.rejects(admin.reconcile(operator,op.operationId,'different@example.test',new AbortController().signal),/mail_recipient_unavailable/);
  else if(mode==='revoked')await assert.rejects(admin.finish(operator,op.operationId,observation),/permission_denied/);
  else assert.equal(await (mode==='restart'?service(f):admin).finish(operator,op.operationId,mode==='forged'?{...observation}:observation),'blocked');
  assert.ok((await f.pool.query('SELECT count(*) FROM mail_suppressions')).rows[0].count>'0');
  assert.equal((await f.pool.query('SELECT count(*) FROM relay_suppressions')).rows[0].count,'1');
  if(mode==='new-block')assert.equal((await f.pool.query('SELECT count(*) FROM mail_suppressions')).rows[0].count,'2','newer blocker retained');
 }finally{await f.close();}
});

test('a pending manual operation requires actual operator authority and keeps its immutable private evidence',async()=>{
 assert.equal(typeof adminModule.MailSuppressionAdmin,'function','the authenticated removal service exists');
 const f=await relayFixture();try{
  const operator=await actor(f),ordinary=await actor(f,false);
  await new RelayWorker(f.pool,{...f.config,ses:{config:config(),recipientKeys:keys}}).suppress('owner@example.test');
  const admin=new adminModule.MailSuppressionAdmin!(f.pool,{ses:{config:config(),recipientKeys:keys},legacyKeys:f.config.suppressionKeys,
   provider:{async query(){return [];},async remove(){}}});
  const state=await admin.inspect(operator,config().scope,'owner@example.test');assert.equal(state.blocked,true);
  for(const invalid of [{sessionToken:'bad',csrfToken:'bad'},ordinary,{...operator,csrfToken:'bad'}])
   await assert.rejects(admin.request(invalid,config().scope,'owner@example.test',state.revision,'address_verified'));
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_unblock_requests')).rows[0].count,'0');
  await assert.rejects(admin.request(operator,config('eu-west-3').scope,'owner@example.test',state.revision,'address_verified'),/mail_scope_unavailable/);
  await assert.rejects(admin.request(operator,config().scope,'owner@example.test',state.revision+1,'address_verified'),/mail_revision_conflict/);
  await assert.rejects(admin.request(operator,config().scope,'owner@example.test',state.revision,'owner@example.test'),/mail_reason_invalid/);
  const operation=await admin.request(operator,config().scope,'owner@example.test',state.revision,'address_verified');
  assert.match(operation.operationId,/^[a-f0-9-]{36}$/);assert.equal((await admin.inspect(operator,config().scope,'owner@example.test')).blocked,true);
  const request=(await f.pool.query('SELECT * FROM mail_unblock_requests')).rows[0];
  assert.equal(request.operator_id,operator.id);assert.equal(request.reason,'address_verified');assert.equal(request.country,'ES');
  assert.equal(request.prior_evidence.legacy.length,1);assert.equal(request.prior_evidence.shared.length,0);
  const audit=JSON.stringify((await f.pool.query('SELECT * FROM mail_suppression_actions')).rows);
  for(const secret of ['owner@example.test',operator.sessionToken,operator.csrfToken])assert.equal(JSON.stringify(request).includes(secret)||audit.includes(secret),false);
  assert.equal((await f.pool.query('SELECT reconciliation FROM mail_suppression_actions')).rows[0].reconciliation,'pending');
  for(const table of ['mail_unblock_requests','mail_suppression_actions'])for(const action of [`DELETE FROM ${table}`,`UPDATE ${table} SET operator_id='${randomUUID()}'`,`TRUNCATE ${table} CASCADE`])
   await assert.rejects(f.pool.query(action),/mail_binding_immutable/);
 }finally{await f.close();}
});

// Reusing a legacy digest must not reuse an earlier block's country authority.
test('deleting a mapped block and readding it unscoped cannot reactivate either historical country mapping',async()=>{
 const f=await relayFixture();try{
  for(const country of ['ES','FR'])await new RelayWorker(f.pool,{...f.config,ses:{config:config('eu-north-1',country),recipientKeys:keys}}).suppress('owner@example.test');
  const blocked=async(country:string)=>transaction(f.pool,async c=>{
   const binding={config:config('eu-north-1',country),recipientKeys:keys};await lockMailScope(c,binding.config.scope);
   return recipientIsSuppressed(c,binding.config.scope,await mailRecipientRefs(c,{...binding,recipient:'owner@example.test'}));
  });
  assert.equal(await blocked('ES'),true);assert.equal(await blocked('FR'),true);
  await f.pool.query('DELETE FROM relay_suppressions');
  await new RelayWorker(f.pool,f.config).suppress('owner@example.test');
  assert.equal(await blocked('ES'),false,'an unscoped re-add has no Spanish attribution');
  assert.equal(await blocked('FR'),false,'an unscoped re-add has no French attribution');
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_legacy_suppression_scopes')).rows[0].count,'2');
  assert.equal((await f.pool.query('SELECT count(*) FROM relay_suppressions')).rows[0].count,'1','the global local gate stays closed');
  await new RelayWorker(f.pool,{...f.config,ses:{config:config(),recipientKeys:keys}}).suppress('owner@example.test');
  assert.equal(await blocked('ES'),true,'a new explicit mapping applies to the new lifetime');
  assert.equal(await blocked('FR'),false,'the new lifetime cannot inherit a different country');
 }finally{await f.close();}
});

// A country mapping cannot erase an earlier decision made without a country.
test('an unscoped origin stays blocked after a later scoped write and performs no provider work',async()=>{
 const f=await relayFixture();try{
  await new RelayWorker(f.pool,f.config).suppress('owner@example.test');
  await new RelayWorker(f.pool,{...f.config,ses:{config:config(),recipientKeys:keys}}).suppress('owner@example.test');
  const operator=await actor(f);let calls=0;
  const admin=service(f,{async query(){calls++;return [];},async remove(){calls++;}}),op=await request(f,admin,operator);
  const observation=await admin.reconcile(operator,op.operationId,'owner@example.test',new AbortController().signal);
  assert.equal(calls,0,'an unknown legacy origin cannot authorise provider removal');
  assert.equal(await admin.finish(operator,op.operationId,observation),'blocked');
  assert.equal((await f.pool.query('SELECT count(*) FROM relay_suppressions')).rows[0].count,'1');
  assert.equal((await f.pool.query('SELECT unscoped FROM relay_suppressions')).rows[0].unscoped,true);
 }finally{await f.close();}
});

test('a new unscoped decision on an existing row defeats a pending clear',async()=>{
 const f=await relayFixture();try{
  const operator=await actor(f),admin=service(f),scoped=new RelayWorker(f.pool,{...f.config,ses:{config:config(),recipientKeys:keys}});
  await scoped.suppress('owner@example.test');const op=await request(f,admin,operator);
  const observation=await admin.reconcile(operator,op.operationId,'owner@example.test',new AbortController().signal);
  await new RelayWorker(f.pool,f.config).suppress('owner@example.test');
  assert.equal(await admin.finish(operator,op.operationId,observation),'blocked');
  assert.equal((await f.pool.query('SELECT count(*) FROM relay_suppressions')).rows[0].count,'1');
 }finally{await f.close();}
});

test('a completed blocked operation cannot invoke the provider again',async()=>{
 const f=await relayFixture();try{
  await sharedBlock(f);const operator=await actor(f);let calls=0;
  const admin=service(f,{async query(){calls++;return ['BOUNCE'];},async remove(){calls++;}}),op=await request(f,admin,operator);
  assert.equal(await admin.finish(operator,op.operationId,{}),'blocked');
  await assert.rejects(admin.reconcile(operator,op.operationId,'owner@example.test',new AbortController().signal));
  assert.equal(calls,0);assert.equal((await f.pool.query('SELECT count(*) FROM mail_unblock_outcomes')).rows[0].count,'1');
 }finally{await f.close();}
});

test('a foreign legacy mapping refuses provider removal before the external call',async()=>{
 const f=await relayFixture();try{
  for(const country of ['ES','FR'])await new RelayWorker(f.pool,{...f.config,ses:{config:config('eu-north-1',country),recipientKeys:keys}}).suppress('owner@example.test');
  const operator=await actor(f);let calls=0;
  const admin=service(f,{async query(){calls++;return ['COMPLAINT'];},async remove(){calls++;}}),op=await request(f,admin,operator);
  const observation=await admin.reconcile(operator,op.operationId,'owner@example.test',new AbortController().signal);
  assert.equal(calls,0,'a regional provider call must not remove another country protection');
  assert.equal(await admin.finish(operator,op.operationId,observation),'blocked');
  assert.equal((await f.pool.query('SELECT count(*) FROM relay_suppressions')).rows[0].count,'1');
 }finally{await f.close();}
});

test('every provider removal retains immutable intent and result across repeated reconciliation',async()=>{
 const f=await relayFixture();try{
  await sharedBlock(f);const operator=await actor(f);let remaining=['BOUNCE','COMPLAINT'];
  const admin=service(f,{async query(){return [...remaining];},async remove(_s:unknown,_r:string,reason:string){remaining=remaining.filter(r=>r!==reason);}}),op=await request(f,admin,operator);
  await admin.reconcile(operator,op.operationId,'owner@example.test',new AbortController().signal);
  const observation=await admin.reconcile(operator,op.operationId,'owner@example.test',new AbortController().signal);
  assert.equal(await admin.finish(operator,op.operationId,observation),'cleared');
  assert.notEqual((await f.pool.query("SELECT to_regclass('mail_unblock_provider_attempts') AS relation")).rows[0].relation,null,'durable provider intent exists');
  const intents=(await f.pool.query('SELECT * FROM mail_unblock_provider_attempts ORDER BY recorded_at,id')).rows;
  assert.equal(intents.length,2);for(const row of intents){assert.equal(row.operation_id,op.operationId);assert.equal(row.operator_id,operator.id);}
  const results=(await f.pool.query('SELECT r.* FROM mail_unblock_provider_results r JOIN mail_unblock_provider_attempts a ON a.id=r.attempt_id ORDER BY a.recorded_at,a.id')).rows;
  assert.equal(results.length,2);assert.deepEqual(results[0].provider_evidence,{status:'confirmed',before:['BOUNCE','COMPLAINT'],after:[]});
  assert.deepEqual(results[1].provider_evidence,{status:'confirmed',before:[],after:[]});
  const audit=JSON.stringify({intents,results});for(const secret of ['owner@example.test',operator.sessionToken,operator.csrfToken])assert.equal(audit.includes(secret),false);
  for(const table of ['mail_unblock_provider_attempts','mail_unblock_provider_results'])for(const sql of [`DELETE FROM ${table}`,`TRUNCATE ${table} CASCADE`,`UPDATE ${table} SET recorded_at=clock_timestamp()`])await assert.rejects(f.pool.query(sql),/mail_binding_immutable/);
 }finally{await f.close();}
});

test('operator expiry during the suppression delete wait rolls back the final clear',async()=>{
 const f=await relayFixture(),held=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  await sharedBlock(f);const operator=await actor(f),admin=service(f),op=await request(f,admin,operator);
  const observation=await admin.reconcile(operator,op.operationId,'owner@example.test',new AbortController().signal);
  await f.pool.query("UPDATE cloud_sessions SET absolute_expires_at=clock_timestamp()+interval '400 milliseconds' WHERE account_id=$1",[operator.id]);
  await held.query('BEGIN');await held.query('SELECT 1 FROM mail_suppressions FOR UPDATE');const blocker=(await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  pending=admin.finish(operator,op.operationId,observation);void pending.catch(()=>{});let waiting=false;const until=performance.now()+3000;
  do{waiting=(await f.pool.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))',[f.schema,blocker])).rowCount!==0;if(!waiting)await setImmediate();}while(!waiting&&performance.now()<until);
  assert.equal(waiting,true,'the real delete waits after the middle authority check');
  while(!(await held.query('SELECT clock_timestamp()>=absolute_expires_at AS expired FROM cloud_sessions WHERE account_id=$1',[operator.id])).rows[0].expired)await setImmediate();
  await held.query('ROLLBACK');await assert.rejects(pending,/session_expired/);
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_suppressions')).rows[0].count,'1');assert.equal((await f.pool.query('SELECT count(*) FROM mail_unblock_outcomes')).rows[0].count,'0');
 }finally{await held.query('ROLLBACK');await pending?.catch(()=>{});held.release();await f.close();}
});

test('provider work starts only after its durable audit intent commits',async()=>{
 const f=await relayFixture();try{
  await sharedBlock(f);const operator=await actor(f);let intentPresent=false;
  const admin=service(f,{async query(){intentPresent=(await f.pool.query('SELECT count(*) FROM mail_unblock_provider_attempts')).rows[0].count==='1';return [];},async remove(){}}),op=await request(f,admin,operator);
  const observation=await admin.reconcile(operator,op.operationId,'owner@example.test',new AbortController().signal).catch(()=>null);
  assert.equal(intentPresent,true,'external work observes the already committed intent');assert.notEqual(observation,null);
 }finally{await f.close();}
});
