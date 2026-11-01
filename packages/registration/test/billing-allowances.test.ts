import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';
import {test} from 'node:test';
import type {Pool,PoolClient} from 'pg';
import type {AllowanceVersion,AllowanceService} from '../src/billing-allowance-rules.ts';
import {transaction} from '../src/transaction.ts';
import {venueServiceFixture,set,event} from './fixtures/venue-service.ts';

// Catch duplicate monthly pots, non-atomic last-unit admission and mutable publication history.
const TEST_ALLOWANCES:AllowanceVersion={revision:1,effectiveFrom:'2020-01-01',limits:{
 registered:{transactional_email:'2',address_lookup:'2',sms:'0',content_translation:'0',rota_solver:'0'},
 connected:{transactional_email:'4',address_lookup:'4',sms:'0',content_translation:'6',rota_solver:'4'},
 hosted:{transactional_email:'6',address_lookup:'6',sms:'0',content_translation:'8',rota_solver:'6'},
},unpaidTrial:{content_translation:'2',rota_solver:'1'}};
type Reservation={id:string;month:string;revision:number;units:string;state:'held'|'spent'|'released'};
type Input={accountId:string;venueId:string;installationId:string;service:AllowanceService;operationId:string;binding:string;units:bigint};
type Config={publish(value:AllowanceVersion):Promise<AllowanceVersion>;effective(month:string):Promise<AllowanceVersion>};
type Api={AllowanceConfigStore:new(pool:Pool)=>Config;reserveAllowance(client:PoolClient,input:Input):Promise<Reservation>;spendAllowance(client:PoolClient,id:string):Promise<Reservation>;releaseUnstartedAllowance(client:PoolClient,id:string):Promise<Reservation>;recordAllowanceAttempt(client:PoolClient,id:string,at:string):Promise<void>};
async function api():Promise<Api>{
 const module=await import(new URL('../src/index.ts',import.meta.url).href);
 for(const name of ['AllowanceConfigStore','reserveAllowance','spendAllowance','releaseUnstartedAllowance','recordAllowanceAttempt'])assert.equal(typeof module[name],'function',name+' must implement durable country allowances');
 return module as unknown as Api;
}
async function fixture(){
 const methods=await api(),f=await venueServiceFixture();
 try{
  const accountId=randomUUID(),otherAccount=randomUUID(),foreignAccount=randomUUID();
  for(const [id,org] of [[accountId,f.scope.organisationId],[otherAccount,f.scope.organisationId],[foreignAccount,f.foreign.organisationId]]){
   await f.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[id]);
   await f.pool.query("INSERT INTO cloud_credentials(account_id,email,email_verified_at) VALUES($1,$2,clock_timestamp())",[id,id+'@allowance.invalid']);
   await f.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner) VALUES($1,$2,true)',[id,org]);
  }
  const config=new methods.AllowanceConfigStore(f.pool);
  const installation=async(venueId:string)=>(await f.pool.query('SELECT id FROM installations WHERE venue_id=$1 AND revoked_at IS NULL',[venueId])).rows[0].id as string;
  const input:Input={accountId,venueId:f.venues[0]!,installationId:await installation(f.venues[0]!),service:'transactional_email',operationId:randomUUID(),binding:'fixed-request-body',units:1n};
  return {...f,methods,config,accountId,otherAccount,foreignAccount,input,installation,
   reserve(value:Partial<Input>={},pool=f.pool){return transaction(pool,client=>methods.reserveAllowance(client,{...input,...value}));},
   spend(id:string){return transaction(f.pool,client=>methods.spendAllowance(client,id));},
   async total(where='true',args:unknown[]=[]){return BigInt((await f.pool.query(`SELECT coalesce(sum(units),0)::text AS total FROM billing_allowance_reservations WHERE state IN ('held','spent') AND ${where}`,args)).rows[0].total);}};
 }catch(error){await f.close();throw error;}
}

