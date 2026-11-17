import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {after,before,beforeEach,test} from 'node:test';
import {database} from '../../account-http/test/fixtures.ts';
import {resetSchema} from './fixtures/reset-schema.ts';
import {RegistrationStore,SignupStore,transaction} from '../src/index.ts';
import {PasswordRecoveryStore} from '../src/password-recovery.ts';
import {OwnerRecoveryStore,type OwnerRecoveryBinding} from '../src/owner-recovery.ts';
import {InstallationStore} from '../src/installations.ts';
import {createLeaseIssuer,encodeMachine,type MachineAction,type SignedEnvelope} from '../src/installation-proof.ts';
import {login,resolveSession,withEnrollmentPolicy} from '@waitron-cloud/identity';
const origin='https://cloud.example.test',password='An original long recovery password',replacement='A new screened recovery password';
const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
let db:Awaited<ReturnType<typeof database>>,store:OwnerRecoveryStore,reset:PasswordRecoveryStore;
let owner:{accountId:string;organisationId:string;legalBusinessId:string},box:Awaited<ReturnType<typeof installation>>&{lease?:SignedEnvelope},token:string;
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
async function installation(){
 const key=generateKeyPairSync('ed25519'),publicKey=key.publicKey.export({type:'spki',format:'der'}).toString('base64url');
 const r=new RegistrationStore(db.pool),binding={operationId:randomUUID(),installationKey:publicKey,venueId:'',environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
 await r.start(binding);await r.approveCloud(binding,owner.accountId);await r.approveLocal(binding,randomUUID());
 return {...await r.complete(binding),key,publicKey};
}
function proof(action:MachineAction,body:unknown={},operationId:string=randomUUID(),lease:SignedEnvelope|null|undefined=box.lease){
 const bytes=encodeMachine({origin,action,installationId:box.installationId,operationId,issuedAt:Date.now(),lease:lease?JSON.stringify(lease):'',body:JSON.stringify(body)});
 return {payload:bytes.toString('base64url'),signature:sign(null,bytes,box.key.privateKey).toString('base64url')};
}
async function mail(){
 await reset.request('owner@example.test');const row=(await db.pool.query("SELECT * FROM email_outbox WHERE kind='password_reset' ORDER BY created_at DESC LIMIT 1")).rows[0];
 const message=db.outbox.open(row);assert.ok('token' in message);return message.token;
}
async function selected(){await store.begin(token);return store.select(token,box.installationId);}
async function approve(request:OwnerRecoveryBinding){return store.machine('owner-recovery-approve',proof('owner-recovery-approve',{request,approvedBy:randomUUID()},request.requestId));}
before(async()=>{db=await database();});after(async()=>db?.close());
beforeEach(async()=>{
 await resetSchema(db.pool);
 // Apply the candidate migration directly until its occupied manifest slot is released.
 await db.pool.query(await readFile(new URL('../migrations/070_owner_recovery.sql',import.meta.url),'utf8'));
 const signup=new SignupStore(db.pool,db.outbox);await signup.request('owner@example.test');const message=db.outbox.open((await db.pool.query("SELECT * FROM email_outbox WHERE kind='verification'")).rows[0]);assert.ok('token' in message);
 owner=await signup.complete(message.token,{password,organisationName:'Sol',legalBusinessName:'Sol SL',countryCode:'ES'});
 const installed=await installation();
 const machine=new InstallationStore(db.pool,issuer,origin),renewed=await machine.execute('renew',(()=>{box={...installed,lease:undefined};return proof('renew',{},randomUUID(),undefined);})());
 box={...installed,lease:renewed.lease};
 store=new OwnerRecoveryStore(db.pool,db.outbox,{origin,countryCode:'ES',issuer});reset=new PasswordRecoveryStore(db.pool,db.outbox);token=await mail();
});

test('mailbox proof changes purpose, offers owned paired boxes and freezes the exact binding',async()=>{
 assert.deepEqual(await store.machine('owner-recovery-read',proof('owner-recovery-read')), {requests:[]});
 const begun=await store.begin(token);assert.equal(begun.state,'choose');assert.deepEqual(begun.venues.map(v=>v.installationId),[box.installationId]);
 await assert.rejects(reset.complete(token,replacement),/reset_unavailable/);
 const request=await store.select(token,box.installationId);
 assert.deepEqual(request,{requestId:begun.requestId,accountId:owner.accountId,email:'owner@example.test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId,venueId:box.venueId,installationId:box.installationId,publicKey:box.publicKey,environment:'test',countryCode:'ES',expiresAt:(await db.pool.query('SELECT expires_at FROM password_reset_requests WHERE token_hash=$1',[digest(token)])).rows[0].expires_at.toISOString()});
 assert.deepEqual(await store.machine('owner-recovery-read',proof('owner-recovery-read')),{requests:[request]});
 assert.deepEqual(await store.select(token,box.installationId),request);
 const second=await installation();await assert.rejects(store.select(token,second.installationId),/recovery_unavailable/);
 assert.equal((await db.pool.query('SELECT count(*) FROM installation_operations')).rows[0].count,'1','recovery polls add no metered operation');
});

test('approved recovery replaces lost authority once and issues enrollment-only access for the same account',async()=>{
 const old=await transaction(db.pool,c=>login(c,{email:'owner@example.test',password}));
 await db.pool.query("INSERT INTO cloud_authenticator_factors(account_id,version,secret_generation,secret_envelope) VALUES($1,1,$2,'lost-ciphertext')",[owner.accountId,randomUUID()]);
 const request=await selected();
 await assert.rejects(store.complete(token,replacement),/recovery_unavailable/);
 assert.deepEqual(await approve(request),{requestId:request.requestId,state:'approved'});
 const result=await store.complete(token,replacement);
 assert.equal(result.accountId,owner.accountId);assert.match(result.token,/^[\w-]{43}$/);
 await assert.rejects(transaction(db.pool,c=>resolveSession(c,old.token)),/session_unavailable/);
 await assert.rejects(transaction(db.pool,c=>resolveSession(c,result.token)),/enrollment_required/);
 assert.equal((await withEnrollmentPolicy({required:false,allowEnrollment:true},()=>transaction(db.pool,c=>resolveSession(c,result.token)))).enrollmentRequired,true);
 assert.equal((await db.pool.query('SELECT recovery_organisation_id FROM cloud_accounts WHERE id=$1',[owner.accountId])).rows[0].recovery_organisation_id,owner.organisationId);
 assert.equal((await db.pool.query('SELECT count(*) FROM cloud_authenticator_factors WHERE secret_envelope IS NOT NULL')).rows[0].count,'0');
 assert.equal((await db.pool.query("SELECT count(*) FROM email_outbox WHERE kind='password_changed'")).rows[0].count,'1');
 assert.equal((await db.pool.query('SELECT count(*) FROM password_reset_requests WHERE account_id=$1 AND consumed_at IS NULL',[owner.accountId])).rows[0].count,'0');
 await assert.rejects(store.complete(token,replacement),/recovery_unavailable/);
 assert.equal((await db.pool.query('SELECT count(*) FROM cloud_sessions WHERE ended_at IS NULL')).rows[0].count,'1');
});

test('refusal is permanent and decision retries must retain their exact body and purpose',async()=>{
 const request=await selected(),body={request,refusedBy:randomUUID()},envelope=proof('owner-recovery-refuse',body,request.requestId);
 assert.deepEqual(await store.machine('owner-recovery-refuse',envelope),{requestId:request.requestId,state:'refused'});
 assert.deepEqual(await store.machine('owner-recovery-refuse',envelope),{requestId:request.requestId,state:'refused'});
 await assert.rejects(approve(request),/conflict/);
 await assert.rejects(store.machine('owner-recovery-refuse',proof('owner-recovery-refuse',{...body,refusedBy:randomUUID()},request.requestId)),/conflict/);
 await assert.rejects(store.complete(token,replacement),/recovery_unavailable/);
 assert.deepEqual(await store.machine('owner-recovery-read',proof('owner-recovery-read')),{requests:[]});
 assert.equal((await db.pool.query('SELECT count(*) FROM cloud_sessions')).rows[0].count,'0');
});

test('machine approval needs the exact frozen binding, decision id, signature and lease',async()=>{
 const request=await selected(),approvedBy=randomUUID();
 for(const [field,value] of Object.entries({...request,requestId:randomUUID(),accountId:randomUUID(),email:'other@example.test',organisationId:randomUUID(),legalBusinessId:randomUUID(),venueId:randomUUID(),installationId:randomUUID(),publicKey:'foreign-key',environment:'production',countryCode:'FR',expiresAt:new Date(Date.now()+1_000_000).toISOString()})){
  if(value===request[field as keyof OwnerRecoveryBinding])continue;
  await assert.rejects(store.machine('owner-recovery-approve',proof('owner-recovery-approve',{request:{...request,[field]:value},approvedBy},request.requestId)),/invalid_proof|unavailable/);
 }
 await assert.rejects(store.machine('owner-recovery-approve',proof('owner-recovery-approve',{request,approvedBy})),/invalid_proof/);
 await assert.rejects(store.machine('owner-recovery-approve',proof('owner-recovery-approve',{request,approvedBy},request.requestId,null)),/invalid_proof/);
 const signed=proof('owner-recovery-approve',{request,approvedBy},request.requestId);await assert.rejects(store.machine('owner-recovery-approve',{...signed,signature:'x'.repeat(86)}),/invalid_proof/);
 assert.equal((await db.pool.query('SELECT recovery_decision FROM password_reset_requests WHERE token_hash=$1',[digest(token)])).rows[0].recovery_decision,null);
 assert.deepEqual(await store.machine('owner-recovery-approve',signed),{requestId:request.requestId,state:'approved'});
 assert.deepEqual(await store.machine('owner-recovery-approve',signed),{requestId:request.requestId,state:'approved'});
});

test('scope-limited A account refuses B selection and completion without recovery effects',async()=>{
 const a=owner.organisationId,orgB=randomUUID(),businessB=randomUUID();
 await db.pool.query('INSERT INTO organisations(id) VALUES($1)',[orgB]);await db.pool.query("INSERT INTO legal_businesses(id,organisation_id,country_code) VALUES($1,$2,'ES')",[businessB,orgB]);
 await db.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner,can_register_venues) VALUES($1,$2,true,true)',[owner.accountId,orgB]);
 const oldOwner=owner;owner={...owner,organisationId:orgB,legalBusinessId:businessB};const b=await installation();owner=oldOwner;
 await db.pool.query('UPDATE cloud_accounts SET recovery_organisation_id=$2 WHERE id=$1',[owner.accountId,a]);
 await store.begin(token);await assert.rejects(store.select(token,b.installationId),/recovery_scope_limited/);
 assert.equal((await db.pool.query('SELECT recovery_binding FROM password_reset_requests WHERE token_hash=$1',[digest(token)])).rows[0].recovery_binding,null);
 await db.pool.query('UPDATE cloud_accounts SET recovery_organisation_id=NULL WHERE id=$1',[owner.accountId]);
 const boxA=box;box={...b,lease:undefined};box.lease=(await new InstallationStore(db.pool,issuer,origin).execute('renew',proof('renew',{},randomUUID(),undefined))).lease;
 const request=await store.select(token,b.installationId);await approve(request);
 await db.pool.query('UPDATE cloud_accounts SET recovery_organisation_id=$2 WHERE id=$1',[owner.accountId,a]);
 await assert.rejects(store.complete(token,replacement),/recovery_scope_limited/);box=boxA;
 assert.equal((await db.pool.query('SELECT consumed_at FROM password_reset_requests WHERE token_hash=$1',[digest(token)])).rows[0].consumed_at,null);
 assert.equal((await db.pool.query('SELECT count(*) FROM cloud_sessions')).rows[0].count,'0');
});

test('completion rechecks expiry, enabled account, email, password, ownership, country, venue and current pairing',async()=>{
 const request=await selected();await approve(request);
 const hash=(await db.pool.query('SELECT password_hash FROM cloud_credentials WHERE account_id=$1',[owner.accountId])).rows[0].password_hash;
 const cases:[string,unknown[],string,unknown[]][]=[
  ['UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1',[owner.accountId],'UPDATE cloud_accounts SET disabled_at=NULL WHERE id=$1',[owner.accountId]],
  ["UPDATE cloud_credentials SET email='changed@example.test' WHERE account_id=$1",[owner.accountId],"UPDATE cloud_credentials SET email='owner@example.test' WHERE account_id=$1",[owner.accountId]],
  ['UPDATE cloud_credentials SET email_verified_at=NULL WHERE account_id=$1',[owner.accountId],'UPDATE cloud_credentials SET email_verified_at=clock_timestamp() WHERE account_id=$1',[owner.accountId]],
  ['UPDATE cloud_credentials SET password_hash=NULL WHERE account_id=$1',[owner.accountId],'UPDATE cloud_credentials SET password_hash=$2 WHERE account_id=$1',[owner.accountId,hash]],
  ['UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',[owner.accountId],'UPDATE organisation_memberships SET is_owner=true WHERE account_id=$1',[owner.accountId]],
  ["UPDATE legal_businesses SET country_code='FR' WHERE id=$1",[owner.legalBusinessId],"UPDATE legal_businesses SET country_code='ES' WHERE id=$1",[owner.legalBusinessId]],
  ["UPDATE venues SET environment='production' WHERE id=$1",[box.venueId],"UPDATE venues SET environment='test' WHERE id=$1",[box.venueId]],
  ['UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[box.installationId],'UPDATE installations SET revoked_at=NULL WHERE id=$1',[box.installationId]],
  ["UPDATE installations SET public_key='changed-key' WHERE id=$1",[box.installationId],'UPDATE installations SET public_key=$2 WHERE id=$1',[box.installationId,box.publicKey]],
 ];
 for(const [change,args,restore,restoreArgs] of cases){await db.pool.query(change,args);try{await assert.rejects(store.complete(token,replacement),/recovery_unavailable/,change);}finally{await db.pool.query(restore,restoreArgs);}}
 await db.pool.query("UPDATE password_reset_requests SET created_at=clock_timestamp()-interval '31 minutes',expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1",[digest(token)]);
 await assert.rejects(store.complete(token,replacement),/recovery_unavailable/);
 assert.equal((await db.pool.query('SELECT count(*) FROM cloud_sessions')).rows[0].count,'0');
 assert.equal((await db.pool.query("SELECT count(*) FROM email_outbox WHERE kind='password_changed'")).rows[0].count,'0');
});
