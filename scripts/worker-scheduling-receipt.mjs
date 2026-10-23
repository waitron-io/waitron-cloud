import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {cpus,arch,platform} from 'node:os';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {database} from '../packages/account-http/test/fixtures.ts';
import {EmailWorker} from '../packages/registration/src/email-outbox.ts';
import {MonitorWorker} from '../packages/registration/src/monitoring.ts';
import {runWorkerLoop} from '../packages/registration/src/worker-loop.ts';
import {BackupWorker} from '../packages/backups/src/worker.ts';
import {verifyWorkerSchedulingReceipt} from './verify-worker-scheduling-receipt.mjs';

const fixture={venues:1000,recipients:200,backupPoints:1000,emailWorkers:4,scheduleLimit:100};

function argumentsFor(argv){
  if(argv.length===2&&argv[0]==='--baseline')return{mode:'baseline',output:argv[1]};
  if(argv.length===3&&argv[0]==='--compare')return{mode:'compare',baseline:argv[1],output:argv[2]};
  throw new Error('Usage: worker-scheduling-receipt.mjs --baseline <output> | --compare <baseline> <output>');
}

async function seed(db){
  const organisationId=randomUUID(),businessId=randomUUID();
  await db.pool.query("INSERT INTO organisations(id,name) VALUES($1,'Worker fixture')",[organisationId]);
  await db.pool.query("INSERT INTO legal_businesses(id,organisation_id,name,country_code) VALUES($1,$2,'Worker fixture SL','ES')",[businessId,organisationId]);
  await db.pool.query('CREATE TABLE worker_fixture_accounts(n integer PRIMARY KEY,id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid())');
  await db.pool.query('INSERT INTO worker_fixture_accounts(n) SELECT generate_series(1,$1)',[fixture.recipients]);
  await db.pool.query('INSERT INTO cloud_accounts(id) SELECT id FROM worker_fixture_accounts');
  await db.pool.query("INSERT INTO cloud_credentials(account_id,email,email_verified_at) SELECT id,'worker-'||n||'@example.test',clock_timestamp() FROM worker_fixture_accounts");
  await db.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner) SELECT id,$1,true FROM worker_fixture_accounts',[organisationId]);
  await db.pool.query("INSERT INTO account_alert_preferences(account_id,enabled,locale) SELECT id,true,CASE WHEN n%2=0 THEN 'es' ELSE 'en' END FROM worker_fixture_accounts");
  await db.pool.query('CREATE TABLE worker_fixture_venues(n integer PRIMARY KEY,venue_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),installation_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),local_venue_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid())');
  await db.pool.query('INSERT INTO worker_fixture_venues(n) SELECT generate_series(1,$1)',[fixture.venues]);
  await db.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) SELECT venue_id,$1,$2,local_venue_id,'test' FROM worker_fixture_venues",[organisationId,businessId]);
  await db.pool.query("INSERT INTO installations(id,venue_id,public_key,last_contact_at) SELECT installation_id,venue_id,'worker-fixture-'||installation_id,clock_timestamp() FROM worker_fixture_venues");
  await db.pool.query("INSERT INTO installation_services(installation_id,service,state) SELECT installation_id,'remote_access','ready' FROM worker_fixture_venues");
  await db.pool.query("INSERT INTO backup_locations(venue_id,installation_id,endpoint,bucket,region) SELECT venue_id,installation_id,'https://storage.example.test','worker-'||n,'local' FROM worker_fixture_venues");
  await db.pool.query("INSERT INTO backup_key_versions(venue_id,version,sealed) SELECT venue_id,1,'fixture-sealed-key' FROM worker_fixture_venues");
  await db.pool.query('CREATE TABLE worker_fixture_points(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),venue_id uuid NOT NULL,installation_id uuid NOT NULL)');
  await db.pool.query('INSERT INTO worker_fixture_points(venue_id,installation_id) SELECT venue_id,installation_id FROM worker_fixture_venues ORDER BY n LIMIT $1',[fixture.backupPoints]);
  await db.pool.query('INSERT INTO backup_captures(id,venue_id,installation_id,key_version) SELECT id,venue_id,installation_id,1 FROM worker_fixture_points');
  await db.pool.query("INSERT INTO backup_points(id,venue_id,installation_id,key_version,kind,object_key,digest,size,captured_at,retention,source_node_id,modules) SELECT id,venue_id,installation_id,1,'snapshot',id::text,repeat('a',64),1,clock_timestamp(),'daily',gen_random_uuid(),'{}' FROM worker_fixture_points");
}

async function timed(action){
  const started=performance.now();
  const operations=await action();
  return{durationMs:performance.now()-started,operations};
}

