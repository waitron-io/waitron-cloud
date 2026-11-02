import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {chmod,mkdir,mkdtemp,readFile,readdir,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TrafficSpool} from '../src/traffic-spool.ts';
import {collectTraffic} from '../src/traffic-collector.ts';
import {TrafficStore} from '../src/traffic-store.ts';
import {transaction} from '@waitron-cloud/registration';
import {venueServiceFixture,set} from '../../registration/test/fixtures/venue-service.ts';
import {RemoteAccessStore} from '../src/placement.ts';
import {registerForwardReporter} from '../src/forward-observations.ts';
import {TrafficCoverageStore,type TrafficMapping} from '../src/traffic-coverage.ts';
import {signTrafficLifecycle,trafficManifestDigest,type TrafficLifecycle} from '../src/traffic-lifecycle.ts';
import {signTrafficReport,type TrafficReport} from '../src/traffic-report.ts';
import type {ReportingGatewayManifest} from '../src/manifest.ts';

async function fixture(){
 const f=await venueServiceFixture();let directory:string|undefined;
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
  directory=await realpath(await mkdtemp(join(tmpdir(),'traffic-collector-db-')));await chmod(directory,0o2750);
  const mapping:TrafficMapping={country:'ES',environment:'test',cellId,directory,writerUid:process.geteuid!(),readerGid:process.getegid!()};
  const start:TrafficLifecycle={version:1,audience:'waitron-cloud-remote-traffic-lifecycle',kind:'start',cellId,gatewayId,generation:1,processId:randomUUID(),
   manifestDigest:trafficManifestDigest(manifest!),startedAt:new Date(manifest!.issuedAt).toISOString(),predecessorId:null,endedAt:null,finalSequence:null};
  await coverage.recordLifecycle(mapping,signTrafficLifecycle(start,keys.privateKey));
  const journal=(await f.pool.query("SELECT * FROM remote_traffic_coverage WHERE channel='staff'")).rows[0];
  const report:TrafficReport={version:1,audience:'waitron-cloud-remote-traffic',cellId,gatewayId,generation:1,processId:start.processId,
   sequence:1,from:start.startedAt,until:new Date(Date.parse(start.startedAt)+1000).toISOString(),complete:true,
   entries:[{installationId,venueId:f.venues[0]!,revision:Number(journal.configuration_revision),routeBinding:journal.route_binding,channel:'staff',ingress:'10',egress:'25'}]};
  const store=new TrafficStore(f.pool);
  const snapshot=async()=>{
   const result:Record<string,unknown>={};
   for(const table of ['remote_traffic_processes','remote_traffic_reports','remote_traffic_samples','usage_events'])
    result[table]=(await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
   return result;
  };
  return {...f,async close(){try{await f.close();}finally{if(directory)await rm(directory,{recursive:true,force:true});}},cellId,gatewayId,keys,coverage,remote,installationId,mapping,start,report,traffic:store,snapshot,
   send(value:TrafficReport=report){return store.record(mapping,signTrafficReport(value,keys.privateKey));},
   async total(){return (await f.pool.query("SELECT coalesce(sum(quantity),0)::text AS n FROM usage_events WHERE event_type='remote_access.traffic_bytes'")).rows[0].n;}};
 }catch(error){await f.close();if(directory)await rm(directory,{recursive:true,force:true});throw error;}
}

async function exporter(f:Awaited<ReturnType<typeof fixture>>){
 const directory=await realpath(await mkdtemp(join(tmpdir(),'traffic-export-db-')));
 const spool=new TrafficSpool({directory,maxBytes:32768}),envelope=signTrafficReport(f.report,f.keys.privateKey),text=JSON.stringify(envelope);
 const file=join(f.mapping.directory,`${f.report.processId}.1.json`);
 await spool.append(f.report,envelope,new Map());
 return {directory,spool,envelope,text,file,close:()=>rm(directory,{recursive:true,force:true})};
}

