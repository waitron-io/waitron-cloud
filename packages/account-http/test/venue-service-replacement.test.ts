import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {test} from 'node:test';
import {BillingStore,createLeaseIssuer,type BillingLevel} from '@waitron-cloud/registration';
import {database} from './fixtures.ts';
import {event} from '../../registration/test/fixtures/venue-service.ts';
import {recoveryFixture,machineTarget,origin} from '../../backups/test/fixtures/recovery-v2.ts';
import {BackupRecovery,streamRecoveryDigest} from '../../backups/src/recovery.ts';
import {RecoveryRequests} from '../../backups/src/recovery-request.ts';
import {replacementPayload} from '../../backups/src/replacement.ts';
import {ManagedStreams,type ManagedStreamAuthority} from '../../backups/src/managed-streams.ts';
import {createAccountApp} from '../src/app.ts';

async function fixture(source:'snapshot'|'continuous',initial:BillingLevel='connected'){
 const db=await database();
 try{
  const f=await recoveryFixture(db),venueId=f.installed.venueId,billing=new BillingStore(db.pool),scope={organisationId:f.owner.organisationId,legalBusinessId:f.owner.legalBusinessId};
  await billing.execute(scope,event(),{type:'ensure_business'});
  async function level(value:BillingLevel='connected'){
   const old=await billing.venue(scope,venueId);
   await billing.transition(scope,event(),{type:'set_venue',venueId,expectedRevision:old.revision,value:{level:value,connectedFrom:null,lapsedOn:null,scheduledLevel:null,scheduledOn:null}});
  }
  await level(initial);let nodeId=f.point.sourceNodeId;
  if(source==='continuous'){
   nodeId=randomUUID();const pointerKey=generateKeyPairSync('ed25519');
   const pointer={venueId,term:2,nodeId,generation:`gen-2-${nodeId}-20261030T090000Z`,writtenAt:'2026-10-30T09:00:00.000Z'};
   const bytes=Buffer.from(`{"pointer":{"generation":"${pointer.generation}","nodeId":"${nodeId}","term":2,"venueId":"${venueId}","writtenAt":"${pointer.writtenAt}"},"purpose":"waitron.stream.pointer.v1"}`);
   const authority:ManagedStreamAuthority={
    async provision(){return {writerReference:'http-replacement-writer',readerReference:'http-replacement-reader',writerCredentials:{accessKeyId:'synthetic-writer',secretAccessKey:'synthetic-secret'}};},
    async read(){return Buffer.from(JSON.stringify({body:pointer,signature:sign(null,bytes,pointerKey.privateKey).toString('base64')}));},
   };
   const streams=new ManagedStreams(db.pool,f.vault,authority,'test-venue-levels');
   const revision=Number((await db.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[f.installed.installationId])).rows[0].configuration_revision);
   const configured=await streams.configure(f.installed.installationId,revision,{localVenueId:venueId,sourceNodeId:nodeId,pointerSignerPublicKey:pointerKey.publicKey.export({type:'spki',format:'der'}).toString('base64')});
   await streams.observe(f.installed.installationId,configured.configurationRevision);
  }
  const target=machineTarget(),version=source==='snapshot'?2:1,requests=new RecoveryRequests(db.pool,f.vault,origin,undefined,'test-venue-levels'),recovery=new BackupRecovery(db.pool,f.vault,origin,undefined,'test-venue-levels');
  await requests.machine('start',target.envelope('start','',Date.now(),origin,version));
  await requests.approve(target.id,target.code,f.session.token,f.session.csrfToken,source==='snapshot'?f.input:{source:'continuous',venueId,oldServerUnavailable:true,acceptDataLoss:true});
  await recovery.target(target.id,'restored',target.envelope('restored',source==='snapshot'?f.point.digest:streamRecoveryDigest(`gen-2-${nodeId}-20261030T090000Z`),Date.now(),origin,version));
  const key=generateKeyPairSync('ed25519'),localVenueId=(await db.pool.query('SELECT local_venue_id FROM venues WHERE id=$1',[venueId])).rows[0].local_venue_id;
  const proposed={id:target.id,localVenueId,nodeId,publicKey:key.publicKey.export({type:'spki',format:'der'}).toString('base64url'),peerPublicKey:randomBytes(32).toString('base64')};
  function proof(action:'prepare'|'status',issuedAt=Date.now()){
   const bytes=replacementPayload(origin,action,proposed,issuedAt);
   return {id:target.id,payload:bytes.toString('base64url'),signature:target.sign(bytes),keySignature:sign(null,bytes,key.privateKey).toString('base64url')};
  }
  const app=createAccountApp({pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]},planMode:'test-venue-levels',leaseIssuer:createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url')),captures:{vault:f.vault,objects:()=>f.store,async grant(){throw new Error('replacement must not issue data credentials');}}});
  const confirmation={oldInstallationId:f.installed.installationId,oldServerUnavailable:'true',confirmReplacement:'true'};
  async function machine(action:'prepare'|'status',envelope=proof(action)){
   return app.request(origin+'/api/replacement/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(envelope)},{incoming:{socket:{remoteAddress:'192.0.2.1'}}});
  }
  async function account(action:'inspect'|'replace'|'close',extra:Record<string,string>={},headers:Record<string,string>={}){
   return app.request(origin+'/api/account/recovery/'+action,{method:'POST',headers:{'content-type':'application/json',origin,cookie:'__Host-cloud_session='+f.session.token,'x-csrf-token':f.session.csrfToken,...headers},body:JSON.stringify({requestId:target.id,code:target.code,...(action==='replace'?confirmation:{}),...extra})},{incoming:{socket:{remoteAddress:'192.0.2.1'}}});
  }
  async function state(){const value:Record<string,unknown>={};for(const table of ['installations','backup_locations','backup_key_versions','backup_points','backup_recoveries','backup_managed_streams','installation_replacements','security_audit_events'])value[table]=(await db.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;return value;}
  return {...f,db,venueId,target,proposed,proof,level,machine,account,state,close:()=>db.close()};
 }catch(error){await db.close();throw error;}
}
async function json(response:Response,status:number){assert.equal(response.status,status,await response.clone().text());return response.json();}
async function refused(response:Response,status:number,error:string){assert.deepEqual(await json(response,status),{error});}

// Dropping the mode at either HTTP composition point must not silently use the permissive legacy default.
for(const source of ['snapshot','continuous'] as const)test(`venue ${source} replacement HTTP refuses machine proposals at level one`,async()=>{
 const f=await fixture(source);try{
  await f.level('registered');const before=await f.state();
  await refused(await f.machine('prepare'),403,'permission_denied');
  assert.deepEqual(await f.state(),before);assert.equal((await json(await f.account('inspect'),200)).replacement,null);
 }finally{await f.close();}
});

for(const source of ['snapshot','continuous'] as const)test(`venue ${source} replacement HTTP refuses activation but retains owner inspection and close`,async()=>{
 const f=await fixture(source);try{
  const proposal=await json(await f.machine('prepare'),200);await f.level('registered');const before=await f.state(),objects=new Map(f.objects);
  await refused(await f.account('replace'),403,'permission_denied');
  for(const action of ['prepare','status'] as const)await refused(await f.machine(action),403,'permission_denied');
  const inspected=await json(await f.account('inspect'),200);assert.equal(inspected.operation.status,'restored');
  assert.equal(inspected.replacement.state,'awaiting_owner');assert.equal(inspected.replacement.publicKey,proposal.publicKey);
  assert.equal(inspected.replacement.source.kind,source);assert.deepEqual(await f.state(),before);
  const closed=await json(await f.account('close'),200);assert.equal(closed.operation.status,'closed');assert.equal(closed.replacement.state,'awaiting_owner');
  assert.deepEqual(f.objects,objects);
 }finally{await f.close();}
});

// Machine responses retain their exact existing fields while the owner view includes the chosen recovery source.
for(const source of ['snapshot','continuous'] as const)for(const level of ['connected','hosted'] as const)test(`venue ${source} replacement HTTP at ${level} keeps the machine wire and activates once`,async()=>{
 const f=await fixture(source,level);try{
  const points=(await f.db.pool.query('SELECT * FROM backup_points ORDER BY id')).rows,objects=new Map(f.objects);
  const proposal=await json(await f.machine('prepare'),200);
  const fields=['requestId','pointId','venueId','oldInstallationId','localVenueId','nodeId','environment','publicKey','peerPublicKey','state','expiresAt','organisationName','legalBusinessName','registration'];
  assert.deepEqual(Object.keys(proposal).sort(),fields.sort());assert.equal(proposal.state,'awaiting_owner');assert.equal(proposal.registration,null);
  assert.equal(proposal.venueId,f.venueId);assert.equal(proposal.pointId,source==='snapshot'?f.point.id:null);assert.equal(proposal.nodeId,f.proposed.nodeId);
  const completed=await json(await f.account('replace'),200),replacement=completed.replacement;
  assert.equal(replacement.state,'complete');assert.equal(replacement.source.kind,source);assert.equal(replacement.registration.venueId,f.venueId);
  assert.notEqual(replacement.registration.installationId,f.installed.installationId);
  assert.deepEqual(await json(await f.account('replace'),200),completed);
  const {source:_ownerSource,...machineView}=replacement;
  for(const action of ['prepare','status'] as const)assert.deepEqual(await json(await f.machine(action),200),machineView);
  assert.deepEqual((await f.db.pool.query('SELECT * FROM backup_points ORDER BY id')).rows,points);assert.deepEqual(f.objects,objects);
  assert.equal((await f.db.pool.query('SELECT count(*) FROM installations WHERE venue_id=$1',[f.venueId])).rows[0].count,'2');
  assert.equal((await f.db.pool.query('SELECT count(*) FROM backup_key_versions WHERE venue_id=$1',[f.venueId])).rows[0].count,'2');
  assert.equal((await f.db.pool.query("SELECT count(*) FROM security_audit_events WHERE event_type='replacement.approved' AND source_id=$1",[f.target.id])).rows[0].count,'1');
  for(const secret of ['recoveryKey','credentials','synthetic-secret'])assert.equal(JSON.stringify(completed).includes(secret),false);
 }finally{await f.close();}
});

for(const source of ['snapshot','continuous'] as const)test(`venue ${source} replacement HTTP completed replay refuses a downgrade`,async()=>{
 const f=await fixture(source);try{
  await json(await f.machine('prepare'),200);const completed=await json(await f.account('replace'),200);
  await f.level('registered');const before=await f.state();
  for(const action of ['prepare','status'] as const)await refused(await f.machine(action),403,'permission_denied');
  await refused(await f.account('replace'),403,'permission_denied');
  assert.deepEqual((await json(await f.account('inspect'),200)).replacement,completed.replacement);assert.deepEqual(await f.state(),before);
 }finally{await f.close();}
});

for(const source of ['snapshot','continuous'] as const)test(`venue ${source} replacement HTTP authenticates both proofs before reporting level refusal`,async()=>{
 const f=await fixture(source);try{
  await f.level('registered');const before=await f.state(),proof=f.proof('prepare'),forged=machineTarget().sign(Buffer.from('forged'));
  for(const field of ['signature','keySignature'] as const)await refused(await f.machine('prepare',{...proof,[field]:forged}),401,'invalid_proof');
  await refused(await f.machine('prepare',f.proof('prepare',Date.now()-61000)),401,'invalid_proof');
  await refused(await f.machine('prepare'),403,'permission_denied');assert.deepEqual(await f.state(),before);
 }finally{await f.close();}
});

for(const source of ['snapshot','continuous'] as const)test(`venue ${source} replacement HTTP retains confirmation session owner and binding guards`,async()=>{
 const f=await fixture(source);try{
  await json(await f.machine('prepare'),200);const before=await f.state();
  await refused(await f.account('replace',{confirmReplacement:'false'}),400,'confirmation_required');
  await refused(await f.account('replace',{oldInstallationId:randomUUID()}),409,'conflict');
  const csrf=await f.account('replace',{}, {'x-csrf-token':'wrong'});assert.equal(csrf.status,403,await csrf.text());
  const session=await f.account('replace',{}, {cookie:''});assert.equal(session.status,401,await session.text());
  f.proposed.nodeId=randomUUID();await refused(await f.machine('prepare'),409,'conflict');
  await f.db.pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',[f.owner.accountId]);
  await refused(await f.account('replace'),403,'permission_denied');await refused(await f.account('inspect'),403,'permission_denied');
  assert.deepEqual(await f.state(),before);
 }finally{await f.close();}
});
