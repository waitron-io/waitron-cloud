import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {Pool} from 'pg';
import {database} from '../../account-http/test/fixtures.ts';

// A timed-out observation retains retry state; only a stop signal ends the command.
for(const signal of ['SIGINT','SIGTERM',null] as const){
  test(signal?`${signal} drains monitoring after an active observation times out`:
    'monitoring continues to a later venue after observation timeout without a stop signal',async()=>{
    const db=await database();
    const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL,statement_timeout:3000});
    const lock=await db.secondPool.connect();
    const name=`monitor_timeout_${randomUUID()}`;
    const organisation=randomUUID(),business=randomUUID(),first=randomUUID(),later=randomUUID();
    let child:ReturnType<typeof spawn>|undefined;
    let exited:Promise<{code:number|null;signal:NodeJS.Signals|null}>|undefined;
    let stdout='',stderr='',exitedAt:number|null=null;
    try{
      await db.pool.query('INSERT INTO organisations(id) VALUES($1)',[organisation]);
      await db.pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[business,organisation]);
      async function venue(id:string){
        const installation=randomUUID();
        await db.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,'test')",[id,organisation,business,randomUUID()]);
        await db.pool.query("INSERT INTO installations(id,venue_id,public_key,last_contact_at) VALUES($1,$2,$3,clock_timestamp()-interval '20 minutes')",[installation,id,randomUUID()]);
        await db.pool.query("INSERT INTO installation_services(installation_id,service,state) VALUES($1,'remote_access','ready')",[installation]);
        await db.pool.query('INSERT INTO venue_monitors(venue_id) VALUES($1)',[id]);
      }
      await venue(first);
      await lock.query('BEGIN');
      await lock.query('LOCK TABLE venue_incidents IN ACCESS EXCLUSIVE MODE');
      const lockPid=(await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const connection=new URL(process.env.TEST_DATABASE_URL!);
      connection.searchParams.set('options',`-c search_path=${db.schema}`);
      const cli=new URL('../src/monitor-cli.ts',import.meta.url);
      // beforeExit observes natural drain without changing the command or its database methods.
      const source=`
        process.once('beforeExit',code=>console.log(JSON.stringify({drained:true,code})));
        await import(${JSON.stringify(cli.href)});
      `;
      child=spawn(process.execPath,['--input-type=module','-e',source],{
        env:{PATH:process.env.PATH,DATABASE_URL:connection.href,PGAPPNAME:name,
          NODE_ENV:'test',CLOUD_MAIL_TRANSPORT:'local',CLOUD_EMAIL_ACTIVE_KEY_ID:'test',
          CLOUD_EMAIL_KEYS:JSON.stringify(db.keys)},
        stdio:['ignore','pipe','pipe'],
      });
      child.once('exit',()=>{exitedAt=performance.now();});
      child.stdout!.on('data',chunk=>{stdout+=chunk;});
      child.stderr!.on('data',chunk=>{stderr+=chunk;});
      exited=new Promise((resolve,reject)=>{
        child!.once('error',reject);
        child!.once('close',(code,signal)=>resolve({code,signal}));
      });
      async function blockedObservation(){
        return(await admin.query(`SELECT pid,query_start FROM pg_stat_activity WHERE application_name=$1
          AND state='active' AND wait_event_type='Lock' AND query LIKE 'SELECT * FROM venue_incidents%'
          AND $2=ANY(pg_blocking_pids(pid))`,[name,lockPid])).rows;
      }
      const deadline=performance.now()+6000;
      let blocked: {pid:number;query_start:Date}[]=[];
      while(performance.now()<deadline){
        blocked=await blockedObservation();
        if(blocked.length===1)break;
        assert.equal(exitedAt,null,`command exited before its observation: ${stderr}`);
        await delay(20);
      }
      assert.equal(blocked.length,1,'one real observation must wait on our incident-table lock');
      if(signal)assert.equal(child.kill(signal),true);
      await delay(1000);
      assert.equal(exitedAt,null,'shutdown must retain the observation for the full one-second hold');
      assert.equal(child.exitCode,null);
      assert.equal(child.signalCode,null);
      assert.deepEqual(await blockedObservation(),blocked,'the same owned query remains blocked after the signal');
      assert.deepEqual({stdout,stderr},{stdout:'',stderr:''},'no diagnostic precedes the timeout');
      await venue(later);
      assert.deepEqual((await db.pool.query('SELECT checked_at FROM venue_monitors ORDER BY venue_id')).rows,[{checked_at:null},{checked_at:null}]);
      // The incident lock stays held: PostgreSQL must end the query without external cancellation.
      const timeoutStarted=(await db.pool.query('SELECT clock_timestamp() AS now')).rows[0].now;
      const observationStarted=performance.now();
      let failures=1,secondQueryStarted:Date|undefined;
      if(!signal){
        const retryDeadline=performance.now()+13000;
        let retried:{pid:number;query_start:Date}[]=[];
        while(performance.now()<retryDeadline){
          retried=await blockedObservation();
          if(retried.length===1&&retried[0]!.query_start>blocked[0]!.query_start)break;
          assert.equal(exitedAt,null,`a timeout alone must not stop monitoring: ${stderr}`);
          await delay(20);
        }
        assert.equal(retried.length,1,'a later venue must be observed after the failure');
        assert.ok(retried[0]!.query_start>blocked[0]!.query_start,'monitoring must start a new observation after timeout');
        assert.deepEqual({stdout,stderr},{stdout:'',stderr:'Monitor observation failed; retrying\n'});
        assert.equal(child.kill('SIGTERM'),true);
        await delay(1000);
        assert.equal(exitedAt,null,'the retried observation stays live until timeout');
        assert.deepEqual(await blockedObservation(),retried);
        secondQueryStarted=retried[0]!.query_start;
        failures=2;
      }

      const timer=setTimeout(()=>child!.kill('SIGKILL'),13000);
      try{
        assert.deepEqual(await exited,{code:0,signal:null},'shutdown must finish normally after the observation timeout');
      }finally{clearTimeout(timer);}
      assert.ok(exitedAt!==null&&exitedAt>=observationStarted,'exit must follow the held observation');
      assert.deepEqual({stdout,stderr},{stdout:'{"drained":true,"code":0}\n',stderr:'Monitor observation failed; retrying\n'.repeat(failures)});
      const finishedAt=(await db.pool.query('SELECT clock_timestamp() AS now')).rows[0].now;
      const failed=(await db.pool.query('SELECT checked_at,next_check_at,contact_since FROM venue_monitors WHERE venue_id=$1',[first])).rows[0];
      assert.equal(failed.checked_at,null,'a timed-out observation must not commit a check');
      assert.equal(failed.contact_since,null,'a timed-out observation must not commit contact state');
      assert.ok(failed.next_check_at.getTime()>=blocked[0]!.query_start.getTime()+10000+30000,'the retry delay follows the ten-second observation timeout');
      // Allow one second for reporting the timeout and recording its retry.
      assert.ok(failed.next_check_at.getTime()<=blocked[0]!.query_start.getTime()+10000+30000+1000,'the first retry must follow a timeout of about ten seconds');
      assert.ok(failed.next_check_at.getTime()<=(secondQueryStarted??finishedAt).getTime()+30000,'the first retry must be within 30 seconds of the next observation or exit');
      const next=(await db.pool.query('SELECT checked_at,next_check_at FROM venue_monitors WHERE venue_id=$1',[later])).rows[0];
      assert.equal(next.checked_at,null,'the later venue must remain unchecked');
      if(signal)assert.ok(next.next_check_at<=timeoutStarted,'shutdown must not claim or defer the later due venue');
      else{
        assert.ok(next.next_check_at.getTime()>=secondQueryStarted!.getTime()+10000+30000,'the second timed-out observation must retain its 30-second retry delay');
        assert.ok(next.next_check_at.getTime()<=secondQueryStarted!.getTime()+10000+30000+1000,'the second retry must follow a timeout of about ten seconds');
        assert.ok(next.next_check_at.getTime()<=finishedAt.getTime()+30000,'the second retry must be scheduled no later than 30 seconds after shutdown finishes');
      }
      await lock.query('ROLLBACK');
      assert.equal((await db.pool.query('SELECT count(*) FROM venue_incidents')).rows[0].count,'0','timed-out observations leave no incidents');
      assert.equal((await db.pool.query('SELECT count(*) FROM venue_alert_episodes')).rows[0].count,'0');
      assert.equal((await db.pool.query('SELECT count(*) FROM email_outbox')).rows[0].count,'0');
      assert.deepEqual((await admin.query('SELECT pid,query_start FROM pg_stat_activity WHERE application_name=$1',[name])).rows,[],'no command database sessions remain');
    }finally{
      if(child&&exitedAt===null)child.kill('SIGKILL');
      if(exited)await exited;
      await lock.query('ROLLBACK');lock.release();
      await admin.end();await db.close();
    }
  });
}
