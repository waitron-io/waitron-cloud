import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {transaction} from '@waitron-cloud/registration';
import {venueServiceFixture,set} from '../../registration/test/fixtures/venue-service.ts';
import {BackupCatalogue,pointKeys,type PointMetadata} from '../src/catalogue.ts';
import {BackupKeyVault} from '../src/keys.ts';
import {receipt} from '../src/storage.ts';
import {verifyPointFixture,verificationOutput} from './fixtures/verification.ts';

const mode='test-venue-levels';
async function fixture(){
 const f=await venueServiceFixture();
 try{
  const installation=(await f.pool.query('SELECT id FROM installations WHERE venue_id=$1 AND superseded_by IS NULL',[f.venues[0]])).rows[0].id as string;
  const vault=new BackupKeyVault(randomBytes(32)),objects=new Map<string,Buffer>(),removed:string[]=[];
  let readWait:undefined|(()=>Promise<void>),removeWait:undefined|(()=>Promise<void>);
  const storage=()=>({async read(key:string){await readWait?.();const bytes=objects.get(key);if(!bytes)throw Error('NoSuchKey');return Buffer.from(bytes);},
   async put(key:string,bytes:Uint8Array){objects.set(key,Buffer.from(bytes));return receipt(bytes);},
   async remove(key:string){await removeWait?.();removed.push(key);objects.delete(key);}});
  const catalogue=new BackupCatalogue(f.pool,vault,storage,mode),location={endpoint:'https://storage.example.test',bucket:'venue-'+f.venues[0],region:'local'};
  return {...f,installation,vault,objects,removed,catalogue,location,
   blockRead(wait:()=>Promise<void>){readWait=wait;},blockRemove(wait:()=>Promise<void>){removeWait=wait;}};
 }catch(e){await f.close();throw e;}
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function revision(f:Fixture){return (await f.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[f.installation])).rows[0].configuration_revision as number;}
async function setup(f:Fixture){return (await f.pool.query("SELECT state,configuration FROM installation_services WHERE installation_id=$1 AND service='retained_snapshots'",[f.installation])).rows[0];}
async function state(f:Fixture){
 const result:Record<string,unknown>={};
 for(const table of ['backup_locations','backup_key_versions','backup_points','backup_captures'])result[table]=(await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
 return result;
}
async function provision(f:Fixture){await set(f);await f.catalogue.provision(f.installation,f.location);}
async function capture(f:Fixture,days=0){
 const reserved=await f.catalogue.reserveCapture(f.installation,randomUUID()),bytes=Buffer.from('synthetic encrypted archive '+reserved.id);
 f.objects.set(reserved.incomingKey,bytes);
 const metadata:PointMetadata={...receipt(bytes),capturedAt:new Date(Date.now()-days*86400000).toISOString(),retention:'daily',sourceNodeId:randomUUID(),modules:{core:1}};
 return {reserved,metadata,bytes};
}
async function snapshot(f:Fixture,days=0){const c=await capture(f,days),point=await f.catalogue.publish(f.installation,c.reserved.id,c.metadata);return {...c,point};}
function latch(){let release!:()=>void;const promise=new Promise<void>(r=>release=r);return {promise,release};}

// Losing the admission guard would create location/key rows for an unqualified venue.
test('venue snapshot admission refuses recorded levels without enrolment',async()=>{
 const f=await fixture();try{
  await set(f,'hosted',f.venues[0],false);
  await assert.rejects(f.catalogue.provision(f.installation,f.location),{message:'backup.permission_denied'});
  assert.deepEqual(await state(f),{backup_locations:[],backup_key_versions:[],backup_points:[],backup_captures:[]});
 }finally{await f.close();}
});
for(const level of ['connected','hosted'] as const)test(`venue ${level} snapshot admission is independent of its organisation plan`,async()=>{
 const f=await fixture();try{
  await set(f,level);await f.catalogue.provision(f.installation,f.location);
  const c=await capture(f),point=await f.catalogue.publish(f.installation,c.reserved.id,c.metadata);
  assert.equal(point.venueId,f.venues[0]);assert.deepEqual(f.objects.get(point.objectKey),c.bytes);
  assert.equal(await f.catalogue.rotate(f.installation),2);
  assert.equal((await f.pool.query('SELECT service_plan FROM organisations WHERE id=$1',[f.scope.organisationId])).rows[0].service_plan,'free');
  const sibling=(await f.pool.query('SELECT id FROM installations WHERE venue_id=$1 AND superseded_by IS NULL',[f.venues[1]])).rows[0].id;
  await assert.rejects(f.catalogue.provision(sibling,{...f.location,bucket:'sibling'}),{message:'backup.permission_denied'});
 }finally{await f.close();}
});
test('venue snapshot downgrade refuses new keys and captures without deleting old data',async()=>{
 const f=await fixture();try{
  await provision(f);const c=await capture(f),before=await state(f),bytes=new Map(f.objects);
  await set(f,'registered');
  for(const run of [()=>f.catalogue.provision(f.installation,f.location),()=>f.catalogue.rotate(f.installation),()=>f.catalogue.reserveCapture(f.installation,randomUUID()),()=>f.catalogue.publish(f.installation,c.reserved.id,c.metadata)])
   await assert.rejects(run(),{message:'backup.permission_denied'});
  assert.deepEqual(await state(f),before);assert.deepEqual(f.objects,bytes);assert.deepEqual(f.removed,[]);
 }finally{await f.close();}
});
test('venue snapshot explicit same location reprovision keeps keys and advances setup once',async()=>{
 const f=await fixture();try{
  await provision(f);const old=await snapshot(f),keys=await transaction(f.pool,c=>pointKeys(c,f.vault,f.venues[0]!,1));
  const before=await state(f);await set(f,'registered');await set(f);
  assert.deepEqual(await setup(f),{state:'unconfigured',configuration:{}});
  const rev=await revision(f);await f.catalogue.provision(f.installation,f.location);
  assert.deepEqual(await setup(f),{state:'provisioning',configuration:{version:1,provider:'local-s3',bucket:f.location.bucket}});
  assert.equal(await revision(f),rev+1);await f.catalogue.provision(f.installation,f.location);assert.equal(await revision(f),rev+1);
  assert.deepEqual(await state(f),before);assert.deepEqual(await transaction(f.pool,c=>pointKeys(c,f.vault,f.venues[0]!,1)),keys);assert.deepEqual(f.objects.get(old.point.objectKey),old.bytes);
  await assert.rejects(f.catalogue.provision(f.installation,{...f.location,bucket:'other'}),{message:'backup.conflict'});
 }finally{await f.close();}
});
test('venue level one pauses retained expiry but cleans only abandoned staging',async()=>{
 const f=await fixture();try{
  await provision(f);const old=await snapshot(f,90),last=await snapshot(f,80);assert.equal(await verifyPointFixture(f.pool,f.catalogue,last.point.id),'verified');
  const abandoned=await capture(f);f.objects.set('snapshots/'+abandoned.reserved.id,abandoned.bytes);
  await f.pool.query("UPDATE backup_captures SET created_at=clock_timestamp()-interval '2 days' WHERE id=$1",[abandoned.reserved.id]);
  const keys=(await f.pool.query('SELECT * FROM backup_key_versions ORDER BY venue_id,version')).rows;
  await set(f,'registered');assert.equal(await f.catalogue.cleanupOne(f.venues[0]!),null);
  assert.equal(await f.catalogue.cleanupCapture(f.venues[0]!),abandoned.reserved.id);
  assert.equal(await f.catalogue.cleanupCapture(f.venues[0]!),null);
  assert.deepEqual(f.removed,['incoming/'+old.point.id,'incoming/'+last.point.id,'incoming/'+abandoned.reserved.id,'snapshots/'+abandoned.reserved.id]);
  assert.deepEqual([...f.objects.keys()].sort(),[old.point.objectKey,last.point.objectKey].sort());
  assert.deepEqual((await f.pool.query('SELECT * FROM backup_key_versions ORDER BY venue_id,version')).rows,keys);
  assert.equal((await f.pool.query('SELECT count(*) FROM backup_points WHERE NOT deleting AND deleted_at IS NULL')).rows[0].count,'2');
  await set(f);assert.equal(await f.catalogue.cleanupOne(f.venues[0]!),old.point.id);assert.equal(await f.catalogue.cleanupOne(f.venues[0]!),null);
  assert.deepEqual(f.objects.get(last.point.objectKey),last.bytes);
 }finally{await f.close();}
});
test('venue snapshot schema failure never creates keys or storage state',async()=>{
 const f=await fixture();try{
  await f.pool.query('DROP TABLE billing_service_authority');
  await assert.rejects(f.catalogue.provision(f.installation,f.location),{code:'42P01'});
  assert.deepEqual(await state(f),{backup_locations:[],backup_key_versions:[],backup_points:[],backup_captures:[]});assert.equal(f.objects.size,0);
 }finally{await f.close();}
});
test('venue snapshot retention preserves a recovery hold across a downgrade',async()=>{
 const f=await fixture();try{
  await provision(f);const old=await snapshot(f,90),last=await snapshot(f,80);assert.equal(await verifyPointFixture(f.pool,f.catalogue,last.point.id),'verified');
  const account=randomUUID(),id=randomUUID();await f.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[account]);
  await f.pool.query("INSERT INTO backup_recoveries(id,venue_id,point_id,account_id,target_public_key,mode) VALUES($1,$2,$3,$4,$5,'failure')",[id,f.venues[0],old.point.id,account,randomUUID()]);
  const before=(await f.pool.query('SELECT * FROM backup_recoveries WHERE id=$1',[id])).rows;
  await set(f,'registered');assert.equal(await f.catalogue.cleanupOne(f.venues[0]!),null);assert.deepEqual((await f.pool.query('SELECT * FROM backup_recoveries WHERE id=$1',[id])).rows,before);
  await set(f);assert.equal(await f.catalogue.cleanupOne(f.venues[0]!),null);assert.deepEqual(f.objects.get(old.point.objectKey),old.bytes);
  await f.pool.query("UPDATE backup_recoveries SET status='closed' WHERE id=$1",[id]);assert.equal(await f.catalogue.cleanupOne(f.venues[0]!),old.point.id);assert.deepEqual(f.objects.get(last.point.objectKey),last.bytes);
 }finally{await f.close();}
});
test('venue snapshot policy wait leaves installation and location unlocked',async()=>{
 const f=await fixture(),holder=await f.pool.connect(),observer=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  await set(f);await holder.query('BEGIN');await holder.query('SELECT id FROM venues WHERE id=$1 FOR NO KEY UPDATE',[f.venues[0]]);
  const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;let settled=false;
  pending=new BackupCatalogue(f.peer,f.vault,()=>{throw Error('no object work expected');},mode).provision(f.installation,f.location).finally(()=>{settled=true;});void pending.catch(()=>{});
  let waiting=false;for(let i=0;i<300&&!settled;i++){
   waiting=!!(await f.admin.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))',[f.schema+'_peer',pid])).rowCount;
   if(waiting)break;await delay(10);
  }
  assert.equal(waiting,true,'snapshot admission must wait on venue policy');await observer.query('BEGIN');
  await assert.doesNotReject(observer.query('SELECT id FROM installations WHERE id=$1 FOR UPDATE NOWAIT',[f.installation]),'policy must precede installation locks');await observer.query('ROLLBACK');
  await holder.query('COMMIT');await pending;
 }finally{await observer.query('ROLLBACK');await holder.query('ROLLBACK');await pending?.catch(()=>{});observer.release();holder.release();await f.close();}
});
test('venue snapshot policy wait refuses a changed installation venue',async()=>{
 const f=await fixture(),holder=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  const changedVenue=randomUUID();await f.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$1,'test')",[changedVenue,f.scope.organisationId,f.scope.legalBusinessId]);
  await set(f);await holder.query('BEGIN');await holder.query('SELECT id FROM venues WHERE id=$1 FOR NO KEY UPDATE',[f.venues[0]]);
  const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;let settled=false;
  pending=new BackupCatalogue(f.peer,f.vault,()=>{throw Error('no object work expected');},mode).provision(f.installation,f.location).finally(()=>{settled=true;});void pending.catch(()=>{});
  let waiting=false;for(let i=0;i<300&&!settled;i++){
   waiting=!!(await f.admin.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))',[f.schema+'_peer',pid])).rowCount;
   if(waiting)break;await delay(10);
  }
  assert.equal(waiting,true,'snapshot admission must reach its original venue wait');
  await holder.query('UPDATE installations SET venue_id=$2 WHERE id=$1',[f.installation,changedVenue]);await holder.query('COMMIT');
  await assert.rejects(pending,{message:'backup.permission_denied'});
  assert.deepEqual(await state(f),{backup_locations:[],backup_key_versions:[],backup_points:[],backup_captures:[]});
 }finally{await holder.query('ROLLBACK');await pending?.catch(()=>{});holder.release();await f.close();}
});
test('venue snapshot admitted verification completes after downgrade',async()=>{
 const f=await fixture(),entered=latch(),blocked=latch();let pending:Promise<unknown>|undefined;
 try{
  await provision(f);const c=await snapshot(f),keys=await transaction(f.pool,p=>pointKeys(p,f.vault,f.venues[0]!,1));
  pending=verifyPointFixture(f.pool,f.catalogue,c.point.id,async(_source,_keys,request)=>{entered.release();await blocked.promise;return verificationOutput(request);});void pending.catch(()=>{});
  await Promise.race([entered.promise,pending.then(()=>{throw Error('expected running verification');})]);
  await set(f,'registered');blocked.release();assert.equal(await pending,'verified');
  assert.deepEqual(await transaction(f.pool,p=>pointKeys(p,f.vault,f.venues[0]!,1)),keys);assert.deepEqual(f.objects.get(c.point.objectKey),c.bytes);
  await assert.rejects(f.catalogue.rotate(f.installation),{message:'backup.permission_denied'});
 }finally{blocked.release();await pending?.catch(()=>{});await f.close();}
});
for(const changeKind of ['round-trip','downgrade','revocation','key-change','supersession'] as const)test(`venue snapshot object wait rejects ${changeKind} without publishing`,async()=>{
 const f=await fixture(),entered=latch(),blocked=latch();let pending:Promise<unknown>|undefined,change:Promise<unknown>|undefined;
 try{
  await provision(f);const c=await capture(f);f.blockRead(async()=>{entered.release();await blocked.promise;});
  pending=f.catalogue.publish(f.installation,c.reserved.id,c.metadata);void pending.catch(()=>{});
  await Promise.race([entered.promise,pending.then(()=>{throw Error('expected blocked object work');})]);
  let settled=false;const peer={...f,store:new f.api.BillingStore(f.peer)};
  change=(async()=>{
   if(changeKind==='revocation')await f.peer.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[f.installation]);
   else if(changeKind==='key-change')await f.peer.query('UPDATE installations SET public_key=$2 WHERE id=$1',[f.installation,randomUUID()]);
   else if(changeKind==='supersession')await f.peer.query('UPDATE installations SET revoked_at=clock_timestamp(),superseded_by=(SELECT id FROM installations WHERE venue_id=$2 AND superseded_by IS NULL) WHERE id=$1',[f.installation,f.venues[1]]);
   else{await set(peer,'registered');if(changeKind==='round-trip')await set(peer);}
  })().finally(()=>{settled=true;});void change.catch(()=>{});
  let waiting=false;for(let i=0;i<300&&!settled;i++){
   waiting=!!(await f.admin.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND cardinality(pg_blocking_pids(pid))>0',[f.schema+'_peer'])).rowCount;
   if(waiting)break;await delay(10);
  }
  assert.equal(waiting,false,'object work must release venue authority and installation locks');assert.equal(settled,true,'the policy change must complete during object work');await change;
  blocked.release();await assert.rejects(pending,{message:changeKind==='round-trip'||changeKind==='key-change'?'backup.conflict':changeKind==='downgrade'?'backup.permission_denied':'backup.revoked'});
  assert.equal((await f.pool.query('SELECT count(*) FROM backup_points')).rows[0].count,'0');
  assert.equal((await f.pool.query('SELECT count(*) FROM backup_key_versions')).rows[0].count,'1');assert.ok(f.objects.has(c.reserved.incomingKey));assert.deepEqual(f.removed,[]);
 }finally{blocked.release();await pending?.catch(()=>{});await change?.catch(()=>{});await f.close();}
});
test('venue snapshot admitted deletion finishes before downgrade commits',async()=>{
 const f=await fixture(),entered=latch(),blocked=latch();let pending:Promise<unknown>|undefined,change:Promise<unknown>|undefined;
 try{
  await provision(f);const old=await snapshot(f,90),last=await snapshot(f,80);assert.equal(await verifyPointFixture(f.pool,f.catalogue,last.point.id),'verified');
  f.blockRemove(async()=>{entered.release();await blocked.promise;});pending=f.catalogue.cleanupOne(f.venues[0]!);void pending.catch(()=>{});await Promise.race([entered.promise,pending.then(()=>{throw Error("expected blocked object work");})]);
  let settled=false;change=set({...f,store:new f.api.BillingStore(f.peer)},'registered').finally(()=>{settled=true;});void change.catch(()=>{});
  let waiting=false;for(let i=0;i<300&&!settled;i++){
   waiting=!!(await f.admin.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND cardinality(pg_blocking_pids(pid))>0',[f.schema+'_peer'])).rowCount;
   if(waiting)break;await delay(10);
  }
  assert.equal(waiting,true,'downgrade must wait for admitted deletion');assert.equal(settled,false);
  blocked.release();assert.equal(await pending,old.point.id);await change;
  assert.equal(f.objects.has(old.point.objectKey),false);assert.deepEqual(f.objects.get(last.point.objectKey),last.bytes);assert.equal(await f.catalogue.cleanupOne(f.venues[0]!),null);
 }finally{blocked.release();await pending?.catch(()=>{});await change?.catch(()=>{});await f.close();}
});
