import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {migrate} from '../src/migrate.ts';
import type {BillingEvent,BillingScope,ProviderMethod} from '../src/billing-types.ts';

// Catch recomputed bills, reused days, cross-business bindings and reversed accepted payments.
const event=(key=randomUUID(),occurredAt='2026-10-12T09:00:00.000Z'):BillingEvent=>({key,occurredAt,source:{kind:'internal'}});
const method=():ProviderMethod=>({id:randomUUID(),kind:'card',provider:'sumup',providerAccountId:'test-account',customerId:'test-customer',methodId:randomUUID(),mandateId:null});
const price={revision:1,effectiveFrom:'2026-09-01',currency:'EUR',prices:{connectedMonthlyCents:1000,hostedMonthlyCents:3000},vatRateBasisPoints:2100};
const window={from:'2026-10-01',through:'2026-10-31'};
const freeze=(chargeId=randomUUID())=>({type:'freeze_charge',chargeId,kind:'renewal',renewalDate:'2026-11-01',connectedUntil:'2026-12-01',window,priceRevision:1});
async function fixture(){
 const schema='billing_payments_'+randomUUID().replaceAll('-','');
 const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
 const options={connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`};
 const pool=new Pool(options),second=new Pool(options);
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);
  const scope={organisationId:randomUUID(),legalBusinessId:randomUUID()};
  const other={organisationId:scope.organisationId,legalBusinessId:randomUUID()};
  const foreign={organisationId:randomUUID(),legalBusinessId:randomUUID()};
  await pool.query('INSERT INTO organisations(id) VALUES($1),($2)',[scope.organisationId,foreign.organisationId]);
  const api=await import(new URL('../src/index.ts',import.meta.url).href);
  const store=new api.BillingStore(pool),otherStore=new api.BillingStore(second),prices=new api.BillingPriceStore(pool);
  const venues=[randomUUID(),randomUUID()].sort(),otherVenue=randomUUID(),foreignVenue=randomUUID();
  for(const s of [scope,other,foreign]){
   await pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[s.legalBusinessId,s.organisationId]);
   await store.execute(s,event(),{type:'ensure_business'});
  }
  for(const [s,id] of [[scope,venues[0]],[scope,venues[1]],[other,otherVenue],[foreign,foreignVenue]] as const){
   await pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$1,'test')",[id,s.organisationId,s.legalBusinessId]);
   await store.execute(s,event(),{type:'set_venue',venueId:id,expectedRevision:0,value:{level:'connected',connectedFrom:'2026-10-01',lapsedOn:null,scheduledLevel:null,scheduledOn:null}});
  }
  await prices.publish(price);
  return {schema,admin,pool,second,store,otherStore,prices,scope,other,foreign,venues,otherVenue,foreignVenue,
   async close(){await Promise.all([pool.end(),second.end()]);await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}};
 }catch(e){await Promise.all([pool.end(),second.end()]);await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();throw e;}
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function snapshot(f:Fixture,billing=true){
 const result:Record<string,unknown>={};
 for(const {tablename} of (await f.pool.query('SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename',[f.schema])).rows){
  if(tablename.startsWith('billing_')!==billing)continue;
  result[tablename]=(await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${tablename} t ORDER BY to_jsonb(t)::text`)).rows;
 }
 return result;
}
async function noEffect(f:Fixture,operation:()=>Promise<unknown>,code:string){
 const before=await snapshot(f);await assert.rejects(operation(),{code});assert.deepEqual(await snapshot(f),before);
}
async function day(f:Fixture,on:string,coveredByChargeId:string|null=null,venueId=f.venues[0]){
 return f.store.execute(f.scope,event(),{type:'hosted_day',venueId,on,coveredByChargeId});
}
async function charge(f:Fixture,command:unknown=freeze(),scope:BillingScope=f.scope){return (await f.store.execute(scope,event(),command)).value;}
async function attempt(f:Fixture,chargeId:string,saved=method(),scope:BillingScope=f.scope){
 await f.store.execute(scope,event(),{type:'set_method',method:saved});
 const command={type:'begin_attempt',chargeId,attemptId:randomUUID(),methodId:saved.id,requestKey:randomUUID()};
 return {command,method:saved,value:(await f.store.execute(scope,event(),command)).value};
}
async function observe(f:Fixture,attemptId:string,state:string,expectedRevision:number|null,providerPaymentId='test-payment',ev=event(),scope:BillingScope=f.scope){
 return f.store.execute(scope,ev,{type:'observe_payment',attemptId,providerPaymentId,state,expectedRevision});
}
// SQL setup isolates observation and database guards from the still-missing charge handler.
async function seeded(f:Fixture,scope:BillingScope=f.scope,venueId=f.venues[0]!){
 const saved=method(),e=randomUUID(),id=randomUUID(),attemptId=randomUUID();
 await f.store.execute(scope,event(),{type:'set_method',method:saved});
 await f.pool.query("INSERT INTO billing_events(id,organisation_id,legal_business_id,source,event_key,occurred_at,command,result) VALUES($1,$2,$3,'internal',$4,'2026-10-01T00:00:00Z','{}','{}')",[e,scope.organisationId,scope.legalBusinessId,e]);
 await f.pool.query(`INSERT INTO billing_charges(organisation_id,legal_business_id,id,kind,renewal_date,connected_until,hosted_from,hosted_through,price_revision,price_effective_from,currency,connected_monthly_cents,hosted_monthly_cents,vat_rate_basis_points,net_cents,vat_cents,gross_cents,event_id)
  VALUES($1,$2,$3,'renewal','2026-11-01','2026-12-01','2026-10-01','2026-10-31',1,'2026-09-01','EUR',1000,3000,2100,1000,210,1210,$4)`,[scope.organisationId,scope.legalBusinessId,id,e]);
 await f.pool.query("INSERT INTO billing_charge_lines(organisation_id,legal_business_id,charge_id,venue_id,kind,quantity,cents) VALUES($1,$2,$3,$4,'connected_month',1,1000)",[scope.organisationId,scope.legalBusinessId,id,venueId]);
 const requestKey=randomUUID();
 await f.pool.query("INSERT INTO billing_payment_attempts(organisation_id,legal_business_id,id,charge_id,method_id,provider,provider_account_id,request_key,event_id) VALUES($1,$2,$3,$4,$5,'sumup','test-account',$6,$7)",[scope.organisationId,scope.legalBusinessId,attemptId,id,saved.id,requestKey,e]);
 return {id,attemptId,method:saved,requestKey};
}

