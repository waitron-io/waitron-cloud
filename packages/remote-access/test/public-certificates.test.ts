import assert from 'node:assert/strict';
import {createPrivateKey,generateKeyPairSync,randomBytes,randomUUID,X509Certificate} from 'node:crypto';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,beforeEach,test} from 'node:test';
import forge from 'node-forge';
import {staffExchangeFixture} from './staff-exchange-fixture.ts';
import {FileReconcilerArtifacts} from '../src/reconciler-files.ts';
import {RemoteConfigurationReconciler} from '../src/reconciler.ts';

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
 const worker=new RemoteConfigurationReconciler(f.db.pool,{artifacts:files,now:()=>now,issueCertificate:async value=>{issues++;if(fail)throw Error('synthetic issuer unavailable');return chain(value.csr,value.hostname,now);}});
 async function run(selected=worker){await selected.schedule();await f.db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp()+interval '1 day'");await f.db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp() WHERE kind='certificate_public' AND target_id=$1",[venue.installationId]);assert.equal(await selected.runOnce(),true);}
 async function stage(){const move=await f.store.stageMove({operationId:randomUUID(),installationId:venue.installationId,targetCellId:target,targetPeerPublicKey:venue.placement.peerPublicKey,expectedRevision:1});await f.store.markMoveReady(move.operationId,1,(await f.store.manifest(target)).sequence);return move;}
 return {venue,target,routes,files,worker,run,stage,issues:()=>issues,fail:()=>{fail=true;},advance:()=>{now+=61*86400000;},copy:()=>files.readPublicCertificate(venue.installationId),read:(cell:string)=>readFile(join(root,cell,venue.venueId+'.pem'),'utf8')};
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
 const s=await fixture();await s.run();s.advance();s.advance();s.fail();const move=await s.stage();await s.run();
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
