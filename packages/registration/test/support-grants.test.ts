import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {createSession,type SessionCredentials} from '@waitron-cloud/identity';
import {Pool} from 'pg';
import {migrate} from '../src/migrate.ts';
import {SupportGrantError,SupportGrantStore,type SupportGrantApproval} from '../src/support-grants.ts';
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

before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
beforeEach(async()=>{
 await pool.query('TRUNCATE organisations,cloud_accounts CASCADE');
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

test('a current owner can revoke early once without exposing the grant to another tenant',async()=>{
 const input=approval(),created=await store.approve(ownerSession.token,ownerSession.csrfToken,input);
 await expectCode(store.revoke(memberSession.token,memberSession.csrfToken,input.id),'grant_unavailable');
 const revoked=await store.revoke(secondOwnerSession.token,secondOwnerSession.csrfToken,input.id);
 assert.equal(revoked.revokedByAccountId,secondOwner);assert.ok(revoked.revokedAt);assert.equal(revoked.createdAt,created.createdAt);
 assert.deepEqual(await store.revoke(ownerSession.token,ownerSession.csrfToken,input.id),revoked);
 const audit=(await pool.query("SELECT actor_id,subject_id FROM security_audit_events WHERE event_type='support.revoked'")).rows;
 assert.deepEqual(audit,[{actor_id:secondOwner,subject_id:input.id}]);
});
