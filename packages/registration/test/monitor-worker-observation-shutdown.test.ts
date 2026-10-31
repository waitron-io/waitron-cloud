import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {Pool} from 'pg';
import {database} from '../../account-http/test/fixtures.ts';

// Missing signal handlers, forced exit or a new claim after shutdown must fail these checks.
for(const signal of ['SIGINT','SIGTERM'] as const){
  test(`${signal} finishes an active monitoring observation without claiming a later venue`,async()=>{
    const db=await database();
    const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL,statement_timeout:3000});
    const lock=await db.secondPool.connect();
    const name=`monitor_observation_${randomUUID()}`;
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
        return(await admin.query(`SELECT pid FROM pg_stat_activity WHERE application_name=$1
          AND state='active' AND wait_event_type='Lock' AND query LIKE 'SELECT * FROM venue_incidents%'
          AND $2=ANY(pg_blocking_pids(pid))`,[name,lockPid])).rows;
      }
      const deadline=performance.now()+6000;
      let blocked: {pid:number}[]=[];
      while(performance.now()<deadline){
        blocked=await blockedObservation();
        if(blocked.length===1)break;
        assert.equal(exitedAt,null,`command exited before its observation: ${stderr}`);
        await delay(20);
      }
      assert.equal(blocked.length,1,'one real observation must wait on our incident-table lock');
      assert.equal(child.kill(signal),true);
      await delay(1000);
      assert.equal(exitedAt,null,'shutdown must retain the observation for the full one-second hold');
      assert.equal(child.exitCode,null);
      assert.equal(child.signalCode,null);
      assert.deepEqual(await blockedObservation(),blocked,'the same owned query remains blocked after the signal');
      await venue(later);
      assert.deepEqual((await db.pool.query('SELECT checked_at FROM venue_monitors ORDER BY venue_id')).rows,[{checked_at:null},{checked_at:null}]);
      const releasedAt=performance.now();
      await lock.query('ROLLBACK');
      const timer=setTimeout(()=>child!.kill('SIGKILL'),6000);
      try{
        assert.deepEqual(await exited,{code:0,signal:null},'shutdown must finish normally after the observation');
      }finally{clearTimeout(timer);}
      assert.ok(exitedAt!==null&&exitedAt>=releasedAt,'exit must follow lock release');
      assert.deepEqual({stdout,stderr},{stdout:'{"drained":true,"code":0}\n',stderr:''});
      const completed=(await db.pool.query('SELECT checked_at,next_check_at,contact_since FROM venue_monitors WHERE venue_id=$1',[first])).rows[0];
      assert.ok(completed.checked_at instanceof Date,'the active observation must commit before exit');
      assert.ok(completed.contact_since instanceof Date);
      assert.ok(completed.next_check_at>completed.checked_at,'the observed venue must be rescheduled');
      assert.equal((await db.pool.query('SELECT checked_at FROM venue_monitors WHERE venue_id=$1',[later])).rows[0].checked_at,null,'shutdown must not claim the later due venue');
      assert.deepEqual((await db.pool.query('SELECT venue_id,kind,status,revision FROM venue_incidents')).rows,[{venue_id:first,kind:'disconnected',status:'open',revision:1}]);
      assert.deepEqual((await db.pool.query('SELECT status FROM venue_alert_episodes')).rows,[{status:'open'}]);
      assert.equal((await db.pool.query('SELECT count(*) FROM email_outbox')).rows[0].count,'0');
      assert.deepEqual((await admin.query('SELECT pid FROM pg_stat_activity WHERE application_name=$1',[name])).rows,[],'no command database sessions remain');
    }finally{
      if(child&&exitedAt===null)child.kill('SIGKILL');
      if(exited)await exited;
      await lock.query('ROLLBACK');lock.release();
      await admin.end();await db.close();
    }
  });
}
