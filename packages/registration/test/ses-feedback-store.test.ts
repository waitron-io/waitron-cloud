import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {Pool} from 'pg';
import type {ParsedFeedback} from '../src/ses-feedback-event.ts';
import type {RelayKeyConfig} from '../src/relay-payload.ts';
import {applySesFeedback} from '../src/ses-feedback-store.ts';
import {recipientIsSuppressed} from '../src/recipient-suppression.ts';
import {validateSesFeedbackConfig} from '../src/ses-feedback-config.ts';
import {parseSesFeedback} from '../src/ses-feedback-event.ts';
import {admitMailAttempt,bindProviderId} from '../src/mail-attempts.ts';
import {transaction} from '../src/transaction.ts';
import {fixture,keys,rotated,config} from './fixtures/mail-attempt.ts';
import {feedbackEnvelope,feedbackEvent,feedbackFixture} from './fixtures/ses-feedback.ts';

// These normalized events exercise storage; the separate parser suite owns raw envelopes.
function event(tag:string,changes:Partial<ParsedFeedback>={}):ParsedFeedback {
 const raw=feedbackEvent();raw.mail.tags['waitron-attempt']=[tag];
 const parsed={...parseSesFeedback(JSON.stringify(feedbackEnvelope(raw)),config()),...changes};
 return {...parsed,contentDigest:createHash('sha256').update(JSON.stringify(parsed)).digest('hex')};
}
async function counts(f:Awaited<ReturnType<typeof fixture>>) {
 return (await f.pool.query(`SELECT (SELECT count(*) FROM mail_feedback_receipts)::int AS receipts,
  (SELECT count(*) FROM mail_feedback_events)::int AS events,(SELECT count(*) FROM mail_suppressions)::int AS suppressions`)).rows[0];
}

test('feedback before the SMTP receipt binds once and commits one blocking event',async()=>{
 const f=await fixture();try{
  const input=await f.account('owner@example.test');
  const admitted=await transaction(f.pool,c=>admitMailAttempt(c,input));
  const raw=feedbackEvent();raw.mail.tags['waitron-attempt']=[admitted.attemptTag];
  const event=parseSesFeedback(JSON.stringify(feedbackEnvelope(raw)),input.config);
  assert.equal(await applySesFeedback(f.pool,input.config,keys,event),'applied');
  assert.equal(await applySesFeedback(f.pool,input.config,keys,event),'duplicate');
  await transaction(f.pool,c=>bindProviderId(c,admitted.attemptTag,'ses-message-1'));
  assert.deepEqual((await f.pool.query('SELECT provider_message_id FROM mail_attempts')).rows,[{provider_message_id:'ses-message-1'}]);
  assert.deepEqual((await f.pool.query('SELECT result,diagnostic FROM mail_feedback_receipts')).rows,[{result:'applied',diagnostic:'applied'}]);
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_feedback_events')).rows[0].count,'1');
  assert.deepEqual((await f.pool.query('SELECT reason FROM mail_suppressions')).rows,[{reason:'hard_bounce'}]);
 }finally{await f.close();}
});

test('a changed SNS payload conflicts without overwriting its original receipt or block',async()=>{
 const f=await fixture();try{
  const a=await transaction(f.pool,async c=>admitMailAttempt(c,await f.account('owner@example.test')));
  const first=event(a.attemptTag);await applySesFeedback(f.pool,config(),keys,first);
  const saved=(await f.pool.query('SELECT * FROM mail_feedback_receipts')).rows;
  assert.equal(await applySesFeedback(f.pool,config(),keys,{...first,contentDigest:'f'.repeat(64)}),'conflict');
  assert.deepEqual((await f.pool.query('SELECT * FROM mail_feedback_receipts')).rows,saved);
  assert.deepEqual(await counts(f),{receipts:1,events:1,suppressions:1});
 }finally{await f.close();}
});

