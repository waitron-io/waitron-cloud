import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {createLeaseIssuer,OrganisationPlanStore,type PlanMode} from '@waitron-cloud/registration';
import {RemoteAccessStore} from '@waitron-cloud/remote-access/placement';
import {connectedVenue,database} from '../../translation/test/fixtures.ts';
import {createAccountApp} from '../src/app.ts';
import {startAccountServer} from '../src/server.ts';
import {TunnelProvisionMachine} from '../src/tunnel-provision.ts';

const origin='https://cloud.example.test',path='/api/installations/tunnel-provision';
const peer=()=>randomBytes(32).toString('base64');
async function fixture(planMode:PlanMode='existing'){
 const db=await database();try{
  const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
  const v=await connectedVenue(db,issuer,origin),cellId=randomUUID(),key=peer(),store=new RemoteAccessStore(db.pool,planMode);
  if(planMode==='test-free-paid')await new OrganisationPlanStore(db.pool).set(v.organisationId,'paid');
  const cell={id:cellId,country:'ES',provider:'aws',environment:'test',suffix:'cell.example.test',subnet:17,publicKey:peer(),endpoint:'gateway.example.test:51820'};
  await store.createCell(cell);
  const options={pool:db.pool,outbox:db.outbox,leaseIssuer:issuer,planMode,
   config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]},tunnelProvision:{installationId:v.installationId,cellId}};
  const app=createAccountApp(options);
  const request=async(proof:unknown,target=app,headers:Record<string,string>={},method='POST')=>target.request(origin+path,{method,
   headers:{'content-type':'application/json',...headers},...(method==='GET'?{}:{body:JSON.stringify(proof)})},{incoming:{socket:{remoteAddress:'203.0.113.1'}}} as HttpBindings);
  const proof=(body:unknown={peerPublicKey:key},lease=v.lease,issuedAt=Date.now())=>v.proof('tunnel-provision',body,randomUUID(),lease,undefined,issuedAt);
  return {db,v,issuer,store,cell,cellId,key,options,app,request,proof,revision:planMode==='test-free-paid'?1:0,post:()=>request(proof())};
 }catch(error){await db.close();throw error;}
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function untouched(f:Fixture){
 assert.equal((await f.db.pool.query('SELECT count(*)::int AS n FROM remote_placements')).rows[0].n,0);
 assert.equal((await f.db.pool.query('SELECT count(*)::int AS n FROM remote_hostnames')).rows[0].n,0);
 assert.equal((await f.db.pool.query('SELECT next_address FROM remote_cells WHERE id=$1',[f.cellId])).rows[0].next_address,2);
 assert.equal((await f.db.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[f.v.installationId])).rows[0].configuration_revision,f.revision);
 assert.deepEqual((await f.db.pool.query("SELECT state,configuration FROM installation_services WHERE installation_id=$1 AND service='remote_access'",[f.v.installationId])).rows,[{state:'unconfigured',configuration:{}}]);
}
test('the configured box allocates once and concurrent fresh-proof retries return the existing three-service view',async()=>{
 const f=await fixture();try{
  const responses=await Promise.all([f.post(),f.post()]);for(const r of responses)assert.equal(r.status,200,await r.clone().text());
  const [a,b]=await Promise.all(responses.map(r=>r.json()));assert.deepEqual(a,b);assert.equal(a.revision,1);assert.equal(a.installationId,f.v.installationId);assert.equal(a.lease,undefined);
  assert.deepEqual(a.services.map((s:{service:string})=>s.service),['continuous_backup','remote_access','retained_snapshots']);
  const remote=a.services[1];assert.equal(remote.state,'provisioning');
  assert.deepEqual(remote.configuration,{version:1,installationId:f.v.installationId,venueId:f.v.venueId,cellId:f.cellId,
   address:'10.77.17.2',port:443,peerPublicKey:f.key,gatewayPublicKey:f.cell.publicKey,endpoint:'gateway.example.test:51820',
   staffHostname:`staff-v-${f.v.venueId}.cell.example.test`,publicHostname:`v-${f.v.venueId}.cell.example.test`});
  assert.equal((await f.db.pool.query('SELECT next_address FROM remote_cells WHERE id=$1',[f.cellId])).rows[0].next_address,3);
  assert.deepEqual(await f.store.provision(f.v.installationId,f.cellId,f.key),Object.fromEntries(Object.entries(remote.configuration).filter(([key])=>key!=='version')));
  const changed=await f.request(f.proof({peerPublicKey:peer()}));assert.equal(changed.status,409);assert.deepEqual(await changed.json(),{error:'placement_conflict'});
  assert.equal(responses[0]!.headers.get('cache-control'),'no-store');
 }finally{await f.db.close();}
});
test('disabled and browser requests refuse before parsing; incomplete options cannot start',async()=>{
 const f=await fixture();try{
  const disabled=await f.request({},createAccountApp({...f.options,tunnelProvision:undefined}));assert.equal(disabled.status,503);assert.equal(disabled.headers.get('retry-after'),'1');
  assert.equal((await f.request({},f.app,{origin})).status,403);assert.equal((await f.request({},f.app,{},'GET')).status,405);
  assert.throws(()=>createAccountApp({...f.options,leaseIssuer:undefined}),/tunnel_provision.installation_issuer_required/);
  for(const trial of [{installationId:f.v.installationId},{cellId:f.cellId},{installationId:'bad',cellId:f.cellId}])
   assert.throws(()=>createAccountApp({...f.options,tunnelProvision:trial as typeof f.options.tunnelProvision}),/invalid_tunnel_provision_configuration/);
  await untouched(f);
 }finally{await f.db.close();}
});
test('bad body, forged proof, foreign box and lease scope cannot allocate',async()=>{
 const f=await fixture();try{
  for(const body of [{peerPublicKey:'bad'},{peerPublicKey:[f.key]},{peerPublicKey:f.key,cellId:f.cellId},{}])assert.equal((await f.request(f.proof(body))).status,400);
  assert.equal((await f.request({...f.proof(),signature:'a'.repeat(86)})).status,401);
  assert.equal((await f.request(f.v.proof('configuration',{},randomUUID(),f.v.lease))).status,401);
  assert.equal((await f.request(f.v.proof('tunnel-provision',{peerPublicKey:f.key}))).status,401);
  const other=await connectedVenue(f.db,f.issuer,origin);
  assert.equal((await f.request(other.proof('tunnel-provision',{peerPublicKey:f.key},randomUUID(),other.lease))).status,403);
  assert.equal((await f.request(f.proof(undefined,other.lease))).status,401);
  assert.equal((await f.request({},f.app,{'content-type':'text/plain'})).status,415);
  assert.equal((await f.request({payload:'a'.repeat(17000),signature:'a'})).status,413);
  await untouched(f);
 }finally{await f.db.close();}
});
test('production, supersession, unavailable cells and full cells have explicit refusals',async()=>{
 const f=await fixture();try{
  await f.db.pool.query("UPDATE venues SET environment='production' WHERE id=$1",[f.v.venueId]);assert.equal((await f.post()).status,403);
  await f.db.pool.query("UPDATE venues SET environment='test' WHERE id=$1",[f.v.venueId]);
  const other=await connectedVenue(f.db,f.issuer,origin);
  await f.db.pool.query('UPDATE installations SET revoked_at=clock_timestamp(),superseded_by=$2 WHERE id=$1',[f.v.installationId,other.installationId]);assert.equal((await f.post()).status,403);
  await f.db.pool.query('UPDATE installations SET revoked_at=NULL,superseded_by=NULL WHERE id=$1',[f.v.installationId]);
  for(const cellId of [randomUUID(),f.cellId]){
   if(cellId===f.cellId)await f.db.pool.query('UPDATE remote_cells SET next_address=66 WHERE id=$1',[cellId]);
   const r=await f.request(f.proof(),createAccountApp({...f.options,tunnelProvision:{installationId:f.v.installationId,cellId}}));
   assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'temporarily_unavailable'});assert.equal(r.headers.get('retry-after'),'1');
  }
  assert.equal((await f.db.pool.query('SELECT count(*)::int AS n FROM remote_placements')).rows[0].n,0);
 }finally{await f.db.close();}
});
test('a peer already claimed by another installation returns conflict without consuming an address',async()=>{
 const f=await fixture();try{
  const other=await connectedVenue(f.db,f.issuer,origin);await f.store.provision(other.installationId,f.cellId,f.key);
  const r=await f.post();assert.equal(r.status,409);assert.deepEqual(await r.json(),{error:'placement_conflict'});
  assert.equal((await f.db.pool.query('SELECT next_address FROM remote_cells WHERE id=$1',[f.cellId])).rows[0].next_address,3);
  assert.equal((await f.db.pool.query('SELECT count(*)::int AS n FROM remote_placements WHERE installation_id=$1',[f.v.installationId])).rows[0].n,0);
 }finally{await f.db.close();}
});
test('invalid proofs share the installation-IP cap and disabled calls retain the all-IP cap',async()=>{
 const f=await fixture();try{
  const bad={...f.proof(),signature:'a'.repeat(86)};
  for(let i=0;i<60;i++)assert.equal((await f.request(bad)).status,401);
  assert.equal((await f.request(bad)).status,429);
  const disabled=createAccountApp({...f.options,tunnelProvision:undefined});
  for(let i=61;i<120;i++)assert.equal((await f.request({},disabled)).status,503);
  const r=await f.request({},disabled);assert.equal(r.status,429);assert.ok(Number(r.headers.get('retry-after'))>0);await untouched(f);
 }finally{await f.db.close();}
});
test('a same-key existing-mode reply preserves the configuration cleared by a real plan change',async()=>{
 const f=await fixture();try{
  assert.equal((await f.post()).status,200);
  const plans=new OrganisationPlanStore(f.db.pool);await plans.set(f.v.organisationId,'paid');await plans.set(f.v.organisationId,'free');
  const r=await f.post();assert.equal(r.status,200);const reply=await r.json();assert.equal(reply.revision,3);
  const remote=reply.services.find((s:{service:string})=>s.service==='remote_access');assert.equal(remote.state,'unconfigured');assert.deepEqual(remote.configuration,{});
  assert.equal((await f.db.pool.query('SELECT next_address FROM remote_cells WHERE id=$1',[f.cellId])).rows[0].next_address,3);
 }finally{await f.db.close();}
});
test('signed bodies and lease strings must keep their canonical JSON bytes',async()=>{
 const f=await fixture();try{
  const body={peerPublicKey:f.key};
  const noncanonical=f.v.proof('tunnel-provision',body,randomUUID(),f.v.lease,undefined,Date.now(),{lease:' '+JSON.stringify(f.v.lease)});
  assert.equal((await f.request(noncanonical)).status,401);
  const whitespace=f.v.proof('tunnel-provision',body,randomUUID(),f.v.lease,' '+JSON.stringify(body));
  assert.equal((await f.request(whitespace)).status,400);await untouched(f);
 }finally{await f.db.close();}
});
test('execution binds the signed installation even without preliminary HTTP authentication',async()=>{
 const f=await fixture();try{
  const machine=new TunnelProvisionMachine(f.db.pool,f.issuer,origin,f.options.tunnelProvision);
  const wrong=f.v.proof('tunnel-provision',{peerPublicKey:f.key},randomUUID(),f.v.lease,undefined,Date.now(),{installationId:randomUUID()});
  await assert.rejects(()=>machine.execute(wrong),{code:'invalid_proof'});await untouched(f);
 }finally{await f.db.close();}
});
async function blocked(f:Fixture,pid:number){
 const end=Date.now()+10000;while(Date.now()<end){
  if((await f.db.secondPool.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))',[f.db.schema,pid])).rowCount)return;
  await delay(10);
 }assert.fail('the signed provision never reached its controlled database lock');
}
for(const change of ['key','venue','environment','revoked'] as const)test(`an installation wait rejects changed ${change} without allocation`,async()=>{
 const f=await fixture(),holder=await f.db.secondPool.connect();let pending:Promise<Response>|undefined;
 try{
  const other=change==='venue'?await connectedVenue(f.db,f.issuer,origin):undefined;
  await holder.query('BEGIN');await holder.query('SELECT id FROM installations WHERE id=$1 FOR UPDATE',[f.v.installationId]);
  const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;pending=f.post();await blocked(f,pid);
  if(change==='key')await holder.query('UPDATE installations SET public_key=$2 WHERE id=$1',[f.v.installationId,generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url')]);
  if(change==='revoked')await holder.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[f.v.installationId]);
  if(change==='environment')await holder.query("UPDATE venues SET environment='production' WHERE id=$1",[f.v.venueId]);
  if(other){await holder.query('UPDATE installations SET revoked_at=clock_timestamp(),superseded_by=$2 WHERE id=$1',[other.installationId,f.v.installationId]);await holder.query('UPDATE installations SET venue_id=$2 WHERE id=$1',[f.v.installationId,other.venueId]);}
  await holder.query('COMMIT');const r=await pending;assert.equal(r.status,change==='key'?401:403,await r.clone().text());await untouched(f);
 }finally{await holder.query('ROLLBACK');holder.release();await pending?.catch(()=>{});await f.db.close();}
});
for(const change of ['environment','expiry','unchanged'] as const)test(`a peer-key wait checks ${change} at commit`,async()=>{
 const f=await fixture(),holder=await f.db.secondPool.connect();let pending:Promise<Response>|undefined;
 try{
  await holder.query('BEGIN');await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[f.key]);
  const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,now=Date.now(),expiresAt=now+1500;
  const lease=change==='expiry'?f.issuer.issue({origin,leaseId:randomUUID(),installationId:f.v.installationId,venueId:f.v.venueId,environment:'test',publicKey:f.v.installationKey,issuedAt:now,expiresAt}):f.v.lease;
  pending=f.request(f.proof(undefined,lease));await blocked(f,pid);
  if(change==='environment')await holder.query("UPDATE venues SET environment='production' WHERE id=$1",[f.v.venueId]);
  if(change==='expiry')await delay(Math.max(0,expiresAt-Date.now()+20));
  await holder.query('COMMIT');const r=await pending;assert.equal(r.status,change==='unchanged'?200:change==='expiry'?401:403,await r.clone().text());
  if(change!=='unchanged')await untouched(f);
 }finally{await holder.query('ROLLBACK');holder.release();await pending?.catch(()=>{});await f.db.close();}
});
test('same-key setup restoration rolls back when the proof expires during the cell wait',async()=>{
 const f=await fixture('test-free-paid'),holder=await f.db.secondPool.connect();let pending:Promise<Response>|undefined;
 try{
  assert.equal((await f.post()).status,200);await f.db.pool.query("UPDATE installation_services SET state='unconfigured',configuration='{}' WHERE installation_id=$1 AND service='remote_access'",[f.v.installationId]);
  await holder.query('BEGIN');await holder.query('SELECT id FROM remote_cells WHERE id=$1 FOR UPDATE',[f.cellId]);
  const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  pending=f.request(f.proof(undefined,undefined,Date.now()-58500));await blocked(f,pid);await delay(1600);await holder.query('COMMIT');
  assert.equal((await pending).status,401);
  assert.deepEqual((await f.db.pool.query("SELECT state,configuration FROM installation_services WHERE installation_id=$1 AND service='remote_access'",[f.v.installationId])).rows,[{state:'unconfigured',configuration:{}}]);
  assert.equal((await f.db.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[f.v.installationId])).rows[0].configuration_revision,f.revision+1);
 }finally{await holder.query('ROLLBACK');holder.release();await pending?.catch(()=>{});await f.db.close();}
});
test('the selected plan mode refuses a paid permission withdrawn during its policy wait',async()=>{
 const f=await fixture('test-free-paid'),holder=await f.db.secondPool.connect();let pending:Promise<Response>|undefined;
 try{
  await holder.query('BEGIN');await holder.query("UPDATE organisations SET service_plan='free' WHERE id=$1",[f.v.organisationId]);
  const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;pending=f.post();await blocked(f,pid);await holder.query('COMMIT');
  assert.equal((await pending).status,403);await untouched(f);
 }finally{await holder.query('ROLLBACK');holder.release();await pending?.catch(()=>{});await f.db.close();}
});
test('the native listener forwards the configured trial and shares the installation request limit',async()=>{
 const f=await fixture();let running:Awaited<ReturnType<typeof startAccountServer>>|undefined;
 try{
  running=await startAccountServer({...f.options,host:'127.0.0.1',port:0});const bound=running.server.address();assert.ok(bound&&typeof bound!=='string');
  const r=await new Promise<{status:number;body:string}>((resolve,reject)=>{
   const req=httpRequest({hostname:'127.0.0.1',port:bound.port,path,method:'POST',timeout:5000,headers:{host:'cloud.example.test','content-type':'application/json'}},res=>{
    let body='';res.on('data',part=>{body+=part;});res.once('error',reject);res.once('end',()=>resolve({status:res.statusCode!,body}));
   });req.once('error',reject);req.once('timeout',()=>req.destroy(new Error('tunnel listener timeout')));req.end(JSON.stringify(f.proof()));
  });assert.equal(r.status,200,r.body);
  for(let i=1;i<30;i++)assert.equal((await f.post()).status,200);
  const limited=await f.post();assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('retry-after'))>0);
 }finally{await running?.close();await f.db.close();}
});
