import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {Pool} from 'pg';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {migrate,migrationNames} from '../src/migrate.ts';
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
  const cloudEvent=(await db.pool.query("SELECT id,actor_kind,actor_id,subject_id,source_id FROM security_audit_events WHERE event_type='pairing.cloud_approved'")).rows[0];
  assert.equal(cloudEvent.actor_kind,'account');assert.equal(cloudEvent.actor_id,owner.accountId);assert.equal(cloudEvent.subject_id,a.requestId);assert.equal(cloudEvent.source_id,a.requestId);
  await approve(a);assert.equal((await db.pool.query("SELECT count(*) FROM security_audit_events WHERE event_type='pairing.cloud_approved'")).rows[0].count,'1');
  assert.equal((await db.pool.query('SELECT count(*) FROM installations')).rows[0].count,'0');
  const [one,two]=await Promise.all([store.complete(completion(a)),other.complete(completion(a))]);assert.deepEqual(one,two);
  assert.equal(one.state,'complete');assert.ok(one.registration?.installationId);
  assert.equal((await store.status(status(b))).state,'awaiting_cloud');
  assert.equal((await db.pool.query('SELECT count(*) FROM installations')).rows[0].count,'1');
  assert.equal((await db.pool.query("SELECT count(*) FROM installation_services WHERE state='unconfigured'")).rows[0].count,'3');
  const localEvent=(await db.pool.query("SELECT id,venue_id,actor_kind,actor_id,subject_id,source_id FROM security_audit_events WHERE event_type='pairing.local_approved'")).rows[0];
  assert.equal(localEvent.venue_id,one.registration?.venueId);assert.equal(localEvent.actor_kind,'local_authority');assert.equal(localEvent.actor_id,a.requestId);assert.equal(localEvent.subject_id,a.requestId);assert.equal(localEvent.source_id,a.requestId);
  await store.complete(completion(a));assert.equal((await db.pool.query("SELECT count(*) FROM security_audit_events WHERE event_type='pairing.local_approved'")).rows[0].count,'1');
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
  assert.equal((await db.pool.query("SELECT count(*) FROM security_audit_events WHERE event_type='pairing.local_approved'")).rows[0].count,'0');
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
    const org=randomUUID(),biz=randomUUID(),venue=randomUUID(),installation=randomUUID(),account=randomUUID();
    await pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[account]);
    await pool.query('INSERT INTO cloud_sessions(token_hash,csrf_hash,account_id) VALUES($1,$2,$3)',['a'.repeat(64),'b'.repeat(64),account]);
    await pool.query('INSERT INTO organisations(id) VALUES($1)',[org]);await pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[biz,org]);
    await pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,'test')",[venue,org,biz,randomUUID()]);
    await pool.query("INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,'existing-key')",[installation,venue]);
    const previous=(await pool.query('SELECT id,venue_id,public_key,revoked_at FROM installations')).rows;await migrate(pool);await migrate(pool);
    assert.deepEqual((await pool.query('SELECT id,venue_id,public_key,revoked_at FROM installations')).rows,previous);assert.equal((await pool.query('SELECT count(*) FROM schema_migrations')).rows[0].count,String(migrationNames.length));
    assert.match((await pool.query("SELECT id::text FROM cloud_sessions WHERE token_hash=$1",['a'.repeat(64)])).rows[0].id,/^[0-9a-f-]{36}$/);
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
  assert.equal((await db.pool.query("SELECT count(*) FROM security_audit_events WHERE event_type='pairing.cloud_approved'")).rows[0].count,'0');
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

test('stored pairing verifiers are keyed and bound to the complete request',async()=>{
  const a=machine(),b=machine();await store.start(a);await store.start(b);
  const rows=(await db.pool.query('SELECT id,code_hash FROM pairing_requests ORDER BY id')).rows;
  assert.notEqual(rows[0].code_hash,createHash('sha256').update(a.code).digest('hex'));
  assert.notEqual(rows[0].code_hash,rows[1].code_hash);
  assert.match(rows[0].code_hash,/^v1:[A-Za-z0-9_-]+:[a-f0-9]{64}$/);
  await db.pool.query('UPDATE pairing_requests SET code_hash=$2 WHERE id=$1',[b.requestId,rows.find(r=>r.id===a.requestId).code_hash]);
  await unavailable(approve(b));
  assert.equal((await db.pool.query('SELECT cloud_account_id FROM pairing_requests WHERE id=$1',[b.requestId])).rows[0].cloud_account_id,null);
});

test('rotation overlap preserves retries and approval; missing and wrong keys fail closed',async()=>{
  const old={activeKeyId:'old',keys:{old:'a'.repeat(64)}};
  const rotated={activeKeyId:'new',keys:{...old.keys,new:'b'.repeat(64)}};
  const original=new PairingStore(db.pool,old),overlap=new PairingStore(db.secondPool,rotated);
  const a=machine(),b=machine();const started=await original.start(a);
  assert.deepEqual(await overlap.start(a),started);await overlap.start(b);
  const rows=(await db.pool.query('SELECT id,code_hash FROM pairing_requests')).rows;
  assert.match(rows.find(r=>r.id===a.requestId).code_hash,/^v1:old:/);
  assert.match(rows.find(r=>r.id===b.requestId).code_hash,/^v1:new:/);
  const removed=new PairingStore(db.pool,{activeKeyId:'new',keys:{new:rotated.keys.new}});
  await assert.rejects(approve(a,removed),/configuration unavailable/);
  assert.equal((await db.pool.query('SELECT failed_codes FROM pairing_requests WHERE id=$1',[a.requestId])).rows[0].failed_codes,0);
  const wrong=new PairingStore(db.pool,{activeKeyId:'old',keys:{old:'c'.repeat(64)}});
  await unavailable(approve(a,wrong));await assert.rejects(wrong.start(a),/binding_conflict/);
  await approve(a,overlap);const done=await overlap.complete(completion(a));
  assert.deepEqual((await removed.complete(completion(a))).registration,done.registration);
  assert.equal((await approve(b,removed)).state,'awaiting_local');
});