test('a semantic repeat with a new SNS ID records transport without a second event or block',async()=>{
 const f=await fixture();try{
  const a=await transaction(f.pool,async c=>admitMailAttempt(c,await f.account('owner@example.test')));
  assert.equal(await applySesFeedback(f.pool,config(),keys,event(a.attemptTag)),'applied');
  assert.equal(await applySesFeedback(f.pool,config(),keys,event(a.attemptTag,{snsId:'new-transport',eventTime:'2026-11-04T11:00:00.000Z'})),'duplicate');
  assert.deepEqual(await counts(f),{receipts:2,events:1,suppressions:1});
  assert.equal(await applySesFeedback(f.pool,config(),keys,event(a.attemptTag,{snsId:'new-transport',eventTime:'2026-11-04T11:00:00.000Z'})),'duplicate');
 }finally{await f.close();}
});

test('a valid tag with another recipient records conflict before binding the provider ID',async()=>{
 const f=await fixture();try{
  const a=await transaction(f.pool,async c=>admitMailAttempt(c,await f.account('owner@example.test')));
  assert.equal(await applySesFeedback(f.pool,config(),keys,event(a.attemptTag,{recipient:'other@example.test'})),'conflict');
  assert.deepEqual(await counts(f),{receipts:1,events:0,suppressions:0});
  assert.equal((await f.pool.query('SELECT provider_message_id FROM mail_attempts')).rows[0].provider_message_id,null);
  assert.deepEqual((await f.pool.query('SELECT result,diagnostic FROM mail_feedback_receipts')).rows,[{result:'conflict',diagnostic:'binding_conflict'}]);
 }finally{await f.close();}
});

test('an unknown tag never guesses from a known provider ID or current queue content',async()=>{
 const f=await fixture();try{
  const a=await transaction(f.pool,async c=>admitMailAttempt(c,await f.account('owner@example.test')));
  await transaction(f.pool,c=>bindProviderId(c,a.attemptTag,'ses-message-1'));
  assert.equal(await applySesFeedback(f.pool,config(),keys,event(randomBytes(32).toString('base64url'))),'ignored');
  assert.deepEqual(await counts(f),{receipts:1,events:0,suppressions:0});
  assert.deepEqual((await f.pool.query('SELECT result,diagnostic FROM mail_feedback_receipts')).rows,[{result:'ignored',diagnostic:'unresolved'}]);
 }finally{await f.close();}
});

test('a redacted complaint resolves the sealed single recipient after payload erasure',async()=>{
 const f=await fixture();try{
  const input=await f.account('original@example.test');
  const a=await transaction(f.pool,c=>admitMailAttempt(c,input));
  await f.pool.query("UPDATE email_outbox SET status='sent',claim_id=NULL,lease_until=NULL,key_id=NULL,payload=NULL,finished_at=clock_timestamp() WHERE id=$1",[input.claim.outboxId]);
  const queue=(await f.pool.query('SELECT * FROM email_outbox')).rows;
  const changed=await f.account('changed@example.test');await transaction(f.pool,c=>admitMailAttempt(c,{...changed,recipientKeys:rotated}));
  assert.equal(await applySesFeedback(f.pool,input.config,rotated,event(a.attemptTag,{kind:'complaint',recipient:null})),'applied');
  const original=(await f.pool.query('SELECT key_id,digest FROM mail_attempt_recipients WHERE attempt_tag=$1',[a.attemptTag])).rows.map(r=>({keyId:r.key_id,digest:r.digest}));
  const other=(await f.pool.query('SELECT key_id,digest FROM mail_attempt_recipients WHERE attempt_tag<>$1',[a.attemptTag])).rows.map(r=>({keyId:r.key_id,digest:r.digest}));
  assert.equal(await transaction(f.pool,c=>recipientIsSuppressed(c,input.config.scope,original)),true);
  assert.equal(await transaction(f.pool,c=>recipientIsSuppressed(c,input.config.scope,other)),false);
  assert.deepEqual((await f.pool.query('SELECT * FROM email_outbox WHERE id=$1',[input.claim.outboxId])).rows,queue);
  const retained=JSON.stringify((await f.pool.query('SELECT to_jsonb(t) FROM mail_feedback_events t UNION ALL SELECT to_jsonb(t) FROM mail_feedback_receipts t UNION ALL SELECT to_jsonb(t) FROM mail_suppressions t')).rows);
  assert.equal(retained.includes('original@example.test'),false);assert.equal(retained.includes('changed@example.test'),false);
 }finally{await f.close();}
});

