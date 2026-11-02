import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import type {PoolClient} from 'pg';
import {AllowanceConfigStore,recordUsageEvent,transaction,type BillingScope,type TrialView} from '../src/index.ts';
import {venueServiceFixture,event} from './fixtures/venue-service.ts';

type Result={complete:boolean;usage:{remoteTrafficDays:number;translationRuns:number;solverRuns:number}};
type Reader=(client:PoolClient,scope:BillingScope,venueId:string,trial:TrialView)=>Promise<Result>;
async function reader():Promise<Reader>{
 const module=await import(new URL('../src/billing-trial-usage.ts',import.meta.url).href).catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')assert.fail('readTrialUsage must read the stored trial and durable evidence');throw error;
 });
 assert.equal(typeof module.readTrialUsage,'function');return module.readTrialUsage;
}
const unused={remoteTrafficDays:0,translationRuns:0,solverRuns:0};

// The empty publication fixture isolates trial selection from already-qualified signed traffic ingestion.
async function fixture(){
 const readTrialUsage=await reader(),f=await venueServiceFixture();
 try{
  const venueId=f.venues[0]!,accountId=randomUUID(),cellId=randomUUID();
  await f.store.execute(f.scope,event(),{type:'start_trial',venueId,level:'connected',on:'2026-11-01'});
  const trial=(await f.store.history(f.scope,venueId)).trials[0]!;
  const installation=async(id:string)=>(await f.pool.query('SELECT id FROM installations WHERE venue_id=$1 AND revoked_at IS NULL',[id])).rows[0].id as string;
  await f.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[accountId]);
  await new AllowanceConfigStore(f.pool).publish({revision:1,effectiveFrom:'2020-01-01',limits:{
   registered:{transactional_email:'0',address_lookup:'0',sms:'0',content_translation:'0',rota_solver:'0'},
   connected:{transactional_email:'0',address_lookup:'0',sms:'0',content_translation:'10',rota_solver:'10'},
   hosted:{transactional_email:'0',address_lookup:'0',sms:'0',content_translation:'10',rota_solver:'10'},
  },unpaidTrial:{content_translation:'2',rota_solver:'1'}});
  await f.pool.query(`INSERT INTO remote_cells(id,country,provider,environment,suffix,subnet,public_key,endpoint)
   VALUES($1,'ES','aws','test','trial.example.test',24,$2,'gateway.example.test:51820')`,[cellId,randomUUID()]);
  await f.pool.query(`INSERT INTO remote_placements(venue_id,installation_id,cell_id,address,peer_public_key,port)
   VALUES($1,$2,$3,'10.77.24.2',$4,443)`,[venueId,await installation(venueId),cellId,randomUUID()]);
  async function coverage(){
   await f.pool.query(`INSERT INTO remote_traffic_coverage(cell_id,gateway_id,generation,manifest_digest,manifest_sequence,issued_at,expires_at,kind)
    SELECT $1,$2,1,r.digest,1,r.at::timestamptz,r.at::timestamptz+interval '10 minutes','empty'
    FROM jsonb_to_recordset($3::jsonb) AS r(digest text,at text)`,[cellId,randomUUID(),JSON.stringify(
     Array.from({length:4320},(_,n)=>{const at=new Date(Date.parse('2026-11-01T00:00:00Z')+n*600000).toISOString();return {at,digest:createHash('sha256').update(at).digest('hex')};}))]);
  }
  async function attempt(service='content_translation',at:string|null='2026-11-02T10:00:00.000Z',options:{venueId?:string;scope?:BillingScope;state?:string;month?:string}={}){
   const id=options.venueId??venueId,scope=options.scope??f.scope;
   await f.pool.query(`INSERT INTO billing_allowance_reservations
    (id,account_id,organisation_id,legal_business_id,venue_id,installation_id,service,operation_id,binding,units,month,revision,state,attempted_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'trial-fixture',$9,$10,1,$11,$12)`,
    [randomUUID(),accountId,scope.organisationId,scope.legalBusinessId,id,await installation(id),service,randomUUID(),service==='transactional_email'?1:7,options.month??(at?at.slice(0,7)+'-01':'2026-11-01'),options.state??'spent',at]);
  }
  async function traffic(at:string,id=venueId,org=f.scope.organisationId){
   await transaction(f.pool,c=>recordUsageEvent(c,{organisationId:org,venueId:id,type:'remote_access.traffic_bytes',quantity:35n,
    sourceKind:'remote_traffic_sample',sourceReference:randomUUID(),occurredAt:at}));
  }
  return {...f,venueId,trial,readTrialUsage,coverage,attempt,traffic,
   read:(value=trial,scope=f.scope,id=venueId)=>transaction(f.pool,c=>readTrialUsage(c,scope,id,value))};
 }catch(error){await f.close();throw error;}
}

