import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {Pool} from 'pg';
import {migrationNames} from '../src/migrate.ts';
import {observeSetup,migrate} from './fixtures/setup-waits.ts';

const url=process.env.TEST_DATABASE_URL;
if(!url)throw new Error('Run through scripts/test-postgres.mjs');

for(const known of [false,true])test(`setup timeout retains real locks and ${known?'migration context':'private SQL stays absent'}`,async t=>{
 const admin=new Pool({connectionString:url});
 const schema=`setup_wait_${randomUUID().replaceAll('-','')}`;
 const pool=new Pool({connectionString:url,max:1,options:`-c search_path=${schema} -c statement_timeout=900`});
 const lines:string[]=[];
 t.mock.method(console,'error',(line:string)=>lines.push(line));
 const blocker=await admin.connect();
 try{
  const target=(await pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  await pool.query('SELECT pg_advisory_lock(783,key) FROM generate_series(1,24) AS key');
  await admin.query(`CREATE SCHEMA ${schema}`);
  await blocker.query('BEGIN');
  const blockerPid=(await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  let sql:string;
  if(known){
   await blocker.query(`CREATE TABLE ${schema}.remote_configuration_jobs (id integer)`);
   sql='';
  }else{
   await blocker.query("SELECT 'private holder value', pg_advisory_xact_lock(782,19)");
   sql="SELECT 'private row value', pg_advisory_xact_lock(782,19)";
  }
  await assert.rejects(known?migrate(pool):observeSetup(pool,()=>pool.query(sql)),{code:'57014'});
  if(known)assert.ok(lines.some(line=>JSON.parse(line).stage==='migration-apply'&&JSON.parse(line).migrationOrdinal===24));
  const report=JSON.parse(lines.find(line=>line.includes('cloud-test-setup-waits'))??'null');
  assert.ok(report,'a timeout must retain the observation from before cancellation');
  assert.ok(report.samples.length>0&&report.samples.length<=8);
  assert.ok(report.samples.every((row:any)=>row.pid===target),'only this setup pool is observed');
  const sample=report.samples.find((row:any)=>row.blockers.includes(blockerPid));
  assert.ok(sample,'the waiting backend identifies its real blocker');
  assert.equal(sample.waitType,'Lock');
  assert.deepEqual(Object.keys(sample).sort(),['blockers','elapsedMs','latenessMs','locks','pid','waitEvent','waitType']);
  assert.ok(sample.locks.some((lock:any)=>lock.granted===false));
  assert.equal(sample.locks.length,1,'held locks do not displace the waiting lock');
  assert.ok(sample.locks.every((lock:any)=>lock.granted===false));
  assert.ok(report.database,'a PostgreSQL statement timeout must retain the server-wide snapshot');
  const {activity,activityCount,capturedAt,walIo}=report.database;
  assert.ok(activityCount>=activity.length);
  assert.ok(Number.isFinite(Date.parse(capturedAt)));
  assert.ok(activity.some((row:any)=>row.pid===blockerPid&&row.state==='idle in transaction'));
  assert.ok(activity.some((row:any)=>row.backend_type==='checkpointer'));
  assert.ok(walIo.some((row:any)=>row.backend_type==='client backend'&&row.writes>0&&Number.isFinite(row.fsyncs)));
  assert.deepEqual(walIo.filter((row:any)=>row.backend_type==='client backend').map((row:any)=>row.context).sort(),
   ['init','normal'],'distinguish WAL file creation from ordinary writes');
  assert.ok(lines.join('').length<24000);
  assert.ok(!lines.join('').includes('private row value'));
  assert.ok(!lines.join('').includes('private holder value'));
  assert.equal(pool.listenerCount('acquire'),0);
  assert.equal((await pool.query('SHOW statement_timeout')).rows[0].statement_timeout,'900ms');
 }finally{
  await blocker.query('ROLLBACK');blocker.release();
  await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();
 }
});

test('successful setup stays silent and releases its observer',async t=>{
 const pool=new Pool({connectionString:url});const lines:unknown[]=[];const controller=new AbortController();
 const observerPids:number[]=[];
 const query=Pool.prototype.query;
 let ioReads=0;
 t.mock.method(Pool.prototype,'query',function(this:Pool,...args:unknown[]){
  if(this.options.application_name==='cloud-test-setup-observer'&&String(args[0]).includes('pg_stat_io'))ioReads++;
  return Reflect.apply(query,this,args);
 });
 const emit=Pool.prototype.emit;
 t.mock.method(Pool.prototype,'emit',function(this:Pool,event:string|symbol,...args:any[]){
  if(event==='connect'&&this.options.application_name==='cloud-test-setup-observer')observerPids.push(args[0].processID);
  return emit.call(this,event,...args);
 });
 t.mock.method(console,'error',(...args:unknown[])=>lines.push(args));
 try{
  assert.equal(await observeSetup(pool,async()=>{await pool.query('SELECT pg_sleep(0.2)');return 17;},{signal:controller.signal}),17);
  controller.abort();await delay(0);
  assert.deepEqual(lines,[]);assert.equal(pool.listenerCount('acquire'),0);
  assert.equal(ioReads,0,'passing setup must not read server I/O statistics');
  assert.ok(observerPids.length>0,'observe the real connections owned by this setup');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid=ANY($1::int[])',[observerPids])).rows[0].n,0);
 }finally{await pool.end();}
});

test('migration setup retains the advisory wait before rollback and still migrates after release',async t=>{
 const schema=`setup_wait_${randomUUID().replaceAll('-','')}`;
 const admin=new Pool({connectionString:url});
 const pool=new Pool({connectionString:url,options:`-c search_path=${schema} -c statement_timeout=900`});
 const blocker=await admin.connect();const lines:string[]=[];
 t.mock.method(console,'error',(line:string)=>lines.push(line));
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);await blocker.query('BEGIN');
  await blocker.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext('cloud_migrations'))",[schema]);
  await assert.rejects(migrate(pool),{code:'57014'});
  assert.ok(lines.some(line=>JSON.parse(line).stage==='advisory-lock'));
  assert.ok(lines.some(line=>JSON.parse(line).samples?.some((row:any)=>row.waitEvent==='advisory')));
  await blocker.query('ROLLBACK');lines.length=0;
  await migrate(pool);assert.deepEqual(lines,[]);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n,migrationNames.length);
 }finally{
  await blocker.query('ROLLBACK');blocker.release();await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();
 }
});

