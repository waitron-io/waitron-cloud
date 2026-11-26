import {setRecoveryScope} from './fixtures/recovery-scope.ts';
import {PairingStore} from '../src/pairing.ts';
import type {PairingClaims} from '../src/pairing-proof.ts';
import {migrationRelease} from './fixtures/migration-release.ts';
import {migrate} from '../src/migrate.ts';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import {database,signupVerification} from '../../account-http/test/fixtures.ts';
import {createSession,login,resolveSession} from '@waitron-cloud/identity';
import {actionTestTotp,openProofWindow,prepareConnectionProof} from './fixtures/action-proof.ts';
import {transaction} from '../src/transaction.ts';
import {RegistrationStore} from '../src/index.ts';
import {SignupStore} from '../src/signup.ts';
import {OwnerTransferStore} from '../src/owner-transfer.ts';
import {AuthenticatorFactorStore} from '../src/authenticator-factor.ts';
import {PasswordRecoveryStore} from '../src/password-recovery.ts';
import {EmailWorker} from '../src/email-outbox.ts';
import {AccountSecurityStore} from '../src/account-security.ts';
let db:Awaited<ReturnType<typeof database>>;
before(async()=>{db=await database();});after(async()=>db?.close());
const password='A sufficiently long handover password';
async function requestAccount(){
 const email=`${randomUUID()}@example.test`,signup=new SignupStore(db.pool,db.outbox);await signup.request(email);
 return async()=>{
  const mail=await signupVerification(db,email);
  return {...await signup.complete(mail.token,{password,organisationName:'Café Sol',legalBusinessName:'Sol SL',countryCode:'ES'}),email};
 };
}
async function account(){return (await requestAccount())();}
test('a business refuses a second owner without removing its first owner',async()=>{
 const first=await account(),second=await account();
 await assert.rejects(db.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner) VALUES($1,$2,true)',[second.accountId,first.organisationId]),{code:'23505'});
 assert.deepEqual((await db.pool.query('SELECT account_id FROM organisation_memberships WHERE organisation_id=$1 AND is_owner',[first.organisationId])).rows,[{account_id:first.accountId}]);
});

async function signedAccount(enrolled=true,completeAccount=account){
 const a=await completeAccount(),session=await transaction(db.pool,c=>login(c,{email:a.email,password}));
 if(enrolled)await prepareConnectionProof(db.pool,a.accountId,session.token);else await openProofWindow(db.pool,session.token);
 return {...a,...session};
}
test('recipient acceptance replaces the sole owner and preserves each account’s other businesses',async()=>{
 const store=new OwnerTransferStore(db.pool,db.outbox);
 const sender=await signedAccount(),recipient=await signedAccount();
 await db.pool.query('INSERT INTO legal_businesses(id,organisation_id,name,country_code) VALUES($1,$2,$3,$4)', [randomUUID(), sender.organisationId, 'Ana SL', 'ES']);
 const offer=await store.create(sender.token,sender.csrfToken,sender.organisationId,recipient.email,'es');
 assert.deepEqual(offer.businessNames, ['Ana SL', 'Sol SL']);
 assert.equal(offer.state,'pending');assert.equal(offer.recipientEmail,recipient.email);
 const pending=await store.list(recipient.token);
 assert.equal(pending.length,1);
 assert.equal(pending[0]!.organisationName,'Café Sol');
 assert.equal((await store.list(sender.token))[0]!.organisationName,'Café Sol');
 assert.equal((await db.pool.query('SELECT count(*) FROM organisation_memberships WHERE account_id=$1 AND organisation_id=$2',[recipient.accountId,sender.organisationId])).rows[0].count,'0');
 const done=await store.decide(recipient.token,recipient.csrfToken,offer.id,'accept');assert.equal(done.state,'accepted');
 await db.pool.query('INSERT INTO legal_businesses(id,organisation_id,name,country_code) VALUES($1,$2,$3,$4)', [randomUUID(), sender.organisationId, 'New Owner SL', 'ES']);
 await db.pool.query('UPDATE organisations SET name=$2 WHERE id=$1', [sender.organisationId, 'New Owner Group']);
 const pastOffer=(await store.list(sender.token))[0]!;
 assert.deepEqual(pastOffer.businessNames, [], 'historical offers do not show the new owner’s businesses');
 assert.equal(pastOffer.organisationName, '', 'the former owner does not see a name the recipient chooses later');
 assert.equal((await store.list(recipient.token))[0]!.organisationName, 'New Owner Group');
 assert.deepEqual((await db.pool.query('SELECT account_id,is_owner,can_register_venues FROM organisation_memberships WHERE organisation_id=$1',[sender.organisationId])).rows,[{account_id:recipient.accountId,is_owner:true,can_register_venues:true}]);
 assert.equal((await transaction(db.pool,c=>resolveSession(c,sender.token,{touch:false}))).accountId,sender.accountId,'session remains usable outside the transferred business');
 assert.equal((await db.pool.query('SELECT is_owner FROM organisation_memberships WHERE account_id=$1 AND organisation_id=$2',[recipient.accountId,recipient.organisationId])).rows[0].is_owner,true);
 assert.equal((await store.decide(recipient.token,recipient.csrfToken,offer.id,'accept')).state,'accepted','lost-reply retry reads the offer outcome');
 const other=await signedAccount();await assert.rejects(store.decide(other.token,other.csrfToken,offer.id,'accept'),/transfer_unavailable/);
 assert.equal((await store.list(other.token)).length,0);
});

