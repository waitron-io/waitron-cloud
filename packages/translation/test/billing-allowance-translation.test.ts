import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';
import {test} from 'node:test';
import {AllowanceConfigStore,BillingStore,createLeaseIssuer} from '@waitron-cloud/registration';
import type {AllowanceVersion} from '../../registration/src/billing-allowance-rules.ts';
import {connectedVenue,database,giveConsent,readyForTranslation} from './fixtures.ts';

const origin='https://cloud.example.test',options={mode:'test',calendar:'UTC'} as const;
const TEST_ALLOWANCES:AllowanceVersion={revision:1,effectiveFrom:'2020-01-01',limits:{
 registered:{transactional_email:'2',address_lookup:'2',sms:'0',content_translation:'0',rota_solver:'0'},
 connected:{transactional_email:'4',address_lookup:'4',sms:'0',content_translation:'6',rota_solver:'4'},
 hosted:{transactional_email:'6',address_lookup:'6',sms:'0',content_translation:'8',rota_solver:'6'},
},unpaidTrial:{content_translation:'2',rota_solver:'1'}};
const body=(count:number)=>JSON.stringify({version:1,country:'ES',languages:{default:'es',enabled:['es','en']},
 items:Array.from({length:count},(_,i)=>({ref:'product:'+i,kind:'product',family:'product:'+i,category:'TAPAS',staffName:'GILDAS',existing:{},missing:['es','en']})),houseStyle:[]});
const event=()=>({key:randomUUID(),occurredAt:new Date().toISOString(),source:{kind:'internal' as const}});
async function fixture(input:{configured?:boolean;trial?:boolean;allowances?:unknown;mode?:string;limit?:string}={}){
 const {configured=true,trial=true,mode='test-venue-levels',limit='6'}=input;
 const allowances=Object.hasOwn(input,'allowances')?input.allowances:options;
 const db=await database();try{
  const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
  const v=await connectedVenue(db,issuer,origin),store=new BillingStore(db.pool),scope={organisationId:v.organisationId,legalBusinessId:v.legalBusinessId};
  await store.execute(scope,event(),{type:'ensure_business'});
  const transition=mode==='test-free-paid'?store.execute.bind(store):store.transition.bind(store);
  if(trial)await transition(scope,event(),{type:'start_trial',venueId:v.venueId,level:'connected',on:new Date().toISOString().slice(0,10)});
  else await transition(scope,event(),{type:'set_venue',venueId:v.venueId,expectedRevision:0,value:{level:'connected',connectedFrom:null,lapsedOn:null,scheduledLevel:null,scheduledOn:null}});
  await readyForTranslation(db,v);await giveConsent(db,v);
  if(configured){const config=structuredClone(TEST_ALLOWANCES);config.limits.connected.content_translation=limit;await new AllowanceConfigStore(db.pool).publish(config);}
  const api=await import(new URL('../src/index.ts',import.meta.url).href);
  const machine=new api.TranslationMachine(db.secondPool,issuer,origin,undefined,undefined,mode,allowances);
  const submit=(count:number,operationId=randomUUID(),text=body(count)):Promise<Record<string,unknown>>=>{
   const envelope=v.submit(text,operationId);
   return machine.execute('translation-submit',{payload:envelope.payload,signature:envelope.signature},text);
  };
  const rows=async()=>(await db.pool.query('SELECT *,month::text FROM billing_allowance_reservations ORDER BY id')).rows;
  const total=async()=>BigInt((await db.pool.query("SELECT coalesce(sum(units),0)::text AS used FROM billing_allowance_reservations WHERE state IN ('held','spent')")).rows[0].used);
  return {db,v,issuer,store,scope,machine,submit,rows,total};
 }catch(error){await db.close();throw error;}
}

// Removing durable admission must leave the queue and retained debit assertions wrong.
test('translation allowance refuses three trial items with an exact two-item fit',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.submit(3),{code:'limit_reached',fits:2});
  assert.equal((await f.db.pool.query('SELECT count(*) FROM translation_jobs')).rows[0].count,'0');assert.equal(await f.total(),0n);
  const reply=await f.submit(2);assert.equal(reply.state,'queued');assert.equal(await f.total(),2n);
  const [saved]=await f.rows();assert.equal(saved.account_id,f.v.accountId);assert.equal(saved.service,'content_translation');
  assert.equal(saved.venue_id,f.v.venueId);assert.equal(saved.installation_id,f.v.installationId);assert.equal(saved.units,'2');assert.equal(saved.state,'held');assert.equal(saved.attempted_at,null);
 }finally{await f.db.close();}
});

