import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {after,before,test} from 'node:test';
import {crypto as acmeCrypto} from 'acme-client';
import forge from 'node-forge';
import {SignupStore,RegistrationStore,OrganisationPlanStore,InstallationStore,createLeaseIssuer,encodeMachine,transaction,type MachineAction,type SignedEnvelope} from '@waitron-cloud/registration';
import {database} from '../../account-http/test/fixtures.ts';
import {createAccountApp} from '../../account-http/src/app.ts';
import {RemoteAccessStore} from '../src/placement.ts';
import {RemoteConfigurationReconciler} from '../src/reconciler.ts';
import {GatewayAuthority} from '../src/authority.ts';
import {signManifest,verifyManifest} from '../src/manifest.ts';

const mode='test-free-paid' as const,origin='https://cloud.example.test',password='A sufficiently long test password';
const peer=()=>randomBytes(32).toString('base64');
let db:Awaited<ReturnType<typeof database>>,plans:OrganisationPlanStore,store:RemoteAccessStore,ordinary:RemoteAccessStore,subnet=70;
const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
before(async()=>{db=await database();plans=new OrganisationPlanStore(db.pool);store=new RemoteAccessStore(db.pool,mode);ordinary=new RemoteAccessStore(db.pool);});
after(async()=>db?.close());
async function cell(){const id=randomUUID();await ordinary.createCell({id,country:'ES',provider:'aws',environment:'test',suffix:`cell-${id}.example.test`,subnet:subnet++,publicKey:peer(),endpoint:'gateway.example.test:51820'});return id;}
async function venue(plan:'free'|'paid'='paid',placed=true,existingCell?:string){
 const signup=new SignupStore(db.pool,db.outbox),email=`remote-${randomUUID()}@example.test`;await signup.request(email);
 const mail=db.outbox.open((await db.pool.query("SELECT * FROM email_outbox WHERE kind='verification' ORDER BY created_at DESC LIMIT 1")).rows[0]);assert('token' in mail);
 const owner=await signup.complete(mail.token,{password,organisationName:'Café Sol',legalBusinessName:'Café Sol SL',countryCode:'ES'});await plans.set(owner.organisationId,plan);
 const key=generateKeyPairSync('ed25519'),binding={operationId:randomUUID(),installationKey:key.publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
 const registration=new RegistrationStore(db.pool);await registration.start(binding);await registration.approveCloud(binding,owner.accountId);await registration.approveLocal(binding,randomUUID());const installed=await registration.complete(binding),cellId=existingCell??await cell(),peerPublicKey=peer();
 const placement=placed?await ordinary.provision(installed.installationId,cellId,peerPublicKey):undefined;
 const proof=(action:string,body:unknown={},operationId=randomUUID(),lease?:SignedEnvelope)=>{const payload=encodeMachine({origin,action:action as MachineAction,installationId:installed.installationId,operationId,issuedAt:Date.now(),lease:lease?JSON.stringify(lease):'',body:JSON.stringify(body)});return {payload:payload.toString('base64url'),signature:sign(null,payload,key.privateKey).toString('base64url')};};
 return {...installed,...owner,email,placement,cellId,peerPublicKey,proof};
}
async function revision(id:string){return Number((await db.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[id])).rows[0].configuration_revision);}
async function certificate(v:Awaited<ReturnType<typeof venue>>){
 const hostname=v.placement!.staffHostname,[key,csr]=await acmeCrypto.createCsr({commonName:hostname,altNames:[hostname]});
 const cert=forge.pki.createCertificate();cert.publicKey=forge.pki.certificationRequestFromPem(csr.toString()).publicKey!;cert.serialNumber='01';cert.setSubject([{name:'commonName',value:hostname}]);cert.setIssuer(cert.subject.attributes);cert.validity.notBefore=new Date(Date.now()-1000);cert.validity.notAfter=new Date(Date.now()+90*86400000);cert.setExtensions([{name:'subjectAltName',altNames:[{type:2,value:hostname}]}]);cert.sign(forge.pki.privateKeyFromPem(key.toString()));
 return {csr:csr.toString(),chain:forge.pki.certificateToPem(cert)};
}
async function due(worker:RemoteConfigurationReconciler,kind:string,id:string){await worker.schedule();await db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp()+interval '1 day'");await db.pool.query('UPDATE remote_configuration_jobs SET available_at=clock_timestamp() WHERE kind=$1 AND target_id=$2',[kind,id]);}
function barrier(){let enter!:()=>void,release!:()=>void;return {started:new Promise<void>(r=>enter=r),gate:new Promise<void>(r=>release=r),enter:()=>enter(),release:()=>release()};}
const bindings={incoming:{socket:{remoteAddress:'192.0.2.1'}}} as never;
function app(resolve?: (name:string)=>Promise<string[]>){return createAccountApp({pool:db.pool,outbox:db.outbox,leaseIssuer:issuer,staffCertificates:true,planMode:mode,remoteResolve:resolve,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]}});}

