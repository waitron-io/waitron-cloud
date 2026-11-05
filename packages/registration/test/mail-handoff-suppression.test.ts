import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';
import {test,type TestContext} from 'node:test';
import {SMTPServer,type SMTPServerOptions} from 'smtp-server';
import type {Pool} from 'pg';
import {EmailOutbox,EmailWorker} from '../src/email-outbox.ts';
import {RelayWorker} from '../src/relay-worker.ts';
import {admitMailAttempt,mailRecipientRefs,type SesHandoffConfig} from '../src/mail-attempts.ts';
import {applySesFeedback} from '../src/ses-feedback-store.ts';
import {parseSesFeedback} from '../src/ses-feedback-event.ts';
import {transaction} from '../src/transaction.ts';
import {lockMailScope} from '../src/recipient-suppression.ts';
import {PasswordRecoveryStore} from '../src/password-recovery.ts';
import {validateSesFeedbackConfig} from '../src/ses-feedback-config.ts';
import {fixture,config,keys,rotated} from './fixtures/mail-attempt.ts';
import {fixture as relayFixture} from './fixtures/relay-worker.ts';
import {feedbackEnvelope,feedbackEvent,feedbackFixture} from './fixtures/ses-feedback.ts';

const outbox=new EmailOutbox({activeKeyId:'payload',keys:{payload:'77'.repeat(32)}});
const ses={config:config(),recipientKeys:keys};
async function enqueue(pool:Pool,email='owner@example.test'){
 const token=randomBytes(32).toString('base64url'),expiresAt=new Date(Date.now()+1800000).toISOString();
 return transaction(pool,async c=>{
  await c.query('INSERT INTO signup_requests(token_hash,email,expires_at,created_at) VALUES($1,$2,$3,clock_timestamp())',[createHash('sha256').update(token).digest('hex'),email,expiresAt]);
  return outbox.enqueue(c,'verification',{email,token,expiresAt});
 });
}
function accountWorker(pool:Pool,send=async()=>{},binding:SesHandoffConfig=ses){
 return new EmailWorker(pool,outbox,{sendVerification:send,sendPasswordReset:send,sendPasswordChanged:send,sendServiceAlert:send},{ses:binding});
}
async function feedback(pool:Pool,tag:string,email='owner@example.test'){
 const raw=feedbackEvent();raw.mail.tags['waitron-attempt']=[tag];raw.mail.destination=[email];raw.bounce.bouncedRecipients=[{emailAddress:email}];
 return applySesFeedback(pool,ses.config,keys,parseSesFeedback(JSON.stringify(feedbackEnvelope(raw)),ses.config));
}
async function originalAttempt(f:{pool:Pool},email='owner@example.test'){
 const outboxId=await transaction(f.pool,c=>outbox.enqueue(c,'password_changed',{email})),claimId=randomUUID();
 await f.pool.query("UPDATE email_outbox SET status='processing',claim_id=$2,lease_until=clock_timestamp()+interval '1 minute',attempts=1 WHERE id=$1",[outboxId,claimId]);
 const input={...ses,recipient:email,claim:{purpose:'cloud-account-email' as const,outboxId,claimId,attempt:1}},admission=await transaction(f.pool,c=>admitMailAttempt(c,input));
 await f.pool.query("UPDATE email_outbox SET status='sent',claim_id=NULL,lease_until=NULL,key_id=NULL,payload=NULL,finished_at=clock_timestamp() WHERE id=$1",[input.claim.outboxId]);
 return admission.attemptTag;
}
async function block(f:{pool:Pool},email='owner@example.test'){
 assert.equal(await feedback(f.pool,await originalAttempt(f,email),email),'applied');
}
async function smtp(t:TestContext,options:SMTPServerOptions={}){
 const captured:string[]=[];
 const server=new SMTPServer({disabledCommands:['AUTH','STARTTLS'],logger:false,onData(stream,_session,done){let raw='';stream.on('data',b=>raw+=b);stream.on('end',()=>{captured.push(raw);done();});},...options});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>new Promise<void>(r=>server.close(r)));const address=server.server.address();assert.ok(address&&typeof address!=='string');
 return {port:address.port,captured};
}

