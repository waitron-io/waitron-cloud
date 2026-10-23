import assert from 'node:assert/strict';
import test from 'node:test';
import {generateKeyPairSync,randomUUID,X509Certificate,createHash,createPublicKey} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm,stat,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {database} from '../../packages/account-http/test/fixtures.ts';
import {OrganisationPlanStore} from '../../packages/registration/src/organisation-plans.ts';
import {RemoteAccessStore} from '../../packages/remote-access/src/placement.ts';
import {verifyManifest} from '../../packages/remote-access/src/manifest.ts';
import {bootstrapTestCloud} from './bootstrap.mjs';
import {loadRuntime} from '../local-stack/runtime.mjs';

// Empty-route publication, lost mode, or replacing a peer's CSR/key must break these results.
test('volume-backed remote reconciler publishes paid routes and trusted certificates and withdraws after restart', {timeout:60000},async t=>{
 const api=await import('./remote-runtime.mjs').catch(()=>({}));assert.equal(typeof api.openTestRemoteRuntime,'function','real test remote adapter missing');
 const db=await database();t.after(()=>db.close());const directory=await mkdtemp(join(tmpdir(),'cloud-test-remote-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 await bootstrapTestCloud(directory);const config=await loadRuntime(directory),plans=new OrganisationPlanStore(db.pool),store=new RemoteAccessStore(db.pool,'test-free-paid');
 const options={pool:db.pool,directory,mode:'test-free-paid'},runtime=await api.openTestRemoteRuntime(options);
 assert.equal(runtime.cellId,config.gateway.cellId);
 const venues=[];
 for(let n=0;n<2;n++){
  const organisationId=randomUUID(),business=randomUUID(),venueId=randomUUID(),installationId=randomUUID(),peer=generateKeyPairSync('x25519');
  await db.pool.query('INSERT INTO organisations(id) VALUES($1)',[organisationId]);await db.pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[business,organisationId]);await db.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,'test')",[venueId,organisationId,business,randomUUID()]);await db.pool.query('INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,$3)',[installationId,venueId,generateKeyPairSync('ed25519').publicKey.export({format:'der',type:'spki'}).toString('base64url')]);await db.pool.query("INSERT INTO installation_services(installation_id,service) VALUES($1,'remote_access')",[installationId]);
  await assert.rejects(store.provision(installationId,runtime.cellId,peer.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64')),/permission_denied/);
  await plans.set(organisationId,'paid');const placement=await store.provision(installationId,runtime.cellId,peer.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64'));
  const keyFile=join(directory,`client-${n}.key`),csrFile=join(directory,`client-${n}.csr`),hostname=placement.staffHostname;
  execFileSync('openssl',['req','-new','-newkey','rsa:2048','-nodes','-keyout',keyFile,'-out',csrFile,'-subj','/CN='+hostname,'-addext','subjectAltName=DNS:'+hostname],{stdio:'ignore'});
  const csr=await readFile(csrFile,'utf8'),revision=Number((await db.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[installationId])).rows[0].configuration_revision);
  await db.pool.query('INSERT INTO staff_certificate_exchange(installation_id,request_id,request_digest,revision,hostname,csr) VALUES($1,$2,$3,$4,$5,$6)',[installationId,randomUUID(),createHash('sha256').update(csr).digest('hex'),revision,hostname,csr]);
  venues.push({organisationId,installationId,placement,keyFile,csr});
 }
 async function drain(worker){await worker.schedule();for(let n=0;n<12&&await worker.runOnce();n++);}
 await drain(runtime.worker);
 const ca=new X509Certificate(await readFile(join(directory,'lan/ca.pem'))),trust=createPublicKey(await readFile(join(directory,'gateway-issuer.pem')));
 const manifest=()=>readFile(join(directory,'gateway-manifest.json'),'utf8').then(text=>verifyManifest(JSON.parse(text),trust,runtime.cellId));
 const initial=await manifest();assert.equal(initial.routes.length,2);assert.ok(initial.sequence>1,'bootstrap sequence must not supersede the real routes');
 const publicBytes=[];
 for(const v of venues){
  const row=(await db.pool.query('SELECT * FROM staff_certificate_exchange WHERE installation_id=$1',[v.installationId])).rows[0];assert.equal(row.certificate_request_id,row.request_id);
  const cert=new X509Certificate(row.certificate);assert.equal(cert.checkHost(v.placement.staffHostname),v.placement.staffHostname);assert.ok(cert.verify(ca.publicKey));
  const publicFile=join(directory,'public-certs',v.installationId+'.pem'),bytes=await readFile(publicFile,'utf8');publicBytes.push(bytes);
  const leaf=new X509Certificate(bytes);assert.equal(leaf.checkHost(v.placement.publicHostname),v.placement.publicHostname);assert.ok(leaf.verify(ca.publicKey));assert.ok(bytes.includes('PRIVATE KEY'),'gateway material must contain its private key');assert.equal((await stat(publicFile)).mode&0o777,0o600);
 }
 assert.ok(publicBytes[0]!==publicBytes[1],'venues must have distinct private certificate material');
 await plans.set(venues[0].organisationId,'free');const restarted=await api.openTestRemoteRuntime(options);await drain(restarted.worker);
 const after=await manifest();assert.ok(after.sequence>initial.sequence);assert.deepEqual(after.routes.map(r=>r.installationId),[venues[1].installationId]);
 assert.ok(await readFile(join(directory,'public-certs',venues[1].installationId+'.pem'),'utf8')===publicBytes[1],'the paid neighbour must retain its certificate and key');
 await plans.set(venues[0].organisationId,'paid');await drain(restarted.worker);assert.equal((await manifest()).routes.length,1,'upgrade alone must not restore setup');
 await store.provision(venues[0].installationId,runtime.cellId,venues[0].placement.peerPublicKey);await drain(restarted.worker);assert.equal((await manifest()).routes.length,2);
 await assert.rejects(api.openTestRemoteRuntime({...options,mode:'invalid'}),/test_cloud.plan_mode/);
 // Durable state is authoritative; a mismatched cell must not be silently overwritten.
 await db.pool.query("UPDATE remote_cells SET endpoint='elsewhere.example.test:51820' WHERE id=$1",[runtime.cellId]);
 await assert.rejects(api.openTestRemoteRuntime(options),/test_cloud.remote_cell_conflict/);
});

// Startup must reject a substituted authority rather than signing a new trusted route set.
test('remote startup rejects private-key mismatch, bad permissions, corrupt signatures and invalid mode', {timeout:30000},async t=>{
 const {openTestRemoteRuntime}=await import('./remote-runtime.mjs'),db=await database();t.after(()=>db.close());
 const directory=await mkdtemp(join(tmpdir(),'cloud-remote-authority-'));t.after(()=>rm(directory,{recursive:true,force:true}));await bootstrapTestCloud(directory);
 const options={pool:db.pool,directory,mode:'test-free-paid'},keyFile=join(directory,'gateway-signing-key.pem'),key=await readFile(keyFile);
 await writeFile(keyFile,generateKeyPairSync('ed25519').privateKey.export({format:'pem',type:'pkcs8'}));await assert.rejects(openTestRemoteRuntime(options),/test_cloud.remote_state_invalid/);await writeFile(keyFile,key);
 await chmod(keyFile,0o644);await assert.rejects(openTestRemoteRuntime(options),/test_cloud.remote_state_invalid/);await chmod(keyFile,0o600);
 const manifestFile=join(directory,'gateway-manifest.json'),bytes=await readFile(manifestFile),envelope=JSON.parse(bytes);envelope.signature='A'.repeat(86);
 await writeFile(manifestFile,JSON.stringify(envelope));await assert.rejects(openTestRemoteRuntime(options),/invalid_manifest/);await writeFile(manifestFile,bytes);
 const wireguardFile=join(directory,'gateway-wireguard.key'),wg=await readFile(wireguardFile);await writeFile(wireguardFile,'short');await assert.rejects(openTestRemoteRuntime(options),/test_cloud.remote_state_invalid/);await writeFile(wireguardFile,wg);
 await assert.rejects(openTestRemoteRuntime({...options,mode:'invalid',directory:'/not-read'}),/test_cloud.plan_mode/);
 assert.equal((await openTestRemoteRuntime(options)).cellId,(await loadRuntime(directory)).gateway.cellId);
});