for(const who of ['sender','recipient'] as const)test(`${who} cancellation keeps the old owner and is repeatable`,async()=>{
 const sender=await signedAccount(),recipient=await signedAccount(),store=new OwnerTransferStore(db.pool,db.outbox),offer=await store.create(sender.token,sender.csrfToken,sender.organisationId,recipient.email),actor={sender,recipient}[who];
 assert.equal((await store.decide(actor.token,actor.csrfToken,offer.id,'cancel')).state,'cancelled');
 assert.equal((await store.decide(actor.token,actor.csrfToken,offer.id,'cancel')).state,'cancelled');
 assert.equal((await store.decide(recipient.token,recipient.csrfToken,offer.id,'accept')).state,'cancelled');
 assert.deepEqual((await db.pool.query('SELECT account_id FROM organisation_memberships WHERE organisation_id=$1 AND is_owner',[sender.organisationId])).rows,[{account_id:sender.accountId}]);
});
for(const change of ['sender disabled','ownership','recipient email','recipient unverified','enrollment','expiry'] as const)test(`accept refuses changed ${change} without replacing the owner`,async()=>{
 const sender=await signedAccount(),recipient=await signedAccount(),store=new OwnerTransferStore(db.pool,db.outbox),offer=await store.create(sender.token,sender.csrfToken,sender.organisationId,recipient.email);
 if(change==='sender disabled')await db.pool.query('UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1',[sender.accountId]);
 if(change==='ownership')await db.pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',[sender.accountId]);
 if(change==='recipient email')await db.pool.query("UPDATE cloud_credentials SET email=$2 WHERE account_id=$1",[recipient.accountId,randomUUID()+'@example.test']);
 if(change==='recipient unverified')await db.pool.query('UPDATE cloud_credentials SET email_verified_at=NULL WHERE account_id=$1',[recipient.accountId]);
 if(change==='enrollment')await db.pool.query('DELETE FROM cloud_passkeys WHERE account_id=$1',[recipient.accountId]);
 if(change==='expiry')await db.pool.query("UPDATE owner_transfers SET created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[offer.id]);
 await assert.rejects(store.decide(recipient.token,recipient.csrfToken,offer.id,'accept'),/transfer_unavailable|enrollment_required/);
 assert.equal((await db.pool.query('SELECT count(*) FROM organisation_memberships WHERE account_id=$1 AND organisation_id=$2',[recipient.accountId,sender.organisationId])).rows[0].count,'0');
});
for(const who of ['sender','recipient'] as const)test(`${who} password changes cancel the offer`,async()=>{
 const sender=await signedAccount(),recipient=await signedAccount(),store=new OwnerTransferStore(db.pool,db.outbox),offer=await store.create(sender.token,sender.csrfToken,sender.organisationId,recipient.email),actor={sender,recipient}[who];
 await new AccountSecurityStore(db.pool,db.outbox).password(actor.token,actor.csrfToken,'Another sufficiently long password');
 assert.equal((await db.pool.query('SELECT state FROM owner_transfers WHERE id=$1',[offer.id])).rows[0].state,'cancelled');
});
test('one live offer is replaced only after cancellation or expiry',async()=>{
 const sender=await signedAccount(),recipient=await signedAccount(),store=new OwnerTransferStore(db.pool,db.outbox),offer=await store.create(sender.token,sender.csrfToken,sender.organisationId,recipient.email);
 await assert.rejects(store.create(sender.token,sender.csrfToken,sender.organisationId,'unknown@example.test'),/transfer_pending/);
 await db.pool.query("UPDATE owner_transfers SET created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[offer.id]);
 const next=await store.create(sender.token,sender.csrfToken,sender.organisationId,'unknown@example.test');assert.notEqual(next.id,offer.id);
 assert.equal((await db.pool.query('SELECT state FROM owner_transfers WHERE id=$1',[offer.id])).rows[0].state,'expired');
});
test('creation and acceptance require fresh proof',async()=>{
 const sender=await signedAccount(),recipient=await signedAccount(),store=new OwnerTransferStore(db.pool,db.outbox);
 await db.pool.query('UPDATE cloud_sessions SET action_proved_at=NULL WHERE account_id=$1',[sender.accountId]);
 await assert.rejects(store.create(sender.token,sender.csrfToken,sender.organisationId,recipient.email),/proof_required/);
 await openProofWindow(db.pool,sender.token);const offer=await store.create(sender.token,sender.csrfToken,sender.organisationId,recipient.email);
 await db.pool.query("UPDATE cloud_sessions SET action_proved_at=clock_timestamp()-interval '11 minutes' WHERE account_id=$1",[recipient.accountId]);
 await assert.rejects(store.decide(recipient.token,recipient.csrfToken,offer.id,'accept'),/proof_required/);
});

test('unknown, unverified and disabled recipients get the same fixed invitation and sender view',async()=>{
 const store=new OwnerTransferStore(db.pool,db.outbox),views=[];
 for(const status of ['unknown','unverified','disabled']){
  const sender=await signedAccount(),recipient=await signedAccount();
  if(status==='unverified')await db.pool.query('UPDATE cloud_credentials SET email_verified_at=NULL WHERE account_id=$1',[recipient.accountId]);
  if(status==='disabled')await db.pool.query('UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1',[recipient.accountId]);
  const email=status==='unknown'?randomUUID()+'@example.test':recipient.email;
  const offer=await store.create(sender.token,sender.csrfToken,sender.organisationId,email);views.push(Object.keys(offer).sort());
  assert.equal(offer.state,'pending');assert.equal(offer.recipientEmail,email);
  const row=(await db.pool.query("SELECT * FROM email_outbox WHERE kind='owner_transfer' ORDER BY created_at DESC LIMIT 1")).rows[0];assert.ok(row,'fixed invitation is queued for every address');
  const mail=db.outbox.open(row);assert.equal(mail.email,email);assert.equal((mail as {event:string}).event,'invitation');
 }
 assert.deepEqual(views[0],views[1]);assert.deepEqual(views[1],views[2]);
});
for(const action of ['accept','cancel'] as const)test(`${action} queues both participant notices and delivery refuses changed addresses`,async()=>{
 const sender=await signedAccount(),recipient=await signedAccount(),store=new OwnerTransferStore(db.pool,db.outbox),offer=await store.create(sender.token,sender.csrfToken,sender.organisationId,recipient.email,'es');
 await store.decide(recipient.token,recipient.csrfToken,offer.id,action);
 const rows=(await db.pool.query("SELECT * FROM email_outbox WHERE kind='owner_transfer' AND payload IS NOT NULL")).rows.filter(row=>(db.outbox.open(row) as {offerId:string}).offerId===offer.id);
 assert.equal(rows.length,3);assert.deepEqual(rows.map(r=>db.outbox.open(r)).filter(m=>(m as {event:string}).event!=='invitation').map(m=>m.email).sort(),[sender.email,recipient.email].sort());
 await db.pool.query('UPDATE cloud_credentials SET email=$2 WHERE account_id=$1',[sender.accountId,randomUUID()+'@example.test']);
 const sent:unknown[]=[];const worker=new EmailWorker(db.pool,db.outbox,{async sendServiceAlert(){},async sendVerification(){},async sendPasswordReset(){},async sendPasswordChanged(){},async sendOwnerTransfer(m:unknown){sent.push(m);}});
 // Drain all pending work, including the now-obsolete invitation, before claiming a message was refused.
 while(await worker.runOnce()){};
 assert.deepEqual(sent.filter(m=>(m as {offerId:string}).offerId===offer.id),[{email:recipient.email,locale:'es',offerId:offer.id,event:action==='accept'?'accepted':'cancelled'}]);
});
test('initial recipient app enrollment preserves only its offer, ends the session and permits a fresh signed-in acceptance',async()=>{
 const sender=await signedAccount(),recipient=await signedAccount(false),store=new OwnerTransferStore(db.pool,db.outbox),offer=await store.create(sender.token,sender.csrfToken,sender.organisationId,recipient.email);
 const app=new AuthenticatorFactorStore(db.pool,{activeKeyId:'test',keys:{test:'07'.repeat(32)}},{pendingLifetimeMs:300000,enrolmentAttempts:3});
 const pending=await app.begin({token:recipient.token,csrfToken:recipient.csrfToken});await app.activate(recipient,pending.pendingToken,actionTestTotp(pending.secret));
 assert.equal((await db.pool.query('SELECT state FROM owner_transfers WHERE id=$1',[offer.id])).rows[0].state,'pending');
 await assert.rejects(store.decide(recipient.token,recipient.csrfToken,offer.id,'accept'),/session_unavailable/);
 const fresh=await transaction(db.pool,c=>createSession(c,recipient.accountId));await openProofWindow(db.pool,fresh.token);
 assert.equal((await store.decide(fresh.token,fresh.csrfToken,offer.id,'accept')).state,'accepted');
});
test('a mailbox password reset cancels the recipient’s pending offer',async()=>{
 const sender=await signedAccount(),recipient=await signedAccount(),store=new OwnerTransferStore(db.pool,db.outbox),offer=await store.create(sender.token,sender.csrfToken,sender.organisationId,recipient.email),reset=new PasswordRecoveryStore(db.pool,db.outbox);
 await reset.request(recipient.email);const mail=db.outbox.open((await db.pool.query("SELECT * FROM email_outbox WHERE kind='password_reset' ORDER BY created_at DESC LIMIT 1")).rows[0]);assert.ok('token' in mail);
 await reset.complete(mail.token,'A completely new reset password');
 assert.equal((await db.pool.query('SELECT state FROM owner_transfers WHERE id=$1',[offer.id])).rows[0].state,'cancelled');
});

async function venueFor(sender:Awaited<ReturnType<typeof signedAccount>>){
 const store=new RegistrationStore(db.pool),binding={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),venueId:'',environment:'test',organisationId:sender.organisationId,legalBusinessId:sender.legalBusinessId};
 await store.start(binding);await store.approveCloud(binding,sender.accountId);await store.approveLocal(binding,randomUUID());return store.complete(binding);
}
test('accept revokes the former owner’s grants and consent without changing machine authority',async()=>{
 const sender=await signedAccount(),recipient=await signedAccount(),v=await venueFor(sender),store=new OwnerTransferStore(db.pool,db.outbox),grant=randomUUID();
 await db.pool.query("INSERT INTO support_grants(id,organisation_id,platform_account_id,approved_by_account_id,actions,reason,expires_at) VALUES($1,$2,$3,$4,ARRAY['diagnostics.run'],'Check this venue',clock_timestamp()+interval '1 hour')",[grant,sender.organisationId,recipient.accountId,sender.accountId]);
 await db.pool.query(`INSERT INTO relay_grants(id,installation_id,account_id,organisation_id,venue_id,environment,public_key,management_origin,consent_version,revision,enabled,expires_at,origin_verified_until)
  SELECT $1,i.id,$2,$3,$4,'test',i.public_key,'https://manage.example.test','local-v1',1,true,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '2 hours' FROM installations i WHERE i.id=$5`,[randomUUID(),sender.accountId,sender.organisationId,v.venueId,v.installationId]);
 await db.pool.query("INSERT INTO translation_consents(id,venue_id,organisation_id,account_id,consent_version,providers) VALUES($1,$2,$3,$4,'providers-2026-10-14',ARRAY['openai','anthropic','google'])",[randomUUID(),v.venueId,sender.organisationId,sender.accountId]);
 const machine=(await db.pool.query('SELECT * FROM installations WHERE id=$1',[v.installationId])).rows[0];
 const offer=await store.create(sender.token,sender.csrfToken,sender.organisationId,recipient.email);await store.decide(recipient.token,recipient.csrfToken,offer.id,'accept');
 assert.ok((await db.pool.query('SELECT revoked_at FROM support_grants WHERE id=$1',[grant])).rows[0].revoked_at);
 const relay=(await db.pool.query('SELECT revoked_at,enabled FROM relay_grants WHERE installation_id=$1',[v.installationId])).rows[0];assert.ok(relay.revoked_at);assert.equal(relay.enabled,false);
 assert.ok((await db.pool.query('SELECT withdrawn_at FROM translation_consents WHERE venue_id=$1',[v.venueId])).rows[0].withdrawn_at);
 assert.deepEqual((await db.pool.query('SELECT * FROM installations WHERE id=$1',[v.installationId])).rows[0],machine);
 const back=await store.create(recipient.token,recipient.csrfToken,sender.organisationId,sender.email);await store.decide(sender.token,sender.csrfToken,back.id,'accept');
 assert.ok((await db.pool.query('SELECT revoked_at FROM support_grants WHERE id=$1',[grant])).rows[0].revoked_at,'handover back never revives an old approval');
});
test('acceptance clears only the transferred business’s saved sender and reply address',async()=>{
 const sender=await signedAccount(),recipient=await signedAccount(),v=await venueFor(sender),other=await venueFor(recipient);
 const store=new OwnerTransferStore(db.pool,db.outbox),token=randomUUID(),otherToken=randomUUID();
 const settings=async(venueId:string,reply:string,from:string,selector:string)=>db.pool.query(`UPDATE venues
  SET waitron_mail_reply_to=$2,waitron_mail_from=$3,waitron_mail_dns_token=$4 WHERE id=$1`,[venueId,reply,from,selector]);
 await settings(v.venueId,'owner@example.test','office@cafe.example.test',token);
 await settings(other.venueId,'other@example.test','office@bistro.example.test',otherToken);
 const offer=await store.create(sender.token,sender.csrfToken,sender.organisationId,recipient.email);
 const address=async(venueId:string)=>(await db.pool.query(`SELECT waitron_mail_reply_to AS reply,waitron_mail_from AS sender,
  waitron_mail_dns_token AS token FROM venues WHERE id=$1`,[venueId])).rows[0];
 assert.deepEqual(await address(v.venueId),{reply:'owner@example.test',sender:'office@cafe.example.test',token});
 assert.equal((await store.decide(recipient.token,recipient.csrfToken,offer.id,'accept')).state,'accepted');
 assert.deepEqual(await address(v.venueId),{reply:null,sender:null,token:null});
 assert.deepEqual(await address(other.venueId),{reply:'other@example.test',sender:'office@bistro.example.test',token:otherToken});
});
for(const state of ['pending','restored','unfinished replacement'] as const)test(`handover refuses ${state} recovery until the owner closes it`,async()=>{
 const sender=await signedAccount(),recipient=await signedAccount(),v=await venueFor(sender),store=new OwnerTransferStore(db.pool,db.outbox),point=randomUUID(),recovery=randomUUID();
 await db.pool.query("INSERT INTO backup_locations(venue_id,installation_id,endpoint,bucket,region) VALUES($1,$2,'https://store.test',$1::uuid::text,'local')",[v.venueId,v.installationId]);
 await db.pool.query("INSERT INTO backup_key_versions(venue_id,version,sealed) VALUES($1,1,'test')",[v.venueId]);
 await db.pool.query('INSERT INTO backup_captures(id,venue_id,installation_id,key_version) VALUES($1,$2,$3,1)',[point,v.venueId,v.installationId]);
 await db.pool.query("INSERT INTO backup_points(id,venue_id,installation_id,key_version,kind,object_key,digest,size,captured_at,retention,source_node_id,modules) VALUES($1,$2,$3,1,'snapshot',$1::uuid::text,repeat('a',64),1,clock_timestamp(),'daily',$1,'{}')",[point,v.venueId,v.installationId]);
 await db.pool.query("INSERT INTO backup_recoveries(id,venue_id,point_id,account_id,target_public_key,mode,status) VALUES($1,$2,$3,$4,$1::uuid::text,'planned',$5)",[recovery,v.venueId,point,sender.accountId,state==='unfinished replacement'?'closed':state]);
 if(state==='unfinished replacement')await db.pool.query("INSERT INTO installation_replacements(id,venue_id,old_installation_id,public_key,peer_public_key,node_id) VALUES($1,$2,$3,$1::uuid::text,$1::uuid::text,$1)",[recovery,v.venueId,v.installationId]);
 const offer=await store.create(sender.token,sender.csrfToken,sender.organisationId,recipient.email);
 await assert.rejects(store.decide(recipient.token,recipient.csrfToken,offer.id,'accept'),/recovery_in_progress/);
 assert.deepEqual((await db.pool.query('SELECT account_id FROM organisation_memberships WHERE organisation_id=$1 AND is_owner',[sender.organisationId])).rows,[{account_id:sender.accountId}]);
});

test('acceptance rolls every change back when expiry passes while writing membership',async()=>{
 const sender=await signedAccount(),recipient=await signedAccount(),store=new OwnerTransferStore(db.pool,db.outbox),offer=await store.create(sender.token,sender.csrfToken,sender.organisationId,recipient.email);
 const blocker=await db.secondPool.connect();let work:Promise<unknown>|undefined;
 await db.pool.query(`CREATE TABLE handover_gate(id integer PRIMARY KEY);INSERT INTO handover_gate VALUES(1);
  CREATE FUNCTION handover_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM id FROM handover_gate WHERE id=1 FOR UPDATE;RETURN NEW;END $$;
  CREATE TRIGGER handover_pause BEFORE INSERT ON organisation_memberships FOR EACH ROW EXECUTE FUNCTION handover_pause()`);
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT 1 FROM handover_gate FOR UPDATE');
  await db.pool.query("UPDATE owner_transfers SET expires_at=clock_timestamp()+interval '2 seconds' WHERE id=$1",[offer.id]);
  work=assert.rejects(store.decide(recipient.token,recipient.csrfToken,offer.id,'accept'),/transfer_unavailable/);
  let waiting=false;for(let n=0;n<200;n++){if((await db.pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[db.schema])).rowCount){waiting=true;break;}await new Promise(r=>setTimeout(r,10));}
  assert.equal(waiting,true);await new Promise(r=>setTimeout(r,2100));await blocker.query('COMMIT');await work;
  assert.deepEqual((await db.pool.query('SELECT account_id FROM organisation_memberships WHERE organisation_id=$1 AND is_owner',[sender.organisationId])).rows,[{account_id:sender.accountId}]);
  assert.equal((await db.pool.query('SELECT state FROM owner_transfers WHERE id=$1',[offer.id])).rows[0].state,'pending');
 }finally{await blocker.query('ROLLBACK');blocker.release();await work?.catch(()=>{});await db.pool.query('DROP TRIGGER handover_pause ON organisation_memberships;DROP FUNCTION handover_pause();DROP TABLE handover_gate');}
});
test('competing acceptance and cancellation have one durable outcome',async()=>{
 const sender=await signedAccount(),recipient=await signedAccount(),store=new OwnerTransferStore(db.pool,db.outbox),offer=await store.create(sender.token,sender.csrfToken,sender.organisationId,recipient.email);
 const replies=await Promise.all([store.decide(recipient.token,recipient.csrfToken,offer.id,'accept'),store.decide(sender.token,sender.csrfToken,offer.id,'cancel')]);
 assert.equal(replies[0].state,replies[1].state);
 assert.deepEqual((await db.pool.query('SELECT account_id FROM organisation_memberships WHERE organisation_id=$1 AND is_owner',[sender.organisationId])).rows,[{account_id:replies[0].state==='accepted'?recipient.accountId:sender.accountId}]);
});

