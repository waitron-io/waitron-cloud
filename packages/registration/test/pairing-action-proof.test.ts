import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomUUID,randomBytes} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {login} from '@waitron-cloud/identity';
import {database} from '../../account-http/test/fixtures.ts';
import {SignupStore,RegistrationStore,transaction} from '../src/index.ts';
import {PairingStore} from '../src/pairing.ts';
import type {PairingClaims} from '../src/pairing-proof.ts';
import {openProofWindow} from './fixtures/action-proof.ts';
let db:Awaited<ReturnType<typeof database>>,store:PairingStore;
let owner:{accountId:string;organisationId:string;legalBusinessId:string},session:{token:string;csrfToken:string};
let claims:PairingClaims;
const password='a long enough local test password';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const approve=()=>store.approve(claims.requestId,claims.code,owner.organisationId,owner.legalBusinessId,session.token,session.csrfToken);
const complete=()=>store.complete({...claims,action:'complete',code:'',...owner});
before(async()=>{db=await database();store=new PairingStore(db.pool);});
after(async()=>db?.close());
beforeEach(async()=>{
 // Each case owns its account and request, so unrelated rows need no schema rebuild.
 const email=`${randomUUID()}@example.test`,signup=new SignupStore(db.pool,db.outbox);await signup.request(email);
 const queued=(await db.pool.query('SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT 1')).rows[0];
 const mail=db.outbox.open(queued);assert.ok('token' in mail);
 owner=await signup.complete(mail.token,{password,organisationName:'Café Sol',legalBusinessName:'Sol SL',countryCode:'ES'});
 session=await transaction(db.pool,c=>login(c,{email,password}));
 await db.pool.query('INSERT INTO cloud_passkey_users(account_id,user_handle) VALUES($1,$2)',[owner.accountId,randomBytes(32)]);
 await db.pool.query(`INSERT INTO cloud_passkeys(id,account_id,credential_id,public_key,counter,device_type,backed_up)
   VALUES($1,$2,$3,$4,0,'multiDevice',true)`,[randomUUID(),owner.accountId,randomUUID(),Buffer.from([1,2,3])]);
 await openProofWindow(db.pool,session.token);
 claims={origin:'https://cloud.example',action:'start',requestId:randomUUID(),publicKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',code:'12345678',organisationId:'',legalBusinessId:'',issuedAt:Date.now()};
 await store.start(claims);
});

test('pairing inspection stays available but approval requires an enrolled method even with email proof',async()=>{
 await db.pool.query('DELETE FROM cloud_passkeys WHERE account_id=$1',[owner.accountId]);
 assert.equal((await store.inspect(claims.requestId,claims.code,session.token,session.csrfToken)).state,'awaiting_cloud');
 await assert.rejects(approve(),/enrollment_required/);
 assert.equal((await db.pool.query('SELECT cloud_account_id FROM pairing_requests WHERE id=$1',[claims.requestId])).rows[0].cloud_account_id,null);
});
for(const proved of [null,'11 minutes'])test(`pairing approval refuses ${proved?'expired':'missing'} fresh proof`,async()=>{
 await db.pool.query(`UPDATE cloud_sessions SET action_proved_at=${proved?"clock_timestamp()-interval '11 minutes'":'NULL'} WHERE token_hash=$1`,[hash(session.token)]);
 await assert.rejects(approve(),/proof_required/);
 assert.equal((await db.pool.query('SELECT cloud_account_id FROM pairing_requests WHERE id=$1',[claims.requestId])).rows[0].cloud_account_id,null);
});

for(const replay of [false,true])for(const change of ['enrollment','session','absolute expiry','security','password','permission'] as const)test(`${replay?'saved':'new'} pairing completion refuses withdrawn ${change} authority`,async()=>{
 await approve();if(replay)await complete();
 const before=(await db.pool.query('SELECT count(*) FROM installations')).rows[0].count;
 if(change==='enrollment')await db.pool.query('DELETE FROM cloud_passkeys WHERE account_id=$1',[owner.accountId]);
 if(change==='session')await db.pool.query('UPDATE cloud_sessions SET ended_at=clock_timestamp() WHERE account_id=$1',[owner.accountId]);
 if(change==='absolute expiry')await db.pool.query("UPDATE cloud_sessions SET absolute_expires_at=clock_timestamp()-interval '1 second' WHERE account_id=$1",[owner.accountId]);
 if(change==='security')await db.pool.query('UPDATE cloud_sessions SET action_security_revision=action_security_revision+1 WHERE account_id=$1',[owner.accountId]);
 if(change==='password')await db.pool.query("UPDATE cloud_credentials SET password_hash=password_hash||'changed' WHERE account_id=$1",[owner.accountId]);
 if(change==='permission')await db.pool.query('UPDATE organisation_memberships SET can_register_venues=false WHERE account_id=$1',[owner.accountId]);
 await assert.rejects(complete(),/pairing_unavailable|permission_denied/);
 assert.equal((await db.pool.query('SELECT count(*) FROM installations')).rows[0].count,before);
});
test('local confirmation and saved retry need current authority but not browser idle or proof freshness',async()=>{
 await approve();
 await db.pool.query("UPDATE cloud_sessions SET last_seen_at=clock_timestamp()-interval '31 minutes',action_proved_at=clock_timestamp()-interval '11 minutes' WHERE account_id=$1",[owner.accountId]);
 const done=await complete();assert.equal(done.state,'complete');
 assert.deepEqual((await complete()).registration,done.registration);
});
test('the session-based registration adapter also refuses missing fresh proof',async()=>{
 const registration=new RegistrationStore(db.pool),binding={operationId:claims.requestId,installationKey:claims.publicKey,localVenueId:claims.localVenueId,environment:claims.environment,...owner};
 await registration.start(binding);await db.pool.query('UPDATE cloud_sessions SET action_proved_at=NULL WHERE account_id=$1',[owner.accountId]);
 await assert.rejects(registration.approveCloudWithSession(binding,session.token,session.csrfToken),/proof_required/);
 assert.equal((await db.pool.query('SELECT cloud_account_id FROM connection_requests WHERE operation_id=$1',[claims.requestId])).rows[0].cloud_account_id,null);
});

test('session-authorised registration retries recheck the retained session',async()=>{
 const registration=new RegistrationStore(db.pool),binding={operationId:claims.requestId,installationKey:claims.publicKey,localVenueId:claims.localVenueId,environment:claims.environment,...owner};
 await registration.start(binding);await registration.approveLocal(binding,randomUUID());
 await registration.approveCloudWithSession(binding,session.token,session.csrfToken);
 const first=await registration.complete(binding);assert.ok(first.installationId);
 await db.pool.query('UPDATE cloud_sessions SET ended_at=clock_timestamp() WHERE account_id=$1',[owner.accountId]);
 await assert.rejects(registration.complete(binding),/proof_required/);
});

for(const action of ['start','status'] as const)test(`saved ${action} reply also refuses withdrawn browser authority`,async()=>{
 await approve();await complete();await db.pool.query('UPDATE cloud_sessions SET ended_at=clock_timestamp() WHERE account_id=$1',[owner.accountId]);
 await assert.rejects(action==='start'?store.start(claims):store.status({...claims,action:'status',code:''}),/pairing_unavailable/);
});

test('saved replies authenticate the machine binding before reading retained account authority',async()=>{
 await approve();await complete();await db.pool.query('UPDATE cloud_sessions SET ended_at=clock_timestamp() WHERE account_id=$1',[owner.accountId]);
 await assert.rejects(store.status({...claims,action:'status',code:'',publicKey:'another-machine'}),/binding_conflict/);
});
