import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {transaction} from '@waitron-cloud/registration';
import {venueServiceFixture,set} from '../../registration/test/fixtures/venue-service.ts';
import {RemoteAccessStore} from '../src/placement.ts';
import {registerForwardReporter} from '../src/forward-observations.ts';
import {TrafficCoverageStore,type TrafficMapping} from '../src/traffic-coverage.ts';
import {signTrafficLifecycle,trafficManifestDigest,type TrafficLifecycle} from '../src/traffic-lifecycle.ts';
import {signTrafficReport,type TrafficReport} from '../src/traffic-report.ts';
import type {ReportingGatewayManifest} from '../src/manifest.ts';

// Missing signature, binding, replay or transactional checks would create duplicate or foreign usage.
async function fixture(){
 const api=await import(new URL('../src/traffic-store.ts',import.meta.url).href).catch(()=>({}));
 assert.equal(typeof api.TrafficStore,'function','signed traffic requires durable transactional ingestion');
 const f=await venueServiceFixture();
 try{
  await set(f,'connected');const cellId=randomUUID(),gatewayId=randomUUID(),keys=generateKeyPairSync('ed25519');
  const coverage=new TrafficCoverageStore(f.pool),remote=new RemoteAccessStore(f.pool,'test-venue-levels',coverage);
  await remote.createCell({id:cellId,country:'ES',provider:'aws',environment:'test',suffix:'ingestion.example.test',subnet:24,
   publicKey:randomBytes(32).toString('base64'),endpoint:'gateway.example.test:51820'});
  const installationId=(await f.pool.query('SELECT id FROM installations WHERE venue_id=$1 AND revoked_at IS NULL',[f.venues[0]])).rows[0].id;
  await remote.provision(installationId,cellId,randomBytes(32).toString('base64'));
  await transaction(f.pool,c=>registerForwardReporter(c,{cellId,gatewayId,generation:1,publicKey:keys.publicKey.export({type:'spki',format:'pem'}).toString()}));
  let manifest:ReportingGatewayManifest;
  await remote.publishReportingManifest(cellId,async m=>{manifest=m as ReportingGatewayManifest;});
  const mapping:TrafficMapping={country:'ES',environment:'test',cellId,directory:'/private/traffic',writerUid:1000,readerGid:1001};
  const start:TrafficLifecycle={version:1,audience:'waitron-cloud-remote-traffic-lifecycle',kind:'start',cellId,gatewayId,generation:1,processId:randomUUID(),
   manifestDigest:trafficManifestDigest(manifest!),startedAt:new Date(manifest!.issuedAt).toISOString(),predecessorId:null,endedAt:null,finalSequence:null};
  await coverage.recordLifecycle(mapping,signTrafficLifecycle(start,keys.privateKey));
  const journal=(await f.pool.query("SELECT * FROM remote_traffic_coverage WHERE channel='staff'")).rows[0];
  const report:TrafficReport={version:1,audience:'waitron-cloud-remote-traffic',cellId,gatewayId,generation:1,processId:start.processId,
   sequence:1,from:start.startedAt,until:new Date(Date.parse(start.startedAt)+1000).toISOString(),complete:true,
   entries:[{installationId,venueId:f.venues[0]!,revision:Number(journal.configuration_revision),routeBinding:journal.route_binding,channel:'staff',ingress:'10',egress:'25'}]};
  const store=new api.TrafficStore(f.pool);
  const snapshot=async()=>{
   const result:Record<string,unknown>={};
   for(const table of ['remote_traffic_processes','remote_traffic_reports','remote_traffic_samples','usage_events'])
    result[table]=(await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
   return result;
  };
  return {...f,cellId,gatewayId,keys,coverage,remote,installationId,mapping,start,report,traffic:store,snapshot,
   send(value:TrafficReport=report){return store.record(mapping,signTrafficReport(value,keys.privateKey));},
   async total(){return (await f.pool.query("SELECT coalesce(sum(quantity),0)::text AS n FROM usage_events WHERE event_type='remote_access.traffic_bytes'")).rows[0].n;}};
 }catch(error){await f.close();throw error;}
}

test('traffic atomic replay and scope survive reconnect',async()=>{
 const f=await fixture();try{
  assert.deepEqual(await f.send(),{state:'accepted',processId:f.start.processId,sequence:1});assert.equal(await f.total(),'35');
  assert.equal((await f.pool.query('SELECT last_sequence FROM remote_traffic_processes')).rows[0].last_sequence,'1');
  const before=await f.snapshot();assert.deepEqual(await f.send(),{state:'replay',processId:f.start.processId,sequence:1});
  assert.deepEqual(await f.snapshot(),before);
  await assert.rejects(f.send({...f.report,entries:[{...f.report.entries[0]!,ingress:'11'}]}),/traffic_report_conflict/);
  assert.deepEqual(await f.snapshot(),before);
  const sources=(await f.pool.query('SELECT * FROM remote_traffic_samples')).rows;
  assert.equal(sources.length,1);assert.equal(sources[0].source_reference,`${f.start.processId}:1:${f.installationId}:staff`);
  assert.equal(sources[0].organisation_id,f.scope.organisationId);assert.equal(sources[0].legal_business_id,f.scope.legalBusinessId);
  assert.equal((await f.pool.query('SELECT last_sequence FROM remote_forward_reporters')).rows[0].last_sequence,'0');
 }finally{await f.close();}
});

test('empty and zero reports retain immutable retry receipts even after later reports and key rotation',async()=>{
 const f=await fixture();try{
  const empty={...f.report,entries:[]};await f.send(empty);
  const second={...f.report,sequence:2,from:empty.until,until:new Date(Date.parse(empty.until)+1000).toISOString(),
   entries:[{...f.report.entries[0]!,ingress:'0',egress:'0'}]};await f.send(second);
  await transaction(f.pool,c=>registerForwardReporter(c,{cellId:f.cellId,gatewayId:randomUUID(),generation:2,
   publicKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}).toString()}));
  const before=await f.snapshot();assert.equal((await f.send(empty)).state,'replay');assert.equal((await f.send(second)).state,'replay');
  await assert.rejects(f.send({...empty,complete:false}),/traffic_report_conflict/);
  await assert.rejects(f.traffic.record(f.mapping,signTrafficReport(empty,generateKeyPairSync('ed25519').privateKey)),/invalid_traffic_report/);
  assert.equal(await f.total(),'0');assert.deepEqual(await f.snapshot(),before);
  assert.equal((await f.pool.query('SELECT count(*) FROM remote_traffic_reports')).rows[0].count,'2');
  for(const sql of ['DELETE FROM remote_traffic_reports',"UPDATE remote_traffic_reports SET report_digest=repeat('a',64)"])
   await assert.rejects(f.pool.query(sql),{code:'55000'});
 }finally{await f.close();}
});

