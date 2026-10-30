import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {transaction} from '@waitron-cloud/registration';
import {venueServiceFixture,set} from '../../registration/test/fixtures/venue-service.ts';
import {RemoteAccessStore} from '../src/placement.ts';
import {eligibleRemoteInstallations} from '../src/plan-permissions.ts';
import {RemoteConfigurationReconciler} from '../src/reconciler.ts';
import {ForwardObservationStore,registerForwardReporter} from '../src/forward-observations.ts';
import {routeBinding,signForwardReport,type ForwardReport} from '../src/forward-report.ts';
import {verifyManifest} from '../src/manifest.ts';
import {GatewayAuthority} from '../src/authority.ts';

const mode='test-venue-levels' as const,peer=()=>randomBytes(32).toString('base64');
async function fixture(){
 const f=await venueServiceFixture();
 try{
  const ordinary=new RemoteAccessStore(f.pool),remote=new RemoteAccessStore(f.pool,mode),source=randomUUID(),target=randomUUID(),empty=randomUUID();
  for(const [id,subnet] of [[source,71],[target,72],[empty,73]] as const)await ordinary.createCell({id,country:'ES',provider:'aws',environment:'test',suffix:`cell-${id}.example.test`,subnet,publicKey:peer(),endpoint:'gateway.example.test:51820'});
  const ids:string[]=[],peers:string[]=[];
  for(const venueId of f.venues){
   const id=(await f.pool.query('SELECT id FROM installations WHERE venue_id=$1 AND revoked_at IS NULL',[venueId])).rows[0].id;ids.push(id);peers.push(peer());
   await set(f,'connected',venueId);await ordinary.provision(id,source,peers.at(-1)!);
  }
  const revision=async(id=ids[0]!)=>Number((await f.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[id])).rows[0].configuration_revision);
  const move=await ordinary.stageMove({operationId:randomUUID(),installationId:ids[0]!,targetCellId:target,targetPeerPublicKey:peer(),expectedRevision:await revision()});
  const keys=generateKeyPairSync('ed25519'),gatewayId=randomUUID();
  await transaction(f.pool,c=>registerForwardReporter(c,{cellId:source,gatewayId,generation:1,publicKey:keys.publicKey.export({type:'spki',format:'pem'}).toString()}));
  return {...f,ordinary,remote,source,target,empty,ids,peers,move,keys,gatewayId,revision};
 }catch(error){await f.close();throw error;}
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function disableSibling(f:Fixture){await set(f,'registered',f.venues[1]);}
async function certificateJobs(f:Fixture,id:string){return Number((await f.pool.query("SELECT count(*) AS n FROM remote_configuration_jobs WHERE target_id=$1 AND kind<>'route' AND enabled",[id])).rows[0].n);}
async function due(f:Fixture,worker:RemoteConfigurationReconciler,cellId=f.source){
 await worker.schedule();await f.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp()+interval '1 day'");
 await f.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp() WHERE kind='route' AND target_id=$1",[cellId]);
}

// An organisation-wide paid filter drops A when the organisation is free and admits B when it is paid.
for(const forwardReports of [false,true])test(`venue remote routes isolate same organisation siblings with reports ${forwardReports}`,async()=>{
 const f=await fixture();try{
  await disableSibling(f);
  const manifest=(cell:string)=>forwardReports?f.remote.reportingManifest(cell):f.remote.manifest(cell);
  for(const legacy of ['free','paid']){
   await f.pool.query('UPDATE organisations SET service_plan=$2 WHERE id=$1',[f.scope.organisationId,legacy]);
   assert.deepEqual((await manifest(f.source)).routes.map(r=>r.installationId),[f.ids[0]]);
   assert.deepEqual((await manifest(f.target)).routes.map(r=>r.installationId),[f.ids[0]]);
   assert.deepEqual((await manifest(f.empty)).routes,[]);
   const worker=new RemoteConfigurationReconciler(f.pool,{planMode:mode,forwardReports});await worker.schedule();
   assert.equal(await certificateJobs(f,f.ids[0]!),2);assert.equal(await certificateJobs(f,f.ids[1]!),0);
  }
  const before=await f.revision();await set(f,'registered');
  assert.deepEqual((await manifest(f.source)).routes,[]);assert.deepEqual((await manifest(f.target)).routes,[]);
  const worker=new RemoteConfigurationReconciler(f.pool,{planMode:mode,forwardReports});await worker.schedule();assert.equal(await certificateJobs(f,f.ids[0]!),0);
  await assert.rejects(f.remote.markMoveReady(f.move.operationId,before,1),/permission_denied/);
  await assert.rejects(f.remote.completeMove(f.move.operationId,before),/permission_denied/);
  assert.equal((await f.remote.cancelMove(f.move.operationId,before)).state,'cancelled');
  await set(f,'connected');assert.deepEqual((await manifest(f.source)).routes,[]);await worker.schedule();assert.equal(await certificateJobs(f,f.ids[0]!),0);
  const revision=await f.revision();await f.remote.provision(f.ids[0]!,f.source,f.peers[0]!);
  assert.equal(await f.revision(),revision+1);assert.deepEqual((await manifest(f.source)).routes.map(r=>r.installationId),[f.ids[0]]);
  await f.remote.provision(f.ids[0]!,f.source,f.peers[0]!);assert.equal(await f.revision(),revision+1);
 }finally{await f.close();}
});

