import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import type {PoolClient} from 'pg';
import {transaction} from '@waitron-cloud/registration';
import {venueServiceFixture,set} from '../../registration/test/fixtures/venue-service.ts';
import {RemoteAccessStore} from '../src/placement.ts';
import {RemoteConfigurationReconciler} from '../src/reconciler.ts';
import {registerForwardReporter} from '../src/forward-observations.ts';
import {verifyManifest,type AcceptedGatewayManifest} from '../src/manifest.ts';

// A publication without its expectation, or a journal committed after a failed publication,
// would let missing traffic masquerade as a complete unused trial.
async function fixture(){
 const f=await venueServiceFixture();
 try{
  await set(f,'connected');
  const cellId=randomUUID(),keys=generateKeyPairSync('ed25519');
  const remote=new RemoteAccessStore(f.pool,'test-venue-levels');
  await remote.createCell({id:cellId,country:'ES',provider:'aws',environment:'test',suffix:'traffic.example.test',subnet:23,publicKey:randomBytes(32).toString('base64'),endpoint:'gateway.example.test:51820'});
  const installationId=(await f.pool.query('SELECT id FROM installations WHERE venue_id=$1 AND revoked_at IS NULL',[f.venues[0]])).rows[0].id;
  await remote.provision(installationId,cellId,randomBytes(32).toString('base64'));
  await transaction(f.pool,client=>registerForwardReporter(client,{cellId,gatewayId:randomUUID(),generation:1,publicKey:keys.publicKey.export({type:'spki',format:'pem'}).toString()}));
  await f.pool.query('CREATE TABLE fixture_traffic_expectations(manifest jsonb NOT NULL, transaction_id bigint NOT NULL)');
  const coverage={async expect(client:PoolClient,manifest:AcceptedGatewayManifest){
   await client.query('INSERT INTO fixture_traffic_expectations VALUES($1,txid_current())',[manifest]);
  }};
  const saved=async()=>(await f.pool.query('SELECT manifest FROM fixture_traffic_expectations')).rows.map(r=>r.manifest);
  return {...f,remote,cellId,keys,installationId,coverage,saved};
 }catch(error){await f.close();throw error;}
}

test('direct traffic publication journals its exact manifest before exposing it',async()=>{
 const f=await fixture();try{
  const remote=new RemoteAccessStore(f.pool,'test-venue-levels',f.coverage);
  let published:AcceptedGatewayManifest|undefined;
  await remote.publishReportingManifest(f.cellId,async value=>{published=value;});
  assert.ok(published);assert.equal(published.version,2);assert.equal(published.routes.length,1);
  assert.deepEqual(await f.saved(),[published]);
  const before=await f.saved();await remote.reportingManifest(f.cellId);
  assert.deepEqual(await f.saved(),before,'a read is not a publication expectation');
 }finally{await f.close();}
});

test('direct failed publication rolls its journal and sequence back together',async()=>{
 const f=await fixture();try{
  let journalClient:PoolClient|undefined;
  const remote=new RemoteAccessStore(f.pool,'test-venue-levels',{async expect(client,manifest){journalClient=client;await f.coverage.expect(client,manifest);}});
  const before=(await f.pool.query('SELECT sequence FROM remote_cells WHERE id=$1',[f.cellId])).rows;
  await assert.rejects(remote.publishReportingManifest(f.cellId,async manifest=>{
   assert.ok(journalClient);assert.deepEqual((await journalClient.query('SELECT manifest FROM fixture_traffic_expectations')).rows,[{manifest}]);
   throw Error('fixture-publication-refusal');
  }),/fixture-publication-refusal/);
  assert.deepEqual(await f.saved(),[]);
  assert.deepEqual((await f.pool.query('SELECT sequence FROM remote_cells WHERE id=$1',[f.cellId])).rows,before);
 }finally{await f.close();}
});