test('one renewal freezes unique ordered lines prices and VAT',async()=>{
 const f=await fixture();try{
  assert.equal(typeof f.store.charge,'function','frozen charges need a scoped read');
  const untouched=await snapshot(f,false);
  const cover=await charge(f,{...freeze(),renewalDate:'2026-10-01',connectedUntil:'2026-11-01',window:{from:'2026-09-01',through:'2026-09-30'}});
  const paid=await attempt(f,cover.id);await observe(f,paid.command.attemptId,'succeeded',0);
  for(let n=1;n<=7;n++)await day(f,`2026-10-0${n}`,cover.id);
  const command=freeze(),ev=event(),receipt=await f.store.execute(f.scope,ev,command);
  const expected={...f.scope,id:command.chargeId,kind:'renewal',renewalDate:'2026-11-01',connectedUntil:'2026-12-01',window,price,lines:[
   {venueId:f.venues[0],kind:'connected_month',quantity:1,cents:1000},
   {venueId:f.venues[0],kind:'hosted_days',quantity:7,cents:467},
   {venueId:f.venues[1],kind:'connected_month',quantity:1,cents:1000},
  ],totals:{netCents:2467,vatCents:518,grossCents:2985}};
  assert.deepEqual(receipt.value,expected);assert.deepEqual(await f.otherStore.charge(f.scope,command.chargeId),expected);
  assert.equal((await f.pool.query('SELECT count(*) FROM billing_charge_lines WHERE charge_id=$1',[command.chargeId])).rows[0].count,'3');
  await f.prices.publish({...price,revision:2,effectiveFrom:'2026-11-02',prices:{connectedMonthlyCents:1200,hostedMonthlyCents:3600}});
  assert.deepEqual(await f.store.charge(f.scope,command.chargeId),expected);
  assert.deepEqual(await f.otherStore.execute(f.scope,ev,command),receipt);
  assert.deepEqual(await snapshot(f,false),untouched);
 }finally{await f.close();}
});