test('country provider region configuration and purpose mismatches cannot mutate the attempt',async()=>{
 const f=await fixture();try{
  const a=await transaction(f.pool,async c=>admitMailAttempt(c,await f.account('owner@example.test')));
  const onlyVenue=feedbackFixture('eu-north-1',['venue-email']);
  const revision=feedbackFixture();revision.input.revision='synthetic-config-2';
  for(const binding of revision.policy.smtpBindings)binding.revision=revision.input.revision;
  const policy=feedbackFixture();policy.policy.revision=4;policy.input.policyRevision=4;
  for(const flow of policy.input.flows)flow.policyRevision=4;
  const set=feedbackFixture();set.input.configurationSet='other';set.input.configurationSetArn=set.input.configurationSetArn.replace('transactional','other');
  for(const binding of set.policy.smtpBindings)binding.configurationSetArn=set.input.configurationSetArn;
  const configs=[config('eu-west-3'),config('eu-north-1','FR'),config('eu-north-1','ES','999999999012'),
   validateSesFeedbackConfig(onlyVenue.policy,onlyVenue.input),validateSesFeedbackConfig(revision.policy,revision.input),validateSesFeedbackConfig(set.policy,set.input),validateSesFeedbackConfig(policy.policy,policy.input)];
  for(const [i,current] of configs.entries())assert.equal(await applySesFeedback(f.pool,current,keys,event(a.attemptTag,{snsId:'wrong-scope-'+i})),'ignored');
  assert.deepEqual(await counts(f),{receipts:7,events:0,suppressions:0});
  assert.equal((await f.pool.query('SELECT provider_message_id FROM mail_attempts')).rows[0].provider_message_id,null);
  await assert.rejects(applySesFeedback(f.pool,{...config()},keys,event(a.attemptTag)),/mail_configuration_unavailable/);
 }finally{await f.close();}
});

test('unavailable changed or revoked retained keys leave feedback retryable without partial state',async()=>{
 const f=await fixture();try{
  const input=await f.account('owner@example.test');input.recipientKeys=rotated;
  const a=await transaction(f.pool,c=>admitMailAttempt(c,input));
  const rings:RelayKeyConfig[]=[keys,{activeKeyId:'missing',keys:rotated.keys},{activeKeyId:'v2',keys:{...rotated.keys,'invalid.key':'33'.repeat(32)}},
   {activeKeyId:'v2',keys:{...rotated.keys,extra:'invalid'}},{activeKeyId:'v2',keys:{v1:'invalid',v2:'22'.repeat(32)}},
   {activeKeyId:'v2',keys:{v2:'22'.repeat(32)}},{activeKeyId:'v2',keys:{v1:'33'.repeat(32),v2:'22'.repeat(32)}}];
  for(const ring of rings){
   await assert.rejects(applySesFeedback(f.pool,config(),ring,event(a.attemptTag)),/mail_keys_unavailable/);
   assert.deepEqual(await counts(f),{receipts:0,events:0,suppressions:0});
  }
  await f.pool.query("UPDATE mail_recipient_key_versions SET revoked=true WHERE key_id='v1'");
  await assert.rejects(applySesFeedback(f.pool,config(),rotated,event(a.attemptTag)),/mail_keys_unavailable/);
  assert.deepEqual(await counts(f),{receipts:0,events:0,suppressions:0});
  assert.equal((await f.pool.query('SELECT provider_message_id FROM mail_attempts')).rows[0].provider_message_id,null);
 }finally{await f.close();}
});

test('normalized original recipient matches after rotation without changing its binding',async()=>{
 const f=await fixture();try{
  const input=await f.account('Owner@Example.test');input.recipientKeys=rotated;
  const a=await transaction(f.pool,c=>admitMailAttempt(c,input));
  assert.equal(await applySesFeedback(f.pool,config(),rotated,event(a.attemptTag,{recipient:' OWNER@example.test '})),'applied');
  assert.deepEqual(await counts(f),{receipts:1,events:1,suppressions:2});
 }finally{await f.close();}
});

