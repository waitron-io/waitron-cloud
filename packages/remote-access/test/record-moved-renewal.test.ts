import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import forge from 'node-forge';
import {FileReconcilerArtifacts} from '../src/reconciler-files.ts';
import {RemoteConfigurationReconciler} from '../src/reconciler.ts';
import {staffExchangeFixture} from './staff-exchange-fixture.ts';

test('a moved CNAME preserves the last public certificate and retries until DNS is fixed',async t=>{
 const f=await staffExchangeFixture();t.after(f.close);
 const root=await mkdtemp(join(tmpdir(),'moved-cname-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const {installationId,placement,venueId}=await f.venue(),hostname='menu.cafe.example.test',assigned=placement.publicHostname;
 let destination=assigned,now=Date.now(),orders=0,lookupError:string|undefined;
 const resolveCname=async()=>{
  if(lookupError)throw Object.assign(Error('synthetic resolver failure'),{code:lookupError});
  return [destination];
 };
 await f.store.setHostname(installationId,'public',hostname,1,resolveCname);
 const artifacts=new FileReconcilerArtifacts({keyDirectory:root,routes:[{cellId:placement.cellId,
  challenges:root,output:join(root,'manifest.json'),publicCertificates:root}]});
 const ca=forge.pki.privateKeyFromPem(generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}).toString());
 const worker=new RemoteConfigurationReconciler(f.db.pool,{artifacts,resolveCname,now:()=>now,
  gatewayStatus:{async read(){return [new Set([hostname])];}},
  async issueCertificate(target){
   orders++;
   const certificate=forge.pki.createCertificate();certificate.publicKey=forge.pki.certificationRequestFromPem(target.csr).publicKey!;
   certificate.serialNumber=randomBytes(8).toString('hex');certificate.setSubject([{name:'commonName',value:hostname}]);
   certificate.setIssuer(certificate.subject.attributes);
   certificate.validity.notBefore=new Date(now-1000);certificate.validity.notAfter=new Date(now+90*86400000);
   certificate.setExtensions([{name:'subjectAltName',altNames:[{type:2,value:hostname}]}]);certificate.sign(ca);
   return forge.pki.certificateToPem(certificate);
  },
 });
 const record=async()=>(await f.db.pool.query("SELECT record_moved_at FROM remote_hostnames WHERE venue_id=$1 AND kind='public'",[venueId])).rows[0].record_moved_at;
 const job=async()=>(await f.db.pool.query(`SELECT status,last_error,attempts,available_at<=clock_timestamp()+interval '900 seconds' AS bounded
  FROM remote_configuration_jobs WHERE target_id=$1 AND kind='certificate_public'`,[installationId])).rows[0];
 async function run(){
  await worker.schedule();await f.db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp()+interval '1 day'");
  await f.db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp() WHERE target_id=$1 AND kind='certificate_public'",[installationId]);
  assert.equal(await worker.runOnce(),true);
 }
 await run();const good=await artifacts.readPublicCertificate(installationId);assert.ok(good);
 assert.equal(orders,1);
 now+=61*86400000;lookupError='ETIMEOUT';
 await run();assert.equal(orders,1);assert.equal(await record(),null);
 lookupError=undefined;destination='other.example.test';
 await run();const moved=await record();assert.ok(moved instanceof Date);
 for(let attempt=2;attempt<=9;attempt++)await run();
 assert.equal(orders,1);assert.deepEqual(await record(),moved);
 lookupError='ESERVFAIL';await run();assert.deepEqual(await record(),moved);
 lookupError=undefined;
 assert.deepEqual(await artifacts.readPublicCertificate(installationId),good);
 assert.deepEqual(await job(),{status:'pending',last_error:'dns_not_verified',attempts:7,bounded:true});
 await f.db.pool.query('UPDATE installations SET configuration_revision=configuration_revision+1 WHERE id=$1',[installationId]);
 await worker.schedule();assert.equal((await job()).last_error,null);assert.deepEqual(await record(),moved);
 destination=assigned;await run();
 assert.equal(orders,2);assert.equal(await record(),null);
 assert.notEqual((await artifacts.readPublicCertificate(installationId))?.pem,good.pem);
});