test('concurrent renewal creation and day allocation cannot double charge',async()=>{
 const f=await fixture();try{
  await day(f,'2026-10-12');
  const commands=[freeze(),freeze()],events=[event(),event()];
  const outcomes=await Promise.allSettled(commands.map((c,i)=>(i?f.otherStore:f.store).execute(f.scope,events[i],c)));
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  const refused=outcomes.find(x=>x.status==='rejected') as PromiseRejectedResult;assert.equal(refused.reason.code,'billing_charge_conflict');
  assert.equal((await f.pool.query('SELECT count(*) FROM billing_events WHERE event_key=ANY($1)',[events.map(e=>e.key)])).rows[0].count,'1');
  const winner=(outcomes.find(x=>x.status==='fulfilled') as PromiseFulfilledResult<any>).value.value;
  assert.equal((await f.pool.query('SELECT consumed_by_charge_id FROM billing_hosted_days')).rows[0].consumed_by_charge_id,winner.id);
  const later=await charge(f,{...freeze(),renewalDate:'2026-12-01',connectedUntil:'2027-01-01'});
  assert.deepEqual(later.lines,f.venues.map(venueId=>({venueId,kind:'connected_month',quantity:1,cents:1000})));
  await noEffect(f,()=>charge(f,{...freeze(),kind:'hosted_comeback',connectedUntil:null}),'billing_charge_conflict');
  assert.equal((await charge(f,freeze(),f.other)).lines[0].venueId,f.otherVenue);
  await assert.rejects(f.pool.query(`INSERT INTO billing_charges SELECT organisation_id,legal_business_id,$1,kind,renewal_date,connected_until,hosted_from,hosted_through,price_revision,price_effective_from,currency,connected_monthly_cents,hosted_monthly_cents,vat_rate_basis_points,net_cents,vat_cents,gross_cents,event_id FROM billing_charges WHERE id=$2`,[randomUUID(),winner.id]),{code:'23505'});
 }finally{await f.close();}
});

test('comeback charges contain hosted arrears only and consume omitted zero cent days',async()=>{
 const f=await fixture();try{
  await day(f,'2026-10-12');
  const comeback=await charge(f,{...freeze(),kind:'hosted_comeback',connectedUntil:null});
  assert.deepEqual(comeback.lines,[{venueId:f.venues[0],kind:'hosted_days',quantity:1,cents:100}]);
  assert.deepEqual(comeback.totals,{netCents:100,vatCents:21,grossCents:121});
  await noEffect(f,()=>charge(f,{...freeze(),kind:'hosted_comeback',connectedUntil:null}),'billing_charge_conflict');
  await f.prices.publish({...price,revision:2,effectiveFrom:'2026-11-01',prices:{connectedMonthlyCents:1000,hostedMonthlyCents:0}});
  await day(f,'2026-10-13');
  const zero=await charge(f,{...freeze(),priceRevision:2});
  assert.deepEqual(zero.lines,f.venues.map(venueId=>({venueId,kind:'connected_month',quantity:1,cents:1000})));
  assert.equal((await f.pool.query("SELECT consumed_by_charge_id FROM billing_hosted_days WHERE on_date='2026-10-13'")).rows[0].consumed_by_charge_id,zero.id);
  await f.prices.publish({...price,revision:3,effectiveFrom:'2026-12-01'});
  await noEffect(f,()=>charge(f,{...freeze(),renewalDate:'2026-12-01',kind:'hosted_comeback',connectedUntil:null,priceRevision:3}),'billing_charge_conflict');
  assert.equal((await f.pool.query('SELECT count(*) FROM billing_payment_attempts')).rows[0].count,'0');
 }finally{await f.close();}
});

