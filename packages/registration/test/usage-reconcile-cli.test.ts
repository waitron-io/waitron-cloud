import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {after,before,beforeEach,test} from 'node:test';
import {Pool} from 'pg';
import {migrate} from '../src/migrate.ts';
import {UsageReconciler,type UsageReconciliationResult} from '../src/usage-metering.ts';
import {operationsStatus} from '../../operations/src/status.ts';

const url=process.env.TEST_DATABASE_URL;
if(!url)throw Error('Run through scripts/test-postgres.mjs');
const schema=`usage_cli_${randomUUID().replaceAll('-','')}`;
const admin=new Pool({connectionString:url});
const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`,statement_timeout:10000});
const connection=new URL(url);connection.searchParams.set('options',`-c search_path=${schema}`);
const first={organisation:randomUUID(),business:randomUUID(),venue:randomUUID(),installation:randomUUID()};
const second={organisation:randomUUID(),business:randomUUID(),venue:randomUUID(),installation:randomUUID()};
const children=new Set<ReturnType<typeof worker>>();
before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
after(async()=>{
 for(const child of children){child.process.kill('SIGKILL');await child.exited;}
 await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();
});
beforeEach(async()=>{
 await pool.query('TRUNCATE organisations CASCADE');
 await pool.query('UPDATE usage_reconciliation_sources SET last_attempted_at=NULL,caught_up_at=NULL');
 for(const item of [first,second]){
  await pool.query('INSERT INTO organisations(id) VALUES($1)',[item.organisation]);
  await pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[item.business,item.organisation]);
  await pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,'test')",[item.venue,item.organisation,item.business,randomUUID()]);
  await pool.query('INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,$3)',[item.installation,item.venue,`key:${item.installation}`]);
 }
});
function worker(args=['--watch'],env:Record<string,string|undefined>={}){
 const process=spawn(globalThis.process.execPath,['src/usage-reconcile-cli.ts',...args],{
  env:{...globalThis.process.env,DATABASE_URL:connection.href,CLOUD_USAGE_INTERVAL_MS:'1000',CLOUD_USAGE_BATCH_SIZE:'1',...env},stdio:['ignore','pipe','pipe'],
 });
 let stdout='',stderr='';
 process.stdout.on('data',chunk=>{stdout+=chunk;});process.stderr.on('data',chunk=>{stderr+=chunk;});
 const exited=new Promise<{code:number|null;signal:string|null}>((resolve,reject)=>{process.once('error',reject);process.once('exit',(code,signal)=>resolve({code,signal}));});
 const result={process,exited,output:()=>stdout,error:()=>stderr,passes:()=>stdout.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line) as UsageReconciliationResult)};
 children.add(result);void exited.then(()=>children.delete(result));return result;
}
async function until(check:()=>Promise<boolean>|boolean,child?:ReturnType<typeof worker>,timeout=8000){
 const end=Date.now()+timeout;
 while(Date.now()<end){if(await check())return;if(child&&child.process.exitCode!==null)assert.fail(`worker exited ${child.process.exitCode}: ${child.error()}`);await delay(25);}
 assert.fail('condition did not become true before deadline');
}
async function stop(child:ReturnType<typeof worker>){
 child.process.kill('SIGTERM');
 const timer=setTimeout(()=>child.process.kill('SIGKILL'),12000);
 try{assert.deepEqual(await child.exited,{code:0,signal:null});}finally{clearTimeout(timer);}
}
async function seed(installation=first.installation){await pool.query("INSERT INTO installation_operations(installation_id,operation_id,digest,result) VALUES($1,$2,'digest','{}')",[installation,randomUUID()]);}
async function count(){return Number((await pool.query('SELECT count(*) FROM usage_events')).rows[0].count);}
async function status(){return (await operationsStatus(pool,{controlApiUrl:'http://127.0.0.1:1',reconciliationStaleSeconds:1,probeTimeoutMs:50})).components.usage;}

test('watch bounds each pass, catches up two tenants, suppresses duplicates and stops idle promptly',async()=>{
 await seed();await seed();await seed(second.installation);
 const a=worker(),b=worker();
 try{
  await until(async()=>await count()===3&&a.passes().length>=2&&b.passes().length>=2,a);
  await until(async()=>(await status()).code==='current',a);
  assert.ok([...a.passes(),...b.passes()].every(pass=>Object.values(pass.sources).every(source=>source.recorded<=1)));
  assert.deepEqual((await pool.query('SELECT organisation_id,venue_id,count(*)::integer AS n FROM usage_events GROUP BY organisation_id,venue_id ORDER BY n DESC')).rows,[
   {organisation_id:first.organisation,venue_id:first.venue,n:2},{organisation_id:second.organisation,venue_id:second.venue,n:1},
  ]);
  const before=await count();const passes=a.passes().length;await until(()=>a.passes().length>passes,a);assert.equal(await count(),before);
 }finally{await stop(a);await stop(b);}
 const state=await new UsageReconciler(pool).status();await delay(1100);
 assert.deepEqual(await new UsageReconciler(pool).status(),state);assert.equal((await status()).code,'stale');
});

test('watch backs off on lock contention and only advances after the lock is released',async()=>{
 const lock=await pool.connect();await lock.query('BEGIN');
 await lock.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext('cloud_usage_reconciliation'))");
 await seed();const child=worker();
 try{
  await until(()=>child.passes().length===1,child);assert.deepEqual(child.passes()[0],{acquired:false,sources:{}});
  await delay(300);assert.equal(child.passes().length,1);assert.equal(await count(),0);
  await lock.query('ROLLBACK');
  await until(async()=>await count()===1,child);
 }finally{await lock.query('ROLLBACK');lock.release();await stop(child);}
});

test('failed passes roll back earlier source writes, become stale and retry without leaking errors',async()=>{
 await new UsageReconciler(pool).runOnce();await seed();
 await pool.query("CREATE FUNCTION usage_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source='service_alerts' THEN RAISE EXCEPTION 'private-fixture-value'; END IF; RETURN NEW; END $$");
 await pool.query('CREATE TRIGGER usage_fail BEFORE UPDATE ON usage_reconciliation_sources FOR EACH ROW EXECUTE FUNCTION usage_fail()');
 const child=worker();
 try{
  await until(()=>child.error().includes('retrying'),child);
  assert.equal(await count(),0);assert.doesNotMatch(child.error(),/private-fixture-value|postgres:\/\//);
  const failures=child.error();await delay(300);assert.equal(child.error(),failures);
  await until(async()=>(await status()).code==='stale',child);
  await pool.query('DROP TRIGGER usage_fail ON usage_reconciliation_sources');
  await until(async()=>await count()===1&&(await status()).code==='current',child);
 }finally{await pool.query('DROP TRIGGER IF EXISTS usage_fail ON usage_reconciliation_sources');await pool.query('DROP FUNCTION usage_fail()');await stop(child);}
});

async function blockLastSource(){
 const lock=await pool.connect();await lock.query('BEGIN');await lock.query("SELECT * FROM usage_reconciliation_sources WHERE source='service_alerts' FOR UPDATE");return lock;
}
async function blocked(){return Number((await admin.query("SELECT count(*) FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[schema])).rows[0].count)>0;}

test('a killed pass rolls back and restart catches up without duplicate events',async()=>{
 await seed();const lock=await blockLastSource();const child=worker(['--watch'],{PGAPPNAME:schema});
 try{
  await until(blocked,child);assert.equal(await count(),0);child.process.kill('SIGKILL');assert.equal((await child.exited).signal,'SIGKILL');
 }finally{await lock.query('ROLLBACK');lock.release();}
 assert.equal(await count(),0);assert.ok((await new UsageReconciler(pool).status()).sources.every(item=>item.caughtUpAt===null));
 const restarted=worker();try{await until(async()=>await count()===1&&(await status()).code==='current',restarted);}finally{await stop(restarted);}
 await seed(second.installation);
 const next=worker();try{await until(async()=>await count()===2,next);}finally{await stop(next);}
});

test('SIGTERM lets the active pass commit but starts no further pass',async()=>{
 await seed();const lock=await blockLastSource();const child=worker(['--watch'],{PGAPPNAME:schema});
 try{
  await until(blocked,child);child.process.kill('SIGTERM');await delay(100);assert.equal(child.process.exitCode,null);
 }finally{await lock.query('ROLLBACK');lock.release();}
 const timer=setTimeout(()=>child.process.kill('SIGKILL'),12000);
 try{assert.deepEqual(await child.exited,{code:0,signal:null});}finally{clearTimeout(timer);}
 assert.equal(await count(),1);assert.equal(child.passes().length,1);
});

test('a blocked transaction times out and shutdown releases the worker',async()=>{
 await seed();const lock=await blockLastSource();const child=worker(['--watch'],{PGAPPNAME:schema});
 try{
  await until(blocked,child);child.process.kill('SIGTERM');
  const timer=setTimeout(()=>child.process.kill('SIGKILL'),12000);
  try{assert.deepEqual(await child.exited,{code:0,signal:null});}finally{clearTimeout(timer);}
  assert.equal(await count(),0);assert.match(child.error(),/retrying/);
 }finally{await lock.query('ROLLBACK');lock.release();}
});

test('one-shot and status retain their JSON interfaces',async()=>{
 await seed();const once=worker(['--once']);assert.deepEqual(await once.exited,{code:0,signal:null});assert.equal(once.passes()[0]?.acquired,true);assert.equal(await count(),1);
 const read=worker(['--status']);assert.deepEqual(await read.exited,{code:0,signal:null});assert.equal(JSON.parse(read.output()).sources.length,4);
});

test('watch rejects invalid or unbounded settings before recording a pass',async()=>{
 for(const env of [{CLOUD_USAGE_INTERVAL_MS:'0'},{CLOUD_USAGE_INTERVAL_MS:'999'},{CLOUD_USAGE_INTERVAL_MS:'240001'},{CLOUD_USAGE_INTERVAL_MS:''},{CLOUD_USAGE_INTERVAL_MS:'NaN'},{CLOUD_USAGE_BATCH_SIZE:'0'},{CLOUD_USAGE_BATCH_SIZE:'1001'},{CLOUD_USAGE_BATCH_SIZE:'1.5'}]){
  const child=worker(['--watch'],env);assert.deepEqual(await child.exited,{code:1,signal:null});assert.equal(child.output(),'');assert.doesNotMatch(child.error(),/postgres:\/\//);
 }
 assert.ok((await new UsageReconciler(pool).status()).sources.every(item=>item.lastAttemptedAt===null));
});

test('the transaction deadline covers cumulative statements, each shorter than the statement timeout',async()=>{
 await seed();
 await pool.query("CREATE FUNCTION usage_slow() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source IN ('backup_points','backup_recoveries') THEN PERFORM pg_sleep(6); END IF; RETURN NEW; END $$");
 await pool.query('CREATE TRIGGER usage_slow BEFORE UPDATE ON usage_reconciliation_sources FOR EACH ROW EXECUTE FUNCTION usage_slow()');
 const child=worker(['--watch'],{PGAPPNAME:schema});
 try{
  await until(async()=>Number((await admin.query("SELECT count(*) FROM pg_stat_activity WHERE application_name=$1 AND wait_event='PgSleep'",[schema])).rows[0].count)>0,child);
  child.process.kill('SIGTERM');
  const timer=setTimeout(()=>child.process.kill('SIGKILL'),15000);
  try{assert.deepEqual(await child.exited,{code:0,signal:null});}finally{clearTimeout(timer);}
  assert.equal(await count(),0);assert.equal(child.output(),'');assert.match(child.error(),/retrying/);
 }finally{await pool.query('DROP TRIGGER usage_slow ON usage_reconciliation_sources');await pool.query('DROP FUNCTION usage_slow()');}
});

test('watch survives loss of its idle database connection and reconciles newly committed work',async()=>{
 await seed();const child=worker(['--watch'],{PGAPPNAME:schema});
 try{
  await until(()=>child.passes().length>=1,child);assert.equal(await count(),1);
  const terminated=await admin.query("SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity WHERE application_name=$1",[schema]);
  assert.ok(terminated.rowCount!>0);assert.ok(terminated.rows.every(row=>row.terminated));
  await until(()=>child.error().includes('connection failed'),child);
  await seed(second.installation);await until(async()=>await count()===2,child);
  assert.doesNotMatch(child.error(),/postgres:\/\//);
 }finally{await stop(child);}
});