// Removing a paid admission must expose an operation or a route for the free venue.
for(const action of ['provision','stage','hostname','dns','certificate'] as const)test(`free refuses remote ${action} before work or configuration changes`,async()=>{
 const v=await venue('free',action!=='provision'),target=await cell(),before=await revision(v.installationId);let resolves=0;
 const operation=()=>action==='provision'?store.provision(v.installationId,v.cellId,v.peerPublicKey):action==='stage'?store.stageMove({operationId:randomUUID(),installationId:v.installationId,targetCellId:target,targetPeerPublicKey:peer(),expectedRevision:before}):action==='dns'?store.hostnameInstructions(v.installationId,'staff','staff.cafe.example'):action==='hostname'?store.setHostname(v.installationId,'staff','staff.cafe.example',before,async()=>{resolves++;return [];}):store.authorizeCertificate(v.installationId,'staff','unused CSR');
 await assert.rejects(operation,/permission_denied/);assert.equal(resolves,0);assert.equal(await revision(v.installationId),before);
 assert.equal((await db.pool.query('SELECT count(*)::integer AS n FROM remote_cell_moves WHERE installation_id=$1',[v.installationId])).rows[0].n,0);
});

test('downgrade removes active and staged routes while the paid neighbour stays routed',async()=>{
 const v=await venue(),neighbour=await venue('paid',true,v.cellId),target=await cell();
 const move=await store.stageMove({operationId:randomUUID(),installationId:v.installationId,targetCellId:target,targetPeerPublicKey:peer(),expectedRevision:1});
 const staged=await store.manifest(target);assert.equal(staged.routes.length,1);assert.equal((await store.manifest(v.cellId)).routes.length,2);
 await plans.set(v.organisationId,'free');
 assert.deepEqual((await store.manifest(v.cellId)).routes.map(r=>r.installationId),[neighbour.installationId]);assert.deepEqual((await store.manifest(target)).routes,[]);
 assert.deepEqual((await store.manifest(neighbour.cellId)).routes.map(r=>r.installationId),[neighbour.installationId]);
 await assert.rejects(store.markMoveReady(move.operationId,1,staged.sequence),/permission_denied/);await assert.rejects(store.completeMove(move.operationId,1),/permission_denied/);
 assert.equal((await store.cancelMove(move.operationId,1)).state,'cancelled');
});

test('upgrade alone restores no routes or certificates and explicit existing-placement provision restores setup once',async()=>{
 const v=await venue(),c=await certificate(v);await plans.set(v.organisationId,'free');await plans.set(v.organisationId,'paid');
 assert.deepEqual((await store.manifest(v.cellId)).routes,[]);await assert.rejects(store.authorizeCertificate(v.installationId,'staff',c.csr),/permission_denied/);
 const before=await revision(v.installationId);assert.deepEqual(await store.provision(v.installationId,v.cellId,v.peerPublicKey),v.placement);assert.equal(await revision(v.installationId),before+1);
 assert.equal((await store.manifest(v.cellId)).routes.length,1);assert.equal((await store.authorizeCertificate(v.installationId,'staff',c.csr)).revision,before+1);
 await store.provision(v.installationId,v.cellId,v.peerPublicKey);assert.equal(await revision(v.installationId),before+1);
});

test('certificate publication rechecks a downgrade after external signing work',async()=>{
 const v=await venue(),c=await certificate(v),authority=await store.authorizeCertificate(v.installationId,'staff',c.csr);await plans.set(v.organisationId,'free');let published=0;
 await assert.rejects(transaction(db.pool,client=>store.publishAuthorizedCertificate(client,v.installationId,'staff',c.csr,authority,async()=>{published++;})),/permission_denied/);assert.equal(published,0);
});

