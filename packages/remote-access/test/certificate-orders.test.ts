import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {test,type TestContext} from 'node:test';
import forge from 'node-forge';
import {staffExchangeFixture} from './staff-exchange-fixture.ts';
import {seedStaffCertificate} from './fixtures/staff-certificate.ts';
import {RemoteConfigurationReconciler,type RemoteConfigurationKind} from '../src/reconciler.ts';

async function fixture(t:TestContext){
 const f=await staffExchangeFixture();t.after(f.close);
 const venue=await f.venue(),id=venue.installationId;
 await seedStaffCertificate(f.db.pool,id,venue.body.csr);
 async function select(worker:RemoteConfigurationReconciler,kind:RemoteConfigurationKind='certificate_staff'){
  await worker.schedule();
  await f.db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp()+interval '1 day'");
  await f.db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp() WHERE kind=$1 AND target_id=$2",
   [kind,kind==='route'?venue.placement.cellId:id]);
 }
 async function chain(){
  return (await f.db.pool.query('SELECT certificate FROM staff_certificate_exchange WHERE installation_id=$1',[id])).rows[0].certificate;
 }
 function issue(now:number){
  const cert=forge.pki.createCertificate();
  cert.publicKey=forge.pki.certificationRequestFromPem(venue.body.csr).publicKey!;
  cert.serialNumber=randomBytes(8).toString('hex');
  cert.setSubject([{name:'commonName',value:venue.body.hostname}]);
  cert.setIssuer(cert.subject.attributes);
  cert.validity.notBefore=new Date(Date.now()-60_000);
  cert.validity.notAfter=new Date(now+90*86400000);
  cert.setExtensions([{name:'subjectAltName',altNames:[{type:2,value:venue.body.hostname}]}]);
  cert.sign(forge.pki.privateKeyFromPem(venue.privateKey));
  return forge.pki.certificateToPem(cert);
 }
 return {pool:f.db.pool,venue,id,select,chain,issue};
}

test('claims leave time for certificates and two Route 53 name writes',async t=>{
 const f=await fixture(t);
 let leaseSeconds:number|undefined;
 const worker=new RemoteConfigurationReconciler(f.pool,{execute:async job=>{
  const row=(await f.pool.query("SELECT round(extract(epoch FROM lease_until-updated_at))::integer AS seconds FROM remote_configuration_jobs WHERE claim_id=$1",[job.claimId])).rows[0];
  leaseSeconds=row.seconds;
 }});
 for(const [kind,seconds] of [['route',120],['name',180],['certificate_staff',300],['certificate_public',300]] as const){
  await f.select(worker,kind);assert.equal(await worker.runOnce(),true);
  assert.equal(leaseSeconds,seconds,kind);
 }
});

test('an expired staff claim cannot start a second order for the same name',async t=>{
 const f=await fixture(t);
 let entered!:()=>void,release!:()=>void;
 const started=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;});
 let issued=0;
 const options={issueCertificate:async()=>{issued++;entered();await gate;return f.issue(Date.now());}};
 const first=new RemoteConfigurationReconciler(f.pool,options);
 await f.select(first);
 const running=first.runOnce();
 try{
  await Promise.race([started,new Promise((_,reject)=>setTimeout(()=>reject(Error('issuer not reached')),3000).unref())]);
  await f.pool.query("UPDATE remote_configuration_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE kind='certificate_staff' AND target_id=$1",[f.id]);
  const second=new RemoteConfigurationReconciler(f.pool,{issueCertificate:async()=>{issued++;throw Error('overlapping issue');}});
  assert.equal(await second.runOnce(),true);
  assert.equal(issued,1);
  assert.equal((await f.pool.query("SELECT last_error FROM remote_configuration_jobs WHERE kind='certificate_staff' AND target_id=$1",[f.id])).rows[0].last_error,'order_in_flight');
 }finally{release();await running;}
 assert.equal(await f.chain(),null);
 assert.equal((await f.pool.query('SELECT count(*)::int AS count FROM remote_certificate_orders')).rows[0].count,0);
});

for(const elapsed of [105_000,290_000])test(`DNS issuance after ${elapsed/1000} seconds ${elapsed<285_000?'publishes':'cannot publish'}`,async t=>{
 const f=await fixture(t);
 let issued:string|undefined,now=Date.now();
 const worker=new RemoteConfigurationReconciler(f.pool,{now:()=>now,issueCertificate:async target=>{
  assert.equal(target.dnsName,'_acme-challenge.'+f.venue.body.hostname);
  now+=75_000;
  now+=elapsed-75_000;
  issued=f.issue(now);
  return issued;
 }});
 await f.select(worker);assert.equal(await worker.runOnce(),true);
 assert.ok(issued,'the issuer must run');
 assert.equal(await f.chain(),elapsed<285_000?issued:null);
 assert.equal((await f.pool.query('SELECT count(*)::int AS count FROM remote_certificate_orders')).rows[0].count,0);
});