test('trial usage requires complete traffic evidence before zero use is known',async()=>{
 const f=await fixture();try{
  assert.deepEqual(await f.read(),{complete:false,usage:unused});
  await f.coverage();assert.deepEqual(await f.read(),{complete:true,usage:unused});
  await transaction(f.pool,c=>recordUsageEvent(c,{organisationId:f.scope.organisationId,venueId:f.venueId,type:'operation.monitoring_probe',quantity:1n,
   sourceKind:'monitoring_probe',sourceReference:randomUUID(),occurredAt:'2026-11-03T10:00:00.000Z'}));
  assert.deepEqual(await f.read(),{complete:true,usage:unused});
 }finally{await f.close();}
});

test('trial usage counts distinct traffic dates inside the exact stored trial',async()=>{
 const f=await fixture();try{
  await f.coverage();
  for(const at of ['2026-10-31T23:59:59.999Z','2026-11-01T00:00:00.000Z','2026-11-01T10:00:00.000Z','2026-11-02T10:00:00.000Z','2026-12-01T00:00:00.000Z'])await f.traffic(at);
  await f.traffic('2026-11-03T10:00:00.000Z',f.venues[1]!);
  await f.traffic('2026-11-03T10:00:00.000Z',f.otherVenue);
  await f.traffic('2026-11-03T10:00:00.000Z',f.foreignVenue,f.foreign.organisationId);
  assert.deepEqual(await f.read(),{complete:true,usage:{...unused,remoteTrafficDays:2}});
  await f.traffic('2026-11-03T10:00:00.000Z');
  assert.deepEqual(await f.read(),{complete:true,usage:{...unused,remoteTrafficDays:3}});
 }finally{await f.close();}
});

test('trial usage refuses caller dates state level extension and foreign scope instead of selecting another trial',async()=>{
 const f=await fixture();try{
  for(const value of [{...f.trial,startedOn:'2026-10-01'},{...f.trial,endsOn:'2026-11-30'},
   {...f.trial,state:'converted' as const},{...f.trial,extended:true},{...f.trial,level:'hosted' as const}])
   await assert.rejects(f.read(value),{code:'billing_state_conflict'});
  for(const [scope,id]of [[f.other,f.venueId],[f.foreign,f.venueId],[{...f.scope,organisationId:f.foreign.organisationId},f.venueId],
   [f.scope,f.otherVenue],[f.scope,f.foreignVenue],[f.scope,randomUUID()]] as const)
   await assert.rejects(f.read(f.trial,scope,id),{code:'billing_scope_not_found'});
  await assert.rejects(f.read(f.trial,f.scope,f.production),/traffic_authority_unavailable/);
 }finally{await f.close();}
});

test('trial usage counts confirmed invocation instants rather than units month or completion time',async()=>{
 const f=await fixture();try{
  await f.coverage();
  for(const service of ['content_translation','rota_solver'])
   for(const at of ['2026-10-31T23:59:59.999Z','2026-11-01T00:00:00.000Z','2026-11-30T23:59:59.999Z','2026-12-01T00:00:00.000Z'])await f.attempt(service,at);
  await f.attempt('transactional_email','2026-11-02T10:00:00.000Z');
  for(const [scope,venueId]of [[f.scope,f.venues[1]!],[f.other,f.otherVenue],[f.foreign,f.foreignVenue]] as const)
   await f.attempt('content_translation','2026-11-02T10:00:00.000Z',{scope,venueId});
  assert.deepEqual(await f.read(),{complete:true,usage:{...unused,translationRuns:2,solverRuns:2}});
  await f.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE venue_id=$1',[f.venueId]);
  assert.deepEqual(await f.read(),{complete:true,usage:{...unused,translationRuns:2,solverRuns:2}},'retirement cannot erase historical confirmed calls');
 }finally{await f.close();}
});

