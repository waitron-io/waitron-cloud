import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {login} from '@waitron-cloud/identity';
import {SignupStore,RegistrationStore,transaction,createLeaseIssuer} from '@waitron-cloud/registration';
import {database} from '../../account-http/test/fixtures.ts';
import {BackupKeyVault} from '../src/keys.ts';
import {BackupCatalogue} from '../src/catalogue.ts';
import {BackupRecovery,recoveryPayload} from '../src/recovery.ts';
import {RecoveryRequests,requestPayload} from '../src/recovery-request.ts';
import {createAccountApp} from '../../account-http/src/app.ts';
import {receipt} from '../src/storage.ts';
import {ManagedStreams,type ManagedStreamAuthority} from '../src/managed-streams.ts';
let db:Awaited<ReturnType<typeof database>>;
before(async()=>{db=await database();});after(async()=>db?.close());
const origin='https://cloud.test';
function target(){const key=generateKeyPairSync('ed25519');return {id:randomUUID(),code:'12345678',publicKey:key.publicKey.export({type:'spki',format:'der'}).toString('base64url'),proof(action:'start'|'status',now=Date.now(),at=origin){const b=requestPayload(at,this.id,action,this.publicKey,this.code,now);return {payload:b.toString('base64url'),signature:sign(null,b,key.privateKey).toString('base64url')};},recovery(action:'info'|'read',digest=''){const b=recoveryPayload(origin,this.id,action,digest,Date.now());return {payload:b.toString('base64url'),signature:sign(null,b,key.privateKey).toString('base64url')};}};}
async function fixture(){
 const vault=new BackupKeyVault(randomBytes(32)),objects=new Map<string,Buffer>(),catalogue=new BackupCatalogue(db.pool,vault,()=>({async read(k){return objects.get(k)!;},async put(k,b){objects.set(k,Buffer.from(b));return receipt(b);},async remove(k){objects.delete(k);}}));
 const email=randomUUID()+'@example.test',password='a long enough recovery password',signup=new SignupStore(db.pool,db.outbox);
 await signup.request(email);const mail=db.outbox.open((await db.pool.query('SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT 1')).rows[0]);assert('token' in mail);
 const owner=await signup.complete(mail.token,{password,organisationName:email,legalBusinessName:'Recovery SL',countryCode:'ES'}),session=await transaction(db.pool,c=>login(c,{email,password}));
 const reg=new RegistrationStore(db.pool),binding={operationId:randomUUID(),installationKey:target().publicKey,localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
 await reg.start(binding);await reg.approveCloud(binding,owner.accountId);await reg.approveLocal(binding,randomUUID());const installed=await reg.complete(binding);
 await catalogue.provision(installed.installationId,{endpoint:'https://store.test',bucket:'recovery-'+randomUUID(),region:'local'});const capture=await catalogue.reserveCapture(installed.installationId,randomUUID()),bytes=Buffer.from('encrypted archive');objects.set(capture.incomingKey,bytes);
 const point=await catalogue.publish(installed.installationId,capture.id,{...receipt(bytes),capturedAt:new Date().toISOString(),retention:'daily',sourceNodeId:randomUUID(),modules:{core:1}});await catalogue.verify(point.id,'test',async()=>{});
 return {owner,session,installed,point,capture,vault,objects,catalogue,recovery:new BackupRecovery(db.pool,vault,origin),requests:new RecoveryRequests(db.pool,vault,origin)};
}
test('matching code creates exactly one owner-bound grant; target metadata contains no secrets',async()=>{
 const f=await fixture(),t=target(),pending=await f.requests.machine('start',t.proof('start'));
 assert.equal(pending.state,'awaiting_owner');assert.deepEqual(await f.requests.machine('start',t.proof('start')),pending);
 assert.equal((await f.requests.inspect(t.id,t.code,f.session.token,f.session.csrfToken)).state,'awaiting_owner');
 const input={pointId:f.point.id,oldServerUnavailable:true,acceptDataLoss:true};
 const [approved,concurrent]=await Promise.all([f.requests.approve(t.id,t.code,f.session.token,f.session.csrfToken,input),new RecoveryRequests(db.secondPool,f.vault,origin).approve(t.id,t.code,f.session.token,f.session.csrfToken,input)]);assert.deepEqual(approved,concurrent);
 assert.equal(approved.state,'approved');assert.equal(approved.operationId,t.id);
 const event=(await db.pool.query("SELECT * FROM security_audit_events WHERE event_type='recovery.approved' AND source_id=$1",[t.id])).rows[0];
 assert.equal(event.organisation_id,f.owner.organisationId);assert.equal(event.venue_id,f.installed.venueId);assert.equal(event.actor_kind,'account');assert.equal(event.actor_id,f.owner.accountId);assert.equal(event.subject_id,t.id);
 assert.deepEqual(await f.requests.approve(t.id,t.code,f.session.token,f.session.csrfToken,input),approved);
 assert.equal((await db.pool.query("SELECT count(*) FROM security_audit_events WHERE event_type='recovery.approved' AND source_id=$1",[t.id])).rows[0].count,'1');
 assert.equal((await f.requests.machine('status',t.proof('status'))).operationId,t.id);
 const info=await f.recovery.target(t.id,'info',t.recovery('info'));assert('point' in info);assert.equal(info.point.id,f.point.id);assert(!('keys' in info));assert(!('location' in info));
 assert(!JSON.stringify(approved).includes(f.capture.keys.recoveryKey));
 await assert.rejects(f.requests.approve(t.id,t.code,f.session.token,f.session.csrfToken,{...input,pointId:randomUUID()}));
 const foreign=await fixture();await assert.rejects(f.requests.inspect(t.id,t.code,foreign.session.token,foreign.session.csrfToken),/permission_denied/);
 await f.recovery.close(f.session.token,f.session.csrfToken,t.id);await assert.rejects(f.recovery.target(t.id,'info',t.recovery('info')),/unavailable/);
 assert.equal((await db.pool.query('SELECT count(*) FROM backup_recoveries WHERE id=$1',[t.id])).rows[0].count,'1');
 assert.equal((await db.pool.query('SELECT revoked_at FROM installations WHERE id=$1',[f.installed.installationId])).rows[0].revoked_at,null);
});
test('proof namespace, matching attempts, expiry and fresh-key bindings fail closed',async()=>{
 const f=await fixture(),t=target();await assert.rejects(f.requests.machine('start',t.proof('status')),/invalid_proof/);await assert.rejects(f.requests.machine('start',t.proof('start',Date.now()-120000)),/invalid_proof/);await assert.rejects(f.requests.machine('start',t.proof('start',Date.now(),'https://other.test')),/invalid_proof/);
 await f.requests.machine('start',t.proof('start'));const old=t.code;t.code='99999999';await assert.rejects(f.requests.machine('start',t.proof('start')),/conflict/);t.code=old;
 for(let i=0;i<5;i++)await assert.rejects(f.requests.inspect(t.id,'00000000',f.session.token,f.session.csrfToken),/unavailable/);
 assert.equal((await db.pool.query('SELECT failed_codes FROM backup_recovery_requests WHERE id=$1',[t.id])).rows[0].failed_codes,5);
 await assert.rejects(f.requests.inspect(t.id,t.code,f.session.token,f.session.csrfToken),/unavailable/);
 const expired=target();await f.requests.machine('start',expired.proof('start'));await db.pool.query("UPDATE backup_recovery_requests SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[expired.id]);await assert.rejects(f.requests.machine('status',expired.proof('status')),/unavailable/);
 const fresh=target();await f.requests.machine('start',fresh.proof('start'));const id=fresh.id;fresh.id=randomUUID();await assert.rejects(f.requests.machine('start',fresh.proof('start')),/target_not_fresh/);fresh.id=id;
 await assert.rejects(f.requests.approve(fresh.id,fresh.code,f.session.token,f.session.csrfToken,{pointId:f.point.id,oldServerUnavailable:false,acceptDataLoss:true}),/confirmation_required/);
 assert.equal((await db.pool.query('SELECT count(*) FROM backup_recoveries WHERE id=$1',[fresh.id])).rows[0].count,'0');
 assert.equal((await db.pool.query("SELECT count(*) FROM security_audit_events WHERE event_type='recovery.approved' AND source_id=$1",[fresh.id])).rows[0].count,'0');
});
test('HTTP gives the proven target one-object read authority, never browser keys; cancellation and owner loss during provider wait refuse the grant',async()=>{
 const f=await fixture(),t=target(),scopes:unknown[]=[];let lifetime=900000;let revoke:()=>Promise<void>=async()=>{};
 const app=createAccountApp({pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]},leaseIssuer:createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url')),captures:{vault:f.vault,objects:()=>({async read(k){return f.objects.get(k)!;},async put(k,b){f.objects.set(k,Buffer.from(b));return receipt(b);},async remove(k){f.objects.delete(k);}}),async grant(_location,scope){scopes.push(scope);await revoke();return {credentials:{accessKeyId:'access',secretAccessKey:'secret',sessionToken:'temporary'},expiresAt:new Date(Date.now()+lifetime).toISOString()};}}});
 const bindings={incoming:{socket:{remoteAddress:'192.0.2.1'}}};
 const post=(path:string,body:unknown,owner=false,extra:Record<string,string>={})=>app.request(origin+path,{method:'POST',headers:{'content-type':'application/json',...(owner?{origin,cookie:'__Host-cloud_session='+f.session.token,'x-csrf-token':f.session.csrfToken}:{}),...extra},body:JSON.stringify(body)},bindings);
 const browser=(action:string,body:Record<string,string>={})=>post('/api/account/recovery/'+action,{requestId:t.id,code:t.code,...body},true);
 assert.equal((await post('/api/recovery/start',t.proof('start'))).status,200);
 assert.equal((await post('/api/recovery/start',t.proof('start'),false,{origin})).status,403);
 assert.equal((await browser('inspect')).status,200);
 assert.equal((await browser('approve',{pointId:f.point.id,oldServerUnavailable:'false',acceptDataLoss:'true'})).status,400);
 const approval=await browser('approve',{pointId:f.point.id,oldServerUnavailable:'true',acceptDataLoss:'true'});assert.equal(approval.status,200);assert(!JSON.stringify(await approval.json()).includes('recoveryKey'));
 assert.equal((await post('/api/account/recovery/inspect',{requestId:t.id,code:t.code},true,{'x-csrf-token':'wrong'})).status,403);
 const info=await post('/api/recovery/info',{id:t.id,...t.recovery('info')});assert.equal(info.status,200);assert(!JSON.stringify(await info.json()).includes('keys'));
 const read=()=>post('/api/recovery/read',{id:t.id,...t.recovery('read',f.point.digest)});
 const access=await read();assert.equal(access.status,200);const grant=await access.json();assert.equal(grant.recoveryKey,f.capture.keys.recoveryKey);assert(!JSON.stringify(grant).includes(f.capture.keys.streamKey));assert.deepEqual(scopes,[{kind:'restore',bucket:f.capture.location.bucket,scope:f.point.objectKey}]);
 lifetime=-1;const malformed=await read();assert.equal(malformed.status,503);assert.deepEqual(await malformed.json(),{error:'temporarily_unavailable'});lifetime=900000;
 revoke=async()=>{await db.secondPool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',[f.owner.accountId]);};assert.equal((await read()).status,403);
 await db.pool.query('UPDATE organisation_memberships SET is_owner=true WHERE account_id=$1',[f.owner.accountId]);
 revoke=()=>f.recovery.close(f.session.token,f.session.csrfToken,t.id);assert.equal((await read()).status,410);
 assert.equal((await browser('inspect')).status,200);assert.equal((await browser('close')).status,200);
});
for(const deadline of ['request','session'])test(`approval rolls back if ${deadline} expires while waiting for venue lock`,async()=>{
 const f=await fixture(),t=target();await f.requests.machine('start',t.proof('start'));
 if(deadline==='request')await db.pool.query("UPDATE backup_recovery_requests SET expires_at=clock_timestamp()+interval '1 second' WHERE id=$1",[t.id]);
 else await db.pool.query("UPDATE cloud_sessions SET absolute_expires_at=clock_timestamp()+interval '1 second' WHERE account_id=$1",[f.owner.accountId]);
 const blocker=await db.secondPool.connect();let pending:Promise<unknown>|undefined;
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT venue_id FROM backup_locations WHERE venue_id=$1 FOR UPDATE',[f.installed.venueId]);
  pending=f.requests.approve(t.id,t.code,f.session.token,f.session.csrfToken,{pointId:f.point.id,oldServerUnavailable:true,acceptDataLoss:true});
  const assertion=assert.rejects(pending,deadline==='request'?/unavailable/:/session_expired/);
  const until=Date.now()+1500;let waited=false;while(Date.now()<until){if((await db.secondPool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE '%FOR UPDATE OF l%'",[db.schema])).rowCount){waited=true;break;}await new Promise(r=>setTimeout(r,10));}assert(waited,'approval must reach the venue lock');
  await new Promise(r=>setTimeout(r,1100));await blocker.query('COMMIT');await assertion;
  assert.equal((await db.pool.query('SELECT count(*) FROM backup_recoveries WHERE id=$1',[t.id])).rows[0].count,'0');assert.equal((await db.pool.query('SELECT operation_id FROM backup_recovery_requests WHERE id=$1',[t.id])).rows[0].operation_id,null);
  assert.equal((await db.pool.query("SELECT count(*) FROM security_audit_events WHERE event_type='recovery.approved' AND source_id=$1",[t.id])).rows[0].count,'0');
 }finally{await blocker.query('ROLLBACK');blocker.release();await pending?.catch(()=>{});}
});
test('incorrect codes cannot lock an already approved owner out of cancellation',async()=>{
 const f=await fixture(),t=target();await f.requests.machine('start',t.proof('start'));await f.requests.approve(t.id,t.code,f.session.token,f.session.csrfToken,{pointId:f.point.id,oldServerUnavailable:true,acceptDataLoss:true});
 for(let n=0;n<5;n++)await assert.rejects(f.requests.inspect(t.id,'00000000',f.session.token,f.session.csrfToken),/unavailable/);
 assert.equal((await f.requests.inspect(t.id,t.code,f.session.token,f.session.csrfToken)).operationId,t.id);
});
test('a recovery expiring during key lookup cannot disclose an archive key',async()=>{
 const f=await fixture(),t=target();await f.requests.machine('start',t.proof('start'));await f.requests.approve(t.id,t.code,f.session.token,f.session.csrfToken,{pointId:f.point.id,oldServerUnavailable:true,acceptDataLoss:true});
 await db.pool.query("UPDATE backup_recoveries SET expires_at=clock_timestamp()+interval '1 second' WHERE id=$1",[t.id]);
 const blocker=await db.secondPool.connect();let pending:Promise<unknown>|undefined;
 try{
  await blocker.query('BEGIN');await blocker.query('LOCK backup_key_versions IN ACCESS EXCLUSIVE MODE');pending=f.recovery.target(t.id,'read',t.recovery('read',f.point.digest));const rejected=assert.rejects(pending,/unavailable/);void rejected.catch(()=>{});
  let waiting=false;const until=Date.now()+1500;while(Date.now()<until){if((await db.secondPool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE 'SELECT sealed FROM backup_key_versions%'",[db.schema])).rowCount){waiting=true;break;}await new Promise(r=>setTimeout(r,10));}assert(waiting);
  await new Promise(r=>setTimeout(r,1100));await blocker.query('COMMIT');await rejected;
 }finally{await blocker.query('ROLLBACK');blocker.release();await pending?.catch(()=>{});}
});
test('guided recovery rejects continuous points even when verified',async()=>{
 const f=await fixture(),t=target();await f.requests.machine('start',t.proof('start'));
 await db.pool.query("UPDATE backup_points SET kind='continuous' WHERE id=$1",[f.point.id]);
 await assert.rejects(f.requests.approve(t.id,t.code,f.session.token,f.session.csrfToken,{pointId:f.point.id,oldServerUnavailable:true,acceptDataLoss:true}),/unavailable/);
 assert.equal((await db.pool.query('SELECT count(*) FROM backup_recoveries WHERE id=$1',[t.id])).rows[0].count,'0');
});
test('target metadata and download access refuse a continuous record',async()=>{
 const f=await fixture(),t=target();await f.requests.machine('start',t.proof('start'));await f.requests.approve(t.id,t.code,f.session.token,f.session.csrfToken,{pointId:f.point.id,oldServerUnavailable:true,acceptDataLoss:true});
 await db.pool.query("UPDATE backup_points SET kind='continuous' WHERE id=$1",[f.point.id]);
 await assert.rejects(f.recovery.target(t.id,'info',t.recovery('info')),/unavailable/);
 await assert.rejects(f.recovery.target(t.id,'read',t.recovery('read',f.point.digest)),/unavailable/);
});
test('HTTP continuous recovery exposes fresh evidence and releases one exact Waitron kit after final authority checks',async()=>{
 const f=await fixture(),t=target(),signer=generateKeyPairSync('ed25519'),nodeId=randomUUID(),localVenueId=(await db.pool.query('SELECT local_venue_id FROM venues WHERE id=$1',[f.installed.venueId])).rows[0].local_venue_id,stored=new Map<string,Buffer>(),readerInputs:unknown[]=[];let readerHook=async()=>{};
 const authority:ManagedStreamAuthority&{reader(input:unknown):Promise<{accessKeyId:string;secretAccessKey:string}>}={
  async provision(){return {writerReference:'writer-ref',readerReference:'reader-ref',writerCredentials:{accessKeyId:'writer-id',secretAccessKey:'writer-secret'}};},
  async read(_reference,_location,key){const value=stored.get(key);if(!value)throw Error('missing');return value;},
  async reader(input){readerInputs.push(input);await readerHook();return {accessKeyId:'reader-id',secretAccessKey:'reader-secret'};},
 };
 const streams=new ManagedStreams(db.pool,f.vault,authority),revision=Number((await db.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[f.installed.installationId])).rows[0].configuration_revision),configured=await streams.configure(f.installed.installationId,revision,{localVenueId,sourceNodeId:nodeId,pointerSignerPublicKey:signer.publicKey.export({type:'spki',format:'der'}).toString('base64')}),writtenAt=new Date().toISOString(),generation=`gen-2-${nodeId}-${writtenAt.replace(/[-:.]/g,'').replace(/\d{3}Z$/,'Z')}`,body={venueId:localVenueId,term:2,nodeId,generation,writtenAt},message=`{"pointer":{"generation":"${generation}","nodeId":"${nodeId}","term":2,"venueId":"${localVenueId}","writtenAt":"${writtenAt}"},"purpose":"waitron.stream.pointer.v1"}`;
 stored.set(`${configured.bucket.prefix}venues/${localVenueId}/current.json`,Buffer.from(JSON.stringify({body,signature:sign(null,Buffer.from(message),signer.privateKey).toString('base64')})));await streams.observe(f.installed.installationId,configured.configurationRevision);
 const app=createAccountApp({pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]},leaseIssuer:createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url')),captures:{vault:f.vault,objects:()=>({async read(k){return f.objects.get(k)!;},async put(k,b){f.objects.set(k,Buffer.from(b));return receipt(b);},async remove(k){f.objects.delete(k);}}),async grant(){throw Error('snapshot grant must not run');},managedStreams:authority}});
 const bindings={incoming:{socket:{remoteAddress:'192.0.2.77'}}},post=(path:string,body:unknown,owner=false)=>app.request(origin+path,{method:'POST',headers:{'content-type':'application/json',...(owner?{origin,cookie:'__Host-cloud_session='+f.session.token,'x-csrf-token':f.session.csrfToken}:{})},body:JSON.stringify(body)},bindings);
 const catalogue=await post('/api/account/backups/list',{venueId:f.installed.venueId},true);assert.equal(catalogue.status,200);const page=await catalogue.json();assert.deepEqual(page.continuousRecovery,{recoverableAt:writtenAt,checkedAt:page.continuousRecovery.checkedAt,sourceNodeId:nodeId});assert(!JSON.stringify(page).includes(generation));assert(!JSON.stringify(page).includes('reader-ref'));
 assert.equal((await post('/api/recovery/start',t.proof('start'))).status,200);const approved=await post('/api/account/recovery/approve',{requestId:t.id,code:t.code,source:'continuous',venueId:f.installed.venueId,oldServerUnavailable:'true',acceptDataLoss:'true'},true);assert.equal(approved.status,200,await approved.clone().text());assert(!JSON.stringify(await approved.clone().json()).includes(generation));
 const infoResponse=await post('/api/recovery/info',{id:t.id,...t.recovery('info')});assert.equal(infoResponse.status,200);const info=await infoResponse.json();assert.equal(info.source.kind,'continuous');
 const read=()=>post('/api/recovery/read',{id:t.id,...t.recovery('read',info.source.sourceDigest)}),access=await read();assert.equal(access.status,200,await access.clone().text());const result=await access.json();assert.equal(result.source.kind,'continuous');assert.deepEqual(readerInputs[0],{reference:'reader-ref',venueId:f.installed.venueId,location:{endpoint:'https://store.test',bucket:configured.bucket.bucket,region:'local'},prefix:configured.bucket.prefix});assert.match(result.recoveryKit,/^WAITRON-RECOVERY-KIT-1:[A-Za-z0-9_-]+$/);const kit=JSON.parse(Buffer.from(result.recoveryKit.split(':')[1],'base64url').toString());assert.deepEqual(kit,{version:1,venueId:localVenueId,bucket:{endpoint:'https://store.test',region:'local',bucket:configured.bucket.bucket,prefix:configured.bucket.prefix,accessKeyId:'reader-id',secretAccessKey:'reader-secret'},recoveryKey:configured.recoveryKey,pointerSignerPublicKey:signer.publicKey.export({type:'spki',format:'der'}).toString('base64')});
 readerHook=async()=>{await db.secondPool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',[f.owner.accountId]);};const forbidden=await read();assert.equal(forbidden.status,403);assert(!JSON.stringify(await forbidden.json()).includes('reader-secret'));await db.pool.query('UPDATE organisation_memberships SET is_owner=true WHERE account_id=$1',[f.owner.accountId]);
 readerHook=()=>f.recovery.close(f.session.token,f.session.csrfToken,t.id);const refused=await read();assert.equal(refused.status,410);assert(!JSON.stringify(await refused.json()).includes('reader-secret'));
});
test('request expiry follows the database clock when the application clock runs behind',async(context)=>{
 const f=await fixture(),t=target();await f.requests.machine('start',t.proof('start'));await db.pool.query("UPDATE backup_recovery_requests SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[t.id]);
 const now=Date.now();context.mock.method(Date,'now',()=>now-300000);await assert.rejects(f.requests.machine('status',t.proof('status')),/unavailable/);
});
test('operation expiry follows the database clock when the application clock runs behind',async(context)=>{
 const f=await fixture(),t=target();await f.requests.machine('start',t.proof('start'));await f.requests.approve(t.id,t.code,f.session.token,f.session.csrfToken,{pointId:f.point.id,oldServerUnavailable:true,acceptDataLoss:true});await db.pool.query("UPDATE backup_recoveries SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[t.id]);
 const now=Date.now();context.mock.method(Date,'now',()=>now-300000);await assert.rejects(f.recovery.target(t.id,'read',t.recovery('read',f.point.digest)),/unavailable/);
});
test('machine limits follow the proven key across IPs and bound new requests per IP',async()=>{
 const f=await fixture(),t=target();await f.requests.machine('start',t.proof('start'));
 const app=createAccountApp({pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]},leaseIssuer:createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url')),captures:{vault:f.vault,objects:()=>({async read(){throw Error();},async put(){throw Error();},async remove(){throw Error();}}),async grant(){throw Error();}}});
 const post=(action:string,proof:unknown,ip:string)=>app.request(origin+'/api/recovery/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(proof)},{incoming:{socket:{remoteAddress:ip}}});
 for(let n=0;n<30;n++)assert.equal((await post('status',t.proof('status'),'198.51.100.'+(n+1))).status,200);
 assert.equal((await post('status',t.proof('status'),'198.51.100.100')).status,429);
 for(let n=0;n<10;n++){const next=target();assert.equal((await post('start',next.proof('start'),'203.0.113.89')).status,200);}
 const next=target();assert.equal((await post('start',next.proof('start'),'203.0.113.89')).status,429);
});