test('translation admission has no implicit allowance configuration',async()=>{
 const f=await fixture({configured:false});try{
  await assert.rejects(f.submit(1),{code:'allowance_unavailable'});
  assert.equal((await f.db.pool.query('SELECT count(*) FROM translation_jobs')).rows[0].count,'0');assert.deepEqual(await f.rows(),[]);
 }finally{await f.db.close();}
});

for(const failingTable of ['billing_allowance_reservations','translation_jobs','translation_job_bodies'])test('translation debit and job roll back together on '+failingTable+' failure',async()=>{
 const f=await fixture();try{
  await f.db.pool.query("CREATE FUNCTION refuse_allowance_admission() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic-admission-refusal' USING ERRCODE='P0001'; END $$");
  await f.db.pool.query(`CREATE TRIGGER refuse_allowance_admission BEFORE INSERT ON ${failingTable} FOR EACH ROW EXECUTE FUNCTION refuse_allowance_admission()`);
  await assert.rejects(f.submit(2),/synthetic-admission-refusal/);
  assert.deepEqual(await f.rows(),[]);assert.equal((await f.db.pool.query('SELECT count(*) FROM translation_jobs')).rows[0].count,'0');
  assert.equal((await f.db.pool.query('SELECT count(*) FROM translation_job_bodies')).rows[0].count,'0');
 }finally{await f.db.close();}
});

test('translation replay retains the first consent actor and debit after consent replacement and disablement',async()=>{
 const f=await fixture();try{
  const operationId=randomUUID(),reply=await f.submit(2,operationId),saved=await f.rows();assert.equal(saved.length,1);
  const other=randomUUID();await f.db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[other]);
  await f.db.pool.query('INSERT INTO cloud_credentials(account_id,email,email_verified_at) VALUES($1,$2,clock_timestamp())',[other,other+'@allowance.invalid']);
  await f.db.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner) VALUES($1,$2,true)',[other,f.v.organisationId]);
  await f.db.pool.query('UPDATE translation_consents SET withdrawn_at=clock_timestamp() WHERE venue_id=$1',[f.v.venueId]);
  await giveConsent(f.db,{...f.v,accountId:other});
  await f.db.pool.query('UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1',[f.v.accountId]);
  await assert.doesNotReject(async()=>assert.deepEqual(await f.submit(2,operationId),reply));assert.deepEqual(await f.rows(),saved);assert.equal(await f.total(),2n);
  await assert.rejects(f.submit(3,operationId),{code:'conflict'});assert.deepEqual(await f.rows(),saved);
 }finally{await f.db.close();}
});

test('concurrent authenticated retries create one job and one original allowance debit',async()=>{
 const f=await fixture();try{
  const operationId=randomUUID(),replies=await Promise.all([f.submit(2,operationId),f.submit(2,operationId)]);
  assert.deepEqual(replies[0],replies[1]);assert.equal((await f.rows()).length,1);assert.equal(await f.total(),2n);
  assert.equal((await f.db.pool.query('SELECT count(*) FROM translation_jobs')).rows[0].count,'1');
  assert.equal((await f.db.pool.query('SELECT count(*) FROM translation_job_bodies')).rows[0].count,'1');
 }finally{await f.db.close();}
});

test('a disappeared replay cannot create replacement work without its original admission',async()=>{
 const f=await fixture(),holder=await f.db.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  const operationId=randomUUID(),reply=await f.submit(2,operationId),saved=await f.rows();
  await holder.query('BEGIN');await holder.query("SELECT pg_advisory_xact_lock(hashtextextended('translation-venue:'||$1,0))",[f.v.venueId]);
  const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;let settled=false;
  pending=f.submit(2,operationId).finally(()=>{settled=true;});void pending.catch(()=>{});
  const until=performance.now()+5000;let waiting=false;
  while(performance.now()<until&&!settled){
   waiting=!!(await f.db.pool.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))',[f.db.schema,pid])).rowCount;
   if(waiting)break;await setImmediate();
  }
  assert.equal(waiting,true,'replay must reach the captured venue admission lock');
  await holder.query('DELETE FROM translation_job_bodies WHERE job_id=$1',[reply.jobId]);
  await holder.query('DELETE FROM translation_jobs WHERE id=$1',[reply.jobId]);
  await holder.query('COMMIT');await assert.rejects(pending,{code:'consent_required'});
  assert.deepEqual(await f.rows(),saved);assert.equal((await f.db.pool.query('SELECT count(*) FROM translation_jobs')).rows[0].count,'0');
 }finally{await holder.query('ROLLBACK');await pending?.catch(()=>{});holder.release();await f.db.close();}
});