test('venue remote eligibility retains the undefined legacy sentinel and exact empty new-mode set',async()=>{
 const f=await fixture();try{
  assert.equal(await transaction(f.pool,c=>eligibleRemoteInstallations(c,'existing',f.source)),undefined);
  await disableSibling(f);assert.deepEqual(await transaction(f.pool,c=>eligibleRemoteInstallations(c,mode,f.source)),[f.ids[0]]);
  assert.deepEqual(await transaction(f.pool,c=>eligibleRemoteInstallations(c,mode,f.target)),[f.ids[0]]);
  await set(f,'registered');assert.deepEqual(await transaction(f.pool,c=>eligibleRemoteInstallations(c,mode,f.source)),[]);
 }finally{await f.close();}
});

for(const action of ['provision','stage','dns','hostname','certificate'] as const)test(`venue remote ${action} refuses level one before external work`,async()=>{
 const f=await fixture();try{
  await set(f,'registered');const before=await f.revision();let resolved=0;
  const run=()=>action==='provision'?f.remote.provision(f.ids[0]!,f.source,f.peers[0]!):action==='stage'?f.remote.stageMove({operationId:randomUUID(),installationId:f.ids[0]!,targetCellId:f.empty,targetPeerPublicKey:peer(),expectedRevision:before}):action==='dns'?f.remote.hostnameInstructions(f.ids[0]!,'staff','custom.example.test'):action==='certificate'?f.remote.authorizeCertificate(f.ids[0]!,'staff','unused CSR'):f.remote.setHostname(f.ids[0]!,'staff','custom.example.test',before,async()=>{resolved++;return [];});
  await assert.rejects(run,/permission_denied/);assert.equal(resolved,0);assert.equal(await f.revision(),before);
 }finally{await f.close();}
});

// Both the scheduler and completion must use the current venue set, including the incoming target cell.
for(const forwardReports of [false,true])test(`venue remote reconciler publishes the exact active and staged set with reports ${forwardReports}`,async()=>{
 const f=await fixture();try{
  await disableSibling(f);const key=generateKeyPairSync('ed25519'),published=new Map<string,string>();
  const worker=new RemoteConfigurationReconciler(f.pool,{planMode:mode,forwardReports,signingKeyForCell:async()=>key.privateKey,artifacts:{async readCsr(){throw Error('unexpected certificate');},async readCertificate(){return undefined;},async publishCertificate(){throw Error('unexpected certificate');},async publishManifest(id,envelope){published.set(id,envelope);}}});
  for(const id of [f.source,f.target,f.empty]){
   await due(f,worker,id);assert.equal(await worker.runOnce(),true);assert(published.has(id));
   const manifest=verifyManifest(JSON.parse(published.get(id)!),key.publicKey,id);
   assert.deepEqual(manifest.routes.map(r=>r.installationId),id===f.empty?[]:[f.ids[0]]);assert.equal(manifest.expiresAt-manifest.issuedAt,600000);
  }
  await set(f,'registered');await due(f,worker);await worker.runOnce();assert.deepEqual(verifyManifest(JSON.parse(published.get(f.source)!),key.publicKey,f.source).routes,[]);
  assert.equal(await certificateJobs(f,f.ids[0]!),0);
 }finally{await f.close();}
});

