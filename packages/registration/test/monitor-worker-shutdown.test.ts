import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {after,before,test} from 'node:test';
import {Pool} from 'pg';
import {migrate} from '../src/migrate.ts';

const url=process.env.TEST_DATABASE_URL;
if(!url)throw new Error('Run through scripts/test-postgres.mjs');
const schema=`monitor_shutdown_${randomUUID().replaceAll('-','')}`;
const admin=new Pool({connectionString:url,statement_timeout:3000});
const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`,statement_timeout:3000});
const connection=new URL(url);
connection.searchParams.set('options',`-c search_path=${schema}`);
const children=new Set<ReturnType<typeof worker>>();

before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
after(async()=>{
  for(const child of children){child.process.kill('SIGKILL');await child.exited;}
  await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();
});

function worker(){
  const name=`monitor_signal_${randomUUID()}`;
  const cli=new URL('../src/monitor-cli.ts',import.meta.url);
  // beforeExit observes natural drain; a forced successful exit bypasses it.
  const source=`
    process.once('beforeExit',code=>console.log(JSON.stringify({drained:true,code})));
    await import(${JSON.stringify(cli.href)});
  `;
  const child=spawn(process.execPath,['--input-type=module','-e',source],{
    env:{PATH:process.env.PATH,DATABASE_URL:connection.href,PGAPPNAME:name,
      NODE_ENV:'test',CLOUD_MAIL_TRANSPORT:'local',CLOUD_EMAIL_ACTIVE_KEY_ID:'test',
      CLOUD_EMAIL_KEYS:JSON.stringify({test:randomBytes(32).toString('hex')})},
    stdio:['ignore','pipe','pipe'],
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

async function until(check:()=>Promise<boolean>,child:ReturnType<typeof worker>){
  const deadline=performance.now()+6000;
  while(performance.now()<deadline){
    if(await check())return;
    assert.equal(child.process.exitCode,null,`worker exited early: ${child.output().stderr}`);
    assert.equal(child.process.signalCode,null,'worker was terminated before the database observation');
    await delay(20);
  }
  assert.fail('monitor worker did not reach the expected database state');
}

async function finish(child:ReturnType<typeof worker>){
  const timer=setTimeout(()=>child.process.kill('SIGKILL'),6000);
  try{
    assert.deepEqual(await child.exited,{code:0,signal:null},'the command must finish normally after shutdown');
    assert.deepEqual(child.output(),{stdout:'{"drained":true,"code":0}\n',stderr:''},'shutdown must reach natural event-loop drain');
    assert.deepEqual(await sessions(child),[],'no worker database sessions remain after command exit');
  }finally{clearTimeout(timer);}
}

async function dispose(child:ReturnType<typeof worker>){
  if(children.has(child)){child.process.kill('SIGKILL');await child.exited;}
}

// Signals must keep scheduling alive until it finishes; idle commands must exit normally.
for(const signal of ['SIGINT','SIGTERM'] as const){
  test(`${signal} stops the idle monitoring command and leaves no database sessions`,async()=>{
    const child=worker();
    try{
      await until(async()=>{
        const rows=await sessions(child);
        return rows.length===4&&rows.every(row=>row.state==='idle'&&row.query==='COMMIT');
      },child);
      assert.equal(child.process.kill(signal),true);
      await finish(child);
      assert.equal((await pool.query('SELECT count(*) FROM venue_monitors')).rows[0].count,'0');
      assert.equal((await pool.query('SELECT count(*) FROM email_outbox')).rows[0].count,'0');
    }finally{await dispose(child);}
  });

  test(`${signal} retains blocked monitoring startup for one second and exits after scheduling resumes`,async()=>{
    const lock=await pool.connect();
    let child:ReturnType<typeof worker>|undefined;
    try{
      await lock.query('BEGIN');await lock.query('LOCK TABLE installations IN ACCESS EXCLUSIVE MODE');
      child=worker();
      const active=child;
      await until(async()=>{
        const rows=await sessions(active);
        return rows.length===1&&rows[0].state==='active'&&rows[0].wait_event_type==='Lock'&&rows[0].query.startsWith('INSERT INTO venue_monitors');
      },active);
      assert.equal(child.process.kill(signal),true);
      await delay(1000);
      assert.equal(child.process.exitCode,null,'shutdown must wait for database scheduling');
      assert.equal(child.process.signalCode,null,'shutdown must retain database scheduling');
      assert.equal(child.exitTime(),null,'the process must remain live for the full one-second hold');
      const rows=await sessions(child);
      assert.equal(rows.length,1,'the blocked scheduler retains its connection until lock release');
      assert.equal(rows[0].wait_event_type,'Lock');
      assert.ok(rows[0].query.startsWith('INSERT INTO venue_monitors'));
      const releasedAt=performance.now();
      await lock.query('ROLLBACK');
      await finish(child);
      assert.ok(child.exitTime()!>=releasedAt,'command exit must follow database lock release');
      assert.equal((await pool.query('SELECT count(*) FROM venue_monitors')).rows[0].count,'0');
      assert.equal((await pool.query('SELECT count(*) FROM email_outbox')).rows[0].count,'0');
    }finally{
      await lock.query('ROLLBACK');lock.release();
      if(child)await dispose(child);
    }
  });
}
