import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {BillingStore,transaction} from '@waitron-cloud/registration';
import {database} from './fixtures.ts';
import * as binding from '../src/billing-method-binding.ts';

let db:Awaited<ReturnType<typeof database>>;
before(async()=>{db=await database();});after(async()=>db?.close());

test('payment setup has country-local persistence for restart recovery',async()=>{
 const result=await db.pool.query("SELECT to_regclass('billing_method_setups')::text AS name");
 assert.equal(result.rows[0].name,'billing_method_setups');
});

async function started(kind:'card'|'direct_debit'='card'){
 const f=await business(),setups=new binding.BillingMethodSetups(db.pool);
 const intent=await transaction(db.pool,c=>setups.createOn(c,f.scope,f.ownerId,kind,kind==='card'?'sumup-sandbox:MSYNTHETIC':'stripe-test:acct_synthetic'));
 const saved=await transaction(db.pool,c=>setups.bindOn(c,intent,{customerId:'customer_'+intent.id,providerReference:'setup_'+intent.id}));
 return {...f,setups,intent,saved};
}

test('a provider binding cannot be replaced or erased after the response is saved',async()=>{
 const f=await started(),before=await transaction(db.pool,c=>f.setups.readOn(c,f.scope));
 for(const value of [{customerId:'other_customer',providerReference:f.saved.providerReference!},{customerId:f.saved.customerId!,providerReference:'other_setup'}])
  await assert.rejects(transaction(db.pool,c=>f.setups.bindOn(c,f.saved,value)),/billing_state_conflict/);
 assert.deepEqual(await transaction(db.pool,c=>f.setups.readOn(c,f.scope)),before);
});

test('completion and provider response for a superseded setup cannot select or overwrite the new setup',async()=>{
 const f=await started();
 const newer=await transaction(db.pool,c=>f.setups.createOn(c,f.scope,f.ownerId,'direct_debit','stripe-test:acct_synthetic'));
 await assert.rejects(transaction(db.pool,c=>f.setups.bindOn(c,f.intent,{customerId:'late_customer',providerReference:'late_setup'})),/billing_state_conflict/);
 await assert.rejects(transaction(db.pool,c=>f.setups.completeOn(c,f.saved,{methodId:'late_token',mandateId:null})),/billing_state_conflict/);
 assert.deepEqual(await transaction(db.pool,c=>f.setups.readOn(c,f.scope)),newer);
 assert.equal((await new BillingStore(db.pool).business(f.scope)).paymentMethod,null);
});

test('completion replay returns its original result without selecting the old method again',async()=>{
 const f=await started('direct_debit'),store=new BillingStore(db.pool),value={methodId:'pm_synthetic',mandateId:'mandate_synthetic'};
 const original=await transaction(db.pool,c=>f.setups.completeOn(c,f.saved,value));
 await store.execute(f.scope,{key:randomUUID(),occurredAt:new Date().toISOString(),source:{kind:'internal'}},{type:'set_method',method:null});
 const replay=await transaction(db.pool,c=>new binding.BillingMethodSetups(db.pool).completeOn(c,f.saved,value));
 assert.deepEqual(replay,original);
 assert.equal((await store.business(f.scope)).paymentMethod,null);
 await assert.rejects(transaction(db.pool,c=>f.setups.completeOn(c,f.saved,{...value,methodId:'changed_pm'})),/billing_event_conflict/);
 assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM billing_payment_methods WHERE organisation_id=$1',[f.scope.organisationId])).rows[0].n,1);
});

test('completion uses the entire saved owner business provider and setup binding',async()=>{
 const f=await started(),other=await business();
 for(const change of [{id:randomUUID()},{ownerId:other.ownerId},{methodId:randomUUID()},{createdAt:'2026-01-01T00:00:00.000Z'},
  {providerAccountId:'sumup-sandbox:MOTHER'},{customerId:'other'},{providerReference:'other'},{kind:'direct_debit' as const},other.scope]){
  await assert.rejects(transaction(db.pool,c=>f.setups.completeOn(c,{...f.saved,...change},{methodId:'token_synthetic',mandateId:null})),/billing_state_conflict/);
 }
 await assert.rejects(transaction(db.pool,c=>f.setups.completeOn(c,f.intent,{methodId:'token_synthetic',mandateId:null})),/billing_state_conflict/);
 assert.equal((await new BillingStore(db.pool).business(f.scope)).paymentMethod,null);
});