test('failed final line insert rolls back charge day assignments and event',async()=>{
 const f=await fixture();try{
  await day(f,'2026-10-12');const before=await snapshot(f),command=freeze(),ev=event();
  await f.pool.query(`CREATE FUNCTION billing_line_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.venue_id='${f.venues[1]}'::uuid THEN RAISE EXCEPTION 'owned_billing_line_failure' USING ERRCODE='P0001'; END IF; RETURN NEW; END $$`);
  await f.pool.query('CREATE TRIGGER billing_line_failure BEFORE INSERT ON billing_charge_lines FOR EACH ROW EXECUTE FUNCTION billing_line_failure()');
  await assert.rejects(f.store.execute(f.scope,ev,command),{code:'P0001',message:'owned_billing_line_failure'});
  assert.deepEqual(await snapshot(f),before);
  await f.pool.query('DROP TRIGGER billing_line_failure ON billing_charge_lines');
  const saved=await f.store.execute(f.scope,ev,command);assert.equal(saved.value.lines.length,3);
  assert.equal((await f.pool.query('SELECT count(*) FROM billing_charges')).rows[0].count,'1');
  assert.equal((await f.pool.query('SELECT consumed_by_charge_id FROM billing_hosted_days')).rows[0].consumed_by_charge_id,command.chargeId);
 }finally{await f.close();}
});

test('pending failed succeeded and refunded observations preserve accepted state',async()=>{
 const f=await fixture();try{
  const a=await seeded(f),id=a.attemptId;
  assert.equal(typeof f.store.payments,'function','payment state needs a scoped read');
  assert.deepEqual(await f.store.payments(f.scope,a.id),[{attemptId:id,chargeId:a.id,method:a.method,requestKey:a.requestKey,providerPaymentId:null,state:'pending',revision:0,succeededAt:null,observations:[]}]);
  assert.deepEqual((await f.store.history(f.scope,f.venues[0])).paid,[]);
  const early=event(randomUUID(),'2026-10-01T00:00:00.000Z');
  const history=await observe(f,id,'refunded',null,'test-payment',early);assert.equal(history.value.state,'pending');assert.equal(history.value.revision,0);
  await noEffect(f,()=>observe(f,id,'refunded',0),'billing_state_conflict');
  const failed=await observe(f,id,'failed',0);assert.equal(failed.value.state,'failed');assert.equal(failed.value.revision,1);
  assert.deepEqual((await f.store.history(f.scope,f.venues[0])).paid,[]);
  const successEvent=event(randomUUID(),'2026-10-13T09:00:00.000Z');
  const success=await observe(f,id,'succeeded',1,'test-payment',successEvent);
  assert.equal(success.value.state,'succeeded');assert.equal(success.value.revision,2);assert.equal(success.value.succeededAt,successEvent.occurredAt);
  for(const state of ['pending','failed']){
   const late=await observe(f,id,state,null);assert.equal(late.value.state,'succeeded');assert.equal(late.value.revision,2);
   await noEffect(f,()=>observe(f,id,state,2),'billing_state_conflict');
  }
  const repeated=await observe(f,id,'succeeded',2);assert.equal(repeated.value.revision,3);assert.equal(repeated.value.succeededAt,successEvent.occurredAt);
  const refund=await observe(f,id,'refunded',3);assert.equal(refund.value.state,'refunded');assert.equal(refund.value.revision,4);assert.equal(refund.value.succeededAt,successEvent.occurredAt);
  for(const state of ['pending','failed','succeeded'])await noEffect(f,()=>observe(f,id,state,4),'billing_state_conflict');
  const before=await snapshot(f);assert.deepEqual(await observe(f,id,'succeeded',1,'test-payment',successEvent),success);assert.deepEqual(await snapshot(f),before);
  assert.deepEqual(refund.value.observations.map((o:any)=>o.state).sort(),['failed','failed','pending','refunded','refunded','succeeded','succeeded']);
  assert.deepEqual(refund.value.observations.find((o:any)=>o.eventId===history.eventId),{eventId:history.eventId,state:'refunded',occurredAt:early.occurredAt});
 }finally{await f.close();}
});