test('delivery temporary and unclassified outcomes never suppress or change sending state',async()=>{
 const f=await fixture();try{
  const a=await transaction(f.pool,async c=>admitMailAttempt(c,await f.account('owner@example.test')));
  const saved=(await f.pool.query('SELECT * FROM email_outbox')).rows;
  for(const kind of ['delivery','temporary','unclassified'] as const)
   assert.equal(await applySesFeedback(f.pool,config(),keys,event(a.attemptTag,{kind,snsId:kind,eventId:null})),'ignored');
  assert.deepEqual(await counts(f),{receipts:3,events:3,suppressions:0});
  assert.deepEqual((await f.pool.query('SELECT * FROM email_outbox')).rows,saved);
  assert.deepEqual((await f.pool.query('SELECT DISTINCT result,diagnostic FROM mail_feedback_receipts')).rows,[{result:'ignored',diagnostic:'non_blocking'}]);
 }finally{await f.close();}
});

test('out-of-order delivery and not-spam never clear any bounce complaint or provider block',async()=>{
 const f=await fixture();try{
  const a=await transaction(f.pool,async c=>admitMailAttempt(c,await f.account('owner@example.test')));
  for(const kind of ['hard_bounce','complaint','provider_suppressed','delivery','unclassified'] as const){
   const result=await applySesFeedback(f.pool,config(),keys,event(a.attemptTag,{kind,snsId:kind,eventId:kind,eventTime:'2026-11-04T09:00:00.000Z'}));
   assert.equal(result,kind==='delivery'||kind==='unclassified'?'ignored':'applied');
  }
  assert.deepEqual((await f.pool.query('SELECT reason FROM mail_suppressions ORDER BY reason')).rows,[{reason:'complaint'},{reason:'hard_bounce'},{reason:'provider_suppressed'}]);
  assert.deepEqual(await counts(f),{receipts:5,events:5,suppressions:3});
 }finally{await f.close();}
});

test('competing consumers serialize duplicate and conflicting first provider observations',async()=>{
 const f=await fixture();try{
  const a=await transaction(f.pool,async c=>admitMailAttempt(c,await f.account('owner@example.test')));
  const answers=await Promise.all(Array.from({length:6},()=>applySesFeedback(f.pool,config(),keys,event(a.attemptTag))));
  assert.deepEqual(answers.sort(),['applied','duplicate','duplicate','duplicate','duplicate','duplicate']);
  const conflict=event(a.attemptTag,{snsId:'conflicting-provider',providerMessageId:'other-provider'});
  assert.equal(await applySesFeedback(f.pool,config(),keys,conflict),'conflict');
  assert.deepEqual(await counts(f),{receipts:2,events:1,suppressions:1});
  assert.equal((await f.pool.query('SELECT provider_message_id FROM mail_attempts')).rows[0].provider_message_id,'ses-message-1');
 }finally{await f.close();}
});

test('a receipt write failure rolls back provider binding event and suppression together',async()=>{
 const f=await fixture();try{
  const a=await transaction(f.pool,async c=>admitMailAttempt(c,await f.account('owner@example.test')));
  await f.pool.query("CREATE FUNCTION refuse_feedback_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture_interrupted'; END $$; CREATE TRIGGER refuse_feedback BEFORE INSERT ON mail_feedback_receipts FOR EACH ROW EXECUTE FUNCTION refuse_feedback_receipt()");
  await assert.rejects(applySesFeedback(f.pool,config(),keys,event(a.attemptTag)),/fixture_interrupted/);
  assert.deepEqual(await counts(f),{receipts:0,events:0,suppressions:0});
  assert.equal((await f.pool.query('SELECT provider_message_id FROM mail_attempts')).rows[0].provider_message_id,null);
  await f.pool.query('DROP TRIGGER refuse_feedback ON mail_feedback_receipts');
  assert.equal(await applySesFeedback(f.pool,config(),keys,event(a.attemptTag)),'applied');
 }finally{await f.close();}
});