test('allowance publication has no implicit version and preserves immutable effective revisions',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.config.effective('2020-01-01'),{code:'allowance_unavailable'});
  assert.deepEqual(await f.config.publish(TEST_ALLOWANCES),TEST_ALLOWANCES);
  assert.deepEqual(await new f.methods.AllowanceConfigStore(f.peer).publish(structuredClone(TEST_ALLOWANCES)),TEST_ALLOWANCES);
  await assert.rejects(f.config.publish({...TEST_ALLOWANCES,limits:{...TEST_ALLOWANCES.limits,registered:{...TEST_ALLOWANCES.limits.registered,transactional_email:'3'}}}),{code:'allowance_conflict'});
  const future={...TEST_ALLOWANCES,revision:2,effectiveFrom:'2090-01-01'};
  assert.deepEqual(await f.config.publish(future),future);
  assert.deepEqual(await f.config.effective('2089-12-01'),TEST_ALLOWANCES);
  assert.deepEqual(await f.config.effective('2090-01-01'),future);
  await assert.rejects(f.config.publish({...TEST_ALLOWANCES,revision:3,effectiveFrom:'2089-01-01'}),{code:'allowance_conflict'});
  assert.equal((await f.pool.query('SELECT count(*) FROM billing_allowance_versions')).rows[0].count,'2');
  for(const sql of ['DELETE FROM billing_allowance_versions','UPDATE billing_allowance_versions SET revision=revision+10'])await assert.rejects(f.pool.query(sql),{code:'55000'});
 }finally{await f.close();}
});

test('missing allowance configuration and transaction refuse without reservation effects',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.reserve(),{code:'allowance_unavailable'});
  await f.config.publish(TEST_ALLOWANCES);const client=await f.pool.connect();
  try{await assert.rejects(f.methods.reserveAllowance(client,f.input),{code:'invalid_allowance_input'});}finally{client.release();}
  assert.equal(await f.total(),0n);assert.equal((await f.pool.query('SELECT count(*) FROM billing_allowance_reservations')).rows[0].count,'0');
 }finally{await f.close();}
});