test('ledger failure rolls back source receipt and checkpoint before durable retry',async()=>{
 const f=await fixture();try{
  await f.pool.query(`CREATE FUNCTION reject_traffic_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture_ledger_failure'; END $$`);
  await f.pool.query('CREATE TRIGGER traffic_fixture_failure BEFORE INSERT ON usage_events FOR EACH ROW EXECUTE FUNCTION reject_traffic_fixture()');
  const before=await f.snapshot();await assert.rejects(f.send(),/fixture_ledger_failure/);assert.deepEqual(await f.snapshot(),before);
  await f.pool.query('DROP TRIGGER traffic_fixture_failure ON usage_events');await f.send();assert.equal(await f.total(),'35');
  assert.equal((await f.pool.query('SELECT count(*) FROM remote_traffic_reports')).rows[0].count,'1');
 }finally{await f.close();}
});

test('forged unbound crossed stale and non-test traffic adds no bytes',async()=>{
 const f=await fixture();try{
  const before=await f.snapshot();
  for(const mapping of [{...f.mapping,country:'FR'},{...f.mapping,environment:'production'},{...f.mapping,cellId:randomUUID()}])
   await assert.rejects(f.traffic.record(mapping,signTrafficReport(f.report,f.keys.privateKey)));
  await assert.rejects(f.traffic.record(f.mapping,signTrafficReport(f.report,generateKeyPairSync('ed25519').privateKey)),/invalid_traffic_report/);
  for(const change of [{cellId:randomUUID()},{gatewayId:randomUUID()},{generation:2},{processId:randomUUID()},
   {until:new Date(Date.now()+60000).toISOString()},{sequence:2}])
   await assert.rejects(f.send({...f.report,...change}),/traffic_authority_unavailable|traffic_sequence_gap/);
  for(const change of [{venueId:f.venues[1]!},{venueId:f.foreignVenue},{revision:f.report.entries[0]!.revision+1},{routeBinding:'a'.repeat(64)},{installationId:randomUUID()}])
   await assert.rejects(f.send({...f.report,entries:[{...f.report.entries[0]!,...change}]}),/traffic_authority_unavailable/);
  assert.equal(await f.total(),'0');assert.deepEqual(await f.snapshot(),before);
  await f.pool.query('UPDATE remote_forward_reporters SET revoked_at=clock_timestamp()');
  await assert.rejects(f.send(),/traffic_authority_unavailable/);assert.deepEqual(await f.snapshot(),before);
 }finally{await f.close();}
});

