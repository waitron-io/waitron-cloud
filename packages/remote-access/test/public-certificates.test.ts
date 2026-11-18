import assert from 'node:assert/strict';
import {createPrivateKey,generateKeyPairSync,randomBytes,randomUUID,X509Certificate} from 'node:crypto';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,beforeEach,test} from 'node:test';
import forge from 'node-forge';
import {staffExchangeFixture} from './staff-exchange-fixture.ts';
import {FileReconcilerArtifacts} from '../src/reconciler-files.ts';
import {RemoteConfigurationReconciler,remoteConfigurationStatus,type CertificateIssueTarget} from '../src/reconciler.ts';

const ca=forge.pki.privateKeyFromPem(generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}).toString());
let f:Awaited<ReturnType<typeof staffExchangeFixture>>,root:string;
beforeEach(async()=>{f=await staffExchangeFixture();root=await mkdtemp(join(tmpdir(),'public-worker-'));});
afterEach(async()=>{await f?.close();await rm(root,{recursive:true,force:true});});
function chain(csr:string,hostname:string,now:number){
 const certificate=forge.pki.createCertificate();certificate.publicKey=forge.pki.certificationRequestFromPem(csr).publicKey!;
 certificate.serialNumber=randomBytes(8).toString('hex');certificate.setSubject([{name:'commonName',value:hostname}]);certificate.setIssuer([{name:'commonName',value:'Synthetic certificate authority'}]);
 certificate.validity.notBefore=new Date(now-1000);certificate.validity.notAfter=new Date(now+90*86400000);certificate.setExtensions([{name:'subjectAltName',altNames:[{type:2,value:hostname}]}]);certificate.sign(ca);
 return forge.pki.certificateToPem(certificate);
}
async function fixture(){
 const venue=await f.venue(),target=randomUUID();await f.store.createCell({id:target,country:'ES',provider:'aws',environment:'test',suffix:'destination.example.test',subnet:53,publicKey:randomBytes(32).toString('base64'),endpoint:'gateway.destination.example.test:51820'});
 const routes=await Promise.all([venue.placement.cellId,target].map(async cellId=>{const publicCertificates=join(root,cellId);await mkdir(publicCertificates);return {cellId,output:join(root,cellId+'.json'),publicCertificates};}));
 const files=new FileReconcilerArtifacts({keyDirectory:join(root,'keys'),routes});let now=Date.now(),issues=0,fail=false;
 const validations:CertificateIssueTarget['validation'][]=[];
 const worker=new RemoteConfigurationReconciler(f.db.pool,{artifacts:files,now:()=>now,issueCertificate:async value=>{issues++;validations.push(value.validation);if(fail)throw Error('synthetic issuer unavailable');return chain(value.csr,value.hostname,now);}});
 async function run(selected=worker){await selected.schedule();await f.db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp()+interval '1 day'");await f.db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp() WHERE kind='certificate_public' AND target_id=$1",[venue.installationId]);assert.equal(await selected.runOnce(),true);}
 async function stage(){const move=await f.store.stageMove({operationId:randomUUID(),installationId:venue.installationId,targetCellId:target,targetPeerPublicKey:venue.placement.peerPublicKey,expectedRevision:1});await f.store.markMoveReady(move.operationId,1,(await f.store.manifest(target)).sequence);return move;}
 return {venue,target,routes,files,worker,run,stage,validations,issues:()=>issues,fail:()=>{fail=true;},recover:()=>{fail=false;},advance:()=>{now+=61*86400000;},copy:()=>files.readPublicCertificate(venue.installationId),read:(cell:string)=>readFile(join(root,cell,venue.venueId+'.pem'),'utf8')};
}

test('a newly placed venue gets its public certificate without per-venue files or an operator command',async()=>{
 const s=await fixture();await s.run();const copy=await s.copy();assert.ok(copy);
 const certificate=new X509Certificate(copy.pem);assert.equal(certificate.checkHost(s.venue.placement.publicHostname),s.venue.placement.publicHostname);assert.equal(certificate.checkPrivateKey(createPrivateKey(copy.pem)),true);
 assert.equal(await s.read(s.venue.placement.cellId),copy.pem);assert.equal(s.issues(),1);
 await s.run(new RemoteConfigurationReconciler(f.db.pool,{artifacts:s.files,issueCertificate:async()=>{throw Error('must not reissue');}}));assert.deepEqual(await s.copy(),copy);
});

