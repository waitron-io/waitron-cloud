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
const schema=`translation_drain_${randomUUID().replaceAll('-','')}`;
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
  const name=`translation_drain_${randomUUID()}`;
  const cli=new URL('../src/worker-cli.ts',import.meta.url);
  // beforeExit observes natural drain; a forced successful exit bypasses it.
  const source=`
    process.once('beforeExit',code=>console.log(JSON.stringify({drained:true,code})));
    await import(${JSON.stringify(cli.href)});
  `;
  const child=spawn(process.execPath,['--input-type=module','-e',source],{
    env:{PATH:process.env.PATH,DATABASE_URL:connection.href,PGAPPNAME:name,
      CLOUD_OPENAI_API_KEY:'local-drain-test',CLOUD_TRANSLATION_LOCAL_PROOF:'1',
      CLOUD_OPENAI_BASE_URL:provider.baseUrl},stdio:['ignore','pipe','pipe'],
  });
  let stdout='',stderr='';
  child.stdout.on('data',chunk=>{stdout+=chunk;});
  child.stderr.on('data',chunk=>{stderr+=chunk;});
  const exited=new Promise<{code:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{
    child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));
  });
  const result={process:child,name,exited,output:()=>({stdout,stderr})};
  children.add(result);void exited.then(()=>children.delete(result),()=>children.delete(result));
  return result;
}

async function sessions(child:ReturnType<typeof worker>){
  return (await admin.query('SELECT state,query FROM pg_stat_activity WHERE application_name=$1',[child.name])).rows;
}

async function untilIdle(child:ReturnType<typeof worker>){
  const deadline=performance.now()+6000;
  while(performance.now()<deadline){
    const rows=await sessions(child);
    if(rows.length===2&&rows.every(row=>row.state==='idle'&&row.query==='COMMIT'))return;
    assert.equal(child.process.exitCode,null,`worker exited early: ${child.output().stderr}`);
    assert.equal(child.process.signalCode,null,'worker was terminated before idle claims were observed');
    await delay(20);
  }
  assert.fail('translation command did not reach two idle database connections');
}

for(const signal of ['SIGINT','SIGTERM'] as const){
  test(`${signal} lets the idle translation command drain naturally with no database sessions`,async()=>{
    const child=worker();
    try{
      await untilIdle(child);
      assert.deepEqual(child.output(),{stdout:'',stderr:''},'no drain is reported while the worker is live');
      assert.equal(child.process.kill(signal),true);
      // Default idle connections keep Node alive; six seconds precedes their ten-second expiry.
      const timer=setTimeout(()=>child.process.kill('SIGKILL'),6000);
      try{
        assert.deepEqual(await child.exited,{code:0,signal:null});
        assert.deepEqual(child.output(),{stdout:'{"drained":true,"code":0}\n',stderr:''},'shutdown must reach natural event-loop drain');
        assert.deepEqual(await sessions(child),[],'no worker connection survives natural drain');
      }finally{clearTimeout(timer);}
      for(const table of ['translation_jobs','translation_job_bodies','usage_events']){
        assert.equal((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count,'0',`${table} stays empty`);
      }
      assert.equal(provider.requests.length,0,'an empty queue never calls the provider');
    }finally{
      if(children.has(child)){child.process.kill('SIGKILL');await child.exited;}
    }
  });
}
