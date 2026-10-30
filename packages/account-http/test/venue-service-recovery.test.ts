import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {test} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {BillingStore,createLeaseIssuer,type BillingLevel} from '@waitron-cloud/registration';
import {database} from './fixtures.ts';
import {recoveryFixture,machineTarget,origin} from '../../backups/test/fixtures/recovery-v2.ts';
import {ManagedStreams,type ManagedStreamAuthority} from '../../backups/src/managed-streams.ts';
import {BackupRecovery,streamRecoveryDigest} from '../../backups/src/recovery.ts';
import {RecoveryRequests} from '../../backups/src/recovery-request.ts';
import {event} from '../../registration/test/fixtures/venue-service.ts';
import {createAccountApp} from '../src/app.ts';

type Source='snapshot'|'continuous';
async function fixture(source:Source,asTrial=false,initialLevel:BillingLevel='connected'){
 const db=await database();
 try{
  const f=await recoveryFixture(db),venueId=f.installed.venueId;
  const billing=new BillingStore(db.pool),scope={organisationId:f.owner.organisationId,legalBusinessId:f.owner.legalBusinessId};
  await billing.execute(scope,event(),{type:'ensure_business'});
  async function level(value:BillingLevel='connected'){
   const old=await billing.venue(scope,venueId);
   await billing.transition(scope,event(),{type:'set_venue',venueId,expectedRevision:old.revision,value:{level:value,connectedFrom:null,lapsedOn:null,scheduledLevel:null,scheduledOn:null}});
  }
  const today=(await db.pool.query("SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS day")).rows[0].day;
  if(asTrial)await billing.transition(scope,event(),{type:'start_trial',venueId,level:'connected',on:today});else await level(initialLevel);
  const location=(await db.pool.query('SELECT endpoint,bucket,region FROM backup_locations WHERE venue_id=$1',[venueId])).rows[0];
  let wait:undefined|(()=>Promise<void>);const calls={grant:0,reader:0};
  const pointerKey=generateKeyPairSync('ed25519'),sourceNodeId=randomUUID();
  const pointer={venueId,term:2,nodeId:sourceNodeId,generation:`gen-2-${sourceNodeId}-20261029T090000Z`,writtenAt:'2026-10-29T09:00:00.000Z'};
  const message=`{"pointer":{"generation":"${pointer.generation}","nodeId":"${pointer.nodeId}","term":2,"venueId":"${pointer.venueId}","writtenAt":"${pointer.writtenAt}"},"purpose":"waitron.stream.pointer.v1"}`;
  const authority:ManagedStreamAuthority={
   async provision(){return {writerReference:'writer-one',readerReference:'reader-one',writerCredentials:{accessKeyId:'synthetic-writer',secretAccessKey:'synthetic-writer-secret'}};},
   async read(){return Buffer.from(JSON.stringify({body:pointer,signature:sign(null,Buffer.from(message),pointerKey.privateKey).toString('base64')}));},
   async reader(input){assert.deepEqual(input,{reference:'reader-one',venueId,location,prefix:`streams/${venueId}/`});calls.reader++;await wait?.();return {accessKeyId:'synthetic-reader',secretAccessKey:'synthetic-reader-secret'};},
  };
  if(source==='continuous'){
   const streams=new ManagedStreams(db.pool,f.vault,authority,'test-venue-levels');
   const revision=Number((await db.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[f.installed.installationId])).rows[0].configuration_revision);
   const configured=await streams.configure(f.installed.installationId,revision,{localVenueId:venueId,sourceNodeId,pointerSignerPublicKey:pointerKey.publicKey.export({type:'spki',format:'der'}).toString('base64')});
   await streams.observe(f.installed.installationId,configured.configurationRevision);
  }
  const target=machineTarget(),version=source==='snapshot'?2:1,digest=source==='snapshot'?f.point.digest:streamRecoveryDigest(pointer.generation);
  const requests=new RecoveryRequests(db.pool,f.vault,origin,undefined,'test-venue-levels');
  const recovery=new BackupRecovery(db.pool,f.vault,origin,undefined,'test-venue-levels');
  await requests.machine('start',target.envelope('start','',Date.now(),origin,version));
  await requests.approve(target.id,target.code,f.session.token,f.session.csrfToken,source==='snapshot'?f.input:{source:'continuous',venueId,oldServerUnavailable:true,acceptDataLoss:true});
  const app=createAccountApp({pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]},planMode:'test-venue-levels',leaseIssuer:createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url')),captures:{vault:f.vault,objects:()=>f.store,managedStreams:authority,
   async grant(at,grantScope){assert.deepEqual(at,location);assert.deepEqual(grantScope,{kind:'restore',bucket:location.bucket,scope:f.point.objectKey});calls.grant++;await wait?.();return {credentials:{accessKeyId:'synthetic-access',secretAccessKey:'synthetic-secret',sessionToken:'synthetic-token'},expiresAt:new Date(Date.now()+900000).toISOString()};},
  }});
  const bindings={incoming:{socket:{remoteAddress:'192.0.2.1'}}} as HttpBindings;
  function proof(issuedAt=Date.now()){return target.envelope('read',digest,issuedAt,origin,version);}
  function read(envelope=proof()){return app.request(origin+'/api/recovery/read',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(envelope)},bindings);}
  async function state(){const value:Record<string,unknown>={};for(const table of ['backup_key_versions','backup_points','backup_recoveries','backup_managed_streams','installation_replacements'])value[table]=(await db.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;return value;}
  return {...f,db,billing,scope,today,source,sourceNodeId,venueId,location,target,version,digest,requests,recovery,calls,level,proof,read,state,block(hook:()=>Promise<void>){wait=hook;},close:()=>db.close()};
 }catch(error){await db.close();throw error;}
}

