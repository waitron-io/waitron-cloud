import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {connect,createServer,type Socket} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {after,before,test,type TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {migrate,migrationNames} from '../src/migrate.ts';
import {transaction} from '../src/transaction.ts';
import {captured} from './fixtures/captured-mail.ts';
import {testEmailKeys,testOutbox} from './fixtures/delivery.ts';

const {TEST_DATABASE_URL,MAILPIT_TEST_URL,MAILPIT_TEST_SMTP_PORT}=process.env;
if(!TEST_DATABASE_URL||!MAILPIT_TEST_URL||!MAILPIT_TEST_SMTP_PORT)throw Error('Run through scripts/test-postgres.mjs');
const inbox=MAILPIT_TEST_URL;
const schema=`email_reconnect_${randomUUID().replaceAll('-','')}`;
const admin=new Pool({connectionString:TEST_DATABASE_URL,statement_timeout:3000});
const pool=new Pool({connectionString:TEST_DATABASE_URL,options:`-c search_path=${schema}`,statement_timeout:3000});
const connection=new URL(TEST_DATABASE_URL);
connection.searchParams.set('options',`-c search_path=${schema}`);

before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});

function worker(t:TestContext,url=connection){
  const name=`email_reconnect_${randomUUID()}`;
  const cli=fileURLToPath(new URL('../src/email-worker-cli.ts',import.meta.url));
  const child=spawn(process.execPath,[cli],{env:{PATH:process.env.PATH,DATABASE_URL:url.href,PGAPPNAME:name,
    NODE_ENV:'test',CLOUD_MAIL_TRANSPORT:'local',MAILPIT_SMTP_PORT:MAILPIT_TEST_SMTP_PORT,
    CLOUD_EMAIL_ACTIVE_KEY_ID:'test',CLOUD_EMAIL_KEYS:JSON.stringify(testEmailKeys)},stdio:['ignore','ignore','pipe']});
  let stderr='';
  child.stderr.on('data',chunk=>{stderr+=chunk;});
  const exited=once(child,'close');
  t.after(async()=>{child.kill('SIGKILL');await exited;});
  return {child,exited,stderr:()=>stderr,name};
}

type Worker=ReturnType<typeof worker>;
async function until(w:Worker,check:()=>Promise<boolean>,description:string,timeoutMs=6500){
  const deadline=performance.now()+timeoutMs;
  while(performance.now()<deadline){
    assert.equal(w.child.exitCode,null,`worker exited before ${description}: ${w.stderr()}`);
    assert.equal(w.child.signalCode,null);
    if(await check())return;
    await delay(20);
  }
  assert.fail(`worker timed out before ${description}: ${w.stderr()}`);
}

async function sessions(w:Worker){
  return (await admin.query<{pid:number;state:string;wait_event_type:string|null;query:string}>(
    'SELECT pid,state,wait_event_type,query FROM pg_stat_activity WHERE application_name=$1',[w.name])).rows;
}

async function terminate(w:Worker){
  const result=await admin.query('SELECT pg_terminate_backend(pid) AS ended FROM pg_stat_activity WHERE application_name=$1',[w.name]);
  assert.equal(result.rows.length,4);
  assert.ok(result.rows.every(row=>row.ended));
}

async function enqueue(){
  const email=`reconnect-${randomUUID()}@example.test`;
  const id=await transaction(pool,c=>testOutbox.enqueue(c,'password_changed',{email}));
  return {id,email};
}

async function row(id:string){
  return (await pool.query('SELECT status,attempts FROM email_outbox WHERE id=$1',[id])).rows[0];
}

async function delivered(w:Worker,mail:Awaited<ReturnType<typeof enqueue>>,timeoutMs?:number){
  await until(w,async()=>(await row(mail.id)).status==='sent','delivery of fresh mail',timeoutMs);
  assert.deepEqual(await row(mail.id),{status:'sent',attempts:1});
  await captured(inbox,'Your Waitron Cloud password changed',mail.email);
}

async function waitIdle(w:Worker){
  await until(w,async()=>{
    const rows=await sessions(w);
    return rows.length===4&&rows.every(row=>row.state==='idle'&&row.query==='COMMIT');
  },'idle database connections');
}

async function duringBlockedPoll(w:Worker,fault:()=>Promise<unknown>){
  await transaction(pool,async lock=>{
    await lock.query('LOCK TABLE email_outbox IN ACCESS EXCLUSIVE MODE');
    await until(w,async()=>{
      const rows=await sessions(w);
      return rows.length===4&&rows.every(row=>row.wait_event_type==='Lock'&&row.query.includes('SELECT * FROM email_outbox'));
    },'blocked outbox polls');
    await fault();
  });
}

test('the same email worker delivers fresh mail after idle connections drop',async t=>{
  const w=worker(t);
  await waitIdle(w);
  await terminate(w);
  await delivered(w,await enqueue());
});

test('the same email worker delivers fresh mail after active polls lose their connections',async t=>{
  const w=worker(t);
  await duringBlockedPoll(w,()=>terminate(w));
  await delivered(w,await enqueue());
});

test('the same email worker delivers fresh mail when established connections go silent',async t=>{
  const sockets=new Set<Socket>(),muted=new Set<Socket>();
  let dropped=false;
  const proxy=createServer(client=>{
    const upstream=connect(Number(connection.port),connection.hostname);
    sockets.add(client);
    for(const socket of [client,upstream]){
      socket.on('error',()=>socket.destroy());
      socket.once('close',()=>{sockets.delete(client);client.destroy();upstream.destroy();});
    }
    client.pipe(upstream);
    upstream.on('data',data=>{
      if(muted.has(client))dropped=true;
      else client.write(data);
    });
  });
  proxy.listen(0,'127.0.0.1');
  t.after(async()=>{
    for(const socket of sockets)socket.destroy();
    await new Promise<void>(resolve=>proxy.close(()=>resolve()));
  });
  await once(proxy,'listening');
  const address=proxy.address();assert.ok(address&&typeof address!=='string');
  const url=new URL(connection);url.hostname='127.0.0.1';url.port=String(address.port);
  const w=worker(t,url);
  await duringBlockedPoll(w,async()=>{for(const socket of sockets)muted.add(socket);});
  await delivered(w,await enqueue(),26000);
  assert.ok(dropped,'the proxy withheld a PostgreSQL reply on a connection open at the fault');
});

test('the email worker refuses a changed migration ledger before a new connection can claim mail',async t=>{
  const name=migrationNames.at(-1)!;
  const {rows:[saved]}=await pool.query('SELECT digest FROM schema_migrations WHERE name=$1',[name]);
  const w=worker(t);
  await waitIdle(w);
  const timer=setTimeout(()=>w.child.kill('SIGKILL'),6500);
  let mail:Awaited<ReturnType<typeof enqueue>>;
  try{
    await pool.query('UPDATE schema_migrations SET digest=$2 WHERE name=$1',[name,'0'.repeat(64)]);
    await terminate(w);
    mail=await enqueue();
    assert.deepEqual(await w.exited,[1,null]);
    assert.match(w.stderr(),/^Email worker refused: schema_incompatible$/m);
    assert.deepEqual(await row(mail.id),{status:'pending',attempts:0});
    await assert.rejects(captured(inbox,'Your Waitron Cloud password changed',mail.email),/Expected captured email/);
  }finally{
    clearTimeout(timer);
    await pool.query('UPDATE schema_migrations SET digest=$2 WHERE name=$1',[name,saved.digest]);
  }
  await delivered(worker(t),mail);
});