// Checking only the legacy SQL policy, or trusting stored reports after a permission change, leaks status.
test('venue remote forward observations follow current venue authority before the scheduler catches up',async()=>{
 const f=await fixture();try{
  await disableSibling(f);const store=new ForwardObservationStore(f.pool,mode),manifest=await f.remote.reportingManifest(f.source);assert.equal(manifest.version,2);
  const route=manifest.routes[0]!,now=Date.now();
  const report:ForwardReport={version:1,audience:'waitron-cloud-public-forward-report',cellId:f.source,gatewayId:f.gatewayId,generation:1,sequence:1,issuedAt:now,observations:[{cellId:f.source,gatewayId:f.gatewayId,generation:1,installationId:f.ids[0]!,venueId:f.venues[0]!,revision:await f.revision(),routeId:'public_availability',routeBinding:routeBinding(route),manifestSequence:manifest.sequence,manifestExpiresAt:manifest.expiresAt,observationSequence:1,category:'upstream_transport',observedAt:now,expiresAt:Math.min(now+300000,manifest.expiresAt)}]};
  const mapping={country:'ES' as const,environment:'test' as const,cellId:f.source,file:'/country/forward/report.json',writerUid:0,readerGid:1000};
  assert.equal(await store.record(mapping,signForwardReport(report,f.keys.privateKey)),'accepted');
  const read=()=>transaction(f.pool,c=>store.readCurrent(c,f.ids[0]!));assert.equal((await read())!.category,'upstream_transport');
  await set(f,'registered');assert.equal(await read(),null);await set(f,'connected');assert.equal(await read(),null);
  await f.pool.query("UPDATE remote_forward_reporters SET next_accept_at='-infinity' WHERE cell_id=$1",[f.source]);
  report.sequence++;report.observations[0]!.observationSequence++;assert.equal(await store.record(mapping,signForwardReport(report,f.keys.privateKey)),'accepted');
  assert.equal(await read(),null);assert.equal(await store.prune(f.source),1);
 }finally{await f.close();}
});

test('venue remote gateway restart retains the signed ten-minute withdrawal bound',async()=>{
 const f=await fixture();try{
  await disableSibling(f);const key=generateKeyPairSync('ed25519'),now=Date.now(),manifest=await f.remote.manifest(f.source,now);assert.deepEqual(manifest.routes.map(r=>r.installationId),[f.ids[0]]);
  const {signManifest}=await import('../src/manifest.ts');let time=now,closed=0,saved:unknown;
  const hooks={async persist(value:unknown){saved=value;},async apply(routes:unknown[]){assert.equal(routes.length,1);},async close(){closed++;}};
  const gateway=new GatewayAuthority(key.publicKey,f.source,hooks,()=>time);await gateway.accept(signManifest(manifest,key.privateKey,now));await set(f,'registered');
  assert.equal(manifest.expiresAt-now,600000);const restarted=new GatewayAuthority(key.publicKey,f.source,hooks,()=>time);await restarted.restore(saved);time=now+600000;await restarted.tick();assert.deepEqual(restarted.routes,[]);assert.equal(closed,1);
 }finally{await f.close();}
});

