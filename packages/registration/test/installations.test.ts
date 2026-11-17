import {databaseClock} from './fixtures/database-clock.ts';
import {resetSchema} from './fixtures/reset-schema.ts';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {login} from '@waitron-cloud/identity';
import {database} from '../../account-http/test/fixtures.ts';
import {SignupStore,RegistrationStore,transaction} from '../src/index.ts';
import {InstallationStore} from '../src/installations.ts';
import {RelayGrantStore} from '../src/relay-grants.ts';
import {RelayControl} from '../src/relay-control.ts';
import {createLeaseIssuer,encodeMachine,type MachineAction,type SignedEnvelope} from '../src/installation-proof.ts';
const origin='https://cloud.example.test',password='a long enough local test password';
const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
let db:Awaited<ReturnType<typeof database>>,store:InstallationStore,other:InstallationStore;
let owner:{accountId:string;organisationId:string;legalBusinessId:string},session:{token:string;csrfToken:string};
let a:Awaited<ReturnType<typeof installation>>,b:Awaited<ReturnType<typeof installation>>;
async function installation(){
  const key=generateKeyPairSync('ed25519'),publicKey=key.publicKey.export({type:'spki',format:'der'}).toString('base64url');
  const r=new RegistrationStore(db.pool),binding={operationId:randomUUID(),installationKey:publicKey,venueId:'',environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
  await r.start(binding);await r.approveCloud(binding,owner.accountId);await r.approveLocal(binding,randomUUID());const registered=await r.complete(binding);
  return {...registered,key,publicKey};
}
function request(target=a,action:MachineAction='renew',lease:SignedEnvelope|undefined=undefined,body:unknown={},operationId=randomUUID(),issuedAt=Date.now()){
  const bytes=encodeMachine({origin,action,installationId:target.installationId,operationId,issuedAt,lease:lease?JSON.stringify(lease):'',body:JSON.stringify(body)});
  return {payload:bytes.toString('base64url'),signature:sign(null,bytes,target.key.privateKey).toString('base64url')};
}
const config=(target=a,lease?:SignedEnvelope)=>store.execute('configuration',request(target,'configuration',lease));
async function relayGrant(expectedRevision=0){
  const grants=new RelayGrantStore(db.pool,{mode:'local-proof',consentVersion:'fixture-v1',
    policy:{version:'fixture-v1',units:3,periodSeconds:3600,epoch:'2026-01-01T00:00:00.000Z',excess:'refuse',debit:'retain'},
    verifyOrigin:async challenge=>({...challenge,domainControl:true,httpsEndpoint:true,expiresAt:new Date(Date.now()+3600000).toISOString()})});
  const grant=await grants.approve(session.token,session.csrfToken,{installationId:a.installationId,expectedRevision,
    consent:true,consentVersion:'fixture-v1',managementOrigin:'https://manage.example.test',expiresAt:new Date(Date.now()+1800000).toISOString()});
  return {grant,grants};
}
before(async()=>{db=await database();store=new InstallationStore(db.pool,issuer,origin);other=new InstallationStore(db.secondPool,issuer,origin);});
after(async()=>db?.close());
beforeEach(async()=>{
  await resetSchema(db.pool);
  const signup=new SignupStore(db.pool,db.outbox);await signup.request('owner@example.test');const mail=db.outbox.open((await db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert.ok('token' in mail);
  owner=await signup.complete(mail.token,{password,organisationName:'Sol',legalBusinessName:'Sol SL',countryCode:'ES'});
  session=await transaction(db.pool,c=>login(c,{email:'owner@example.test',password}));a=await installation();b=await installation();
});
test('version two discovers only its installation grant without changing service configuration',async()=>{
  await store.configure(a.installationId,0,[{service:'remote_access',state:'ready',configuration:{hostname:'venue.example.test'}}]);
  const renewed=await store.execute('renew',request());assert.ok(renewed.lease);
  const legacy=await config(a,renewed.lease);
  assert.equal(Object.hasOwn(legacy,'emailRelay'),false);
  const read=()=>store.execute('configuration',request(a,'configuration',renewed.lease,{servicesVersion:2}));
  const initial=await read();assert.deepEqual(initial.emailRelay,{version:1,grant:null});
  const {grant}=await relayGrant();
  const discovered=await read();
  assert.deepEqual(discovered.emailRelay,{version:1,grant:{id:grant.id,revision:1,expiresAt:grant.expiresAt,enabled:true}});
  assert.equal(discovered.revision,legacy.revision);
  assert.deepEqual(discovered.services,initial.services);
  for(const mode of ['test-free-paid','test-venue-levels'] as const){
    const masked=await new InstallationStore(db.pool,issuer,origin,undefined,mode).execute('configuration',request(a,'configuration',renewed.lease,{servicesVersion:2}));
    assert.deepEqual(masked.emailRelay,discovered.emailRelay);
    assert.equal(masked.services.find(s=>s.service==='remote_access')?.state,'unconfigured');
    assert.equal(masked.revision,legacy.revision);
  }
  const second=await store.execute('renew',request(b));assert.ok(second.lease);
  assert.deepEqual((await store.execute('configuration',request(b,'configuration',second.lease,{servicesVersion:2}))).emailRelay,{version:1,grant:null});
  assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM installation_operations WHERE result ? 'emailRelay'")).rows[0].n,0);
});
test('exact version two replay reads current relay stop, revoke and renewed grant hints',async()=>{
  const renewed=await store.execute('renew',request());assert.ok(renewed.lease);
  const proof=request(a,'configuration',renewed.lease,{servicesVersion:2});
  const {grant,grants}=await relayGrant(),control=new RelayControl(db.pool);
  const read=()=>store.execute('configuration',proof);
  assert.equal((await read()).emailRelay?.grant?.enabled,true);
  await control.stop();assert.equal((await read()).emailRelay?.grant?.enabled,false);
  await control.resume();assert.equal((await read()).emailRelay?.grant?.enabled,true);
  await grants.revoke(session.token,session.csrfToken,grant.id);
  assert.deepEqual((await read()).emailRelay,{version:1,grant:{id:grant.id,revision:1,expiresAt:grant.expiresAt,enabled:false}});
  const next=await relayGrant(1);
  assert.deepEqual((await read()).emailRelay,{version:1,grant:{id:next.grant.id,revision:2,expiresAt:next.grant.expiresAt,enabled:true}});
  assert.equal((await db.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[a.installationId])).rows[0].configuration_revision,0);
  assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM installation_operations WHERE installation_id=$1 AND operation_id=$2",[a.installationId,JSON.parse(Buffer.from(proof.payload,'base64url').toString())[4]])).rows[0].n,1);
});
test('unavailable grant authority is unknown rather than an explicit off hint',async()=>{
  const renewed=await store.execute('renew',request());assert.ok(renewed.lease);
  const {grant}=await relayGrant();
  const proof=request(a,'configuration',renewed.lease,{servicesVersion:2}),read=()=>store.execute('configuration',proof);
  const mutations=[
    ["UPDATE relay_grants SET created_at=clock_timestamp()-interval '1 day',expires_at=clock_timestamp()-interval '1 second' WHERE id=$1","UPDATE relay_grants SET expires_at=$2 WHERE id=$1",grant.id,grant.expiresAt],
    ["UPDATE relay_grants SET public_key='wrong' WHERE id=$1","UPDATE relay_grants SET public_key=$2 WHERE id=$1",grant.id,a.publicKey],
    ["UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1","UPDATE cloud_accounts SET disabled_at=NULL WHERE id=$1",owner.accountId],
    ["UPDATE cloud_credentials SET email_verified_at=NULL WHERE account_id=$1","UPDATE cloud_credentials SET email_verified_at=clock_timestamp() WHERE account_id=$1",owner.accountId],
    ["UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1","UPDATE organisation_memberships SET is_owner=true WHERE account_id=$1",owner.accountId],
    ["UPDATE installations SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1","UPDATE installations SET lease_expires_at=clock_timestamp()+interval '1 hour' WHERE id=$1",a.installationId],
  ];
  assert.equal((await read()).emailRelay?.grant?.enabled,true);
  await db.pool.query("UPDATE relay_grants SET venue_id=$2 WHERE id=$1",[grant.id,b.venueId]);
  assert.deepEqual((await read()).emailRelay,{version:1,grant:null});
  await db.pool.query("UPDATE relay_grants SET venue_id=$2 WHERE id=$1",[grant.id,a.venueId]);
  for(const [change,restore,...values] of mutations){
    // Each change is committed so the independent machine transaction observes it.
    const count=(sql:string)=>Math.max(...[...sql.matchAll(/\$(\d+)/g)].map(m=>Number(m[1])));
    await db.pool.query(change as string,values.slice(0,count(change as string)));
    try{assert.deepEqual((await read()).emailRelay,{version:1,grant:null},change as string);}
    finally{await db.pool.query(restore as string,values.slice(0,count(restore as string)));}
    assert.equal((await read()).emailRelay?.grant?.enabled,true);
  }
});
function privateRelayStore(environment='test',pool=db.pool){
  return new RelayGrantStore(pool,{mode:'local-proof',consentVersion:'fixture-v1',
    policy:{version:'fixture-v1',units:3,periodSeconds:3600,epoch:'2026-01-01T00:00:00.000Z',excess:'refuse',debit:'retain'},
    verifyOrigin:async()=>{throw Error('No public origin challenge for a private box');},
    testOrigin:{environment,origin,trusted:new Map([[issuer.keyId,issuer.publicKey]])}});
}
function privateApproval(managementOrigin:string,expectedRevision=0){
  return {installationId:a.installationId,expectedRevision,consent:true as const,consentVersion:'fixture-v1',
    managementOrigin,expiresAt:new Date(Date.now()+1800000).toISOString()};
}
test('test owner approves only the private origin stated in a signed current configuration exchange',async()=>{
  const renewed=await store.execute('renew',request());assert.ok(renewed.lease);
  const grants=privateRelayStore();let revision=0;
  for(const managementOrigin of ['https://192.168.10.10:3000','https://10.1.2.3','https://172.16.0.1','https://172.31.255.254','https://waitron.local:3000']){
    const proof=request(a,'configuration',renewed.lease,{servicesVersion:2,managementOrigin});
    const configuration=await store.execute('configuration',proof);
    assert.equal(configuration.revision,0);
    const grant=await grants.approve(session.token,session.csrfToken,privateApproval(managementOrigin,revision),proof);
    assert.equal(grant.managementOrigin,managementOrigin);assert.equal(grant.enabled,true);revision++;
    const hint=await store.execute('configuration',request(a,'configuration',renewed.lease,{servicesVersion:2}));
    assert.equal(hint.emailRelay?.grant?.id,grant.id);assert.equal(hint.emailRelay?.grant?.revision,revision);
  }
  const grant=(await db.pool.query('SELECT id FROM relay_grants WHERE installation_id=$1',[a.installationId])).rows[0];
  await grants.revoke(session.token,session.csrfToken,grant.id);
  assert.equal((await store.execute('configuration',request(a,'configuration',renewed.lease,{servicesVersion:2}))).emailRelay?.grant?.enabled,false);
});
test('private-origin approval requires the same statement to complete its configuration exchange',async()=>{
  const renewed=await store.execute('renew',request());assert.ok(renewed.lease);
  const managementOrigin='https://waitron.local:3000';
  const operationId=randomUUID(),proof=request(a,'configuration',renewed.lease,{servicesVersion:2,managementOrigin},operationId),grants=privateRelayStore();
  await assert.rejects(grants.approve(session.token,session.csrfToken,privateApproval(managementOrigin),proof),/origin_unverified/);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM relay_grants')).rows[0].n,0);
  await store.execute('configuration',proof);
  const changedOrigin='https://other.local';
  const changed=request(a,'configuration',renewed.lease,{servicesVersion:2,managementOrigin:changedOrigin},operationId);
  await assert.rejects(grants.approve(session.token,session.csrfToken,privateApproval(changedOrigin),changed),/origin_unverified/);
  assert.equal((await grants.approve(session.token,session.csrfToken,privateApproval(managementOrigin),proof)).enabled,true);
});
test('private-origin approval rejects unsigned, mismatched, stale and unleased statements and missing owner consent',async()=>{
  const renewed=await store.execute('renew',request());assert.ok(renewed.lease);
  const managementOrigin='https://waitron.local:3000',input=privateApproval(managementOrigin),grants=privateRelayStore();
  const body={servicesVersion:2,managementOrigin};
  const operationId=randomUUID(),good=request(a,'configuration',renewed.lease,body,operationId);
  await store.execute('configuration',good);
  const otherLease=(await store.execute('renew',request(b))).lease;assert.ok(otherLease);
  const cases=[request(a,'configuration',otherLease,body,operationId),undefined,{...good,signature:'invalid'},request(a,'configuration',undefined,body,operationId),
    request(a,'configuration',renewed.lease,body,operationId,Date.now()-120000),
    request(a,'report',renewed.lease,body,operationId),request(b,'configuration',renewed.lease,body,operationId),
    request(a,'configuration',renewed.lease,{servicesVersion:2,managementOrigin:'https://other.local'}),
    request(a,'configuration',renewed.lease,{servicesVersion:2})];
  for(const proof of cases)await assert.rejects(grants.approve(session.token,session.csrfToken,input,proof),/origin_unverified/);
  await assert.rejects(grants.approve(session.token,session.csrfToken,{...input,consent:false} as any,good),/invalid_input/);
  await db.pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',[owner.accountId]);
  await assert.rejects(grants.approve(session.token,session.csrfToken,input,good),/grant_unavailable/);
  await db.pool.query('UPDATE organisation_memberships SET is_owner=true WHERE account_id=$1',[owner.accountId]);
  for(const [change,restore] of [
    ["UPDATE installations SET public_key='changed' WHERE id=$1",'UPDATE installations SET public_key=$2 WHERE id=$1'],
    ["UPDATE installations SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", "UPDATE installations SET lease_expires_at=clock_timestamp()+interval '1 hour' WHERE id=$1"]] as const){
    await db.pool.query(change,[a.installationId]);
    await assert.rejects(grants.approve(session.token,session.csrfToken,input,good));
    await db.pool.query(restore,restore.includes('$2')?[a.installationId,a.publicKey]:[a.installationId]);
  }
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM relay_grants')).rows[0].n,0);
});
test('test-only origin exception excludes public, loopback, link-local and non-HTTPS origins',async()=>{
  const renewed=await store.execute('renew',request());assert.ok(renewed.lease);
  const grants=privateRelayStore();
  for(const managementOrigin of ['https://example.test','https://127.0.0.1','https://169.254.1.2','https://172.15.255.255','https://172.32.0.1','https://[fe80::1]','https://localhost','https://local','https://waitron.local.example','http://192.168.1.2','https://waitron.local/path','https://.local','https://a..local','https://-.local','https://_x.local']){
    const proof=request(a,'configuration',renewed.lease,{servicesVersion:2,managementOrigin});
    await assert.rejects(store.execute('configuration',proof),/invalid_proof/);
    await assert.rejects(grants.approve(session.token,session.csrfToken,privateApproval(managementOrigin),proof));
  }
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM relay_grants')).rows[0].n,0);
});
test('private-origin proof expiry during grant lock waits rolls approval back',async t=>{
  let time=Date.now();t.mock.method(Date,'now',()=>time);
  const renewed=await store.execute('renew',request());assert.ok(renewed.lease);
  const grants=privateRelayStore('test',databaseClock(db.pool,()=>time));
  const managementOrigin='https://waitron.local:3000';
  const proof=request(a,'configuration',renewed.lease,{servicesVersion:2,managementOrigin});
  await store.execute('configuration',proof);
  const blocker=await db.secondPool.connect();await blocker.query('BEGIN');
  await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('relay-grant:'||$1,0))",[a.installationId]);
  const pending=assert.rejects(grants.approve(session.token,session.csrfToken,privateApproval(managementOrigin),proof),/origin_unverified/);
  try{await waitForLock();time+=61000;}
  finally{await blocker.query('COMMIT');blocker.release();await Promise.allSettled([pending]);}
  await pending;
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM relay_grants')).rows[0].n,0);
});
test('production cannot enable the private-origin exception or approve a production box',async()=>{
  assert.throws(()=>privateRelayStore('production'),/invalid_input/);
  await db.pool.query("UPDATE venues SET environment='production' WHERE id=$1",[a.venueId]);
  const renewed=await store.execute('renew',request());assert.ok(renewed.lease);
  const managementOrigin='https://waitron.local:3000',proof=request(a,'configuration',renewed.lease,{servicesVersion:2,managementOrigin});
  await assert.rejects(store.execute('configuration',proof),/invalid_proof/);
  await assert.rejects(privateRelayStore().approve(session.token,session.csrfToken,privateApproval(managementOrigin),proof),/grant_unavailable/);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM relay_grants')).rows[0].n,0);
});
test('durable renewal is scoped and replayed once across independent workers',async()=>{
  const operationId=randomUUID(),proof=request(a,'renew',undefined,{},operationId),[one,two]=await Promise.all([store.execute('renew',proof),other.execute('renew',proof)]);
  assert.deepEqual(one,two);assert.ok(one.lease);assert.equal(one.installationId,a.installationId);
  assert.equal(one.revision,0);assert.deepEqual(one.services.map(s=>[s.state,s.health]),Array(3).fill(['unconfigured','unknown']));
  assert.deepEqual(await new InstallationStore(db.pool,issuer,origin).execute('renew',proof),one);
  assert.equal((await db.pool.query('SELECT count(*) FROM installation_operations')).rows[0].count,'1');
  const event=(await db.pool.query("SELECT * FROM security_audit_events WHERE event_type='installation.credentials_renewed'")).rows[0];
  assert.equal(event.organisation_id,owner.organisationId);assert.equal(event.venue_id,a.venueId);assert.equal(event.actor_kind,'installation');assert.equal(event.actor_id,a.installationId);assert.equal(event.subject_id,a.installationId);assert.notEqual(event.source_id,operationId);
  assert.equal((await db.pool.query("SELECT count(*) FROM security_audit_events WHERE event_type='installation.credentials_renewed'")).rows[0].count,'1');
  const twoVenue=await store.execute('renew',request(b));assert.notDeepEqual(one.lease,twoVenue.lease);
  assert.equal((await config(a,one.lease)).venueId,a.venueId);
  await assert.rejects(config(b,one.lease),/invalid_proof/);await assert.rejects(config(a),/invalid_proof/);
  const altered={...proof,signature:request(b).signature};await assert.rejects(store.execute('renew',altered),/invalid_proof/);
  const id=JSON.parse(Buffer.from(proof.payload,'base64url').toString())[4];
  await assert.rejects(store.execute('revoke',request(a,'revoke',undefined,{},id)),/conflict/);
});
test('credential audit does not invert the installation and venue lock order',async()=>{
  const blocker=await db.secondPool.connect();await blocker.query('BEGIN');await blocker.query('SELECT 1 FROM venues WHERE id=$1 FOR NO KEY UPDATE',[a.venueId]);
  const pending=store.execute('renew',request());let auditWaited=false;
  try{
    for(let n=0;n<50;n++){
      const waiting=await db.pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE 'SELECT organisation_id FROM venues%'",[db.schema]);
      if(waiting.rowCount){auditWaited=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
    }
  }finally{await blocker.query('COMMIT');blocker.release();}
  await pending;assert.equal(auditWaited,false,'audit insertion must not add a venue row lock after the installation lock');
});
test('credential audit scopes a machine operation ID to its installation',async()=>{
  const operationId=randomUUID();
  const first=await store.execute('renew',request(a,'renew',undefined,{},operationId));
  const second=await store.execute('renew',request(b,'renew',undefined,{},operationId));
  assert.equal(first.installationId,a.installationId);assert.equal(second.installationId,b.installationId);
  assert.equal((await db.pool.query('SELECT count(*) FROM installation_operations WHERE operation_id=$1',[operationId])).rows[0].count,'2');
  assert.equal((await db.pool.query("SELECT count(*) FROM security_audit_events WHERE event_type='installation.credentials_renewed'")).rows[0].count,'2');
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
async function installationWaiters(blockerPid:number){
  return db.pool.query(`SELECT pid,state,query,wait_event,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
    WHERE application_name=$1 AND state='active' AND wait_event_type='Lock'
      AND query LIKE 'SELECT i.*,v.environment,v.organisation_id FROM installations i%FOR UPDATE OF i'
      AND $2::integer=ANY(pg_blocking_pids(pid))`,[db.schema,blockerPid]);
}
async function waitForInstallationLock(blockerPid:number){
  for(let n=0;n<100;n++){
    const result=await installationWaiters(blockerPid);if(result.rowCount)return result.rows;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  throw new Error('installation request did not reach the held installation lock');
}
test('installation lock observation excludes revocation waiting on its session',async t=>{
  const blocker=await db.pool.connect();let revoke:Promise<unknown>|undefined;
  t.after(async()=>{
    try{await blocker.query('ROLLBACK');}finally{blocker.release();}
    await revoke;
  });
  await blocker.query('BEGIN');
  await blocker.query('SELECT 1 FROM installations WHERE id=$1 FOR UPDATE',[a.installationId]);
  const blockerPid=(await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  await blocker.query('SAVEPOINT session_barrier');
  await blocker.query('SELECT 1 FROM cloud_sessions FOR UPDATE');
  revoke=other.revokeWithSession(session.token,session.csrfToken,a.installationId);void revoke.catch(()=>{});
  const earlier=await waitForLock();
  assert.ok(earlier.some(row=>row.query.includes('FROM cloud_sessions')),'revocation must first wait on its held session');
  assert.equal((await installationWaiters(blockerPid)).rowCount,0,'a session wait must not admit the competing renewal');
  await blocker.query('ROLLBACK TO SAVEPOINT session_barrier');
  const waiting=await waitForInstallationLock(blockerPid);
  assert.ok(waiting.every(row=>row.blockers.includes(blockerPid)),'the held installation must block the observed request');
  const otherPid=(await db.pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  assert.equal((await installationWaiters(otherPid)).rowCount,0,'a different connection cannot stand in for the installation holder');
});
test('owner revocation serializes with renewal, persists and preserves the other venue and services',async t=>{
  const proof=request();await store.execute('renew',proof);
  const blocker=await db.pool.connect();let released=false,revoke:Promise<unknown>|undefined,pending:Promise<void>|undefined;
  t.after(async()=>{
    try{if(!released)await blocker.query('ROLLBACK');}
    finally{if(!released)blocker.release();await Promise.allSettled([revoke,pending]);}
  });
  await blocker.query('BEGIN');await blocker.query('SELECT 1 FROM installations WHERE id=$1 FOR UPDATE',[a.installationId]);
  revoke=other.revokeWithSession(session.token,session.csrfToken,a.installationId);void revoke.catch(()=>{});
  const blockerPid=(await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const waiting=await waitForInstallationLock(blockerPid);
  t.diagnostic(JSON.stringify({step:'before competing renewal',waiting}));
  pending=assert.rejects(store.execute('renew',request()).then(result=>{
    t.diagnostic(JSON.stringify({step:'renewal accepted',revokedAt:result.revokedAt,leaseExpiresAt:result.leaseExpiresAt}));return result;
  }),/revoked/);
  void pending.catch(()=>{});
  // Queue both requests before release: a new arrival can overtake a waking row-lock waiter.
  t.diagnostic(JSON.stringify({step:'competing renewal queued',waiting:await waitForInstallationLock(waiting[0].pid)}));
  await blocker.query('COMMIT');blocker.release();released=true;await revoke;await pending;
  const audit=(await db.pool.query('SELECT * FROM installation_revocations WHERE installation_id=$1',[a.installationId])).rows[0];assert.equal(audit.actor_kind,'account');assert.equal(audit.actor_id,owner.accountId);assert.equal(audit.reason,'user_requested');assert.ok(audit.result.revokedAt);
  const security=(await db.pool.query("SELECT * FROM security_audit_events WHERE event_type='installation.revoked'")).rows[0];assert.equal(security.actor_kind,'account');assert.equal(security.actor_id,owner.accountId);assert.equal(security.subject_id,a.installationId);assert.equal(security.source_id,a.installationId);
  await assert.rejects(store.execute('renew',proof),/revoked/);await assert.rejects(config(a),/revoked/);
  assert.equal((await db.pool.query('SELECT count(*) FROM venues')).rows[0].count,'2');
  assert.equal((await db.pool.query('SELECT count(*) FROM installation_services')).rows[0].count,'8');
  assert.ok((await store.execute('renew',request(b))).lease);
  const list=await store.listWithSession(session.token);assert.equal(list.length,2);assert.ok(list.find(i=>i.installationId===a.installationId)?.revokedAt);
  assert.equal(JSON.stringify(list).includes('signature'),false);assert.equal(JSON.stringify(list).includes(a.publicKey),false);
});
test('machine revoke recovers its committed reply but cannot revive a revoked key',async()=>{
  const proof=request(a,'revoke');const one=await store.execute('revoke',proof);assert.ok(one.revokedAt);
  assert.deepEqual(await other.execute('revoke',proof),one);
  const audit=(await db.pool.query('SELECT * FROM installation_revocations')).rows[0];assert.equal(audit.actor_kind,'installation');assert.equal(audit.actor_id,a.installationId);assert.deepEqual(audit.result,one);await assert.rejects(other.execute('renew',request()),/revoked/);
  const security=(await db.pool.query("SELECT * FROM security_audit_events WHERE event_type='installation.revoked'")).rows[0];assert.equal(security.actor_kind,'installation');assert.equal(security.actor_id,a.installationId);assert.equal(security.source_id,a.installationId);
  assert.equal((await db.pool.query("SELECT count(*) FROM security_audit_events WHERE event_type='installation.revoked'")).rows[0].count,'1');
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
async function waitForLock(){for(let n=0;n<100;n++){const r=await db.pool.query("SELECT pid,state,query,wait_event,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[db.schema]);if(r.rowCount)return r.rows;await new Promise(r=>setTimeout(r,10));}throw new Error('request did not reach lock');}
for(const setupPause of [0,600])test('request freshness and owner session expiry are checked after installation lock waits'+(setupPause?' after a setup pause':''),async t=>{
  let time=Date.now();t.mock.method(Date,'now',()=>time);
  const clockStore=new InstallationStore(databaseClock(db.pool,()=>time),issuer,origin);
  let blocker=await db.secondPool.connect();await blocker.query('BEGIN');await blocker.query('SELECT 1 FROM installations WHERE id=$1 FOR UPDATE',[a.installationId]);
  if(setupPause)await new Promise(r=>setTimeout(r,setupPause));
  const pending=assert.rejects(clockStore.execute('renew',request(a,'renew',undefined,{},randomUUID(),Date.now()-59750)),/invalid_proof/);
  try{await waitForLock();time+=300;}finally{await blocker.query('COMMIT');blocker.release();await Promise.allSettled([pending]);}await pending;
  assert.equal((await db.pool.query('SELECT count(*) FROM installation_operations')).rows[0].count,'0');
  blocker=await db.secondPool.connect();await blocker.query('BEGIN');await blocker.query('SELECT 1 FROM installations WHERE id=$1 FOR UPDATE',[a.installationId]);
  await db.pool.query('UPDATE cloud_sessions SET absolute_expires_at=$1',[new Date(time+250)]);
  if(setupPause)await new Promise(r=>setTimeout(r,setupPause));
  const expired=assert.rejects(clockStore.revokeWithSession(session.token,session.csrfToken,a.installationId),/session_expired/);
  try{await waitForLock();time+=300;}finally{await blocker.query('COMMIT');blocker.release();await Promise.allSettled([expired]);}await expired;
  assert.equal((await db.pool.query('SELECT revoked_at FROM installations WHERE id=$1',[a.installationId])).rows[0].revoked_at,null);
  assert.equal((await db.pool.query("SELECT count(*) FROM security_audit_events WHERE event_type='installation.revoked'")).rows[0].count,'0');
});

test('operation identity survives lease renewal while every replay authenticates current bindings',async()=>{
  const first=await store.execute('renew',request()),second=await store.execute('renew',request());
  const id=randomUUID(),one=await store.execute('configuration',request(a,'configuration',first.lease,{},id));
  assert.deepEqual(await other.execute('configuration',request(a,'configuration',second.lease,{},id)),one);
  const wrong=(await store.execute('renew',request(b))).lease;
  await assert.rejects(store.execute('configuration',request(a,'configuration',wrong,{},id)),/invalid_proof/);
});
test('issuer rotation accepts an old live lease during configured overlap and signs renewals with the new key',async()=>{
  const next=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
  const old=(await store.execute('renew',request())).lease!;
  const trusted=new Map([[issuer.keyId,issuer.publicKey],[next.keyId,next.publicKey]]);
  const rotated=new InstallationStore(db.pool,next,origin,trusted);
  assert.equal((await rotated.execute('configuration',request(a,'configuration',old))).installationId,a.installationId);
  const renewed=(await rotated.execute('renew',request())).lease!;
  assert.equal(JSON.parse(Buffer.from(renewed.payload,'base64url').toString())[2],next.keyId);
  await assert.rejects(new InstallationStore(db.pool,next,origin).execute('configuration',request(a,'configuration',old)),/invalid_proof/);
});
test('machine revocation stores status without adapter authority in either replay or audit',async()=>{
  await store.configure(a.installationId,0,[{service:'remote_access',state:'ready',configuration:{secret:'adapter-authority'}}]);
  const proof=request(a,'revoke'),result=await store.execute('revoke',proof);
  assert.equal(JSON.stringify(result).includes('adapter-authority'),false);
  assert.equal(JSON.stringify((await db.pool.query('SELECT result FROM installation_revocations')).rows).includes('adapter-authority'),false);
  assert.equal(JSON.stringify((await db.pool.query('SELECT result FROM installation_operations')).rows).includes('adapter-authority'),false);
  assert.deepEqual(await other.execute('revoke',proof),result);
});
test('leases bind the venue, environment and stored key; renewal and revocation accept no lease',async()=>{
  const now=Date.now(),input={origin,leaseId:randomUUID(),installationId:a.installationId,venueId:a.venueId,environment:'test' as const,publicKey:a.publicKey,issuedAt:now,expiresAt:now+3600000};
  for(const change of [{venueId:b.venueId},{environment:'production' as const},{publicKey:b.publicKey}])
    await assert.rejects(config(a,issuer.issue({...input,...change})),/invalid_proof/);
  const lease=issuer.issue(input);
  for(const action of ['renew','revoke'] as const)await assert.rejects(store.execute(action,request(a,action,lease)),/invalid_proof/);
  assert.equal((await db.pool.query('SELECT count(*) FROM installation_operations')).rows[0].count,'0');
});
test('proof expiry during the final configuration read rolls back all writes',async()=>{
  const blocker=await db.secondPool.connect();await blocker.query('BEGIN');await blocker.query('LOCK TABLE installation_services IN ACCESS EXCLUSIVE MODE');
  const expired=assert.rejects(store.execute('renew',request(a,'renew',undefined,{},randomUUID(),Date.now()-59500)),/invalid_proof/);
  try{await waitForLock();await new Promise(r=>setTimeout(r,600));}finally{await blocker.query('COMMIT');blocker.release();await Promise.allSettled([expired]);}
  await expired;assert.equal((await db.pool.query('SELECT count(*) FROM installation_operations')).rows[0].count,'0');
  assert.equal((await db.pool.query('SELECT lease_expires_at FROM installations WHERE id=$1',[a.installationId])).rows[0].lease_expires_at,null);
});
test('proof expiry during the relay hint read rolls back configuration acknowledgement',async t=>{
  const renewed=await store.execute('renew',request());assert.ok(renewed.lease);
  let now=Date.now();t.mock.method(Date,'now',()=>now);
  const blocker=await db.secondPool.connect();await blocker.query('BEGIN');await blocker.query('LOCK TABLE relay_grants IN ACCESS EXCLUSIVE MODE');
  const before=(await db.pool.query('SELECT count(*)::int AS n FROM installation_operations')).rows[0].n;
  const pending=store.execute('configuration',request(a,'configuration',renewed.lease,{servicesVersion:2}));
  const expired=assert.rejects(pending,/invalid_proof/);void expired.catch(()=>{});
  try{await waitForLock();now+=61000;}finally{await blocker.query('COMMIT');blocker.release();}
  await expired;
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM installation_operations')).rows[0].n,before);
});
