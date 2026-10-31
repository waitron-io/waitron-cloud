import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {after,before,test} from 'node:test';
import {Pool} from 'pg';
import {SMTPServer} from 'smtp-server';
import {EmailOutbox} from '../src/email-outbox.ts';
import {migrate} from '../src/migrate.ts';
import {transaction} from '../src/transaction.ts';

const url=process.env.TEST_DATABASE_URL;
if(!url)throw new Error('Run through scripts/test-postgres.mjs');
const schema=`email_delivery_stop_${randomUUID().replaceAll('-','')}`;
const admin=new Pool({connectionString:url,statement_timeout:3000});
const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`,statement_timeout:3000});
const connection=new URL(url);
connection.searchParams.set('options',`-c search_path=${schema}`);
const keys={test:randomBytes(32).toString('hex')};
const outbox=new EmailOutbox({activeKeyId:'test',keys});

before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});

// Removing signal handling or exiting before SMTP acceptance must leave these checks red.
for(const signal of ['SIGINT','SIGTERM'] as const){
  test(`${signal} retains SMTP delivery for one second, records acceptance and drains naturally without later mail`,async()=>{
    await pool.query('DELETE FROM email_outbox');
    let acknowledge:(()=>void)|undefined;
    const messages:{to:string[];raw:string}[]=[];
    const smtp=new SMTPServer({authOptional:true,disabledCommands:['AUTH','STARTTLS'],logger:false,
      onData(stream,session,callback){
        const chunks:Buffer[]=[];
        stream.on('data',chunk=>chunks.push(chunk));
        stream.on('end',()=>{
          messages.push({to:session.envelope.rcptTo.map(to=>to.address),raw:Buffer.concat(chunks).toString()});
          acknowledge=()=>callback();
        });
      },
    });
    await new Promise<void>(resolve=>smtp.listen(0,'127.0.0.1',resolve));
    const address=smtp.server.address();assert.ok(address&&typeof address!=='string');
    const first=await transaction(pool,client=>outbox.enqueue(client,'password_changed',{email:'first@example.test'}));
    const name=`email_delivery_signal_${randomUUID()}`;
    const cli=new URL('../src/email-worker-cli.ts',import.meta.url);
    // beforeExit observes work draining; a forced successful exit bypasses it.
    const source=`
      process.once('beforeExit',code=>console.log(JSON.stringify({drained:true,code})));
      await import(${JSON.stringify(cli.href)});
    `;
    const child=spawn(process.execPath,['--input-type=module','-e',source],{
      env:{PATH:process.env.PATH,DATABASE_URL:connection.href,PGAPPNAME:name,NODE_ENV:'test',
        CLOUD_MAIL_TRANSPORT:'local',MAILPIT_SMTP_PORT:String(address.port),
        CLOUD_EMAIL_ACTIVE_KEY_ID:'test',CLOUD_EMAIL_KEYS:JSON.stringify(keys)},
      stdio:['ignore','pipe','pipe'],
    });
    let stdout='',stderr='',exitAt:number|null=null;
    child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
    child.once('exit',()=>{exitAt=performance.now();});
    const exited=new Promise<{code:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{
      child.once('error',reject);child.once('close',(code,exitSignal)=>resolve({code,signal:exitSignal}));
    });
    let closed=false;void exited.then(()=>{closed=true;});
    const sessions=async()=> (await admin.query('SELECT state FROM pg_stat_activity WHERE application_name=$1',[name])).rows;
    const row=async(id:string)=>(await pool.query('SELECT status,attempts,failures,payload,claim_id,lease_until,finished_at FROM email_outbox WHERE id=$1',[id])).rows[0];
    const watchdog=setTimeout(()=>child.kill('SIGKILL'),10000);
    try{
      const deadline=performance.now()+6000;
      while(!acknowledge&&performance.now()<deadline){
        assert.equal(child.exitCode,null,`worker exited before SMTP handoff: ${stderr}`);
        assert.equal(child.signalCode,null);
        await delay(20);
      }
      assert.ok(acknowledge,'the real local transport must submit a complete SMTP message');
      assert.equal((await row(first)).status,'processing');
      assert.equal(child.kill(signal),true);
      await delay(1000);
      assert.equal(exitAt,null,'command must remain live throughout the one-second SMTP hold');
      assert.equal(child.exitCode,null);assert.equal(child.signalCode,null);
      assert.ok((await sessions()).length>0,'database sessions remain while delivery is pending');
      const held=await row(first);
      assert.equal(held.status,'processing');assert.equal(held.attempts,1);assert.equal(held.failures,0);
      assert.notEqual(held.payload,null);assert.notEqual(held.claim_id,null);assert.notEqual(held.lease_until,null);
      assert.equal(held.finished_at,null,'unacknowledged delivery must not be recorded as finished');
      const later=await transaction(pool,client=>outbox.enqueue(client,'password_changed',{email:'later@example.test'}));
      const acceptedAt=performance.now();acknowledge();
      assert.deepEqual(await exited,{code:0,signal:null});
      assert.ok(exitAt!>=acceptedAt,'command exit must follow SMTP acknowledgement');
      assert.deepEqual({stdout,stderr},{stdout:'{"drained":true,"code":0}\n',stderr:''},'shutdown must reach natural event-loop drain');
      assert.deepEqual(await sessions(),[],'no worker database session remains after exit');
      assert.equal(messages.length,1);assert.deepEqual(messages[0]!.to,['first@example.test']);
      assert.match(messages[0]!.raw,/Subject: /);
      const delivered=await row(first);
      assert.equal(delivered.status,'sent');assert.equal(delivered.attempts,1);assert.equal(delivered.failures,0);
      assert.equal(delivered.payload,null);assert.equal(delivered.claim_id,null);assert.equal(delivered.lease_until,null);
      assert.ok(delivered.finished_at instanceof Date);
      const pending=await row(later);
      assert.equal(pending.status,'pending');assert.equal(pending.attempts,0);assert.equal(pending.failures,0);
      assert.notEqual(pending.payload,null);assert.equal(pending.claim_id,null);assert.equal(pending.finished_at,null);
      assert.equal((await pool.query('SELECT count(*) FROM email_outbox')).rows[0].count,'2');
    }finally{
      clearTimeout(watchdog);
      if(!closed){child.kill('SIGKILL');await exited;}
      await new Promise<void>(resolve=>smtp.close(resolve));
    }
  });
}