test('setup work rolls back with the caller and refuses clients outside a transaction',async()=>{
 const f=await started(),client=await db.pool.connect();
 try{
  for(const operation of [()=>f.setups.readOn(client,f.scope),()=>f.setups.createOn(client,f.scope,f.ownerId,'card','sumup-sandbox:MSYNTHETIC'),
   ()=>f.setups.bindOn(client,f.saved,{customerId:'other',providerReference:'other'}),()=>f.setups.completeOn(client,f.saved,{methodId:'token_synthetic',mandateId:null})])
   await assert.rejects(operation,/invalid_billing_input/);
 }finally{client.release();}
 await assert.rejects(transaction(db.pool,async c=>{
  await f.setups.completeOn(c,f.saved,{methodId:'token_synthetic',mandateId:null});throw Error('abort');
 }),/abort/);
 assert.equal((await new BillingStore(db.pool).business(f.scope)).paymentMethod,null);
 assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM billing_payment_methods WHERE organisation_id=$1',[f.scope.organisationId])).rows[0].n,0);
});

test('setup rejects mixed providers and live or unqualified accounts without creating billing state',async()=>{
 const f=await business(),setups=new binding.BillingMethodSetups(db.pool);
 for(const [kind,account] of [['card','stripe-test:acct_synthetic'],['direct_debit','sumup-sandbox:MSYNTHETIC'],['card','sumup:MSYNTHETIC'],['direct_debit','stripe-live:acct_synthetic']] as const)
  await assert.rejects(transaction(db.pool,c=>setups.createOn(c,f.scope,f.ownerId,kind,account)),/invalid_billing_input|invalid_provider_account/);
 assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM billing_businesses WHERE organisation_id=$1',[f.scope.organisationId])).rows[0].n,0);
});

test('concurrent completions keep one method and one completion event',async()=>{
 const f=await started(),value={methodId:'token_'+f.saved.id,mandateId:null};
 const results=await Promise.all([transaction(db.pool,c=>f.setups.completeOn(c,f.saved,value)),transaction(db.pool,c=>f.setups.completeOn(c,f.saved,value))]);
 assert.deepEqual(results[0],results[1]);
 assert.equal((await new BillingStore(db.pool).business(f.scope)).paymentMethod?.id,f.saved.methodId);
 assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM billing_events WHERE organisation_id=$1 AND event_key=$2',[f.scope.organisationId,f.saved.id])).rows[0].n,1);
});

async function business(){
 const ownerId=randomUUID(),organisationId=randomUUID(),legalBusinessId=randomUUID();
 await transaction(db.pool,async client=>{
  await client.query('INSERT INTO cloud_accounts(id) VALUES($1)',[ownerId]);
  await client.query('INSERT INTO organisations(id) VALUES($1)',[organisationId]);
  await client.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[legalBusinessId,organisationId]);
 });
 return {ownerId,scope:{organisationId,legalBusinessId}};
}