for(const stage of ['before','after'])test('process death '+stage+' commit restarts without a partial or second effect',async t=>{
 const f=await fixture();let stopChild=async()=>{};
 t.after(async()=>{await stopChild();await f.close();});
 const a=await transaction(f.pool,async c=>admitMailAttempt(c,await f.account('owner@example.test')));
 const feedback=event(a.attemptTag);
 const child=spawn(process.execPath,[new URL('./fixtures/ses-feedback-crash.ts',import.meta.url).pathname,JSON.stringify({schema:f.schema,stage,event:feedback})],{env:process.env,stdio:['ignore','ignore','pipe','ipc']});
 let stderr='';child.stderr!.on('data',bytes=>{stderr+=bytes.toString();});
 const closed=new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('close',()=>resolve());});
 stopChild=async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed;};
 await new Promise<void>((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('child did not reach commit boundary: '+stderr)),8000);
  child.once('message',message=>{clearTimeout(timer);try{assert.equal(message,stage);resolve();}catch(error){reject(error);}});
  child.once('exit',()=>{clearTimeout(timer);reject(Error('child exited before boundary: '+stderr));});
 });
 child.kill('SIGKILL');await closed;assert.equal(child.signalCode,'SIGKILL');
 assert.deepEqual(await counts(f),stage==='before'?{receipts:0,events:0,suppressions:0}:{receipts:1,events:1,suppressions:1});
 assert.equal(await applySesFeedback(f.pool,config(),keys,feedback),stage==='before'?'applied':'duplicate');
 assert.deepEqual(await counts(f),{receipts:1,events:1,suppressions:1});
});