test('hostname DNS work rechecks a committed downgrade',async()=>{
 const v=await venue(),b=barrier(),pending=store.setHostname(v.installationId,'staff','staff.cafe.example',1,async name=>{b.enter();await b.gate;return [name.startsWith('_acme')?'_acme-challenge.'+v.placement!.staffHostname:v.placement!.staffHostname];});
 void pending.catch(()=>{});try{await b.started;await plans.set(v.organisationId,'free');}finally{b.release();}
 await assert.rejects(pending,/permission_denied/);assert.equal((await db.pool.query("SELECT hostname FROM remote_hostnames WHERE venue_id=$1 AND kind='staff'",[v.venueId])).rows[0].hostname,v.placement!.staffHostname);
});

test('reconciler restart disables free certificate jobs and exports withdrawal from the same eligible set',async()=>{
 const v=await venue(),worker=new RemoteConfigurationReconciler(db.pool,{planMode:mode});await worker.schedule();await plans.set(v.organisationId,'free');
 const published:string[]=[],key=generateKeyPairSync('ed25519'),restarted=new RemoteConfigurationReconciler(db.pool,{planMode:mode,signingKeyForCell:async()=>key.privateKey,artifacts:{async readCsr(){throw Error('unstarted certificate');},async readCertificate(){return undefined;},async publishCertificate(){throw Error('free certificate');},async publishManifest(_id,envelope){published.push(envelope);}}});
 await due(restarted,'route',v.cellId);assert.equal((await db.pool.query("SELECT count(*)::integer AS n FROM remote_configuration_jobs WHERE target_id=$1 AND kind<>'route' AND enabled",[v.installationId])).rows[0].n,0);
 assert.equal(await restarted.runOnce(),true);assert.equal(published.length,1);assert.deepEqual(verifyManifest(JSON.parse(published[0]!),key.publicKey,v.cellId).routes,[]);
});

test('late route signing cannot publish or complete paid work after downgrade without rescheduling',async()=>{
 const v=await venue(),b=barrier(),key=generateKeyPairSync('ed25519'),published:string[]=[];
 const worker=new RemoteConfigurationReconciler(db.pool,{planMode:mode,signingKeyForCell:async()=>{b.enter();await b.gate;return key.privateKey;},artifacts:{async readCsr(){throw Error('unexpected');},async readCertificate(){return undefined;},async publishCertificate(){throw Error('unexpected');},async publishManifest(_id,envelope){published.push(envelope);}}});await due(worker,'route',v.cellId);
 const running=worker.runOnce();try{await b.started;await plans.set(v.organisationId,'free');}finally{b.release();await running;}
 assert.deepEqual(published,[]);assert.equal((await db.pool.query("SELECT applied_digest FROM remote_configuration_jobs WHERE kind='route' AND target_id=$1",[v.cellId])).rows[0].applied_digest,null);
});

test('late certificate issuance cannot publish or complete after downgrade without rescheduling',async()=>{
 const v=await venue(),c=await certificate(v),b=barrier();let published=0;
 const worker=new RemoteConfigurationReconciler(db.pool,{planMode:mode,issueCertificate:async()=>{b.enter();await b.gate;return c.chain;},artifacts:{async readCsr(){return c.csr;},async readCertificate(){return undefined;},async publishCertificate(){published++;},async publishManifest(){throw Error('unexpected');}}});await due(worker,'certificate_staff',v.installationId);
 const running=worker.runOnce();try{await b.started;await plans.set(v.organisationId,'free');}finally{b.release();await running;}
 assert.equal(published,0);assert.equal((await db.pool.query("SELECT applied_digest FROM remote_configuration_jobs WHERE kind='certificate_staff' AND target_id=$1",[v.installationId])).rows[0].applied_digest,null);
});

test('signed submit and status refuse a free plan even when old setup remains stored',async()=>{
 const v=await venue('free'),c=await certificate(v),server=app(),lifecycle=await new InstallationStore(db.pool,issuer,origin).execute('renew',v.proof('renew'));
 for(const action of ['staff-certificate-submit','staff-certificate-status']){
  const body=action.endsWith('submit')?{version:1,hostname:v.placement!.staffHostname,revision:1,csr:c.csr,previousRequestId:null}:{version:1,requestId:randomUUID()};
  const response=await server.request(origin+'/api/installations/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(v.proof(action,body,randomUUID(),lifecycle.lease!))},bindings);
  assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:'permission_denied'});
 }
});