// Removing shared admission must let the forbidden send escape these terminal-state checks.
test('suppression wins before account admission and erases only the blocked queue payload',async()=>{
 const f=await fixture();try{
  await block(f);const id=await enqueue(f.pool);let sends=0;
  await accountWorker(f.pool,async()=>{sends++;}).runOnce();
  const row=(await f.pool.query('SELECT status,last_error,payload,key_id FROM email_outbox WHERE id=$1',[id])).rows[0];
  assert.deepEqual(row,{status:'failed',last_error:'delivery_rejected',payload:null,key_id:null});assert.equal(sends,0);
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_attempts WHERE queue_id=$1',[id])).rows[0].count,'0');
 }finally{await f.close();}
});

test('an account handoff commits its original recipient binding before transport opens',async()=>{
 const f=await fixture();try{
  const id=await enqueue(f.pool);let sends=0;
  await accountWorker(f.pool,async()=>{
   const rows=(await f.pool.query('SELECT attempt,claim_id,recipient_refs_sealed FROM mail_attempts WHERE queue_id=$1',[id])).rows;
   assert.equal(rows.length,1);assert.equal(rows[0].attempt,1);assert.equal(rows[0].recipient_refs_sealed,true);
   assert.equal(rows[0].claim_id,(await f.pool.query('SELECT claim_id FROM email_outbox WHERE id=$1',[id])).rows[0].claim_id);sends++;
  }).runOnce();
  assert.equal(sends,1);assert.equal((await f.pool.query('SELECT status FROM email_outbox WHERE id=$1',[id])).rows[0].status,'sent');
 }finally{await f.close();}
});

test('a scoped local relay commits an attempt before SMTP and shares a trusted manual block with account mail',async t=>{
 const f=await relayFixture();try{
  const s=await smtp(t),v=await f.venue(),first=await v.submit({recipient:'allowed@example.test'});
  const worker=new RelayWorker(f.pool,{...f.config,smtpPort:s.port,ses});
  await worker.runOnce();assert.equal((await f.row(first.messageId)).state,'accepted');assert.equal(s.captured.length,1);
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_attempts WHERE queue_id=$1',[first.messageId])).rows[0].count,'1');
  await worker.suppress('owner@example.test');const id=await enqueue(f.pool);let sends=0;
  await accountWorker(f.pool,async()=>{sends++;}).runOnce();
  assert.equal((await f.pool.query('SELECT status FROM email_outbox WHERE id=$1',[id])).rows[0].status,'failed');assert.equal(sends,0);
  const rejected=await v.submit({recipient:'owner@example.test'});await worker.runOnce();
  assert.equal((await f.row(rejected.messageId)).state,'failed');assert.equal((await f.row(rejected.messageId)).reason,'refused');assert.equal(s.captured.length,1);
 }finally{await f.close();}
});

test('an explicitly scoped manual block crosses purposes without inventing provider evidence or guessing another country',async()=>{
 const f=await relayFixture();try{
  const worker=new RelayWorker(f.pool,{...f.config,ses});await worker.suppress('owner@example.test');
  const blocked=await enqueue(f.pool),other=await enqueue(f.pool,'other@example.test');let sends=0;
  const account=accountWorker(f.pool,async()=>{sends++;});await account.runOnce();await account.runOnce();
  assert.equal((await f.pool.query('SELECT status FROM email_outbox WHERE id=$1',[blocked])).rows[0].status,'failed');
  assert.equal((await f.pool.query('SELECT status FROM email_outbox WHERE id=$1',[other])).rows[0].status,'sent');assert.equal(sends,1);
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_feedback_events')).rows[0].count,'0');
  const abroad=await enqueue(f.pool);await accountWorker(f.pool,async()=>{sends++;},{...ses,config:config('eu-north-1','FR')}).runOnce();
  assert.equal((await f.pool.query('SELECT status FROM email_outbox WHERE id=$1',[abroad])).rows[0].status,'sent');assert.equal(sends,2);
 }finally{await f.close();}
});

