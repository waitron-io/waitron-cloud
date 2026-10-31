import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {transaction} from '@waitron-cloud/registration';
import {venueServiceFixture,set} from '../../registration/test/fixtures/venue-service.ts';
import {RemoteAccessStore} from '../src/placement.ts';
import {ForwardObservationStore,registerForwardReporter,revokeForwardReporter} from '../src/forward-observations.ts';
import {routeBinding,signForwardReport,type ForwardReport} from '../src/forward-report.ts';

const mode='test-venue-levels' as const,peer=()=>randomBytes(32).toString('base64');
async function fixture(){
 const f=await venueServiceFixture();
 try{
  const remote=new RemoteAccessStore(f.pool,mode),store=new ForwardObservationStore(f.pool,mode),cellId=randomUUID(),gatewayId=randomUUID(),keys=generateKeyPairSync('ed25519');
  await remote.createCell({id:cellId,country:'ES',provider:'aws',environment:'test',suffix:`reports-${cellId}.example.test`,subnet:86,publicKey:peer(),endpoint:'gateway.example.test:51820'});
  const ids:string[]=[];
  for(const venue of f.venues){
   await set(f,'connected',venue);
   const id=(await f.pool.query('SELECT id FROM installations WHERE venue_id=$1 AND revoked_at IS NULL',[venue])).rows[0].id;ids.push(id);
   await remote.provision(id,cellId,peer());
  }
  await transaction(f.pool,c=>registerForwardReporter(c,{cellId,gatewayId,generation:1,publicKey:keys.publicKey.export({type:'spki',format:'pem'}).toString()}));
  await remote.reportingManifest(cellId);
  const manifest=await remote.reportingManifest(cellId),mapping={country:'ES' as const,environment:'test' as const,cellId,file:'/country/forward/report.json',writerUid:0,readerGid:1000};
  assert.equal(manifest.version,2);if(manifest.version!==2)throw Error('reporting fixture requires v2');
  const routes=manifest.routes;
  function report():ForwardReport{
   const now=Date.now();
   return {version:1,audience:'waitron-cloud-public-forward-report',cellId,gatewayId,generation:1,sequence:1,issuedAt:now,observations:routes.map(route=>({cellId,gatewayId,generation:1,installationId:route.installationId,venueId:route.venueId,revision:route.revision,routeId:'public_availability',routeBinding:routeBinding(route),manifestSequence:manifest.sequence,manifestExpiresAt:manifest.expiresAt,observationSequence:1,category:'upstream_transport',observedAt:now,expiresAt:Math.min(now+300000,manifest.expiresAt)}))};
  }
  const read=(id=ids[0]!)=>transaction(f.pool,c=>store.readCurrent(c,id));
  const observations=()=>f.pool.query('SELECT * FROM remote_forward_observations ORDER BY venue_id').then(r=>r.rows);
  return {...f,remote,reports:store,cellId,gatewayId,keys,ids,manifest,mapping,report,read,observations};
 }catch(error){await f.close();throw error;}
}
type Fixture=Awaited<ReturnType<typeof fixture>>;

// A signed envelope cannot substitute for the mapped reporter or the current route.
for(const change of ['signature','unknown-key','country','environment','cell','generation','gateway','revoked','revision','venue','installation','binding','manifest-low','manifest-high'] as const)
test(`venue report authority rejects ${change} without changing observations`,async()=>{
 const f=await fixture();try{
  const valid=f.report();assert.equal(await f.reports.record(f.mapping,signForwardReport(valid,f.keys.privateKey)),'accepted');
  const before=await f.observations();assert.equal(before.length,2);assert.equal((await f.read())!.category,'upstream_transport');
  await f.pool.query("UPDATE remote_forward_reporters SET next_accept_at='-infinity' WHERE cell_id=$1",[f.cellId]);
  const value=f.report(),mapping={...f.mapping};value.sequence=2;value.observations=value.observations.filter(o=>o.installationId===f.ids[0]);
  for(const o of value.observations){o.observationSequence=2;o.category=null;}
  if(change==='country')Object.assign(mapping,{country:'FR'});
  if(change==='environment')Object.assign(mapping,{environment:'production'});
  if(change==='cell')mapping.cellId=randomUUID();
  if(change==='generation'){value.generation++;for(const o of value.observations)o.generation++;}
  if(change==='gateway'){value.gatewayId=randomUUID();for(const o of value.observations)o.gatewayId=value.gatewayId;}
  if(change==='revoked')await transaction(f.pool,c=>revokeForwardReporter(c,f.cellId,1));
  for(const o of value.observations){
   if(change==='revision')o.revision++;
   if(change==='venue')o.venueId=f.foreignVenue;
   if(change==='installation')o.installationId=randomUUID();
   if(change==='binding')o.routeBinding='0'.repeat(64);
   if(change==='manifest-low')o.manifestSequence=f.manifest.sequence-1;
   if(change==='manifest-high')o.manifestSequence=f.manifest.sequence+1;
  }
  if(change==='manifest-low')await f.pool.query('UPDATE remote_forward_reporters SET minimum_manifest_sequence=$2 WHERE cell_id=$1',[f.cellId,f.manifest.sequence]);
  let envelope=signForwardReport(value,change==='unknown-key'?generateKeyPairSync('ed25519').privateKey:f.keys.privateKey);
  if(change==='signature')envelope={...envelope,signature:randomBytes(64).toString('base64url')};
  await f.reports.record(mapping,envelope);
  assert.deepEqual(await f.observations(),before,'invalid authority must not replace a previously accepted cause');
  if(change==='revoked')assert.equal(await f.read(),null);
  else assert.equal((await f.read())!.category,'upstream_transport');
 }finally{await f.close();}
});