test('traffic opt-in cannot use legacy mode a bypass executor or non-reporting publication',async()=>{
 const f=await fixture();try{
  for(const mode of ['existing','test-free-paid'] as const)assert.throws(()=>new RemoteAccessStore(f.pool,mode,f.coverage),/invalid_traffic_options/);
  assert.throws(()=>new RemoteConfigurationReconciler(f.pool,{planMode:'test-venue-levels',trafficCoverage:f.coverage}),/invalid_traffic_options/);
  assert.throws(()=>new RemoteConfigurationReconciler(f.pool,{planMode:'test-venue-levels',forwardReports:true,trafficCoverage:f.coverage,execute:async()=>{}}),/invalid_traffic_options/);
  let publications=0;
  await assert.rejects(new RemoteAccessStore(f.pool,'test-venue-levels',f.coverage).publishManifest(f.cellId,async()=>{publications++;}),/traffic_authority_unavailable/);
  assert.equal(publications,0);assert.deepEqual(await f.saved(),[]);
 }finally{await f.close();}
});

test('a refused traffic expectation prevents direct publication',async()=>{
 const f=await fixture();try{
  let publications=0;
  const remote=new RemoteAccessStore(f.pool,'test-venue-levels',{async expect(client,manifest){await f.coverage.expect(client,manifest);throw Error('fixture-journal-refusal');}});
  await assert.rejects(remote.publishReportingManifest(f.cellId,async()=>{publications++;}),/fixture-journal-refusal/);
  assert.equal(publications,0);assert.deepEqual(await f.saved(),[]);
 }finally{await f.close();}
});

test('traffic publication refuses missing reporter and production authority without effects',async()=>{
 const f=await fixture();try{
  const remote=new RemoteAccessStore(f.pool,'test-venue-levels',f.coverage);let publications=0;
  await f.pool.query('UPDATE remote_forward_reporters SET revoked_at=clock_timestamp() WHERE cell_id=$1',[f.cellId]);
  await assert.rejects(remote.publishReportingManifest(f.cellId,async()=>{publications++;}),/traffic_authority_unavailable/);
  await f.pool.query('UPDATE remote_forward_reporters SET revoked_at=NULL WHERE cell_id=$1',[f.cellId]);
  await f.pool.query("UPDATE remote_cells SET environment='production' WHERE id=$1",[f.cellId]);
  await assert.rejects(remote.publishReportingManifest(f.cellId,async()=>{publications++;}),/traffic_authority_unavailable/);
  assert.equal(publications,0);assert.deepEqual(await f.saved(),[]);
 }finally{await f.close();}
});

for(const refusal of ['none','journal','publication'] as const)test(`reconciled traffic publication keeps its journal and acknowledgement atomic: ${refusal}`,async()=>{
 const f=await fixture();try{
  let publications=0;let published:AcceptedGatewayManifest|undefined;
  const worker=new RemoteConfigurationReconciler(f.pool,{planMode:'test-venue-levels',forwardReports:true,
   trafficCoverage:{async expect(client,manifest){await f.coverage.expect(client,manifest);if(refusal==='journal')throw Error('fixture-journal-refusal');}},
   signingKeyForCell:async()=>f.keys.privateKey,
   artifacts:{async readCsr(){throw Error('unexpected');},async readCertificate(){throw Error('unexpected');},async publishCertificate(){throw Error('unexpected');},
    async publishManifest(cellId,envelope){assert.equal(cellId,f.cellId);publications++;published=verifyManifest(JSON.parse(envelope),f.keys.publicKey,f.cellId);if(refusal==='publication')throw Error('fixture-publication-refusal');}},
  });
  await worker.schedule();await f.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE kind<>'route'");
  assert.equal(await worker.runOnce(),true);
  const row=(await f.pool.query("SELECT applied_digest=desired_digest AS applied,failures FROM remote_configuration_jobs WHERE kind='route' AND target_id=$1",[f.cellId])).rows[0];
  if(refusal==='none'){
   assert.ok(published);assert.equal(published.version,2);assert.equal(published.routes.length,1);
   assert.deepEqual(await f.saved(),[published]);assert.deepEqual(row,{applied:true,failures:'0'});assert.equal(publications,1);
  }else{
   assert.deepEqual(await f.saved(),[]);assert.deepEqual(row,{applied:null,failures:'1'});assert.equal(publications,refusal==='journal'?0:1);
  }
 }finally{await f.close();}
});
