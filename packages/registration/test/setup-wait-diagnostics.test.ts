import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
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
   await blocker.query('SELECT pg_advisory_xact_lock(782,19)');
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
  assert.deepEqual(Object.keys(sample).sort(),['blockers','locks','pid','waitEvent','waitType']);
  assert.ok(sample.locks.some((lock:any)=>lock.granted===false));
  assert.equal(sample.locks.length,1,'held locks do not displace the waiting lock');
  assert.ok(sample.locks.every((lock:any)=>lock.granted===false));
  assert.ok(lines.join('').length<24000);
  assert.ok(!lines.join('').includes('private row value'));
  assert.equal(pool.listenerCount('acquire'),0);
  assert.equal((await pool.query('SHOW statement_timeout')).rows[0].statement_timeout,'900ms');
 }finally{
  await blocker.query('ROLLBACK');blocker.release();
  await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();
 }
});

test('successful setup stays silent and releases its observer',async t=>{
 const pool=new Pool({connectionString:url});const lines:unknown[]=[];
 const observerPids:number[]=[];
 const emit=Pool.prototype.emit;
 t.mock.method(Pool.prototype,'emit',function(this:Pool,event:string|symbol,...args:any[]){
  if(event==='connect'&&this.options.application_name==='cloud-test-setup-observer')observerPids.push(args[0].processID);
  return emit.call(this,event,...args);
 });
 t.mock.method(console,'error',(...args:unknown[])=>lines.push(args));
 try{
  assert.equal(await observeSetup(pool,async()=>{await pool.query('SELECT pg_sleep(0.2)');return 17;}),17);
  assert.deepEqual(lines,[]);assert.equal(pool.listenerCount('acquire'),0);
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
 const original=new Proxy({}, {get(){assert.fail('diagnostics read the setup error');}});
 const lines:string[]=[];
 t.mock.method(console,'error',(line:string)=>{lines.push(line);throw new Error('reporter refused');});
 process.env.TEST_DATABASE_URL='postgres://synthetic:synthetic@127.0.0.1:1/unavailable';
 try{
  let caught:unknown;
  try{await observeSetup(pool,async()=>{await pool.query('SELECT pg_sleep(0.2)');throw original;});}catch(error){caught=error;}
  assert.equal(caught,original);
  assert.equal(JSON.parse(lines[0]!).unavailable,true);
  assert.equal(pool.listenerCount('acquire'),0);
 }finally{process.env.TEST_DATABASE_URL=previous;await pool.end();}
});