test('payment bindings and revisions refuse races',async()=>{
 const f=await fixture();try{
  const frozen=await charge(f),a=await attempt(f,frozen.id),initial=a.value;
  assert.deepEqual(await f.otherStore.payments(f.scope,frozen.id),[initial]);
  assert.equal(initial.state,'pending');assert.equal(initial.providerPaymentId,null);assert.equal(initial.revision,0);assert.deepEqual(initial.method,a.method);
  const replacement=method();await f.store.execute(f.scope,event(),{type:'set_method',method:replacement});
  assert.deepEqual((await f.store.payments(f.scope,frozen.id))[0].method,a.method);
  await noEffect(f,()=>f.store.execute(f.scope,event(),{...a.command,attemptId:randomUUID()}),'billing_state_conflict');
  await noEffect(f,()=>f.store.execute(f.scope,event(),{...a.command,requestKey:randomUUID()}),'billing_state_conflict');
  const foreign=await seeded(f,f.other,f.otherVenue);
  await noEffect(f,()=>f.store.execute(f.other,event(),{...a.command,chargeId:foreign.id,attemptId:randomUUID(),methodId:foreign.method.id}),'billing_state_conflict');
  const observations=await Promise.allSettled([observe(f,a.command.attemptId,'succeeded',0),observe(f,a.command.attemptId,'failed',0)]);
  assert.equal(observations.filter(x=>x.status==='fulfilled').length,1);
  assert.equal((observations.find(x=>x.status==='rejected') as PromiseRejectedResult).reason.code,'billing_state_conflict');
  await noEffect(f,()=>observe(f,foreign.attemptId,'pending',null),'billing_scope_not_found');
  await noEffect(f,()=>observe(f,foreign.attemptId,'pending',null,'test-payment',event(),f.other),'billing_state_conflict');
  await noEffect(f,()=>observe(f,a.command.attemptId,'pending',null,'another-payment'),'billing_state_conflict');
 }finally{await f.close();}
});

test('provider observations bind their account and event identity across businesses',async()=>{
 const f=await fixture();try{
  const a=await seeded(f),b=await seeded(f,f.other,f.otherVenue);
  const ev:BillingEvent={...event(),source:{kind:'provider',provider:'sumup',accountId:'test-account'}};
  const accepted=await observe(f,a.attemptId,'succeeded',0,'provider-payment',ev);
  assert.equal(accepted.value.state,'succeeded');
  assert.deepEqual(await observe(f,a.attemptId,'succeeded',0,'provider-payment',ev),accepted);
  await noEffect(f,()=>observe(f,b.attemptId,'succeeded',0,'other-payment',ev,f.other),'billing_event_conflict');
  for(const source of [{kind:'provider',provider:'stripe',accountId:'test-account'},{kind:'provider',provider:'sumup',accountId:'other-account'}])
   await noEffect(f,()=>observe(f,a.attemptId,'pending',null,'provider-payment',{...event(),source} as BillingEvent),'billing_state_conflict');
  await noEffect(f,()=>observe(f,a.attemptId,'failed',null,'provider-payment',ev),'billing_event_conflict');
 }finally{await f.close();}
});