test('manual bridging refuses unvalidated or account-only SES configuration without leaving a local block',async()=>{
 const f=await relayFixture();try{
  const accountOnly=feedbackFixture('eu-north-1',['cloud-account-email']);
  const large=feedbackFixture('eu-north-1',['cloud-account-email','venue-email']);large.policy.revision=2147483648;large.input.policyRevision=2147483648;for(const flow of large.input.flows)flow.policyRevision=2147483648;
  for(const value of [{...ses.config},validateSesFeedbackConfig(accountOnly.policy,accountOnly.input),validateSesFeedbackConfig(large.policy,large.input)]){
   await assert.rejects(new RelayWorker(f.pool,{...f.config,ses:{...ses,config:value}}).suppress('owner@example.test'),/mail_configuration_unavailable/);
   assert.equal((await f.pool.query('SELECT count(*) FROM relay_suppressions')).rows[0].count,'0');
   assert.equal((await f.pool.query('SELECT count(*) FROM mail_legacy_suppression_scopes')).rows[0].count,'0');
  }
 }finally{await f.close();}
});

test('missing retained recipient keys refuse transport without pretending that the address is blocked',async()=>{
 const f=await fixture();try{
  await block(f);const id=await enqueue(f.pool,'other@example.test');let sends=0;
  await accountWorker(f.pool,async()=>{sends++;},{...ses,recipientKeys:{activeKeyId:'v2',keys:{v2:'22'.repeat(32)}}}).runOnce();
  assert.equal(sends,0);assert.deepEqual((await f.pool.query('SELECT status,last_error FROM email_outbox WHERE id=$1',[id])).rows[0],{status:'pending',last_error:'delivery_configuration'});
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_attempts WHERE queue_id=$1',[id])).rows[0].count,'0');
 }finally{await f.close();}
});

test('provider feedback blocks both venues and account mail while country provider and region stay separate',async t=>{
 const f=await relayFixture();try{
  await block(f);const a=await f.venue(),b=await f.venue(),s=await smtp(t),worker=new RelayWorker(f.pool,{...f.config,smtpPort:s.port,ses});
  for(const venue of [a,b]){const body=await venue.submit({recipient:'owner@example.test'});await worker.runOnce();assert.equal((await f.row(body.messageId)).state,'failed');assert.equal((await f.row(body.messageId)).attempts,0);}
  const id=await enqueue(f.pool);let sends=0;await accountWorker(f.pool,async()=>{sends++;}).runOnce();
  assert.equal((await f.pool.query('SELECT status FROM email_outbox WHERE id=$1',[id])).rows[0].status,'failed');assert.equal(sends,0);assert.equal(s.captured.length,0);
  for(const configValue of [config('eu-north-1','FR'),config('eu-north-1','ES','999999999999'),config('eu-west-3')]){
   const body=await a.submit({recipient:'owner@example.test'});await new RelayWorker(f.pool,{...f.config,smtpPort:s.port,ses:{...ses,config:configValue}}).runOnce();assert.equal((await f.row(body.messageId)).state,'accepted');
   const id=await enqueue(f.pool);await accountWorker(f.pool,async()=>{sends++;},{...ses,config:configValue}).runOnce();assert.equal((await f.pool.query('SELECT status FROM email_outbox WHERE id=$1',[id])).rows[0].status,'sent');
  }
  assert.equal(s.captured.length,3);assert.equal(sends,3);
 }finally{await f.close();}
});