// Retained setup is never a substitute for current permission, even for a trusted reporter.
test('venue remote stale configured level-one routes and fresh reports remain denied',async()=>{
 const f=await fixture();try{
  await disableSibling(f);await set(f,'registered');
  await f.pool.query("UPDATE installation_services SET state='ready' WHERE installation_id=$1 AND service='remote_access'",[f.ids[0]]);
  await f.pool.query("UPDATE organisations SET service_plan='paid' WHERE id=$1",[f.scope.organisationId]);
  assert.deepEqual((await f.remote.manifest(f.source)).routes,[]);
  assert.deepEqual((await f.remote.reportingManifest(f.source)).routes,[]);
  const legacy=await f.ordinary.reportingManifest(f.source),route=legacy.routes.find(r=>r.installationId===f.ids[0])!,now=Date.now();assert(route);
  const store=new ForwardObservationStore(f.pool,mode),report:ForwardReport={version:1,audience:'waitron-cloud-public-forward-report',cellId:f.source,gatewayId:f.gatewayId,generation:1,sequence:1,issuedAt:now,observations:[{cellId:f.source,gatewayId:f.gatewayId,generation:1,installationId:f.ids[0]!,venueId:f.venues[0]!,revision:await f.revision(),routeId:'public_availability',routeBinding:routeBinding(route),manifestSequence:legacy.sequence,manifestExpiresAt:legacy.expiresAt,observationSequence:1,category:'upstream_transport',observedAt:now,expiresAt:Math.min(now+300000,legacy.expiresAt)}]};
  const mapping={country:'ES' as const,environment:'test' as const,cellId:f.source,file:'/country/forward/report.json',writerUid:0,readerGid:1000};
  assert.equal(await store.record(mapping,signForwardReport(report,f.keys.privateKey)),'accepted');
  assert.equal((await f.pool.query('SELECT count(*) AS n FROM remote_forward_observations')).rows[0].n,'0');
  // Seed a validly bound old view to exercise the independent read boundary too.
  await set(f,'connected');report.sequence++;report.observations[0]!.revision=await f.revision();report.observations[0]!.observationSequence++;
  await f.pool.query("UPDATE remote_forward_reporters SET next_accept_at='-infinity' WHERE cell_id=$1",[f.source]);
  assert.equal(await store.record(mapping,signForwardReport(report,f.keys.privateKey)),'accepted');
  assert.equal((await transaction(f.pool,c=>store.readCurrent(c,f.ids[0]!)))!.category,'upstream_transport');
  await set(f,'registered');await f.pool.query("UPDATE installation_services SET state='ready' WHERE installation_id=$1 AND service='remote_access'",[f.ids[0]]);
  await f.pool.query('UPDATE remote_forward_observations SET configuration_revision=$1 WHERE installation_id=$2',[await f.revision(),f.ids[0]]);
  assert.equal(await transaction(f.pool,c=>store.readCurrent(c,f.ids[0]!)),null);
 }finally{await f.close();}
});

async function waitForVenue(f:Fixture,pid:number,settled:()=>boolean){
 for(let n=0;n<300&&!settled();n++){
  if((await f.admin.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))',[f.schema,pid])).rowCount)return;
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 assert.fail('remote export must wait for the captured venue authority');
}

// Without the complete venue batch, expiry of A locks its installation before waiting on B.
test('venue remote batch locks every venue before expiring earlier setup',async()=>{
 const f=await fixture(),holder=await f.peer.connect(),observer=await f.peer.connect();let pending:Promise<unknown>|undefined;
 try{
  await f.pool.query('UPDATE billing_service_authority SET setup_grant_active=true,setup_grant_until=$1',[f.today]);
  await holder.query('BEGIN');await holder.query('SELECT id FROM venues WHERE id=$1 FOR NO KEY UPDATE',[f.venues[1]]);
  const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;let settled=false;
  pending=f.remote.manifest(f.source).finally(()=>{settled=true;});void pending.catch(()=>{});await waitForVenue(f,pid,()=>settled);
  await observer.query('BEGIN');await assert.doesNotReject(observer.query('SELECT id FROM installations WHERE venue_id=$1 FOR UPDATE NOWAIT',[f.venues[0]]),'batch policy wait must leave earlier installations unlocked');await observer.query('ROLLBACK');
  await holder.query('COMMIT');assert.deepEqual((await pending as {routes:unknown[]}).routes,[]);
 }finally{await observer.query('ROLLBACK');await holder.query('ROLLBACK');await pending?.catch(()=>{});observer.release();holder.release();await f.close();}
});

// Permission on B cannot authorise a captured installation whose original binding was A.
test('venue remote export rechecks original installation binding after a venue wait',async()=>{
 const f=await fixture(),holder=await f.peer.connect();let pending:Promise<unknown>|undefined;
 try{
  await holder.query('BEGIN');await holder.query('SELECT id FROM venues WHERE id=$1 FOR NO KEY UPDATE',[f.venues[1]]);
  const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;let settled=false;
  pending=f.remote.manifest(f.source).finally(()=>{settled=true;});void pending.catch(()=>{});await waitForVenue(f,pid,()=>settled);
  await holder.query('UPDATE installations SET superseded_by=$2 WHERE id=$1',[f.ids[1],f.ids[0]]);
  await holder.query('UPDATE installations SET venue_id=$2 WHERE id=$1',[f.ids[0],f.venues[1]]);
  await holder.query('COMMIT');assert.deepEqual((await pending as {routes:unknown[]}).routes,[]);
 }finally{await holder.query('ROLLBACK');await pending?.catch(()=>{});holder.release();await f.close();}
});