test('upgrade refuses duplicate owners and preserves both rows until the duplicates are resolved',async()=>{
 const old=await migrationRelease(67),legacy=await database();
 try{
  await legacy.pool.query('DROP SCHEMA '+legacy.schema+' CASCADE; CREATE SCHEMA '+legacy.schema);await old.migrate(legacy.pool);
  const first=randomUUID(),second=randomUUID(),org=randomUUID();await legacy.pool.query('INSERT INTO cloud_accounts(id) VALUES($1),($2)',[first,second]);await legacy.pool.query('INSERT INTO organisations(id) VALUES($1)',[org]);
  await legacy.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner) VALUES($1,$3,true),($2,$3,true)',[first,second,org]);
  await assert.rejects(migrate(legacy.pool),{code:'23505'});
  assert.deepEqual((await legacy.pool.query('SELECT account_id FROM organisation_memberships WHERE organisation_id=$1 AND is_owner ORDER BY account_id',[org])).rows,[first,second].sort().map(account_id=>({account_id})));
  assert.equal((await legacy.pool.query('SELECT count(*) FROM schema_migrations')).rows[0].count,'67');
  await legacy.pool.query('DELETE FROM organisation_memberships WHERE account_id=$1',[second]);await migrate(legacy.pool);
  assert.equal((await legacy.pool.query('SELECT count(*) FROM schema_migrations')).rows[0].count,'88');
 }finally{await legacy.close();await old.close();}
});