test('venue report authority accepts only the still eligible sibling in one signed batch',async()=>{
 const f=await fixture();try{
  const value=f.report();await set(f,'registered',f.venues[1]);
  await f.pool.query("UPDATE installation_services SET state='ready' WHERE installation_id=$1 AND service='remote_access'",[f.ids[1]]);
  value.observations.find(o=>o.installationId===f.ids[1])!.revision=Number((await f.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[f.ids[1]])).rows[0].configuration_revision);
  assert.equal(await f.reports.record(f.mapping,signForwardReport(value,f.keys.privateKey)),'accepted');
  assert.deepEqual((await f.observations()).map(r=>r.installation_id),[f.ids[0]]);
  assert.equal((await f.read())!.category,'upstream_transport');assert.equal(await f.read(f.ids[1]),null);
 }finally{await f.close();}
});

async function waitForReporter(f:Fixture,pid:number,settled:()=>boolean){
 for(let n=0;n<300&&!settled();n++){
  if((await f.admin.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))',[f.schema,pid])).rowCount)return;
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 assert.fail('report admission must reach its real reporter lock wait');
}

// Preliminary verification must never outlive reporter rotation or revocation.
for(const change of ['rotation','revocation'] as const)test(`venue report authority rechecks ${change} after reporter wait`,async()=>{
 const f=await fixture(),holder=await f.peer.connect();let pending:Promise<unknown>|undefined;
 try{
  const value=f.report(),envelope=signForwardReport(value,f.keys.privateKey);
  await holder.query('BEGIN');await holder.query('SELECT cell_id FROM remote_forward_reporters WHERE cell_id=$1 FOR UPDATE',[f.cellId]);
  const pid=Number((await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);let settled=false;
  pending=f.reports.record(f.mapping,envelope).finally(()=>{settled=true;});void pending.catch(()=>{});await waitForReporter(f,pid,()=>settled);
  if(change==='revocation')await holder.query('UPDATE remote_forward_reporters SET revoked_at=clock_timestamp() WHERE cell_id=$1',[f.cellId]);
  else{
   const key=generateKeyPairSync('ed25519');
   await holder.query('UPDATE remote_forward_reporters SET public_key=$2,generation=2,gateway_id=$3 WHERE cell_id=$1',[f.cellId,key.publicKey.export({type:'spki',format:'pem'}).toString(),randomUUID()]);
  }
  await holder.query('COMMIT');assert.equal(await pending,'ignored');assert.deepEqual(await f.observations(),[]);
  assert.equal((await f.pool.query('SELECT last_sequence FROM remote_forward_reporters WHERE cell_id=$1',[f.cellId])).rows[0].last_sequence,'0');
 }finally{await holder.query('ROLLBACK');await pending?.catch(()=>{});holder.release();await f.close();}
});

// Pruning is cleanup; both reads and fresh writes must reject a stale route first.
for(const change of ['revision','reporter','generation','cell','revocation'] as const)test(`venue report authority hides stale ${change} before pruning`,async()=>{
 const f=await fixture();try{
  assert.equal(await f.reports.record(f.mapping,signForwardReport(f.report(),f.keys.privateKey)),'accepted');const before=await f.observations();
  if(change==='revision')await f.pool.query('UPDATE installations SET configuration_revision=configuration_revision+1 WHERE id=$1',[f.ids[0]]);
  if(change==='reporter')await transaction(f.pool,c=>revokeForwardReporter(c,f.cellId,1));
  if(change==='generation')await f.pool.query('UPDATE remote_forward_reporters SET generation=generation+1 WHERE cell_id=$1',[f.cellId]);
  if(change==='cell')await f.pool.query("UPDATE remote_cells SET environment='production' WHERE id=$1",[f.cellId]);
  if(change==='revocation')await f.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[f.ids[0]]);
  assert.equal(await f.read(),null);assert.deepEqual(await f.observations(),before,'a read must not depend on pruning stale evidence');
 }finally{await f.close();}
});
