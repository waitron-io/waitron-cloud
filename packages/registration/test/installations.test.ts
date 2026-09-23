import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {login} from '@waitron-cloud/identity';
import {database} from '../../account-http/test/fixtures.ts';
import {SignupStore,RegistrationStore,transaction} from '../src/index.ts';
import {InstallationStore} from '../src/installations.ts';
import {createLeaseIssuer,encodeMachine,type MachineAction,type SignedEnvelope} from '../src/installation-proof.ts';
const origin='https://cloud.example.test',password='a long enough local test password';
const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
let db:Awaited<ReturnType<typeof database>>,store:InstallationStore,other:InstallationStore;
let owner:{accountId:string;organisationId:string;legalBusinessId:string},session:{token:string;csrfToken:string};
let a:Awaited<ReturnType<typeof installation>>,b:Awaited<ReturnType<typeof installation>>;
async function installation(){
  const key=generateKeyPairSync('ed25519'),publicKey=key.publicKey.export({type:'spki',format:'der'}).toString('base64url');
  const r=new RegistrationStore(db.pool),binding={operationId:randomUUID(),installationKey:publicKey,localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
  await r.start(binding);await r.approveCloud(binding,owner.accountId);await r.approveLocal(binding,randomUUID());const registered=await r.complete(binding);
  return {...registered,key,publicKey};
}
function request(target=a,action:MachineAction='renew',lease:SignedEnvelope|undefined=undefined,body:unknown={},operationId=randomUUID(),issuedAt=Date.now()){
  const bytes=encodeMachine({origin,action,installationId:target.installationId,operationId,issuedAt,lease:lease?JSON.stringify(lease):'',body:JSON.stringify(body)});
  return {payload:bytes.toString('base64url'),signature:sign(null,bytes,target.key.privateKey).toString('base64url')};
}
const config=(target=a,lease?:SignedEnvelope)=>store.execute('configuration',request(target,'configuration',lease));
before(async()=>{db=await database();store=new InstallationStore(db.pool,issuer,origin);other=new InstallationStore(db.secondPool,issuer,origin);});
after(async()=>db?.close());
beforeEach(async()=>{
  await db.pool.query('TRUNCATE signup_requests,email_outbox,organisations,cloud_accounts CASCADE');
  const signup=new SignupStore(db.pool,db.outbox);await signup.request('owner@example.test');const mail=db.outbox.open((await db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert.ok('token' in mail);
  owner=await signup.complete(mail.token,{password,organisationName:'Sol',legalBusinessName:'Sol SL',countryCode:'ES'});
  session=await transaction(db.pool,c=>login(c,{email:'owner@example.test',password}));a=await installation();b=await installation();
});
test('durable renewal is scoped and replayed once across independent workers',async()=>{
  const proof=request(),[one,two]=await Promise.all([store.execute('renew',proof),other.execute('renew',proof)]);
  assert.deepEqual(one,two);assert.ok(one.lease);assert.equal(one.installationId,a.installationId);
  assert.equal(one.revision,0);assert.deepEqual(one.services.map(s=>[s.state,s.health]),Array(3).fill(['unconfigured','unknown']));
  assert.deepEqual(await new InstallationStore(db.pool,issuer,origin).execute('renew',proof),one);
  assert.equal((await db.pool.query('SELECT count(*) FROM installation_operations')).rows[0].count,'1');
  const twoVenue=await store.execute('renew',request(b));assert.notDeepEqual(one.lease,twoVenue.lease);
  assert.equal((await config(a,one.lease)).venueId,a.venueId);
  await assert.rejects(config(b,one.lease),/invalid_proof/);await assert.rejects(config(a),/invalid_proof/);
  const altered={...proof,signature:request(b).signature};await assert.rejects(store.execute('renew',altered),/invalid_proof/);
  const id=JSON.parse(Buffer.from(proof.payload,'base64url').toString())[4];
  await assert.rejects(store.execute('revoke',request(a,'revoke',undefined,{},id)),/conflict/);
});
test('reports cannot configure services, advance desired revision, roll back health, or hide stale health',async()=>{
  const initial=await store.execute('renew',request());assert.ok(initial.lease);const lease=initial.lease;
  const observedAt=Date.now();const services=[{service:'remote_access',health:'healthy',failure:null}];
  const report=(revision:number,time=observedAt)=>store.execute('report',request(a,'report',lease,{revision,observedAt:time,services}));
  await assert.rejects(report(1),/conflict/);
  const before=await report(0);assert.equal(before.services.find(s=>s.service==='remote_access')?.state,'unconfigured');
  const desired=await store.configure(a.installationId,0,[{service:'remote_access',state:'ready',configuration:{hostname:'venue.example.test'}}]);assert.equal(desired.revision,1);
  await assert.rejects(store.configure(a.installationId,0,[]),/conflict/);await assert.rejects(report(0),/conflict/);
  await report(1);let view=await config(a,lease);assert.equal(view.services.find(s=>s.service==='remote_access')?.health,'healthy');
  await store.execute('report',request(a,'report',lease,{revision:1,observedAt:observedAt-1,services:[{service:'remote_access',health:'failed',failure:'unavailable'}]}));
  view=await config(a,lease);assert.equal(view.services.find(s=>s.service==='remote_access')?.health,'healthy');
  await db.pool.query("UPDATE installation_observations SET received_at=clock_timestamp()-interval '6 minutes'");
  assert.equal((await config(a,lease)).services.find(s=>s.service==='remote_access')?.health,'unknown');
  await assert.rejects(store.execute('report',request(a,'report',lease,{revision:1,observedAt:Date.now()+120000,services})),/invalid_proof/);
  await assert.rejects(store.execute('report',request(a,'report',lease,{revision:1,observedAt,services:[{service:'remote_access',health:'failed',failure:'private detail'}]})),/invalid_proof/);
});
test('owner revocation serializes with renewal, persists and preserves the other venue and services',async()=>{
  const proof=request();await store.execute('renew',proof);
  const blocker=await db.pool.connect();await blocker.query('BEGIN');await blocker.query('SELECT 1 FROM installations WHERE id=$1 FOR UPDATE',[a.installationId]);
  const revoke=other.revokeWithSession(session.token,session.csrfToken,a.installationId);await waitForLock();
  const pending=assert.rejects(store.execute('renew',request()),/revoked/);
  await blocker.query('COMMIT');blocker.release();await revoke;await pending;
  const audit=(await db.pool.query('SELECT * FROM installation_revocations WHERE installation_id=$1',[a.installationId])).rows[0];assert.equal(audit.actor_kind,'account');assert.equal(audit.actor_id,owner.accountId);assert.equal(audit.reason,'user_requested');assert.ok(audit.result.revokedAt);
  await assert.rejects(store.execute('renew',proof),/revoked/);await assert.rejects(config(a),/revoked/);
  assert.equal((await db.pool.query('SELECT count(*) FROM venues')).rows[0].count,'2');
  assert.equal((await db.pool.query('SELECT count(*) FROM installation_services')).rows[0].count,'6');
  assert.ok((await store.execute('renew',request(b))).lease);
  const list=await store.listWithSession(session.token);assert.equal(list.length,2);assert.ok(list.find(i=>i.installationId===a.installationId)?.revokedAt);
  assert.equal(JSON.stringify(list).includes('signature'),false);assert.equal(JSON.stringify(list).includes(a.publicKey),false);
});
test('machine revoke recovers its committed reply but cannot revive a revoked key',async()=>{
  const proof=request(a,'revoke');const one=await store.execute('revoke',proof);assert.ok(one.revokedAt);
  assert.deepEqual(await other.execute('revoke',proof),one);
  const audit=(await db.pool.query('SELECT * FROM installation_revocations')).rows[0];assert.equal(audit.actor_kind,'installation');assert.equal(audit.actor_id,a.installationId);assert.deepEqual(audit.result,one);await assert.rejects(other.execute('renew',request()),/revoked/);
  await assert.rejects(store.configure(a.installationId,0,[]),/revoked/);
});
test('account access uses customer membership and ownership, CSRF and current sessions',async()=>{
  await assert.rejects(store.listWithSession('missing'),/session_unavailable/);
  await assert.rejects(store.revokeWithSession(session.token,'wrong',a.installationId),/csrf_invalid/);
  await assert.rejects(store.revokeWithSession(session.token,session.csrfToken,randomUUID()),/permission_denied/);
  await db.pool.query('UPDATE organisation_memberships SET is_owner=false');
  assert.equal((await store.listWithSession(session.token))[0]?.canRevoke,false);
  await assert.rejects(store.revokeWithSession(session.token,session.csrfToken,a.installationId),/permission_denied/);
  await db.pool.query('DELETE FROM organisation_memberships');assert.deepEqual(await store.listWithSession(session.token),[]);
  await db.pool.query('UPDATE cloud_accounts SET disabled_at=clock_timestamp()');await assert.rejects(store.listWithSession(session.token),/session_unavailable/);
});
async function waitForLock(){for(let n=0;n<100;n++){const r=await db.pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[db.schema]);if(r.rowCount)return;await new Promise(r=>setTimeout(r,10));}throw new Error('request did not reach lock');}
test('request freshness and owner session expiry are checked after installation lock waits',async()=>{
  let blocker=await db.secondPool.connect();await blocker.query('BEGIN');await blocker.query('SELECT 1 FROM installations WHERE id=$1 FOR UPDATE',[a.installationId]);
  const pending=assert.rejects(store.execute('renew',request(a,'renew',undefined,{},randomUUID(),Date.now()-59750)),/invalid_proof/);
  try{await waitForLock();await new Promise(r=>setTimeout(r,300));}finally{await blocker.query('COMMIT');blocker.release();}await pending;
  assert.equal((await db.pool.query('SELECT count(*) FROM installation_operations')).rows[0].count,'0');
  blocker=await db.secondPool.connect();await blocker.query('BEGIN');await blocker.query('SELECT 1 FROM installations WHERE id=$1 FOR UPDATE',[a.installationId]);
  await db.pool.query("UPDATE cloud_sessions SET absolute_expires_at=clock_timestamp()+interval '250 milliseconds'");
  const expired=assert.rejects(store.revokeWithSession(session.token,session.csrfToken,a.installationId),/session_expired/);
  try{await waitForLock();await new Promise(r=>setTimeout(r,300));}finally{await blocker.query('COMMIT');blocker.release();}await expired;
  assert.equal((await db.pool.query('SELECT revoked_at FROM installations WHERE id=$1',[a.installationId])).rows[0].revoked_at,null);
});