test('exporter country commit and lost reply retain one durable ledger event through restart',async()=>{
 const f=await fixture(),e=await exporter(f);try{
  await e.spool.transfer(f.mapping);assert.equal(await readFile(e.file,'utf8'),e.text);assert.equal(await f.total(),'0');
  await assert.rejects(collectTraffic(f.mapping,{async record(m,envelope){await f.traffic.record(m,envelope);throw Error('lost-committed-reply');}}),/^Error: traffic_collection_unavailable$/);
  assert.equal(await f.total(),'35');assert.deepEqual(await e.spool.pending(),[e.envelope]);
  const restarted=new TrafficSpool({directory:e.directory,maxBytes:32768});await restarted.transfer(f.mapping);
  assert.equal(await readFile(e.file,'utf8'),e.text);assert.deepEqual(await restarted.pending(),[e.envelope]);
  await collectTraffic(f.mapping,new TrafficStore(f.peer));await restarted.transfer(f.mapping);
  assert.deepEqual(await restarted.pending(),[]);assert.deepEqual(await readdir(f.mapping.directory),[]);assert.equal(await f.total(),'35');
  assert.equal((await f.pool.query('SELECT count(*) FROM remote_traffic_reports')).rows[0].count,'1');
  assert.equal((await f.pool.query('SELECT last_sequence FROM remote_traffic_processes')).rows[0].last_sequence,'1');
 }finally{await e.close();await f.close();}
});
test('exporter country rollback preserves checkpoint until a new collector commits',async()=>{
 const f=await fixture(),e=await exporter(f);try{
  await e.spool.transfer(f.mapping);const before=await f.snapshot();
  await f.pool.query(`CREATE FUNCTION reject_export_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture_ledger_failure'; END $$`);
  await f.pool.query('CREATE TRIGGER export_fixture_failure BEFORE INSERT ON usage_events FOR EACH ROW EXECUTE FUNCTION reject_export_fixture()');
  await assert.rejects(collectTraffic(f.mapping,f.traffic),/^Error: traffic_collection_unavailable$/);
  await e.spool.transfer(f.mapping);assert.equal(await f.total(),'0');assert.deepEqual(await f.snapshot(),before);assert.deepEqual(await e.spool.pending(),[e.envelope]);assert.equal(await readFile(e.file,'utf8'),e.text);
  await f.pool.query('DROP TRIGGER export_fixture_failure ON usage_events');
  await collectTraffic(f.mapping,f.traffic);await e.spool.transfer(f.mapping);assert.deepEqual(await e.spool.pending(),[]);assert.equal(await f.total(),'35');
 }finally{await e.close();await f.close();}
});
test('exporter orders a replay before the next country delta without duplicating bytes',async()=>{
 const f=await fixture(),e=await exporter(f);try{
  const second={...f.report,sequence:2,from:f.report.until,until:new Date(Date.parse(f.report.until)+1000).toISOString()},envelope=signTrafficReport(second,f.keys.privateKey);
  await e.spool.append(second,envelope,new Map());await f.send();await e.spool.transfer(f.mapping);
  await assert.rejects(collectTraffic(f.mapping,{async record(m,e){const r=JSON.parse(Buffer.from((e as {payload:string}).payload,'base64url').toString());if(r.sequence===2)throw Error('next-country-report-refused');return f.traffic.record(m,e);}}),/^Error: traffic_collection_unavailable$/);await e.spool.transfer(f.mapping);assert.equal(await f.total(),'35');assert.deepEqual(await e.spool.pending(),[envelope]);
  await collectTraffic(f.mapping,f.traffic);await e.spool.transfer(f.mapping);assert.equal(await f.total(),'70');assert.deepEqual(await e.spool.pending(),[]);
  assert.equal((await f.pool.query('SELECT count(*) FROM remote_traffic_reports')).rows[0].count,'2');
  assert.equal((await f.pool.query('SELECT last_sequence FROM remote_traffic_processes')).rows[0].last_sequence,'2');
 }finally{await e.close();await f.close();}
});
test('exporter replacement of an emptied collector directory cannot acknowledge a country commit',async()=>{
 const f=await fixture(),e=await exporter(f);try{
  await e.spool.transfer(f.mapping);await collectTraffic(f.mapping,f.traffic);assert.equal(await f.total(),'35');
  await rm(f.mapping.directory,{recursive:true});await mkdir(f.mapping.directory);await chmod(f.mapping.directory,0o2750);
  await assert.rejects(e.spool.transfer(f.mapping),/^Error: traffic_spool_unavailable$/);assert.deepEqual(await e.spool.pending(),[e.envelope]);
  assert.equal((await e.spool.restore()).complete,false);assert.equal(await f.total(),'35');
 }finally{await e.close();await f.close();}
});
