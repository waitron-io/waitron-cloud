import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {transaction} from '@waitron-cloud/registration';
import {venueServiceFixture,set} from '../../registration/test/fixtures/venue-service.ts';
import {RemoteAccessStore} from '../src/placement.ts';
import {eligibleRemoteInstallations} from '../src/plan-permissions.ts';
import {RemoteConfigurationReconciler} from '../src/reconciler.ts';

const mode='test-venue-levels' as const,peer=()=>randomBytes(32).toString('base64');
async function fixture(){
 const f=await venueServiceFixture();
 try{
  const ordinary=new RemoteAccessStore(f.pool),remote=new RemoteAccessStore(f.pool,mode),source=randomUUID(),target=randomUUID();
  for(const [id,subnet] of [[source,81],[target,82]] as const)await ordinary.createCell({id,country:'ES',provider:'aws',environment:'test',suffix:`boundary-${id}.example.test`,subnet,publicKey:peer(),endpoint:'gateway.example.test:51820'});
  const ids:string[]=[],peers:string[]=[];
  await set(f,'connected');
  for(const venueId of f.venues){const id=(await f.pool.query('SELECT id FROM installations WHERE venue_id=$1 AND revoked_at IS NULL',[venueId])).rows[0].id;ids.push(id);peers.push(peer());await ordinary.provision(id,source,peers.at(-1)!);}
  const revision=async(id=ids[0]!)=>Number((await f.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[id])).rows[0].configuration_revision);
  await ordinary.stageMove({operationId:randomUUID(),installationId:ids[0]!,targetCellId:target,targetPeerPublicKey:peer(),expectedRevision:await revision()});
  await f.pool.query("UPDATE organisations SET service_plan='paid' WHERE id=$1",[f.scope.organisationId]);
  return {...f,ordinary,remote,source,target,ids,peers,revision};
 }catch(error){await f.close();throw error;}
}
type Fixture=Awaited<ReturnType<typeof fixture>>;

// Legacy organisation payment must not override a venue that has entered the new authority path.
for(const reports of [false,true])test(`legacy remote batch excludes enrolled venues with reports ${reports}`,async()=>{
 const f=await fixture();try{
  const legacy=new RemoteAccessStore(f.pool,'test-free-paid');
  for(const cell of [f.source,f.target]){
   const manifest=reports?await legacy.reportingManifest(cell):await legacy.manifest(cell);
   assert.deepEqual(manifest.routes.map(r=>r.installationId),cell===f.source?[f.ids[1]]:[]);
  }
  assert.deepEqual(await transaction(f.pool,c=>eligibleRemoteInstallations(c,'test-free-paid',f.source)),[f.ids[1]]);
  const worker=new RemoteConfigurationReconciler(f.pool,{planMode:'test-free-paid',forwardReports:reports});await worker.schedule();
  const jobs=(await f.pool.query("SELECT target_id FROM remote_configuration_jobs WHERE kind<>'route' AND enabled ORDER BY target_id")).rows;
  assert.deepEqual(jobs.map(r=>r.target_id),[f.ids[1],f.ids[1]]);
  // Existing mode remains permissive for fixture and compatibility callers.
  assert.deepEqual((await f.ordinary.manifest(f.source)).routes.map(r=>r.installationId),f.ids);
 }finally{await f.close();}
});

async function waitForBlock(f:Fixture,pid:number,settled:()=>boolean){
 for(let n=0;n<300&&!settled();n++){
  if((await f.admin.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))',[f.schema,pid])).rowCount)return;
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 assert.fail('remote boundary must reach the real installation lock wait');
}

// The setup join must be refreshed after waiting, even when the installation row itself is unchanged.
for(const lock of ['SHARE','UPDATE'] as const)test(`venue remote ${lock} batch rereads setup after installation wait`,async()=>{
 const f=await fixture(),holder=await f.peer.connect();let pending:Promise<unknown>|undefined;
 try{
  await holder.query('BEGIN');await holder.query('SELECT id FROM installations WHERE id=$1 FOR UPDATE',[f.ids[0]]);
  const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;let settled=false;
  pending=transaction(f.pool,c=>eligibleRemoteInstallations(c,mode,f.source,{installationIds:[f.ids[0]!],lock})).finally(()=>{settled=true;});void pending.catch(()=>{});
  await waitForBlock(f,pid,()=>settled);
  await holder.query("UPDATE installation_services SET state='unconfigured',configuration='{}' WHERE installation_id=$1 AND service='remote_access'",[f.ids[0]]);
  await holder.query('COMMIT');assert.deepEqual(await pending,[]);
 }finally{await holder.query('ROLLBACK');await pending?.catch(()=>{});holder.release();await f.close();}
});

// DNS resolves outside the transaction, so neither a downgrade nor a later upgrade revives the old request.
for(const roundTrip of [false,true])test(`venue remote DNS wait rejects permission change with round trip ${roundTrip}`,async()=>{
 const f=await fixture();try{
  const before=await f.revision(),hostname=(await f.ordinary.manifest(f.source)).routes.find(r=>r.installationId===f.ids[0])!.staffHostname;let calls=0;
  await assert.rejects(f.remote.setHostname(f.ids[0]!,'staff','custom.example.test',before,async name=>{
   if(calls++===0){await set(f,'registered');if(roundTrip)await set(f,'connected');}
   return [name.startsWith('_acme-challenge.')?'_acme-challenge.'+hostname:hostname];
  }),/permission_denied/);
  assert.equal((await f.pool.query("SELECT hostname FROM remote_hostnames WHERE venue_id=$1 AND kind='staff'",[f.venues[0]])).rows[0].hostname,hostname);
  assert.equal((await f.pool.query('SELECT count(*) AS n FROM remote_hostname_changes')).rows[0].n,'0');
 }finally{await f.close();}
});

for(const reports of [false,true])for(const roundTrip of [false,true])test(`venue remote signing wait refuses old routes reports ${reports} round trip ${roundTrip}`,async()=>{
 const f=await fixture();try{
  const key=generateKeyPairSync('ed25519');let publications=0,signings=0;
  const worker=new RemoteConfigurationReconciler(f.pool,{planMode:mode,forwardReports:reports,async signingKeyForCell(){signings++;await set(f,'registered');if(roundTrip)await set(f,'connected');return key.privateKey;},artifacts:{async readCsr(){throw Error('unexpected certificate');},async readCertificate(){return undefined;},async publishCertificate(){throw Error('unexpected certificate');},async publishManifest(){publications++;}}});
  await worker.schedule();await f.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp()+interval '1 day'");
  await f.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp() WHERE kind='route' AND target_id=$1",[f.source]);
  assert.equal(await worker.runOnce(),true);assert.equal(signings,1);assert.equal(publications,0);
  const job=(await f.pool.query("SELECT applied_digest,status FROM remote_configuration_jobs WHERE kind='route' AND target_id=$1",[f.source])).rows[0];
  assert.equal(job.applied_digest,null);assert.equal(job.status,'pending');
 }finally{await f.close();}
});
