import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {test,before,after,beforeEach} from 'node:test';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {database} from '../../account-http/test/fixtures.ts';
import {SignupStore,RegistrationStore,EmailWorker} from '../src/index.ts';
import {MonitorWorker} from '../src/monitoring.ts';
let db:Awaited<ReturnType<typeof database>>,monitor:MonitorWorker;
let owner:{accountId:string;organisationId:string;legalBusinessId:string},venue:{installationId:string;venueId:string};
const sent:unknown[]=[];
before(async()=>{db=await database();});after(async()=>db?.close());
beforeEach(async()=>{
 await db.pool.query('TRUNCATE signup_requests,email_outbox,organisations,cloud_accounts,remote_cells CASCADE');sent.length=0;
 const signup=new SignupStore(db.pool,db.outbox);await signup.request('monitor@example.test');
 const mail=db.outbox.open((await db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert('token' in mail);
 owner=await signup.complete(mail.token,{password:'A sufficiently long password',organisationName:'Sol',legalBusinessName:'Sol SL',countryCode:'ES'});
 const r=new RegistrationStore(db.pool),binding={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
 await r.start(binding);await r.approveCloud(binding,owner.accountId);await r.approveLocal(binding,randomUUID());venue=await r.complete(binding);
 await db.pool.query("UPDATE installation_services SET state='ready' WHERE installation_id=$1 AND service='remote_access'",[venue.installationId]);
 await db.pool.query("INSERT INTO account_alert_preferences(account_id,enabled,locale) VALUES($1,true,'en')",[owner.accountId]);
 monitor=new MonitorWorker(db.pool,db.outbox);
});
async function due(){await db.pool.query('UPDATE venue_monitors SET next_check_at=clock_timestamp()');}
async function contact(seconds:number){await db.pool.query("UPDATE installations SET last_contact_at=clock_timestamp()-$1*interval '1 second' WHERE id=$2",[seconds,venue.installationId]);await due();}
async function alerts(){return(await db.pool.query("SELECT * FROM email_outbox WHERE kind='service_alert' ORDER BY created_at,id")).rows;}
async function deliver(){const worker=new EmailWorker(db.pool,db.outbox,{async sendVerification(){},async sendPasswordReset(){},async sendPasswordChanged(){},async sendServiceAlert(message:unknown){sent.push(message);}});for(let n=0;n<20&&await worker.runOnce();n++);}
test('fresh configured venues have one concurrent observation and no warning mail',async()=>{
 await Promise.all([monitor.schedule(),monitor.schedule()]);
 const other=new MonitorWorker(db.secondPool,db.outbox);
 assert.equal((await Promise.all([monitor.runOnce(),other.runOnce()])).filter(Boolean).length,1);
 assert.equal((await db.pool.query('SELECT count(*) FROM venue_monitors')).rows[0].count,'1');
 assert.equal((await alerts()).length,0);assert.equal((await monitor.status()).due,0);
});
test('contact threshold persists one opening and suppresses repeated scans across restart',async()=>{
 await monitor.schedule();await contact(899);await monitor.runOnce();assert.equal((await alerts()).length,0);
 await contact(901);await monitor.runOnce();assert.equal((await alerts()).length,1);
 const message=db.outbox.open((await alerts())[0]);assert('issue' in message);assert.equal(message.issue,'disconnected');
 monitor=new MonitorWorker(db.secondPool,db.outbox);await due();await monitor.runOnce();assert.equal((await alerts()).length,1);
});
test('recovery mail follows a sent opening and a later failure opens a new revision',async()=>{
 await monitor.schedule();await contact(901);await monitor.runOnce();await deliver();assert.equal(sent.length,1);
 await contact(0);await monitor.runOnce();await deliver();assert.equal(sent.length,2);
 assert.equal((sent[1] as {state:string}).state,'recovered');
 await contact(901);await monitor.runOnce();await deliver();assert.equal(sent.length,3);
 assert.equal(new Set((await alerts()).map(r=>r.id)).size,3);
});
test('an undelivered opening is cancelled on recovery without sending a recovery mail',async()=>{
 await monitor.schedule();await contact(901);await monitor.runOnce();await contact(0);await monitor.runOnce();await deliver();
 assert.equal(sent.length,0);assert.equal((await alerts()).length,1);assert.equal((await alerts())[0].status,'cancelled');
});
for(const change of ['owner','preference','disabled','email','verified','revoked','service'])test('queued alert cancels after an earlier '+change+' change',async()=>{
 await monitor.schedule();await contact(901);await monitor.runOnce();
 const changes={
  owner:"UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1",
  preference:"UPDATE account_alert_preferences SET enabled=false WHERE account_id=$1",
  disabled:"UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1",
  email:"UPDATE cloud_credentials SET email='changed@example.test' WHERE account_id=$1",
  verified:"UPDATE cloud_credentials SET email_verified_at=NULL WHERE account_id=$1",
  revoked:"UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1",
  service:"UPDATE installation_services SET state='unconfigured' WHERE installation_id=$1",
 };
 await db.pool.query(changes[change as keyof typeof changes],[['revoked','service'].includes(change)?venue.installationId:owner.accountId]);
 await deliver();assert.equal(sent.length,0);assert.equal((await alerts())[0].status,'cancelled');
});

test('the alert migration preserves outbox failure and claim constraints',async()=>{
 await assert.rejects(db.pool.query('UPDATE email_outbox SET failures=attempts+1'),/check constraint/);
 await assert.rejects(db.pool.query("UPDATE email_outbox SET status='processing'"),/check constraint/);
});
async function snapshot(verification:string,seconds=0){
 const id=randomUUID();
 await db.pool.query("INSERT INTO backup_locations(venue_id,installation_id,endpoint,bucket,region) VALUES($1,$2,'https://store.test','monitor','local') ON CONFLICT DO NOTHING",[venue.venueId,venue.installationId]);
 await db.pool.query("INSERT INTO backup_key_versions(venue_id,version,sealed) VALUES($1,1,'test-only-unused-key') ON CONFLICT DO NOTHING",[venue.venueId]);
 await db.pool.query('INSERT INTO backup_captures(id,venue_id,installation_id,key_version) VALUES($1,$2,$3,1)',[id,venue.venueId,venue.installationId]);
 await db.pool.query("INSERT INTO backup_points(id,venue_id,installation_id,key_version,kind,object_key,digest,size,captured_at,retention,source_node_id,modules,verification) VALUES($1,$2,$3,1,'snapshot',$1::uuid::text,$4,1,clock_timestamp()-$5*interval '1 second','daily',$6,'{}',$7)",[id,venue.venueId,venue.installationId,'a'.repeat(64),seconds,randomUUID(),verification]);return id;
}
async function kinds(){return(await db.pool.query("SELECT kind FROM venue_incidents WHERE status='open' ORDER BY kind")).rows.map(r=>r.kind);}
async function remoteRoute(){
 const cell=randomUUID();
 await db.pool.query("INSERT INTO remote_cells(id,country,provider,environment,suffix,subnet,public_key,endpoint) VALUES($1,'ES','aws','test','monitor.example.test',55,'fixture-key','gateway.example.test:51820')",[cell]);
 await db.pool.query("INSERT INTO remote_placements(venue_id,installation_id,cell_id,address,peer_public_key,port) VALUES($1,$2,$3,'10.77.55.2','fixture-peer',443)",[venue.venueId,venue.installationId,cell]);
 await db.pool.query("INSERT INTO remote_hostnames(hostname,venue_id,kind) VALUES('staff.monitor.example.test',$1,'staff'),('public.monitor.example.test',$1,'public')",[venue.venueId]);
}
async function remoteObservation(service:'public'|'staff',status:'healthy'|'failed',secondsOld=0,certificateDays=31){
 const hostname=`${service}.monitor.example.test`,failure=status==='failed'?'timeout':null;
 await db.pool.query(`INSERT INTO remote_probe_observations
  (installation_id,venue_id,service,configuration_revision,hostname,status,checked_at,elapsed_ms,failure,certificate_not_before,certificate_not_after,certificate_fingerprint256,last_success_at,last_failure_at,last_failure)
  VALUES($1,$2,$3,0,$4,$5,clock_timestamp()-$6*interval '1 second',12,$7,
   CASE WHEN $5='healthy' THEN clock_timestamp()-interval '1 day' END,
   CASE WHEN $5='healthy' THEN clock_timestamp()+$8*interval '1 day' END,
   CASE WHEN $5='healthy' THEN 'AA:BB' END,
   CASE WHEN $5='healthy' THEN clock_timestamp()-$6*interval '1 second' END,
   CASE WHEN $5='failed' THEN clock_timestamp()-$6*interval '1 second' END,$7)
  ON CONFLICT(installation_id,service) DO UPDATE SET status=excluded.status,checked_at=excluded.checked_at,failure=excluded.failure,
   certificate_not_before=COALESCE(excluded.certificate_not_before,remote_probe_observations.certificate_not_before),
   certificate_not_after=COALESCE(excluded.certificate_not_after,remote_probe_observations.certificate_not_after),
   certificate_fingerprint256=COALESCE(excluded.certificate_fingerprint256,remote_probe_observations.certificate_fingerprint256)`,[venue.installationId,venue.venueId,service,hostname,status,secondsOld,failure,certificateDays]);
}
test('missing-snapshot grace and failed-verification grace use independent durable clocks',async()=>{
 await db.pool.query("UPDATE installation_services SET state='ready' WHERE service='retained_snapshots'");
 await monitor.schedule();await contact(0);await monitor.runOnce();assert.deepEqual(await kinds(),[]);
 await db.pool.query("UPDATE venue_monitors SET snapshot_since=clock_timestamp()-interval '47 hours 59 minutes 59 seconds'");await due();await monitor.runOnce();assert.deepEqual(await kinds(),[]);
 await db.pool.query("UPDATE venue_monitors SET snapshot_since=clock_timestamp()-interval '48 hours 1 second'");await due();await monitor.runOnce();assert.deepEqual(await kinds(),['snapshot_stale']);
 const good=await snapshot('verified',5);await due();await monitor.runOnce();assert.deepEqual(await kinds(),[]);
 const bad=await snapshot('failed');await due();await monitor.runOnce();assert.deepEqual(await kinds(),[]);
 await db.pool.query("UPDATE venue_monitors SET failure_since=clock_timestamp()-interval '299 seconds'");await due();await monitor.runOnce();assert.deepEqual(await kinds(),[]);
 await db.pool.query("UPDATE venue_monitors SET failure_since=clock_timestamp()-interval '301 seconds'");await due();await monitor.runOnce();assert.deepEqual(await kinds(),['verification_failed']);
 await db.pool.query("UPDATE backup_points SET verification='verified' WHERE id=$1",[bad]);await due();await monitor.runOnce();assert.deepEqual(await kinds(),[]);
 await db.pool.query("UPDATE backup_points SET deleting=true WHERE id=$1",[bad]);await db.pool.query("UPDATE backup_points SET captured_at=clock_timestamp()-interval '48 hours 1 second' WHERE id=$1",[good]);await due();await monitor.runOnce();assert.deepEqual(await kinds(),['snapshot_stale']);
});
test('revocation suppresses an open incident without a recovery notice',async()=>{
 await monitor.schedule();await contact(901);await monitor.runOnce();await deliver();
 await db.pool.query('UPDATE installations SET revoked_at=clock_timestamp()');await due();await monitor.runOnce();await deliver();
 assert.deepEqual(await kinds(),[]);assert.equal(sent.length,1);assert.equal((await alerts()).length,1);
 assert.equal((await db.pool.query('SELECT status FROM venue_incidents')).rows[0].status,'suppressed');
});
test('unconfigured and production installations are not scheduled; stale checks become unknown',async()=>{
 await db.pool.query("UPDATE installation_services SET state='unconfigured'");assert.equal(await monitor.schedule(),0);
 await db.pool.query("UPDATE installation_services SET state='ready' WHERE service='remote_access'");await db.pool.query("UPDATE venues SET environment='production'");assert.equal(await monitor.schedule(),0);
 await db.pool.query("UPDATE venues SET environment='test'");assert.equal(await monitor.schedule(),1);assert.equal((await monitor.status()).unknown,1);
 await monitor.runOnce();assert.equal((await monitor.status()).unknown,0);
 await db.pool.query("UPDATE venue_monitors SET checked_at=clock_timestamp()-interval '5 minutes 1 second'");assert.equal((await monitor.status()).unknown,1);
});

test('remote evidence records unknown, failure, recovery, certificate expiry and revocation independently of contact',async()=>{
 await db.pool.query('UPDATE account_alert_preferences SET enabled=false');
 await remoteRoute();await monitor.schedule();await contact(0);await monitor.runOnce();
 assert.deepEqual(await kinds(),['public_probe_stale','staff_probe_stale']);assert.equal((await alerts()).length,0);

 await remoteObservation('public','failed');await remoteObservation('staff','healthy');await due();await monitor.runOnce();
 assert.deepEqual(await kinds(),['public_route_failed']);assert.equal((await alerts()).length,0);
 assert.equal((await db.pool.query('SELECT last_contact_at>clock_timestamp()-interval \'5 seconds\' AS fresh FROM installations WHERE id=$1',[venue.installationId])).rows[0].fresh,true);

 await remoteObservation('public','healthy');await due();const restarted=new MonitorWorker(db.pool,db.outbox);await restarted.runOnce();assert.deepEqual(await kinds(),[]);
 await db.pool.query("UPDATE remote_probe_observations SET checked_at=clock_timestamp()-interval '301 seconds'");await due();await restarted.runOnce();assert.deepEqual(await kinds(),['public_probe_stale','staff_probe_stale']);

 await remoteObservation('public','healthy',0,-1);await remoteObservation('staff','healthy',0,29);await due();
 const concurrent=new MonitorWorker(db.secondPool,db.outbox,{probeStaleSeconds:300,certificateWarningDays:30});
 await db.pool.query(`CREATE TABLE remote_incident_gate(id integer PRIMARY KEY);INSERT INTO remote_incident_gate VALUES(1);
  CREATE FUNCTION pause_remote_incident() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM id FROM remote_incident_gate WHERE id=1 FOR UPDATE;RETURN NEW;END $$;
  CREATE TRIGGER pause_remote_incident BEFORE INSERT ON venue_incidents FOR EACH ROW EXECUTE FUNCTION pause_remote_incident()`);
 const gate=await db.secondPool.connect();let released=false,first:Promise<boolean>|undefined;
 try{
  await gate.query('BEGIN');await gate.query('SELECT id FROM remote_incident_gate WHERE id=1 FOR UPDATE');first=restarted.runOnce();let blocked=false;
  for(let n=0;n<100;n++){const waiting=await db.pool.query("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'INSERT INTO venue_incidents%'");if(Number(waiting.rows[0].count)){blocked=true;break;}await delay(10);}
  assert.equal(blocked,true);assert.equal(await concurrent.runOnce(),false);await gate.query('COMMIT');released=true;assert.equal(await first,true);
 }finally{
  if(!released)await gate.query('ROLLBACK');gate.release();await first?.catch(()=>{});
  await db.pool.query('DROP TRIGGER IF EXISTS pause_remote_incident ON venue_incidents;DROP FUNCTION IF EXISTS pause_remote_incident();DROP TABLE IF EXISTS remote_incident_gate');
 }
 assert.deepEqual(await kinds(),['public_certificate_expiring','staff_certificate_expiring']);
 const revisions=await db.pool.query("SELECT kind,revision FROM venue_incidents WHERE kind LIKE '%certificate_expiring' ORDER BY kind");assert.deepEqual(revisions.rows.map(row=>[row.kind,row.revision]),[['public_certificate_expiring',1],['staff_certificate_expiring',1]]);
 assert.throws(()=>new MonitorWorker(db.pool,db.outbox,{probeStaleSeconds:0}),/invalid_monitor_config/);

 await remoteObservation('public','failed');await due();await restarted.runOnce();assert.deepEqual(await kinds(),['public_certificate_expiring','public_route_failed','staff_certificate_expiring']);
 await remoteObservation('public','healthy',0,-1);await db.pool.query("UPDATE installation_services SET state='unconfigured' WHERE installation_id=$1 AND service='remote_access'",[venue.installationId]);await due();await restarted.runOnce();assert.deepEqual(await kinds(),[]);
 await db.pool.query("UPDATE installation_services SET state='ready' WHERE installation_id=$1 AND service='remote_access'",[venue.installationId]);await due();await restarted.runOnce();assert.deepEqual(await kinds(),['public_certificate_expiring','staff_certificate_expiring']);
 const hostnames=(await db.pool.query('DELETE FROM remote_hostnames WHERE venue_id=$1 RETURNING *',[venue.venueId])).rows,placement=(await db.pool.query('DELETE FROM remote_placements WHERE installation_id=$1 RETURNING *',[venue.installationId])).rows[0];await due();await restarted.runOnce();assert.deepEqual(await kinds(),[]);
 await db.pool.query('INSERT INTO remote_placements(venue_id,installation_id,cell_id,address,peer_public_key,port,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[placement.venue_id,placement.installation_id,placement.cell_id,placement.address,placement.peer_public_key,placement.port,placement.created_at]);
 for(const hostname of hostnames)await db.pool.query('INSERT INTO remote_hostnames(hostname,venue_id,kind) VALUES($1,$2,$3)',[hostname.hostname,hostname.venue_id,hostname.kind]);
 await due();await restarted.runOnce();assert.deepEqual(await kinds(),['public_certificate_expiring','staff_certificate_expiring']);

 await db.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[venue.installationId]);await due();await restarted.runOnce();
 assert.deepEqual(await kinds(),[]);assert.equal((await db.pool.query("SELECT count(*) FROM venue_incidents WHERE kind LIKE 'public_%' OR kind LIKE 'staff_%'")).rows[0].count,'5');
 assert.equal((await db.pool.query("SELECT count(*) FROM venue_incidents WHERE (kind LIKE 'public_%' OR kind LIKE 'staff_%') AND status<>'suppressed'")).rows[0].count,'0');
});

test('remote alerts deduplicate transitions and recheck opt-in, route and revocation before delivery',async()=>{
 await remoteRoute();await remoteObservation('public','failed');await remoteObservation('staff','healthy');await monitor.schedule();await contact(0);await monitor.runOnce();
 let rows=await alerts();assert.equal(rows.length,1);let opened=db.outbox.open(rows[0]);assert('issue' in opened);assert.equal(opened.issue,'public_route_failed');assert.equal(opened.state,'open');assert.equal(typeof opened.checkedAt,'string');
 await due();await monitor.runOnce();assert.equal((await alerts()).length,1);await deliver();assert.equal(sent.length,1);
 await remoteObservation('public','healthy');await due();await monitor.runOnce();await deliver();assert.equal(sent.length,2);assert.equal((sent[1] as {state:string}).state,'recovered');

 await remoteObservation('public','failed');await due();await monitor.runOnce();await db.pool.query('UPDATE account_alert_preferences SET enabled=false');await deliver();
 rows=await alerts();assert.equal(rows.length,3);assert.equal(rows[2].status,'cancelled');assert.equal(sent.length,2);
 await db.pool.query('UPDATE account_alert_preferences SET enabled=true');await remoteObservation('public','healthy');await due();await monitor.runOnce();assert.equal((await alerts()).length,3);

 await remoteObservation('public','failed');await due();await monitor.runOnce();const hostnames=(await db.pool.query('DELETE FROM remote_hostnames WHERE venue_id=$1 RETURNING *',[venue.venueId])).rows,placement=(await db.pool.query('DELETE FROM remote_placements WHERE installation_id=$1 RETURNING *',[venue.installationId])).rows[0];await deliver();
 rows=await alerts();assert.equal(rows.length,4);assert.equal(rows[3].status,'cancelled');assert.equal(sent.length,2);
 await db.pool.query('INSERT INTO remote_placements(venue_id,installation_id,cell_id,address,peer_public_key,port,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[placement.venue_id,placement.installation_id,placement.cell_id,placement.address,placement.peer_public_key,placement.port,placement.created_at]);
 for(const hostname of hostnames)await db.pool.query('INSERT INTO remote_hostnames(hostname,venue_id,kind) VALUES($1,$2,$3)',[hostname.hostname,hostname.venue_id,hostname.kind]);
 await remoteObservation('public','healthy');await due();await monitor.runOnce();await remoteObservation('public','failed');await due();await monitor.runOnce();await db.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[venue.installationId]);await deliver();
 rows=await alerts();assert.equal(rows.length,5);assert.equal(rows[4].status,'cancelled');assert.equal(sent.length,2);
});

test('monitor CLI observes durable incidents and reports status without sending mail',async()=>{
 const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options','-c search_path='+db.schema);
 const run=async(mode:string)=>JSON.parse((await promisify(execFile)(process.execPath,['packages/registration/src/monitor-cli.ts',mode],{cwd:new URL('../../../',import.meta.url),env:{PATH:process.env.PATH,DATABASE_URL:url.href,...(mode==='--once'?{CLOUD_EMAIL_KEYS:JSON.stringify(db.keys),CLOUD_EMAIL_ACTIVE_KEY_ID:'test'}:{})}})).stdout);
 assert.equal((await run('--status')).venues,0);await contact(901);await run('--once');
 assert.equal((await run('--status')).incidents,1);assert.equal((await alerts()).length,1);assert.equal((await alerts())[0].status,'pending');
 assert.equal((await run('--once')).incidents,1);assert.equal((await alerts()).length,1);
 await assert.rejects(promisify(execFile)(process.execPath,['packages/registration/src/monitor-cli.ts','--once'],{cwd:new URL('../../../',import.meta.url),env:{PATH:process.env.PATH,DATABASE_URL:url.href,CLOUD_EMAIL_KEYS:JSON.stringify(db.keys),CLOUD_EMAIL_ACTIVE_KEY_ID:'test',CLOUD_REMOTE_PROBE_STALE_SECONDS:'0'}}),error=>typeof error==='object'&&error!==null&&'stderr' in error&&String(error.stderr).includes('remote monitoring threshold configuration'));
});
test('incident creation rolls back if mail enqueue fails, then resumes exactly once',async()=>{
 await monitor.schedule();await contact(901);
 await db.pool.query("ALTER TABLE email_outbox ADD CONSTRAINT fixture_reject_alert CHECK(kind<>'service_alert')");
 try{await assert.rejects(monitor.runOnce(),/check constraint/);assert.equal((await db.pool.query('SELECT count(*) FROM venue_incidents')).rows[0].count,'0');assert.equal((await db.pool.query('SELECT checked_at FROM venue_monitors')).rows[0].checked_at,null);}
 finally{await db.pool.query('ALTER TABLE email_outbox DROP CONSTRAINT fixture_reject_alert');}
 assert.equal((await db.pool.query('SELECT next_check_at>clock_timestamp() AS delayed FROM venue_monitors')).rows[0].delayed,true);
 await due();const other=new MonitorWorker(db.secondPool,db.outbox);await Promise.all([monitor.runOnce(),other.runOnce()]);assert.equal((await alerts()).length,1);
});
test('opting in during an incident waits for future transitions and delivery retries do not queue duplicates',async()=>{
 await db.pool.query('UPDATE account_alert_preferences SET enabled=false');await monitor.schedule();await contact(901);await monitor.runOnce();assert.equal((await alerts()).length,0);
 await db.pool.query('UPDATE account_alert_preferences SET enabled=true');await due();await monitor.runOnce();assert.equal((await alerts()).length,0);
 await contact(0);await monitor.runOnce();assert.equal((await alerts()).length,0);
 await contact(901);await monitor.runOnce();
 const worker=new EmailWorker(db.pool,db.outbox,{async sendVerification(){},async sendPasswordReset(){},async sendPasswordChanged(){},async sendServiceAlert(){throw Error('private-provider-detail');}});
 for(let n=0;n<10&&await worker.runOnce();n++);
 const row=(await alerts())[0];assert.equal(row.status,'pending');assert.equal(row.failures,1);assert.equal(row.last_error,'delivery_failed');assert(!JSON.stringify(row).includes('private-provider-detail'));
 await due();await monitor.runOnce();assert.equal((await alerts()).length,1);
});
test('an ownership change during the final queue wait prevents transport dispatch',async()=>{
 await monitor.schedule();await contact(901);await monitor.runOnce();
 const worker=new EmailWorker(db.pool,db.outbox,{async sendVerification(){},async sendPasswordReset(){},async sendPasswordChanged(){},async sendServiceAlert(message:unknown){sent.push(message);}});
 await worker.runOnce();
 let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;});
 const original=db.pool.query;
 db.pool.query=(async(...args:unknown[])=>{
  if(typeof args[0]==='string'&&args[0].startsWith('SELECT expires_at > clock_timestamp() AS live FROM email_outbox')){entered();await gate;}
  return Reflect.apply(original,db.pool,args);
 }) as typeof db.pool.query;
 const pending=worker.runOnce();
 try{await started;await db.secondPool.query('UPDATE organisation_memberships SET is_owner=false');}
 finally{release();await pending;db.pool.query=original;}
 assert.equal(sent.length,0);assert.equal((await alerts())[0].status,'cancelled');
});
test('a new owner receives no recovery for an opening sent to a former owner',async()=>{
 await monitor.schedule();await contact(901);await monitor.runOnce();await deliver();assert.equal(sent.length,1);
 const signup=new SignupStore(db.pool,db.outbox);await signup.request('new-owner@example.test');const mail=db.outbox.open((await db.pool.query('SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT 1')).rows[0]);assert('token' in mail);
 const next=await signup.complete(mail.token,{password:'A sufficiently long password',organisationName:'Luna',legalBusinessName:'Luna SL',countryCode:'ES'});
 await db.pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',[owner.accountId]);
 await db.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner) VALUES($1,$2,true)',[next.accountId,owner.organisationId]);
 await db.pool.query("INSERT INTO account_alert_preferences(account_id,enabled,locale) VALUES($1,true,'es')",[next.accountId]);
 await contact(0);await monitor.runOnce();await deliver();assert.equal(sent.length,1);assert.equal((await alerts()).length,1);
});
test('changing email language preserves the queued alert and renders the current preference',async()=>{
 await monitor.schedule();await contact(901);await monitor.runOnce();await db.pool.query("UPDATE account_alert_preferences SET locale='es'");await deliver();
 assert.equal(sent.length,1);assert.equal((sent[0] as {locale:string}).locale,'es');assert.equal((await alerts())[0].status,'sent');
});
test('continuous monitoring skips locked installations and survives a failed observation',async()=>{
 const r=new RegistrationStore(db.pool),binding={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
 await r.start(binding);await r.approveCloud(binding,owner.accountId);await r.approveLocal(binding,randomUUID());const other=await r.complete(binding);
 await db.pool.query("UPDATE installation_services SET state='ready' WHERE installation_id=$1 AND service='remote_access'",[other.installationId]);
 await monitor.schedule();await contact(901);await db.pool.query("UPDATE venue_monitors SET next_check_at=clock_timestamp()-interval '1 day' WHERE venue_id=$1",[venue.venueId]);
 const lock=await db.secondPool.connect();await lock.query('BEGIN');await lock.query('SELECT id FROM installations WHERE id=$1 FOR UPDATE',[venue.installationId]);
 const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options','-c search_path='+db.schema);
 const child=spawn(process.execPath,['packages/registration/src/monitor-cli.ts'],{cwd:new URL('../../../',import.meta.url),env:{PATH:process.env.PATH,DATABASE_URL:url.href,CLOUD_EMAIL_KEYS:JSON.stringify(db.keys),CLOUD_EMAIL_ACTIVE_KEY_ID:'test'},stdio:['ignore','ignore','pipe']});
 let errors='';child.stderr.on('data',v=>{errors+=String(v);});const exited=new Promise<number|null>(resolve=>child.once('exit',resolve));
 const observed=async()=>{for(let n=0;n<100;n++){if((await db.pool.query('SELECT checked_at FROM venue_monitors WHERE venue_id=$1',[other.venueId])).rows[0].checked_at)return true;if(child.exitCode!==null)return false;await new Promise(r=>setTimeout(r,50));}return false;};
 let unlocked=false;
 try{
  assert(await observed(),'A locked installation must not block another venue');assert.equal(child.exitCode,null);
  await lock.query('COMMIT');unlocked=true;
  await db.pool.query("ALTER TABLE email_outbox ADD CONSTRAINT fixture_fail_alert CHECK(kind<>'service_alert')");
  await db.pool.query("UPDATE venue_monitors SET checked_at=NULL,next_check_at=clock_timestamp() WHERE venue_id=$1",[other.venueId]);
  await db.pool.query("UPDATE venue_monitors SET next_check_at=clock_timestamp()-interval '1 day' WHERE venue_id=$1",[venue.venueId]);
  for(let n=0;n<100&&!errors.includes('retrying');n++){if(child.exitCode!==null)break;await new Promise(r=>setTimeout(r,50));}
  assert(errors.includes('retrying'),'A failed observation must enter retry backoff');assert.equal(child.exitCode,null);
  await db.pool.query("UPDATE venue_monitors SET checked_at=NULL,next_check_at=clock_timestamp() WHERE venue_id=$1",[other.venueId]);assert(await observed());
  assert.equal((await db.pool.query('SELECT checked_at FROM venue_monitors WHERE venue_id=$1',[venue.venueId])).rows[0].checked_at,null);
  assert.equal((await db.pool.query('SELECT count(*) FROM venue_incidents')).rows[0].count,'0');
 }finally{
  if(!unlocked)await lock.query('ROLLBACK');lock.release();child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),3000);try{await exited;}finally{clearTimeout(timer);}
  await db.pool.query('ALTER TABLE email_outbox DROP CONSTRAINT IF EXISTS fixture_fail_alert');
 }
});