test('another country tag is refused without waiting for its held attempt row',async()=>{
 const f=await fixture();const reader=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${f.schema} -c statement_timeout=200`});
 const holder=await f.pool.connect();
 try{
  const input=await f.account('owner@example.test');input.config=config('eu-north-1','FR');
  const a=await transaction(f.pool,c=>admitMailAttempt(c,input));
  await holder.query('BEGIN');await holder.query('SELECT 1 FROM mail_attempts WHERE attempt_tag=$1 FOR UPDATE',[a.attemptTag]);
  assert.equal(await applySesFeedback(reader,config(),keys,event(a.attemptTag)),'ignored');
  assert.deepEqual(await counts(f),{receipts:1,events:0,suppressions:0});
 }finally{await holder.query('ROLLBACK');holder.release();await reader.end();await f.close();}
});

test('feedback holds retained key rows until its provider binding commits',async()=>{
 const f=await fixture();const holder=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  const a=await transaction(f.pool,async c=>admitMailAttempt(c,await f.account('owner@example.test')));
  await holder.query('BEGIN');await holder.query('SELECT pg_advisory_xact_lock(hashtext(current_schema()),9991)');
  const holderId=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  await f.pool.query(`CREATE FUNCTION pause_feedback_binding() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
   PERFORM pg_advisory_xact_lock(hashtext(current_schema()),9991); RETURN NEW; END $$;
   CREATE TRIGGER pause_feedback BEFORE UPDATE OF provider_message_id ON mail_attempts FOR EACH ROW EXECUTE FUNCTION pause_feedback_binding()`);
  pending=applySesFeedback(f.pool,config(),keys,event(a.attemptTag));
  let waiting=false;
  for(let i=0;i<200;i++){
   const rows=(await f.admin.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))",[f.schema,holderId])).rows;
   if(rows.length){waiting=true;break;}
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.equal(waiting,true,'provider binding must reach the controlled database wait');
  await assert.rejects(f.pool.query('SELECT 1 FROM mail_recipient_key_versions FOR UPDATE NOWAIT'),{code:'55P03'});
  await holder.query('COMMIT');assert.equal(await pending,'applied');
 }finally{await holder.query('ROLLBACK');holder.release();if(pending)await pending.catch(()=>{});await f.close();}
});

test('events without feedback IDs deduplicate by type time provider and original recipient',async()=>{
 const f=await fixture();try{
  const a=await transaction(f.pool,async c=>admitMailAttempt(c,await f.account('owner@example.test')));
  assert.equal(await applySesFeedback(f.pool,config(),keys,event(a.attemptTag,{kind:'delivery',eventId:null})),'ignored');
  assert.equal(await applySesFeedback(f.pool,config(),keys,event(a.attemptTag,{kind:'delivery',eventId:null,snsId:'repeat'})),'duplicate');
  assert.equal(await applySesFeedback(f.pool,config(),keys,event(a.attemptTag,{kind:'delivery',eventId:null,snsId:'later',eventTime:'2026-11-05T10:00:00.000Z'})),'ignored');
  assert.equal(await applySesFeedback(f.pool,config(),keys,event(a.attemptTag,{kind:'temporary',eventId:null,snsId:'other-kind'})),'ignored');
  assert.deepEqual(await counts(f),{receipts:4,events:3,suppressions:0});
 }finally{await f.close();}
});

for(const state of ['accepted','uncertain'])test('venue feedback retains '+state+' sending and reservation facts after a contact change',async()=>{
 const {fixture:relayFixture}=await import('./fixtures/relay-worker.ts');
 const f=await relayFixture();try{
  const venue=await f.venue(),message=await venue.submit({recipient:'owner@example.test'}),claimId=randomUUID();
  await f.pool.query("UPDATE cloud_credentials SET email='owner@example.test' WHERE account_id=$1",[venue.account]);
  await f.pool.query("UPDATE relay_messages SET state='sending',claim_id=$2,lease_until=clock_timestamp()+interval '1 minute',attempts=1 WHERE message_id=$1",[message.messageId,claimId]);
  const a=await transaction(f.pool,c=>admitMailAttempt(c,{config:config(),recipientKeys:keys,recipient:'owner@example.test',claim:{purpose:'venue-email',installationId:venue.installation,messageId:message.messageId,claimId,attempt:1}}));
  await f.pool.query("UPDATE relay_messages SET state=$2,payload=NULL,claim_id=NULL,lease_until=NULL,reason=$3,status_revision=status_revision+1 WHERE message_id=$1",[message.messageId,state,state==='uncertain'?'uncertain':null]);
  await f.pool.query("UPDATE cloud_credentials SET email='changed@example.test' WHERE account_id=$1",[venue.account]);
  const before=await f.row(message.messageId),reservations=(await f.pool.query('SELECT * FROM relay_reservations')).rows;
  assert.equal(reservations.length,1);
  assert.equal(await applySesFeedback(f.pool,config(),keys,event(a.attemptTag,{kind:'complaint',recipient:null})),'applied');
  assert.equal(await applySesFeedback(f.pool,config(),keys,event(a.attemptTag,{kind:'delivery',snsId:'later-delivery',eventId:null})),'ignored');
  assert.deepEqual(await f.row(message.messageId),before);
  assert.deepEqual((await f.pool.query('SELECT * FROM relay_reservations')).rows,reservations);
  const outboxId=randomUUID(),accountClaim=randomUUID();
  await f.pool.query(`INSERT INTO email_outbox(id,kind,key_id,payload,expires_at,status,claim_id,lease_until,attempts)
   VALUES($1,'password_changed','payload',decode('1234','hex'),clock_timestamp()+interval '1 hour','processing',$2,clock_timestamp()+interval '1 minute',1)`,[outboxId,accountClaim]);
  await assert.rejects(transaction(f.pool,c=>admitMailAttempt(c,{config:config(),recipientKeys:keys,recipient:'owner@example.test',claim:{purpose:'cloud-account-email',outboxId,claimId:accountClaim,attempt:1}})),/mail_recipient_suppressed/);
  await transaction(f.pool,c=>admitMailAttempt(c,{config:config(),recipientKeys:keys,recipient:'changed@example.test',claim:{purpose:'cloud-account-email',outboxId,claimId:accountClaim,attempt:1}}));
 }finally{await f.close();}
});
