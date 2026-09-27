import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {createSession,type SessionCredentials} from '@waitron-cloud/identity';
import {Pool} from 'pg';
import {migrate} from '../src/migrate.ts';
import {SupportGrantError,SupportGrantStore,supportAccessAuditSourceId,type SupportGrantApproval,type SupportGrantAuthorization} from '../src/support-grants.ts';
import {transaction} from '../src/transaction.ts';

const url=process.env.TEST_DATABASE_URL;
if(!url)throw new Error('Run through scripts/test-postgres.mjs');
const schema=`support_${randomUUID().replaceAll('-','')}`;
const options=`-c search_path=${schema} -c statement_timeout=10000`;
const admin=new Pool({connectionString:url});
const pool=new Pool({connectionString:url,options,application_name:schema});
const config={eligibilityPermissions:['support.eligible'],grantableActions:['customer.data.read','diagnostics.run']};
const store=new SupportGrantStore(pool,config),disabledStore=new SupportGrantStore(pool);
let owner:string,secondOwner:string,member:string,platform:string,organisation:string,foreignOrganisation:string,venue:string,foreignVenue:string;
let ownerSession:SessionCredentials,secondOwnerSession:SessionCredentials,memberSession:SessionCredentials;

before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);await pool.query('CREATE TABLE support_test_markers(id uuid PRIMARY KEY, value text NOT NULL)');});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
beforeEach(async()=>{
 await pool.query('TRUNCATE organisations,cloud_accounts CASCADE');
 await pool.query('TRUNCATE support_test_markers');
 owner=randomUUID();secondOwner=randomUUID();member=randomUUID();platform=randomUUID();organisation=randomUUID();foreignOrganisation=randomUUID();venue=randomUUID();foreignVenue=randomUUID();
 await pool.query('INSERT INTO cloud_accounts(id) VALUES($1),($2),($3),($4)',[owner,secondOwner,member,platform]);
 await pool.query("INSERT INTO organisations(id,name) VALUES($1,'Customer Org'),($2,'Foreign Org')",[organisation,foreignOrganisation]);
 const business=randomUUID(),foreignBusiness=randomUUID();
 await pool.query("INSERT INTO legal_businesses(id,organisation_id,name,country_code) VALUES($1,$2,'Customer SL','ES'),($3,$4,'Foreign SL','ES')",[business,organisation,foreignBusiness,foreignOrganisation]);
 await pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,'test'),($5,$6,$7,$8,'test')",[venue,organisation,business,randomUUID(),foreignVenue,foreignOrganisation,foreignBusiness,randomUUID()]);
 await pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner) VALUES($1,$2,true),($3,$2,true),($4,$2,false),($4,$5,true)',[owner,organisation,secondOwner,member,foreignOrganisation]);
 await pool.query("INSERT INTO platform_permissions(account_id,permission) VALUES($1,'support.eligible')",[platform]);
 ownerSession=await transaction(pool,client=>createSession(client,owner));
 secondOwnerSession=await transaction(pool,client=>createSession(client,secondOwner));
 memberSession=await transaction(pool,client=>createSession(client,member));
});

function approval(overrides:Partial<SupportGrantApproval>={}):SupportGrantApproval{return{
 id:randomUUID(),organisationId:organisation,venueId:venue,platformAccountId:platform,
 actions:['diagnostics.run','customer.data.read'],reason:'Investigate the failed terminal',
 expiresAt:new Date(Date.now()+60_000).toISOString(),...overrides,
};}
async function expectCode(action:Promise<unknown>,code:SupportGrantError['code']){
 await assert.rejects(action,(error:unknown)=>error instanceof SupportGrantError&&error.code===code);
}
function authorization(grantId:string,overrides:Partial<SupportGrantAuthorization>={}):SupportGrantAuthorization{return{
 grantId,platformAccountId:platform,organisationId:organisation,venueId:venue,
 action:'customer.data.read',operationId:randomUUID(),...overrides,
};}
const marker=(id:string,value='protected')=>(client:import('pg').PoolClient)=>client.query('INSERT INTO support_test_markers(id,value) VALUES($1,$2) ON CONFLICT(id) DO NOTHING',[id,value]).then(()=>value);
async function waitFor(pattern:string){for(let attempt=0;attempt<200;attempt++){
 const waiting=await admin.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE $2",[schema,pattern]);
 if(waiting.rowCount)return;await delay(10);
 }throw new Error('query did not reach expected lock');}

test('support grants are disabled until both eligibility and actions are configured',async()=>{
 await expectCode(disabledStore.approve(ownerSession.token,ownerSession.csrfToken,approval()),'not_configured');
 assert.equal((await pool.query('SELECT count(*) FROM support_grants')).rows[0].count,'0');
});

