import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {after,before,test} from 'node:test';
import {Pool} from 'pg';
import {migrate} from '../src/migrate.ts';

const url=process.env.TEST_DATABASE_URL;
if(!url)throw new Error('Run through scripts/test-postgres.mjs');
const schema=`email_shutdown_${randomUUID().replaceAll('-','')}`;
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
  const name=`email_signal_${randomUUID()}`;
  const child=spawn(process.execPath,[new URL('../src/email-worker-cli.ts',import.meta.url).pathname],{
    env:{PATH:process.env.PATH,DATABASE_URL:connection.href,PGAPPNAME:name,
      NODE_ENV:'test',CLOUD_MAIL_TRANSPORT:'local',CLOUD_EMAIL_ACTIVE_KEY_ID:'test',
      CLOUD_EMAIL_KEYS:JSON.stringify({test:randomBytes(32).toString('hex')})},
    stdio:['ignore','pipe','pipe'],
  });
  let stdout='',stderr='';
  child.stdout.on('data',chunk=>{stdout+=chunk;});
  child.stderr.on('data',chunk=>{stderr+=chunk;});
  const exited=new Promise<{code:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{
    child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));
  });
  const result={process:child,name,exited,output:()=>({stdout,stderr})};
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
  assert.fail('email worker did not reach the expected database state');
}

async function finish(child:ReturnType<typeof worker>){
  const timer=setTimeout(()=>child.process.kill('SIGKILL'),6000);
  try{
    assert.deepEqual(await child.exited,{code:0,signal:null},'the command must finish normally after shutdown');
    assert.deepEqual(child.output(),{stdout:'',stderr:''});
    assert.deepEqual(await sessions(child),[],'shutdown must close every worker database connection');
  }finally{clearTimeout(timer);}
}

async function dispose(child:ReturnType<typeof worker>){
  if(children.has(child)){child.process.kill('SIGKILL');await child.exited;}
}

// Dropping a signal handler kills active claims; omitting pool.end leaves idle sockets alive.
for(const signal of ['SIGINT','SIGTERM'] as const){
  test(`${signal} stops the idle email command and closes its real database pool`,async()=>{
    const child=worker();
    try{
      await until(async()=>{
        const rows=await sessions(child);
        return rows.length===4&&rows.every(row=>row.state==='idle'&&row.query==='COMMIT');
      },child);
      assert.equal(child.process.kill(signal),true);
      await finish(child);
      assert.equal((await pool.query('SELECT count(*) FROM email_outbox')).rows[0].count,'0');
    }finally{await dispose(child);}
  });

  test(`${signal} drains all four blocked email claims before command exit`,async()=>{
    const lock=await pool.connect();
    let child:ReturnType<typeof worker>|undefined;
    try{
      await lock.query('BEGIN');await lock.query('LOCK TABLE email_outbox IN ACCESS EXCLUSIVE MODE');
      child=worker();
      const active=child;
      await until(async()=>{
        const rows=await sessions(active);
        return rows.length===4&&rows.every(row=>row.state==='active'&&row.wait_event_type==='Lock'&&row.query.includes('SELECT * FROM email_outbox'));
      },active);
      assert.equal(child.process.kill(signal),true);
      await delay(100);
      assert.equal(child.process.exitCode,null,'shutdown must await active database claims');
      assert.equal(child.process.signalCode,null,'shutdown must retain active database claims');
      assert.equal((await sessions(child)).length,4,'all blocked claims remain owned until lock release');
      await lock.query('ROLLBACK');
      await finish(child);
      assert.equal((await pool.query('SELECT count(*) FROM email_outbox')).rows[0].count,'0');
    }finally{
      await lock.query('ROLLBACK');lock.release();
      if(child)await dispose(child);
    }
  });
}