test('changing the public name makes a new matching key and chain instead of parking its old CSR',async()=>{
 const s=await fixture();await s.run();const old=await s.copy();assert.ok(old);
 await f.store.setHostname(s.venue.installationId,'public','menu.cafe.example.test',1,async name=>[name.startsWith('_acme-challenge.')?'_acme-challenge.'+s.venue.placement.publicHostname:s.venue.placement.publicHostname]);
 await s.run();const copy=await s.copy();assert.ok(copy);assert.notEqual(copy.csr,old.csr);assert.equal(new X509Certificate(copy.pem).checkHost('menu.cafe.example.test'),'menu.cafe.example.test');assert.equal(s.issues(),2);
 assert.deepEqual(s.validations.map(validation=>validation.type),['dns-01','dns-01']);
 assert.deepEqual(s.validations.at(-1),{type:'dns-01',dnsName:'_acme-challenge.'+s.venue.placement.publicHostname});

});

test('a staged move copies a usable public certificate without another order',async()=>{
 const s=await fixture();await s.run();await s.stage();await s.run();assert.equal(await s.read(s.target),await s.read(s.venue.placement.cellId));assert.equal(s.issues(),1);
});

test('a move can use its matching still-valid copy when renewal fails',async()=>{
 const s=await fixture();await s.run();const old=await s.copy();assert.ok(old);s.advance();s.fail();const move=await s.stage();await s.run();
 assert.equal(await s.read(s.target),old.pem);assert.deepEqual(await s.copy(),old);
 const job=(await f.db.pool.query("SELECT status,applied_digest=desired_digest AS applied,last_error FROM remote_configuration_jobs WHERE kind='certificate_public' AND target_id=$1",[s.venue.installationId])).rows[0];
 assert.deepEqual(job,{status:'pending',applied:true,last_error:'reconcile_failed'});assert.equal((await f.store.completeMove(move.operationId,1)).state,'completed');
});

test('renewal makes a fresh key and puts the replacement in every cell holding the route',async()=>{
 const s=await fixture();await s.run();const old=await s.copy();assert.ok(old);s.advance();await s.stage();await s.run();const copy=await s.copy();assert.ok(copy);
 assert.notEqual(copy.csr,old.csr);assert.notEqual(copy.pem,old.pem);assert.equal(await s.read(s.venue.placement.cellId),copy.pem);assert.equal(await s.read(s.target),copy.pem);assert.equal(new X509Certificate(copy.pem).checkPrivateKey(createPrivateKey(copy.pem)),true);assert.equal(s.issues(),2);
});

test('a ready move without a copied public certificate keeps the source placement',async()=>{
 const s=await fixture(),move=await s.stage();await assert.rejects(f.store.completeMove(move.operationId,1),/move_destination_incomplete/);
 assert.equal((await f.db.pool.query('SELECT cell_id FROM remote_placements WHERE installation_id=$1',[s.venue.installationId])).rows[0].cell_id,s.venue.placement.cellId);
});

test('an expired copy cannot make a destination ready when its replacement fails',async()=>{
 const s=await fixture();await s.run();s.advance();s.advance();s.fail();const move=await s.stage();await s.run();assert.equal(s.issues(),2,'an expired copy must attempt renewal');
 await assert.rejects(s.read(s.target),{code:'ENOENT'});await assert.rejects(f.store.completeMove(move.operationId,1),/move_destination_incomplete/);
});

test('a name change during renewal refuses the late chain and preserves the last good private copy',async()=>{
 const s=await fixture();await s.run();const old=await s.copy();assert.ok(old);s.advance();const now=Date.now()+61*86400000;
 const worker=new RemoteConfigurationReconciler(f.db.pool,{artifacts:s.files,now:()=>now,issueCertificate:async target=>{
  await f.store.setHostname(s.venue.installationId,'public','changed.cafe.example.test',1,async name=>[name.startsWith('_acme-challenge.')?'_acme-challenge.'+s.venue.placement.publicHostname:s.venue.placement.publicHostname]);
  return chain(target.csr,target.hostname,now);
 }});
 await s.run(worker);assert.deepEqual(await s.copy(),old);assert.equal(await s.read(s.venue.placement.cellId),old.pem);
});


test('public renewal retries past eight failures and recovers with the same backoff cap',async()=>{
 const s=await fixture();await s.run();s.advance();s.fail();for(let i=0;i<8;i++)await s.run();
 const job=(await f.db.pool.query("SELECT status,attempts,extract(epoch FROM available_at-clock_timestamp())::float AS wait FROM remote_configuration_jobs WHERE kind='certificate_public' AND target_id=$1",[s.venue.installationId])).rows[0];
 assert.equal(job.status,'pending');assert.equal(job.attempts,7);assert.ok(job.wait>890&&job.wait<=900);
 s.recover();await s.run();assert.equal(s.issues(),10);assert.equal((await f.db.pool.query("SELECT attempts FROM remote_configuration_jobs WHERE kind='certificate_public' AND target_id=$1",[s.venue.installationId])).rows[0].attempts,0);
});