test('approval binds a current owner, eligible existing platform identity, tenant and configured scope',async()=>{
 const input=approval();
 const grant=await store.approve(ownerSession.token,ownerSession.csrfToken,input);
 assert.equal(grant.id,input.id);assert.equal(grant.organisationId,organisation);assert.equal(grant.venueId,venue);
 assert.equal(grant.platformAccountId,platform);assert.equal(grant.approvedByAccountId,owner);
 assert.deepEqual(grant.actions,['customer.data.read','diagnostics.run']);assert.equal(grant.reason,input.reason);
 assert.equal(grant.expiresAt,input.expiresAt);assert.equal(grant.revokedAt,null);assert.equal(grant.revokedByAccountId,null);
 const audit=(await pool.query("SELECT event_type,actor_kind,actor_id,subject_kind,subject_id FROM security_audit_events WHERE event_type='support.granted'")).rows[0];
 assert.deepEqual(audit,{event_type:'support.granted',actor_kind:'account',actor_id:owner,subject_kind:'support_grant',subject_id:input.id});
});

test('approval rejects stale customer authority, missing platform eligibility and foreign targets',async()=>{
 await expectCode(store.approve(memberSession.token,memberSession.csrfToken,approval()),'permission_denied');
 await expectCode(store.approve(ownerSession.token,'wrong',approval()),'permission_denied');
 await pool.query('DELETE FROM platform_permissions WHERE account_id=$1',[platform]);
 await expectCode(store.approve(ownerSession.token,ownerSession.csrfToken,approval()),'permission_denied');
 await pool.query("INSERT INTO platform_permissions(account_id,permission) VALUES($1,'support.eligible')",[platform]);
 await expectCode(store.approve(ownerSession.token,ownerSession.csrfToken,approval({platformAccountId:randomUUID()})),'permission_denied');
 await pool.query('UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1',[platform]);
 await expectCode(store.approve(ownerSession.token,ownerSession.csrfToken,approval()),'permission_denied');
 await pool.query('UPDATE cloud_accounts SET disabled_at=NULL WHERE id=$1',[platform]);
 await expectCode(store.approve(ownerSession.token,ownerSession.csrfToken,approval({venueId:foreignVenue})),'permission_denied');
 assert.equal((await pool.query('SELECT count(*) FROM support_grants')).rows[0].count,'0');
 assert.equal((await pool.query("SELECT count(*) FROM security_audit_events WHERE event_type='support.granted'")).rows[0].count,'0');
});

test('approval validates explicit expiry, scope, reason and exact input',async()=>{
 const invalid:Partial<SupportGrantApproval>[]=[
  {id:'bad'},{organisationId:'bad'},{venueId:'bad'},{platformAccountId:'bad'},
  {actions:[]},{actions:['unknown.action']},{actions:['diagnostics.run','diagnostics.run']},
  {reason:''},{reason:' padded '},{reason:'x'.repeat(501)},
  {expiresAt:new Date(Date.now()-1000).toISOString()},{expiresAt:'not-a-time'},
 ];
 for(const changed of invalid)await expectCode(store.approve(ownerSession.token,ownerSession.csrfToken,approval(changed)),'invalid_input');
 await expectCode(store.approve(ownerSession.token,ownerSession.csrfToken,{...approval(),extra:true} as SupportGrantApproval),'invalid_input');
 assert.equal((await pool.query('SELECT count(*) FROM support_grants')).rows[0].count,'0');
});

test('identical approval retries are stable and a changed retry conflicts',async()=>{
 const input=approval(),first=await store.approve(ownerSession.token,ownerSession.csrfToken,input);
 const retry=await store.approve(ownerSession.token,ownerSession.csrfToken,{...input,actions:[...input.actions].reverse()});
 assert.deepEqual(retry,first);
 await expectCode(store.approve(ownerSession.token,ownerSession.csrfToken,{...input,reason:'A different request'}),'grant_conflict');
 assert.equal((await pool.query('SELECT count(*) FROM support_grants')).rows[0].count,'1');
 assert.equal((await pool.query("SELECT count(*) FROM security_audit_events WHERE event_type='support.granted'")).rows[0].count,'1');
});