test('acceptance promotes an existing non-owner membership without a second owner',async()=>{
 const sender=await signedAccount(),recipient=await signedAccount(),store=new OwnerTransferStore(db.pool,db.outbox);
 await db.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner,can_register_venues) VALUES($1,$2,false,false)',[recipient.accountId,sender.organisationId]);
 const offer=await store.create(sender.token,sender.csrfToken,sender.organisationId,recipient.email);await store.decide(recipient.token,recipient.csrfToken,offer.id,'accept');
 assert.deepEqual((await db.pool.query('SELECT account_id,is_owner,can_register_venues FROM organisation_memberships WHERE organisation_id=$1',[sender.organisationId])).rows,[{account_id:recipient.accountId,is_owner:true,can_register_venues:true}]);
 const {rows:[membership]}=await db.pool.query("SELECT to_jsonb(m)->>'owner_since' AS owner_since FROM organisation_memberships m WHERE organisation_id=$1 AND is_owner",[sender.organisationId]);
 assert.ok(membership.owner_since, 'promotion records when ownership started');
});

test('handover records ownership time after waiting for the organisation lock and preserves it on replay',async()=>{
 const sender=await signedAccount(),recipient=await signedAccount(),store=new OwnerTransferStore(db.pool,db.outbox);
 const offer=await store.create(sender.token,sender.csrfToken,sender.organisationId,recipient.email);
 const blocker=await db.secondPool.connect();
 let acceptance:ReturnType<OwnerTransferStore['decide']>|undefined;
 try{
  await blocker.query('BEGIN');
  await blocker.query('SELECT id FROM organisations WHERE id=$1 FOR UPDATE',[sender.organisationId]);
  const {rows:[{pid}]}=await blocker.query('SELECT pg_backend_pid() AS pid');
  acceptance=store.decide(recipient.token,recipient.csrfToken,offer.id,'accept');
  void acceptance.catch(()=>{});
  let waiting=false;
  for(let step=0;step<100&&!waiting;step++){
   waiting=!!(await db.pool.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))',[db.schema,pid])).rowCount;
   if(!waiting)await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.ok(waiting,'acceptance reached the organisation lock');
  const {rows:[{at}]}=await blocker.query('SELECT clock_timestamp()::text AS at');
  await blocker.query('COMMIT');
  assert.equal((await acceptance).state,'accepted');
  const membership=()=>db.pool.query("SELECT to_jsonb(m)->>'owner_since' AS owner_since, (to_jsonb(m)->>'owner_since')::timestamptz >= $2::timestamptz AS started_after_wait FROM organisation_memberships m WHERE organisation_id=$1 AND is_owner",[sender.organisationId,at]);
  const before=(await membership()).rows[0];
  assert.equal(before.started_after_wait,true);
  assert.equal((await store.decide(recipient.token,recipient.csrfToken,offer.id,'accept')).state,'accepted');
  assert.deepEqual((await membership()).rows[0],before);
 }finally{await blocker.query('ROLLBACK');blocker.release();await acceptance?.catch(()=>{});}
});

