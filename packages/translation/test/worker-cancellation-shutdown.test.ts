import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {after,before,test} from 'node:test';
import {Pool} from 'pg';
import {migrate} from '../../registration/src/migrate.ts';
import {startFakeOpenAi} from './fake-openai.ts';

const url=process.env.TEST_DATABASE_URL;
if(!url)throw new Error('Run through scripts/test-postgres.mjs');
const schema=`translation_cancel_shutdown_${randomUUID().replaceAll('-','')}`;
const admin=new Pool({connectionString:url,statement_timeout:3000});
const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`,statement_timeout:3000});
const connection=new URL(url);
connection.searchParams.set('options',`-c search_path=${schema}`);
const children=new Set<ReturnType<typeof worker>>();
let provider:Awaited<ReturnType<typeof startFakeOpenAi>>;

before(async()=>{
  await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);
  provider=await startFakeOpenAi(()=>{throw new Error('empty queue must not call the provider');});
});
after(async()=>{
  for(const child of children){child.process.kill('SIGKILL');await child.exited;}
  await provider?.close();await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();
});

function worker(){
  const name=`translation_cancel_${randomUUID()}`;
  const child=spawn(process.execPath,[new URL('../src/worker-cli.ts',import.meta.url).pathname],{
    env:{PATH:process.env.PATH,DATABASE_URL:connection.href,PGAPPNAME:name,
      CLOUD_OPENAI_API_KEY:'local-cancellation-test',CLOUD_TRANSLATION_LOCAL_PROOF:'1',
      CLOUD_OPENAI_BASE_URL:provider.baseUrl},stdio:['ignore','pipe','pipe'],
  });
  let stdout='',stderr='',exitedAt:number|null=null;
  child.once('exit',()=>{exitedAt=performance.now();});
  child.stdout.on('data',chunk=>{stdout+=chunk;});
  child.stderr.on('data',chunk=>{stderr+=chunk;});
  const exited=new Promise<{code:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{
    child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));
  });
  const result={process:child,name,exited,exitTime:()=>exitedAt,output:()=>({stdout,stderr})};
  children.add(result);void exited.then(()=>children.delete(result));
  return result;
}

async function sessions(child:ReturnType<typeof worker>){
  return (await admin.query('SELECT pid,state,wait_event_type,query FROM pg_stat_activity WHERE application_name=$1',[child.name])).rows;
}

async function until(check:()=>Promise<boolean>,child:ReturnType<typeof worker>){
  const deadline=performance.now()+6000;
  while(performance.now()<deadline){
    if(await check())return;
    assert.equal(child.process.exitCode,null,`worker exited early: ${child.output().stderr}`);
    assert.equal(child.process.signalCode,null,'worker was terminated before the database observation');
    await delay(20);
  }
  assert.fail('translation command did not reach the expected database state');
}

async function blocked(child:ReturnType<typeof worker>){
  await until(async()=>{
    const rows=await sessions(child);
    return rows.length===1&&rows[0].state==='active'&&rows[0].wait_event_type==='Lock'
      &&rows[0].query.startsWith('SELECT id FROM translation_jobs')
      &&rows[0].query.includes("state IN ('done','partly_done','failed')");
  },child);
  return (await sessions(child))[0];
}

async function cancel(child:ReturnType<typeof worker>,pid:number){
  assert.deepEqual((await admin.query(
    "SELECT pg_cancel_backend(pid) AS cancelled FROM pg_stat_activity WHERE pid=$1 AND application_name=$2 AND state='active' AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM translation_jobs%'",
    [pid,child.name])).rows,[{cancelled:true}],'cancel only the owned blocked retention query');
}

async function finish(child:ReturnType<typeof worker>){
  const timer=setTimeout(()=>child.process.kill('SIGKILL'),6000);
  try{
    assert.deepEqual(await child.exited,{code:0,signal:null},'the command must finish normally after shutdown');
    assert.deepEqual(child.output(),{stdout:'',stderr:'Translation worker cleanup failed; retrying\n'});
    assert.deepEqual(await sessions(child),[],'no worker database sessions remain after command exit');
  }finally{clearTimeout(timer);}
}

async function emptyFixture(){
  for(const table of ['translation_jobs','translation_job_bodies','usage_events']){
    assert.equal((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count,'0',`${table} stays empty`);
  }
  assert.equal(provider.requests.length,0,'the empty queue must not reach the provider');
}

async function dispose(child:ReturnType<typeof worker>){
  if(children.has(child)){child.process.kill('SIGKILL');await child.exited;}
}

for(const signal of ['SIGINT','SIGTERM'] as const){
  test(`${signal} reports cancelled retention once before translation command shutdown`,async()=>{
    const lock=await pool.connect();
    let child:ReturnType<typeof worker>|undefined;
    try{
      await lock.query('BEGIN');await lock.query('LOCK TABLE translation_jobs IN ACCESS EXCLUSIVE MODE');
      child=worker();const first=await blocked(child);
      assert.equal(child.process.kill(signal),true);
      await delay(1000);
      assert.equal(child.process.exitCode,null,'shutdown must wait for blocked retention');
      assert.equal(child.process.signalCode,null,'shutdown must retain the retention connection');
      assert.equal(child.exitTime(),null,'the command remains live throughout the one-second hold');
      assert.deepEqual(child.output(),{stdout:'',stderr:''},'no error is reported before cancellation');
      assert.equal((await blocked(child)).pid,first.pid,'the original retention query remains blocked');
      const cancelledAt=performance.now();await cancel(child,first.pid);
      // Keep the table locked through exit so an unintended cleanup retry cannot complete.
      await finish(child);
      assert.ok(child.exitTime()!>=cancelledAt,'command exit follows database cancellation');
      await lock.query('ROLLBACK');await emptyFixture();
    }finally{
      await lock.query('ROLLBACK');lock.release();
      if(child)await dispose(child);
    }
  });
}

test('translation stays live after retention cancellation until shutdown interrupts its retry wait',async()=>{
  const lock=await pool.connect();
  let child:ReturnType<typeof worker>|undefined;
  try{
    await lock.query('BEGIN');await lock.query('LOCK TABLE translation_jobs IN ACCESS EXCLUSIVE MODE');
    child=worker();const first=await blocked(child);await cancel(child,first.pid);
    const active=child;
    await until(async()=>{
      const rows=await sessions(active);
      return active.output().stderr==='Translation worker cleanup failed; retrying\n'
        &&rows.length===1&&rows[0].pid===first.pid&&rows[0].state==='idle'&&rows[0].query==='ROLLBACK';
    },active);
    await delay(1000);
    assert.equal(child.exitTime(),null,'a cancelled cleanup alone must not stop the command');
    assert.equal(child.process.exitCode,null);assert.equal(child.process.signalCode,null);
    const rows=await sessions(child);
    assert.equal(rows.length,1);assert.equal(rows[0].state,'idle');assert.equal(rows[0].query,'ROLLBACK');
    assert.deepEqual(child.output(),{stdout:'',stderr:'Translation worker cleanup failed; retrying\n'});
    assert.equal(child.process.kill('SIGTERM'),true);
    await finish(child);
    await lock.query('ROLLBACK');await emptyFixture();
  }finally{
    await lock.query('ROLLBACK');lock.release();
    if(child)await dispose(child);
  }
});