test('setup intent survives a new store and never selects a method before verification',async()=>{
 const f=await business();
 // Removing either save, or selecting during the first save, breaks the persisted result.
 const setups=new binding.BillingMethodSetups(db.pool);
 const intent=await transaction(db.pool,c=>setups.createOn(c,f.scope,f.ownerId,'card','sumup-sandbox:MSYNTHETIC'));
 const fresh=new binding.BillingMethodSetups(db.pool);
 assert.deepEqual(await transaction(db.pool,c=>fresh.readOn(c,f.scope)),intent);
 assert.equal(intent.customerId,null);assert.equal(intent.providerReference,null);assert.notEqual(intent.id,intent.methodId);
 assert.equal((await new BillingStore(db.pool).business(f.scope)).paymentMethod,null);
 await assert.rejects(transaction(db.pool,c=>fresh.completeOn(c,intent,{methodId:'premature_token',mandateId:null})),/billing_state_conflict/);
 const saved=await transaction(db.pool,c=>fresh.bindOn(c,intent,{customerId:'customer_synthetic',providerReference:'checkout_synthetic'}));
 assert.equal(saved.customerId,'customer_synthetic');assert.equal(saved.providerReference,'checkout_synthetic');
 assert.equal((await new BillingStore(db.pool).business(f.scope)).paymentMethod,null);
 const result=await transaction(db.pool,c=>fresh.completeOn(c,saved,{methodId:'token_synthetic',mandateId:null}));
 assert.equal(result.paymentMethod?.id,intent.methodId);
 assert.equal(result.paymentMethod?.providerAccountId,'sumup-sandbox:MSYNTHETIC');
 assert.equal(result.anchorDate,null);assert.equal(result.anchorDay,null);
 assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM billing_paid_periods WHERE organisation_id=$1',[f.scope.organisationId])).rows[0].n,0);
 const events=(await db.pool.query('SELECT event_key,command,occurred_at FROM billing_events WHERE organisation_id=$1',[f.scope.organisationId])).rows;
 assert.equal(events.length,2);
 assert.equal(events.filter(e=>e.event_key===intent.id).length,1);
 assert.equal(events.find(e=>e.event_key===intent.id).command.type,'set_method');
 assert.equal(events.find(e=>e.event_key===intent.id).occurred_at.toISOString(),intent.createdAt);
});

for(const kind of ['card','direct_debit'] as const)test(`a pending ${kind} switch keeps the previous method and billing dates`,async()=>{
 const f=await business(),store=new BillingStore(db.pool),setups=new binding.BillingMethodSetups(db.pool),oldId=randomUUID();
 const event=()=>({key:randomUUID(),occurredAt:'2026-11-01T00:00:00.000Z',source:{kind:'internal' as const}});
 await store.execute(f.scope,event(),{type:'ensure_business'});
 const old=kind==='card'
  ?{id:oldId,kind:'direct_debit' as const,provider:'stripe' as const,providerAccountId:'stripe-test:acct_synthetic',customerId:'old_customer',methodId:'old_pm_'+oldId,mandateId:'old_mandate_'+oldId}
  :{id:oldId,kind:'card' as const,provider:'sumup' as const,providerAccountId:'sumup-sandbox:MSYNTHETIC',customerId:'old_customer',methodId:'old_token_'+oldId,mandateId:null};
 await store.execute(f.scope,event(),{type:'set_method',method:old});
 await store.execute(f.scope,event(),{type:'anchor',on:'2026-11-01',mode:'initial',expectedRevision:1});
 const before=await store.business(f.scope);
 const intent=await transaction(db.pool,c=>setups.createOn(c,f.scope,f.ownerId,kind,kind==='card'?'sumup-sandbox:MSYNTHETIC':'stripe-test:acct_synthetic'));
 const saved=await transaction(db.pool,c=>setups.bindOn(c,intent,{customerId:'new_customer_'+intent.id,providerReference:'new_setup_'+intent.id}));
 assert.deepEqual(await store.business(f.scope),before);
 await transaction(db.pool,c=>setups.completeOn(c,saved,{methodId:'new_token_'+intent.id,mandateId:kind==='card'?null:'new_mandate_'+intent.id}));
 const after=await store.business(f.scope);
 assert.equal(after.paymentMethod?.id,intent.methodId);assert.equal(after.paymentMethod?.kind,kind);
 assert.equal(after.anchorDate,'2026-11-01');assert.equal(after.anchorDay,1);
 assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM billing_payment_methods WHERE organisation_id=$1',[f.scope.organisationId])).rows[0].n,2);
});