test('paid history requires actual successful venue lines and survives a refund',async()=>{
 const f=await fixture();try{
  await day(f,'2026-10-01');await day(f,'2026-10-03');
  const frozen=await charge(f),a=await attempt(f,frozen.id),id=a.command.attemptId;
  assert.deepEqual((await f.store.history(f.scope,f.venues[0])).paid,[]);
  const untouched=await snapshot(f,false),successEvent=event();
  await observe(f,id,'succeeded',0,'test-payment',successEvent);
  const expected=[{level:'connected',chargeId:frozen.id,attemptId:id,from:'2026-11-01',until:'2026-12-01'},{level:'hosted',chargeId:frozen.id,attemptId:id,from:'2026-10-01',until:'2026-10-04'}].reverse();
  assert.deepEqual((await f.store.history(f.scope,f.venues[0])).paid,expected);
  assert.deepEqual((await f.store.history(f.scope,f.venues[1])).paid,[{level:'connected',chargeId:frozen.id,attemptId:id,from:'2026-11-01',until:'2026-12-01'}]);
  for(const level of ['connected','hosted'])await noEffect(f,()=>f.store.execute(f.scope,event(),{type:'start_trial',venueId:f.venues[0],level,on:'2026-12-01'}),'billing_trial_unavailable');
  assert.equal((await f.store.execute(f.scope,event(),{type:'start_trial',venueId:f.venues[1],level:'hosted',on:'2026-12-01'})).value.level,'hosted');
  await observe(f,id,'succeeded',0,'test-payment',successEvent);await observe(f,id,'refunded',1);
  assert.deepEqual((await f.store.history(f.scope,f.venues[0])).paid,expected);
  assert.equal((await f.pool.query('SELECT count(*) FROM billing_paid_periods')).rows[0].count,'3');
  assert.deepEqual(await snapshot(f,false),untouched);
 }finally{await f.close();}
});

test('late connected payment credits still unbilled hosted days',async()=>{
 const f=await fixture();try{
  const cover=await charge(f,{...freeze(),renewalDate:'2026-10-01',connectedUntil:'2026-11-01',window:{from:'2026-09-01',through:'2026-09-30'}});
  const a=await attempt(f,cover.id);
  for(let n=1;n<=4;n++)await day(f,`2026-10-0${n}`);
  await noEffect(f,()=>day(f,'2026-10-01',cover.id),'billing_charge_conflict');
  await observe(f,a.command.attemptId,'failed',0);await noEffect(f,()=>day(f,'2026-10-01',cover.id),'billing_charge_conflict');
  await observe(f,a.command.attemptId,'succeeded',1);
  for(let n=1;n<=4;n++)await day(f,`2026-10-0${n}`,cover.id);
  await day(f,'2026-10-01',cover.id);
  const frozen=await charge(f);assert.deepEqual(frozen.lines.find((l:any)=>l.kind==='hosted_days'),{venueId:f.venues[0],kind:'hosted_days',quantity:4,cents:267});
  await noEffect(f,()=>day(f,'2026-10-01',null),'billing_charge_conflict');
  assert.equal((await f.store.charge(f.scope,frozen.id)).lines.find((l:any)=>l.kind==='hosted_days').cents,267);
 }finally{await f.close();}
});

test('charge and payment reads and commands refuse foreign identities without effects',async()=>{
 const f=await fixture();try{
  const a=await seeded(f),b=await seeded(f,f.other,f.otherVenue),c=await seeded(f,f.foreign,f.foreignVenue);
  assert.equal(typeof f.store.charge,'function');assert.equal(typeof f.store.payments,'function');
  for(const chargeId of [b.id,c.id,randomUUID()]){
   await noEffect(f,()=>f.store.charge(f.scope,chargeId),'billing_scope_not_found');
   await noEffect(f,()=>f.store.payments(f.scope,chargeId),'billing_scope_not_found');
   await noEffect(f,()=>f.store.execute(f.scope,event(),{type:'begin_attempt',chargeId,attemptId:randomUUID(),methodId:a.method.id,requestKey:randomUUID()}),'billing_scope_not_found');
  }
  for(const attemptId of [b.attemptId,c.attemptId,randomUUID()])await noEffect(f,()=>observe(f,attemptId,'succeeded',0),'billing_scope_not_found');
  for(const methodId of [b.method.id,c.method.id,randomUUID()])await noEffect(f,()=>f.store.execute(f.scope,event(),{type:'begin_attempt',chargeId:a.id,attemptId:randomUUID(),methodId,requestKey:randomUUID()}),'billing_scope_not_found');
 }finally{await f.close();}
});