test('new reports require current authority while exact accepted reports survive route removal',async()=>{
 const f=await fixture();try{
  await f.send();await set(f,'registered');const before=await f.snapshot();
  assert.equal((await f.send()).state,'replay');
  await assert.rejects(f.send({...f.report,sequence:2,from:f.report.until,until:new Date(Date.parse(f.report.until)+1000).toISOString()}),/traffic_authority_unavailable/);
  assert.deepEqual(await f.snapshot(),before);assert.equal(await f.total(),'35');
 }finally{await f.close();}
});

test('report ingestion rechecks reporter key after an observed lock wait',async()=>{
 const f=await fixture(),held=await f.peer.connect();let pending:Promise<unknown>|undefined;
 try{
  await held.query('BEGIN');await held.query('UPDATE remote_forward_reporters SET public_key=$1 WHERE cell_id=$2',
   [generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}).toString(),f.cellId]);
  pending=assert.rejects(f.send(),/invalid_traffic_report/);let waiting=false;
  for(let n=0;n<300;n++){
   waiting=(await f.peer.query("SELECT count(*)::integer AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[f.schema])).rows[0].n>0;
   if(waiting)break;await delay(10);
  }
  assert.equal(waiting,true);await held.query('COMMIT');await pending;assert.equal(await f.total(),'0');
 }finally{await held.query('ROLLBACK');held.release();await pending;await f.close();}
});

test('sequence is contiguous but a time hole or incomplete report remains a durable gap',async()=>{
 const f=await fixture();try{
  const report={...f.report,entries:[f.report.entries[0]!,{...f.report.entries[0]!,channel:'public' as const,ingress:'0',egress:'0'}]};
  await assert.rejects(f.send({...report,sequence:2}),/traffic_sequence_gap/);await f.send(report);
  assert.equal((await f.pool.query('SELECT has_gap FROM remote_traffic_processes')).rows[0].has_gap,false);
  const next={...report,sequence:2,from:new Date(Date.parse(report.until)+1).toISOString(),until:new Date(Date.parse(report.until)+1000).toISOString()};
  await f.send(next);assert.equal((await f.pool.query('SELECT has_gap FROM remote_traffic_processes')).rows[0].has_gap,true);
  await f.send({...next,sequence:3,from:next.until,until:new Date(Date.parse(next.until)+1000).toISOString()});
  assert.equal((await f.pool.query('SELECT has_gap FROM remote_traffic_processes')).rows[0].has_gap,true);assert.equal(await f.total(),'105');
 }finally{await f.close();}
 const g=await fixture();try{await g.send({...g.report,complete:false,entries:[g.report.entries[0]!,{...g.report.entries[0]!,channel:'public',ingress:'0',egress:'0'}]});assert.equal((await g.pool.query('SELECT has_gap FROM remote_traffic_processes')).rows[0].has_gap,true);}finally{await g.close();}
});

test('concurrent identical reports commit one receipt and one usage event',async()=>{
 const f=await fixture();try{
  const results=await Promise.all([f.send(),f.send()]);assert.deepEqual(results.map(r=>r.state).sort(),['accepted','replay']);
  assert.equal(await f.total(),'35');assert.equal((await f.pool.query('SELECT count(*) FROM remote_traffic_reports')).rows[0].count,'1');
 }finally{await f.close();}
});

test('missing expected channels cannot leave a process marked continuously measured',async()=>{
 for(const channels of ['both','staff','none']){
  const f=await fixture();try{
   const entries=channels==='none'?[]:channels==='both'?[f.report.entries[0]!,{...f.report.entries[0]!,channel:'public' as const}]:f.report.entries;
   await f.send({...f.report,entries});
   assert.equal((await f.pool.query('SELECT has_gap FROM remote_traffic_processes')).rows[0].has_gap,channels!=='both',channels);
  }finally{await f.close();}
 }
});