test('spent unconfirmed service admission stays incomplete and is never a confirmed trial run',async()=>{
 const f=await fixture();try{
  await f.coverage();
  for(const state of ['held','released'])await f.attempt('content_translation',null,{state,month:'2026-11-01'});
  await f.attempt('content_translation',null,{month:'2026-12-01'});
  await f.attempt('content_translation',null,{month:'2026-11-01',venueId:f.venues[1]!});
  await f.attempt('transactional_email',null,{month:'2026-11-01'});
  assert.deepEqual(await f.read(),{complete:true,usage:unused});
  await f.attempt('content_translation',null,{month:'2026-11-01'});
  assert.deepEqual(await f.read(),{complete:false,usage:unused});
  await f.attempt('content_translation','2026-11-02T10:00:00.000Z');
  assert.deepEqual(await f.read(),{complete:false,usage:{...unused,translationRuns:1}},'a later callback cannot resolve an earlier uncertain operation');
 }finally{await f.close();}
});

test('an older spent reservation without a call instant cannot prove a later trial unused',async()=>{
 const f=await fixture();try{
  await f.coverage();
  await f.attempt('content_translation',null,{month:'2026-10-01'});
  assert.deepEqual(await f.read(),{complete:false,usage:unused},'a job admitted before the trial may first invoke its provider during the trial');
 }finally{await f.close();}
});

test('trial invocation boundaries stay UTC when the database session uses another timezone',async()=>{
 const f=await fixture();try{
  await f.coverage();
  await f.attempt('content_translation','2026-10-31T23:30:00.000Z');
  await f.attempt('rota_solver','2026-11-30T23:30:00.000Z');
  assert.deepEqual(await transaction(f.pool,async client=>{
   await client.query("SET LOCAL TIME ZONE 'Europe/Madrid'");
   return f.readTrialUsage(client,f.scope,f.venueId,f.trial);
  }),{complete:true,usage:{...unused,solverRuns:1}});
 }finally{await f.close();}
});

test('trial usage snapshot cannot combine an old trial with newly committed traffic or calls',async()=>{
 const f=await fixture();try{
  await f.coverage();
  const client=await f.pool.connect(),query=client.query.bind(client);
  let intercepted=false;
  // Keep real PostgreSQL results, inserting a competing commit at the reader boundary.
  client.query=(async(...args:any[])=>{
   const result=await (query as any)(...args);
   if(!intercepted&&typeof args[0]==='string'&&/FROM billing_trials/.test(args[0])){
    intercepted=true;await f.traffic('2026-11-03T10:00:00.000Z');await f.attempt();
    await f.store.execute(f.scope,event(),{type:'extend_trial',venueId:f.venueId,level:'connected',expectedEnd:f.trial.endsOn});
   }
   return result;
  }) as typeof client.query;
  try{
   await query('BEGIN');
   assert.deepEqual(await f.readTrialUsage(client,f.scope,f.venueId,f.trial),{complete:true,usage:unused});
   assert.equal(intercepted,true);await query('COMMIT');
  }finally{client.query=query;await query('ROLLBACK');client.release();}
  await assert.rejects(f.read(),{code:'billing_state_conflict'});
 }finally{await f.close();}
});

test('trial usage requires a transaction that can establish one repeatable database snapshot',async()=>{
 const f=await fixture();try{
  const client=await f.pool.connect();
  try{
   await assert.rejects(f.readTrialUsage(client,f.scope,f.venueId,f.trial),{code:'invalid_billing_input'});
   await client.query('BEGIN');await client.query('SELECT 1');
   await assert.rejects(f.readTrialUsage(client,f.scope,f.venueId,f.trial),{code:'25001'});
  }finally{await client.query('ROLLBACK');client.release();}
 }finally{await f.close();}
});