test('a pending venue connection loses its former owner approval at handover',async()=>{
 const sender=await signedAccount(),recipient=await signedAccount(),pairing=new PairingStore(db.pool),store=new OwnerTransferStore(db.pool,db.outbox);
 const claims:PairingClaims={origin:'https://cloud.example',action:'start',requestId:randomUUID(),publicKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),venueId:'',environment:'test',code:'12345678',organisationId:'',legalBusinessId:'',issuedAt:Date.now(),venueName:''};
 await pairing.start(claims);await pairing.approve(claims.requestId,claims.code,sender.organisationId,sender.legalBusinessId,sender.token,sender.csrfToken);
 const offer=await store.create(sender.token,sender.csrfToken,sender.organisationId,recipient.email);await store.decide(recipient.token,recipient.csrfToken,offer.id,'accept');
 await assert.rejects(pairing.complete({...claims,action:'complete',code:'',organisationId:sender.organisationId,legalBusinessId:sender.legalBusinessId}),/permission_denied|pairing_unavailable/);
 assert.equal((await db.pool.query('SELECT count(*) FROM installations WHERE public_key=$1',[claims.publicKey])).rows[0].count,'0');
});


test('a security change leaves an expired offer expired without queuing cancellation notices',async()=>{
 const sender=await signedAccount(),recipient=await signedAccount(),store=new OwnerTransferStore(db.pool,db.outbox),offer=await store.create(sender.token,sender.csrfToken,sender.organisationId,recipient.email);
 await db.pool.query("UPDATE owner_transfers SET created_at=clock_timestamp()-interval '3 days',expires_at=clock_timestamp()-interval '2 days' WHERE id=$1",[offer.id]);
 await new AccountSecurityStore(db.pool,db.outbox).password(sender.token,sender.csrfToken,'Another sufficiently long password');
 assert.equal((await store.list(recipient.token)).find(row=>row.id===offer.id)?.state,'expired');
 const messages=(await db.pool.query("SELECT * FROM email_outbox WHERE kind='owner_transfer' AND payload IS NOT NULL")).rows.map(row=>db.outbox.open(row)).filter(message=>(message as {offerId:string}).offerId===offer.id);
 assert.deepEqual(messages.map(message=>(message as {event:string}).event),['invitation']);
});

