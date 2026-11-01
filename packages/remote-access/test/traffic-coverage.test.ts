import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {transaction} from '@waitron-cloud/registration';
import {venueServiceFixture,set} from '../../registration/test/fixtures/venue-service.ts';
import {RemoteAccessStore} from '../src/placement.ts';
import {registerForwardReporter} from '../src/forward-observations.ts';
import {signTrafficLifecycle,trafficManifestDigest,type TrafficLifecycle} from '../src/traffic-lifecycle.ts';
import type {ReportingGatewayManifest} from '../src/manifest.ts';

// Missing journal rows, stale keys or mutable boundaries would let an exporter invent complete history.
async function fixture(){
 const api=await import(new URL('../src/traffic-coverage.ts',import.meta.url).href).catch(()=>({}));
 assert.equal(typeof api.TrafficCoverageStore,'function','the country needs a durable traffic coverage journal');
 const f=await venueServiceFixture();
 try{
  await set(f,'connected');
  const cellId=randomUUID(),gatewayId=randomUUID(),keys=generateKeyPairSync('ed25519'),coverage=new api.TrafficCoverageStore(f.pool);
  const remote=new RemoteAccessStore(f.pool,'test-venue-levels',coverage);
  await remote.createCell({id:cellId,country:'ES',provider:'aws',environment:'test',suffix:'lifetime.example.test',subnet:24,publicKey:randomBytes(32).toString('base64'),endpoint:'gateway.example.test:51820'});
  const installationId=(await f.pool.query('SELECT id FROM installations WHERE venue_id=$1 AND revoked_at IS NULL',[f.venues[0]])).rows[0].id;
  await remote.provision(installationId,cellId,randomBytes(32).toString('base64'));
  await transaction(f.pool,c=>registerForwardReporter(c,{cellId,gatewayId,generation:1,publicKey:keys.publicKey.export({type:'spki',format:'pem'}).toString()}));
  let manifest:ReportingGatewayManifest;
  await remote.publishReportingManifest(cellId,async m=>{assert.equal(m.version,2);manifest=m as ReportingGatewayManifest;});
  const start:TrafficLifecycle={version:1,audience:'waitron-cloud-remote-traffic-lifecycle',kind:'start',cellId,gatewayId,generation:1,processId:randomUUID(),
   manifestDigest:trafficManifestDigest(manifest!),startedAt:new Date(manifest!.issuedAt).toISOString(),predecessorId:null,endedAt:null,finalSequence:null};
  const mapping={country:'ES' as const,environment:'test' as const,cellId,directory:'/private/traffic',writerUid:1000,readerGid:1001};
  const rows=async()=>(await f.pool.query('SELECT * FROM remote_traffic_processes ORDER BY process_id')).rows;
  return {...f,cellId,gatewayId,keys,coverage,remote,installationId,manifest:manifest!,mapping,start,rows,
   send(value:TrafficLifecycle=start){return coverage.recordLifecycle(mapping,signTrafficLifecycle(value,keys.privateKey));}};
 }catch(error){await f.close();throw error;}
}

test('country journal retains both channels exact publication retries and explicit empty authority',async()=>{
 const f=await fixture();try{
  const rows=(await f.pool.query('SELECT * FROM remote_traffic_coverage ORDER BY channel')).rows;
  assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.channel),['public','staff']);
  for(const row of rows){assert.equal(row.manifest_digest,trafficManifestDigest(f.manifest));assert.equal(row.venue_id,f.venues[0]);assert.equal(row.organisation_id,f.scope.organisationId);assert.equal(row.legal_business_id,f.scope.legalBusinessId);}
  await transaction(f.pool,c=>f.coverage.expect(c,f.manifest));
  assert.equal((await f.pool.query('SELECT count(*) FROM remote_traffic_coverage')).rows[0].count,'2');
  await f.pool.query("UPDATE installation_services SET state='unconfigured' WHERE installation_id=$1 AND service='remote_access'",[f.installationId]);
  await f.remote.publishReportingManifest(f.cellId,async m=>assert.deepEqual(m.routes,[]));
  assert.deepEqual((await f.pool.query('SELECT kind,channel FROM remote_traffic_coverage ORDER BY manifest_sequence,channel')).rows,
   [{kind:'route',channel:'public'},{kind:'route',channel:'staff'},{kind:'empty',channel:null}]);
 }finally{await f.close();}
});