// Missing current admission would release data keys at level one; owner metadata and withdrawal must remain available.
for(const source of ['snapshot','continuous'] as const)test(`venue ${source} recovery denies new grants but preserves owner status catalogue and close`,async()=>{
 const f=await fixture(source);try{
  const before=await f.state();await f.level('registered');
  const response=await f.read();assert.equal(response.status,403,await response.clone().text());assert.deepEqual(await response.json(),{error:'permission_denied'});
  assert.deepEqual(f.calls,{grant:0,reader:0});assert.deepEqual(await f.state(),before);
  assert.equal((await f.recovery.status(f.session.token,f.target.id)).status,'pending');
  assert.equal((await f.recovery.catalogue(f.session.token,f.venueId)).points[0]!.id,f.point.id);
  await f.recovery.close(f.session.token,f.session.csrfToken,f.target.id);
  assert.equal((await f.recovery.status(f.session.token,f.target.id)).status,'closed');
 }finally{await f.close();}
});

for(const source of ['snapshot','continuous'] as const)for(const level of ['connected','hosted'] as const)test(`venue ${source} recovery at ${level} releases only its approved data`,async()=>{
 const f=await fixture(source,false,level);try{
  const before=await f.state(),response=await f.read();assert.equal(response.status,200,await response.clone().text());const body=await response.json();
  if(source==='snapshot'){
   assert.equal(body.version,2);assert.equal(body.point.id,f.point.id);assert.deepEqual(body.location,f.location);assert.equal(body.recoveryKey,f.capture.keys.recoveryKey);assert.equal(body.credentials.secretAccessKey,'synthetic-secret');assert.deepEqual(body.verification.target,f.target.target);
  }else{
   const kit=JSON.parse(Buffer.from(body.recoveryKit.slice('WAITRON-RECOVERY-KIT-1:'.length),'base64url').toString());
   assert.equal(kit.venueId,f.venueId);assert.equal(kit.bucket.secretAccessKey,'synthetic-reader-secret');assert.equal(body.source.kind,'continuous');assert.equal(body.source.sourceNodeId,f.sourceNodeId);
  }
  assert.deepEqual(f.calls,{grant:source==='snapshot'?1:0,reader:source==='continuous'?1:0});assert.deepEqual(await f.state(),before);
  assert.equal((await f.db.pool.query('SELECT service_plan FROM organisations WHERE id=$1',[f.scope.organisationId])).rows[0].service_plan,'free');
 }finally{await f.close();}
});

// A repeated permission check alone misses a downgrade/upgrade or a changed grant destination during provider work.
for(const source of ['snapshot','continuous'] as const)for(const change of ['round-trip','trial-extension','endpoint','bucket','region','membership','operation-expiry','owner-close','proof-expiry'] as const)test(`venue ${source} recovery provider wait rejects ${change} without credentials`,async(t)=>{
 const f=await fixture(source,change==='trial-extension');try{
  const before=await f.state(),now=Date.now(),envelope=f.proof(change==='proof-expiry'?now-59000:now);let clock:ReturnType<typeof t.mock.method>|undefined;
  f.block(async()=>{
   if(change==='round-trip'){await f.level('registered');await f.level();}
   else if(change==='trial-extension'){const end=(await f.billing.history(f.scope,f.venueId)).trials[0]!.endsOn;await f.billing.execute(f.scope,event(),{type:'extend_trial',venueId:f.venueId,level:'connected',expectedEnd:end});}
   else if(change==='endpoint'||change==='bucket'||change==='region')await f.db.secondPool.query(`UPDATE backup_locations SET ${change}=$2 WHERE venue_id=$1`,[f.venueId,change==='endpoint'?'https://other.test':'other-'+change]);
   else if(change==='membership')await f.db.secondPool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1 AND organisation_id=$2',[f.owner.accountId,f.scope.organisationId]);
   else if(change==='operation-expiry')await f.db.secondPool.query("UPDATE backup_recoveries SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[f.target.id]);
   else if(change==='owner-close')await f.recovery.close(f.session.token,f.session.csrfToken,f.target.id);
   else clock=t.mock.method(Date,'now',()=>now+2000);
  });
  let response:Response;try{response=await f.read(envelope);}finally{clock?.mock.restore();}
  const expected=change==='membership'?403:change==='operation-expiry'||change==='owner-close'||source==='continuous'&&(change==='round-trip'||change==='trial-extension')?410:change==='proof-expiry'?401:409;
  assert.equal(response.status,expected,await response.clone().text());const text=await response.text();
  for(const secret of ['synthetic-secret','synthetic-reader-secret','recoveryKey','recoveryKit'])assert.equal(text.includes(secret),false,text);
  assert.deepEqual(f.calls,{grant:source==='snapshot'?1:0,reader:source==='continuous'?1:0});
  const after=await f.state();for(const table of ['backup_key_versions','backup_points','backup_managed_streams','installation_replacements'])assert.deepEqual(after[table],before[table]);
  if(change!=='operation-expiry'&&change!=='owner-close')assert.deepEqual(after.backup_recoveries,before.backup_recoveries);
 }finally{await f.close();}
});

test('venue continuous recovery provider wait rejects a changed reader reference without credentials',async()=>{
 const f=await fixture('continuous');try{
  f.block(async()=>{await f.db.secondPool.query("UPDATE backup_managed_streams SET reader_reference='reader-two' WHERE venue_id=$1",[f.venueId]);});
  const response=await f.read();assert.equal(response.status,409,await response.clone().text());const text=await response.text();assert.equal(text.includes('recoveryKit'),false);assert.equal(text.includes('synthetic-reader-secret'),false);assert.deepEqual(f.calls,{grant:0,reader:1});
 }finally{await f.close();}
});