test('one account last unit is atomic across venues',async()=>{
 const f=await fixture();let blocker:PoolClient|undefined;
 try{
  await f.config.publish(TEST_ALLOWANCES);await f.spend((await f.reserve()).id);
  const peerVenue=f.venues[1]!,peerInstallation=await f.installation(peerVenue);
  blocker=await f.pool.connect();await blocker.query('BEGIN');
  await blocker.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext('allowance-test-insert-gate'))");
  const pid=Number((await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
  await f.pool.query("CREATE FUNCTION allowance_insert_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(hashtext(current_schema()),hashtext('allowance-test-insert-gate')); RETURN NEW; END $$");
  await f.pool.query('CREATE TRIGGER allowance_insert_gate BEFORE INSERT ON billing_allowance_reservations FOR EACH ROW EXECUTE FUNCTION allowance_insert_gate()');
  const a=f.reserve({operationId:randomUUID()}),b=f.reserve({operationId:randomUUID(),venueId:peerVenue,installationId:peerInstallation},f.peer);
  const results=Promise.allSettled([a,b]);
  try{
   const until=performance.now()+5000;let waiting=0;
   do{
    const result=await f.admin.query(`WITH RECURSIVE chain(pid) AS (SELECT $1::int UNION SELECT a.pid FROM pg_stat_activity a JOIN chain c ON c.pid=ANY(pg_blocking_pids(a.pid))) SELECT count(*)::int AS n FROM chain WHERE pid<>$1`,[pid]);
    waiting=result.rows[0].n;if(waiting<2)await setImmediate();
   }while(waiting<2&&performance.now()<until);
   assert.equal(waiting,2,'both admissions must reach the held database barrier');
  }finally{await blocker.query('ROLLBACK');}
  const settled=await results,admitted=settled.filter(x=>x.status==='fulfilled').length,refused=settled.filter(x=>x.status==='rejected').length;
  for(const result of settled)if(result.status==='rejected')assert.equal(result.reason.code,'allowance_exhausted');
  const accountUsed=await f.total('account_id=$1',[f.accountId]);assert.deepEqual([admitted,refused,accountUsed],[1,1,2n]);
  assert.equal((await f.pool.query('SELECT count(*) FROM billing_allowance_reservations')).rows[0].count,'2');
  assert.equal(await f.total('account_id=$1',[f.otherAccount]),0n);
 }finally{if(blocker){await blocker.query('ROLLBACK');blocker.release();}await f.close();}
});

test('foreign owners crossed installations and lost current ownership refuse without writes',async()=>{
 const f=await fixture();try{
  await f.config.publish(TEST_ALLOWANCES);
  for(const changed of [{accountId:f.foreignAccount},{venueId:f.foreignVenue},{venueId:f.otherVenue},{installationId:await f.installation(f.venues[1]!)}])await assert.rejects(f.reserve(changed),{code:'allowance_scope_not_found'});
  await f.pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',[f.accountId]);
  await assert.rejects(f.reserve(),{code:'allowance_scope_not_found'});
  await f.pool.query('UPDATE organisation_memberships SET is_owner=true WHERE account_id=$1',[f.accountId]);
  await f.pool.query('UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1',[f.accountId]);
  await assert.rejects(f.reserve(),{code:'allowance_scope_not_found'});
  assert.equal(await f.total(),0n);assert.equal((await f.pool.query('SELECT count(*) FROM billing_allowance_reservations')).rows[0].count,'0');
 }finally{await f.close();}
});

test('reservation replay retains its original receipt and refuses changed immutable binding',async()=>{
 const f=await fixture();try{
  await f.config.publish(TEST_ALLOWANCES);const saved=await f.reserve();
  assert.deepEqual(await f.reserve({},f.peer),saved);
  for(const changed of [{accountId:f.otherAccount},{venueId:f.venues[1]!,installationId:await f.installation(f.venues[1]!)},{binding:'changed-body'},{units:2n}])await assert.rejects(f.reserve(changed),{code:'allowance_conflict'});
  assert.deepEqual(await f.reserve({},f.peer),saved);assert.equal(await f.total(),1n);
  const separate=await f.reserve({service:'address_lookup'});assert.notEqual(separate.id,saved.id);assert.equal(await f.total('service=$1',['address_lookup']),1n);
 }finally{await f.close();}
});

test('level transitions select a ceiling over one reservation history',async()=>{
 const f=await fixture();try{
  await f.config.publish(TEST_ALLOWANCES);await f.spend((await f.reserve()).id);await f.spend((await f.reserve({operationId:randomUUID()})).id);
  await assert.rejects(f.reserve({operationId:randomUUID()}),{code:'allowance_exhausted'});
  await set(f,'connected');assert.equal(await f.total('venue_id=$1',[f.input.venueId]),2n);
  const third=await f.reserve({operationId:randomUUID()});assert.equal(third.units,'1');
  await set(f,'registered');await assert.rejects(f.reserve({operationId:randomUUID()}),{code:'allowance_exhausted'});
  assert.equal(await f.total('account_id=$1',[f.accountId]),3n);
  const other=await f.reserve({operationId:randomUUID(),accountId:f.otherAccount});assert.equal(other.units,'1');
  assert.equal(await f.total('account_id=$1',[f.otherAccount]),1n);
 }finally{await f.close();}
});

test('current trial and method facts change translation limits without refilling held units',async()=>{
 const f=await fixture();try{
  await f.config.publish(TEST_ALLOWANCES);
  await f.store.transition(f.scope,event(),{type:'start_trial',venueId:f.input.venueId,level:'connected',on:f.today});
  const held=await f.reserve({service:'content_translation',units:2n});assert.equal(held.state,'held');
  await assert.rejects(f.reserve({service:'content_translation',units:1n,operationId:randomUUID()}),{code:'allowance_exhausted'});
  await f.store.execute(f.scope,event(),{type:'set_method',method:{id:randomUUID(),kind:'card',provider:'sumup',providerAccountId:'synthetic',customerId:'synthetic',methodId:'synthetic',mandateId:null}});
  const extra=await f.reserve({service:'content_translation',units:4n,operationId:randomUUID()});assert.equal(extra.units,'4');
  await f.store.execute(f.scope,event(),{type:'set_method',method:null});
  await assert.rejects(f.reserve({service:'content_translation',units:1n,operationId:randomUUID()}),{code:'allowance_exhausted'});
  assert.equal(await f.total('service=$1',['content_translation']),6n);
 }finally{await f.close();}
});

test('reservation insertion failure rolls back service effects and its monthly debit together',async()=>{
 const f=await fixture();try{
  await f.config.publish(TEST_ALLOWANCES);
  await f.pool.query("CREATE FUNCTION allowance_insert_refusal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic-allowance-insert' USING ERRCODE='P0001'; END $$");
  await f.pool.query('CREATE TRIGGER allowance_insert_refusal BEFORE INSERT ON billing_allowance_reservations FOR EACH ROW EXECUTE FUNCTION allowance_insert_refusal()');
  await assert.rejects(transaction(f.pool,async client=>{
   await client.query("UPDATE organisations SET name='must roll back' WHERE id=$1",[f.scope.organisationId]);
   return f.methods.reserveAllowance(client,f.input);
  }),{code:'P0001',message:'synthetic-allowance-insert'});
  assert.equal((await f.pool.query('SELECT name FROM organisations WHERE id=$1',[f.scope.organisationId])).rows[0].name,null);
  assert.equal(await f.total(),0n);
  await f.pool.query('DROP TRIGGER allowance_insert_refusal ON billing_allowance_reservations');
  assert.equal((await f.reserve()).units,'1');assert.equal(await f.total(),1n);
 }finally{await f.close();}
});