async function measure(db,tuned){
  let peakRssBytes=process.memoryUsage().rss;
  const sampleMemory=()=>{peakRssBytes=Math.max(peakRssBytes,process.memoryUsage().rss);};
  const outbox=db.outbox,monitor=new MonitorWorker(db.pool,outbox);
  let maximumScheduleInsert=0;
  const monitorScheduling=await timed(async()=>{
    let total=0;
    for(;;){const count=await monitor.schedule();maximumScheduleInsert=Math.max(maximumScheduleInsert,count);total+=count;if(!count)return total;}
  });
  sampleMemory();
  const backup=new BackupWorker(db.pool,{},async()=>assert.fail('scheduling cannot verify'),'scheduling-receipt');
  const backupScheduling=await timed(async()=>{
    let total=0,previous={verify:0,retention:0,incoming:0};
    for(;;){
      const count=await backup.schedule(),rows=(await db.pool.query("SELECT kind,count(*)::integer AS count FROM backup_jobs GROUP BY kind")).rows;
      const current={verify:0,retention:0,incoming:0};for(const row of rows)current[row.kind]=row.count;
      for(const kind of Object.keys(current))maximumScheduleInsert=Math.max(maximumScheduleInsert,current[kind]-previous[kind]);
      previous=current;total+=count;if(!count)return total;
    }
  });
  const repeatedBackupStarted=performance.now();
  let repeatedBackupSweeps=0;
  if(tuned){
    const stop=new AbortController();
    await runWorkerLoop({signal:stop.signal,concurrency:1,scheduleIntervalMs:60000,pollIntervalMs:1000,now:()=>0,
      schedule:async()=>{repeatedBackupSweeps++;assert.equal(await backup.schedule(),0);},runOnce:async()=>false,wait:async()=>{stop.abort();}});
  }else for(let n=0;n<fixture.venues;n++){assert.equal(await backup.schedule(),0);repeatedBackupSweeps++;}
  backupScheduling.repeatedIdleSweeps=repeatedBackupSweeps;
  backupScheduling.repeatedIdleSweepDurationMs=performance.now()-repeatedBackupStarted;
  sampleMemory();

  const locked=(await db.pool.query('SELECT venue_id,installation_id FROM worker_fixture_venues ORDER BY venue_id LIMIT 1')).rows[0];
  await db.pool.query("UPDATE venue_monitors SET next_check_at=clock_timestamp()-interval '1 day' WHERE venue_id=$1",[locked.venue_id]);
  const lock=await db.secondPool.connect();await lock.query('BEGIN');await lock.query('SELECT id FROM installations WHERE id=$1 FOR UPDATE',[locked.installation_id]);
  let unlockedVenueCompleted=false;
  let pollScheduleSweeps=0;
  const monitorPolling=await timed(async()=>{
    let total=0;
    try{
     if(tuned){
      const stop=new AbortController();
      await runWorkerLoop({signal:stop.signal,concurrency:fixture.emailWorkers,scheduleIntervalMs:60000,pollIntervalMs:1000,now:()=>0,
       schedule:async()=>{pollScheduleSweeps++;await monitor.schedule();},runOnce:async()=>{const ran=await monitor.runOnce();if(ran)total++;return ran;},wait:async()=>{stop.abort();}});
     }else{
      await monitor.schedule();pollScheduleSweeps++;
      assert.equal(await monitor.runOnce(),true);total++;
      await monitor.schedule();pollScheduleSweeps++;
      assert.equal(await monitor.runOnce(),true);total++;
      for(;;){await monitor.schedule();pollScheduleSweeps++;if(!await monitor.runOnce())break;total++;}
     }
      unlockedVenueCompleted=Number((await db.pool.query('SELECT count(*) FROM venue_monitors WHERE venue_id<>$1 AND checked_at IS NOT NULL',[locked.venue_id])).rows[0].count)>0;
    }finally{await lock.query('ROLLBACK');lock.release();}
    return total;
  });
  monitorPolling.scheduleSweeps=pollScheduleSweeps;
  sampleMemory();

  const target=(await db.pool.query('SELECT venue_id,installation_id FROM worker_fixture_venues ORDER BY n LIMIT 1')).rows[0];
  await db.pool.query("UPDATE installations SET last_contact_at=clock_timestamp()-interval '16 minutes' WHERE id=$1",[target.installation_id]);
  await db.pool.query('UPDATE venue_monitors SET next_check_at=clock_timestamp() WHERE venue_id=$1',[target.venue_id]);
  const alertFanout=await timed(async()=>{assert.equal(await monitor.runOnce(),true);return Number((await db.pool.query("SELECT count(*) FROM email_outbox WHERE kind='service_alert'")).rows[0].count);});
  assert.equal(alertFanout.operations,fixture.recipients);
  const ciphertext=(await db.pool.query("SELECT payload FROM email_outbox WHERE kind='service_alert' LIMIT 1")).rows[0].payload;
  assert(!ciphertext.includes(Buffer.from('worker-1@example.test')));
  sampleMemory();

  const delivered=[];
  const mailer={async sendVerification(){},async sendPasswordReset(){},async sendPasswordChanged(){},async sendServiceAlert(message){delivered.push(message);}};
  const emailDelivery=await timed(async()=>{
    const worker=new EmailWorker(db.pool,outbox,mailer);
    let total=0;
    if(tuned){
      const stop=new AbortController();
      await runWorkerLoop({signal:stop.signal,concurrency:fixture.emailWorkers,scheduleIntervalMs:60000,pollIntervalMs:1000,
        runOnce:async()=>{const ran=await worker.runOnce();if(ran)total++;return ran;},wait:async()=>{stop.abort();}});
    }else while(await worker.runOnce())total++;
    return total;
  });
  const lag=await db.pool.query("SELECT extract(epoch FROM(max(finished_at)-min(created_at)))*1000 AS ms FROM email_outbox WHERE kind='service_alert'");
  emailDelivery.backlogLagMs=Number(lag.rows[0].ms);
  sampleMemory();

  await db.pool.query('UPDATE installations SET last_contact_at=clock_timestamp() WHERE id=$1',[target.installation_id]);
  await db.pool.query('UPDATE venue_monitors SET next_check_at=clock_timestamp() WHERE venue_id=$1',[target.venue_id]);
  assert.equal(await monitor.runOnce(),true);
  const restartWorker=new EmailWorker(db.pool,outbox,mailer);for(let n=0;n<Math.ceil(fixture.recipients/2);n++)assert.equal(await restartWorker.runOnce(),true);
  const resumedWorker=new EmailWorker(db.secondPool,outbox,mailer);while(await resumedWorker.runOnce()){}
  const restartRemaining=Number((await db.pool.query("SELECT count(*) FROM email_outbox WHERE status IN ('pending','processing')")).rows[0].count);

  const enqueue=async(email)=>{
    const client=await db.pool.connect();try{await client.query('BEGIN');const id=await outbox.enqueue(client,'password_changed',{email});await client.query('COMMIT');return id;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  };
  const firstId=await enqueue('shutdown-first@example.test'),secondId=await enqueue('shutdown-second@example.test');
  let enter,release;const entered=new Promise(resolve=>{enter=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  const shutdownMailer={...mailer,async sendPasswordChanged(message){if(message.email==='shutdown-first@example.test'){enter();await gate;}}};
  const shutdownWorker=new EmailWorker(db.pool,outbox,shutdownMailer,{sendTimeoutMs:5000}),controller=new AbortController();
  const loop=tuned?runWorkerLoop({signal:controller.signal,concurrency:1,scheduleIntervalMs:60000,pollIntervalMs:1,runOnce:()=>shutdownWorker.runOnce(),wait:milliseconds=>delay(milliseconds)}):(async()=>{while(!controller.signal.aborted){if(!await shutdownWorker.runOnce())await delay(1);}})();
  await entered;const stoppedAt=performance.now();controller.abort();await delay(10);release();await loop;
  const signalToStopMs=performance.now()-stoppedAt;
  const shutdownRows=await db.pool.query('SELECT id,status,attempts FROM email_outbox WHERE id=ANY($1::uuid[])',[ [firstId,secondId] ]);
  const first=shutdownRows.rows.find(row=>row.id===firstId),second=shutdownRows.rows.find(row=>row.id===secondId);
  assert.equal(first.status,'sent');
  const postSignalClaims=second.attempts;
  sampleMemory();

  const queued=Number((await db.pool.query("SELECT count(*) FROM email_outbox WHERE kind='service_alert'")).rows[0].count);
  const sent=Number((await db.pool.query("SELECT count(*) FROM email_outbox WHERE kind='service_alert' AND status='sent'")).rows[0].count);
  return{
    phases:{monitorScheduling,backupScheduling,monitorPolling,alertFanout,emailDelivery},
    correctness:{maximumScheduleInsert,unlockedVenueCompleted,restartRemaining,delivered:sent,queued},
    peakRssBytes,
    shutdown:{signalToStopMs,inFlightCompleted:first.status==='sent',postSignalClaims},
  };
}

const args=argumentsFor(process.argv.slice(2)),startRssBytes=process.memoryUsage().rss,db=await database();
try{
  await seed(db);
  const result=await measure(db,args.mode==='compare');
  const prior=args.mode==='compare'?verifyWorkerSchedulingReceipt(JSON.parse(await readFile(args.baseline,'utf8'))):undefined;
  const receipt={
    schemaVersion:1,mode:args.mode,fixture,
    machine:{platform:platform(),architecture:arch(),cpu:cpus()[0]?.model??'unknown',logicalCpus:cpus().length,node:process.version},
    baseline:prior?.baseline??result.phases,final:result.phases,correctness:result.correctness,
    memory:{startRssBytes,peakRssBytes:Math.max(startRssBytes,result.peakRssBytes)},shutdown:result.shutdown,
  };
  verifyWorkerSchedulingReceipt(receipt);
  await writeFile(args.output,JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({output:args.output,mode:args.mode,fixture,baseline:receipt.baseline,final:receipt.final,correctness:receipt.correctness,memory:receipt.memory,shutdown:receipt.shutdown}));
}finally{await db.close();}