test('feedback committed after account admission cannot recall that send or resurrect it',async()=>{
 const f=await fixture();let run:Promise<unknown>|undefined,release=()=>{};
 try{
  const id=await enqueue(f.pool);let entered=()=>{};const sending=new Promise<void>(r=>entered=r),held=new Promise<void>(r=>release=r);
  run=accountWorker(f.pool,async()=>{entered();await held;}).runOnce();void run.catch(()=>{});await sending;
  const tag=(await f.pool.query('SELECT attempt_tag FROM mail_attempts WHERE queue_id=$1',[id])).rows[0].attempt_tag;
  assert.equal(await feedback(f.pool,tag),'applied');release();await run;
  assert.equal((await f.pool.query('SELECT status FROM email_outbox WHERE id=$1',[id])).rows[0].status,'sent');
  const later=await enqueue(f.pool);let sends=0;await accountWorker(f.pool,async()=>{sends++;}).runOnce();
  assert.equal(sends,0);assert.equal((await f.pool.query('SELECT status FROM email_outbox WHERE id=$1',[later])).rows[0].status,'failed');
 }finally{release();await run?.catch(()=>{});await f.close();}
});

test('feedback committed after relay admission cannot recall its SMTP handoff',async t=>{
 const f=await relayFixture();let run:Promise<unknown>|undefined,release=()=>{};
 try{
  const v=await f.venue(),body=await v.submit({recipient:'owner@example.test'});let reached=()=>{};const sending=new Promise<void>(r=>reached=r);
  const s=await smtp(t,{onData(stream,_session,done){stream.resume();stream.on('end',()=>{release=()=>done();reached();});}});
  run=new RelayWorker(f.pool,{...f.config,smtpPort:s.port,ses}).runOnce();void run.catch(()=>{});await sending;
  const tag=(await f.pool.query('SELECT attempt_tag FROM mail_attempts WHERE queue_id=$1',[body.messageId])).rows[0].attempt_tag;
  assert.equal((await f.row(body.messageId)).state,'sending');assert.equal(await feedback(f.pool,tag),'applied');
  release();await run;assert.equal((await f.row(body.messageId)).state,'accepted');assert.equal((await f.row(body.messageId)).attempts,1);
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_suppressions')).rows[0].count,'1');
 }finally{release();await run?.catch(()=>{});await f.close();}
});

