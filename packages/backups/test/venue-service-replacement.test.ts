import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {BillingStore,type BillingLevel} from '@waitron-cloud/registration';
import {database} from '../../account-http/test/fixtures.ts';
import {event} from '../../registration/test/fixtures/venue-service.ts';
import {recoveryFixture,machineTarget,origin} from './fixtures/recovery-v2.ts';
import {BackupRecovery,streamRecoveryDigest} from '../src/recovery.ts';
import {RecoveryRequests} from '../src/recovery-request.ts';
import {ReplacementStore,replacementPayload} from '../src/replacement.ts';
import {ManagedStreams,type ManagedStreamAuthority} from '../src/managed-streams.ts';

async function fixture(source:'snapshot'|'continuous',initial:BillingLevel='connected'){
 const db=await database();
 try{
  const f=await recoveryFixture(db),venueId=f.installed.venueId,scope={organisationId:f.owner.organisationId,legalBusinessId:f.owner.legalBusinessId},billing=new BillingStore(db.pool);
  await billing.execute(scope,event(),{type:'ensure_business'});
  async function level(value:BillingLevel='connected'){
   const old=await billing.venue(scope,venueId);
   await billing.transition(scope,event(),{type:'set_venue',venueId,expectedRevision:old.revision,value:{level:value,connectedFrom:null,lapsedOn:null,scheduledLevel:null,scheduledOn:null}});
  }
  await level(initial);
  let nodeId=f.point.sourceNodeId;
  if(source==='continuous'){
   nodeId=randomUUID();const pointerKey=generateKeyPairSync('ed25519');
   const pointer={venueId,term:2,nodeId,generation:`gen-2-${nodeId}-20261030T090000Z`,writtenAt:'2026-10-30T09:00:00.000Z'};
   const message=`{"pointer":{"generation":"${pointer.generation}","nodeId":"${nodeId}","term":2,"venueId":"${venueId}","writtenAt":"${pointer.writtenAt}"},"purpose":"waitron.stream.pointer.v1"}`;
   const authority:ManagedStreamAuthority={
    async provision(){return {writerReference:'replacement-writer',readerReference:'replacement-reader',writerCredentials:{accessKeyId:'synthetic-writer',secretAccessKey:'synthetic-secret'}};},
    async read(){return Buffer.from(JSON.stringify({body:pointer,signature:sign(null,Buffer.from(message),pointerKey.privateKey).toString('base64')}));},
   };
   const streams=new ManagedStreams(db.pool,f.vault,authority,'test-venue-levels');
   const revision=Number((await db.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[f.installed.installationId])).rows[0].configuration_revision);
   const configured=await streams.configure(f.installed.installationId,revision,{localVenueId:venueId,sourceNodeId:nodeId,pointerSignerPublicKey:pointerKey.publicKey.export({type:'spki',format:'der'}).toString('base64')});
   await streams.observe(f.installed.installationId,configured.configurationRevision);
  }
  const target=machineTarget(),requests=new RecoveryRequests(db.pool,f.vault,origin,undefined,'test-venue-levels'),recovery=new BackupRecovery(db.pool,f.vault,origin,undefined,'test-venue-levels');
  const version=source==='snapshot'?2:1;
  await requests.machine('start',target.envelope('start','',Date.now(),origin,version));
  await requests.approve(target.id,target.code,f.session.token,f.session.csrfToken,source==='snapshot'?f.input:{source:'continuous',venueId,oldServerUnavailable:true,acceptDataLoss:true});
  const digest=source==='snapshot'?f.point.digest:streamRecoveryDigest(`gen-2-${nodeId}-20261030T090000Z`);
  await recovery.target(target.id,'restored',target.envelope('restored',digest,Date.now(),origin,version));
  const key=generateKeyPairSync('ed25519'),localVenueId=(await db.pool.query('SELECT local_venue_id FROM venues WHERE id=$1',[venueId])).rows[0].local_venue_id;
  const proposed={id:target.id,localVenueId,nodeId,publicKey:key.publicKey.export({type:'spki',format:'der'}).toString('base64url'),peerPublicKey:randomBytes(32).toString('base64')};
  function proof(action:'prepare'|'status',issuedAt=Date.now()){
   const bytes=replacementPayload(origin,action,proposed,issuedAt);
   return {id:target.id,payload:bytes.toString('base64url'),signature:target.sign(bytes),keySignature:sign(null,bytes,key.privateKey).toString('base64url')};
  }
  const store=new ReplacementStore(db.pool,f.vault,origin,'test-venue-levels');
  const confirmation={oldInstallationId:f.installed.installationId,oldServerUnavailable:true,confirmReplacement:true};
  async function state(){
   const value:Record<string,unknown>={};
   for(const table of ['installations','backup_locations','backup_key_versions','backup_points','backup_recoveries','backup_managed_streams','installation_replacements','security_audit_events'])value[table]=(await db.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
   return value;
  }
  return {...f,db,venueId,billing,scope,target,requests,recovery,proposed,proof,store,confirmation,level,state,close:()=>db.close()};
 }catch(error){await db.close();throw error;}
}

