import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import type {Pool,PoolClient} from 'pg';
import {EmailOutbox} from '@waitron-cloud/registration';
import {requireRemotePlan} from '../../remote-access/src/plan-permissions.ts';
import {createAccountApp} from '../src/app.ts';
import {AccountRateLimiter} from '../src/rate-limit.ts';

const id='20000000-0000-4000-8000-000000000001',origin='https://cloud.example.test',token='a'.repeat(43),csrf='b'.repeat(43);
type Condition='free'|'unconfigured'|'revoked'|'production'|'foreign'|'missing-venue'|'late-foreign';
// Only SQL is controlled here. Session checks, plan checks, store and HTTP serialization run normally.
function database(condition:Condition,loss?:'owner'|'session'){
 const queries:string[]=[],now=new Date();let ownershipReads=0,sessionReads=0;
 const client={on(){},removeListener(){},release(){},async query(sql:string){
  queries.push(sql);
  const result=(rows:unknown[])=>({rows,rowCount:rows.length});
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return result([]);
  if(sql==='SELECT account_id FROM cloud_sessions WHERE token_hash = $1')return result(loss==='session'&&++sessionReads>1?[]:[{account_id:id}]);
  if(sql.startsWith('SELECT id FROM cloud_accounts'))return result([{id}]);
  if(sql.startsWith('SELECT last_seen_at, absolute_expires_at, csrf_hash'))return result([{last_seen_at:now,absolute_expires_at:new Date(+now+3600000),csrf_hash:createHash('sha256').update(csrf).digest('hex')}]);
  if(sql==='SELECT clock_timestamp() AS now')return result([{now}]);
  if(sql.includes('organisation_memberships'))return result(condition==='foreign'||(condition==='late-foreign'||loss==='owner')&&++ownershipReads>1?[]:[{account_id:id}]);
  if(sql==='SELECT venue_id FROM installations WHERE id=$1')return result([{venue_id:id}]);
  if(sql==='SELECT organisation_id,environment FROM venues WHERE id=$1')return result(condition==='missing-venue'?[]:[{organisation_id:id,environment:condition==='production'?'production':'test'}]);
  if(sql.startsWith('SELECT id,service_plan,service_plan_revision FROM organisations'))return result([{id,service_plan:condition==='free'?'free':'paid',service_plan_revision:0}]);
  if(sql.startsWith('SELECT 1 FROM installation_services'))return result(condition==='unconfigured'?[]:[{}]);
  if(sql.startsWith('SELECT p.venue_id,c.suffix,i.revoked_at'))return result([{venue_id:id,suffix:'cell.example.test',revoked_at:condition==='revoked'?now:null}]);
  throw Error('Unexpected SQL: '+sql);
 }};
 return {queries,client:client as unknown as PoolClient,pool:{connect:async()=>client} as unknown as Pool};
}

for(const action of ['dns','apply'])for(const [condition,code] of [
 ['free','remote_plan_required'],['unconfigured','remote_setup_required'],['revoked','revoked'],
 ['production','remote_test_only'],['foreign','permission_denied'],['missing-venue','forbidden'],
] as const)test(`${action}: ${condition} stays refused and explains only a known cause`,async t=>{
 const db=database(condition);let resolves=0;
 t.mock.method(AccountRateLimiter.prototype,'consume',async()=>({allowed:true,retryAfterSeconds:0}));
 const app=createAccountApp({pool:db.pool,outbox:new EmailOutbox({activeKeyId:'test',keys:{test:'ab'.repeat(32)}}),
  config:{portalOrigin:origin,production:true,rateKey:'cd'.repeat(32),trustedProxyIps:[]},
  factor:{keys:null,policy:null},pairingCodeKeys:null,recoveryCodeKeys:null,planMode:'test-free-paid',
  remoteResolve:async()=>{resolves++;return [];}});
 const response=await app.request(origin+'/api/account/remote-access/'+action,{method:'POST',headers:{origin,'content-type':'application/json',cookie:'__Host-cloud_session='+token,'x-csrf-token':csrf},
  body:JSON.stringify({installationId:id,kind:'staff',hostname:'staff.cafe.example',...(action==='apply'?{expectedRevision:'1'}:{})})},
  {incoming:{socket:{remoteAddress:'192.0.2.10'}}});
 assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:code});
 assert.equal(response.headers.get('retry-after'),null);assert.deepEqual(response.headers.getSetCookie(),[]);
 assert.equal(resolves,0);assert.equal(db.queries.some(sql=>/^INSERT|^UPDATE|^DELETE/.test(sql)),false);
 if(condition==='foreign')assert.equal(db.queries.some(sql=>sql.includes('service_plan')),false,'foreign installations never reveal plan or setup');
});