for(const purpose of ['account','relay'])test(`feedback winning the shared lock blocks a genuinely concurrent ${purpose} handoff`,async t=>{
 const f=await relayFixture(),gate=await f.pool.connect();let applied:Promise<unknown>|undefined,run:Promise<unknown>|undefined;
 try{
  const tag=await originalAttempt(f),v=await f.venue(),s=await smtp(t);
  const id=purpose==='account'?await enqueue(f.pool):(await v.submit({recipient:'owner@example.test'})).messageId;let sends=0;
  await f.pool.query(`CREATE TABLE handoff_feedback_gate(id integer PRIMARY KEY);INSERT INTO handoff_feedback_gate VALUES(1);
   CREATE FUNCTION pause_feedback_record() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN PERFORM id FROM handoff_feedback_gate WHERE id=1 FOR UPDATE;RETURN NEW;END$$;
   CREATE TRIGGER pause_feedback_record BEFORE INSERT ON mail_feedback_receipts FOR EACH ROW EXECUTE FUNCTION pause_feedback_record()`);
  await gate.query('BEGIN');await gate.query('SELECT id FROM handoff_feedback_gate WHERE id=1 FOR UPDATE');const blocker=(await gate.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  applied=feedback(f.pool,tag);void applied.catch(()=>{});await waitBlocked(f.pool,blocker);
  const feedbackPid=(await f.pool.query('SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',[blocker])).rows[0].pid;
  run=purpose==='account'?accountWorker(f.pool,async()=>{sends++;}).runOnce():new RelayWorker(f.pool,{...f.config,smtpPort:s.port,ses}).runOnce();void run.catch(()=>{});
  await waitBlocked(f.pool,feedbackPid);await gate.query('COMMIT');assert.equal(await applied,'applied');await run;
  assert.equal(sends,0);assert.equal(s.captured.length,0);
  if(purpose==='account')assert.equal((await f.pool.query('SELECT status FROM email_outbox WHERE id=$1',[id])).rows[0].status,'failed');
  else assert.equal((await f.row(id)).state,'failed');
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_attempts WHERE queue_id=$1',[id])).rows[0].count,'0');
 }finally{await gate.query('ROLLBACK');await Promise.allSettled([applied,run]);gate.release();await f.close();}
});

test('a key rotation winning the shared lock cannot split admission or use caller mutations to supply missing history',async()=>{
 const f=await fixture(),held=await f.pool.connect();let run:Promise<unknown>|undefined;
 try{
  const binding={...ses,recipientKeys:{activeKeyId:'v1',keys:{v1:keys.keys.v1} as Record<string,string>}},id=await enqueue(f.pool);let sends=0;
  const worker=accountWorker(f.pool,async()=>{sends++;},binding);
  await held.query('BEGIN');await lockMailScope(held,ses.config.scope);await mailRecipientRefs(held,{...ses,recipientKeys:rotated,recipient:'other@example.test'});
  const pid=(await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;run=worker.runOnce();void run.catch(()=>{});await waitBlocked(f.pool,pid);
  binding.recipientKeys.keys.v2=rotated.keys.v2;binding.recipientKeys.activeKeyId='v2';
  await held.query('COMMIT');await run;
  assert.equal(sends,0);assert.deepEqual((await f.pool.query('SELECT status,last_error FROM email_outbox WHERE id=$1',[id])).rows[0],{status:'pending',last_error:'delivery_configuration'});
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_attempts')).rows[0].count,'0');
  await f.pool.query('UPDATE email_outbox SET available_at=clock_timestamp() WHERE id=$1',[id]);
  await accountWorker(f.pool,async()=>{sends++;},{...ses,recipientKeys:rotated}).runOnce();assert.equal(sends,1);
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_attempt_recipients')).rows[0].count,'2');
 }finally{await held.query('ROLLBACK');await run?.catch(()=>{});held.release();await f.close();}
});

async function waitBlocked(pool:Pool,blocker:number,expected=1){
 const until=performance.now()+3000;
 do{
  const n=Number((await pool.query('SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))',[blocker])).rows[0].count);
  if(n>=expected)return;
  await setImmediate();
 }while(performance.now()<until);
 assert.fail(`expected ${expected} worker(s) blocked by the held database lock`);
}
for(const deadline of ['lease_until','expires_at'])test(`account admission refuses ${deadline} that expires during the shared lock wait`,async()=>{
 const f=await fixture(),held=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  const id=await enqueue(f.pool);let sends=0;
  await held.query('BEGIN');await lockMailScope(held,ses.config.scope);const pid=(await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  pending=accountWorker(f.pool,async()=>{sends++;}).runOnce();void pending.catch(()=>{});
  await waitBlocked(f.pool,pid);
  await f.pool.query(`UPDATE email_outbox SET ${deadline}=clock_timestamp()-interval '1 second' WHERE id=$1`,[id]);
  await held.query('COMMIT');await pending;
  assert.equal(sends,0);assert.equal((await f.pool.query('SELECT count(*) FROM mail_attempts')).rows[0].count,'0');
 }finally{await held.query('ROLLBACK');await pending?.catch(()=>{});held.release();await f.close();}
});

for(const [table,column,state] of [
 ['relay_messages','expires_at','expired'],['relay_messages','lease_until','queued'],
 ['relay_grants','expires_at','cancelled'],['relay_grants','origin_verified_until','cancelled'],['installations','lease_expires_at','cancelled'],
] as const)test(`scoped relay refuses ${table}.${column} expiring during a shared lock wait`,async t=>{
 const f=await relayFixture(),held=await f.pool.connect();let run:Promise<unknown>|undefined;
 try{
  const v=await f.venue(),body=await v.submit(),s=await smtp(t);
  // The claim writer sets its own lease, so that case expires it after observing the blocker.
  if(column==='origin_verified_until')await f.pool.query("UPDATE relay_grants SET expires_at=clock_timestamp()+interval '2 seconds',origin_verified_until=clock_timestamp()+interval '2 seconds'");
  else if(column!=='lease_until')await f.pool.query(`UPDATE ${table} SET ${column}=clock_timestamp()+interval '2 seconds'`);
  await held.query('BEGIN');await lockMailScope(held,ses.config.scope);const pid=(await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  run=new RelayWorker(f.pool,{...f.config,smtpPort:s.port,ses}).runOnce();void run.catch(()=>{});await waitBlocked(f.pool,pid);
  if(column==='lease_until')await f.pool.query("UPDATE relay_messages SET lease_until=clock_timestamp()-interval '1 second'");
  else await held.query(`SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM (${column}-clock_timestamp())))+0.02) FROM ${table}`);
  assert.equal((await held.query(`SELECT ${column}<=clock_timestamp() AS expired FROM ${table}`)).rows[0].expired,true);
  await held.query('COMMIT');await run;
  assert.equal((await f.row(body.messageId)).state,state);assert.equal((await f.row(body.messageId)).attempts,0);assert.equal(s.captured.length,0);
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_attempts')).rows[0].count,'0');
 }finally{await held.query('ROLLBACK');await run?.catch(()=>{});held.release();await f.close();}
});

test('a replaced claim cannot admit or settle the replacement after a scope lock wait',async()=>{
 const f=await fixture(),held=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  const id=await enqueue(f.pool);let sends=0;
  await held.query('BEGIN');await lockMailScope(held,ses.config.scope);const pid=(await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  pending=accountWorker(f.pool,async()=>{sends++;}).runOnce();void pending.catch(()=>{});await waitBlocked(f.pool,pid);
  const replacement=randomUUID();await f.pool.query("UPDATE email_outbox SET claim_id=$2,attempts=2,lease_until=clock_timestamp()+interval '1 minute' WHERE id=$1",[id,replacement]);
  await held.query('COMMIT');await pending;
  assert.equal(sends,0);assert.deepEqual((await f.pool.query('SELECT status,claim_id,attempts,failures FROM email_outbox WHERE id=$1',[id])).rows[0],{status:'processing',claim_id:replacement,attempts:2,failures:0});
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_attempts')).rows[0].count,'0');
 }finally{await held.query('ROLLBACK');await pending?.catch(()=>{});held.release();await f.close();}
});

for(const change of ['email','password_hash'])test(`a credential ${change} change winning before reset handoff cancels the old request`,async()=>{
 const f=await relayFixture(),held=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  const v=await f.venue(),email=`${v.account}@example.test`;
  await f.pool.query("UPDATE cloud_credentials SET password_hash='original-hash' WHERE account_id=$1",[v.account]);
  await new PasswordRecoveryStore(f.pool,outbox).request(email);
  await held.query('BEGIN');await held.query('SELECT account_id FROM cloud_credentials WHERE account_id=$1 FOR UPDATE',[v.account]);
  const pid=(await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;let sends=0;
  pending=accountWorker(f.pool,async()=>{sends++;}).runOnce();void pending.catch(()=>{});await waitBlocked(f.pool,pid);
  await held.query(`UPDATE cloud_credentials SET ${change}=$2 WHERE account_id=$1`,[v.account,change==='email'?'replacement@example.test':'replacement-hash']);
  await held.query('COMMIT');await pending;
  assert.equal(sends,0);assert.equal((await f.pool.query('SELECT status FROM email_outbox')).rows[0].status,'cancelled');
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_attempts')).rows[0].count,'0');
 }finally{await held.query('ROLLBACK');await pending?.catch(()=>{});held.release();await f.close();}
});

test('reset authority stays locked through a suppression wait and later changes cannot recall an admitted send',async()=>{
 const f=await relayFixture(),scope=await f.pool.connect(),writer=await f.pool.connect();let pending:Promise<unknown>|undefined,change:Promise<unknown>|undefined;
 try{
  const v=await f.venue();await f.pool.query("UPDATE cloud_credentials SET password_hash='original-hash' WHERE account_id=$1",[v.account]);
  await new PasswordRecoveryStore(f.pool,outbox).request(`${v.account}@example.test`);
  await scope.query('BEGIN');await lockMailScope(scope,ses.config.scope);const blocker=(await scope.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;let sends=0;
  pending=accountWorker(f.pool,async()=>{sends++;}).runOnce();void pending.catch(()=>{});await waitBlocked(f.pool,blocker);
  const worker=(await f.pool.query('SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',[blocker])).rows[0].pid;
  await writer.query('BEGIN');change=writer.query("UPDATE cloud_credentials SET password_hash='replacement-hash' WHERE account_id=$1",[v.account]);void change.catch(()=>{});
  await waitBlocked(f.pool,worker);
  await scope.query('COMMIT');await change;await writer.query('COMMIT');await pending;
  assert.equal(sends,1);assert.equal((await f.pool.query('SELECT count(*) FROM mail_attempts')).rows[0].count,'1');
  assert.equal((await f.pool.query('SELECT status FROM email_outbox')).rows[0].status,'sent');
 }finally{await scope.query('ROLLBACK');await change?.catch(()=>{});await writer.query('ROLLBACK');await pending?.catch(()=>{});scope.release();writer.release();await f.close();}
});

for(const target of ['account','membership','installation','incident','preference','service'])test(`service-alert ${target} authority winning a lock wait prevents admission`,async()=>{
 const f=await relayFixture(),held=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  const v=await f.venue(),venue=(await f.pool.query('SELECT venue_id FROM installations WHERE id=$1',[v.installation])).rows[0].venue_id;
  await f.pool.query("INSERT INTO installation_services(installation_id,service,state) VALUES($1,'remote_access','ready')",[v.installation]);
  await f.pool.query('INSERT INTO account_alert_preferences(account_id,enabled) VALUES($1,true)',[v.account]);
  const incident=(await f.pool.query("INSERT INTO venue_incidents(venue_id,kind,status,revision) VALUES($1,'disconnected','open',1) RETURNING id",[venue])).rows[0].id;
  const id=await transaction(f.pool,async c=>{
   const id=await outbox.enqueue(c,'service_alert',{email:`${v.account}@example.test`,incidentId:incident,venueId:venue,revision:1,issue:'disconnected',state:'open'});
   await c.query("INSERT INTO service_alert_deliveries(outbox_id,incident_id,revision,state,account_id) VALUES($1,$2,1,'open',$3)",[id,incident,v.account]);return id;
  });
  const cases:Record<string,[string,string,unknown[]]>={
   account:['SELECT id FROM cloud_accounts WHERE id=$1 FOR UPDATE','UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1',[v.account]],
   membership:['SELECT account_id FROM organisation_memberships WHERE account_id=$1 FOR UPDATE','UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',[v.account]],
   installation:['SELECT id FROM installations WHERE id=$1 FOR UPDATE','UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[v.installation]],
   incident:['SELECT id FROM venue_incidents WHERE id=$1 FOR UPDATE',"UPDATE venue_incidents SET status='suppressed',revision=revision+1 WHERE id=$1",[incident]],
   preference:['SELECT account_id FROM account_alert_preferences WHERE account_id=$1 FOR UPDATE','UPDATE account_alert_preferences SET enabled=false WHERE account_id=$1',[v.account]],
   service:['SELECT installation_id FROM installation_services WHERE installation_id=$1 FOR UPDATE',"UPDATE installation_services SET state='unconfigured' WHERE installation_id=$1",[v.installation]],
  };
  const [lock,change,args]=cases[target]!;await held.query('BEGIN');await held.query(lock,args);const pid=(await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;let sends=0;
  pending=accountWorker(f.pool,async()=>{sends++;}).runOnce();void pending.catch(()=>{});await waitBlocked(f.pool,pid);
  await held.query(change,args);await held.query('COMMIT');await pending;
  assert.equal(sends,0);assert.equal((await f.pool.query('SELECT status FROM email_outbox WHERE id=$1',[id])).rows[0].status,'cancelled');
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_attempts')).rows[0].count,'0');
 }finally{await held.query('ROLLBACK');await pending?.catch(()=>{});held.release();await f.close();}
});
