import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {createSession} from '@waitron-cloud/identity';
import {recordUsageEvent,UsageReconciler,UsageStore,transaction,type UsageEventInput} from '../src/index.ts';
import {venueServiceFixture} from './fixtures/venue-service.ts';

// These cases catch duplicated byte debits, relaxed source/unit checks and traffic leaking into the v1 view.
async function fixture(){
 const f=await venueServiceFixture();
 const input:UsageEventInput={organisationId:f.scope.organisationId,venueId:f.venues[0]!,type:'remote_access.traffic_bytes',quantity:35n,
  sourceKind:'remote_traffic_sample',sourceReference:`${randomUUID()}:1:${randomUUID()}:staff`,occurredAt:'2026-10-01T10:00:00.000Z'};
 return {...f,input,record(value:Partial<UsageEventInput>={}){return transaction(f.pool,client=>recordUsageEvent(client,{...input,...value}));}};
}

test('traffic bytes commit once and replay their original ledger receipt after reconnect',async()=>{
 const f=await fixture();try{
  const first=await f.record();
  assert.deepEqual(await transaction(f.peer,c=>recordUsageEvent(c,f.input)),first);
  assert.equal((await f.pool.query("SELECT sum(quantity)::text AS bytes FROM usage_events WHERE event_type='remote_access.traffic_bytes'")).rows[0].bytes,'35');
  for(const changed of [{quantity:36n},{venueId:f.venues[1]!},{occurredAt:'2026-10-01T10:00:01.000Z'}])await assert.rejects(f.record(changed),{code:'usage_conflict'});
  assert.equal((await f.pool.query('SELECT count(*) FROM usage_events')).rows[0].count,'1');
  for(const sql of ['UPDATE usage_events SET quantity=36','DELETE FROM usage_events'])await assert.rejects(f.pool.query(sql),{code:'55000'});
 }finally{await f.close();}
});

test('traffic ledger rejects zero overflow null venue foreign ownership and mismatched sources',async()=>{
 const f=await fixture();try{
  for(const change of [{quantity:0n},{quantity:-1n},{quantity:9223372036854775808n},{venueId:null},
   {sourceKind:'monitoring_probe' as const},{type:'operation.monitoring_probe' as const},{sourceKind:'backup_point' as const}])await assert.rejects(f.record(change),{code:'invalid_input'});
  await assert.rejects(f.record({venueId:f.foreignVenue}),{code:'usage_conflict'});
  assert.equal((await f.pool.query('SELECT count(*) FROM usage_events')).rows[0].count,'0');
  const max=await f.record({quantity:9223372036854775807n});assert.ok(max.id);
  assert.equal((await f.pool.query('SELECT quantity FROM usage_events')).rows[0].quantity,'9223372036854775807');
 }finally{await f.close();}
});

test('SQL traffic alternative keeps every old source and unit restriction',async()=>{
 const f=await fixture();try{
  const insert=async(type:string,source:string,quantity:string,venue:string|null=f.venues[0]!)=>f.pool.query(`INSERT INTO usage_events
   (organisation_id,venue_id,event_type,quantity,source_kind,source_reference,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING quantity`,
   [f.scope.organisationId,venue,type,quantity,source,randomUUID(),f.input.occurredAt]);
  assert.equal((await insert('remote_access.traffic_bytes','remote_traffic_sample','35')).rows[0].quantity,'35');
  for(const [type,source,quantity,venue] of [
   ['remote_access.traffic_bytes','remote_traffic_sample','0',f.venues[0]!],
   ['remote_access.traffic_bytes','remote_traffic_sample','1',null],
   ['remote_access.traffic_bytes','backup_point','35',f.venues[0]!],
   ['backup.upload_bytes','remote_traffic_sample','35',f.venues[0]!],
   ['operation.monitoring_probe','monitoring_probe','2',f.venues[0]!],
   ['message.service_alert_sent','service_alert','2',f.venues[0]!],
   ['operation.installation_completed','remote_traffic_sample','1',f.venues[0]!],
   ['translation.items_completed','remote_traffic_sample','35',f.venues[0]!],
  ] as const)await assert.rejects(insert(type,source,quantity,venue),{code:'23514'});
  for(const [type,source,quantity] of [
   ['backup.storage_added_bytes','backup_point','35'],['backup.storage_removed_bytes','backup_point','35'],['backup.upload_bytes','backup_point','35'],
   ['backup.restore_bytes','backup_recovery','35'],['operation.installation_completed','installation_operation','1'],['operation.monitoring_probe','monitoring_probe','1'],
   ['message.service_alert_sent','service_alert','1'],['message.service_alert_failed','service_alert','1'],['message.service_alert_expired','service_alert','1'],['message.service_alert_cancelled','service_alert','1'],
   ['translation.items_completed','translation_job','35'],['translation.input_tokens','translation_job','35'],['translation.output_tokens','translation_job','35'],['translation.cost_micro_usd','translation_job','35'],
  ])assert.equal((await insert(type!,source!,quantity!)).rows[0].quantity,quantity);
  assert.equal((await f.pool.query('SELECT count(*) FROM usage_events')).rows[0].count,'15');
 }finally{await f.close();}
});

test('traffic adds no v1 summary fields or reconciliation sources',async()=>{
 const f=await fixture();try{
  const account=randomUUID();await f.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[account]);
  await f.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner) VALUES($1,$2,true)',[account,f.scope.organisationId]);
  const session=await transaction(f.pool,client=>createSession(client,account));
  const store=new UsageStore(f.pool),reconciler=new UsageReconciler(f.pool);
  await f.record({type:'backup.upload_bytes',sourceKind:'backup_point',quantity:7n,sourceReference:randomUUID(),occurredAt:'2026-10-02T10:00:00.000Z'});
  const before=await store.summary(session.token,{organisationId:f.scope.organisationId});
  await f.record();assert.deepEqual(await store.summary(session.token,{organisationId:f.scope.organisationId}),before);
  assert.deepEqual((await reconciler.status()).sources.map(s=>s.source).sort(),['backup_points','backup_recoveries','installation_operations','service_alerts']);
  const pass=await reconciler.runOnce();assert.equal(pass.acquired,true);assert.equal(Object.keys(pass.sources).length,4);
  assert.equal((await f.pool.query("SELECT sum(quantity)::text AS bytes FROM usage_events WHERE event_type='remote_access.traffic_bytes'")).rows[0].bytes,'35');
 }finally{await f.close();}
});