test('real journal rolls back with failed publication and refuses non-test or stale reporter manifests',async()=>{
 const f=await fixture();try{
  const before=(await f.pool.query('SELECT * FROM remote_traffic_coverage ORDER BY id')).rows;
  const sequence=(await f.pool.query('SELECT sequence FROM remote_cells')).rows;
  await assert.rejects(f.remote.publishReportingManifest(f.cellId,async()=>{throw Error('fixture_publication_failure');}),/fixture_publication_failure/);
  assert.deepEqual((await f.pool.query('SELECT * FROM remote_traffic_coverage ORDER BY id')).rows,before);
  assert.deepEqual((await f.pool.query('SELECT sequence FROM remote_cells')).rows,sequence);
  for(const manifest of [{...f.manifest,version:1},{...f.manifest,reporter:{gatewayId:f.gatewayId,generation:2}},
   {...f.manifest,sequence:f.manifest.sequence+1},{...f.manifest,expiresAt:f.manifest.issuedAt}])
   await assert.rejects(transaction(f.pool,c=>f.coverage.expect(c,manifest)),/traffic_authority_unavailable/);
  await assert.rejects(f.pool.query("UPDATE remote_cells SET environment='production'"),{code:'23503'});
  const production=randomUUID();
  await f.remote.createCell({id:production,country:'ES',provider:'aws',environment:'production',suffix:'production.example.test',subnet:25,
   publicKey:randomBytes(32).toString('base64'),endpoint:'production.example.test:51820'});
  await transaction(f.pool,c=>registerForwardReporter(c,{cellId:production,gatewayId:f.gatewayId,generation:1,publicKey:f.keys.publicKey.export({type:'spki',format:'pem'}).toString()}));
  await f.pool.query('UPDATE remote_cells SET sequence=$2 WHERE id=$1',[production,f.manifest.sequence]);
  await assert.rejects(transaction(f.pool,c=>f.coverage.expect(c,{...f.manifest,cellId:production})),/traffic_authority_unavailable/);
  assert.deepEqual((await f.pool.query('SELECT * FROM remote_traffic_coverage ORDER BY id')).rows,before);
 }finally{await f.close();}
});

test('signed process retries preserve start and ending facts without closing a predecessor',async()=>{
 const f=await fixture();try{
  await f.send();const first=await f.rows();assert.equal(first.length,1);
  assert.equal(first[0].process_id,f.start.processId);assert.equal(first[0].started_at.toISOString(),f.start.startedAt);
  await assert.doesNotReject(f.send());assert.deepEqual(await f.rows(),first);
  const next={...f.start,processId:randomUUID(),predecessorId:f.start.processId};await f.send(next);
  assert.equal((await f.rows()).find(r=>r.process_id===f.start.processId).ended_at,null);
  const end={...f.start,kind:'end' as const,endedAt:f.start.startedAt,finalSequence:0};await f.send(end);
  const ended=await f.rows();await f.send(end);assert.deepEqual(await f.rows(),ended);
  await assert.doesNotReject(f.send());assert.deepEqual(await f.rows(),ended,'start retry cannot reopen a closed process');
  assert.equal(ended.find(r=>r.process_id===next.processId).ended_at,null);
  assert.equal((await f.pool.query('SELECT last_sequence FROM remote_forward_reporters')).rows[0].last_sequence,'0');
  assert.equal((await f.pool.query('SELECT count(*) FROM usage_events')).rows[0].count,'0');
 }finally{await f.close();}
});

test('accepted lifecycle replay uses saved key after rotation but new old-generation claims refuse',async()=>{
 const f=await fixture();try{
  await f.send();const end={...f.start,kind:'end' as const,endedAt:f.start.startedAt,finalSequence:0};await f.send(end);
  await transaction(f.pool,c=>registerForwardReporter(c,{cellId:f.cellId,gatewayId:randomUUID(),generation:2,publicKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}).toString()}));
  const before=await f.rows();await f.send();await f.send(end);assert.deepEqual(await f.rows(),before);
  await assert.rejects(f.send({...f.start,processId:randomUUID()}),/traffic_authority_unavailable/);
  await assert.rejects(f.coverage.recordLifecycle(f.mapping,signTrafficLifecycle(f.start,generateKeyPairSync('ed25519').privateKey)),/invalid_traffic_lifecycle/);
  await assert.rejects(f.send({...f.start,predecessorId:randomUUID()}),/traffic_lifecycle_conflict/);
  await assert.rejects(f.send({...end,endedAt:new Date(Date.parse(end.startedAt)+1).toISOString(),finalSequence:1}),/traffic_lifecycle_conflict/);
  assert.deepEqual(await f.rows(),before);
 }finally{await f.close();}
});