test('unavailable observer and throwing reporter cannot replace a setup failure',async t=>{
 const pool=new Pool({connectionString:url});const previous=process.env.TEST_DATABASE_URL;
 const original=new Proxy({}, {
  get(){assert.fail('diagnostics read the setup error');},
  getPrototypeOf(){assert.fail('diagnostics inspected the setup error prototype');},
 });
 const lines:string[]=[];
 t.mock.method(console,'error',(line:string)=>{lines.push(line);throw new Error('reporter refused');});
 process.env.TEST_DATABASE_URL='postgres://synthetic:synthetic@127.0.0.1:1/unavailable';
 try{
  let caught:unknown;
  try{await observeSetup(pool,async()=>{await pool.query('SELECT pg_sleep(0.2)');throw original;});}catch(error){caught=error;}
  assert.equal(caught,original);
  assert.equal(JSON.parse(lines[0]!).unavailable,true);
  assert.equal(JSON.parse(lines[0]!).database,undefined,'a non-timeout failure must not capture server data');
  assert.equal(pool.listenerCount('acquire'),0);
 }finally{process.env.TEST_DATABASE_URL=previous;await pool.end();}
});


test('abort reports a still-blocked stage and closes only its observer before work settles',async t=>{
 const admin=new Pool({connectionString:url}),pool=new Pool({connectionString:url,max:1});
 const blocker=await admin.connect(),controller=new AbortController(),lines:string[]=[],observerPids:number[]=[];
 const emit=Pool.prototype.emit;
 t.mock.method(Pool.prototype,'emit',function(this:Pool,event:string|symbol,...args:any[]){
  if(event==='connect'&&this.options.application_name==='cloud-test-setup-observer')observerPids.push(args[0].processID);
  return emit.call(this,event,...args);
 });
 let reported!:()=>void;const reportReady=new Promise<void>(resolve=>{reported=resolve;});
 t.mock.method(console,'error',(line:string)=>{lines.push(line);reported();});
 let work:Promise<number>|undefined,settled=false;
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT pg_advisory_xact_lock(784,19)');
  const blockerPid=(await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const target=(await pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  work=observeSetup(undefined,async observation=>{
   observation.mark('database');observation.attach(pool);observation.mark('bulk-insert');
   await pool.query("SELECT 'private abort value', pg_advisory_xact_lock(784,19)");
   settled=true;return 23;
  },{signal:controller.signal});
  // The callback remains pending on a real lock when the test deadline signal arrives.
  for(let i=0;i<100;i++){
   const row=(await admin.query('SELECT pg_blocking_pids($1) AS blockers',[target])).rows[0];
   if(row.blockers.includes(blockerPid))break;
   assert.ok(i<99,'work must reach its real database wait');await delay(10);
  }
  await delay(150);controller.abort();
  await Promise.race([reportReady,delay(1000)]);
  assert.equal(lines.length,1,'abort must report without waiting for the blocked workload');
  assert.equal(settled,false);assert.equal(pool.listenerCount('acquire'),0);
  const report=JSON.parse(lines[0]!);
  assert.equal(report.stage,'bulk-insert');assert.ok(report.elapsedMs>=0);
  assert.deepEqual(report.stages.map((mark:any)=>mark.stage),['database','bulk-insert']);
  assert.ok(report.stages.every((mark:any)=>mark.elapsedMs>=0));
  assert.deepEqual(report.pool,{total:1,idle:0,waiting:0});
  assert.equal(report.loadAverage.length,3);assert.ok(report.loadAverage.every(Number.isFinite));
  const sample=report.samples.find((row:any)=>row.pid===target&&row.blockers.includes(blockerPid));
  assert.ok(sample,'abort retains the real blocker before the query can reject');
  assert.equal(sample.waitType,'Lock');assert.ok(sample.elapsedMs>=0);assert.ok(sample.latenessMs>=0);
  assert.ok(observerPids.length>0);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid=ANY($1::int[])',[observerPids])).rows[0].n,0);
  assert.ok(lines.join('').length<24000);assert.equal(lines.join('').includes('private abort value'),false);
  await blocker.query('ROLLBACK');assert.equal(await work,23);assert.equal(lines.length,1);
 }finally{
  await blocker.query('ROLLBACK');blocker.release();await work?.catch(()=>{});
  await pool.end();await admin.end();
 }
});

test('abort retains timer lateness even when the current stage has no database pool',async t=>{
 const controller=new AbortController(),lines:string[]=[];
 t.mock.method(console,'error',(line:string)=>lines.push(line));
 await observeSetup(undefined,async observation=>{
  observation.mark('cli-read');
  const until=performance.now()+200;while(performance.now()<until){}
  await delay(0);controller.abort();return 29;
 },{signal:controller.signal});
 assert.equal(lines.length,1);
 const report=JSON.parse(lines[0]!);
 assert.deepEqual(report.samples,[]);assert.equal(report.stage,'cli-read');
 assert.ok(report.maxLateness?.latenessMs>=50,'retain a delayed timer without a database row');
 assert.ok(report.maxLateness.elapsedMs>=200);
});
