import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import forge from 'node-forge';
import {staffExchangeFixture} from './staff-exchange-fixture.ts';
import {RemoteConfigurationReconciler} from '../src/reconciler.ts';
let f:Awaited<ReturnType<typeof staffExchangeFixture>>;
before(async()=>{f=await staffExchangeFixture();});after(async()=>f?.close());
const submit='staff-certificate-submit',status='staff-certificate-status';
function chain(a:Awaited<ReturnType<typeof f.venue>>,days=90){const cert=forge.pki.createCertificate();cert.publicKey=forge.pki.certificationRequestFromPem(a.body.csr).publicKey!;cert.serialNumber=randomBytes(8).toString('hex');cert.setSubject([{name:'commonName',value:a.body.hostname}]);cert.setIssuer(cert.subject.attributes);cert.validity.notBefore=new Date(Date.now()-90*86400000);cert.validity.notAfter=new Date(Date.now()+days*86400000);cert.setExtensions([{name:'subjectAltName',altNames:[{type:2,value:a.body.hostname}]}]);cert.sign(forge.pki.privateKeyFromPem(a.privateKey));return forge.pki.certificateToPem(cert);}
async function setup(){const a=await f.venue(),id=randomUUID();const reply=await f.request(submit,a.proof(submit,a.body,id,a.lease));assert.equal(reply.status,200,await reply.text());return {a,id};}
async function select(worker:RemoteConfigurationReconciler,id:string){await worker.schedule();await f.db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp()+interval '1 day'");await f.db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp() WHERE kind='certificate_staff' AND target_id=$1",[id]);}
async function read(a:Awaited<ReturnType<typeof f.venue>>,id:string){return f.request(status,a.proof(status,{version:1,requestId:id},randomUUID(),a.lease));}
test('database staff worker issues once, survives restart, and renews without changing the request identity',async()=>{
 const {a,id}=await setup();let issues=0;const initial=chain(a);const options={staffExchange:true,issueCertificate:async()=>{issues++;return initial;}};
 const worker=new RemoteConfigurationReconciler(f.db.pool,options);await select(worker,a.installationId);assert.equal(await worker.runOnce(),true);
 const result=await(await read(a,id)).json();assert.equal(result.state,'ready');assert.equal(result.certificate,initial);assert.equal(issues,1);
 const restarted=new RemoteConfigurationReconciler(f.db.pool,options);await select(restarted,a.installationId);await restarted.runOnce();assert.equal(issues,1);
 await f.db.pool.query('UPDATE staff_certificate_exchange SET certificate=$2 WHERE installation_id=$1',[a.installationId,chain(a,0.001)]);
 await select(restarted,a.installationId);await restarted.runOnce();assert.equal(issues,2);assert.equal((await(await read(a,id)).json()).certificate,initial);
});
test('failed or wrong-key issuance keeps the stored chain and never returns it for a replacement request',async()=>{
 const {a,id}=await setup(),b=await f.venue(),initial=chain(a),worker=new RemoteConfigurationReconciler(f.db.pool,{staffExchange:true,issueCertificate:async()=>initial});
 await select(worker,a.installationId);await worker.runOnce();assert.equal((await(await read(a,id)).json()).state,'ready');
 const next=randomUUID(),body={...a.body,previousRequestId:id};assert.equal((await f.request(submit,a.proof(submit,body,next,a.lease))).status,200);
 for(const issueCertificate of [async()=>{throw Error('dns failed');},async()=>chain(b)]){
  const bad=new RemoteConfigurationReconciler(f.db.pool,{staffExchange:true,issueCertificate});await select(bad,a.installationId);await bad.runOnce();
  const row=(await f.db.pool.query('SELECT certificate,certificate_request_id FROM staff_certificate_exchange WHERE installation_id=$1',[a.installationId])).rows[0];assert.equal(row.certificate,initial);assert.equal(row.certificate_request_id,id);
  const reply=await(await read(a,next)).json();assert.equal(reply.state,'pending');assert.equal('certificate' in reply,false);
 }
});
for(const change of ['replacement','revision','revocation','lease','shutdown'] as const)test(`issuance refuses a late result after ${change}`,async()=>{
 const {a,id}=await setup();let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
 const worker=new RemoteConfigurationReconciler(f.db.pool,{staffExchange:true,issueCertificate:async()=>{entered();await gate;return chain(a);}});await select(worker,a.installationId);
 const stop=new AbortController(),running=worker.runOnce(stop.signal);try{await Promise.race([started,new Promise((_,reject)=>setTimeout(()=>reject(Error('worker did not issue')),3000).unref())]);
 if(change==='replacement')assert.equal((await f.request(submit,a.proof(submit,{...a.body,previousRequestId:id},randomUUID(),a.lease))).status,200);
 if(change==='revision')await f.db.pool.query('UPDATE installations SET configuration_revision=configuration_revision+1 WHERE id=$1',[a.installationId]);
 if(change==='revocation')await f.db.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[a.installationId]);
 if(change==='shutdown')stop.abort();
 if(change==='lease')await f.db.pool.query("UPDATE remote_configuration_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE target_id=$1 AND kind='certificate_staff'",[a.installationId]);
 }finally{release();await running;}
 assert.equal((await f.db.pool.query('SELECT certificate FROM staff_certificate_exchange WHERE installation_id=$1',[a.installationId])).rows[0].certificate,null);
});

for(const fence of ['claim expiry','shutdown'])test(`${fence} while waiting for the installation lock refuses publication`,async()=>{
 const {a}=await setup();let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
 const worker=new RemoteConfigurationReconciler(f.db.pool,{staffExchange:true,issueCertificate:async()=>{entered();await gate;return chain(a);}});await select(worker,a.installationId);
 const stop=new AbortController(),running=worker.runOnce(stop.signal),blocker=await f.db.secondPool.connect();
 try{
  await started;await blocker.query('BEGIN');await blocker.query('SELECT 1 FROM installations WHERE id=$1 FOR UPDATE',[a.installationId]);
  if(fence==='claim expiry')await f.db.pool.query("UPDATE remote_configuration_jobs SET lease_until=clock_timestamp()+interval '2 seconds' WHERE target_id=$1 AND kind='certificate_staff'",[a.installationId]);
  release();
  let waiting=false;for(let i=0;i<100;i++){const blocked=(await f.db.secondPool.query("SELECT count(*)::integer AS n FROM pg_stat_activity WHERE application_name=$1 AND cardinality(pg_blocking_pids(pid))>0",[f.db.schema])).rows[0].n;if(blocked>0){waiting=true;break;}await new Promise(r=>setTimeout(r,10));}
  assert.equal(waiting,true,'publication must actually wait for the installation lock');
  if(fence==='shutdown')stop.abort();
  if(fence==='claim expiry')await f.db.secondPool.query("SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM lease_until-clock_timestamp()))+0.05) FROM remote_configuration_jobs WHERE kind='certificate_staff' AND target_id=$1",[a.installationId]);
  await blocker.query('COMMIT');await running;
  assert.equal((await f.db.pool.query('SELECT certificate FROM staff_certificate_exchange WHERE installation_id=$1',[a.installationId])).rows[0].certificate,null);
 }finally{release();await blocker.query('ROLLBACK');blocker.release();await running;}
});
