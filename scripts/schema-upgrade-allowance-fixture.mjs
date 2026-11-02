import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,realpath,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {source} from './schema-upgrade-fixture.mjs';

export const allowanceTables=['billing_allowance_versions','billing_allowance_reservations','remote_traffic_processes','remote_traffic_reports','remote_traffic_samples','remote_traffic_coverage'];
export async function emptyAllowances(pool){
 for(const table of allowanceTables)assert.equal((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count,'0',table+' starts empty');
 assert.equal((await pool.query('SELECT count(*) FROM translation_jobs WHERE allowance_open_calls<>0')).rows[0].count,'0');
 return true;
}
export async function allowanceState(pool){
 const value={};
 for(const table of [...allowanceTables,'translation_jobs','remote_forward_reporters','remote_placements','billing_trials','billing_service_authority'])
  value[table]=(await pool.query(`SELECT to_jsonb(t) AS value FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
 value.usage_events=(await pool.query("SELECT to_jsonb(t) AS value FROM usage_events t WHERE event_type='remote_access.traffic_bytes' ORDER BY to_jsonb(t)::text")).rows;
 return value;
}
export async function seedAllowances(root,pool,state){
 const api=await source(root,'packages/registration/src/index.ts');
 const {RemoteAccessStore}=await source(root,'packages/remote-access/src/placement.ts');
 const {registerForwardReporter}=await source(root,'packages/remote-access/src/forward-observations.ts');
 const {TrafficCoverageStore}=await source(root,'packages/remote-access/src/traffic-coverage.ts');
 const {signTrafficLifecycle,trafficManifestDigest}=await source(root,'packages/remote-access/src/traffic-lifecycle.ts');
 const {TrafficStore}=await source(root,'packages/remote-access/src/traffic-store.ts');
 const {signTrafficReport}=await source(root,'packages/remote-access/src/traffic-report.ts');
 const {TrafficSpool}=await source(root,'packages/remote-access/src/traffic-spool.ts');
 await emptyAllowances(pool);
 const scratch=await realpath(await mkdtemp(join(tmpdir(),'allowance-recovery-state-')));
 try{
  const event=()=>({key:randomUUID(),occurredAt:new Date().toISOString(),source:{kind:'internal'}});
  const store=new api.BillingStore(pool),scopes=state.owners.map(o=>({organisationId:o.organisationId,legalBusinessId:o.legalBusinessId}));
  for(const scope of scopes)await store.execute(scope,event(),{type:'ensure_business'});
  const venueId=state.installations[0].venueId,installationId=state.installations[0].installationId;
  const today=(await pool.query("SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS day")).rows[0].day;
  await store.transition(scopes[0],event(),{type:'start_trial',venueId,level:'connected',on:today});
  const trial=(await store.history(scopes[0],venueId)).trials[0];
  const units={transactional_email:'20',address_lookup:'20',sms:'0',content_translation:'20',rota_solver:'20'};
  const version={revision:1,effectiveFrom:'2020-01-01',limits:{registered:{...units},connected:{...units},hosted:{...units}},unpaidTrial:{content_translation:'20',rota_solver:'20'}};
  const config=new api.AllowanceConfigStore(pool);
  await config.publish(version);await config.publish({...version,revision:2,effectiveFrom:'2090-01-01'});
  const items=[];let pendingJob;
  for(const kind of ['spent','released','pending','held']){
   const input={accountId:state.owners[0].accountId,venueId,installationId,service:'content_translation',operationId:randomUUID(),binding:'recovery-'+kind,units:2n};
   const held=await api.transaction(pool,c=>api.reserveAllowance(c,input)),job=randomUUID();
   await pool.query(`INSERT INTO translation_jobs(id,installation_id,venue_id,operation_id,job_sha256,job_bytes,total,provider,model,prompt_version)
    VALUES($1,$2,$3,$4,$5,1,2,'openai','gpt-6-luna','translate-all-v1')`,[job,installationId,venueId,input.operationId,'b'.repeat(64)]);
   let receipt=held;
   if(kind==='released'){receipt=await api.transaction(pool,c=>api.releaseUnstartedAllowance(c,held.id));await pool.query("UPDATE translation_jobs SET state='expired' WHERE id=$1",[job]);}
   if(kind==='spent'||kind==='pending'){
    receipt=await api.transaction(pool,c=>api.spendAllowance(c,held.id));
    await api.transaction(pool,c=>api.recordAllowanceAttempt(c,held.id,new Date().toISOString()));
   }
   if(kind==='spent')await pool.query("UPDATE translation_jobs SET state='done',done=2,finished_at=clock_timestamp(),started_at=clock_timestamp() WHERE id=$1",[job]);
   if(kind==='pending'){
    pendingJob=job;await pool.query("UPDATE translation_jobs SET allowance_open_calls=1,state='failed',reason='provider_unavailable',failed=2,started_at=clock_timestamp(),finished_at=clock_timestamp(),lease_count=1 WHERE id=$1",[job]);
   }
   items.push({kind,input,receipt,job});
  }
  const keys=generateKeyPairSync('ed25519'),cellId=randomUUID(),gatewayId=randomUUID(),coverage=new TrafficCoverageStore(pool);
  const remote=new RemoteAccessStore(pool,'test-venue-levels',coverage);
  await remote.createCell({id:cellId,country:'ES',provider:'aws',environment:'test',suffix:'recovery.example.test',subnet:24,publicKey:randomBytes(32).toString('base64'),endpoint:'gateway.example.test:51820'});
  await remote.provision(installationId,cellId,randomBytes(32).toString('base64'));
  await api.transaction(pool,c=>registerForwardReporter(c,{cellId,gatewayId,generation:1,publicKey:keys.publicKey.export({type:'spki',format:'pem'}).toString()}));
  let manifest;await remote.publishReportingManifest(cellId,async value=>{manifest=value;});
  const mapping={country:'ES',environment:'test',cellId,directory:join(scratch,'export'),writerUid:process.geteuid(),readerGid:process.getegid()};
  const start={version:1,audience:'waitron-cloud-remote-traffic-lifecycle',kind:'start',cellId,gatewayId,generation:1,processId:randomUUID(),manifestDigest:trafficManifestDigest(manifest),startedAt:new Date(manifest.issuedAt).toISOString(),predecessorId:null,endedAt:null,finalSequence:null};
  await coverage.recordLifecycle(mapping,signTrafficLifecycle(start,keys.privateKey));
  const entries=(await pool.query("SELECT * FROM remote_traffic_coverage WHERE cell_id=$1 AND kind='route' ORDER BY channel",[cellId])).rows.map(row=>({installationId,venueId,revision:Number(row.configuration_revision),routeBinding:row.route_binding,channel:row.channel,ingress:row.channel==='staff'?'10':'0',egress:row.channel==='staff'?'25':'0'}));
  assert.equal(entries.length,2);
  const traffic=new TrafficStore(pool),directory=join(scratch,'spool'),spool=new TrafficSpool({directory,maxBytes:1048576}),envelopes=[];
  let firstCheckpoint;
  for(const sequence of [1,2]){
   const report={version:1,audience:'waitron-cloud-remote-traffic',cellId,gatewayId,generation:1,processId:start.processId,sequence,from:new Date(Date.parse(start.startedAt)+(sequence===1?0:1001)).toISOString(),until:new Date(Date.parse(start.startedAt)+sequence*1000).toISOString(),complete:true,entries};
   const envelope=signTrafficReport(report,keys.privateKey);envelopes.push(envelope);
   await spool.append(report,envelope,new Map());
   if(sequence===1)firstCheckpoint=await readFile(join(directory,'checkpoint.json'));
   assert.equal((await traffic.record(mapping,envelope)).state,'accepted');
  }
  const spoolFiles={checkpoint:await readFile(join(directory,'checkpoint.json')),initialized:await readFile(join(directory,'initialized'))};
  return {items,pendingJob,version,scopes,venueId,trial,keys,mapping,start,envelopes,scratch,spoolFiles,firstCheckpoint,async close(){await rm(scratch,{recursive:true,force:true});}};
 }catch(error){await rm(scratch,{recursive:true,force:true});throw error;}
}
export async function restoredAllowances(root,pool,proof,expected){
 const api=await source(root,'packages/registration/src/index.ts');
 const {TrafficStore}=await source(root,'packages/remote-access/src/traffic-store.ts');
 const {TrafficSpool}=await source(root,'packages/remote-access/src/traffic-spool.ts');
 const {signTrafficReport,trafficEnvelopeReport}=await source(root,'packages/remote-access/src/traffic-report.ts');
 const {readTrialUsage}=await source(root,'packages/registration/src/billing-trial-usage.ts');
 assert.deepEqual(await allowanceState(pool),expected,'pending calls and exact allowance facts survive');
 const config=new api.AllowanceConfigStore(pool);
 assert.deepEqual(await config.effective('2026-11-01'),proof.version);assert.equal((await config.effective('2090-01-01')).revision,2);
 for(const item of proof.items){
  assert.deepEqual(await api.transaction(pool,c=>api.reserveAllowance(c,item.input)),item.receipt);
  if(item.kind==='spent'||item.kind==='pending')await assert.rejects(api.transaction(pool,c=>api.releaseUnstartedAllowance(c,item.receipt.id)),{code:'allowance_conflict'});
  if(item.kind==='released')assert.deepEqual(await api.transaction(pool,c=>api.releaseUnstartedAllowance(c,item.receipt.id)),item.receipt);
  await assert.rejects(api.transaction(pool,c=>api.reserveAllowance(c,{...item.input,accountId:proof.items[0].input.accountId,venueId:proof.venueId,binding:'changed'})),{code:'allowance_conflict'});
 }
 await assert.rejects(api.transaction(pool,async c=>api.reserveAllowance(c,{...proof.items[0].input,accountId:(await c.query('SELECT account_id FROM organisation_memberships WHERE organisation_id=$1',[proof.scopes[1].organisationId])).rows[0].account_id})),{code:'allowance_scope_not_found'});
 assert.equal((await pool.query('SELECT allowance_open_calls FROM translation_jobs WHERE id=$1',[proof.pendingJob])).rows[0].allowance_open_calls,1);
 assert.equal((await pool.query("SELECT sum(units)::text AS n FROM billing_allowance_reservations WHERE state IN ('held','spent')")).rows[0].n,'6');
 const traffic=new TrafficStore(pool),report=trafficEnvelopeReport(proof.envelopes[0]);
 await assert.rejects(traffic.record(proof.mapping,signTrafficReport(report,generateKeyPairSync('ed25519').privateKey)),/invalid_traffic_report/);
 await assert.rejects(traffic.record(proof.mapping,signTrafficReport({...report,entries:[{...report.entries[0],ingress:'1'},report.entries[1]]},proof.keys.privateKey)),/traffic_report_conflict/);
 // Each restored spool gets its original identity and pending signed bytes, including a stale checkpoint.
 for(const checkpoint of [proof.spoolFiles.checkpoint,proof.firstCheckpoint]){
  const directory=await mkdtemp(join(proof.scratch,'restored-'));
  try{
   await writeFile(join(directory,'initialized'),proof.spoolFiles.initialized,{mode:0o600});await writeFile(join(directory,'checkpoint.json'),checkpoint,{mode:0o600});
   const spool=new TrafficSpool({directory,maxBytes:1048576}),pending=await spool.pending();
   assert.equal(pending.length,checkpoint===proof.firstCheckpoint?1:2);
   for(const envelope of pending){const r=trafficEnvelopeReport(envelope);assert.equal((await traffic.record(proof.mapping,envelope)).state,'replay');await spool.ack(r.processId,r.sequence);}
   assert.deepEqual(await spool.pending(),[]);assert.equal((await spool.restore()).processId,proof.start.processId);
  }finally{await rm(directory,{recursive:true,force:true});}
 }
 assert.equal((await pool.query("SELECT sum(quantity)::text AS n FROM usage_events WHERE event_type='remote_access.traffic_bytes'")).rows[0].n,'70');
 assert.equal((await pool.query('SELECT has_gap FROM remote_traffic_processes WHERE process_id=$1',[proof.start.processId])).rows[0].has_gap,true);
 assert.deepEqual(await api.transaction(pool,c=>readTrialUsage(c,proof.scopes[0],proof.venueId,proof.trial)),{complete:false,usage:{remoteTrafficDays:0,translationRuns:2,solverRuns:0}});
 assert.deepEqual(await allowanceState(pool),expected,'retry and foreign refusals do not replace restored facts');
}