test('verified first-time signup attaches every live offer without creating business access or a session',async()=>{
 // Both verification rows must be committed before either sender looks up its email.
 const completeAccounts=await Promise.all([requestAccount(),requestAccount()]);
 const senders=await Promise.all(completeAccounts.map(complete=>signedAccount(true,complete))),email=`new-${randomUUID()}@example.test`,store=new OwnerTransferStore(db.pool,db.outbox);
 const offers=[];for(const sender of senders)offers.push(await store.create(sender.token,sender.csrfToken,sender.organisationId,email));
 const signup=new SignupStore(db.pool,db.outbox);await signup.request(email);
 const mail=db.outbox.open((await db.pool.query("SELECT * FROM email_outbox WHERE kind='verification' ORDER BY created_at DESC LIMIT 1")).rows[0]);assert.ok('token' in mail);
 const before=(await db.pool.query('SELECT count(*) FROM organisations')).rows[0].count;
 const result=await signup.completeAccount(mail.token,{password});
 assert.deepEqual(Object.keys(result),['accountId']);
 assert.equal((await db.pool.query('SELECT count(*) FROM organisations')).rows[0].count,before);
 assert.equal((await db.pool.query('SELECT count(*) FROM organisation_memberships WHERE account_id=$1',[result.accountId])).rows[0].count,'0');
 assert.equal((await db.pool.query('SELECT count(*) FROM cloud_sessions WHERE account_id=$1',[result.accountId])).rows[0].count,'0');
 const rows=(await db.pool.query('SELECT id,recipient_id,recipient_needs_enrolment FROM owner_transfers WHERE id=ANY($1::uuid[]) ORDER BY id',[offers.map(o=>o.id)])).rows;
 assert.deepEqual(rows,offers.map(o=>({id:o.id,recipient_id:result.accountId,recipient_needs_enrolment:true})).sort((a,b)=>a.id.localeCompare(b.id)));
 await assert.rejects(signup.completeAccount(mail.token,{password}),/verification_unavailable/);
});
for(const unavailable of ['wrong address','cancelled','expired'])test(`account-only signup leaves ${unavailable} offers unattached`,async()=>{
 const sender=await signedAccount(),email=`new-${randomUUID()}@example.test`,store=new OwnerTransferStore(db.pool,db.outbox);
 const offer=await store.create(sender.token,sender.csrfToken,sender.organisationId,unavailable==='wrong address'?`other-${email}`:email);
 if(unavailable==='cancelled')await store.decide(sender.token,sender.csrfToken,offer.id,'cancel');
 if(unavailable==='expired')await db.pool.query("UPDATE owner_transfers SET created_at=clock_timestamp()-interval '3 days',expires_at=clock_timestamp()-interval '2 days' WHERE id=$1",[offer.id]);
 const signup=new SignupStore(db.pool,db.outbox);await signup.request(email);
 const mail=db.outbox.open((await db.pool.query("SELECT * FROM email_outbox WHERE kind='verification' ORDER BY created_at DESC LIMIT 1")).rows[0]);assert.ok('token' in mail);
 const {accountId}=await signup.completeAccount(mail.token,{password});
 assert.ok(accountId);
 assert.equal((await db.pool.query('SELECT recipient_id FROM owner_transfers WHERE id=$1',[offer.id])).rows[0].recipient_id,null);
 assert.equal((await db.pool.query('SELECT 1 FROM organisation_memberships WHERE account_id=$1',[accountId])).rowCount,0);
});
test('ordinary business signup also attaches its verified email offers without granting the offered business',async()=>{
 const sender=await signedAccount(),email=`new-${randomUUID()}@example.test`,store=new OwnerTransferStore(db.pool,db.outbox);
 const offer=await store.create(sender.token,sender.csrfToken,sender.organisationId,email),signup=new SignupStore(db.pool,db.outbox);await signup.request(email);
 const mail=db.outbox.open((await db.pool.query("SELECT * FROM email_outbox WHERE kind='verification' ORDER BY created_at DESC LIMIT 1")).rows[0]);assert.ok('token' in mail);
 const result=await signup.complete(mail.token,{password,organisationName:'New business',legalBusinessName:'New SL',countryCode:'ES'});
 assert.equal((await db.pool.query('SELECT recipient_id FROM owner_transfers WHERE id=$1',[offer.id])).rows[0].recipient_id,result.accountId);
 assert.deepEqual((await db.pool.query('SELECT organisation_id FROM organisation_memberships WHERE account_id=$1',[result.accountId])).rows,[{organisation_id:result.organisationId}]);
});

test('recovered scope: handover cannot widen a recipient or give away an outside business',async()=>{
 const sender=await signedAccount(),recipient=await signedAccount(),store=new OwnerTransferStore(db.pool,db.outbox);
 const offer=await store.create(sender.token,sender.csrfToken,sender.organisationId,recipient.email);
 await setRecoveryScope(db.pool,recipient.accountId,recipient.organisationId);await assert.rejects(store.decide(recipient.token,recipient.csrfToken,offer.id,'accept'),/transfer_unavailable|permission_denied/);
 await setRecoveryScope(db.pool,sender.accountId);await assert.rejects(store.create(sender.token,sender.csrfToken,sender.organisationId,'another@example.test'),/transfer_unavailable|permission_denied/);
 await setRecoveryScope(db.pool,sender.accountId,sender.organisationId);assert.ok((await store.list(sender.token)).some(o=>o.id===offer.id));
});