// Removing current admission must allow a forbidden activation without changing recovery history first.
for(const source of ['snapshot','continuous'] as const)test(`venue ${source} replacement refuses new proposals at level one without changing recovery`,async()=>{
 const f=await fixture(source);try{
  await f.level('registered');const before=await f.state();
  await assert.rejects(f.store.machine('prepare',f.proof('prepare')),{message:'backup.permission_denied'});
  assert.deepEqual(await f.state(),before);assert.equal(await f.store.inspect(f.target.id,f.session.token,f.session.csrfToken),null);
  assert.equal((await f.recovery.status(f.session.token,f.target.id)).status,'restored');
  assert.equal((await f.recovery.catalogue(f.session.token,f.venueId)).points[0]!.id,f.point.id);
 }finally{await f.close();}
});

for(const source of ['snapshot','continuous'] as const)test(`venue ${source} replacement downgrade blocks prepared activation and retains owner inspection`,async()=>{
 const f=await fixture(source);try{
  const proposal=await f.store.machine('prepare',f.proof('prepare'));await f.level('registered');const before=await f.state();
  await assert.rejects(f.store.complete(f.target.id,f.session.token,f.session.csrfToken,f.confirmation),{message:'backup.permission_denied'});
  for(const action of ['prepare','status'] as const)await assert.rejects(f.store.machine(action,f.proof(action)),{message:'backup.permission_denied'});
  assert.deepEqual(await f.store.inspect(f.target.id,f.session.token,f.session.csrfToken),proposal);assert.deepEqual(await f.state(),before);
  await f.recovery.close(f.session.token,f.session.csrfToken,f.target.id);assert.equal((await f.recovery.status(f.session.token,f.target.id)).status,'closed');
 }finally{await f.close();}
});

for(const source of ['snapshot','continuous'] as const)test(`venue ${source} completed replacement replay cannot bypass a downgrade`,async()=>{
 const f=await fixture(source);try{
  await f.store.machine('prepare',f.proof('prepare'));const result=await f.store.complete(f.target.id,f.session.token,f.session.csrfToken,f.confirmation);
  await f.level('registered');const before=await f.state();
  for(const action of ['prepare','status'] as const)await assert.rejects(f.store.machine(action,f.proof(action)),{message:'backup.permission_denied'});
  await assert.rejects(f.store.complete(f.target.id,f.session.token,f.session.csrfToken,f.confirmation),{message:'backup.permission_denied'});
  assert.deepEqual(await f.store.inspect(f.target.id,f.session.token,f.session.csrfToken),result);assert.deepEqual(await f.state(),before);
 }finally{await f.close();}
});

for(const source of ['snapshot','continuous'] as const)for(const level of ['connected','hosted'] as const)test(`venue ${source} replacement at ${level} keeps history and commits one fresh installation`,async()=>{
 const f=await fixture(source,level);try{
  const points=(await f.db.pool.query('SELECT * FROM backup_points ORDER BY id')).rows,objects=new Map(f.objects);
  await f.store.machine('prepare',f.proof('prepare'));
  const result=await f.store.complete(f.target.id,f.session.token,f.session.csrfToken,f.confirmation);
  assert.equal(result.state,'complete');assert.equal(result.registration.venueId,f.venueId);assert.notEqual(result.registration.installationId,f.installed.installationId);
  assert.deepEqual(await f.store.complete(f.target.id,f.session.token,f.session.csrfToken,f.confirmation),result);
  assert.deepEqual(await f.store.machine('status',f.proof('status')),result);
  const rows=(await f.db.pool.query('SELECT * FROM installations WHERE venue_id=$1',[f.venueId])).rows;
  assert.equal(rows.length,2);assert.equal(rows.filter(r=>r.superseded_by===null).length,1);
  const old=rows.find(r=>r.id===f.installed.installationId);assert(old.revoked_at);assert.equal(old.superseded_by,result.registration.installationId);
  assert.equal((await f.db.pool.query('SELECT active_key_version FROM backup_locations WHERE venue_id=$1',[f.venueId])).rows[0].active_key_version,2);
  assert.equal((await f.db.pool.query('SELECT count(*) FROM backup_key_versions WHERE venue_id=$1',[f.venueId])).rows[0].count,'2');
  assert.deepEqual((await f.db.pool.query('SELECT * FROM backup_points ORDER BY id')).rows,points);assert.deepEqual(f.objects,objects);
  assert.equal((await f.db.pool.query("SELECT count(*) FROM security_audit_events WHERE event_type='replacement.approved' AND source_id=$1",[f.target.id])).rows[0].count,'1');
  assert.equal((await f.db.pool.query('SELECT service_plan FROM organisations WHERE id=$1',[f.scope.organisationId])).rows[0].service_plan,'free');
  for(const secret of ['recoveryKey','credentials','synthetic-secret'])assert.equal(JSON.stringify(result).includes(secret),false);
 }finally{await f.close();}
});