test('an identical lost-reply approval retry returns the original grant after expiry',async()=>{
 const input=approval({expiresAt:new Date(Date.now()+600).toISOString()});
 const first=await store.approve(ownerSession.token,ownerSession.csrfToken,input);
 await delay(700);
 assert.deepEqual(await store.approve(ownerSession.token,ownerSession.csrfToken,input),first);
 assert.equal((await pool.query('SELECT count(*) FROM support_grants')).rows[0].count,'1');
 assert.equal((await pool.query("SELECT count(*) FROM security_audit_events WHERE event_type='support.granted'")).rows[0].count,'1');
});

test('a current owner can revoke early once without exposing the grant to another tenant',async()=>{
 const input=approval(),created=await store.approve(ownerSession.token,ownerSession.csrfToken,input);
 await expectCode(store.revoke(memberSession.token,memberSession.csrfToken,input.id),'grant_unavailable');
 const revoked=await store.revoke(secondOwnerSession.token,secondOwnerSession.csrfToken,input.id);
 assert.equal(revoked.revokedByAccountId,secondOwner);assert.ok(revoked.revokedAt);assert.equal(revoked.createdAt,created.createdAt);
 assert.deepEqual(await store.revoke(ownerSession.token,ownerSession.csrfToken,input.id),revoked);
 const audit=(await pool.query("SELECT actor_id,subject_id FROM security_audit_events WHERE event_type='support.revoked'")).rows;
 assert.deepEqual(audit,[{actor_id:secondOwner,subject_id:input.id}]);
});

test('authorization commits protected work and one redacted access event across a retry',async()=>{
 const grant=await store.approve(ownerSession.token,ownerSession.csrfToken,approval()),operationId=randomUUID();
 const input=authorization(grant.id,{operationId});
 assert.equal(await store.authorize(input,marker(operationId)),'protected');
 assert.equal(await store.authorize(input,marker(operationId)),'protected');
 assert.deepEqual((await pool.query('SELECT id,value FROM support_test_markers')).rows,[{id:operationId,value:'protected'}]);
 const audit=(await pool.query("SELECT actor_kind,actor_id,subject_id FROM security_audit_events WHERE event_type='support.accessed'")).rows;
 assert.deepEqual(audit,[{actor_kind:'platform_account',actor_id:platform,subject_id:grant.id}]);
});

test('one operation identity records separate granted actions and organisation venues',async()=>{
 const grant=await store.approve(ownerSession.token,ownerSession.csrfToken,approval({venueId:null})),operationId=randomUUID();
 const secondBusiness=randomUUID(),secondVenue=randomUUID();
 await pool.query("INSERT INTO legal_businesses(id,organisation_id,name,country_code) VALUES($1,$2,'Second SL','ES')",[secondBusiness,organisation]);
 await pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,'test')",[secondVenue,organisation,secondBusiness,randomUUID()]);
 await store.authorize(authorization(grant.id,{venueId:venue,action:'customer.data.read',operationId}),marker(randomUUID(),'read first venue'));
 await store.authorize(authorization(grant.id,{venueId:venue,action:'diagnostics.run',operationId}),marker(randomUUID(),'diagnose first venue'));
 await store.authorize(authorization(grant.id,{venueId:secondVenue,action:'customer.data.read',operationId}),marker(randomUUID(),'read second venue'));
 const events=(await pool.query("SELECT venue_id FROM security_audit_events WHERE event_type='support.accessed' ORDER BY venue_id NULLS FIRST")).rows;
 assert.deepEqual(events.map(row=>row.venue_id).sort(),[venue,venue,secondVenue].sort());
 assert.equal((await pool.query('SELECT count(*) FROM support_test_markers')).rows[0].count,'3');
 await expectCode(store.authorize(authorization(grant.id,{venueId:foreignVenue,operationId:randomUUID()}),marker(randomUUID())),'grant_unavailable');
});

test('authorization rejects unconfigured actions and mismatched grant bindings without protected writes',async()=>{
 const grant=await store.approve(ownerSession.token,ownerSession.csrfToken,approval({actions:['customer.data.read']}));
 const narrowStore=new SupportGrantStore(pool,{eligibilityPermissions:['support.eligible'],grantableActions:['diagnostics.run']});
 const cases:[()=>Promise<unknown>,SupportGrantError['code']][]=[
  [()=>disabledStore.authorize(authorization(grant.id),marker(randomUUID())),'not_configured'],
  [()=>narrowStore.authorize(authorization(grant.id),marker(randomUUID())),'permission_denied'],
  [()=>store.authorize(authorization(grant.id,{platformAccountId:randomUUID()}),marker(randomUUID())),'grant_unavailable'],
  [()=>store.authorize(authorization(grant.id,{organisationId:foreignOrganisation}),marker(randomUUID())),'grant_unavailable'],
  [()=>store.authorize(authorization(grant.id,{venueId:foreignVenue}),marker(randomUUID())),'grant_unavailable'],
  [()=>store.authorize(authorization(grant.id,{action:'diagnostics.run'}),marker(randomUUID())),'grant_unavailable'],
 ];
 for(const [action,code] of cases)await expectCode(action(),code);
 await expectCode(store.authorize({...authorization(grant.id),extra:true} as SupportGrantAuthorization,marker(randomUUID())),'invalid_input');
 assert.equal((await pool.query('SELECT count(*) FROM support_test_markers')).rows[0].count,'0');
});

