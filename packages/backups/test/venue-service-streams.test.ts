import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {transaction} from '@waitron-cloud/registration';
import {venueServiceFixture,set,trial,event} from '../../registration/test/fixtures/venue-service.ts';
import {BackupCatalogue} from '../src/catalogue.ts';
import {BackupKeyVault} from '../src/keys.ts';
import {ManagedStreams,type ManagedStreamAuthority,type ManagedStreamProvision} from '../src/managed-streams.ts';

async function fixture(){
 const f=await venueServiceFixture();
 try{
  const installation=(await f.pool.query('SELECT id FROM installations WHERE venue_id=$1 AND superseded_by IS NULL',[f.venues[0]])).rows[0].id as string;
  const vault=new BackupKeyVault(randomBytes(32)),key=generateKeyPairSync('ed25519');
  const location={endpoint:'https://stream.example.test',bucket:'venue-'+f.venues[0],region:'local'};
  const input={localVenueId:f.venues[0]!,sourceNodeId:randomUUID(),pointerSignerPublicKey:key.publicKey.export({type:'spki',format:'der'}).toString('base64')};
  const objects=new Map<string,Buffer>(),calls:{provision:Parameters<ManagedStreamAuthority['provision']>[0][];read:string[]}={provision:[],read:[]};
  let provisionWait:undefined|(()=>Promise<void>),readWait:undefined|(()=>Promise<void>);
  let provision:ManagedStreamProvision={writerReference:'writer-one',readerReference:'reader-one',writerCredentials:{accessKeyId:'synthetic-access-one',secretAccessKey:'synthetic-secret-one'}};
  const authority:ManagedStreamAuthority={
   async provision(value){calls.provision.push(value);await provisionWait?.();return provision;},
   async read(reference,at,path){calls.read.push(reference+':'+at.bucket+':'+path);await readWait?.();const bytes=objects.get(path);if(!bytes)throw Error('NoSuchKey');return bytes;},
  };
  const catalogue=new BackupCatalogue(f.pool,vault,()=>({async read(){throw Error('unused');},async put(){throw Error('unused');},async remove(){}}),'test-venue-levels');
  const streams=new ManagedStreams(f.pool,vault,authority,'test-venue-levels');
  async function revision(){return Number((await f.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[installation])).rows[0].configuration_revision);}
  async function configure(){return streams.configure(installation,await revision(),input);}
  function pointer(){
   const body={venueId:input.localVenueId,term:2,nodeId:input.sourceNodeId,generation:`gen-2-${input.sourceNodeId}-20261029T090000Z`,writtenAt:'2026-10-29T09:00:00.000Z'};
   const message=`{"pointer":{"generation":"${body.generation}","nodeId":"${body.nodeId}","term":2,"venueId":"${body.venueId}","writtenAt":"${body.writtenAt}"},"purpose":"waitron.stream.pointer.v1"}`;
   objects.set(`streams/${f.venues[0]}/venues/${input.localVenueId}/current.json`,Buffer.from(JSON.stringify({body,signature:sign(null,Buffer.from(message),key.privateKey).toString('base64')})));
   return body;
  }
  return {...f,installation,vault,location,input,objects,calls,catalogue,streams,revision,configure,pointer,
   blockProvision(hook:()=>Promise<void>){provisionWait=hook;},blockRead(hook:()=>Promise<void>){readWait=hook;},
   replaceWriter(){provision={writerReference:'writer-two',readerReference:'reader-one',writerCredentials:{accessKeyId:'synthetic-access-two',secretAccessKey:'synthetic-secret-two'}};},
  };
 }catch(e){await f.close();throw e;}
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function state(f:Fixture){
 const result:Record<string,unknown>={};
 for(const name of ['backup_locations','backup_key_versions','backup_managed_streams'])result[name]=(await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${name} t ORDER BY to_jsonb(t)::text`)).rows;
 return result;
}
async function ready(f:Fixture,level='connected'){
 await set(f,level);await f.catalogue.provision(f.installation,f.location);return f.configure();
}

// Missing venue admission would issue provider grants for recorded but unenrolled or level-one venues.
for(const enrolled of [false,true])test(`venue stream ${enrolled?'registered':'unenrolled'} admission refuses without provider access`,async()=>{
 const f=await fixture();try{
  const legacy=new BackupCatalogue(f.pool,f.vault,()=>({async read(){throw Error('unused');},async put(){throw Error('unused');},async remove(){}}));
  await legacy.provision(f.installation,f.location);await set(f,enrolled?'registered':'connected',f.venues[0],enrolled);const before=await state(f);
  await assert.rejects(f.configure(),{message:'backup.permission_denied'});
  await assert.rejects(f.streams.observe(f.installation,await f.revision()),{message:'backup.permission_denied'});
  await assert.rejects(f.streams.recovery(f.venues[0]!,await f.revision()),{message:'backup.permission_denied'});
  assert.deepEqual(f.calls,{provision:[],read:[]});assert.deepEqual(await state(f),before);
 }finally{await f.close();}
});
for(const level of ['connected','hosted'])test(`venue ${level} stream retries retain keys and signed recovery identity`,async()=>{
 const f=await fixture();try{
  const configured=await ready(f,level),body=f.pointer(),saved=await state(f);
  assert.deepEqual(await f.streams.configure(f.installation,configured.configurationRevision-1,f.input),configured);
  assert.deepEqual(await state(f),saved);assert.deepEqual(f.calls.provision,[{venueId:f.venues[0],location:f.location,prefix:`streams/${f.venues[0]}/`},{venueId:f.venues[0],location:f.location,prefix:`streams/${f.venues[0]}/`}]);
  const observed=await f.streams.observe(f.installation,configured.configurationRevision);
  assert.equal(observed.generation,body.generation);assert.equal(observed.recoverableAt,body.writtenAt);assert.equal(observed.readerReference,'reader-one');assert.equal(observed.keyVersion,1);
  assert.deepEqual(await f.streams.recovery(f.venues[0]!,configured.configurationRevision),observed);
  assert.equal((await f.pool.query('SELECT service_plan FROM organisations WHERE id=$1',[f.scope.organisationId])).rows[0].service_plan,'free');
 }finally{await f.close();}
});

// A cleared service needs explicit reprovision; an upgrade alone must never restore setup or change recovery keys.
test('venue stream explicit reprovision preserves keys reader and observed data',async()=>{
 const f=await fixture();try{
  const first=await ready(f);f.pointer();const observed=await f.streams.observe(f.installation,first.configurationRevision),before=await state(f);
  await set(f,'registered');await assert.rejects(f.configure(),{message:'backup.permission_denied'});assert.deepEqual(await state(f),before);
  await set(f);assert.equal((await f.pool.query("SELECT state FROM installation_services WHERE installation_id=$1 AND service='continuous_backup'",[f.installation])).rows[0].state,'unconfigured');
  await f.catalogue.provision(f.installation,f.location);f.replaceWriter();const revision=await f.revision(),next=await f.configure();
  assert.equal(next.configurationRevision,revision+1);assert.equal(next.recoveryKey,first.recoveryKey);assert.equal(next.bucket.accessKeyId,'synthetic-access-two');
  const row=(await f.pool.query('SELECT * FROM backup_managed_streams WHERE venue_id=$1',[f.venues[0]])).rows[0];
  assert.equal(row.reader_reference,'reader-one');assert.equal(row.writer_reference,'writer-two');assert.equal(row.generation,observed.generation);assert.equal(row.recoverable_at.toISOString(),observed.recoverableAt);
  assert.deepEqual((await state(f)).backup_key_versions,before.backup_key_versions);
  assert.deepEqual(await f.streams.configure(f.installation,revision,f.input),next);assert.equal(await f.revision(),revision+1);
 }finally{await f.close();}
});

// A provider result belongs to the admitted destination, even if the current level remains paid.
for(const action of ['configure','observe'] as const)for(const field of ['endpoint','bucket','region'] as const)test(`venue stream ${action} wait rejects changed ${field} without publishing`,async()=>{
 const f=await fixture();try{
  await set(f);await f.catalogue.provision(f.installation,f.location);
  const configured=action==='observe'?await f.configure():undefined;if(configured)f.pointer();
  const before=await state(f),wait=async()=>{await f.peer.query(`UPDATE backup_locations SET ${field}=$2 WHERE venue_id=$1`,[f.venues[0],field==='endpoint'?'https://other.example.test':'other-'+field]);};
  if(action==='configure')f.blockProvision(wait);else f.blockRead(wait);
  await assert.rejects(action==='configure'?f.configure():f.streams.observe(f.installation,configured!.configurationRevision),{message:'backup.conflict'});
  const after=await state(f);assert.deepEqual(after.backup_key_versions,before.backup_key_versions);assert.deepEqual(after.backup_managed_streams,before.backup_managed_streams);
  assert.equal(f.calls.provision.length,1);assert.equal(f.calls.read.length,action==='observe'?1:0);
 }finally{await f.close();}
});

for(const action of ['configure','observe'] as const)for(const change of ['downgrade','round-trip','trial-extension','revocation','supersession'] as const)test(`venue stream ${action} wait rejects ${change} without publishing`,async()=>{
 const f=await fixture();try{
  if(change==='trial-extension')await trial(f);else await set(f);
  await f.catalogue.provision(f.installation,f.location);const configured=action==='observe'?await f.configure():undefined;if(configured)f.pointer();const before=await state(f);
  const wait=async()=>{
   const peer={...f,store:new f.api.BillingStore(f.peer)};
   if(change==='downgrade'||change==='round-trip'){await set(peer,'registered');if(change==='round-trip')await set(peer);}
   else if(change==='trial-extension'){const end=(await f.store.history(f.scope,f.venues[0])).trials[0]!.endsOn;await peer.store.execute(f.scope,event(),{type:'extend_trial',venueId:f.venues[0],level:'connected',expectedEnd:end});}
   else if(change==='revocation')await f.peer.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[f.installation]);
   else {const replacement=randomUUID();await transaction(f.peer,async client=>{
    await client.query('UPDATE installations SET superseded_by=$2,revoked_at=clock_timestamp() WHERE id=$1',[f.installation,replacement]);
    await client.query('INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,$3)',[replacement,f.venues[0],replacement]);
   });}
  };
  if(action==='configure')f.blockProvision(wait);else f.blockRead(wait);
  const expected=change==='downgrade'?'backup.permission_denied':change==='revocation'||change==='supersession'?'backup.revoked':'backup.conflict';
  await assert.rejects(action==='configure'?f.configure():f.streams.observe(f.installation,configured!.configurationRevision),{message:expected});
  assert.deepEqual(await state(f),before);
 }finally{await f.close();}
});

// Policy for the original venue cannot authorise an installation moved during that policy wait.
test('venue stream policy wait rechecks installation scope before provisioning',async()=>{
 const f=await fixture(),holder=await f.peer.connect();let pending:Promise<unknown>|undefined;
 try{
  await set(f);await f.catalogue.provision(f.installation,f.location);
  await set(f,'connected',f.venues[1]);
  const sibling=(await f.pool.query('SELECT id FROM installations WHERE venue_id=$1 AND superseded_by IS NULL',[f.venues[1]])).rows[0].id;
  await f.catalogue.provision(sibling,{...f.location,bucket:'sibling'});await set(f,'registered',f.venues[1]);
  const revision=await f.revision(),before=await state(f);
  await holder.query('BEGIN');await holder.query('SELECT id FROM venues WHERE id=$1 FOR NO KEY UPDATE',[f.venues[0]]);
  const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  let settled=false;pending=f.streams.configure(f.installation,revision,f.input).finally(()=>{settled=true;});void pending.catch(()=>{});
  let blocked=false;
  for(let i=0;i<300&&!settled;i++){
   blocked=Boolean((await f.admin.query('SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))',[f.schema,pid])).rowCount);
   if(blocked)break;await delay(10);
  }
  assert.equal(blocked,true,'stream must wait for venue authority before locking the installation');
  await holder.query('UPDATE installations SET superseded_by=$2,revoked_at=clock_timestamp() WHERE id=$1',[sibling,f.installation]);
  await holder.query('UPDATE installations SET venue_id=$2 WHERE id=$1',[f.installation,f.venues[1]]);await holder.query('COMMIT');
  await assert.rejects(pending,{message:'backup.permission_denied'});
  assert.deepEqual(f.calls,{provision:[],read:[]});assert.deepEqual(await state(f),before);
 }finally{await holder.query('ROLLBACK');await pending?.catch(()=>{});holder.release();await f.close();}
});