test('queued traffic rechecks route revision after an observed installation wait',async()=>{
 const f=await fixture(),held=await f.peer.connect();let pending:Promise<unknown>|undefined;
 try{
  await held.query('BEGIN');await held.query('UPDATE installations SET configuration_revision=configuration_revision+1 WHERE id=$1',[f.installationId]);
  pending=assert.rejects(f.send(),/traffic_authority_unavailable/);let waiting=false;
  for(let n=0;n<300;n++){
   waiting=(await f.peer.query("SELECT count(*)::integer AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[f.schema])).rows[0].n>0;
   if(waiting)break;await delay(10);
  }
  assert.equal(waiting,true,'ingestion must serialize with configuration changes');await held.query('COMMIT');await pending;
  assert.equal(await f.total(),'0');assert.equal((await f.pool.query('SELECT count(*) FROM remote_traffic_reports')).rows[0].count,'0');
 }finally{await held.query('ROLLBACK');held.release();await pending;await f.close();}
});

test('report intervals cannot precede publication overlap accepted time or extend a signed ending',async()=>{
 const f=await fixture();try{
  const before=await f.snapshot();await assert.rejects(f.send({...f.report,from:new Date(Date.parse(f.report.from)-1).toISOString()}),/traffic_authority_unavailable/);
  assert.deepEqual(await f.snapshot(),before);await f.send();
  await assert.rejects(f.send({...f.report,sequence:2}),/traffic_authority_unavailable/);
  const end={...f.start,kind:'end' as const,endedAt:f.report.until,finalSequence:1};
  await f.coverage.recordLifecycle(f.mapping,signTrafficLifecycle(end,f.keys.privateKey));
  const ended=await f.snapshot();await assert.rejects(f.send({...f.report,sequence:2,from:f.report.until,until:new Date(Date.parse(f.report.until)+1000).toISOString()}),/traffic_authority_unavailable/);
  assert.deepEqual(await f.snapshot(),ended);assert.equal((await f.send()).state,'replay');assert.equal(await f.total(),'35');
 }finally{await f.close();}
});

test('traffic sums remain exact beyond JavaScript integer precision with UTC interval-end days',async()=>{
 const f=await fixture();try{
  await f.send({...f.report,entries:[{...f.report.entries[0]!,ingress:'9007199254740993',egress:'25'}]});
  assert.equal(await f.total(),'9007199254741018');
  const row=(await f.pool.query('SELECT day::text AS day,until_at,report_digest FROM remote_traffic_samples')).rows[0];
  assert.equal(row.day,f.report.until.slice(0,10));assert.equal(row.until_at.toISOString(),f.report.until);assert.match(row.report_digest,/^[a-f0-9]{64}$/);
 }finally{await f.close();}
});

test('signed deltas without journalled channel authority cannot become usage',async()=>{
 const f=await fixture();try{
  // The lifecycle stays valid, but this new binding has never been published by the country.
  await f.pool.query('UPDATE installations SET configuration_revision=configuration_revision+1 WHERE id=$1',[f.installationId]);
  const route=(await f.remote.reportingManifest(f.cellId)).routes[0]!;
  const {routeBinding}=await import('../src/forward-report.ts');
  await assert.rejects(f.send({...f.report,entries:[{...f.report.entries[0]!,revision:f.report.entries[0]!.revision+1,routeBinding:routeBinding(route!)}]}),/traffic_authority_unavailable/);
  assert.equal(await f.total(),'0');assert.equal((await f.pool.query('SELECT last_sequence FROM remote_traffic_processes')).rows[0].last_sequence,'0');
 }finally{await f.close();}
});

test('a new old-generation report refuses even while its public key remains available',async()=>{
 const f=await fixture();try{
  await f.send();await f.pool.query('UPDATE remote_forward_reporters SET generation=2');const before=await f.snapshot();
  await assert.rejects(f.send({...f.report,sequence:2,from:f.report.until,until:new Date(Date.parse(f.report.until)+1000).toISOString()}),/traffic_authority_unavailable/);
  assert.deepEqual(await f.snapshot(),before);
 }finally{await f.close();}
});