test('revocation, platform eligibility loss and original approver permission loss deny later work',async()=>{
 const revoked=await store.approve(ownerSession.token,ownerSession.csrfToken,approval());
 await store.revoke(ownerSession.token,ownerSession.csrfToken,revoked.id);
 await expectCode(store.authorize(authorization(revoked.id),marker(randomUUID())),'grant_revoked');
 const disabled=await store.approve(ownerSession.token,ownerSession.csrfToken,approval());
 await pool.query('UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1',[platform]);
 await expectCode(store.authorize(authorization(disabled.id),marker(randomUUID())),'permission_denied');
 await pool.query('UPDATE cloud_accounts SET disabled_at=NULL WHERE id=$1',[platform]);
 const ineligible=await store.approve(ownerSession.token,ownerSession.csrfToken,approval());
 await pool.query('DELETE FROM platform_permissions WHERE account_id=$1',[platform]);
 await expectCode(store.authorize(authorization(ineligible.id),marker(randomUUID())),'permission_denied');
 await pool.query("INSERT INTO platform_permissions(account_id,permission) VALUES($1,'support.eligible')",[platform]);
 const staleApprover=await store.approve(ownerSession.token,ownerSession.csrfToken,approval());
 await pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1 AND organisation_id=$2',[owner,organisation]);
 await expectCode(store.authorize(authorization(staleApprover.id),marker(randomUUID())),'permission_denied');
 assert.equal((await pool.query('SELECT count(*) FROM support_test_markers')).rows[0].count,'0');
 assert.equal((await pool.query("SELECT count(*) FROM security_audit_events WHERE event_type='support.accessed'")).rows[0].count,'0');
});

test('expiry and changed approver authority are checked after waiting for the grant lock',async()=>{
 const expiring=await store.approve(ownerSession.token,ownerSession.csrfToken,approval({expiresAt:new Date(Date.now()+800).toISOString()}));
 const blocker=await admin.connect();await blocker.query('BEGIN');await blocker.query(`SELECT id FROM ${schema}.support_grants WHERE id=$1 FOR UPDATE`,[expiring.id]);
 try{
  const operationId=randomUUID(),attempt=store.authorize(authorization(expiring.id,{operationId}),marker(operationId));
  await waitFor('SELECT * FROM support_grants WHERE id=$1 FOR SHARE%');await delay(900);await blocker.query('COMMIT');
  await expectCode(attempt,'grant_expired');
 }finally{await blocker.query('ROLLBACK').catch(()=>{});blocker.release();}
 const changed=await store.approve(ownerSession.token,ownerSession.csrfToken,approval());
 const secondBlocker=await admin.connect();await secondBlocker.query('BEGIN');await secondBlocker.query(`SELECT id FROM ${schema}.support_grants WHERE id=$1 FOR UPDATE`,[changed.id]);
 try{
  const changedOperation=randomUUID(),changedAttempt=store.authorize(authorization(changed.id,{operationId:changedOperation}),marker(changedOperation));
  await waitFor('SELECT * FROM support_grants WHERE id=$1 FOR SHARE%');
  await pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1 AND organisation_id=$2',[owner,organisation]);
  await secondBlocker.query('COMMIT');await expectCode(changedAttempt,'permission_denied');
 }finally{await secondBlocker.query('ROLLBACK').catch(()=>{});secondBlocker.release();}
 assert.equal((await pool.query('SELECT count(*) FROM support_test_markers')).rows[0].count,'0');
});

test('expiry during protected work rolls back its writes and access event',async()=>{
 const grant=await store.approve(ownerSession.token,ownerSession.csrfToken,approval({expiresAt:new Date(Date.now()+800).toISOString()}));
 const operationId=randomUUID();let started=false;
 await expectCode(store.authorize(authorization(grant.id,{operationId}),async client=>{
  started=true;
  await client.query('INSERT INTO support_test_markers(id,value) VALUES($1,$2)',[operationId,'must roll back']);
  await delay(900);return 'late';
 }),'grant_expired');
 assert.equal(started,true);
 assert.equal((await pool.query('SELECT count(*) FROM support_test_markers')).rows[0].count,'0');
 assert.equal((await pool.query("SELECT count(*) FROM security_audit_events WHERE event_type='support.accessed'")).rows[0].count,'0');
});

