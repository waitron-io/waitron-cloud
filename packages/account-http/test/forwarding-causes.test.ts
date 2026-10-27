import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {createSession} from '@waitron-cloud/identity';
import {transaction} from '@waitron-cloud/registration';
import {forwardFixture} from '../../remote-access/test/fixtures/forward-observations.ts';
import {createAccountApp} from '../src/app.ts';
import type {HttpBindings} from '@hono/node-server';
const origin='https://cloud.example.test';
async function fixture(planMode:'existing'|'test-free-paid'='test-free-paid'){
 const f=await forwardFixture();
 const session=await transaction(f.db.pool,c=>createSession(c,f.owner.accountId));
 const app=createAccountApp({pool:f.db.pool,outbox:f.db.outbox,planMode,config:{portalOrigin:origin,production:true,rateKey:f.db.rateKey,trustedProxyIps:[]}});
 const call=async(action='remote-access/status',body:unknown={installationId:f.installed.installationId},headers:Record<string,string>={})=>app.request(origin+'/api/account/'+action,{method:action==='installations'?'GET':'POST',headers:{origin,cookie:'__Host-cloud_session='+session.token,'x-csrf-token':session.csrfToken,'content-type':'application/json',...headers},...(action==='installations'?{}:{body:JSON.stringify(body)})},{incoming:{socket:{remoteAddress:'192.0.2.1'}}} as HttpBindings);
 return {...f,session,call};
}
test('owner status returns exactly the recorded outcome with no caching or session activity; apply does not export it',async()=>{
 const f=await fixture();try{
  const report=f.report();assert.equal(await f.send(report),'accepted');
  const before=(await f.db.pool.query('SELECT last_seen_at FROM cloud_sessions')).rows;
  const response=await f.call();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const result=await response.json();assert.deepEqual(result.publicForward,{category:'upstream_transport',observedAt:new Date(report.observations[0]!.observedAt).toISOString(),expiresAt:new Date(report.observations[0]!.expiresAt).toISOString()});
  assert.deepEqual(Object.keys(result).sort(),['installationId','names','publicForward','revision','revoked','service']);
  for(const value of [f.cellId,f.gatewayId,f.publicKey,report.observations[0]!.routeBinding,'10.77.','peerPublicKey','manifestSequence'])assert(!JSON.stringify(result).includes(value),value);
  assert.deepEqual((await f.db.pool.query('SELECT last_seen_at FROM cloud_sessions')).rows,before);
  await f.budget();assert.equal(await f.send(f.report(2,null)),'accepted');assert.equal((await (await f.call()).json()).publicForward.category,null);
  const applied=await f.call('remote-access/apply',{installationId:f.installed.installationId,kind:'public',hostname:f.manifest.routes[0]!.publicHostname,expectedRevision:'1'});
  assert.equal(applied.status,200);assert.equal(Object.hasOwn(await applied.json(),'publicForward'),false);
 }finally{await f.db.close();}
});
for(const change of ['missing','expiry','revision','hostname','revoked','reporter','downgrade','unconfigured','unplaced'] as const)test(`owner status erases ${change} evidence`,async()=>{
 const f=await fixture();try{
  await f.send();assert((await (await f.call()).json()).publicForward);
  if(change==='missing')await f.db.pool.query('TRUNCATE remote_forward_observations');
  if(change==='expiry'){const at=Date.now()-301000;await f.db.pool.query('UPDATE remote_forward_observations SET observed_at=$1,expires_at=$2,manifest_expires_at=$3',[new Date(at),new Date(at+300000),new Date(at+600000)]);}
  if(change==='revision')await f.db.pool.query('UPDATE installations SET configuration_revision=2');
  if(change==='hostname')await f.db.pool.query("UPDATE remote_hostnames SET hostname='changed.example.test' WHERE kind='public'");
  if(change==='revoked')await f.db.pool.query('UPDATE installations SET revoked_at=clock_timestamp()');
  if(change==='reporter')await f.db.pool.query('UPDATE remote_forward_reporters SET revoked_at=clock_timestamp()');
  if(change==='downgrade')await f.db.pool.query("UPDATE organisations SET service_plan='free'");
  if(change==='unconfigured')await f.db.pool.query("UPDATE installation_services SET state='unconfigured' WHERE service='remote_access'");
  if(change==='unplaced'){await f.db.pool.query('DELETE FROM remote_hostnames');await f.db.pool.query('DELETE FROM remote_placements');}
  const response=await f.call();assert.equal(response.status,200);assert.equal((await response.json()).publicForward,null);
 }finally{await f.db.close();}
});
test('status refuses foreign, nonowner, wrong origin, missing session and CSRF without a private result',async()=>{
 const f=await fixture();try{
  await f.send();
  for(const headers of [{origin:'https://foreign.test'},{cookie:''},{'x-csrf-token':'wrong'}] as Record<string,string>[]){const r=await f.call(undefined,undefined,headers);assert([401,403].includes(r.status));assert(!Object.hasOwn(await r.json(),'publicForward'));}
  assert.equal((await f.call(undefined,{installationId:randomUUID()})).status,403);
  await f.db.pool.query('UPDATE organisation_memberships SET is_owner=false');const r=await f.call();assert.equal(r.status,403);assert(!Object.hasOwn(await r.json(),'publicForward'));
 }finally{await f.db.close();}
});
test('status holds ownership while reading and refuses a membership revocation already in flight',async()=>{
 const f=await fixture(),blocker=await f.db.secondPool.connect();let pending:Promise<Response>|undefined;
 try{
  await f.send();await blocker.query('BEGIN');await blocker.query('UPDATE organisation_memberships SET is_owner=false');
  pending=f.call();await delay(75);await blocker.query('COMMIT');assert.equal((await pending).status,403);
 }finally{await blocker.query('ROLLBACK');blocker.release();await pending;await f.db.close();}
});
test('session expiry while the private observation read waits is refused by the final session check',async()=>{
 const f=await fixture(),blocker=await f.db.secondPool.connect();let pending:Promise<Response>|undefined;
 try{
  await f.send();await blocker.query('BEGIN');await blocker.query('SELECT * FROM remote_forward_reporters FOR UPDATE');
  await f.db.pool.query("UPDATE cloud_sessions SET absolute_expires_at=clock_timestamp()+interval '1 second'");pending=f.call();
  let reached=false;for(let i=0;i<200;i++){const r=await f.db.secondPool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE '%remote_forward_reporters%'",[f.db.schema]);if(r.rowCount){reached=true;break;}await delay(10);}assert(reached,'status reached the private read lock');
  await delay(1100);await blocker.query('COMMIT');assert.equal((await pending).status,401);
 }finally{await blocker.query('ROLLBACK');blocker.release();await pending;await f.db.close();}
});
test('diagnostic export and installation list omit private forwarding records',async()=>{
 const f=await fixture();try{
  await f.send();
  for(const [action,body] of [['diagnostics/read',{installationId:f.installed.installationId}],['installations',{}]] as const){const response=await f.call(action,body);assert.equal(response.status,200);const text=await response.text();for(const secret of ['publicForward','upstream_transport',f.gatewayId,f.publicKey,f.report().observations[0]!.routeBinding])assert(!text.includes(secret),secret);}
 }finally{await f.db.close();}
});

test('existing-plan status locks policy before installation so concurrent downgrade can finish',async()=>{
 const f=await fixture('existing'),blocker=await f.db.secondPool.connect();let pending:Promise<Response>|undefined;
 try{
  await f.send();await blocker.query('BEGIN');await blocker.query("SET LOCAL statement_timeout='3s'");await blocker.query("UPDATE organisations SET service_plan='free'");pending=f.call();
  let reached=false;for(let i=0;i<200;i++){const r=await f.db.secondPool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE '%organisations%'",[f.db.schema]);if(r.rowCount){reached=true;break;}await delay(10);}assert(reached,'status waits for policy before installation');
  await assert.doesNotReject(()=>blocker.query('SELECT id FROM installations FOR UPDATE'));
  await blocker.query('COMMIT');assert.equal((await pending).status,200);
 }finally{await blocker.query('ROLLBACK');blocker.release();await pending;await f.db.close();}
});
