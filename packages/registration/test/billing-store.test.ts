import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';
import {test} from 'node:test';
import {Pool,type PoolClient} from 'pg';
import {migrate} from '../src/migrate.ts';
import type {BillingEvent,BillingScope,ProviderMethod} from '../src/billing-types.ts';

// These cases catch missing scope locks, replay comparisons, rollback, and method binding checks.
async function fixture(){
 const schema='billing_store_'+randomUUID().replaceAll('-','');
 const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
 const options={connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`,application_name:schema};
 const pool=new Pool(options),second=new Pool(options);
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);
  const scope={organisationId:randomUUID(),legalBusinessId:randomUUID()};
  const other={organisationId:scope.organisationId,legalBusinessId:randomUUID()};
  const foreign={organisationId:randomUUID(),legalBusinessId:randomUUID()};
  await pool.query('INSERT INTO organisations(id) VALUES($1),($2)',[scope.organisationId,foreign.organisationId]);
  await pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2),($3,$2),($4,$5)',[scope.legalBusinessId,scope.organisationId,other.legalBusinessId,foreign.legalBusinessId,foreign.organisationId]);
  const api=await import(new URL('../src/index.ts',import.meta.url).href);
  assert.equal(typeof api.BillingStore,'function','business events need a scoped atomic billing store');
  return {schema,admin,pool,second,scope,other,foreign,store:new api.BillingStore(pool),otherStore:new api.BillingStore(second),
   async close(){await Promise.all([pool.end(),second.end()]);await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}};
 }catch(error){await Promise.all([pool.end(),second.end()]);await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();throw error;}
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
const event=(key=randomUUID()):BillingEvent=>({key,occurredAt:'2026-10-12T09:00:00.000Z',source:{kind:'internal'}});
const method=(suffix=randomUUID()):ProviderMethod=>({id:randomUUID(),kind:'card',provider:'sumup',providerAccountId:'test-account',customerId:'test-customer',methodId:suffix,mandateId:null});
async function snapshot(f:Fixture){
 const tables=['billing_businesses','billing_events','billing_payment_methods','billing_venues','billing_trials','billing_charges','billing_charge_lines','billing_hosted_days','billing_payment_attempts','billing_payment_observations','billing_paid_periods'];
 const rows:Record<string,unknown>={};
 for(const table of tables)rows[table]=(await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
 return rows;
}
async function ensure(f:Fixture,scope:BillingScope=f.scope){return f.store.execute(scope,event(),{type:'ensure_business'});}
async function sqlEvent(f:Fixture,scope:BillingScope,key:string,provider:string|null,account:string|null){
 return f.pool.query(`INSERT INTO billing_events(id,organisation_id,legal_business_id,source,provider,provider_account_id,event_key,occurred_at,command,result)
  VALUES($1,$2,$3,$4,$5,$6,$7,'2026-10-12T09:00:00Z','{}','{}')`,[randomUUID(),scope.organisationId,scope.legalBusinessId,provider?'provider':'internal',provider,account,key]);
}

test('every billing read and command fails closed on unknown or foreign scope',async()=>{
 const f=await fixture();try{
  await ensure(f);
  const before=await snapshot(f);
  const invalid=[{organisationId:randomUUID(),legalBusinessId:f.scope.legalBusinessId},{organisationId:f.foreign.organisationId,legalBusinessId:f.scope.legalBusinessId},{organisationId:f.scope.organisationId,legalBusinessId:randomUUID()}];
  const commands=[{type:'ensure_business'},{type:'set_method',method:method()},{type:'anchor',on:'2026-10-12',mode:'initial',expectedRevision:0}];
  for(const scope of invalid){
   await assert.rejects(f.store.business(scope),{code:'billing_scope_not_found'});
   for(const command of commands)await assert.rejects(f.store.execute(scope,event(),command),{code:'billing_scope_not_found'});
  }
  await assert.rejects(f.store.business(f.other),{code:'billing_scope_not_found'});
  await assert.rejects(f.store.execute(f.other,event(),commands[1]),{code:'billing_scope_not_found'});
  assert.deepEqual(await snapshot(f),before);
  await ensure(f,f.other);await ensure(f,f.foreign);
  assert.deepEqual(await f.store.business(f.other),{...f.other,anchorDay:null,anchorDate:null,revision:0,paymentMethod:null});
  assert.equal((await f.store.business(f.scope)).legalBusinessId,f.scope.legalBusinessId);
 }finally{await f.close();}
});

test('event retry returns the committed receipt after reconnect',async()=>{
 const f=await fixture();try{
  const e=event(),c={type:'ensure_business'};
  const original=await f.store.execute(f.scope,e,c);
  assert.deepEqual(original.value,{...f.scope,anchorDay:null,anchorDate:null,revision:0,paymentMethod:null});assert.match(original.eventId,/^[0-9a-f-]{36}$/);
  await f.store.execute(f.scope,event(),{type:'anchor',on:'2026-10-12',mode:'initial',expectedRevision:0});
  const saved=method(),setEvent=event();
  const set=await f.store.execute(f.scope,setEvent,{type:'set_method',method:saved});
  await f.store.execute(f.scope,event(),{type:'set_method',method:null});
  const before=await snapshot(f);
  assert.deepEqual(await f.otherStore.execute({...f.scope},{source:{kind:'internal'},occurredAt:e.occurredAt,key:e.key},{type:'ensure_business'}),original);
  const reordered={mandateId:saved.mandateId,methodId:saved.methodId,customerId:saved.customerId,providerAccountId:saved.providerAccountId,provider:saved.provider,kind:saved.kind,id:saved.id};
  assert.deepEqual(await f.otherStore.execute(f.scope,setEvent,{method:reordered,type:'set_method'}),set);
  assert.deepEqual(await snapshot(f),before);
 }finally{await f.close();}
});

test('changed event payload refuses without effects',async()=>{
 const f=await fixture();try{
  await ensure(f);const e=event();const saved=method();
  const original=await f.store.execute(f.scope,e,{type:'set_method',method:saved});
  const before=await snapshot(f);
  for(const [changedEvent,command] of [
   [e,{type:'set_method',method:{...saved,customerId:'another-customer'}}],
   [{...e,occurredAt:'2026-10-13T09:00:00.000Z'},{type:'set_method',method:saved}],
   [e,{type:'ensure_business'}],
  ])await assert.rejects(f.store.execute(f.scope,changedEvent,command),{code:'billing_event_conflict'});
  assert.deepEqual(await snapshot(f),before);
  assert.deepEqual(await f.store.execute(f.scope,e,{type:'set_method',method:saved}),original);
 }finally{await f.close();}
});

test('provider events are unique within provider account and cannot cross businesses',async()=>{
 const f=await fixture();try{
  await ensure(f);await ensure(f,f.other);await ensure(f,f.foreign);
  await sqlEvent(f,f.scope,'provider-key','stripe','account-a');
  for(const scope of [f.other,f.foreign])await assert.rejects(sqlEvent(f,scope,'provider-key','stripe','account-a'),{code:'23505'});
  await sqlEvent(f,f.other,'provider-key','stripe','account-b');
  await sqlEvent(f,f.other,'provider-key','sumup','account-a');
  await sqlEvent(f,f.scope,'provider-key',null,null);
  await sqlEvent(f,f.other,'provider-key',null,null);
  await assert.rejects(sqlEvent(f,f.scope,'provider-key',null,null),{code:'23505'});
  const before=await snapshot(f);
  for(const command of [{type:'ensure_business'},{type:'set_method',method:method()},{type:'anchor',mode:'initial',on:'2026-10-12',expectedRevision:0}])
   await assert.rejects(f.store.execute(f.scope,{...event(),source:{kind:'provider',provider:'stripe',accountId:'account-a'}},command),{code:'invalid_billing_input'});
  assert.deepEqual(await snapshot(f),before);
 }finally{await f.close();}
});

test('event insertion and effects roll back together',async()=>{
 const f=await fixture();try{
  await ensure(f);const e=event();const command={type:'set_method',method:method()};
  await f.pool.query("CREATE FUNCTION billing_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'owned_billing_sentinel' USING ERRCODE='P0001'; END $$");
  for(const target of ['business','event']){
   const before=await snapshot(f);
   await f.pool.query(target==='business'?'CREATE TRIGGER billing_test_failure AFTER UPDATE ON billing_businesses FOR EACH ROW EXECUTE FUNCTION billing_test_failure()':'CREATE TRIGGER billing_test_failure BEFORE INSERT ON billing_events FOR EACH ROW EXECUTE FUNCTION billing_test_failure()');
   await assert.rejects(f.store.execute(f.scope,e,command),{code:'P0001',message:'owned_billing_sentinel'});
   assert.deepEqual(await snapshot(f),before);
   await f.pool.query(`DROP TRIGGER billing_test_failure ON billing_${target==='business'?'businesses':'events'}`);
  }
  const result=await f.store.execute(f.scope,e,command);assert.deepEqual(result.value.paymentMethod,command.method);
  assert.equal((await f.pool.query('SELECT count(*) FROM billing_payment_methods')).rows[0].count,'1');
  assert.equal((await f.pool.query('SELECT count(*) FROM billing_events')).rows[0].count,'2');
 }finally{await f.close();}
});

async function anchorWaiters(f:Fixture,blockerPid:number):Promise<number>{
 // A queued tuple waiter can be blocked by another waiter rather than the lock holder.
 const result=await f.admin.query(`WITH RECURSIVE chain(pid) AS (
  VALUES($2::int)
  UNION
  SELECT a.pid FROM pg_stat_activity a JOIN chain b ON b.pid=ANY(pg_blocking_pids(a.pid))
   WHERE a.application_name=$1 AND a.wait_event_type='Lock'
 ) SELECT count(*)::int AS n FROM chain WHERE pid<>$2::int`,[f.schema,blockerPid]);
 return result.rows[0].n;
}

test('concurrent first venues share one anchor and stale comeback refuses',async t=>{
 const f=await fixture();let blocker:PoolClient|undefined;const pending:Promise<unknown>[]=[];
 try{
  await ensure(f);blocker=await f.pool.connect();await blocker.query('BEGIN');
  await blocker.query('SELECT id FROM legal_businesses WHERE id=$1 FOR NO KEY UPDATE',[f.scope.legalBusinessId]);
  const pid=(await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  pending.push(f.store.execute(f.scope,event(),{type:'anchor',on:'2026-10-12',mode:'initial',expectedRevision:0}));
  pending.push(f.otherStore.execute(f.scope,event(),{type:'anchor',on:'2026-10-19',mode:'initial',expectedRevision:0}));
  pending.forEach(p=>void p.catch(()=>{}));
  const deadline=Date.now()+5000;let waiting=0;
  while(Date.now()<deadline){
   waiting=await anchorWaiters(f,pid);
   if(waiting===2)break;await setImmediate();
  }
  const activity=(await f.admin.query('SELECT pid,state,wait_event_type,wait_event,query,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE application_name=$1 ORDER BY pid',[f.schema])).rows;
  t.diagnostic(JSON.stringify({boundary:'billing-anchor-parent-lock',blockerPid:pid,observedWaiters:waiting,activity}));
  assert.equal(waiting,2,'both requests must reach the actual held parent lock');
  const observerPid=(await f.admin.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  assert.equal(await anchorWaiters(f,observerPid),0,'an unrelated connection cannot stand in for the parent lock holder');
  await blocker.query('COMMIT');blocker.release();blocker=undefined;
  const [a,b]=await Promise.all(pending) as Array<{value:Record<string,unknown>}>;
  assert.deepEqual(a!.value,b!.value);assert.equal(a!.value.revision,1);
  assert.ok(a!.value.anchorDay===12||a!.value.anchorDay===19);
  assert.equal(a!.value.anchorDate,`2026-10-${a!.value.anchorDay}`);
  const unchanged=await f.store.execute(f.scope,event(),{type:'anchor',on:'2026-11-01',mode:'initial',expectedRevision:0});assert.deepEqual(unchanged.value,a!.value);
  const comeback=await f.store.execute(f.scope,event(),{type:'anchor',on:'2026-11-03',mode:'comeback',expectedRevision:1});
  assert.deepEqual(comeback.value,{...f.scope,anchorDay:3,anchorDate:'2026-11-03',revision:2,paymentMethod:null});
  const before=await snapshot(f);
  await assert.rejects(f.store.execute(f.scope,event(),{type:'anchor',on:'2026-11-04',mode:'comeback',expectedRevision:1}),{code:'billing_state_conflict'});
  assert.deepEqual(await snapshot(f),before);
 }finally{
  if(blocker){await blocker.query('ROLLBACK');blocker.release();}
  await Promise.allSettled(pending);await f.close();
 }
});

test('method switching retains only opaque references and old history',async()=>{
 const f=await fixture();try{
  const card=method(),debit:ProviderMethod={...method(),provider:'stripe',kind:'direct_debit',mandateId:'test-mandate'};
  const before=await snapshot(f);
  for(const input of [
   {type:'ensure_business',iban:'synthetic-forbidden'},
   {type:'set_method',method:{...card,iban:'synthetic-forbidden'}},
   {type:'set_method',method:{...card,cardNumber:'synthetic-forbidden'}},
   {type:'set_method',method:{...card,apiKey:'synthetic-forbidden'}},
  ])await assert.rejects(f.store.execute(f.scope,event(),input),{code:'invalid_billing_input',message:'invalid_billing_input'});
  assert.deepEqual(await snapshot(f),before);
  await ensure(f);
  assert.deepEqual((await f.store.execute(f.scope,event(),{type:'set_method',method:card})).value.paymentMethod,card);
  assert.deepEqual((await f.store.execute(f.scope,event(),{type:'set_method',method:debit})).value.paymentMethod,debit);
  assert.equal((await f.store.execute(f.scope,event(),{type:'set_method',method:null})).value.paymentMethod,null);
  assert.equal((await f.pool.query('SELECT count(*) FROM billing_payment_methods')).rows[0].count,'2');
  const bound=await snapshot(f);
  await assert.rejects(f.store.execute(f.scope,event(),{type:'set_method',method:{...card,customerId:'changed'}}),{code:'billing_state_conflict'});
  await assert.rejects(f.store.execute(f.scope,event(),{type:'set_method',method:{...card,id:randomUUID()}}),{code:'billing_state_conflict'});
  assert.deepEqual(await snapshot(f),bound);
  await ensure(f,f.other);
  const isolated=await snapshot(f);
  await assert.rejects(f.store.execute(f.other,event(),{type:'set_method',method:card}),{code:'billing_state_conflict'});
  assert.deepEqual(await snapshot(f),isolated);
  assert.deepEqual((await f.store.execute(f.scope,event(),{type:'set_method',method:card})).value.paymentMethod,card);
 }finally{await f.close();}
});

test('billing inputs reject malformed identities dates references and nested fields before effects',async()=>{
 const f=await fixture();try{
  const e=event(),m=method();const before=await snapshot(f);
  for(const [scope,ev,command] of [
   [{...f.scope,organisationId:'unknown'},e,{type:'ensure_business'}],
   [{...f.scope,extra:true},e,{type:'ensure_business'}],
   [f.scope,{...e,key:''},{type:'ensure_business'}],
   [f.scope,{...e,key:'x'.repeat(257)},{type:'ensure_business'}],
   [f.scope,{...e,key:'a\nb'},{type:'ensure_business'}],
   [f.scope,{...e,occurredAt:'2026-02-30T00:00:00.000Z'},{type:'ensure_business'}],
   [f.scope,{...e,occurredAt:'2026-10-12T09:00:00Z'},{type:'ensure_business'}],
   [f.scope,{...e,source:{kind:'internal',apiKey:'synthetic'}},{type:'ensure_business'}],
   [f.scope,e,{type:'anchor',on:'2026-02-30',mode:'initial',expectedRevision:0}],
   [f.scope,e,{type:'anchor',on:'2026-10-12',mode:'other',expectedRevision:0}],
   [f.scope,e,{type:'anchor',on:'2026-10-12',mode:'initial',expectedRevision:0.5}],
   [f.scope,e,{type:'anchor',on:'2026-10-12',mode:'initial',expectedRevision:-1}],
   [f.scope,e,{type:'set_method',method:{...m,mandateId:'must-be-null'}}],
   [f.scope,e,{type:'set_method',method:{...m,kind:'direct_debit',mandateId:'unsupported-provider'}}],
   [f.scope,e,{type:'set_method',method:{...m,provider:'stripe',kind:'direct_debit',mandateId:null}}],
   [f.scope,e,{type:'set_method',method:{...m,methodId:'\u0000'}}],
   [f.scope,e,{type:'set_method',method:{...m,customerId:'x'.repeat(257)}}],
  ])await assert.rejects(f.store.execute(scope,ev,command),{code:'invalid_billing_input',message:'invalid_billing_input'});
  assert.deepEqual(await snapshot(f),before);
 }finally{await f.close();}
});