test('concurrent wrong guesses stop at five and cannot approve another request code',async()=>{
  const a=machine(),b={...machine(),code:'87654321'};await store.start(a);await store.start(b);
  const guesses=await Promise.allSettled(Array.from({length:12},(_,i)=>(i%2?store:other).inspect(a.requestId,b.code,session.token,session.csrfToken)));
  assert.equal(guesses.filter(r=>r.status==='rejected').length,12);
  assert.equal((await db.pool.query('SELECT failed_codes FROM pairing_requests WHERE id=$1',[a.requestId])).rows[0].failed_codes,5);
  await unavailable(approve(a));assert.equal((await approve(b)).state,'awaiting_local');
});

test('legacy upgrade wraps pending, approved and completed rows without changing their history',async()=>{
  const a=machine(),b=machine(),c=machine();for(const m of [a,b,c])await store.start(m);
  await approve(b);await approve(c);await store.complete(completion(c));
  await db.pool.query('UPDATE pairing_requests SET code_hash=$1',[createHash('sha256').update(a.code).digest('hex')]);
  const before=(await db.pool.query('SELECT * FROM pairing_requests ORDER BY id')).rows;
  await assert.rejects(approve(a),/configuration unavailable/);
  const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options',`-c search_path=${db.schema}`);
  const run=()=>JSON.parse(execFileSync(process.execPath,['src/pairing-codes-cli.ts','--once'],{encoding:'utf8',timeout:10000,env:{...process.env,DATABASE_URL:url.href}}));
  assert.deepEqual(run(),{upgraded:3});assert.deepEqual(run(),{upgraded:0});
  const after=(await db.pool.query('SELECT * FROM pairing_requests ORDER BY id')).rows;
  for(let i=0;i<before.length;i++){assert.match(after[i].code_hash,/^v1:/);assert.deepEqual({...after[i],code_hash:null},{...before[i],code_hash:null});}
  assert.deepEqual(await store.start(a),await store.status(status(a)));
  await approve(a);assert.equal((await store.complete(completion(b))).state,'complete');
  assert.deepEqual((await store.complete(completion(c))).registration,before.find(r=>r.id===c.requestId).result);
});

test('a missing key refuses malformed guesses without spending attempts',async()=>{
 const a=machine();await store.start(a);const missing=new PairingStore(db.pool,null);
 await assert.rejects(missing.inspect(a.requestId,'bad-code',session.token,session.csrfToken),/configuration unavailable/);
 assert.equal((await db.pool.query('SELECT failed_codes FROM pairing_requests')).rows[0].failed_codes,0);
});

test('legacy upgrade waits for locked rows instead of reporting a false zero',async()=>{
 const {upgradePairingCodes,pairingCodeKeysFromEnv}=await import('../src/pairing-codes.ts');
 const a=machine();await store.start(a);
 await db.pool.query('UPDATE pairing_requests SET code_hash=$1',[createHash('sha256').update(a.code).digest('hex')]);
 const blocker=await db.secondPool.connect();await blocker.query('BEGIN');await blocker.query('SELECT id FROM pairing_requests FOR UPDATE');
 const pending=upgradePairingCodes(db.pool,pairingCodeKeysFromEnv(process.env)!,1);
 try{await waitForLock();}finally{await blocker.query('COMMIT');blocker.release();}
 assert.equal(await pending,1);assert.equal(await upgradePairingCodes(db.pool,pairingCodeKeysFromEnv(process.env)!,1),0);
});

test('legacy upgrade is bounded and a failed pass leaves all rows retryable',async()=>{
 const {upgradePairingCodes,pairingCodeKeysFromEnv}=await import('../src/pairing-codes.ts');
 const keys=pairingCodeKeysFromEnv(process.env)!;const a=machine(),b=machine();await store.start(a);await store.start(b);
 const legacy=createHash('sha256').update(a.code).digest('hex');await db.pool.query('UPDATE pairing_requests SET code_hash=$1',[legacy]);
 const rows=(await db.pool.query('SELECT id FROM pairing_requests ORDER BY id')).rows;
 await db.pool.query(`CREATE FUNCTION refuse_pairing_upgrade() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
   IF NEW.id='${rows[1].id}' THEN RAISE EXCEPTION 'upgrade probe'; END IF; RETURN NEW; END $$;
   CREATE TRIGGER refuse_pairing_upgrade BEFORE UPDATE ON pairing_requests FOR EACH ROW EXECUTE FUNCTION refuse_pairing_upgrade()`);
 try {await assert.rejects(upgradePairingCodes(db.pool,keys),/upgrade probe/);
  assert.equal((await db.pool.query('SELECT count(*) FROM pairing_requests WHERE code_hash=$1',[legacy])).rows[0].count,'2');
 }finally{await db.pool.query('DROP TRIGGER refuse_pairing_upgrade ON pairing_requests; DROP FUNCTION refuse_pairing_upgrade()');}
 assert.equal(await upgradePairingCodes(db.pool,keys,1),1);
 assert.equal((await db.pool.query('SELECT count(*) FROM pairing_requests WHERE code_hash=$1',[legacy])).rows[0].count,'1');
 assert.equal(await upgradePairingCodes(db.pool,keys,1),1);assert.equal(await upgradePairingCodes(db.pool,keys,1),0);
 assert.equal((await approve(a)).state,'awaiting_local');
});