test('account hostname refusal maps to forbidden and retains read-only setup status',async()=>{
 const v=await venue('free'),server=app();const response=await server.request(origin+'/api/account/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:v.email,password})},bindings);assert.equal(response.status,200);
 const cookie=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),csrf=/__Host-cloud_csrf=([^;]+)/.exec(cookie)![1]!;
 for(const action of ['dns','apply','status']){
  const reply=await server.request(origin+'/api/account/remote-access/'+action,{method:'POST',headers:{origin,cookie,'x-csrf-token':csrf,'content-type':'application/json'},body:JSON.stringify({installationId:v.installationId,...(action==='status'?{}:{kind:'staff',hostname:'staff.cafe.example',...(action==='apply'?{expectedRevision:'1'}:{})})})},bindings);
  assert.equal(reply.status,action==='status'?200:403);if(action==='status'){const view=await reply.json();assert.equal(view.service.state,'unconfigured');assert.equal(view.service.health,'unknown');}
 }
});

test('gateway drops the last paid route at signed authority expiry even across restart',async()=>{
 const v=await venue(),key=generateKeyPairSync('ed25519'),now=Date.now(),manifest=await store.manifest(v.cellId,now),envelope=signManifest(manifest,key.privateKey,now);let time=now,closed=0,saved:unknown;
 const hooks={async persist(value:unknown){saved=value;},async apply(routes:unknown[]){assert.equal(routes.length,1);},async close(){closed++;}};
 const authority=new GatewayAuthority(key.publicKey,v.cellId,hooks,()=>time);await authority.accept(envelope);await plans.set(v.organisationId,'free');assert.equal(manifest.expiresAt-now,600000);
 const restarted=new GatewayAuthority(key.publicKey,v.cellId,hooks,()=>time);await restarted.restore(saved);time=now+600000;await restarted.tick();assert.deepEqual(restarted.routes,[]);assert.equal(closed,1);
});

test('a stale unstarted job cannot execute through the trusted adapter',async()=>{
 const v=await venue();let executed=0;const worker=new RemoteConfigurationReconciler(db.pool,{planMode:mode,execute:async()=>{executed++;}});await due(worker,'certificate_staff',v.installationId);await plans.set(v.organisationId,'free');
 assert.equal(await worker.runOnce(),true);assert.equal(executed,0);
});

test('the trusted adapter current check sees a downgrade before scheduling catches up',async()=>{
 const v=await venue(),b=barrier();let current=true;const worker=new RemoteConfigurationReconciler(db.pool,{planMode:mode,execute:async(_job,context)=>{b.enter();await b.gate;current=await context.isCurrent();}});await due(worker,'route',v.cellId);
 const running=worker.runOnce();try{await b.started;await plans.set(v.organisationId,'free');}finally{b.release();await running;}assert.equal(current,false);
});

