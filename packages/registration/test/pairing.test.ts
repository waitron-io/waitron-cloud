import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {Pool} from 'pg';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {migrate} from '../src/migrate.ts';
import {login} from '@waitron-cloud/identity';
import {database} from '../../account-http/test/fixtures.ts';
import {RegistrationStore,SignupStore,transaction} from '../src/index.ts';
import {PairingStore} from '../src/pairing.ts';
import type {PairingClaims} from '../src/pairing-proof.ts';
let db:Awaited<ReturnType<typeof database>>;let store:PairingStore;let other:PairingStore;
let owner:{accountId:string;organisationId:string;legalBusinessId:string};let session:{token:string;csrfToken:string};
const password='a long enough local test password';
function machine():PairingClaims {return {origin:'https://cloud.example',action:'start',requestId:randomUUID(),publicKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',code:'12345678',organisationId:'',legalBusinessId:'',issuedAt:Date.now()};}
const status=(c:PairingClaims):PairingClaims=>({...c,action:'status',code:''});
const completion=(c:PairingClaims):PairingClaims=>({...c,action:'complete',code:'',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId});
const approve=(c:PairingClaims,target=store)=>target.approve(c.requestId,c.code,owner.organisationId,owner.legalBusinessId,session.token,session.csrfToken);
const unavailable=(p:Promise<unknown>)=>assert.rejects(p,/pairing_unavailable/);
before(async()=>{db=await database();store=new PairingStore(db.pool);other=new PairingStore(db.secondPool);});
after(async()=>db?.close());
beforeEach(async()=>{
  await db.pool.query('TRUNCATE pairing_requests, signup_requests, email_outbox, organisations, cloud_accounts CASCADE');
  const signup=new SignupStore(db.pool,db.outbox);await signup.request('owner@example.test');
  const queued=(await db.pool.query('SELECT * FROM email_outbox')).rows[0];const mail=db.outbox.open(queued);assert.ok('token' in mail);
  owner=await signup.complete(mail.token,{password,organisationName:'Café Sol',legalBusinessName:'Café Sol SL',countryCode:'ES'});
  session=await transaction(db.pool,c=>login(c,{email:'owner@example.test',password}));
});
test('two approvals create one installation; independent workers recover lost replies',async()=>{
  const a=machine(),b=machine();const start=await store.start(a);assert.equal(start.state,'awaiting_cloud');
  assert.deepEqual(await other.start(a),start);await store.start(b);
  await assert.rejects(store.complete(completion(a)),/approval_required/);
  assert.equal((await store.inspect(a.requestId,a.code,session.token,session.csrfToken)).localVenueId,a.localVenueId);
  assert.equal((await approve(a)).state,'awaiting_local');
  assert.equal((await db.pool.query('SELECT count(*) FROM installations')).rows[0].count,'0');
  const [one,two]=await Promise.all([store.complete(completion(a)),other.complete(completion(a))]);assert.deepEqual(one,two);
  assert.equal(one.state,'complete');assert.ok(one.registration?.installationId);
  assert.equal((await store.status(status(b))).state,'awaiting_cloud');
  assert.equal((await db.pool.query('SELECT count(*) FROM installations')).rows[0].count,'1');
  assert.equal((await db.pool.query("SELECT count(*) FROM installation_services WHERE state='unconfigured'")).rows[0].count,'3');
});
test('binding cannot change key, venue, environment, code or selected business',async()=>{
  const a=machine();await store.start(a);
  for(const change of [{publicKey:machine().publicKey},{localVenueId:randomUUID()},{environment:'production' as const},{code:'87654321'}]) await assert.rejects(other.start({...a,...change}),/binding_conflict/);
  await approve(a);
  for(const change of [{publicKey:machine().publicKey},{localVenueId:randomUUID()},{environment:'production' as const},{organisationId:randomUUID()},{legalBusinessId:randomUUID()}]) await assert.rejects(store.complete({...completion(a),...change}),/binding_conflict/);
  await assert.rejects(store.status({...status(a),publicKey:machine().publicKey}),/binding_conflict/);
});
test('five wrong codes persist across workers and block even a subsequent correct code',async()=>{
  const a=machine();await store.start(a);
  for(let i=0;i<5;i++)await unavailable((i%2?other:store).inspect(a.requestId,'87654321',session.token,session.csrfToken));
  assert.equal((await db.pool.query('SELECT failed_codes FROM pairing_requests')).rows[0].failed_codes,5);
  await unavailable(approve(a));assert.equal((await db.pool.query('SELECT count(*) FROM connection_requests')).rows[0].count,'0');
});
test('invalid session and CSRF cannot inspect or approve; business choices follow memberships',async()=>{
  const a=machine();await store.start(a);
  await assert.rejects(store.inspect(a.requestId,a.code,session.token,'wrong'),/csrf_invalid/);
  await assert.rejects(store.approve(a.requestId,a.code,owner.organisationId,owner.legalBusinessId,'missing',session.csrfToken),/session_unavailable/);
  assert.deepEqual(await store.businesses(session.token),[{organisationId:owner.organisationId,organisationName:'Café Sol',legalBusinessId:owner.legalBusinessId,legalBusinessName:'Café Sol SL',countryCode:'ES'}]);
  await db.pool.query('UPDATE organisation_memberships SET can_register_venues=false');assert.deepEqual(await store.businesses(session.token),[]);
  await assert.rejects(approve(a),/permission_denied/);
});
test('permission is rechecked at local completion and all writes roll back',async()=>{
  const a=machine();await store.start(a);await approve(a);await db.pool.query('UPDATE organisation_memberships SET can_register_venues=false');
  await assert.rejects(store.complete(completion(a)),/permission_denied/);
  assert.equal((await db.pool.query('SELECT count(*) FROM installations')).rows[0].count,'0');
  assert.equal((await db.pool.query('SELECT count(*) FROM connection_requests')).rows[0].count,'0');
});
test('expired unfinished requests refuse all changes, while completed retries never revive revoked installations',async()=>{
  const a=machine(),b=machine();await store.start(a);await approve(a);const done=await store.complete(completion(a));await store.start(b);await approve(b);
  await db.pool.query("UPDATE pairing_requests SET expires_at=clock_timestamp()-interval '1 second'");
  const retry=await other.complete(completion(a));assert.deepEqual(retry.registration,done.registration);assert.equal(retry.state,'complete');assert.deepEqual(await store.status(status(a)),retry);
  await unavailable(store.complete(completion(b)));await unavailable(store.start(b));await unavailable(approve(b));
  await db.pool.query('UPDATE installations SET revoked_at=clock_timestamp()');await unavailable(store.complete(completion(a)));await unavailable(store.status(status(a)));
});
test('a competing pairing cannot transfer the same local venue to another installation',async()=>{
  const a=machine(),b={...machine(),localVenueId:a.localVenueId};await store.start(a);await store.start(b);await approve(a);await approve(b);
  const results=await Promise.allSettled([store.complete(completion(a)),other.complete(completion(b))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await db.pool.query('SELECT count(*) FROM installations')).rows[0].count,'1');
});
test('expiry after waiting for membership lock rolls back pairing and registration',async()=>{
  const a=machine();await store.start(a);await approve(a);const block=await db.secondPool.connect();await block.query('BEGIN');
  await block.query('SELECT 1 FROM organisation_memberships FOR UPDATE');
  await db.pool.query("UPDATE pairing_requests SET expires_at=clock_timestamp()+interval '100 milliseconds'");
  const pending=unavailable(store.complete(completion(a)));
  let blocked=false;
  try { for(let i=0;i<100;i++){if((await db.secondPool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[db.schema])).rowCount){blocked=true;break;}await new Promise(r=>setTimeout(r,10));} await new Promise(r=>setTimeout(r,150)); }
  finally {await block.query('COMMIT');block.release();}
  await pending;assert.equal(blocked,true);assert.equal((await db.pool.query('SELECT count(*) FROM installations')).rows[0].count,'0');
});

test('a fresh process resumes Cloud approval and reads the committed result after a lost reply',async()=>{
  const a=machine();await store.start(a);await approve(a);
  const run=()=>JSON.parse(execFileSync(process.execPath,['test/fixtures/pairing-restart.ts'],{encoding:'utf8',timeout:10000,input:JSON.stringify(completion(a)),env:{...process.env,PAIRING_SCHEMA:db.schema}}));
  const first=run();assert.equal(first.state,'complete');assert.deepEqual(run(),first);
  assert.equal((await db.pool.query('SELECT count(*) FROM installations')).rows[0].count,'1');
});
test('migrations upgrade a seven-migration schema without changing its existing registration',async()=>{
  const schema=`upgrade_${randomUUID().replaceAll('-','')}`;const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
  const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,digest text NOT NULL,applied_at timestamptz DEFAULT clock_timestamp())');
    for(const name of ['001_registration.sql','002_identity.sql','003_signup.sql','004_password_recovery.sql','005_email_outbox.sql','006_email_transport.sql','007_account_http.sql']){
      const sql=await readFile(new URL(`../migrations/${name}`,import.meta.url),'utf8');await pool.query(sql);await pool.query('INSERT INTO schema_migrations(name,digest) VALUES($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);
    }
    const org=randomUUID(),biz=randomUUID(),venue=randomUUID(),installation=randomUUID();
    await pool.query('INSERT INTO organisations(id) VALUES($1)',[org]);await pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[biz,org]);
    await pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,'test')",[venue,org,biz,randomUUID()]);
    await pool.query("INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,'existing-key')",[installation,venue]);
    const previous=(await pool.query('SELECT id,venue_id,public_key,revoked_at FROM installations')).rows;await migrate(pool);await migrate(pool);
    assert.deepEqual((await pool.query('SELECT id,venue_id,public_key,revoked_at FROM installations')).rows,previous);assert.equal((await pool.query('SELECT count(*) FROM schema_migrations')).rows[0].count,'9');
    assert.equal((await pool.query('SELECT count(*) FROM pairing_requests')).rows[0].count,'0');
  }finally{await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
});