test('authority removed inside protected work is caught by final checks and rolled back',async()=>{
 const membershipGrant=await store.approve(ownerSession.token,ownerSession.csrfToken,approval()),membershipOperation=randomUUID();
 await expectCode(store.authorize(authorization(membershipGrant.id,{operationId:membershipOperation}),async client=>{
  await client.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1 AND organisation_id=$2',[owner,organisation]);
  return marker(membershipOperation)(client);
 }),'permission_denied');
 assert.equal((await pool.query('SELECT is_owner FROM organisation_memberships WHERE account_id=$1 AND organisation_id=$2',[owner,organisation])).rows[0].is_owner,true);
 const eligibilityGrant=await store.approve(ownerSession.token,ownerSession.csrfToken,approval()),eligibilityOperation=randomUUID();
 await expectCode(store.authorize(authorization(eligibilityGrant.id,{operationId:eligibilityOperation}),async client=>{
  await client.query('DELETE FROM platform_permissions WHERE account_id=$1',[platform]);
  return marker(eligibilityOperation)(client);
 }),'permission_denied');
 assert.equal((await pool.query('SELECT count(*) FROM platform_permissions WHERE account_id=$1',[platform])).rows[0].count,'1');
 assert.equal((await pool.query('SELECT count(*) FROM support_test_markers')).rows[0].count,'0');
});

test('expiry during the eligibility wait prevents the protected callback from starting',async()=>{
 const grant=await store.approve(ownerSession.token,ownerSession.csrfToken,approval({expiresAt:new Date(Date.now()+800).toISOString()}));
 const blocker=await admin.connect();await blocker.query('BEGIN');
 await blocker.query(`SELECT account_id FROM ${schema}.platform_permissions WHERE account_id=$1 FOR UPDATE`,[platform]);
 let started=false;
 try{
  const attempt=store.authorize(authorization(grant.id),async()=>{started=true;return 'late';});
  await waitFor('SELECT a.id FROM cloud_accounts a JOIN platform_permissions%');await delay(900);await blocker.query('COMMIT');
  await expectCode(attempt,'grant_expired');
 }finally{await blocker.query('ROLLBACK').catch(()=>{});blocker.release();}
 assert.equal(started,false);
});

test('an audit conflict wait past expiry rolls back protected work',async()=>{
 const grant=await store.approve(ownerSession.token,ownerSession.csrfToken,approval({expiresAt:new Date(Date.now()+800).toISOString()}));
 const operationId=randomUUID(),sourceId=supportAccessAuditSourceId(authorization(grant.id,{operationId}));
 const blocker=await admin.connect();await blocker.query('BEGIN');
 await blocker.query(`INSERT INTO ${schema}.security_audit_events
  (organisation_id,venue_id,event_type,actor_kind,actor_id,subject_kind,subject_id,source_id)
  VALUES($1,$2,'support.accessed','platform_account',$3,'support_grant',$4,$5)`,[organisation,venue,platform,grant.id,sourceId]);
 try{
  const attempt=store.authorize(authorization(grant.id,{operationId}),marker(operationId));
  await waitFor('INSERT INTO security_audit_events%');await delay(900);await blocker.query('COMMIT');
  await expectCode(attempt,'grant_expired');
 }finally{await blocker.query('ROLLBACK').catch(()=>{});blocker.release();}
 assert.equal((await pool.query('SELECT count(*) FROM support_test_markers')).rows[0].count,'0');
 assert.equal((await pool.query("SELECT count(*) FROM security_audit_events WHERE event_type='support.accessed'")).rows[0].count,'1');
});

test('an access audit conflict uses the support-grant error contract and rolls back protected work',async()=>{
 const grant=await store.approve(ownerSession.token,ownerSession.csrfToken,approval()),operationId=randomUUID();
 const input=authorization(grant.id,{operationId}),sourceId=supportAccessAuditSourceId(input);
 await pool.query(`INSERT INTO security_audit_events
  (organisation_id,venue_id,event_type,actor_kind,actor_id,subject_kind,subject_id,source_id)
  VALUES($1,$2,'support.accessed','platform_account',$3,'support_grant',$4,$5)`,[organisation,venue,randomUUID(),grant.id,sourceId]);
 await expectCode(store.authorize(input,marker(operationId)),'grant_conflict');
 assert.equal((await pool.query('SELECT count(*) FROM support_test_markers')).rows[0].count,'0');
});
