import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {migrate} from '../src/migrate.ts';
import type {BillingScope,BillingEvent} from '../src/billing-types.ts';

// Catch ownership/revision omissions, shared trial eligibility, unpaid coverage and multiplied projections.
const event=():BillingEvent=>({key:randomUUID(),occurredAt:'2026-10-12T09:00:00.000Z',source:{kind:'internal'}});
const state={level:'connected',connectedFrom:'2026-10-01',lapsedOn:null,scheduledLevel:null,scheduledOn:null};
async function fixture(){
 const schema='billing_venues_'+randomUUID().replaceAll('-','');
 const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);
  const scope={organisationId:randomUUID(),legalBusinessId:randomUUID()};
  const other={organisationId:scope.organisationId,legalBusinessId:randomUUID()};
  const foreign={organisationId:randomUUID(),legalBusinessId:randomUUID()};
  await pool.query('INSERT INTO organisations(id) VALUES($1),($2)',[scope.organisationId,foreign.organisationId]);
  for(const s of [scope,other,foreign])await pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[s.legalBusinessId,s.organisationId]);
  const venues=[randomUUID(),randomUUID()].sort(),otherVenue=randomUUID(),foreignVenue=randomUUID();
  for(const [s,id] of [[scope,venues[0]],[scope,venues[1]],[other,otherVenue],[foreign,foreignVenue]] as const)
   await pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$1,'test')",[id,s.organisationId,s.legalBusinessId]);
  const api=await import(new URL('../src/index.ts',import.meta.url).href);
  const store=new api.BillingStore(pool);
  for(const s of [scope,other,foreign])await store.execute(s,event(),{type:'ensure_business'});
  return {schema,admin,pool,scope,other,foreign,venues,otherVenue,foreignVenue,store,
   async close(){await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}};
 }catch(e){await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();throw e;}
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function snapshot(f:Fixture,billingOnly=true){
 const tables=(await f.pool.query("SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename",[f.schema])).rows;
 const result:Record<string,unknown>={};
 for(const {tablename} of tables){
  if(billingOnly&&!tablename.startsWith('billing_'))continue;
  if(!billingOnly&&tablename.startsWith('billing_'))continue;
  result[tablename]=(await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${tablename} t ORDER BY to_jsonb(t)::text`)).rows;
 }
 return result;
}
async function seedVenue(f:Fixture,venueId:string,scope:BillingScope=f.scope){
 await f.pool.query('INSERT INTO billing_venues(organisation_id,legal_business_id,venue_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[scope.organisationId,scope.legalBusinessId,venueId]);
}
async function payment(f:Fixture,venueId:string,options:{scope?:BillingScope;level?:'connected'|'hosted';state?:'pending'|'failed'|'succeeded'|'refunded';period?:boolean;line?:boolean;date?:string}={}){
 const s=options.scope??f.scope,level=options.level??'connected',status=options.state??'succeeded';
 const args=[s.organisationId,s.legalBusinessId],e=randomUUID(),method=randomUUID(),charge=randomUUID(),attempt=randomUUID();
 await seedVenue(f,venueId,s);
 await f.pool.query("INSERT INTO billing_prices VALUES(1,'2026-10-01','EUR',1000,3000,2100) ON CONFLICT DO NOTHING");
 await f.pool.query("INSERT INTO billing_events(id,organisation_id,legal_business_id,source,event_key,occurred_at,command,result) VALUES($1,$2,$3,'internal',$1::text,'2026-10-01T00:00:00Z','{}','{}')",[e,...args]);
 await f.pool.query("INSERT INTO billing_payment_methods(organisation_id,legal_business_id,id,kind,provider,provider_account_id,customer_id,method_id,event_id) VALUES($1,$2,$3,'card','sumup','account','customer',$3::text,$4)",[...args,method,e]);
 await f.pool.query(`INSERT INTO billing_charges(organisation_id,legal_business_id,id,kind,renewal_date,connected_until,hosted_from,hosted_through,price_revision,price_effective_from,currency,connected_monthly_cents,hosted_monthly_cents,vat_rate_basis_points,net_cents,vat_cents,gross_cents,event_id)
  VALUES($1,$2,$3,'renewal',$5,'2026-12-01','2026-09-01','2026-09-30',1,'2026-10-01','EUR',1000,3000,2100,1000,210,1210,$4)`,[...args,charge,e,options.date??'2026-10-01']);
 if(options.line!==false)await f.pool.query('INSERT INTO billing_charge_lines(organisation_id,legal_business_id,charge_id,venue_id,kind,quantity,cents) VALUES($1,$2,$3,$4,$5,1,1000)',[...args,charge,venueId,level==='connected'?'connected_month':'hosted_days']);
 await f.pool.query(`INSERT INTO billing_payment_attempts(organisation_id,legal_business_id,id,charge_id,method_id,provider,provider_account_id,request_key,state,succeeded_at,event_id)
  VALUES($1,$2,$3,$4,$5,'sumup','account',$3::text,$6,$7,$8)`,[...args,attempt,charge,method,status,['succeeded','refunded'].includes(status)?'2026-10-01T00:00:00Z':null,e]);
 if(options.period!==false&&options.line!==false)await f.pool.query('INSERT INTO billing_paid_periods(organisation_id,legal_business_id,venue_id,level,charge_id,attempt_id,from_date,until_date) VALUES($1,$2,$3,$4,$5,$6,\'2026-10-01\',\'2026-11-01\')',[...args,venueId,level,charge,attempt]);
 return {charge,attempt,event:e};
}
async function noEffect(f:Fixture,operation:()=>Promise<unknown>,code:string){
 const before=await snapshot(f);await assert.rejects(operation(),{code});assert.deepEqual(await snapshot(f),before);
}

test('venue billing defaults only for a known owned venue',async()=>{
 const f=await fixture();try{
  const id=f.venues[0]!;assert.equal(typeof f.store.venue,'function','owned venues need billing projections');
  const untouched=await snapshot(f,false);
  const defaults={...f.scope,venueId:id,revision:0,level:'registered',connectedFrom:null,lapsedOn:null,scheduledLevel:null,scheduledOn:null};
  assert.deepEqual(await f.store.venue(f.scope,id),defaults);
  assert.equal((await f.pool.query('SELECT count(*) FROM billing_venues')).rows[0].count,'0');
  const command={type:'set_venue',venueId:id,expectedRevision:0,value:state},ev=event();
  const first=await f.store.execute(f.scope,ev,command);
  assert.deepEqual(first.value,{...defaults,...state,revision:1});
  await noEffect(f,()=>f.store.execute(f.scope,event(),command),'billing_state_conflict');
  const next={...state,level:'hosted',lapsedOn:'2026-10-11',scheduledLevel:'connected',scheduledOn:'2026-11-01'};
  assert.deepEqual((await f.store.execute(f.scope,event(),{...command,expectedRevision:1,value:next})).value,{...defaults,...next,revision:2});
  assert.deepEqual(await f.store.execute(f.scope,ev,command),first,'a retry returns its frozen earlier venue state');
  assert.deepEqual(await snapshot(f,false),untouched,'storing billing facts cannot activate services or change fiscal records');
 }finally{await f.close();}
});

test('venue reads and every venue command refuse foreign and unknown identities without effects',async()=>{
 const f=await fixture();try{
  assert.equal(typeof f.store.venue,'function');assert.equal(typeof f.store.history,'function');assert.equal(typeof f.store.renewalViews,'function');
  for(const id of [f.otherVenue,f.foreignVenue,randomUUID()]){
   await noEffect(f,()=>f.store.venue(f.scope,id),'billing_scope_not_found');
   await noEffect(f,()=>f.store.history(f.scope,id),'billing_scope_not_found');
   for(const command of [
    {type:'set_venue',venueId:id,expectedRevision:0,value:state},
    {type:'start_trial',venueId:id,level:'connected',on:'2026-10-01'},
    {type:'extend_trial',venueId:id,level:'connected',expectedEnd:'2026-10-31'},
    {type:'end_trial',venueId:id,level:'connected',expectedEnd:'2026-10-31',outcome:'lapsed'},
    {type:'hosted_day',venueId:id,on:'2026-10-01',coveredByChargeId:null},
   ])await noEffect(f,()=>f.store.execute(f.scope,event(),command),'billing_scope_not_found');
  }
  for(const scope of [{...f.scope,organisationId:f.foreign.organisationId},{...f.scope,legalBusinessId:randomUUID()}]){
   await noEffect(f,()=>f.store.venue(scope,f.venues[0]),'billing_scope_not_found');
   await noEffect(f,()=>f.store.history(scope,f.venues[0]),'billing_scope_not_found');
   await noEffect(f,()=>f.store.renewalViews(scope,{from:'2026-10-01',through:'2026-10-31'}),'billing_scope_not_found');
  }
 }finally{await f.close();}
});

test('trials are once per level independently and never paid history',async()=>{
 const f=await fixture();try{
  for(const [i,levels] of [['0',['connected','hosted']],['1',['hosted','connected']]] as const){
   const venueId=f.venues[Number(i)]!;
   for(const level of levels){
    const command={type:'start_trial',venueId,level,on:'2026-10-01'},e=event();
    const started=await f.store.execute(f.scope,e,command);
    assert.deepEqual(started.value,{level,startedOn:'2026-10-01',endsOn:'2026-10-31',extended:false,state:'active'});
    await noEffect(f,()=>f.store.execute(f.scope,event(),command),'billing_trial_unavailable');
    assert.deepEqual(await f.store.execute(f.scope,e,command),started);
   }
   assert.deepEqual(await f.store.history(f.scope,venueId),{trials:[
    {level:'connected',startedOn:'2026-10-01',endsOn:'2026-10-31',extended:false,state:'active'},
    {level:'hosted',startedOn:'2026-10-01',endsOn:'2026-10-31',extended:false,state:'active'},
   ],paid:[]});
   assert.equal((await f.store.venue(f.scope,venueId)).level,'registered');
  }
  assert.equal((await f.store.business(f.scope)).anchorDay,null);assert.equal((await f.store.business(f.scope)).paymentMethod,null);
  assert.equal((await f.pool.query('SELECT count(*) FROM billing_charges')).rows[0].count,'0');
 }finally{await f.close();}
});

test('only an active connected trial extends once by thirty days',async()=>{
 const f=await fixture();try{
  const venueId=f.venues[0]!,second=f.venues[1]!;
  for(const id of [venueId,second])for(const level of ['connected','hosted'])await f.store.execute(f.scope,event(),{type:'start_trial',venueId:id,level,on:'2026-10-01'});
  const extend={type:'extend_trial',venueId,level:'connected',expectedEnd:'2026-10-31'};
  await noEffect(f,()=>f.store.execute(f.scope,event(),{...extend,expectedEnd:'2026-10-30'}),'billing_state_conflict');
  const e=event(),extended=await f.store.execute(f.scope,e,extend);
  assert.deepEqual(extended.value,{level:'connected',startedOn:'2026-10-01',endsOn:'2026-11-30',extended:true,state:'active'});
  await noEffect(f,()=>f.store.execute(f.scope,event(),{...extend,expectedEnd:'2026-11-30'}),'billing_trial_unavailable');
  await noEffect(f,()=>f.store.execute(f.scope,event(),{...extend,level:'hosted'}),'invalid_billing_input');
  for(const [id,outcome] of [[venueId,'converted'],[second,'lapsed']] as const){
   const expectedEnd=id===venueId?'2026-11-30':'2026-10-31';
   const done=await f.store.execute(f.scope,event(),{type:'end_trial',venueId:id,level:'connected',expectedEnd,outcome});
   assert.deepEqual(done.value,{level:'connected',startedOn:'2026-10-01',endsOn:expectedEnd,extended:id===venueId,state:outcome});
   await noEffect(f,()=>f.store.execute(f.scope,event(),{...extend,venueId:id,expectedEnd}),'billing_trial_unavailable');
   await noEffect(f,()=>f.store.execute(f.scope,event(),{type:'end_trial',venueId:id,level:'connected',expectedEnd,outcome:'lapsed'}),'billing_trial_unavailable');
   assert.deepEqual((await f.store.history(f.scope,id)).paid,[]);
  }
  assert.deepEqual(await f.store.execute(f.scope,e,extend),extended);
 }finally{await f.close();}
});

test('only actual paid history of the same level prevents a first trial',async()=>{
 const f=await fixture();try{
  const venueId=f.venues[0]!,second=f.venues[1]!;
  const paid=await payment(f,venueId);await payment(f,second,{state:'failed',date:'2026-10-02'});
  await noEffect(f,()=>f.store.execute(f.scope,event(),{type:'start_trial',venueId,level:'connected',on:'2026-11-01'}),'billing_trial_unavailable');
  assert.equal((await f.store.execute(f.scope,event(),{type:'start_trial',venueId,level:'hosted',on:'2026-11-01'})).value.level,'hosted');
  assert.equal((await f.store.execute(f.scope,event(),{type:'start_trial',venueId:second,level:'connected',on:'2026-11-01'})).value.level,'connected');
  assert.deepEqual((await f.store.history(f.scope,venueId)).paid,[{level:'connected',chargeId:paid.charge,attemptId:paid.attempt,from:'2026-10-01',until:'2026-11-01'}]);
  assert.deepEqual((await f.store.history(f.scope,second)).paid,[]);
  await f.pool.query("UPDATE billing_payment_attempts SET state='refunded' WHERE id=$1",[paid.attempt]);
  await noEffect(f,()=>f.store.execute(f.scope,event(),{type:'start_trial',venueId,level:'connected',on:'2026-11-01'}),'billing_trial_unavailable');
 }finally{await f.close();}
});

test('hosted days are unique and coverage advances only before consumption',async()=>{
 const f=await fixture();try{
  const venueId=f.venues[0]!,good=await payment(f,venueId);
  const other=await payment(f,f.venues[1]!,{date:'2026-10-02'});
  const abroad=await payment(f,f.otherVenue,{scope:f.other});
  const pending=await payment(f,venueId,{state:'pending',date:'2026-10-03'});
  const failed=await payment(f,venueId,{state:'failed',date:'2026-10-04'});
  const noPeriod=await payment(f,venueId,{period:false,date:'2026-10-05'});
  const noLine=await payment(f,venueId,{line:false,date:'2026-10-06'});
  const hosted=await payment(f,venueId,{level:'hosted',date:'2026-10-07'});
  const replacement=await payment(f,venueId,{date:'2026-10-08'});
  const command={type:'hosted_day',venueId,on:'2026-10-12',coveredByChargeId:null},e=event();
  const initial=await f.store.execute(f.scope,e,command);
  assert.deepEqual(initial.value,{venueId,on:'2026-10-12',coveredByChargeId:null});
  assert.deepEqual((await f.store.execute(f.scope,event(),command)).value,initial.value);
  for(const charge of [other.charge,abroad.charge,pending.charge,failed.charge,noPeriod.charge,noLine.charge,hosted.charge,randomUUID()])
   await noEffect(f,()=>f.store.execute(f.scope,event(),{...command,coveredByChargeId:charge}),'billing_charge_conflict');
  for(const on of ['2026-09-30','2026-11-01'])
   await noEffect(f,()=>f.store.execute(f.scope,event(),{...command,on,coveredByChargeId:good.charge}),'billing_charge_conflict');
  const covered={...command,coveredByChargeId:good.charge};
  assert.deepEqual((await f.store.execute(f.scope,event(),covered)).value,{venueId,on:'2026-10-12',coveredByChargeId:good.charge});
  assert.deepEqual((await f.store.execute(f.scope,event(),covered)).value,{venueId,on:'2026-10-12',coveredByChargeId:good.charge});
  for(const coveredByChargeId of [null,replacement.charge])await noEffect(f,()=>f.store.execute(f.scope,event(),{...command,coveredByChargeId}),'billing_charge_conflict');
  assert.deepEqual(await f.store.execute(f.scope,e,command),initial,'old receipt survives late coverage');
  await f.store.execute(f.scope,event(),{...covered,on:'2026-10-01'});
  await f.store.execute(f.scope,event(),{...covered,on:'2026-10-31'});
  await f.store.execute(f.scope,event(),{...command,on:'2026-10-13'});
  await f.pool.query('UPDATE billing_hosted_days SET consumed_by_charge_id=$1 WHERE venue_id=$2 AND on_date IN (\'2026-10-12\',\'2026-10-13\')',[replacement.charge,venueId]);
  await noEffect(f,()=>f.store.execute(f.scope,event(),{...covered,on:'2026-10-13'}),'billing_charge_conflict');
  await f.pool.query("UPDATE billing_payment_attempts SET state='refunded' WHERE id=$1",[good.attempt]);
  assert.deepEqual((await f.store.execute(f.scope,event(),covered)).value,{venueId,on:'2026-10-12',coveredByChargeId:good.charge});
  assert.deepEqual(await f.store.renewalViews(f.scope,{from:'2026-10-12',through:'2026-10-13'}),f.venues.map(venueId=>({venueId,connectedFrom:null,hostedDays:0,hostedDaysCoveredByConnected:0})));
  assert.equal((await f.pool.query('SELECT count(*) FROM billing_hosted_days WHERE venue_id=$1',[venueId])).rows[0].count,'4');
 }finally{await f.close();}
});

test('renewal views contain each venue once without joined row multiplication',async()=>{
 const f=await fixture();try{
  const [a,b]=f.venues as [string,string],paid=await payment(f,a);
  await f.store.execute(f.scope,event(),{type:'set_venue',venueId:a,expectedRevision:0,value:state});
  for(const level of ['connected','hosted'])await f.store.execute(f.scope,event(),{type:'start_trial',venueId:b,level,on:'2026-10-01'});
  for(let i=0;i<3;i++){
   const e=event();await f.store.execute(f.scope,e,{type:'ensure_business'});
   await f.pool.query("INSERT INTO billing_payment_observations(organisation_id,legal_business_id,attempt_id,event_id,state,occurred_at) VALUES($1,$2,$3,$4,'succeeded','2026-10-01T00:00:00Z')",[f.scope.organisationId,f.scope.legalBusinessId,paid.attempt,(await f.pool.query('SELECT id FROM billing_events WHERE event_key=$1',[e.key])).rows[0].id]);
  }
  for(const [venueId,on,coverage] of [[a,'2026-10-01',paid.charge],[a,'2026-10-02',null],[a,'2026-10-03',paid.charge],[b,'2026-10-01',null],[b,'2026-10-03',null],[a,'2026-09-30',null],[a,'2026-10-04',null],[b,'2026-10-02',null]] as const){
   await f.store.execute(f.scope,event(),{type:'hosted_day',venueId,on,coveredByChargeId:coverage});
  }
  await f.pool.query("UPDATE billing_hosted_days SET consumed_by_charge_id=$1 WHERE venue_id=$2 AND on_date='2026-10-02'",[paid.charge,b]);
  assert.deepEqual(await f.store.renewalViews(f.scope,{from:'2026-10-01',through:'2026-10-03'}),[
   {venueId:a,connectedFrom:'2026-10-01',hostedDays:3,hostedDaysCoveredByConnected:2},
   {venueId:b,connectedFrom:null,hostedDays:2,hostedDaysCoveredByConnected:0},
  ]);
  assert.deepEqual(await f.store.renewalViews(f.other,{from:'2026-10-01',through:'2026-10-03'}),[{venueId:f.otherVenue,connectedFrom:null,hostedDays:0,hostedDaysCoveredByConnected:0}]);
 }finally{await f.close();}
});

test('venue billing validates fixed shapes dates revisions and windows before effects',async()=>{
 const f=await fixture();try{
  assert.equal(typeof f.store.renewalViews,'function');
  const venueId=f.venues[0]!,set={type:'set_venue',venueId,expectedRevision:0,value:state};
  for(const command of [
   {...set,venueId:'bad'}, {...set,expectedRevision:-1}, {...set,expectedRevision:0.5},
   {...set,value:{...state,level:'unknown'}}, {...set,value:{...state,connectedFrom:'2026-02-30'}},
   {...set,value:{...state,lapsedOn:'2026-02-30'}}, {...set,value:{...state,scheduledLevel:'hosted',scheduledOn:'2026-11-01'}},
   {...set,value:{...state,scheduledOn:'2026-11-01'}}, {...set,value:{...state,scheduledLevel:'connected'}},
   {...set,value:{...state,scheduledLevel:'connected',scheduledOn:'2026-02-30'}},
   {...set,value:{...state,cardNumber:'synthetic-forbidden'}}, {...set,metadata:'synthetic-forbidden'},
   {type:'start_trial',venueId,level:'registered',on:'2026-10-01'},
   {type:'start_trial',venueId,level:'hosted',on:'2026-02-30'},
   {type:'end_trial',venueId,level:'connected',expectedEnd:'2026-10-31',outcome:'extend'},
   {type:'extend_trial',venueId,level:'connected',expectedEnd:'2026-02-30'},
   {type:'hosted_day',venueId,on:'2026-02-30',coveredByChargeId:null},
   {type:'hosted_day',venueId,on:'2026-10-01',coveredByChargeId:'bad'},
  ])await noEffect(f,()=>f.store.execute(f.scope,event(),command),'invalid_billing_input');
  for(const window of [{from:'2026-10-02',through:'2026-10-01'},{from:'2026-02-30',through:'2026-10-31'},{from:'2026-10-01',through:'2026-10-31',extra:true}])
   await noEffect(f,()=>f.store.renewalViews(f.scope,window),'invalid_billing_input');
  assert.deepEqual(await f.store.venue(f.scope,venueId),{...f.scope,venueId,revision:0,level:'registered',connectedFrom:null,lapsedOn:null,scheduledLevel:null,scheduledOn:null});
 }finally{await f.close();}
});
