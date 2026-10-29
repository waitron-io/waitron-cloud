import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {migrate} from '../src/migrate.ts';

const price={revision:1,effectiveFrom:'2026-10-01',currency:'EUR',prices:{connectedMonthlyCents:1000,hostedMonthlyCents:3000},vatRateBasisPoints:2100};
async function fixture(){
 const schema='billing_schema_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);
  const org=randomUUID(),business=randomUUID(),otherBusiness=randomUUID(),foreignOrg=randomUUID(),foreignBusiness=randomUUID(),venue=randomUUID(),otherVenue=randomUUID();
  await pool.query('INSERT INTO organisations(id) VALUES($1),($2)',[org,foreignOrg]);
  await pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2),($3,$2),($4,$5)',[business,org,otherBusiness,foreignBusiness,foreignOrg]);
  await pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$1,'test'),($4,$2,$5,$4,'test')",[venue,org,business,otherVenue,otherBusiness]);
  const close=async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();};
  return {pool,schema,org,business,otherBusiness,foreignOrg,foreignBusiness,venue,otherVenue,close};
 }catch(error){await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();throw error;}
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function refused(f:Fixture,sql:string,args:unknown[]=[],code='23514'){
 await assert.rejects(f.pool.query(sql,args),(error:{code:string})=>{assert.equal(error.code,code);return true;});
}
async function business(f:Fixture){await f.pool.query('INSERT INTO billing_businesses(organisation_id,legal_business_id) VALUES($1,$2)',[f.org,f.business]);}
async function seed(f:Fixture){
 await business(f);
 const event=randomUUID(),method=randomUUID(),charge=randomUUID(),attempt=randomUUID();
 await f.pool.query("INSERT INTO billing_events(id,organisation_id,legal_business_id,source,event_key,occurred_at,command,result) VALUES($1,$2,$3,'internal','seed','2026-10-01T00:00:00Z','{}','{}')",[event,f.org,f.business]);
 await f.pool.query("INSERT INTO billing_venues(organisation_id,legal_business_id,venue_id) VALUES($1,$2,$3)",[f.org,f.business,f.venue]);
 await f.pool.query("INSERT INTO billing_prices(revision,effective_from,currency,connected_monthly_cents,hosted_monthly_cents,vat_rate_basis_points) VALUES(1,'2026-10-01','EUR',1000,3000,2100)");
 await f.pool.query("INSERT INTO billing_payment_methods(organisation_id,legal_business_id,id,kind,provider,provider_account_id,customer_id,method_id,mandate_id,event_id) VALUES($1,$2,$3,'card','sumup','account','customer','card',NULL,$4)",[f.org,f.business,method,event]);
 await f.pool.query(`INSERT INTO billing_charges(organisation_id,legal_business_id,id,kind,renewal_date,connected_until,hosted_from,hosted_through,price_revision,price_effective_from,currency,connected_monthly_cents,hosted_monthly_cents,vat_rate_basis_points,net_cents,vat_cents,gross_cents,event_id)
  VALUES($1,$2,$3,'renewal','2026-10-01','2026-11-01','2026-09-01','2026-09-30',1,'2026-10-01','EUR',1000,3000,2100,1000,210,1210,$4)`,[f.org,f.business,charge,event]);
 await f.pool.query("INSERT INTO billing_charge_lines(organisation_id,legal_business_id,charge_id,venue_id,kind,quantity,cents) VALUES($1,$2,$3,$4,'connected_month',1,1000)",[f.org,f.business,charge,f.venue]);
 await f.pool.query("INSERT INTO billing_payment_attempts(organisation_id,legal_business_id,id,charge_id,method_id,provider,provider_account_id,request_key,event_id) VALUES($1,$2,$3,$4,$5,'sumup','account','request',$6)",[f.org,f.business,attempt,charge,method,event]);
 await f.pool.query("INSERT INTO billing_trials(organisation_id,legal_business_id,venue_id,level,started_on,ends_on,event_id) VALUES($1,$2,$3,'connected','2026-10-01','2026-10-31',$4)",[f.org,f.business,f.venue,event]);
 await f.pool.query("INSERT INTO billing_hosted_days(organisation_id,legal_business_id,venue_id,on_date,event_id) VALUES($1,$2,$3,'2026-10-01',$4)",[f.org,f.business,f.venue,event]);
 await f.pool.query("INSERT INTO billing_payment_observations(organisation_id,legal_business_id,attempt_id,event_id,state,occurred_at) VALUES($1,$2,$3,$4,'pending','2026-10-01T00:00:00Z')",[f.org,f.business,attempt,event]);
 await f.pool.query("UPDATE billing_payment_attempts SET state='succeeded',revision=1,succeeded_at='2026-10-01T00:00:00Z' WHERE id=$1",[attempt]);
 await f.pool.query("INSERT INTO billing_paid_periods(organisation_id,legal_business_id,venue_id,level,charge_id,attempt_id,from_date,until_date) VALUES($1,$2,$3,'connected',$4,$5,'2026-10-01','2026-11-01')",[f.org,f.business,f.venue,charge,attempt]);
 return {event,method,charge,attempt};
}

