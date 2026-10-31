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
const schema=`translation_shutdown_${randomUUID().replaceAll('-','')}`;
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
  const name=`translation_signal_${randomUUID()}`;
  const child=spawn(process.execPath,[new URL('../src/worker-cli.ts',import.meta.url).pathname],{
    env:{PATH:process.env.PATH,DATABASE_URL:connection.href,PGAPPNAME:name,
      CLOUD_OPENAI_API_KEY:'local-shutdown-test',CLOUD_TRANSLATION_LOCAL_PROOF:'1',
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
  return (await admin.query('SELECT state,wait_event_type,query FROM pg_stat_activity WHERE application_name=$1',[child.name])).rows;
}

async function untilBlocked(child:ReturnType<typeof worker>){
  const deadline=performance.now()+6000;
  while(performance.now()<deadline){
    const rows=await sessions(child);
    if(rows.length===1&&rows[0].state==='active'&&rows[0].wait_event_type==='Lock'&&rows[0].query.startsWith('SELECT id FROM translation_jobs')&&rows[0].query.includes("state IN ('done','partly_done','failed')"))return;
    assert.equal(child.process.exitCode,null,`worker exited early: ${child.output().stderr}`);
    assert.equal(child.process.signalCode,null,'worker was terminated before the database observation');
    await delay(20);
  }
  assert.fail('translation command did not reach blocked database cleanup');
}

// Observe the blocked retention connection before signalling and throughout the hold.
for(const signal of ['SIGINT','SIGTERM'] as const){
  test(`${signal} retains blocked translation cleanup for one second and exits after lock release`,async()=>{
    const lock=await pool.connect();
    let child:ReturnType<typeof worker>|undefined;
    try{
      await lock.query('BEGIN');await lock.query('LOCK TABLE translation_jobs IN ACCESS EXCLUSIVE MODE');
      child=worker();await untilBlocked(child);
      assert.equal(child.process.kill(signal),true);
      await delay(1000);
      assert.equal(child.process.exitCode,null,'shutdown must wait for database cleanup');
      assert.equal(child.process.signalCode,null,'shutdown must retain database cleanup');
      assert.equal(child.exitTime(),null,'the process must remain live for the full one-second hold');
      const rows=await sessions(child);
      assert.equal(rows.length,1,'the blocked cleanup retains its connection until lock release');
      assert.equal(rows[0].state,'active');assert.equal(rows[0].wait_event_type,'Lock');
      assert.ok(rows[0].query.startsWith('SELECT id FROM translation_jobs'));
      assert.ok(rows[0].query.includes("state IN ('done','partly_done','failed')"),'the blocked query is retention, not a new job claim');
      const releasedAt=performance.now();await lock.query('ROLLBACK');
      const timer=setTimeout(()=>child!.process.kill('SIGKILL'),6000);
      try{
        assert.deepEqual(await child.exited,{code:0,signal:null},'the command must finish normally after shutdown');
        assert.ok(child.exitTime()!>=releasedAt,'command exit must follow database lock release');
        assert.deepEqual(child.output(),{stdout:'',stderr:''});
        assert.deepEqual(await sessions(child),[],'no worker database sessions remain after command exit');
      }finally{clearTimeout(timer);}
      for(const table of ['translation_jobs','translation_job_bodies','usage_events']){
        assert.equal((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count,'0',`${table} stays empty`);
      }
      assert.equal(provider.requests.length,0,'shutdown with an empty queue never calls the provider');
    }finally{
      await lock.query('ROLLBACK');lock.release();
      if(child&&children.has(child)){child.process.kill('SIGKILL');await child.exited;}
    }
  });
}
