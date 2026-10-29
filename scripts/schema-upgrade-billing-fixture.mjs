import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {source,digest} from './schema-upgrade-fixture.mjs';

const tables=['billing_prices','billing_businesses','billing_events','billing_payment_methods','billing_venues','billing_trials','billing_charges','billing_charge_lines','billing_hosted_days','billing_payment_attempts','billing_payment_observations','billing_paid_periods'];
export async function billingState(pool){
 const rows={};
 for(const table of tables)rows[table]=(await pool.query(`SELECT to_jsonb(t) AS value FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
 return rows;
}
export async function emptyBilling(pool){
 const rows=await billingState(pool);
 for(const table of tables)assert.deepEqual(rows[table],[],table+' starts empty');
 return true;
}
export async function seedBilling(root,pool,state){
 const {BillingStore,BillingPriceStore}=await source(root,'packages/registration/src/index.ts');
 const store=new BillingStore(pool),prices=new BillingPriceStore(pool);
 const price={revision:1,effectiveFrom:'2026-09-01',currency:'EUR',prices:{connectedMonthlyCents:1000,hostedMonthlyCents:3000},vatRateBasisPoints:2100};
 await prices.publish(price);
 const proof={businesses:[],price};
 for(let index=0;index<state.owners.length;index++){
  const owner=state.owners[index],scope={organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId},venueId=state.installations[index].venueId;
  const execute=command=>store.execute(scope,{key:randomUUID(),occurredAt:'2026-11-01T00:00:00.000Z',source:{kind:'internal'}},command);
  await execute({type:'ensure_business'});await execute({type:'anchor',on:'2026-10-01',mode:'initial',expectedRevision:0});
  const method={id:randomUUID(),kind:index===0?'card':'direct_debit',provider:index===0?'sumup':'stripe',providerAccountId:'synthetic-account-'+index,customerId:'synthetic-customer-'+index,methodId:'synthetic-method-'+index,mandateId:index===0?null:'synthetic-mandate'};
  await execute({type:'set_method',method});
  await execute({type:'set_venue',venueId,expectedRevision:0,value:{level:'connected',connectedFrom:'2026-10-01',lapsedOn:null,scheduledLevel:null,scheduledOn:null}});
  for(const level of ['connected','hosted']){
   await execute({type:'start_trial',venueId,level,on:'2026-09-01'});
   if(level==='connected')await execute({type:'extend_trial',venueId,level,expectedEnd:'2026-10-01'});
   await execute({type:'end_trial',venueId,level,expectedEnd:level==='connected'?'2026-10-31':'2026-10-01',outcome:level==='connected'?'converted':'lapsed'});
  }
  const event={key:randomUUID(),occurredAt:'2026-11-01T00:00:00.000Z',source:{kind:'internal'}};
  const command={type:'freeze_charge',chargeId:randomUUID(),kind:'renewal',renewalDate:'2026-11-01',connectedUntil:'2026-12-01',window:{from:'2026-10-01',through:'2026-10-31'},priceRevision:1};
  const receipt=await store.execute(scope,event,command);
  assert.deepEqual(receipt.value.lines,[{venueId,kind:'connected_month',quantity:1,cents:1000}]);
  assert.deepEqual(receipt.value.totals,{netCents:1000,vatCents:210,grossCents:1210});
  const attemptId=randomUUID();
  await execute({type:'begin_attempt',chargeId:command.chargeId,attemptId,methodId:method.id,requestKey:randomUUID()});
  for(const [paymentState,expectedRevision] of [['failed',0],['succeeded',1]])await execute({type:'observe_payment',attemptId,providerPaymentId:'synthetic-payment-'+index,state:paymentState,expectedRevision});
  await execute({type:'hosted_day',venueId,on:'2026-11-02',coveredByChargeId:command.chargeId});
  await execute({type:'hosted_day',venueId,on:'2026-11-03',coveredByChargeId:null});
  const comeback=randomUUID();
  await execute({type:'freeze_charge',chargeId:comeback,kind:'hosted_comeback',renewalDate:'2026-11-05',connectedUntil:null,window:{from:'2026-11-01',through:'2026-11-04'},priceRevision:1});
  await execute({type:'begin_attempt',chargeId:comeback,attemptId:randomUUID(),methodId:method.id,requestKey:randomUUID()});
  if(index===0)await execute({type:'observe_payment',attemptId,providerPaymentId:'synthetic-payment-'+index,state:'refunded',expectedRevision:2});
  proof.businesses.push({scope,venueId,command,event,receipt,attemptId,comeback,paymentState:index===0?'refunded':'succeeded'});
 }
 await prices.publish({...price,revision:2,effectiveFrom:'2026-12-01',prices:{connectedMonthlyCents:2000,hostedMonthlyCents:6000},vatRateBasisPoints:1000});
 for(const table of tables)assert.ok((await billingState(pool))[table].length>0,table+' must be populated before backup');
 await restoredBilling(root,pool,proof,await billingState(pool));
 return proof;
}
export async function restoredBilling(root,pool,proof,expected){
 const {BillingStore,BillingPriceStore}=await source(root,'packages/registration/src/index.ts');
 const store=new BillingStore(pool),prices=new BillingPriceStore(pool);
 assert.equal(digest(await billingState(pool)),digest(expected),'all twelve billing tables survive restore exactly');
 assert.deepEqual(await prices.revision(1),proof.price);
 assert.equal((await prices.effective('2026-12-01')).revision,2);
 for(const item of proof.businesses){
  const {scope,venueId,command,event,receipt,attemptId,comeback}=item;
  assert.deepEqual(await store.charge(scope,command.chargeId),receipt.value);
  assert.deepEqual(await store.execute(scope,event,command),receipt);
  await assert.rejects(store.execute(scope,event,{...command,renewalDate:'2026-11-02'}),{code:'billing_event_conflict'});
  const foreign=proof.businesses.find(b=>b.scope.legalBusinessId!==scope.legalBusinessId).scope;
  for(const read of [()=>store.charge(foreign,command.chargeId),()=>store.payments(foreign,command.chargeId),()=>store.venue(foreign,venueId),()=>store.history(foreign,venueId)])await assert.rejects(read(),{code:'billing_scope_not_found'});
  const payment=(await store.payments(scope,command.chargeId))[0];
  assert.equal(payment.attemptId,attemptId);assert.equal(payment.state,item.paymentState);assert.equal(payment.succeededAt,'2026-11-01T00:00:00.000Z');
  assert.deepEqual(payment.observations.map(o=>o.state).sort(),item.paymentState==='refunded'?['failed','refunded','succeeded']:['failed','succeeded']);
  const history=await store.history(scope,venueId);
  assert.deepEqual(history.trials,[{level:'connected',startedOn:'2026-09-01',endsOn:'2026-10-31',extended:true,state:'converted'},{level:'hosted',startedOn:'2026-09-01',endsOn:'2026-10-01',extended:false,state:'lapsed'}]);
  assert.deepEqual(history.paid,[{level:'connected',chargeId:command.chargeId,attemptId,from:'2026-11-01',until:'2026-12-01'}]);
  assert.deepEqual((await pool.query('SELECT on_date::text,covered_by_charge_id,consumed_by_charge_id FROM billing_hosted_days WHERE venue_id=$1 ORDER BY on_date',[venueId])).rows,[{on_date:'2026-11-02',covered_by_charge_id:command.chargeId,consumed_by_charge_id:comeback},{on_date:'2026-11-03',covered_by_charge_id:null,consumed_by_charge_id:comeback}]);
  await assert.rejects(store.execute(scope,{key:randomUUID(),occurredAt:'2026-11-02T00:00:00.000Z',source:{kind:'internal'}},{type:'observe_payment',attemptId,providerPaymentId:payment.providerPaymentId,state:'pending',expectedRevision:payment.revision}),{code:'billing_state_conflict'});
 }
 assert.equal(digest(await billingState(pool)),digest(expected),'retries, collisions, foreign reads and state refusals leave restored facts unchanged');
}