test('billing schema rejects foreign ownership and retains billing parents',async()=>{
 const f=await fixture();try{
  await refused(f,'INSERT INTO billing_businesses(organisation_id,legal_business_id) VALUES($1,$2)',[f.org,f.foreignBusiness],'23503');
  await business(f);
  await refused(f,'INSERT INTO billing_venues(organisation_id,legal_business_id,venue_id) VALUES($1,$2,$3)',[f.org,f.business,f.otherVenue],'23503');
  await f.pool.query('INSERT INTO billing_venues(organisation_id,legal_business_id,venue_id) VALUES($1,$2,$3)',[f.org,f.business,f.venue]);
  await refused(f,'DELETE FROM venues WHERE id=$1',[f.venue],'23503');
  await refused(f,'DELETE FROM legal_businesses WHERE id=$1',[f.business],'23503');
  await refused(f,'DELETE FROM organisations WHERE id=$1',[f.org],'23503');
  assert.equal((await f.pool.query('SELECT count(*) FROM billing_venues')).rows[0].count,'1');
 }finally{await f.close();}
});

test('billing schema enforces uniqueness and immutable facts',async()=>{
 const f=await fixture();try{
  const ids=await seed(f);
  for(const [table,patch] of [
   ['billing_charges',{id:randomUUID()}],['billing_charge_lines',{}],['billing_trials',{}],['billing_hosted_days',{}],
  ] as const){
   await refused(f,`INSERT INTO ${table} SELECT * FROM jsonb_populate_record(NULL::${table},(SELECT to_jsonb(t)||$1::jsonb FROM ${table} t LIMIT 1))`,[patch],'23505');
  }
  for(const table of ['billing_events','billing_prices','billing_payment_methods','billing_charges','billing_charge_lines','billing_payment_observations','billing_paid_periods']){
   const field=table==='billing_prices'?'revision':table==='billing_charge_lines'?'quantity':table==='billing_paid_periods'?'level':table==='billing_payment_observations'?'state':'id';
   await refused(f,`UPDATE ${table} SET ${field}=${field}`,[],'55000');
   await refused(f,`DELETE FROM ${table}`,[],'55000');
   assert.equal((await f.pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count,'1');
  }
  await business({...f,business:f.otherBusiness});
  await f.pool.query('INSERT INTO billing_venues(organisation_id,legal_business_id,venue_id) VALUES($1,$2,$3)',[f.org,f.otherBusiness,f.otherVenue]);
  await refused(f,"INSERT INTO billing_charge_lines(organisation_id,legal_business_id,charge_id,venue_id,kind,quantity,cents) VALUES($1,$2,$3,$4,'hosted_days',1,100)",[f.org,f.otherBusiness,ids.charge,f.otherVenue],'23503');
  await refused(f,"UPDATE billing_hosted_days SET covered_by_charge_id=$1 WHERE venue_id=$2",[randomUUID(),f.venue],'23503');
 }finally{await f.close();}
});

test('billing schema rejects malformed numbers dates and states',async()=>{
 const f=await fixture();try{
  await seed(f);
  for(const change of ['anchor_day=0,anchor_date=\'2026-10-01\'','anchor_day=32,anchor_date=\'2026-10-01\'','anchor_day=2,anchor_date=\'2026-10-01\'','anchor_day=1','revision=-1','revision=0.5'])
   await refused(f,`UPDATE billing_businesses SET ${change}`);
  for(const change of ["level='other'","scheduled_level='hosted',scheduled_on='2026-10-01'","scheduled_level='connected'",'revision=-1','revision=0.5'])
   await refused(f,`UPDATE billing_venues SET ${change}`);
  for(const change of ["state='other'","ends_on='2026-09-01'","level='registered'","extended=true,level='hosted'"])
   await refused(f,`UPDATE billing_trials SET ${change}`);
  for(const change of ["state='other'",'revision=-1','revision=0.5'])await refused(f,`UPDATE billing_payment_attempts SET ${change}`);
  for(const [table,patch] of [
   ['billing_prices',{revision:2,connected_monthly_cents:-1}],['billing_prices',{revision:2,hosted_monthly_cents:1.5}],
   ['billing_prices',{revision:2,vat_rate_basis_points:10001}],['billing_prices',{revision:2,connected_monthly_cents:900719925475}],
   ['billing_prices',{revision:2,currency:'USD'}],['billing_charges',{id:randomUUID(),kind:'hosted_comeback',connected_until:null,net_cents:-1}],
   ['billing_charges',{id:randomUUID(),kind:'hosted_comeback',connected_until:null,gross_cents:1210.5}],
   ['billing_charges',{id:randomUUID(),renewal_date:'2026-12-01',connected_until:'2026-11-01'}],
   ['billing_charges',{id:randomUUID(),kind:'hosted_comeback'}],
   ['billing_charges',{id:randomUUID(),kind:'hosted_comeback',connected_until:null,hosted_from:'2026-10-01',hosted_through:'2026-09-01'}],
   ['billing_charge_lines',{kind:'hosted_days',quantity:0}],['billing_charge_lines',{kind:'hosted_days',quantity:0.5}],
   ['billing_charge_lines',{kind:'hosted_days',cents:-1}],['billing_charge_lines',{kind:'hosted_days',cents:1.1}],
  ] as const)await refused(f,`INSERT INTO ${table} SELECT * FROM jsonb_populate_record(NULL::${table},(SELECT to_jsonb(t)||$1::jsonb FROM ${table} t LIMIT 1))`,[patch]);
  await refused(f,"INSERT INTO billing_prices VALUES(2,'2026-02-30','EUR',1000,3000,2100)",[],'22008');
  await refused(f,"INSERT INTO billing_prices VALUES(2,'2026-10-01',NULL,1000,3000,2100)",[],'23502');
 }finally{await f.close();}
});

test('price publication is immutable collision aware and effective dated',async()=>{
 const f=await fixture();try{
  const api=await import(new URL('../src/index.ts',import.meta.url).href);
  assert.equal(typeof api.BillingPriceStore,'function','the country database needs an explicit price publisher');
  const store=new api.BillingPriceStore(f.pool);
  await assert.rejects(store.effective('2026-10-01'),{code:'billing_price_unavailable'});
  await assert.rejects(store.revision(1),{code:'billing_price_unavailable'});
  assert.deepEqual(await store.publish(price),price);
  assert.deepEqual(await Promise.all([store.publish({...price}),store.publish(structuredClone(price))]),[price,price]);
  assert.equal((await f.pool.query('SELECT count(*) FROM billing_prices')).rows[0].count,'1');
  await assert.rejects(store.publish({...price,prices:{...price.prices,hostedMonthlyCents:4000}}),{code:'billing_price_conflict'});
  await assert.rejects(store.publish({...price,revision:2,effectiveFrom:'2026-09-01'}),{code:'billing_price_conflict'});
  await assert.rejects(store.publish({...price,revision:2}),{code:'billing_price_conflict'});
  const future={...price,revision:3,effectiveFrom:'2026-11-01',vatRateBasisPoints:1000};
  assert.deepEqual(await store.publish(future),future);
  assert.deepEqual(await store.effective('2026-10-31'),price);
  assert.deepEqual(await store.effective('2026-11-01'),future);
  assert.deepEqual(await store.revision(1),price);
  await assert.rejects(store.publish({...price,revision:2,effectiveFrom:'2026-12-01'}),{code:'billing_price_conflict'});
  await assert.rejects(store.effective('2026-02-30'),{code:'invalid_billing_input'});
  await assert.rejects(store.revision(0),{code:'invalid_billing_input'});
  await assert.rejects(store.publish({...price,apiKey:'never-persisted'}),{code:'invalid_billing_input'});
  assert.equal((await f.pool.query('SELECT count(*) FROM billing_prices')).rows[0].count,'2');
 }finally{await f.close();}
});
