import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import type {RelayKeyConfig} from '../src/relay-payload.ts';
import {transaction} from '../src/transaction.ts';
import {admitMailAttempt,bindProviderId} from '../src/mail-attempts.ts';
import {fixture,config,rotated} from './fixtures/mail-attempt.ts';

test('admission commits an opaque one-recipient binding before SMTP and survives payload erasure',async()=>{
 const f=await fixture();try{
  const input=await f.account();const admitted=await transaction(f.pool,c=>admitMailAttempt(c,input));
  assert.match(admitted.attemptTag,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(admitted.attemptTag,'base64url').length,32);assert.equal(admitted.configurationSet,'transactional');
  const row=(await f.pool.query('SELECT * FROM mail_attempts')).rows[0];
  assert.equal(row.queue_id,input.claim.outboxId);assert.equal(row.claim_id,input.claim.claimId);
  assert.equal(row.country,'ES');assert.equal(row.region,'eu-north-1');assert.equal(row.policy_revision,3);
  assert.equal(row.configuration_revision,'synthetic-config-1');assert.equal(row.one_recipient,true);assert.equal(row.provider_message_id,null);
  const refs=(await f.pool.query('SELECT key_id,digest FROM mail_attempt_recipients')).rows;
  assert.equal(refs.length,1);assert.equal(refs[0].key_id,'v1');assert.match(refs[0].digest,/^[0-9a-f]{64}$/);
  await f.pool.query("UPDATE email_outbox SET status='sent',claim_id=NULL,lease_until=NULL,key_id=NULL,payload=NULL,finished_at=clock_timestamp() WHERE id=$1",[input.claim.outboxId]);
  assert.deepEqual((await f.pool.query('SELECT * FROM mail_attempts')).rows,[row]);
  const retained=JSON.stringify((await f.pool.query('SELECT to_jsonb(t) FROM mail_attempts t UNION ALL SELECT to_jsonb(t) FROM mail_attempt_recipients t')).rows);
  assert.equal(retained.includes(input.recipient),false);for(const field of ['payload','token','email','recipient'])assert.equal(Object.hasOwn(row,field),false);
 }finally{await f.close();}
});

test('rollback leaves no admission and retries use fresh tags with one durable tag per claimed attempt',async()=>{
 const f=await fixture();try{
  const input=await f.account();let abandoned='';
  await assert.rejects(transaction(f.pool,async c=>{abandoned=(await admitMailAttempt(c,input)).attemptTag;throw Error('interrupt');}),/interrupt/);
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_attempts')).rows[0].count,'0');
  const first=await transaction(f.pool,c=>admitMailAttempt(c,input));assert.notEqual(first.attemptTag,abandoned);
  await assert.rejects(transaction(f.pool,c=>admitMailAttempt(c,input)),/mail_attempt_conflict/);
  input.claim.claimId=randomUUID();input.claim.attempt=2;
  await f.pool.query('UPDATE email_outbox SET claim_id=$2,attempts=2 WHERE id=$1',[input.claim.outboxId,input.claim.claimId]);
  const second=await transaction(f.pool,c=>admitMailAttempt(c,input));assert.notEqual(first.attemptTag,second.attemptTag);
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_attempts')).rows[0].count,'2');
 }finally{await f.close();}
});