for(const [condition,cause] of [['free','remote_plan_required'],['unconfigured','remote_setup_required'],['production','test_venue_required']] as const)
 test(`${condition}: shared callers still receive permission_denied`,async()=>{
  const db=database(condition);
  await assert.rejects(requireRemotePlan(db.client,id,'test-free-paid'),error=>{
   assert(error instanceof Error);assert.equal(error.message,'permission_denied');assert.equal(error.cause,cause);return true;
  });
 });

test('DNS instructions keep a late ownership refusal distinct from request verification',async t=>{
 const db=database('late-foreign');
 t.mock.method(AccountRateLimiter.prototype,'consume',async()=>({allowed:true,retryAfterSeconds:0}));
 const app=createAccountApp({pool:db.pool,outbox:new EmailOutbox({activeKeyId:'test',keys:{test:'ab'.repeat(32)}}),
  config:{portalOrigin:origin,production:true,rateKey:'cd'.repeat(32),trustedProxyIps:[]},
  factor:{keys:null,policy:null},pairingCodeKeys:null,recoveryCodeKeys:null,planMode:'test-free-paid'});
 const response=await app.request(origin+'/api/account/remote-access/dns',{method:'POST',headers:{origin,'content-type':'application/json',cookie:'__Host-cloud_session='+token,'x-csrf-token':csrf},body:JSON.stringify({installationId:id,kind:'staff',hostname:'staff.cafe.example'})},
  {incoming:{socket:{remoteAddress:'192.0.2.10'}}});
 assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:'permission_denied'});
 assert.equal(db.queries.filter(sql=>sql.includes('organisation_memberships')).length,2);
 assert.equal(db.queries.some(sql=>/^INSERT|^UPDATE|^DELETE/.test(sql)),false);
});

for(const condition of ['free','unconfigured','production','revoked'] as const)for(const loss of ['owner','session'] as const)for(const action of ['dns','apply'])
 test(`${action}: ${condition} detail stays private after late ${loss} loss`,async t=>{
  const db=database(condition,loss);
  t.mock.method(AccountRateLimiter.prototype,'consume',async()=>({allowed:true,retryAfterSeconds:0}));
  const app=createAccountApp({pool:db.pool,outbox:new EmailOutbox({activeKeyId:'test',keys:{test:'ab'.repeat(32)}}),
   config:{portalOrigin:origin,production:true,rateKey:'cd'.repeat(32),trustedProxyIps:[]},
   factor:{keys:null,policy:null},pairingCodeKeys:null,recoveryCodeKeys:null,planMode:'test-free-paid'});
  const response=await app.request(origin+'/api/account/remote-access/'+action,{method:'POST',headers:{origin,'content-type':'application/json',cookie:'__Host-cloud_session='+token,'x-csrf-token':csrf},
   body:JSON.stringify({installationId:id,kind:'staff',hostname:'staff.cafe.example',...(action==='apply'?{expectedRevision:'1'}:{})})},
   {incoming:{socket:{remoteAddress:'192.0.2.10'}}});
  assert.equal(response.status,loss==='owner'?403:401);assert.deepEqual(await response.json(),{error:loss==='owner'?'permission_denied':'unauthenticated'});
  assert.equal(db.queries.some(sql=>/^INSERT|^UPDATE|^DELETE/.test(sql)),false);
 });
