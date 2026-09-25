import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {login} from '@waitron-cloud/identity';
import {SignupStore,RegistrationStore,InstallationStore,MonitorWorker,encodeMachine,transaction,createLeaseIssuer} from '@waitron-cloud/registration';
import {database} from '../../account-http/test/fixtures.ts';
import {BackupKeyVault} from '../src/keys.ts';
import {BackupCaptures} from '../src/captures.ts';
import {BackupCatalogue} from '../src/catalogue.ts';
import {BackupRecovery,recoveryPayload} from '../src/recovery.ts';
import {RecoveryRequests,requestPayload} from '../src/recovery-request.ts';
import {ReplacementStore,replacementPayload} from '../src/replacement.ts';
import {venueOverview} from '../../account-http/src/venue-overview.ts';
import {createAccountApp} from '../../account-http/src/app.ts';
import {RemoteAccessStore} from '../../remote-access/src/placement.ts';
import {receipt} from '../src/storage.ts';
let db:Awaited<ReturnType<typeof database>>;
before(async()=>{db=await database();});after(async()=>db?.close());
const origin='https://cloud.test';
function target(){const key=generateKeyPairSync('ed25519');return {id:randomUUID(),code:'12345678',publicKey:key.publicKey.export({type:'spki',format:'der'}).toString('base64url'),proof(action:'start'|'status',now=Date.now(),at=origin){const b=requestPayload(at,this.id,action,this.publicKey,this.code,now);return {payload:b.toString('base64url'),signature:sign(null,b,key.privateKey).toString('base64url')};},sign(bytes:Buffer){return sign(null,bytes,key.privateKey).toString('base64url');},recovery(action:'info'|'read'|'restored',digest=''){const b=recoveryPayload(origin,this.id,action,digest,Date.now());return {payload:b.toString('base64url'),signature:sign(null,b,key.privateKey).toString('base64url')};}};}
async function fixture(){
 const vault=new BackupKeyVault(randomBytes(32)),objects=new Map<string,Buffer>(),catalogue=new BackupCatalogue(db.pool,vault,()=>({async read(k){return objects.get(k)!;},async put(k,b){objects.set(k,Buffer.from(b));return receipt(b);},async remove(k){objects.delete(k);}}));
 const email=randomUUID()+'@example.test',password='a long enough recovery password',signup=new SignupStore(db.pool,db.outbox);
 await signup.request(email);const mail=db.outbox.open((await db.pool.query('SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT 1')).rows[0]);assert('token' in mail);
 const owner=await signup.complete(mail.token,{password,organisationName:email,legalBusinessName:'Recovery SL',countryCode:'ES'}),session=await transaction(db.pool,c=>login(c,{email,password}));
 const installedKey=target(),reg=new RegistrationStore(db.pool),binding={operationId:randomUUID(),installationKey:installedKey.publicKey,localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
 await reg.start(binding);await reg.approveCloud(binding,owner.accountId);await reg.approveLocal(binding,randomUUID());const installed=await reg.complete(binding);
 await catalogue.provision(installed.installationId,{endpoint:'https://store.test',bucket:'recovery-'+randomUUID(),region:'local'});const capture=await catalogue.reserveCapture(installed.installationId,randomUUID()),bytes=Buffer.from('encrypted archive');objects.set(capture.incomingKey,bytes);
 const point=await catalogue.publish(installed.installationId,capture.id,{...receipt(bytes),capturedAt:new Date().toISOString(),retention:'daily',sourceNodeId:randomUUID(),modules:{core:1}});await catalogue.verify(point.id,'test',async()=>{});
 return {installedKey,reg,binding,owner,session,installed,point,capture,vault,objects,catalogue,recovery:new BackupRecovery(db.pool,vault,origin),requests:new RecoveryRequests(db.pool,vault,origin)};
}

async function ready(){
 const f=await fixture(),t=target();await f.requests.machine('start',t.proof('start'));
 await f.requests.approve(t.id,t.code,f.session.token,f.session.csrfToken,{pointId:f.point.id,oldServerUnavailable:true,acceptDataLoss:true});
  await f.recovery.target(t.id,'restored',t.recovery('restored',f.point.digest));
 const key=generateKeyPairSync('ed25519'),publicKey=key.publicKey.export({type:'spki',format:'der'}).toString('base64url'),peerPublicKey=randomBytes(32).toString('base64');
 const localVenueId=(await db.pool.query('SELECT local_venue_id FROM venues WHERE id=$1',[f.installed.venueId])).rows[0].local_venue_id;
 const proposed={id:t.id,localVenueId,nodeId:f.point.sourceNodeId,publicKey,peerPublicKey};
 const envelope=(action:'prepare'|'status')=>{const bytes=replacementPayload(origin,action,proposed,Date.now());return {id:t.id,payload:bytes.toString('base64url'),signature:t.sign(bytes),keySignature:sign(null,bytes,key.privateKey).toString('base64url')};};
 return {...f,t,key,proposed,envelope,store:new ReplacementStore(db.pool,f.vault,origin)};
}
test('restored replacement preserves venue and history, retires old authority, and replays one result',async()=>{
 const f=await ready();
 const proposal=await f.store.machine('prepare',f.envelope('prepare'));
 assert.equal(proposal.state,'awaiting_owner');assert.equal(proposal.oldInstallationId,f.installed.installationId);
 assert.deepEqual(await f.store.machine('prepare',f.envelope('prepare')),proposal);
 assert.equal((await db.pool.query('SELECT revoked_at FROM installations WHERE id=$1',[f.installed.installationId])).rows[0].revoked_at,null);
 const confirmations={oldInstallationId:f.installed.installationId,oldServerUnavailable:true,confirmReplacement:true};
 const result=await f.store.complete(f.t.id,f.session.token,f.session.csrfToken,confirmations);
 assert.equal(result.state,'complete');assert.equal(result.registration.venueId,f.installed.venueId);assert.notEqual(result.registration.installationId,f.installed.installationId);
 assert.deepEqual(await f.store.complete(f.t.id,f.session.token,f.session.csrfToken,confirmations),result);
 assert.deepEqual(await f.store.machine('status',f.envelope('status')),result);
 const rows=(await db.pool.query('SELECT * FROM installations WHERE venue_id=$1',[f.installed.venueId])).rows;
 assert.equal(rows.length,2);const old=rows.find(r=>r.id===f.installed.installationId);assert(old.revoked_at);assert.equal(old.superseded_by,result.registration.installationId);
 assert.equal(rows.filter(r=>!r.superseded_by).length,1);
 assert.equal((await db.pool.query('SELECT installation_id FROM backup_points WHERE id=$1',[f.point.id])).rows[0].installation_id,f.installed.installationId);
 await assert.rejects(f.catalogue.reserveCapture(f.installed.installationId,randomUUID()),/revoked/);
 const capture=await f.catalogue.reserveCapture(result.registration.installationId,randomUUID());assert.equal(capture.keyVersion,2);assert.notEqual(capture.keys.recoveryKey,f.capture.keys.recoveryKey);
 const states=(await db.pool.query('SELECT * FROM installation_services WHERE installation_id=$1',[result.registration.installationId])).rows;assert.equal(states.length,3);assert(states.every(s=>s.state!=='ready'));
 await db.pool.query("UPDATE backup_recoveries SET expires_at=clock_timestamp()-interval '1 day',status='closed' WHERE id=$1",[f.t.id]);
 assert.deepEqual(await f.store.machine('status',f.envelope('status')),result);
 await db.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[result.registration.installationId]);
 await assert.rejects(f.store.machine('status',f.envelope('status')),/revoked/);
});
const confirm=(f:Awaited<ReturnType<typeof ready>>)=>({oldInstallationId:f.installed.installationId,oldServerUnavailable:true,confirmReplacement:true});
test('an abandoned proposal does not prevent a new recovery replacing the same installation',async()=>{
 const f=await ready();await f.store.machine('prepare',f.envelope('prepare'));await f.recovery.close(f.session.token,f.session.csrfToken,f.t.id);
 const t=target();await f.requests.machine('start',t.proof('start'));await f.requests.approve(t.id,t.code,f.session.token,f.session.csrfToken,{pointId:f.point.id,oldServerUnavailable:true,acceptDataLoss:true});await f.recovery.target(t.id,'restored',t.recovery('restored',f.point.digest));
 const key=generateKeyPairSync('ed25519'),c={...f.proposed,id:t.id,publicKey:key.publicKey.export({type:'spki',format:'der'}).toString('base64url'),peerPublicKey:randomBytes(32).toString('base64')};const b=replacementPayload(origin,'prepare',c,Date.now());
 assert.equal((await f.store.machine('prepare',{id:t.id,payload:b.toString('base64url'),signature:t.sign(b),keySignature:sign(null,b,key.privateKey).toString('base64url')})).state,'awaiting_owner');
 await assert.rejects(f.store.complete(f.t.id,f.session.token,f.session.csrfToken,confirm(f)),/unavailable/);
});
test('completion rechecks the verified snapshot and rolls all authority changes back',async()=>{
 const f=await ready();await f.store.machine('prepare',f.envelope('prepare'));await db.pool.query("UPDATE backup_points SET verification='failed' WHERE id=$1",[f.point.id]);
 await assert.rejects(f.store.complete(f.t.id,f.session.token,f.session.csrfToken,confirm(f)),/unavailable/);
 assert.equal((await db.pool.query('SELECT revoked_at FROM installations WHERE id=$1',[f.installed.installationId])).rows[0].revoked_at,null);
});
test('fresh remote peer replaces only this venue while preserving hostnames, address and history',async()=>{
 const f=await ready(),other=await fixture(),remote=new RemoteAccessStore(db.pool),cell=randomUUID();await remote.createCell({id:cell,country:'ES',provider:'aws',environment:'test',suffix:'replacement.test',subnet:42,publicKey:randomBytes(32).toString('base64'),endpoint:'gateway.test:51820'});
 const old=await remote.provision(f.installed.installationId,cell,randomBytes(32).toString('base64')),neighbour=await remote.provision(other.installed.installationId,cell,randomBytes(32).toString('base64'));
 await f.store.machine('prepare',f.envelope('prepare'));const [a,b]=await Promise.all([f.store.complete(f.t.id,f.session.token,f.session.csrfToken,confirm(f)),new ReplacementStore(db.secondPool,f.vault,origin).complete(f.t.id,f.session.token,f.session.csrfToken,confirm(f))]);assert.deepEqual(a,b);
 const manifest=await remote.manifest(cell),route=manifest.routes.find(r=>r.venueId===f.installed.venueId)!;
 assert.equal(route.installationId,a.registration.installationId);assert.equal(route.peerPublicKey,f.proposed.peerPublicKey);for(const field of ['staffHostname','publicHostname','address','port'] as const)assert.equal(route[field],old[field]);
 assert.equal(manifest.routes.find(r=>r.venueId===other.installed.venueId)!.peerPublicKey,neighbour.peerPublicKey);assert(!JSON.stringify(manifest).includes(old.peerPublicKey));
});
test('proofs, actual restore, owner authority, confirmations and changed bindings are required',async()=>{
 const f=await ready();
 await assert.rejects(f.store.machine('prepare',f.envelope('status')),/invalid_proof/);
 await assert.rejects(f.store.machine('prepare',{...f.envelope('prepare'),signature:target().sign(Buffer.from('wrong'))}),/invalid_proof/);
 await assert.rejects(f.store.machine('prepare',{...f.envelope('prepare'),keySignature:target().sign(Buffer.from('wrong'))}),/invalid_proof/);
 await db.pool.query("UPDATE backup_recoveries SET status='pending' WHERE id=$1",[f.t.id]);await assert.rejects(f.store.machine('prepare',f.envelope('prepare')),/unavailable/);await db.pool.query("UPDATE backup_recoveries SET status='restored' WHERE id=$1",[f.t.id]);
 const node=f.proposed.nodeId;f.proposed.nodeId=randomUUID();await assert.rejects(f.store.machine('prepare',f.envelope('prepare')),/conflict/);f.proposed.nodeId=node;
 await f.store.machine('prepare',f.envelope('prepare'));f.proposed.peerPublicKey=randomBytes(32).toString('base64');await assert.rejects(f.store.machine('prepare',f.envelope('prepare')),/conflict/);
 const foreign=await fixture();await assert.rejects(f.store.complete(f.t.id,foreign.session.token,foreign.session.csrfToken,confirm(f)),/permission_denied/);
 await assert.rejects(f.store.complete(f.t.id,f.session.token,f.session.csrfToken,{...confirm(f),confirmReplacement:false}),/confirmation_required/);
 await assert.rejects(f.store.complete(f.t.id,f.session.token,f.session.csrfToken,{...confirm(f),oldInstallationId:randomUUID()}),/conflict/);
 await db.pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',[f.owner.accountId]);await assert.rejects(f.store.complete(f.t.id,f.session.token,f.session.csrfToken,confirm(f)),/permission_denied/);
});
for(const deadline of ['recovery','session'])test(`replacement rolls back when ${deadline} expires waiting for a resource`,async()=>{
 const f=await ready();await f.store.machine('prepare',f.envelope('prepare'));
 if(deadline==='recovery')await db.pool.query("UPDATE backup_recoveries SET expires_at=clock_timestamp()+interval '1 second' WHERE id=$1",[f.t.id]);else await db.pool.query("UPDATE cloud_sessions SET absolute_expires_at=clock_timestamp()+interval '1 second' WHERE account_id=$1",[f.owner.accountId]);
 const lock=await db.secondPool.connect();let pending:Promise<unknown>|undefined;
 try{await lock.query('BEGIN');await lock.query('SELECT venue_id FROM backup_locations WHERE venue_id=$1 FOR UPDATE',[f.installed.venueId]);pending=f.store.complete(f.t.id,f.session.token,f.session.csrfToken,confirm(f));const rejects=assert.rejects(pending,deadline==='recovery'?/unavailable/:/session_expired/);void rejects.catch(()=>{});
 let waited=false;for(let i=0;i<150;i++){if((await db.secondPool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE '%FOR UPDATE OF l%'",[db.schema])).rowCount){waited=true;break;}await new Promise(r=>setTimeout(r,10));}assert(waited);await new Promise(r=>setTimeout(r,1100));await lock.query('COMMIT');await rejects;
 assert.equal((await db.pool.query('SELECT revoked_at FROM installations WHERE id=$1',[f.installed.installationId])).rows[0].revoked_at,null);assert.equal((await db.pool.query('SELECT active_key_version FROM backup_locations WHERE venue_id=$1',[f.installed.venueId])).rows[0].active_key_version,1);
 }finally{await lock.query('ROLLBACK');lock.release();await pending?.catch(()=>{});}
});
test('HTTP requires two proofs, matching owner code and explicit confirmation; responses contain no keys or storage grants',async()=>{
 const f=await ready();const app=createAccountApp({pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]},leaseIssuer:createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url')),captures:{vault:f.vault,objects:()=>({async read(){throw Error();},async put(){throw Error();},async remove(){throw Error();}}),async grant(){throw Error('replacement must not issue storage grants');}}});
 const post=(path:string,body:unknown,owner=false,headers:Record<string,string>={},ip='192.0.2.234')=>app.request(origin+path,{method:'POST',headers:{'content-type':'application/json',...(owner?{origin,cookie:'__Host-cloud_session='+f.session.token,'x-csrf-token':f.session.csrfToken}:{}),...headers},body:JSON.stringify(body)},{incoming:{socket:{remoteAddress:ip}}});
 const owner=(action:string,extra:Record<string,string>={})=>post('/api/account/recovery/'+action,{requestId:f.t.id,code:f.t.code,...extra},true);
 assert.equal((await post('/api/replacement/prepare',f.envelope('prepare'),false,{origin})).status,403);
 assert.equal((await post('/api/replacement/prepare',f.envelope('prepare'))).status,200);
 const inspected=await owner('inspect');assert.equal(inspected.status,200);assert.equal((await inspected.json()).replacement.state,'awaiting_owner');
 assert.equal((await owner('replace',{oldInstallationId:f.installed.installationId,oldServerUnavailable:'true',confirmReplacement:'false'})).status,400);
 const body={requestId:f.t.id,code:f.t.code,oldInstallationId:f.installed.installationId,oldServerUnavailable:'true',confirmReplacement:'true'};
 assert.equal((await post('/api/account/recovery/replace',body,true,{'x-csrf-token':'wrong'})).status,403);
 assert.equal((await post('/api/account/recovery/replace',{...body,code:'00000000'},true)).status,410);
 const done=await post('/api/account/recovery/replace',body,true);assert.equal(done.status,200);const result=await done.json();assert.equal(result.replacement.state,'complete');assert(!JSON.stringify(result).includes(f.capture.keys.recoveryKey));assert(!JSON.stringify(result).includes('secretAccessKey'));
 const closed=await owner('close');assert.equal(closed.status,200);assert.equal((await closed.json()).replacement.state,'complete');
 for(let n=0;n<29;n++)assert.equal((await post('/api/replacement/status',f.envelope('status'),false,{},'198.51.100.'+(n+1))).status,200);
 assert.equal((await post('/api/replacement/status',f.envelope('status'),false,{},'198.51.100.101')).status,429);
});
test('current installation consumers preserve one venue and do not inherit the old disconnected incident',async()=>{
 const f=await ready();await db.pool.query("INSERT INTO venue_monitors(venue_id,checked_at,contact_since) VALUES($1,clock_timestamp(),clock_timestamp()-interval '1 day')",[f.installed.venueId]);
 await db.pool.query("INSERT INTO venue_incidents(venue_id,kind,status,revision) VALUES($1,'disconnected','open',1)",[f.installed.venueId]);
 await f.store.machine('prepare',f.envelope('prepare'));const result=await f.store.complete(f.t.id,f.session.token,f.session.csrfToken,confirm(f));
 const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url')),store=new InstallationStore(db.pool,issuer,origin);
 const list=await store.listWithSession(f.session.token);assert.equal(list.length,1);assert.equal(list[0]!.installationId,result.registration.installationId);assert(list[0]!.services.every(s=>s.health==='unknown'));
 const overview=await venueOverview(db.pool,f.session.token,list);assert.equal(overview.length,1);assert.equal(overview[0]!.monitoring.fresh,false);assert.deepEqual(overview[0]!.monitoring.incidents,[]);
 // Keep unrelated fixtures out of this worker selection, so it must evaluate this current installation.
 await db.pool.query("UPDATE venue_monitors SET next_check_at=clock_timestamp()+interval '1 day' WHERE venue_id<>$1",[f.installed.venueId]);
 await new MonitorWorker(db.pool,db.outbox).runOnce();assert.equal((await db.pool.query("SELECT status FROM venue_incidents WHERE venue_id=$1 AND kind='disconnected'",[f.installed.venueId])).rows[0].status,'recovered');
 const unrelated={...f.binding,operationId:randomUUID(),installationKey:target().publicKey};await f.reg.start(unrelated);await f.reg.approveCloud(unrelated,f.owner.accountId);await f.reg.approveLocal(unrelated,randomUUID());await assert.rejects(f.reg.complete(unrelated));
 await db.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[result.registration.installationId]);await assert.rejects(f.reg.complete(unrelated));
});
test('replacement during provider grant issuance refuses to disclose old installation credentials',async()=>{
 const f=await ready();await f.store.machine('prepare',f.envelope('prepare'));
 const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
 const lease=issuer.issue({origin,leaseId:randomUUID(),installationId:f.installed.installationId,venueId:f.installed.venueId,environment:'test',publicKey:f.installedKey.publicKey,issuedAt:Date.now(),expiresAt:Date.now()+600000});
 const bytes=encodeMachine({origin,action:'backup-reserve',installationId:f.installed.installationId,operationId:randomUUID(),issuedAt:Date.now(),lease:JSON.stringify(lease),body:'{}'});
 let granted=false;const captures=new BackupCaptures(db.pool,issuer,origin,{vault:f.vault,objects:()=>({async read(){throw Error();},async put(){throw Error();},async remove(){throw Error();}}),async grant(){granted=true;await new ReplacementStore(db.secondPool,f.vault,origin).complete(f.t.id,f.session.token,f.session.csrfToken,confirm(f));return {credentials:{accessKeyId:'access',secretAccessKey:'secret',sessionToken:'temporary'},expiresAt:new Date(Date.now()+600000).toISOString()};}});
 await assert.rejects(captures.execute('backup-reserve',{payload:bytes.toString('base64url'),signature:f.installedKey.sign(bytes)}),/revoked/);assert(granted);
});