test('venue replacement authenticates both proofs before level refusal and retains owner and binding checks',async()=>{
 const f=await fixture('snapshot');try{
  await f.level('registered');const proof=f.proof('prepare'),forged=machineTarget().sign(Buffer.from('forged'));
  await assert.rejects(f.store.machine('prepare',{...proof,signature:forged}),{message:'backup.invalid_proof'});
  await assert.rejects(f.store.machine('prepare',{...proof,keySignature:forged}),{message:'backup.invalid_proof'});
  await f.level();await f.store.machine('prepare',f.proof('prepare'));const before=await f.state();
  f.proposed.nodeId=randomUUID();await assert.rejects(f.store.machine('prepare',f.proof('prepare')),{message:'backup.conflict'});
  await assert.rejects(f.store.complete(f.target.id,f.session.token,f.session.csrfToken,{...f.confirmation,oldInstallationId:randomUUID()}),{message:'backup.conflict'});
  await assert.rejects(f.store.complete(f.target.id,f.session.token,f.session.csrfToken,{...f.confirmation,confirmReplacement:false}),{message:'backup.confirmation_required'});
  await f.db.pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',[f.owner.accountId]);
  await assert.rejects(f.store.complete(f.target.id,f.session.token,f.session.csrfToken,f.confirmation),{message:'backup.permission_denied'});
  assert.deepEqual(await f.state(),before);
 }finally{await f.close();}
});

// A clock advanced only after a real database lock wait isolates final proof expiry from initial authentication.
test('venue replacement rechecks proof expiry after waiting on venue authority',async(t)=>{
 const f=await fixture('snapshot'),holder=await f.db.pool.connect();let pending:Promise<unknown>|undefined,clock:ReturnType<typeof t.mock.method>|undefined;
 try{
  const before=await f.state(),now=Date.now(),proof=f.proof('prepare',now);
  await holder.query('BEGIN');await holder.query('SELECT id FROM venues WHERE id=$1 FOR NO KEY UPDATE',[f.venueId]);
  const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  pending=new ReplacementStore(f.db.secondPool,f.vault,origin,'test-venue-levels').machine('prepare',proof);void pending.catch(()=>{});
  let waiting=false;for(let i=0;i<300;i++){
   waiting=!!(await f.db.pool.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))',[f.db.schema,pid])).rowCount;
   if(waiting)break;await delay(10);
  }
  assert.equal(waiting,true,'replacement must wait on venue authority');
  await holder.query('SELECT id FROM installations WHERE id=$1 FOR UPDATE NOWAIT',[f.installed.installationId]);
  clock=t.mock.method(Date,'now',()=>now+61000);await holder.query('COMMIT');
  await assert.rejects(pending,{message:'backup.invalid_proof'});clock.mock.restore();clock=undefined;assert.deepEqual(await f.state(),before);
 }finally{clock?.mock.restore();await holder.query('ROLLBACK');await pending?.catch(()=>{});holder.release();await f.close();}
});

for(const deadline of ['recovery','session'] as const)test(`venue replacement rolls back activation when ${deadline} expires behind a storage lock`,async()=>{
 const f=await fixture('snapshot'),holder=await f.db.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  await f.store.machine('prepare',f.proof('prepare'));
  if(deadline==='recovery')await f.db.pool.query("UPDATE backup_recoveries SET expires_at=clock_timestamp()+interval '1 second' WHERE id=$1",[f.target.id]);
  else await f.db.pool.query("UPDATE cloud_sessions SET absolute_expires_at=clock_timestamp()+interval '1 second' WHERE account_id=$1",[f.owner.accountId]);
  const before=await f.state();await holder.query('BEGIN');await holder.query('SELECT venue_id FROM backup_locations WHERE venue_id=$1 FOR UPDATE',[f.venueId]);
  const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  pending=new ReplacementStore(f.db.secondPool,f.vault,origin,'test-venue-levels').complete(f.target.id,f.session.token,f.session.csrfToken,f.confirmation);
  const rejected=assert.rejects(pending,deadline==='recovery'?/backup.unavailable/:/session_expired/);void rejected.catch(()=>{});
  let waiting=false;for(let i=0;i<300;i++){
   waiting=!!(await f.db.pool.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))',[f.db.schema,pid])).rowCount;
   if(waiting)break;await delay(10);
  }
  assert.equal(waiting,true,'activation must reach its storage wait');await delay(1100);await holder.query('COMMIT');await rejected;
  assert.deepEqual(await f.state(),before);
 }finally{await holder.query('ROLLBACK');await pending?.catch(()=>{});holder.release();await f.close();}
});