test('session expiry while Cloud approval waits on permission leaves no approval',async()=>{
  const a=machine();await store.start(a);await db.pool.query("UPDATE cloud_sessions SET absolute_expires_at=clock_timestamp()+interval '100 milliseconds'");
  const block=await db.secondPool.connect();await block.query('BEGIN');await block.query('SELECT 1 FROM organisation_memberships FOR UPDATE');
  const pending=assert.rejects(approve(a),/session_expired/);let blocked=false;
  try{for(let i=0;i<100;i++){if((await db.secondPool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[db.schema])).rowCount){blocked=true;break;}await new Promise(r=>setTimeout(r,10));}await new Promise(r=>setTimeout(r,150));}
  finally{await block.query('COMMIT');block.release();}
  await pending;assert.equal(blocked,true);assert.equal((await db.pool.query('SELECT cloud_account_id FROM pairing_requests')).rows[0].cloud_account_id,null);
});

test('a borrowed registration transaction reads its own new configuration and rolls it back together',async()=>{
  const a=machine();const binding={operationId:a.requestId,installationKey:a.publicKey,localVenueId:a.localVenueId,environment:a.environment,organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
  await assert.rejects(transaction(db.pool,async client=>{
    const nested=new RegistrationStore(db.pool,client);await nested.start(binding);await nested.approveLocal(binding,a.requestId);await nested.approveCloud(binding,owner.accountId);
    const registration=await nested.complete(binding);const config=await nested.configuration(a.publicKey);assert.equal(config.installationId,registration.installationId);assert.equal(config.services.length,3);
    throw new Error('intentional outer rollback');
  }),/intentional outer rollback/);
  assert.equal((await db.pool.query('SELECT count(*) FROM installations')).rows[0].count,'0');
});

test('completed requests retain the browser code-guess bound while machine retries still work',async()=>{
  const a=machine();await store.start(a);await approve(a);const done=await store.complete(completion(a));
  for(let i=0;i<5;i++)await unavailable(store.inspect(a.requestId,'87654321',session.token,session.csrfToken));
  await unavailable(store.inspect(a.requestId,a.code,session.token,session.csrfToken));
  assert.deepEqual((await store.complete(completion(a))).registration,done.registration);
});

async function waitForLock(){
  for(let i=0;i<100;i++){
    if((await db.secondPool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[db.schema])).rowCount)return;
    await new Promise(r=>setTimeout(r,10));
  }
  assert.fail('request did not reach the database lock');
}
test('pairing expiry during venue insertion rolls back the registration and both approvals',async()=>{
  const a=machine();await store.start(a);await approve(a);
  const blocker=await db.secondPool.connect();await blocker.query('BEGIN');
  await blocker.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,'test')",[randomUUID(),owner.organisationId,owner.legalBusinessId,a.localVenueId]);
  await db.pool.query("UPDATE pairing_requests SET expires_at=clock_timestamp()+interval '300 milliseconds'");
  const pending=unavailable(store.complete(completion(a)));
  try{await waitForLock();await new Promise(r=>setTimeout(r,350));}finally{await blocker.query('COMMIT');blocker.release();}
  await pending;assert.equal((await db.pool.query('SELECT count(*) FROM installations')).rows[0].count,'0');
  assert.equal((await db.pool.query('SELECT count(*) FROM connection_requests')).rows[0].count,'0');
  assert.equal((await db.pool.query('SELECT result FROM pairing_requests')).rows[0].result,null);
});
test('pairing expiry while Cloud approval waits on membership leaves its approval absent',async()=>{
  const a=machine();await store.start(a);const blocker=await db.secondPool.connect();await blocker.query('BEGIN');await blocker.query('SELECT 1 FROM organisation_memberships FOR UPDATE');
  await db.pool.query("UPDATE pairing_requests SET expires_at=clock_timestamp()+interval '300 milliseconds'");
  const pending=unavailable(approve(a));
  try{await waitForLock();await new Promise(r=>setTimeout(r,350));}finally{await blocker.query('COMMIT');blocker.release();}
  await pending;assert.equal((await db.pool.query('SELECT cloud_account_id FROM pairing_requests')).rows[0].cloud_account_id,null);
});
test('the passive business read rechecks session expiry after a table maintenance lock',async()=>{
  const blocker=await db.secondPool.connect();await blocker.query('BEGIN');await blocker.query('LOCK TABLE legal_businesses IN ACCESS EXCLUSIVE MODE');
  await db.pool.query("UPDATE cloud_sessions SET absolute_expires_at=clock_timestamp()+interval '300 milliseconds'");
  const pending=assert.rejects(store.businesses(session.token),/session_expired/);
  try{await waitForLock();await new Promise(r=>setTimeout(r,350));}finally{await blocker.query('COMMIT');blocker.release();}
  await pending;
});
test('a missing business name refuses approval instead of producing a blank local confirmation',async()=>{
  const a=machine();await store.start(a);await db.pool.query('UPDATE legal_businesses SET name=NULL');
  await unavailable(approve(a));assert.equal((await db.pool.query('SELECT cloud_account_id FROM pairing_requests')).rows[0].cloud_account_id,null);
});
