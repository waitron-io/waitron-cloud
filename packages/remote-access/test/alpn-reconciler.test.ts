import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test,type TestContext} from 'node:test';
import {FileReconcilerArtifacts} from '../src/reconciler-files.ts';
import {RemoteConfigurationReconciler} from '../src/reconciler.ts';
import {readChallengeFolder} from '../src/challenge-files.ts';
import {staffExchangeFixture} from './staff-exchange-fixture.ts';
import {challengeCertificate} from './fixtures/challenge-certificate.ts';
import {seedCurrentStaffRequest} from './fixtures/staff-certificate.ts';

async function customStaff(t:TestContext){
 const f=await staffExchangeFixture();t.after(f.close);
 const venue=await f.venue(),hostname='staff.cafe.example.test',resolveCname=async()=>[venue.placement.staffHostname];
 await f.store.setHostname(venue.installationId,'staff',hostname,1,resolveCname);
 await seedCurrentStaffRequest(f.db.pool,venue.installationId);
 async function run(worker:RemoteConfigurationReconciler){
  await worker.schedule();
  await f.db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp()+interval '1 day'");
  await f.db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp() WHERE target_id=$1 AND kind='certificate_staff'",[venue.installationId]);
  assert.equal(await worker.runOnce(),true);
 }
 return {...f,venue,hostname,resolveCname,run};
}

test('a staged move needs both gateways to answer before the custom staff order is ready',async t=>{
 const f=await customStaff(t),target=randomUUID(),root=await mkdtemp(join(tmpdir(),'worker-alpn-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 await f.store.createCell({id:target,country:'ES',provider:'aws',environment:'test',suffix:'destination.example.test',subnet:53,
  publicKey:randomBytes(32).toString('base64'),endpoint:'gateway.destination.example.test:51820'});
 await f.store.stageMove({operationId:randomUUID(),installationId:f.venue.installationId,targetCellId:target,
  targetPeerPublicKey:f.venue.placement.peerPublicKey,expectedRevision:2});
 const routes=await Promise.all([f.venue.placement.cellId,target].map(async cellId=>{
  const challenges=join(root,cellId);await mkdir(challenges);
  return {cellId,output:join(root,cellId+'.json'),publicCertificates:root,challenges};
 }));
 const artifacts=new FileReconcilerArtifacts({keyDirectory:root,routes});
 let firstStatus!:()=>void,targetReady=false,ready=false;
 const blocked=new Promise<void>(resolve=>{firstStatus=resolve;});
 const worker=new RemoteConfigurationReconciler(f.db.pool,{artifacts,resolveCname:f.resolveCname,
  gatewayStatus:{async read(cellId){
   const cell=routes.find(route=>route.cellId===cellId)!;
   const names=new Set((await readChallengeFolder(cell.challenges,new Set([f.hostname]),Date.now())).keys());
   if(cellId===target&&!targetReady){if(names.has(f.hostname))firstStatus();return [new Set()];}
   return [names];
  }},
  async issueCertificate({validation,signal}){
   assert.equal(validation.type,'tls-alpn-01');
   if(validation.type!=='tls-alpn-01')throw Error('wrong challenge');
   await validation.present(await challengeCertificate(f.hostname),signal);
   ready=true;
   throw Error('synthetic validation failure');
  },
 });
 const run=f.run(worker);
 try{
  assert.equal(await Promise.race([blocked.then(()=>true),run.then(()=>false)]),true,'issuer must reach the gateway check');
  assert.equal(ready,false);
  for(const route of routes)assert.deepEqual(await readdir(route.challenges),[f.hostname+'.json']);
  assert.equal((await f.db.pool.query('SELECT hostname FROM remote_certificate_orders')).rows[0].hostname,f.hostname);
 }finally{targetReady=true;await run;}
 assert.equal(ready,true);
 for(const route of routes)assert.deepEqual(await readdir(route.challenges),[]);
 assert.equal((await f.db.pool.query('SELECT count(*)::int AS count FROM remote_certificate_orders')).rows[0].count,0);
});

test('a custom staff name keeps retrying beyond its eighth unanswerable gateway attempt',async t=>{
 const f=await customStaff(t);
 let orders=0;
 const worker=new RemoteConfigurationReconciler(f.db.pool,{resolveCname:f.resolveCname,
  async issueCertificate(){orders++;throw Error('missing gateway must refuse before order');},
 });
 for(let attempt=1;attempt<=9;attempt++)await f.run(worker);
 const job=(await f.db.pool.query(`SELECT status,last_error,attempts,runs::integer,available_at>clock_timestamp() AS delayed,
  available_at<=clock_timestamp()+interval '900 seconds' AS bounded FROM remote_configuration_jobs WHERE target_id=$1 AND kind='certificate_staff'`,[f.venue.installationId])).rows[0];
 assert.deepEqual(job,{status:'pending',last_error:'challenge_not_answerable',attempts:7,runs:9,delayed:true,bounded:true});
 await f.db.pool.query(`UPDATE remote_configuration_jobs SET status='running',attempts=8,claim_id=$2,
  lease_until=clock_timestamp()-interval '1 second' WHERE target_id=$1 AND kind='certificate_staff'`,[f.venue.installationId,randomUUID()]);
 await f.run(worker);
 const recovered=(await f.db.pool.query("SELECT status,last_error,attempts,runs::integer FROM remote_configuration_jobs WHERE target_id=$1 AND kind='certificate_staff'",[f.venue.installationId])).rows[0];
 assert.deepEqual(recovered,{status:'pending',last_error:'challenge_not_answerable',attempts:7,runs:10});
 assert.equal(orders,0);
});