test('publication holds policy ahead of a concurrent downgrade until the signed file is replaced',async()=>{
 const v=await venue(),b=barrier(),key=generateKeyPairSync('ed25519');let published=false;
 const running=store.publishManifest(v.cellId,async manifest=>{assert.equal(verifyManifest(signManifest(manifest,key.privateKey),key.publicKey,v.cellId).routes.length,1);b.enter();await b.gate;published=true;});
 void running.catch(()=>{});let downgrade:Promise<unknown>|undefined;
 try{
  await b.started;downgrade=plans.set(v.organisationId,'free');
  let blocked=false;for(let n=0;n<100;n++){if((await db.secondPool.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND cardinality(pg_blocking_pids(pid))>0',[db.schema])).rowCount){blocked=true;break;}await new Promise(r=>setTimeout(r,10));}
  assert.equal(blocked,true,'downgrade must wait for the in-flight publication');assert.equal(published,false);
 }finally{b.release();await running;await downgrade;}
 assert.equal(published,true);assert.deepEqual((await store.manifest(v.cellId)).routes,[]);
});

test('test mode refuses production venues even when paid and preconfigured',async()=>{
 const v=await venue(),c=await certificate(v);await db.pool.query("UPDATE venues SET environment='production' WHERE id=$1",[v.venueId]);
 await assert.rejects(store.provision(v.installationId,v.cellId,v.peerPublicKey),/permission_denied/);await assert.rejects(store.authorizeCertificate(v.installationId,'staff',c.csr),/permission_denied/);assert.deepEqual((await store.manifest(v.cellId)).routes,[]);
});

test('remote admission waits on policy before acquiring an installation lock',async()=>{
 const v=await venue(),blocker=await db.secondPool.connect();let pending:Promise<unknown>|undefined;
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT id FROM organisations WHERE id=$1 FOR NO KEY UPDATE',[v.organisationId]);
  pending=store.provision(v.installationId,v.cellId,v.peerPublicKey);void pending.catch(()=>{});
  let waiting=false;for(let n=0;n<100;n++){if((await db.secondPool.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND cardinality(pg_blocking_pids(pid))>0',[db.schema])).rowCount){waiting=true;break;}await new Promise(r=>setTimeout(r,10));}
  assert.equal(waiting,true);await blocker.query('SELECT id FROM installations WHERE id=$1 FOR UPDATE NOWAIT',[v.installationId]);
  await blocker.query("UPDATE organisations SET service_plan='free' WHERE id=$1",[v.organisationId]);await blocker.query('COMMIT');await assert.rejects(pending,/permission_denied/);
 }finally{await blocker.query('ROLLBACK');blocker.release();await pending?.catch(()=>{});}
});

test('a ready move cannot complete or replay after downgrade',async()=>{
 const v=await venue(),target=await cell(),input={operationId:randomUUID(),installationId:v.installationId,targetCellId:target,targetPeerPublicKey:peer(),expectedRevision:1};
 await store.stageMove(input);const exported=await store.manifest(target);await store.markMoveReady(input.operationId,1,exported.sequence);await plans.set(v.organisationId,'free');
 await assert.rejects(store.stageMove(input),/permission_denied/);await assert.rejects(store.markMoveReady(input.operationId,1,exported.sequence),/permission_denied/);await assert.rejects(store.completeMove(input.operationId,1),/permission_denied/);
 assert.equal((await db.pool.query('SELECT cell_id FROM remote_placements WHERE installation_id=$1',[v.installationId])).rows[0].cell_id,v.cellId);
});

test('paid reconciler signs active and staged routes from the same desired set',async()=>{
 const v=await venue(),target=await cell(),key=generateKeyPairSync('ed25519'),published:string[]=[];
 await store.stageMove({operationId:randomUUID(),installationId:v.installationId,targetCellId:target,targetPeerPublicKey:peer(),expectedRevision:1});
 const worker=new RemoteConfigurationReconciler(db.pool,{planMode:mode,signingKeyForCell:async()=>key.privateKey,artifacts:{async readCsr(){throw Error('unexpected');},async readCertificate(){return undefined;},async publishCertificate(){throw Error('unexpected');},async publishManifest(_id,value){published.push(value);}}});
 for(const id of [v.cellId,target]){await due(worker,'route',id);await worker.runOnce();const value=verifyManifest(JSON.parse(published.at(-1)!),key.publicKey,id);assert.deepEqual(value.routes.map(r=>r.installationId),[v.installationId]);}
 assert.equal(published.length,2);
});

test('paid signed staff exchange publishes a usable chain and denies reads after downgrade',async()=>{
 const v=await venue(),c=await certificate(v),server=app(),lifecycle=await new InstallationStore(db.pool,issuer,origin).execute('renew',v.proof('renew')),id=randomUUID();
 const request=(action:string,body:unknown,operationId=randomUUID())=>server.request(origin+'/api/installations/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(v.proof(action,body,operationId,lifecycle.lease!))},bindings);
 const submit=await request('staff-certificate-submit',{version:1,hostname:v.placement!.staffHostname,revision:1,csr:c.csr,previousRequestId:null},id);assert.equal(submit.status,200);assert.equal((await submit.json()).state,'pending');
 const worker=new RemoteConfigurationReconciler(db.pool,{planMode:mode,staffExchange:true,issueCertificate:async()=>c.chain});await due(worker,'certificate_staff',v.installationId);await worker.runOnce();
 const ready=await request('staff-certificate-status',{version:1,requestId:id});assert.equal(ready.status,200);assert.equal((await ready.json()).certificate,c.chain);
 await plans.set(v.organisationId,'free');const refused=await request('staff-certificate-status',{version:1,requestId:id});assert.equal(refused.status,403);assert.deepEqual(await refused.json(),{error:'permission_denied'});
 assert.equal((await db.pool.query('SELECT certificate FROM staff_certificate_exchange WHERE installation_id=$1',[v.installationId])).rows[0].certificate,c.chain);
});