test('an unavailable source cannot block a destination that receives the current certificate',async()=>{
 const s=await fixture();await s.run();const copy=await s.copy();assert.ok(copy);const move=await s.stage();await rm(join(root,s.venue.placement.cellId),{recursive:true,force:true});await s.run();
 assert.equal(await s.read(s.target),copy.pem);assert.equal((await f.store.completeMove(move.operationId,1)).state,'completed');
});

test('an unavailable source does not postpone renewal of the destination certificate',async()=>{
 const s=await fixture();await s.run();const old=await s.copy();assert.ok(old);s.advance();const move=await s.stage();await rm(join(root,s.venue.placement.cellId),{recursive:true,force:true});await s.run();
 assert.equal(s.issues(),2);assert.notEqual(await s.read(s.target),old.pem);assert.equal((await f.store.completeMove(move.operationId,1)).state,'completed');
});

test('an unmapped old source cannot block the mapped destination copy',async()=>{
 const s=await fixture();await s.run();const move=await s.stage();
 const files=new FileReconcilerArtifacts({keyDirectory:join(root,'keys'),routes:s.routes.filter(r=>r.cellId===s.target)});
 await s.run(new RemoteConfigurationReconciler(f.db.pool,{artifacts:files,issueCertificate:async()=>{throw Error('existing copy needs no order');}}));
 assert.equal(await s.read(s.target),await s.read(s.venue.placement.cellId));assert.equal((await f.store.completeMove(move.operationId,1)).state,'completed');
});

for(const outcome of ['cancel','complete'] as const)test(`a ${outcome} move removes its public key from the cell no longer holding the route`,async()=>{
 const s=await fixture();await s.run();const move=await s.stage();await s.run();
 if(outcome==='cancel')await f.store.cancelMove(move.operationId,1);else await f.store.completeMove(move.operationId,1);
 await s.run();await assert.rejects(s.read(outcome==='cancel'?s.target:s.venue.placement.cellId),{code:'ENOENT'});
});

test('a copied certificate that expires while a move waits no longer qualifies after failed renewal',async()=>{
 const s=await fixture();await s.run();const move=await s.stage();await s.run();s.advance();s.advance();s.fail();await s.run();
 await assert.rejects(f.store.completeMove(move.operationId,1),/move_destination_incomplete/);
});


test('a failed first gateway write retains the issued private copy and retries without another order',async()=>{
 const s=await fixture();await rm(join(root,s.venue.placement.cellId),{recursive:true,force:true});await s.run();await s.run();
 assert.equal(s.issues(),1);assert.ok(await s.copy());
 await mkdir(join(root,s.venue.placement.cellId));await s.run();assert.equal(s.issues(),1);assert.equal(await s.read(s.venue.placement.cellId),(await s.copy())!.pem);
});

test('an unavailable destination cannot postpone renewal of the live source',async()=>{
 const s=await fixture();await s.run();const old=await s.copy();assert.ok(old);s.advance();const move=await s.stage();await rm(join(root,s.target),{recursive:true,force:true});await s.run();
 assert.equal(s.issues(),2);assert.notEqual(await s.read(s.venue.placement.cellId),old.pem);await assert.rejects(f.store.completeMove(move.operationId,1),/move_destination_incomplete/);
 await mkdir(join(root,s.target));await s.run();assert.equal(s.issues(),2);assert.equal((await f.store.completeMove(move.operationId,1)).state,'completed');
});

test('an expired eighth public claim is reclaimed and completed instead of parked or lost',async()=>{
 const s=await fixture();await s.run();await f.db.pool.query("UPDATE remote_configuration_jobs SET status='running',attempts=8,claim_id=$2,lease_until=clock_timestamp()-interval '1 second' WHERE kind='certificate_public' AND target_id=$1",[s.venue.installationId,randomUUID()]);
 assert.equal(await s.worker.runOnce(),true);const job=(await f.db.pool.query("SELECT status,attempts FROM remote_configuration_jobs WHERE kind='certificate_public' AND target_id=$1",[s.venue.installationId])).rows[0];assert.deepEqual(job,{status:'pending',attempts:0});assert.equal(s.issues(),1);
});

test('status exposes a public retry during its backoff',async()=>{
 const s=await fixture();s.fail();await s.run();const status=await remoteConfigurationStatus(f.db.pool);assert.equal(status.failed,0);assert.equal(status.retrying,1);
});