test('unbound forged future stale and crossed lifecycle inputs have no durable effects',async()=>{
 const f=await fixture();try{
  for(const changed of [{country:'FR'},{environment:'production'},{cellId:randomUUID()},{directory:'relative'},{writerUid:-1},{extra:true}])
   await assert.rejects(f.coverage.recordLifecycle({...f.mapping,...changed},signTrafficLifecycle(f.start,f.keys.privateKey)));
  for(const changed of [{cellId:randomUUID()},{gatewayId:randomUUID()},{generation:2},{manifestDigest:'b'.repeat(64)},
   {startedAt:new Date(f.manifest.issuedAt-1).toISOString()},{startedAt:new Date(Date.now()+60000).toISOString()},
   {predecessorId:randomUUID()},{kind:'end',endedAt:f.start.startedAt,finalSequence:0}])
   await assert.rejects(f.send({...f.start,...changed} as TrafficLifecycle),/traffic_authority_unavailable/);
  await assert.rejects(f.coverage.recordLifecycle(f.mapping,signTrafficLifecycle(f.start,generateKeyPairSync('ed25519').privateKey)),/invalid_traffic_lifecycle/);
  await f.pool.query('UPDATE remote_forward_reporters SET revoked_at=clock_timestamp()');
  await assert.rejects(f.send(),/traffic_authority_unavailable/);
  assert.deepEqual(await f.rows(),[]);
 }finally{await f.close();}
});

test('lifecycle rechecks the reporter key after an observed database lock wait',async()=>{
 const f=await fixture(),held=await f.peer.connect();let pending:Promise<unknown>|undefined;
 try{
  await held.query('BEGIN');await held.query('UPDATE remote_forward_reporters SET public_key=$1 WHERE cell_id=$2',
   [generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}).toString(),f.cellId]);
  pending=assert.rejects(f.send(),/invalid_traffic_lifecycle/);
  let waiting=false;
  for(let attempt=0;attempt<300;attempt++){
   waiting=(await f.peer.query("SELECT count(*)::integer AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[f.schema])).rows[0].n>0;
   if(waiting)break;await delay(10);
  }
  assert.equal(waiting,true,'the collector must wait for committed reporter authority');
  await held.query('COMMIT');await pending;assert.deepEqual(await f.rows(),[]);
 }finally{await held.query('ROLLBACK');held.release();await pending;await f.close();}
});

test('end cannot revise accepted checkpoints or the immutable start binding',async()=>{
 const f=await fixture();try{
  await f.send();
  const until=new Date(Date.parse(f.start.startedAt)+1000).toISOString();
  await f.pool.query('UPDATE remote_traffic_processes SET last_sequence=1,last_until=$1',[until]);
  const before=await f.rows();
  for(const change of [{endedAt:f.start.startedAt,finalSequence:0},{startedAt:new Date(Date.parse(until)-500).toISOString(),endedAt:until,finalSequence:1},
   {manifestDigest:'b'.repeat(64),endedAt:until,finalSequence:1}])
   await assert.rejects(f.send({...f.start,kind:'end',...change}),/traffic_lifecycle_conflict/);
  assert.deepEqual(await f.rows(),before);
  await f.send({...f.start,kind:'end',endedAt:until,finalSequence:1});
  assert.equal((await f.rows())[0].final_sequence,'1');
 }finally{await f.close();}
});

test('uncollected expired starts and fresh endings after reporter changes never become accepted history',async()=>{
 const f=await fixture();try{
  const now=(await f.pool.query('SELECT clock_timestamp() AS now')).rows[0].now.getTime();
  const startedAt=new Date(now-1200000).toISOString();
  await f.pool.query(`INSERT INTO remote_traffic_coverage(cell_id,gateway_id,generation,manifest_digest,manifest_sequence,issued_at,expires_at,kind)
   VALUES($1,$2,1,$3,1,$4,$5,'empty')`,[f.cellId,f.gatewayId,'c'.repeat(64),startedAt,new Date(now-600000)]);
  await assert.rejects(f.send({...f.start,startedAt,manifestDigest:'c'.repeat(64)}),/traffic_authority_unavailable/);
  await f.send();const before=await f.rows(),end={...f.start,kind:'end' as const,endedAt:f.start.startedAt,finalSequence:0};
  await f.pool.query('UPDATE remote_forward_reporters SET generation=2');
  await assert.rejects(f.send(end),/traffic_authority_unavailable/);
  await f.pool.query('UPDATE remote_forward_reporters SET generation=1,revoked_at=clock_timestamp()');
  await assert.rejects(f.send(end),/traffic_authority_unavailable/);
  await assert.doesNotReject(f.send());
  assert.deepEqual(await f.rows(),before);
 }finally{await f.close();}
});
