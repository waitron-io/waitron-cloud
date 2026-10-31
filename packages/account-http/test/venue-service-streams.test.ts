import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {test} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {createLeaseIssuer,EmailOutbox,encodeMachine,type SignedEnvelope} from '@waitron-cloud/registration';
import {BackupCatalogue} from '../../backups/src/catalogue.ts';
import {BackupKeyVault} from '../../backups/src/keys.ts';
import {ManagedStreams,type ManagedStreamAuthority} from '../../backups/src/managed-streams.ts';
import {venueServiceFixture,set,trial,event} from '../../registration/test/fixtures/venue-service.ts';
import {ManagedStreamMachines} from '../src/managed-streams.ts';
import {createAccountApp} from '../src/app.ts';

const origin='https://stream.example.test';
const actions=['backup-stream-configure','backup-stream-observe'] as const;
type Action=typeof actions[number];
async function fixture(){
 const f=await venueServiceFixture();
 try{
  const key=generateKeyPairSync('ed25519'),publicKey=key.publicKey.export({type:'spki',format:'der'}).toString('base64url');
  const installation=(await f.pool.query('UPDATE installations SET public_key=$2 WHERE venue_id=$1 AND superseded_by IS NULL RETURNING id',[f.venues[0],publicKey])).rows[0].id as string;
  const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
  const vault=new BackupKeyVault(randomBytes(32)),pointerKey=generateKeyPairSync('ed25519');
  const input={localVenueId:f.venues[0]!,sourceNodeId:randomUUID(),pointerSignerPublicKey:pointerKey.publicKey.export({type:'spki',format:'der'}).toString('base64')};
  const location={endpoint:'https://storage.example.test',bucket:'venue-'+f.venues[0],region:'local'},calls={provision:0,read:0};
  let wait:undefined|(()=>Promise<void>);
  const pointer={venueId:input.localVenueId,term:2,nodeId:input.sourceNodeId,generation:`gen-2-${input.sourceNodeId}-20261029T090000Z`,writtenAt:'2026-10-29T09:00:00.000Z'};
  const message=`{"pointer":{"generation":"${pointer.generation}","nodeId":"${pointer.nodeId}","term":2,"venueId":"${pointer.venueId}","writtenAt":"${pointer.writtenAt}"},"purpose":"waitron.stream.pointer.v1"}`;
  const bytes=Buffer.from(JSON.stringify({body:pointer,signature:sign(null,Buffer.from(message),pointerKey.privateKey).toString('base64')}));
  const authority:ManagedStreamAuthority={
   async provision(value){assert.deepEqual(value,{venueId:f.venues[0],location,prefix:`streams/${f.venues[0]}/`});calls.provision++;await wait?.();return {writerReference:'writer-one',readerReference:'reader-one',writerCredentials:{accessKeyId:'synthetic-access',secretAccessKey:'synthetic-secret'}};},
   async read(reference,at,path){assert.equal(reference,'reader-one');assert.deepEqual(at,location);assert.equal(path,`streams/${f.venues[0]}/venues/${input.localVenueId}/current.json`);calls.read++;await wait?.();return bytes;},
  };
  const objects=()=>({async read(){throw Error('unused');},async put(){throw Error('unused');},async remove(){}});
  const catalogue=new BackupCatalogue(f.pool,vault,objects,'test-venue-levels'),streams=new ManagedStreams(f.pool,vault,authority,'test-venue-levels');
  const machines=new ManagedStreamMachines(f.pool,issuer,origin,vault,authority,undefined,'test-venue-levels');
  const outbox=new EmailOutbox({activeKeyId:'test',keys:{test:randomBytes(32).toString('hex')}});
  const app=createAccountApp({pool:f.pool,outbox,config:{portalOrigin:origin,production:true,rateKey:randomBytes(32).toString('hex'),trustedProxyIps:[]},leaseIssuer:issuer,planMode:'test-venue-levels',captures:{vault,objects,async grant(){throw Error('unused');},managedStreams:authority}});
  function lease(expiresAt=Date.now()+3600000){return issuer.issue({origin,leaseId:randomUUID(),installationId:installation,venueId:f.venues[0]!,environment:'test',publicKey,issuedAt:Date.now(),expiresAt});}
  const currentLease=lease();
  async function revision(){return Number((await f.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[installation])).rows[0].configuration_revision);}
  function proof(action:Action,body:unknown={},options:{lease?:SignedEnvelope;issuedAt?:number}={}){
   const payload=encodeMachine({origin,action,installationId:installation,operationId:randomUUID(),issuedAt:options.issuedAt??Date.now(),lease:JSON.stringify(options.lease??currentLease),body:JSON.stringify(body)});
   return {payload:payload.toString('base64url'),signature:sign(null,payload,key.privateKey).toString('base64url')};
  }
  function request(action:Action,envelope:unknown){return app.request(origin+'/api/installations/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(envelope)},{incoming:{socket:{remoteAddress:'192.0.2.1'}}} as HttpBindings);}
  async function prepare(action:Action,asTrial=false,level='connected'){if(asTrial)await trial(f);else await set(f,level);await catalogue.provision(installation,location);if(action==='backup-stream-observe')await streams.configure(installation,await revision(),input);calls.provision=0;calls.read=0;return action==='backup-stream-configure'?{revision:await revision(),...input}:{};}
  return {...f,installation,input,location,calls,catalogue,streams,machines,lease,proof,request,prepare,revision,block(hook:()=>Promise<void>){wait=hook;}};
 }catch(e){await f.close();throw e;}
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function state(f:Fixture){
 const result:Record<string,unknown>={};
 for(const name of ['backup_locations','backup_key_versions','backup_managed_streams','installation_services','installation_operations'])result[name]=(await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${name} t ORDER BY to_jsonb(t)::text`)).rows;
 return result;
}

// Preliminary authentication must win over metadata and policy failures for a forged machine request.
for(const action of actions)for(const boundary of ['metadata','registered','unavailable'] as const)test(`venue stream machine ${action} authenticates before ${boundary}`,async()=>{
 const f=await fixture();try{
  await set(f,'registered');const envelope=f.proof(action,boundary==='metadata'?{unexpected:true}:action==='backup-stream-configure'?{revision:0,...f.input}:{});
  const forged={...envelope,signature:Buffer.alloc(64).toString('base64url')},before=await state(f);
  if(boundary==='unavailable')await f.pool.query('DROP TABLE billing_service_authority');
  await assert.rejects(f.machines.execute(action,forged),{code:'invalid_proof'});
  assert.deepEqual(f.calls,{provision:0,read:0});assert.deepEqual(await state(f),before);
 }finally{await f.close();}
});

for(const action of actions)for(const level of ['registered','connected','hosted'] as const)test(`venue stream HTTP ${action} obeys ${level} authority`,async()=>{
 const f=await fixture();try{
  const body=await f.prepare(action,false,level==='hosted'?'hosted':'connected');if(level==='registered')await set(f,level);const before=await state(f);
  const response=await f.request(action,f.proof(action,body));assert.equal(response.status,level==='registered'?403:200,await response.clone().text());assert.equal(response.headers.get('cache-control'),'no-store');
  const result=await response.json();
  if(level==='registered'){assert.equal(result.error,'permission_denied');assert.deepEqual(f.calls,{provision:0,read:0});assert.deepEqual(await state(f),before);}
  else if(action==='backup-stream-configure'){assert.equal(result.bucket.secretAccessKey,'synthetic-secret');assert.equal(result.venueId,f.venues[0]);assert.equal(result.installationId,f.installation);assert.equal(f.calls.provision,1);}
  else{assert.deepEqual(Object.keys(result).sort(),['checkedAt','configurationRevision','installationId','localVenueId','recoverableAt','sourceNodeId','venueId']);assert.equal(result.recoverableAt,'2026-10-29T09:00:00.000Z');assert.equal(f.calls.read,1);}
  const history=JSON.stringify((await f.pool.query('SELECT * FROM installation_operations')).rows);assert.equal(history.includes('synthetic-secret'),false);
 }finally{await f.close();}
});

// Dropping the final machine fence would disclose a writer key or persist an observation after authentication expires.
for(const action of actions)for(const change of ['proof-expiry','lease-expiry','key','revocation','round-trip','trial-extension'] as const)test(`venue stream HTTP ${action} provider wait rejects ${change}`,async(t)=>{
 const f=await fixture();try{
  const body=await f.prepare(action,change==='trial-extension');
  const now=Date.now(),envelope=f.proof(action,body,change==='proof-expiry'?{issuedAt:now-59000}:change==='lease-expiry'?{lease:f.lease(now+30000)}:{}),before=await state(f);
  let clock:ReturnType<typeof t.mock.method>|undefined;
  f.block(async()=>{
   const peer={...f,store:new f.api.BillingStore(f.peer)};
   if(change==='round-trip'){await set(peer,'registered');await set(peer);}
   else if(change==='trial-extension'){const end=(await f.store.history(f.scope,f.venues[0])).trials[0]!.endsOn;await peer.store.execute(f.scope,event(),{type:'extend_trial',venueId:f.venues[0],level:'connected',expectedEnd:end});}
   else if(change==='revocation')await f.peer.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[f.installation]);
   else if(change==='key')await f.peer.query('UPDATE installations SET public_key=$2 WHERE id=$1',[f.installation,generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url')]);
   else clock=t.mock.method(Date,'now',()=>now+(change==='lease-expiry'?30001:2000));
  });
  let response:Response;try{response=await f.request(action,envelope);}finally{clock?.mock.restore();}
  const expected=change==='revocation'?403:change==='round-trip'||change==='trial-extension'?409:401;
  assert.equal(response.status,expected,await response.clone().text());const text=await response.text();assert.equal(text.includes('synthetic-secret'),false);assert.equal(text.includes('recoveryKey'),false);
  assert.deepEqual(f.calls,{provision:action==='backup-stream-configure'?1:0,read:action==='backup-stream-observe'?1:0});
  const after=await state(f);assert.deepEqual(after.backup_key_versions,before.backup_key_versions);assert.deepEqual(after.backup_managed_streams,before.backup_managed_streams);assert.deepEqual(after.installation_operations,before.installation_operations);
 }finally{await f.close();}
});
