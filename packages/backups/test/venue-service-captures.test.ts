import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {test} from 'node:test';
import {createLeaseIssuer,encodeMachine,transaction,type SignedEnvelope} from '@waitron-cloud/registration';
import {venueServiceFixture,set,trial,event} from '../../registration/test/fixtures/venue-service.ts';
import {BackupCaptures,type CaptureAction} from '../src/captures.ts';
import {BackupCatalogue,pointKeys} from '../src/catalogue.ts';
import {BackupKeyVault} from '../src/keys.ts';
import {receipt,type StorageLocation,type StorageScope} from '../src/storage.ts';

const origin='https://capture.example.test';
async function fixture(){
 const f=await venueServiceFixture();
 try{
  const key=generateKeyPairSync('ed25519'),publicKey=key.publicKey.export({type:'spki',format:'der'}).toString('base64url');
  const installation=(await f.pool.query('UPDATE installations SET public_key=$2 WHERE venue_id=$1 AND superseded_by IS NULL RETURNING id',[f.venues[0],publicKey])).rows[0].id as string;
  const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
  const vault=new BackupKeyVault(randomBytes(32)),objects=new Map<string,Buffer>(),grants:{location:StorageLocation;scope:StorageScope}[]=[];
  const location={endpoint:'https://storage.example.test',bucket:'venue-'+f.venues[0],region:'local'};
  const storage=()=>({async read(k:string){const bytes=objects.get(k);if(!bytes)throw Error('NoSuchKey');return Buffer.from(bytes);},async put(k:string,bytes:Uint8Array){objects.set(k,Buffer.from(bytes));return receipt(bytes);},async remove(k:string){objects.delete(k);}});
  let wait:undefined|(()=>Promise<void>);
  const captures=new BackupCaptures(f.pool,issuer,origin,{vault,objects:storage,planMode:'test-venue-levels',async grant(l,s){grants.push({location:l,scope:s});await wait?.();return {credentials:{accessKeyId:'synthetic-access',secretAccessKey:'synthetic-secret',sessionToken:'synthetic-token'},expiresAt:new Date(Date.now()+900000).toISOString()};}});
  const catalogue=new BackupCatalogue(f.pool,vault,storage,'test-venue-levels'),legacyCatalogue=new BackupCatalogue(f.pool,vault,storage);
  function lease(expiresAt=Date.now()+3600000){return issuer.issue({origin,leaseId:randomUUID(),installationId:installation,venueId:f.venues[0]!,environment:'test',publicKey,issuedAt:Date.now(),expiresAt});}
  const currentLease=lease();
  function proof(action:CaptureAction,id=randomUUID(),body:unknown={},options:{lease?:SignedEnvelope;issuedAt?:number}={}){
   const payload=encodeMachine({origin,action,installationId:installation,operationId:id,issuedAt:options.issuedAt??Date.now(),lease:JSON.stringify(options.lease??currentLease),body:JSON.stringify(body)});
   return {payload:payload.toString('base64url'),signature:sign(null,payload,key.privateKey).toString('base64url')};
  }
  return {...f,key,publicKey,installation,issuer,vault,objects,grants,location,captures,catalogue,legacyCatalogue,lease,proof,blockGrant(hook:()=>Promise<void>){wait=hook;}};
 }catch(e){await f.close();throw e;}
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function provision(f:Fixture){await set(f);await f.catalogue.provision(f.installation,f.location);}
async function state(f:Fixture){
 const result:Record<string,unknown>={};
 for(const name of ['backup_locations','backup_key_versions','backup_points','backup_captures'])result[name]=(await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${name} t ORDER BY to_jsonb(t)::text`)).rows;
 return result;
}

// Removing preliminary authentication would expose policy errors before the signed machine boundary.
for(const action of ['backup-reserve','backup-publish'] as const)test(`venue capture ${action} authenticates before unavailable authority`,async()=>{
 const f=await fixture();try{
  const forged={...f.proof(action),signature:Buffer.alloc(64).toString('base64url')};
  await f.pool.query('DROP TABLE billing_service_authority');
  await assert.rejects(f.captures.execute(action,forged),{code:'invalid_proof'});
  assert.equal(f.grants.length,0);assert.deepEqual(await state(f),{backup_locations:[],backup_key_versions:[],backup_points:[],backup_captures:[]});
 }finally{await f.close();}
});
for(const enrolled of [false,true])test(`venue capture ${enrolled?'registered':'unenrolled'} authority refuses before provider access`,async()=>{
 const f=await fixture();try{
  await f.legacyCatalogue.provision(f.installation,f.location);await set(f,'registered',f.venues[0],enrolled);const before=await state(f);
  await assert.rejects(f.captures.execute('backup-reserve',f.proof('backup-reserve')),{message:'backup.permission_denied'});
  assert.equal(f.grants.length,0);assert.deepEqual(await state(f),before);
 }finally{await f.close();}
});
for(const level of ['connected','hosted'] as const)test(`venue ${level} capture grants keep their original keys and exact scope`,async()=>{
 const f=await fixture();try{
  await set(f,level);await f.catalogue.provision(f.installation,f.location);const id=randomUUID();
  const first=await f.captures.execute('backup-reserve',f.proof('backup-reserve',id));assert.ok('recoveryKey' in first);
  assert.equal(first.id,id);assert.equal(first.venueId,f.venues[0]);assert.equal(first.keyVersion,1);assert.equal(first.incomingKey,'incoming/'+id);
  assert.equal(first.recoveryKey,(await transaction(f.pool,c=>pointKeys(c,f.vault,f.venues[0]!,1))).recoveryKey);
  assert.deepEqual(f.grants,[{location:f.location,scope:{kind:'capture',bucket:f.location.bucket,scope:'incoming/'+id}}]);
  await f.catalogue.rotate(f.installation);const replay=await f.captures.execute('backup-reserve',f.proof('backup-reserve',id));assert.ok('recoveryKey' in replay);
  assert.equal(replay.recoveryKey,first.recoveryKey);assert.equal(replay.keyVersion,1);assert.equal((await f.pool.query('SELECT count(*) FROM backup_captures')).rows[0].count,'1');
  const bytes=Buffer.from('synthetic encrypted archive'),metadata={...receipt(bytes),capturedAt:new Date().toISOString(),retention:'daily',sourceNodeId:randomUUID(),modules:{core:1}};
  f.objects.set(first.incomingKey,bytes);const point=await f.captures.execute('backup-publish',f.proof('backup-publish',id,metadata));
  assert.equal(point.id,id);assert.equal('recoveryKey' in point,false);assert.equal('credentials' in point,false);assert.deepEqual(f.objects.get('snapshots/'+id),bytes);
  assert.equal((await f.pool.query('SELECT service_plan FROM organisations WHERE id=$1',[f.scope.organisationId])).rows[0].service_plan,'free');
 }finally{await f.close();}
});

// Rechecking only the current paid level misses a new generation or a changed storage destination.
for(const change of ['round-trip','trial-extension','location','revocation','key','capture-expiry','lease-expiry','proof-expiry'] as const)test(`venue capture grant wait rejects ${change} without returning credentials`,async(t)=>{
 const f=await fixture();try{
  if(change==='trial-extension')await trial(f);else await set(f);
  await f.catalogue.provision(f.installation,f.location);
  const id=randomUUID(),now=Date.now(),proof=f.proof('backup-reserve',id,{},change==='lease-expiry'?{lease:f.lease(now+30000)}:change==='proof-expiry'?{issuedAt:now-59000}:{});
  const before=await state(f);let clock:ReturnType<typeof t.mock.method>|undefined;
  f.blockGrant(async()=>{
   const peer={...f,store:new f.api.BillingStore(f.peer)};
   if(change==='round-trip'){await set(peer,'registered');await set(peer);await f.catalogue.provision(f.installation,f.location);}
   else if(change==='trial-extension'){
    const end=(await f.store.history(f.scope,f.venues[0])).trials[0]!.endsOn;
    await peer.store.execute(f.scope,event(),{type:'extend_trial',venueId:f.venues[0],level:'connected',expectedEnd:end});
   }else if(change==='location')await f.peer.query('UPDATE backup_locations SET bucket=$2 WHERE venue_id=$1',[f.venues[0],'different-bucket']);
   else if(change==='revocation')await f.peer.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[f.installation]);
   else if(change==='key')await f.peer.query('UPDATE installations SET public_key=$2 WHERE id=$1',[f.installation,generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url')]);
   else if(change==='capture-expiry')await f.peer.query('UPDATE backup_captures SET expired_at=clock_timestamp() WHERE id=$1',[id]);
   else clock=t.mock.method(Date,'now',()=>now+(change==='lease-expiry'?30001:2000));
  });
  const expected=change==='revocation'?'backup.revoked':change==='capture-expiry'?'backup.capture_expired':change==='key'||change==='lease-expiry'||change==='proof-expiry'?'invalid_proof':'backup.conflict';
  try{await assert.rejects(f.captures.execute('backup-reserve',proof),{message:expected});}finally{clock?.mock.restore();}
  assert.equal(f.grants.length,1);const after=await state(f);assert.deepEqual(after.backup_key_versions,before.backup_key_versions);assert.deepEqual(after.backup_points,[]);assert.equal(f.objects.size,0);
 }finally{await f.close();}
});
test('venue capture provider failure preserves one retryable reservation',async()=>{
 const f=await fixture();try{
  await provision(f);const id=randomUUID(),failure=Error('synthetic grant outage');
  f.blockGrant(async()=>{throw failure;});await assert.rejects(f.captures.execute('backup-reserve',f.proof('backup-reserve',id)),e=>e===failure);
  const before=await state(f);f.blockGrant(async()=>{});const result=await f.captures.execute('backup-reserve',f.proof('backup-reserve',id));
  assert.equal(result.id,id);assert.deepEqual(await state(f),before);assert.equal(f.grants.length,2);
 }finally{await f.close();}
});