test('charge bounds effective prices and unsafe arithmetic refuse without partial effects',async()=>{
 const f=await fixture();try{
  for(const command of [
   {...freeze(),connectedUntil:'2026-11-01'}, {...freeze(),kind:'hosted_comeback'},
   {...freeze(),window:{from:'2026-11-02',through:'2026-11-01'}}, {...freeze(),priceRevision:0},
   {...freeze(),chargeId:'bad'}, {...freeze(),renewalDate:'2026-02-30'}, {...freeze(),metadata:'synthetic-forbidden'},
  ])await noEffect(f,()=>charge(f,command),'invalid_billing_input');
  await f.prices.publish({...price,revision:2,effectiveFrom:'2026-12-01'});
  await noEffect(f,()=>charge(f,{...freeze(),priceRevision:2}),'billing_price_conflict');
  await noEffect(f,()=>charge(f,{...freeze(),renewalDate:'2026-12-01',connectedUntil:'2027-01-01'}),'billing_price_conflict');
  await f.prices.publish({...price,revision:3,effectiveFrom:'2027-01-01',vatRateBasisPoints:10000,prices:{connectedMonthlyCents:900719925474,hostedMonthlyCents:900719925474}});
  await noEffect(f,()=>charge(f,{...freeze(),priceRevision:3,renewalDate:'2027-01-01',connectedUntil:'2027-02-01'}),'invalid_billing_input');
  await noEffect(f,()=>charge(f,{...freeze(),priceRevision:1,renewalDate:'2026-08-01',connectedUntil:'2026-09-01'}),'billing_price_unavailable');
 }finally{await f.close();}
});

test('database refuses attempt binding changes and loss of first success',async()=>{
 const f=await fixture();try{
  const a=await seeded(f);
  const original=await snapshot(f);
  for(const assignment of ["request_key='changed'",`method_id='${randomUUID()}'`,`charge_id='${randomUUID()}'`]){
   await assert.rejects(f.pool.query(`UPDATE billing_payment_attempts SET ${assignment} WHERE id=$1`,[a.attemptId]),{code:'55000'});
   assert.deepEqual(await snapshot(f),original);
  }
  await f.pool.query("UPDATE billing_payment_attempts SET provider_payment_id='first',state='succeeded',succeeded_at='2026-10-12T09:00:00Z' WHERE id=$1",[a.attemptId]);
  const succeeded=await snapshot(f);
  for(const assignment of ["provider_payment_id='changed'","succeeded_at='2026-10-13T09:00:00Z'","state='failed',succeeded_at=NULL"]){
   await assert.rejects(f.pool.query(`UPDATE billing_payment_attempts SET ${assignment} WHERE id=$1`,[a.attemptId]),{code:'55000'});assert.deepEqual(await snapshot(f),succeeded);
  }
  await f.pool.query("UPDATE billing_payment_attempts SET state='refunded' WHERE id=$1",[a.attemptId]);
  await assert.rejects(f.pool.query("UPDATE billing_payment_attempts SET state='succeeded' WHERE id=$1",[a.attemptId]),{code:'55000'});
  await assert.rejects(f.pool.query('DELETE FROM billing_payment_attempts WHERE id=$1',[a.attemptId]),{code:'55000'});
 }finally{await f.close();}
});

for(const [from,to] of [['succeeded','pending'],['succeeded','failed'],['refunded','succeeded'],['refunded','pending'],['refunded','failed']] as const){
 test(`accepted ${from} payment refuses ${to} before any observation effect`,async()=>{
  const f=await fixture();try{
   const a=await seeded(f);
   await f.pool.query('UPDATE billing_payment_attempts SET state=$2,succeeded_at=\'2026-10-12T09:00:00Z\',provider_payment_id=\'test-payment\' WHERE id=$1',[a.attemptId,from]);
   await noEffect(f,()=>observe(f,a.attemptId,to,0),'billing_state_conflict');
  }finally{await f.close();}
 });
}