test('refuses stale unknown expired and wrong-purpose claims before creating bindings',async()=>{
 const f=await fixture();try{
  const input=await f.account();
  const {feedbackFixture}=await import('./fixtures/ses-feedback.ts');
  const {validateSesFeedbackConfig}=await import('../src/ses-feedback-config.ts');
  const onlyVenue=feedbackFixture('eu-north-1',['venue-email']);
  await assert.rejects(transaction(f.pool,c=>admitMailAttempt(c,{...input,config:validateSesFeedbackConfig(onlyVenue.policy,onlyVenue.input)})),/mail_configuration_unavailable/);
  for(const claim of [{...input.claim,claimId:randomUUID()},{...input.claim,attempt:2},{...input.claim,outboxId:randomUUID()}])
   await assert.rejects(transaction(f.pool,c=>admitMailAttempt(c,{...input,claim})),/mail_claim_unavailable/);
  await assert.rejects(transaction(f.pool,c=>admitMailAttempt(c,{...input,config:{...input.config}})),/mail_configuration_unavailable/);
  await f.pool.query("UPDATE email_outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[input.claim.outboxId]);
  await assert.rejects(transaction(f.pool,c=>admitMailAttempt(c,input)),/mail_claim_unavailable/);
  await f.pool.query("UPDATE email_outbox SET lease_until=clock_timestamp()+interval '1 minute',expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[input.claim.outboxId]);
  await assert.rejects(transaction(f.pool,c=>admitMailAttempt(c,input)),/mail_claim_unavailable/);
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_attempts')).rows[0].count,'0');
 }finally{await f.close();}
});

test('queue identity cannot be reattributed to another trusted country or provider region on retry',async()=>{
 const f=await fixture();try{
  const input=await f.account();await transaction(f.pool,c=>admitMailAttempt(c,input));
  input.claim.claimId=randomUUID();input.claim.attempt=2;
  await f.pool.query('UPDATE email_outbox SET claim_id=$2,attempts=2 WHERE id=$1',[input.claim.outboxId,input.claim.claimId]);
  for(const changed of [config('eu-west-3'),config('eu-north-1','FR'),config('eu-north-1','ES','999999999999')])
   await assert.rejects(transaction(f.pool,c=>admitMailAttempt(c,{...input,config:changed})),/mail_scope_conflict/);
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_attempts')).rows[0].count,'1');
 }finally{await f.close();}
});

test('provider observations are idempotent and concurrent first writers cannot overwrite another binding',async()=>{
 const f=await fixture();try{
  const input=await f.account();const a=await transaction(f.pool,c=>admitMailAttempt(c,input));
  const other=await f.account();const b=await transaction(f.pool,c=>admitMailAttempt(c,other));
  await Promise.all([transaction(f.pool,c=>bindProviderId(c,a.attemptTag,'provider-1')),transaction(f.pool,c=>bindProviderId(c,a.attemptTag,'provider-1'))]);
  await assert.rejects(transaction(f.pool,c=>bindProviderId(c,a.attemptTag,'provider-2')),/mail_provider_conflict/);
  await assert.rejects(transaction(f.pool,c=>bindProviderId(c,b.attemptTag,'provider-1')),/mail_provider_conflict/);
  for(const bad of ['', 'a'.repeat(257),'provider\nline'])await assert.rejects(transaction(f.pool,c=>bindProviderId(c,b.attemptTag,bad)),/mail_provider_conflict/);
  await transaction(f.pool,c=>bindProviderId(c,b.attemptTag,'p'.repeat(256)));
  const third=await transaction(f.pool,async c=>admitMailAttempt(c,await f.account()));
  const race=await Promise.allSettled(['left','right'].map(id=>transaction(f.pool,c=>bindProviderId(c,third.attemptTag,id))));
  assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(race.filter(r=>r.status==='rejected').length,1);
  assert.equal((await f.pool.query('SELECT provider_message_id FROM mail_attempts WHERE attempt_tag=$1',[a.attemptTag])).rows[0].provider_message_id,'provider-1');
 }finally{await f.close();}
});

test('persisted keys refuse missing changed or revoked historical material after rotation across connections',async()=>{
 const f=await fixture();try{
  const input=await f.account();
  for(const recipientKeys of [{activeKeyId:'missing',keys:{v1:'11'.repeat(32)}},{activeKeyId:'v1',keys:{v1:'short'}}])
   await assert.rejects(transaction(f.pool,c=>admitMailAttempt(c,{...input,recipientKeys})),/mail_keys_unavailable/);
  await transaction(f.pool,c=>admitMailAttempt(c,input));
  const otherPool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${f.schema}`});
  try{
   const next=await f.account();await transaction(otherPool,c=>admitMailAttempt(c,{...next,recipientKeys:rotated}));
   assert.equal((await f.pool.query('SELECT count(*) FROM mail_attempt_recipients WHERE attempt_tag=(SELECT attempt_tag FROM mail_attempts WHERE queue_id=$1)',[next.claim.outboxId])).rows[0].count,'2');
   for(const recipientKeys of ([{activeKeyId:'v2',keys:{v2:'22'.repeat(32)}},{activeKeyId:'v2',keys:{v1:'33'.repeat(32),v2:'22'.repeat(32)}}] as RelayKeyConfig[])){
    const fresh=await f.account();await assert.rejects(transaction(otherPool,c=>admitMailAttempt(c,{...fresh,recipientKeys})),/mail_keys_unavailable/);
   }
   await f.pool.query("UPDATE mail_recipient_key_versions SET revoked=true WHERE key_id='v1'");
   const fresh=await f.account();await assert.rejects(transaction(otherPool,c=>admitMailAttempt(c,{...fresh,recipientKeys:rotated})),/mail_keys_unavailable/);
  }finally{await otherPool.end();}
 }finally{await f.close();}
});

test('database refuses changing durable attribution references and first provider observation',async()=>{
 const f=await fixture();try{
  const a=await transaction(f.pool,async c=>admitMailAttempt(c,await f.account()));
  await transaction(f.pool,c=>bindProviderId(c,a.attemptTag,'kept'));
  for(const query of ["UPDATE mail_attempts SET policy_revision=policy_revision+1","UPDATE mail_attempts SET recipient_refs_sealed=false","UPDATE mail_attempts SET country='FR'","UPDATE mail_attempts SET provider_message_id='replacement'",
   'DELETE FROM mail_attempts',"UPDATE mail_attempt_recipients SET digest=repeat('a',64)",
   "UPDATE mail_queue_scopes SET region='eu-west-3'","UPDATE mail_recipient_key_versions SET commitment=repeat('a',64)"])
   await assert.rejects(f.pool.query(query),/mail_binding_immutable/);
 }finally{await f.close();}
});

test('venue attempts use their installation scope and share recipient digests with account attempts',async()=>{
 const {fixture:relayFixture}=await import('./fixtures/relay-worker.ts');
 const f=await relayFixture();try{
  const venue=await f.venue(),message=await venue.submit({recipient:'original@example.test'}),claimId=randomUUID();
  await f.pool.query("UPDATE relay_messages SET state='queued',claim_id=$2,lease_until=clock_timestamp()+interval '1 minute',attempts=1 WHERE message_id=$1",[message.messageId,claimId]);
  const input={config:config(),recipientKeys:rotated,recipient:'original@example.test',claim:{purpose:'venue-email' as const,installationId:venue.installation,messageId:message.messageId,claimId,attempt:1}};
  await assert.rejects(transaction(f.pool,c=>admitMailAttempt(c,input)),/mail_claim_unavailable/);
  await f.pool.query("UPDATE relay_messages SET state='sending' WHERE message_id=$1",[message.messageId]);
  for(const claim of [{...input.claim,claimId:randomUUID()},{...input.claim,attempt:2}])await assert.rejects(transaction(f.pool,c=>admitMailAttempt(c,{...input,claim})),/mail_claim_unavailable/);
  await assert.rejects(transaction(f.pool,c=>admitMailAttempt(c,{...input,claim:{...input.claim,installationId:randomUUID()}})),/mail_claim_unavailable/);
  const admission=await transaction(f.pool,c=>admitMailAttempt(c,input));
  const row=(await f.pool.query('SELECT purpose,installation_id,queue_id FROM mail_attempts WHERE attempt_tag=$1',[admission.attemptTag])).rows[0];
  assert.deepEqual(row,{purpose:'venue-email',installation_id:venue.installation,queue_id:message.messageId});
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_attempt_recipients')).rows[0].count,'2');
  const accountQueue=randomUUID(),accountClaim=randomUUID();
  await f.pool.query(`INSERT INTO email_outbox(id,kind,key_id,payload,expires_at,status,claim_id,lease_until,attempts)
   VALUES($1,'password_changed','payload',decode('1234','hex'),clock_timestamp()+interval '1 hour','processing',$2,clock_timestamp()+interval '1 minute',1)`,[accountQueue,accountClaim]);
  const accountInput={config:config(),recipientKeys:rotated,recipient:'Original@EXAMPLE.test',claim:{purpose:'cloud-account-email' as const,outboxId:accountQueue,claimId:accountClaim,attempt:1}};
  const accountAdmission=await transaction(f.pool,c=>admitMailAttempt(c,accountInput));
  const refs=async(tag:string)=>(await f.pool.query('SELECT key_id,digest FROM mail_attempt_recipients WHERE attempt_tag=$1 ORDER BY key_id',[tag])).rows;
  assert.deepEqual(await refs(accountAdmission.attemptTag),await refs(admission.attemptTag));
  const stale=await venue.submit({recipient:'original@example.test'}),staleClaim=randomUUID();
  await f.pool.query("UPDATE relay_messages SET state='sending',claim_id=$2,lease_until=clock_timestamp()-interval '1 second',attempts=1 WHERE message_id=$1",[stale.messageId,staleClaim]);
  const staleInput={...input,claim:{...input.claim,messageId:stale.messageId,claimId:staleClaim}};
  await assert.rejects(transaction(f.pool,c=>admitMailAttempt(c,staleInput)),/mail_claim_unavailable/);
  await f.pool.query("UPDATE relay_messages SET lease_until=clock_timestamp()+interval '1 minute',expires_at=clock_timestamp()-interval '1 second' WHERE message_id=$1",[stale.messageId]);
  await assert.rejects(transaction(f.pool,c=>admitMailAttempt(c,staleInput)),/mail_claim_unavailable/);
  const event=randomUUID();
  await f.pool.query(`INSERT INTO mail_feedback_events(id,attempt_tag,country,provider_account_id,region,recipient_identity,event_identity,kind,event_time)
   VALUES($1,$2,'ES','123456789012','eu-north-1',repeat('a',64),'complaint','complaint',clock_timestamp())`,[event,admission.attemptTag]);
  await f.pool.query(`INSERT INTO mail_suppressions(country,provider_account_id,region,key_id,digest,reason,event_id)
   SELECT country,provider_account_id,region,key_id,digest,'complaint',$2 FROM mail_attempt_recipients WHERE attempt_tag=$1`,[admission.attemptTag,event]);
  const next=await venue.submit({recipient:'original@example.test'}),nextClaim=randomUUID();
  await f.pool.query("UPDATE relay_messages SET state='sending',claim_id=$2,lease_until=clock_timestamp()+interval '1 minute',attempts=1 WHERE message_id=$1",[next.messageId,nextClaim]);
  await assert.rejects(transaction(f.pool,c=>admitMailAttempt(c,{...input,claim:{...input.claim,messageId:next.messageId,claimId:nextClaim}})),/mail_recipient_suppressed/);
  await assert.rejects(transaction(f.pool,c=>admitMailAttempt(c,accountInput)),/mail_recipient_suppressed/);
 }finally{await f.close();}
});

test('a restarted key-ring process cannot omit a persisted key or replace its material',async()=>{
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');
 const f=await fixture();try{
  await transaction(f.pool,async c=>admitMailAttempt(c,{...await f.account(),recipientKeys:rotated}));
  const input=await f.account();
  const script=`import {Pool} from 'pg';import {transaction} from './src/transaction.ts';
   import {admitMailAttempt} from './src/mail-attempts.ts';import {validateSesFeedbackConfig} from './src/ses-feedback-config.ts';
   import {feedbackFixture} from './test/fixtures/ses-feedback.ts';
   const [schema,raw]=process.argv.slice(1),input=JSON.parse(raw),f=feedbackFixture('eu-north-1',['cloud-account-email','venue-email']);
   input.config=validateSesFeedbackConfig(f.policy,f.input);
   const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:'-c search_path='+schema});
   try{await transaction(pool,c=>admitMailAttempt(c,input));console.log('admitted');}
   catch(e){if(e.message==='mail_keys_unavailable')console.log('keys_refused');else throw e;}finally{await pool.end();}`;
  const run=(recipientKeys:RelayKeyConfig)=>promisify(execFile)(process.execPath,['--input-type=module','-e',script,f.schema,JSON.stringify({...input,recipientKeys})],{cwd:new URL('../',import.meta.url),timeout:10000});
  assert.equal((await run({activeKeyId:'v2',keys:{v2:'22'.repeat(32)}})).stdout.trim(),'keys_refused');
  assert.equal((await run({activeKeyId:'v2',keys:{v1:'33'.repeat(32),v2:'22'.repeat(32)}})).stdout.trim(),'keys_refused');
  assert.equal((await run(rotated)).stdout.trim(),'admitted');
 }finally{await f.close();}
});

test('all durable helpers refuse an implicit transaction and provider IDs are unique across countries',async()=>{
 const f=await fixture(),client=await f.pool.connect();try{
  const input=await f.account();
  await assert.rejects(admitMailAttempt(client,input),/mail_transaction_required/);
  const a=await transaction(f.pool,c=>admitMailAttempt(c,input));
  await assert.rejects(bindProviderId(client,a.attemptTag,'outside'),/mail_transaction_required/);
  const other=await f.account(),b=await transaction(f.pool,c=>admitMailAttempt(c,{...other,config:config('eu-north-1','FR')}));
  const race=await Promise.allSettled([a,b].map(entry=>transaction(f.pool,c=>bindProviderId(c,entry.attemptTag,'shared-provider-id'))));
  assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(race.filter(r=>r.status==='rejected').length,1);
 }finally{client.release();await f.close();}
});

for(const deadline of ['lease_until','expires_at'])test(`admission rechecks ${deadline} after a queue-row lock wait`,async()=>{
 const {setImmediate}=await import('node:timers/promises');
 const f=await fixture(),held=await f.pool.connect(),worker=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  const input=await f.account();await f.pool.query(`UPDATE email_outbox SET ${deadline}=clock_timestamp()+interval '2 seconds' WHERE id=$1`,[input.claim.outboxId]);
  await held.query('BEGIN');await held.query('SELECT id FROM email_outbox WHERE id=$1 FOR UPDATE',[input.claim.outboxId]);
  const blocker=(await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  await worker.query('BEGIN');const pid=(await worker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  pending=admitMailAttempt(worker,input);void pending.catch(()=>{});
  let blocked=false;const until=performance.now()+1500;
  do{blocked=(await f.admin.query('SELECT $2=ANY(pg_blocking_pids($1)) AS blocked',[pid,blocker])).rows[0].blocked;if(!blocked)await setImmediate();}while(!blocked&&performance.now()<until);
  assert.equal(blocked,true,'admission waits on this queue row before its deadline');
  await held.query(`SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM (${deadline}-clock_timestamp())))+0.02) FROM email_outbox WHERE id=$1`,[input.claim.outboxId]);
  assert.equal((await held.query(`SELECT ${deadline}<=clock_timestamp() AS expired FROM email_outbox WHERE id=$1`,[input.claim.outboxId])).rows[0].expired,true);
  await held.query('ROLLBACK');
  await assert.rejects(pending,/mail_claim_unavailable/);
  await worker.query('ROLLBACK');assert.equal((await f.pool.query('SELECT count(*) FROM mail_attempts')).rows[0].count,'0');
 }finally{await held.query('ROLLBACK');await pending?.catch(()=>{});await worker.query('ROLLBACK');held.release();worker.release();await f.close();}
});

test('provider-ID conflict keeps the transaction usable for its durable conflict receipt',async()=>{
 const f=await fixture(),client=await f.pool.connect();try{
  const a=await transaction(f.pool,async c=>admitMailAttempt(c,await f.account()));
  const b=await transaction(f.pool,async c=>admitMailAttempt(c,await f.account()));
  await transaction(f.pool,c=>bindProviderId(c,a.attemptTag,'already-bound'));
  await client.query('BEGIN');await assert.rejects(bindProviderId(client,b.attemptTag,'already-bound'),/mail_provider_conflict/);
  await client.query(`INSERT INTO mail_feedback_receipts(country,topic_arn,sns_id,content_digest,result,diagnostic)
   VALUES('ES','arn:aws:sns:eu-north-1:123456789012:mail-feedback','conflict',repeat('a',64),'conflict','binding_conflict')`);
  await client.query('COMMIT');
  assert.equal((await f.pool.query('SELECT result FROM mail_feedback_receipts')).rows[0].result,'conflict');
 }finally{await client.query('ROLLBACK');client.release();await f.close();}
});

test('late recipient references cannot change an admitted destination',async()=>{
 const f=await fixture();try{
  const admitted=await transaction(f.pool,async c=>admitMailAttempt(c,await f.account()));
  await f.pool.query(`INSERT INTO mail_recipient_key_versions(country,provider_account_id,region,key_id,commitment)
   VALUES('ES','123456789012','eu-north-1','v2',repeat('b',64))`);
  await assert.rejects(f.pool.query(`INSERT INTO mail_attempt_recipients(attempt_tag,country,provider_account_id,region,key_id,digest)
   VALUES($1,'ES','123456789012','eu-north-1','v2',repeat('c',64))`,[admitted.attemptTag]),/mail_binding_immutable/);
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_attempt_recipients')).rows[0].count,'1');
 }finally{await f.close();}
});

test('immutable mail bindings refuse truncation including cascading truncation',async()=>{
 const f=await fixture();try{
  await transaction(f.pool,async c=>admitMailAttempt(c,await f.account()));
  for(const table of ['mail_queue_scopes','mail_attempts','mail_attempt_recipients','mail_feedback_receipts','mail_feedback_events','mail_suppressions','mail_recipient_key_versions','mail_suppression_actions'])
   await assert.rejects(f.pool.query(`TRUNCATE ${table} CASCADE`),/mail_binding_immutable/,table);
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_attempts')).rows[0].count,'1');
 }finally{await f.close();}
});

test('operator audit records, events and key revocation cannot be rewritten',async()=>{
 const f=await fixture();try{
  const a=await transaction(f.pool,async c=>admitMailAttempt(c,await f.account()));
  await f.pool.query(`INSERT INTO mail_suppression_actions(id,country,provider_account_id,region,key_id,digest,operator_id,action,reconciliation)
   VALUES($1,'ES','123456789012','eu-north-1','v1',repeat('a',64),$2,'remove','pending')`,[randomUUID(),randomUUID()]);
  for(const query of ["UPDATE mail_suppression_actions SET reconciliation='confirmed'",'DELETE FROM mail_suppression_actions'])
   await assert.rejects(f.pool.query(query),/mail_binding_immutable/);
  await f.pool.query(`INSERT INTO mail_feedback_events(id,attempt_tag,country,provider_account_id,region,recipient_identity,event_identity,kind,event_time)
   VALUES($1,$2,'ES','123456789012','eu-north-1',repeat('a',64),'immutable','complaint',clock_timestamp())`,[randomUUID(),a.attemptTag]);
  await assert.rejects(f.pool.query("UPDATE mail_feedback_events SET kind='delivery'"),/mail_binding_immutable/);
  await assert.rejects(f.pool.query('DELETE FROM mail_feedback_events'),/mail_binding_immutable/);
  await f.pool.query("UPDATE mail_recipient_key_versions SET revoked=true WHERE key_id='v1'");
  await assert.rejects(f.pool.query("UPDATE mail_recipient_key_versions SET revoked=false WHERE key_id='v1'"),/mail_binding_immutable/);
 }finally{await f.close();}
});

test('admission refuses an invalid recipient and out-of-range policy revision with fixed diagnostics',async()=>{
 const f=await fixture();try{
  const input=await f.account();
  await assert.rejects(transaction(f.pool,c=>admitMailAttempt(c,{...input,recipient:'not an address'})),/mail_recipient_unavailable/);
  const {feedbackFixture}=await import('./fixtures/ses-feedback.ts'),{validateSesFeedbackConfig}=await import('../src/ses-feedback-config.ts');
  const binding=feedbackFixture();binding.policy.revision=2147483648;binding.input.policyRevision=2147483648;
  for(const flow of binding.input.flows)flow.policyRevision=2147483648;
  const large=validateSesFeedbackConfig(binding.policy,binding.input);
  await assert.rejects(transaction(f.pool,c=>admitMailAttempt(c,{...input,config:large})),/mail_configuration_unavailable/);
 }finally{await f.close();}
});

test('an incomplete recipient binding cannot commit as an admitted attempt',async()=>{
 const f=await fixture(),client=await f.pool.connect();try{
  const input=await f.account();await client.query('BEGIN');
  await client.query(`INSERT INTO mail_queue_scopes(purpose,installation_id,queue_id,country,provider_account_id,region)
   VALUES('cloud-account-email','00000000-0000-0000-0000-000000000000',$1,'ES','123456789012','eu-north-1')`,[input.claim.outboxId]);
  const insert=`INSERT INTO mail_attempts(attempt_tag,purpose,installation_id,queue_id,country,provider_account_id,region,policy_revision,configuration_revision,configuration_set,claim_id,attempt,recipient_refs_sealed)
   VALUES($1,'cloud-account-email','00000000-0000-0000-0000-000000000000',$2,'ES','123456789012','eu-north-1',3,'synthetic-config-1','transactional',$3,1,$4)`;
  const values=[Buffer.alloc(32,9).toString('base64url'),input.claim.outboxId,input.claim.claimId];
  await client.query('SAVEPOINT early_seal');
  await assert.rejects(client.query(insert,[...values,true]),/mail_binding_immutable/);
  await client.query('ROLLBACK TO SAVEPOINT early_seal');await client.query('RELEASE SAVEPOINT early_seal');
  await client.query(insert,[...values,false]);
  const tag=Buffer.alloc(32,9).toString('base64url');
  await client.query('SAVEPOINT try_seal');
  await assert.rejects(client.query('UPDATE mail_attempts SET recipient_refs_sealed=true WHERE attempt_tag=$1',[tag]),/mail_attempt_incomplete/);
  await client.query('ROLLBACK TO SAVEPOINT try_seal');await client.query('RELEASE SAVEPOINT try_seal');
  await client.query(`INSERT INTO mail_recipient_key_versions(country,provider_account_id,region,key_id,commitment)
   VALUES('ES','123456789012','eu-north-1','v1',repeat('a',64)),('ES','123456789012','eu-north-1','v2',repeat('b',64))`);
  await client.query(`INSERT INTO mail_attempt_recipients(attempt_tag,country,provider_account_id,region,key_id,digest)
   VALUES($1,'ES','123456789012','eu-north-1','v1',repeat('c',64))`,[tag]);
  await client.query('SAVEPOINT try_seal');
  await assert.rejects(client.query('UPDATE mail_attempts SET recipient_refs_sealed=true WHERE attempt_tag=$1',[tag]),/mail_attempt_incomplete/);
  await client.query('ROLLBACK TO SAVEPOINT try_seal');await client.query('RELEASE SAVEPOINT try_seal');
  await assert.rejects(client.query('COMMIT'),/mail_attempt_incomplete/);
 }finally{await client.query('ROLLBACK');client.release();await f.close();}
});

test('key revocation cannot overtake an admission that already checked retained material',async()=>{
 const f=await fixture(),worker=await f.pool.connect(),revoker=await f.pool.connect();try{
  await transaction(f.pool,async c=>admitMailAttempt(c,await f.account()));
  const input=await f.account();await worker.query('BEGIN');await admitMailAttempt(worker,input);
  await revoker.query('BEGIN');await revoker.query("SET LOCAL lock_timeout='150ms'");
  await assert.rejects(revoker.query("UPDATE mail_recipient_key_versions SET revoked=true WHERE key_id='v1'"),{code:'55P03'});
  await revoker.query('ROLLBACK');await worker.query('COMMIT');
  await f.pool.query("UPDATE mail_recipient_key_versions SET revoked=true WHERE key_id='v1'");
  const next=await f.account();await assert.rejects(transaction(f.pool,c=>admitMailAttempt(c,next)),/mail_keys_unavailable/);
 }finally{await revoker.query('ROLLBACK');await worker.query('ROLLBACK');worker.release();revoker.release();await f.close();}
});

for(const deadline of ['lease_until','expires_at'])test(`venue admission rechecks ${deadline} after a queue-row lock wait`,async()=>{
 const {fixture:relayFixture}=await import('./fixtures/relay-worker.ts'),{setImmediate}=await import('node:timers/promises');
 const f=await relayFixture(),held=await f.pool.connect(),worker=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  const venue=await f.venue(),message=await venue.submit(),claimId=randomUUID();
  await f.pool.query(`UPDATE relay_messages SET state='sending',claim_id=$2,attempts=1,lease_until=clock_timestamp()+interval '${deadline==='lease_until'?'2 seconds':'1 minute'}',expires_at=clock_timestamp()+interval '${deadline==='expires_at'?'2 seconds':'1 minute'}' WHERE message_id=$1`,[message.messageId,claimId]);
  const input={config:config(),recipientKeys:rotated,recipient:message.recipient,claim:{purpose:'venue-email' as const,installationId:venue.installation,messageId:message.messageId,claimId,attempt:1}};
  await held.query('BEGIN');await held.query('SELECT message_id FROM relay_messages WHERE message_id=$1 FOR UPDATE',[message.messageId]);
  const blocker=(await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  await worker.query('BEGIN');const pid=(await worker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  pending=admitMailAttempt(worker,input);void pending.catch(()=>{});
  let blocked=false;const until=performance.now()+1500;
  do{blocked=(await f.pool.query('SELECT $2=ANY(pg_blocking_pids($1)) AS blocked',[pid,blocker])).rows[0].blocked;if(!blocked)await setImmediate();}while(!blocked&&performance.now()<until);
  assert.equal(blocked,true,'venue admission waits on this message row');
  await held.query(`SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM (${deadline}-clock_timestamp())))+0.02) FROM relay_messages WHERE message_id=$1`,[message.messageId]);
  assert.equal((await held.query(`SELECT ${deadline}<=clock_timestamp() AS expired FROM relay_messages WHERE message_id=$1`,[message.messageId])).rows[0].expired,true);
  await held.query('ROLLBACK');await assert.rejects(pending,/mail_claim_unavailable/);
 }finally{await held.query('ROLLBACK');await pending?.catch(()=>{});await worker.query('ROLLBACK');held.release();worker.release();await f.close();}
});