test('translation payment-method addition expands the ceiling over the existing trial debit',async()=>{
 const f=await fixture();try{
  const first=await f.submit(2);await f.db.pool.query("UPDATE translation_jobs SET state='done',finished_at=clock_timestamp() WHERE id=$1",[first.jobId]);
  await assert.rejects(f.submit(1),{code:'limit_reached',fits:0});assert.equal(await f.total(),2n);
  await f.store.execute(f.scope,event(),{type:'set_method',method:{id:randomUUID(),kind:'card',provider:'sumup',providerAccountId:'synthetic',customerId:'synthetic',methodId:'synthetic',mandateId:null}});
  await assert.rejects(f.submit(5),{code:'limit_reached',fits:4});assert.equal(await f.total(),2n);
  const second=await f.submit(4);assert.equal(await f.total(),6n);
  await f.db.pool.query("UPDATE translation_jobs SET state='done',finished_at=clock_timestamp() WHERE id=$1",[second.jobId]);
  await f.store.execute(f.scope,event(),{type:'set_method',method:null});await assert.rejects(f.submit(1),{code:'limit_reached',fits:0});assert.equal(await f.total(),6n);
 }finally{await f.db.close();}
});

test('translation allowance and the original exact-fit money cap remain independent',async()=>{
 const f=await fixture({trial:false,limit:'100'});try{
  await f.db.pool.query(`INSERT INTO translation_jobs(id,installation_id,venue_id,operation_id,job_sha256,job_bytes,state,total,provider,model,prompt_version,cost_micro_usd,finished_at)
   VALUES($1,$2,$3,$4,$5,1,'done',1,'openai','gpt-6-luna','translate-all-v1',4998978,clock_timestamp())`,[randomUUID(),f.v.installationId,f.v.venueId,randomUUID(),'c'.repeat(64)]);
  await assert.rejects(f.submit(8),{code:'limit_reached',fits:7});assert.equal(await f.total(),0n);
  const reply=await f.submit(7);assert.equal(reply.total,7);assert.equal(await f.total(),7n);
  assert.equal((await f.db.pool.query('SELECT monthly_cap_micro_usd::text AS cap FROM translation_policy')).rows[0].cap,'5000000');
 }finally{await f.db.close();}
});

for(const mode of ['existing','test-free-paid','test-venue-levels'])test('absent allowances preserve '+mode+' without reservation rows',async()=>{
 const f=await fixture({allowances:undefined,mode});try{
  if(mode==='test-free-paid')await f.db.pool.query("UPDATE organisations SET service_plan='paid' WHERE id=$1",[f.v.organisationId]);
  assert.equal((await f.submit(3)).state,'queued');assert.deepEqual(await f.rows(),[]);
 }finally{await f.db.close();}
});

for(const change of ['withdrawn','replaced'] as const)test('translation admission refuses consent '+change+' while waiting for its exact authority',async()=>{
 const f=await fixture(),holder=await f.db.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  await holder.query('BEGIN');await holder.query("SELECT pg_advisory_xact_lock(hashtextextended('translation-consent:'||$1,0))",[f.v.venueId]);
  const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;let settled=false;
  pending=f.submit(2).finally(()=>{settled=true;});void pending.catch(()=>{});
  const until=performance.now()+5000;let waiting=false;
  while(performance.now()<until&&!settled){
   waiting=!!(await f.db.pool.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))',[f.db.schema,pid])).rowCount;
   if(waiting)break;await setImmediate();
  }
  assert.equal(waiting,true,'service admission must wait for the exact consent lock');
  await holder.query('UPDATE translation_consents SET withdrawn_at=clock_timestamp() WHERE venue_id=$1',[f.v.venueId]);
  if(change==='replaced')await holder.query(`INSERT INTO translation_consents(id,venue_id,organisation_id,account_id,consent_version,providers)
   VALUES($1,$2,$3,$4,'providers-2026-10-14',ARRAY['openai','anthropic','google'])`,[randomUUID(),f.v.venueId,f.v.organisationId,f.v.accountId]);
  await holder.query('COMMIT');await assert.rejects(pending,{code:'consent_required'});assert.deepEqual(await f.rows(),[]);
  assert.equal((await f.db.pool.query('SELECT count(*) FROM translation_jobs')).rows[0].count,'0');
 }finally{await holder.query('ROLLBACK');await pending?.catch(()=>{});holder.release();await f.db.close();}
});
