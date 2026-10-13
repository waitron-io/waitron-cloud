import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {migrationRelease} from './fixtures/migration-release.ts';
import {migrate} from '../src/migrate.ts';
import {test,before,after,beforeEach} from 'node:test';
import {randomUUID,generateKeyPairSync,createCipheriv,randomBytes} from 'node:crypto';
import {database} from '../../account-http/test/fixtures.ts';
import {SignupStore,RegistrationStore,InstallationStore,createLeaseIssuer} from '../src/index.ts';
import {MonitorWorker} from '../src/monitoring.ts';
import {EmailWorker} from '../src/email-outbox.ts';
import {HistoryCleanup} from '../src/history-cleanup.ts';
import {UsageReconciler} from '../src/usage-metering.ts';
import {EmailDeliveryError} from '../src/email-delivery.ts';
import type {ServiceAlert} from '../src/service-alert.ts';
import {venueOverview} from '../../account-http/src/venue-overview.ts';
import {createSession} from '@waitron-cloud/identity';
import {transaction} from '../src/transaction.ts';
let db:Awaited<ReturnType<typeof database>>,monitor:MonitorWorker;
let owner:{accountId:string;organisationId:string;legalBusinessId:string},venue:{installationId:string;venueId:string};
before(async()=>{db=await database();});after(async()=>db?.close());
beforeEach(async()=>{
 await db.pool.query('TRUNCATE signup_requests,email_outbox,organisations,cloud_accounts,remote_cells CASCADE');
 const signup=new SignupStore(db.pool,db.outbox);await signup.request('quiet@example.test');
 const mail=db.outbox.open((await db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert('token' in mail);
 owner=await signup.complete(mail.token,{password:'A sufficiently long password',organisationName:'Sol',legalBusinessName:'Sol SL',countryCode:'ES'});
 const store=new RegistrationStore(db.pool),binding={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
 await store.start(binding);await store.approveCloud(binding,owner.accountId);await store.approveLocal(binding,randomUUID());venue=await store.complete(binding);
 await db.pool.query("UPDATE installation_services SET state='ready' WHERE installation_id=$1 AND service='remote_access'",[venue.installationId]);
 await db.pool.query("INSERT INTO account_alert_preferences(account_id,enabled,locale) VALUES($1,true,'en')",[owner.accountId]);
 monitor=new MonitorWorker(db.pool,db.outbox,{quietSeconds:2,reminderSeconds:3});await monitor.schedule();
});
async function due(){await db.pool.query('UPDATE venue_monitors SET next_check_at=clock_timestamp()');}
async function contact(seconds:number){await db.pool.query("UPDATE installations SET last_contact_at=clock_timestamp()-$1*interval '1 second' WHERE id=$2",[seconds,venue.installationId]);await due();}
async function alerts(){return(await db.pool.query("SELECT * FROM email_outbox WHERE kind='service_alert' ORDER BY created_at,id")).rows;}
async function episode(){return(await db.pool.query('SELECT * FROM venue_alert_episodes ORDER BY opened_at DESC LIMIT 1')).rows[0];}
async function pastDeadline(){await db.pool.query("WITH stamp AS (SELECT clock_timestamp() AS now) UPDATE venue_alert_episodes SET opened_at=stamp.now-interval '3 seconds',opening_due_at=stamp.now-interval '3 seconds'+quiet_seconds*interval '1 second' FROM stamp");await due();}
async function extraOwner(enabled:boolean){
 const id=randomUUID();await db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[id]);
 await db.pool.query('INSERT INTO cloud_credentials(account_id,email,email_verified_at) VALUES($1,$2,clock_timestamp())',[id,id+'@example.test']);
 await db.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner) VALUES($1,$2,true)',[id,owner.organisationId]);
 await db.pool.query("INSERT INTO account_alert_preferences(account_id,enabled,locale) VALUES($1,$2,'es')",[id,enabled]);return id;
}

test('quietBoundaryUsesDatabaseTime',async()=>{
 await contact(901);await monitor.runOnce();assert.equal((await alerts()).length,0,'quiet deadline delays mail');
 const e=await episode();assert.equal(e.quiet_seconds,2);assert.equal(e.reminder_seconds,3);assert.equal(e.opening_due_at.getTime()-e.opened_at.getTime(),2000);
 const before=(await db.pool.query('SELECT clock_timestamp() AS now')).rows[0].now;
 assert.ok(e.opened_at<=before);assert.equal(e.opening_processed_at,null);
 await db.pool.query("WITH stamp AS (SELECT clock_timestamp() AS now) UPDATE venue_alert_episodes SET opened_at=stamp.now+interval '10 seconds',opening_due_at=stamp.now+interval '12 seconds' FROM stamp");await due();await monitor.runOnce();assert.equal((await alerts()).length,0);
 await pastDeadline();await monitor.runOnce();assert.equal((await alerts()).length,1);assert.ok((await episode()).opening_processed_at);
 await due();await monitor.runOnce();assert.equal((await alerts()).length,1);
});
test('blipShowsInPortalButSendsNothing',async()=>{
 await contact(901);await monitor.runOnce();assert.equal((await monitor.status()).incidents,1);assert.equal((await alerts()).length,0);
 const session=await transaction(db.pool,c=>createSession(c,owner.accountId));
 const installations=await new InstallationStore(db.pool,createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url')),'http://localhost').listWithSession(session.token);
 const views=await venueOverview(db.pool,session.token,installations);assert.equal(views[0]!.monitoring.incidents[0].kind,'disconnected');
 await contact(0);await monitor.runOnce();await pastDeadline();await monitor.runOnce();
 assert.equal((await monitor.status()).incidents,0);assert.equal((await alerts()).length,0);assert.equal((await episode()).status,'recovered');
});
test('snapshotExcludesLaterOwnerAndOptIn',async()=>{
 const optedOut=await extraOwner(false);await contact(901);await monitor.runOnce();
 const late=await extraOwner(true);await db.pool.query('UPDATE account_alert_preferences SET enabled=true WHERE account_id=$1',[optedOut]);
 await pastDeadline();await monitor.runOnce();
 assert.deepEqual((await db.pool.query('SELECT account_id FROM venue_alert_recipients')).rows.map(r=>r.account_id),[owner.accountId]);
 assert.deepEqual((await db.pool.query('SELECT account_id FROM service_alert_deliveries')).rows.map(r=>r.account_id),[owner.accountId]);
 assert.notEqual(late,owner.accountId);assert.equal((await alerts()).length,1);
});
test('restartAndChangedConfigKeepDeadline',async()=>{
 await contact(901);await monitor.runOnce();const original=await episode();
 monitor=new MonitorWorker(db.secondPool,db.outbox,{quietSeconds:0,reminderSeconds:0});await due();await monitor.runOnce();
 assert.equal((await alerts()).length,0);assert.deepEqual(await episode(),original);
 await pastDeadline();await monitor.runOnce();assert.equal((await alerts()).length,1);assert.equal((await episode()).quiet_seconds,2);assert.equal((await episode()).reminder_seconds,3);
});
test('suppressionCannotReviveQuietWork',async()=>{
 await contact(901);await monitor.runOnce();const old=await episode();
 await db.pool.query("UPDATE installation_services SET state='unconfigured' WHERE installation_id=$1",[venue.installationId]);await due();await monitor.runOnce();
 assert.equal((await episode()).status,'suppressed');await pastDeadline();await monitor.runOnce();assert.equal((await alerts()).length,0);
 await db.pool.query("UPDATE installation_services SET state='ready' WHERE installation_id=$1 AND service='remote_access'",[venue.installationId]);await due();await monitor.runOnce();
 const fresh=await episode();assert.notEqual(fresh.id,old.id);assert.equal(fresh.opening_revision,3);assert.equal((await alerts()).length,0);
});
for(const change of ['owner','preference','disabled','verified','revoked','service','environment'] as const)test('due opening rechecks '+change,async()=>{
 await contact(901);await monitor.runOnce();assert.equal((await alerts()).length,0);
 const statements={owner:'UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',preference:'UPDATE account_alert_preferences SET enabled=false WHERE account_id=$1',disabled:'UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1',verified:'UPDATE cloud_credentials SET email_verified_at=NULL WHERE account_id=$1',revoked:'UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',service:"UPDATE installation_services SET state='unconfigured' WHERE installation_id=$1",environment:"UPDATE venues SET environment='production' WHERE id=$1"};
 await db.pool.query(statements[change],[change==='environment'?venue.venueId:['revoked','service'].includes(change)?venue.installationId:owner.accountId]);await pastDeadline();await monitor.runOnce();assert.equal((await alerts()).length,0);
 if(['owner','preference','disabled','verified'].includes(change))assert.ok((await episode()).opening_processed_at,'empty due set is final');
});
test('dueEnqueueUsesCurrentAuthorityAndEvidence',async()=>{
 await contact(901);await monitor.runOnce();assert.equal((await alerts()).length,0);
 await db.pool.query("UPDATE cloud_credentials SET email='current@example.test' WHERE account_id=$1",[owner.accountId]);
 await db.pool.query("UPDATE account_alert_preferences SET locale='es' WHERE account_id=$1",[owner.accountId]);
 await pastDeadline();await monitor.runOnce();const message=db.outbox.open((await alerts())[0]);assert.equal(message.email,'current@example.test');assert.equal(message.locale,'es');assert(!('checkedAt' in message));
});

function child(mode:string){
 const processHandle=spawn(process.execPath,[new URL('./fixtures/monitoring-quiet-process.ts',import.meta.url).pathname,mode],{stdio:['ignore','pipe','pipe','ipc'],env:{PATH:process.env.PATH,TEST_DATABASE_URL:process.env.TEST_DATABASE_URL,MAILPIT_TEST_SMTP_PORT:process.env.MAILPIT_TEST_SMTP_PORT}});
 let errors='';processHandle.stderr!.on('data',data=>{errors+=data;});
 const finished=new Promise<void>((resolve,reject)=>{processHandle.once('error',reject);processHandle.once('exit',code=>code===0?resolve():reject(Error('child failed: '+errors)));});
 processHandle.send({schema:db.schema,keys:db.keys,quietSeconds:2,reminderSeconds:3});
 return {handle:processHandle,finished};
}
test('independentMonitorProcessesRestartAndEnqueueOnce',async()=>{
 await contact(901);const first=child('monitor-hold');
 try{
  await new Promise<void>((resolve,reject)=>{first.handle.once('message',()=>resolve());first.finished.then(()=>reject(Error('hold exited before ready')),reject);});
  assert.ok(first.handle.pid);assert.equal((await alerts()).length,0);const saved=await episode();
  first.handle.kill('SIGTERM');await first.finished;
  await due();const before=child('monitor-once');await before.finished;assert.deepEqual(await episode(),saved);assert.equal((await alerts()).length,0);
  await pastDeadline();const peers=[child('monitor-once'),child('monitor-once')];try{await Promise.all(peers.map(p=>p.finished));}finally{for(const peer of peers)if(peer.handle.exitCode===null)peer.handle.kill('SIGTERM');await Promise.allSettled(peers.map(p=>p.finished));}
  assert.equal((await alerts()).length,1);assert.equal((await db.pool.query('SELECT count(*) FROM venue_alert_episodes')).rows[0].count,'1');
  const mail=child('mail-once');try{await mail.finished;}finally{if(mail.handle.exitCode===null)mail.handle.kill('SIGTERM');await Promise.allSettled([mail.finished]);}
  assert.equal((await alerts())[0].status,'sent');
 }finally{if(first.handle.exitCode===null)first.handle.kill('SIGTERM');await Promise.allSettled([first.finished]);}
});
test('independentMonitorSkipsLockedInstallationAndObservesOtherVenue',async()=>{
 const store=new RegistrationStore(db.pool),binding={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
 await store.start(binding);await store.approveCloud(binding,owner.accountId);await store.approveLocal(binding,randomUUID());const next=await store.complete(binding);
 await db.pool.query("UPDATE installation_services SET state='ready' WHERE installation_id=$1 AND service='remote_access'",[next.installationId]);await monitor.schedule();
 await db.pool.query("UPDATE installations SET last_contact_at=clock_timestamp()-interval '16 minutes'");await db.pool.query("UPDATE venue_monitors SET next_check_at=clock_timestamp()-interval '1 minute' WHERE venue_id=$1",[venue.venueId]);
 const lock=await db.secondPool.connect();await lock.query('BEGIN');await lock.query('SELECT id FROM installations WHERE id=$1 FOR UPDATE',[venue.installationId]);
 const peers=[child('monitor-once'),child('monitor-once')];
 try{await Promise.all(peers.map(p=>p.finished));assert.deepEqual((await db.pool.query('SELECT venue_id FROM venue_incidents')).rows.map(r=>r.venue_id),[next.venueId]);}
 finally{await lock.query('ROLLBACK');lock.release();for(const peer of peers)if(peer.handle.exitCode===null)peer.handle.kill('SIGTERM');await Promise.allSettled(peers.map(p=>p.finished));}
});
test('enabledTimingsDoNotAdmitLegacyMailAfterUpgrade',async()=>{
 const old=await migrationRelease(36),legacy=await database();
 try{
  await legacy.pool.query('DROP SCHEMA '+legacy.schema+' CASCADE; CREATE SCHEMA '+legacy.schema);await old.migrate(legacy.pool);
  const client=await db.pool.connect();try{
   const tables=['cloud_accounts','cloud_credentials','organisations','organisation_memberships','legal_businesses','venues','installations','installation_services','account_alert_preferences'];
   for(const table of tables)await client.query('INSERT INTO '+legacy.schema+'.'+table+' SELECT * FROM '+table);
  }finally{client.release();}
  await legacy.pool.query("UPDATE installations SET last_contact_at=clock_timestamp()-interval '16 minutes'");
  const incident=randomUUID();await legacy.pool.query("INSERT INTO venue_incidents(id,venue_id,kind,status,revision,opened_at,changed_at) VALUES($1,$2,'disconnected','open',1,clock_timestamp()-interval '1 hour',clock_timestamp()-interval '1 hour')",[incident,venue.venueId]);
  await migrate(legacy.pool);const worker=new MonitorWorker(legacy.pool,legacy.outbox,{quietSeconds:2,reminderSeconds:3});await worker.schedule();await worker.runOnce();
  assert.equal((await legacy.pool.query("SELECT count(*) FROM email_outbox WHERE kind='service_alert'")).rows[0].count,'0');
  const e=(await legacy.pool.query('SELECT * FROM venue_alert_episodes')).rows[0];assert.equal(e.legacy,true);assert.equal(e.reminder_seconds,0);assert.ok(e.opening_processed_at);
  assert.equal((await legacy.pool.query('SELECT count(*) FROM venue_alert_recipients')).rows[0].count,'0');
 }finally{await legacy.close();await old.close();}
});

async function remote(){
 const cell=randomUUID();
 await db.pool.query("INSERT INTO remote_cells(id,country,provider,environment,suffix,subnet,public_key,endpoint) VALUES($1,'ES','aws','test','quiet.example.test',57,'fixture-key','gateway.example.test:51820')",[cell]);
 await db.pool.query("INSERT INTO remote_placements(venue_id,installation_id,cell_id,address,peer_public_key,port) VALUES($1,$2,$3,'10.77.57.2','fixture-peer',443)",[venue.venueId,venue.installationId,cell]);
 await db.pool.query("INSERT INTO remote_hostnames(hostname,venue_id,kind) VALUES('public.quiet.example.test',$1,'public'),('staff.quiet.example.test',$1,'staff')",[venue.venueId]);
 await db.pool.query(`INSERT INTO remote_probe_observations(installation_id,venue_id,service,configuration_revision,hostname,status,checked_at,elapsed_ms,failure)
  VALUES($1,$2,'public',0,'public.quiet.example.test','failed',clock_timestamp()-interval '10 seconds',12,'timeout'),
   ($1,$2,'staff',0,'staff.quiet.example.test','healthy',clock_timestamp(),12,NULL)`,[venue.installationId,venue.venueId]);
 await contact(0);
}
test('delayedRemoteOpeningUsesCurrentCanonicalEvidence',async()=>{
 await remote();await monitor.runOnce();assert.equal((await alerts()).length,0);
 const observed=(await db.pool.query("UPDATE remote_probe_observations SET checked_at=clock_timestamp(),failure='tls' WHERE service='public' RETURNING checked_at")).rows[0].checked_at.toISOString();
 await pastDeadline();await monitor.runOnce();const rows=await alerts();assert.equal(rows.length,1);const message=db.outbox.open(rows[0]);assert('issue' in message);assert.equal(message.issue,'public_route_failed');assert.equal(message.checkedAt,observed);assert(!('certificateNotAfter' in message));
});
for(const change of ['hostname','placement','configuration','superseded'] as const)test('delayed remote opening refuses changed '+change,async()=>{
 await remote();await monitor.runOnce();assert.equal((await alerts()).length,0);
 if(change==='hostname')await db.pool.query("DELETE FROM remote_hostnames WHERE venue_id=$1 AND kind='public'",[venue.venueId]);
 if(change==='placement'){await db.pool.query('DELETE FROM remote_hostnames WHERE venue_id=$1',[venue.venueId]);await db.pool.query('DELETE FROM remote_placements WHERE venue_id=$1',[venue.venueId]);}
 if(change==='configuration')await db.pool.query('UPDATE installations SET configuration_revision=configuration_revision+1 WHERE id=$1',[venue.installationId]);
 if(change==='superseded'){
  const next=randomUUID();await transaction(db.pool,async client=>{
   await client.query('INSERT INTO installations(id,venue_id,public_key,revoked_at,superseded_by) VALUES($1,$2,$3,clock_timestamp(),$4)',[next,venue.venueId,'replacement-'+next,venue.installationId]);
   await client.query('UPDATE installations SET superseded_by=$1,revoked_at=clock_timestamp() WHERE id=$2',[next,venue.installationId]);
   await client.query('UPDATE installations SET superseded_by=NULL,revoked_at=NULL WHERE id=$1',[next]);
  });
 }
 await pastDeadline();await monitor.runOnce();
 assert.equal((await db.pool.query("SELECT count(*) FROM service_alert_deliveries d JOIN venue_incidents i ON i.id=d.incident_id WHERE i.kind='public_route_failed'")).rows[0].count,'0');
});
test('emptyDueSetStaysFinalAfterOptInReturns',async()=>{
 await contact(901);await monitor.runOnce();await db.pool.query('UPDATE account_alert_preferences SET enabled=false');await pastDeadline();await monitor.runOnce();assert.equal((await alerts()).length,0);assert.ok((await episode()).opening_processed_at);
 await db.pool.query('UPDATE account_alert_preferences SET enabled=true');await due();await monitor.runOnce();assert.equal((await alerts()).length,0);
});
test('zeroQuietDeadlineIncludesEqualityAndDefaultsStayImmediate',async()=>{
 monitor=new MonitorWorker(db.pool,db.outbox);await contact(901);await monitor.runOnce();const e=await episode();
 assert.equal(e.quiet_seconds,0);assert.equal(e.reminder_seconds,0);assert.equal(e.opening_due_at.getTime(),e.opened_at.getTime());assert.ok(e.opening_processed_at,'equal deadline is processed immediately');assert.equal(e.opening_processed_at.getTime(),e.opened_at.getTime());assert.equal((await alerts()).length,1);
});

test('originalInstallationBindingRefusesReplacementQuietOpening',async()=>{
 await contact(901);await monitor.runOnce();assert.equal((await alerts()).length,0);
 const original=await episode(),next=randomUUID();await transaction(db.pool,async client=>{
  await client.query("INSERT INTO installations(id,venue_id,public_key,last_contact_at,revoked_at,superseded_by) VALUES($1,$2,$3,clock_timestamp()-interval '16 minutes',clock_timestamp(),$4)",[next,venue.venueId,'replacement-'+next,venue.installationId]);
  await client.query('UPDATE installations SET superseded_by=$1,revoked_at=clock_timestamp() WHERE id=$2',[next,venue.installationId]);
  await client.query('UPDATE installations SET superseded_by=NULL,revoked_at=NULL WHERE id=$1',[next]);
  await client.query("INSERT INTO installation_services(installation_id,service,state) VALUES($1,'remote_access','ready')",[next]);
 });
 await pastDeadline();await monitor.runOnce();assert.equal((await alerts()).length,0);assert.equal((await episode()).installation_id,original.installation_id);
 assert.equal((await db.pool.query("SELECT status,revision FROM venue_incidents WHERE kind='disconnected'")).rows[0].status,'open');
});

test('quietDeadlineBringsNextScanForward',async()=>{
 await contact(901);await monitor.runOnce();const e=await episode(),check=(await db.pool.query('SELECT next_check_at FROM venue_monitors')).rows[0].next_check_at;
 assert.equal(check.getTime()-e.opened_at.getTime(),2000,'the two-second deadline wakes the monitor before its usual one-minute scan');
 assert.equal((await alerts()).length,0);
});

function emailWorker(delivered:ServiceAlert[],pool=db.pool){return new EmailWorker(pool,db.outbox,{
 async sendVerification(){throw Error('unexpected verification');},async sendPasswordReset(){throw Error('unexpected reset');},async sendPasswordChanged(){throw Error('unexpected change');},
 async sendServiceAlert(message){delivered.push({...message});},
});}
async function opening(){await contact(901);await monitor.runOnce();await pastDeadline();await monitor.runOnce();return(await alerts())[0];}
async function reminders(){return(await db.pool.query("SELECT e.*,d.account_id FROM service_alert_deliveries d JOIN email_outbox e ON e.id=d.outbox_id WHERE d.notification='reminder' ORDER BY e.created_at,e.id")).rows;}
async function sentOpening(){await opening();const delivered:ServiceAlert[]=[];const worker=emailWorker(delivered);while(await worker.runOnce()){}assert.equal(delivered.length,1);return(await alerts())[0];}
async function anchorPast(){await db.pool.query("UPDATE email_outbox SET finished_at=clock_timestamp()-interval '4 seconds' WHERE id IN (SELECT outbox_id FROM service_alert_deliveries WHERE notification='transition' AND state='open') AND status='sent'");await due();await monitor.runOnce();}

test('reminderWaitsForSentOpeningPerRecipient',async()=>{
 const second=await extraOwner(true);await opening();await due();await monitor.runOnce();assert.equal((await reminders()).length,0);
 const opened=(await db.pool.query("SELECT e.*,d.account_id FROM email_outbox e JOIN service_alert_deliveries d ON d.outbox_id=e.id WHERE d.state='open'")).rows;
 const notified=opened.find(r=>r.account_id===owner.accountId),waiting=opened.find(r=>r.account_id===second);
 await db.pool.query("UPDATE email_outbox SET status='sent',finished_at=clock_timestamp()-interval '4 seconds',payload=NULL,key_id=NULL WHERE id=$1",[notified.id]);
 await due();await monitor.runOnce();const pending=await reminders();assert.equal(pending.length,1);assert.equal(pending[0].account_id,owner.accountId);
 const slot=(await db.pool.query('SELECT * FROM venue_alert_recipients WHERE account_id=$1',[owner.accountId])).rows[0];assert.equal(slot.reminder_due_at.getTime()-((await db.pool.query('SELECT finished_at FROM email_outbox WHERE id=$1',[notified.id])).rows[0].finished_at).getTime(),3000);
 assert.equal((await db.pool.query('SELECT status FROM email_outbox WHERE id=$1',[waiting.id])).rows[0].status,'pending');
 const delivered:ServiceAlert[]=[];while(await emailWorker(delivered).runOnce()){}
 assert.equal(delivered.filter(m=>m.notification==='reminder').length,1);assert.equal(delivered.filter(m=>m.notification===undefined).length,1,'another owner keeps a valid queued opening');
});
for(const state of ['pending','processing','failed','expired','cancelled'] as const)test('reminder refuses '+state+' opening',async()=>{
 const message=await opening();
 await db.pool.query("UPDATE email_outbox SET status=$2,finished_at=CASE WHEN $2 IN ('pending','processing') THEN NULL ELSE clock_timestamp()-interval '4 seconds' END,claim_id=CASE WHEN $2='processing' THEN gen_random_uuid() ELSE NULL END,lease_until=CASE WHEN $2='processing' THEN clock_timestamp()+interval '1 minute' ELSE NULL END,payload=CASE WHEN $2 IN ('pending','processing') THEN payload ELSE NULL END,key_id=CASE WHEN $2 IN ('pending','processing') THEN key_id ELSE NULL END WHERE id=$1",[message.id,state]);
 await due();await monitor.runOnce();assert.equal((await reminders()).length,0);assert.equal((await db.pool.query('SELECT reminder_due_at FROM venue_alert_recipients')).rows[0].reminder_due_at,null);
});
test('reminderIsOneIdentityWithoutRevisionChange',async()=>{
 const opened=await sentOpening();const before=(await db.pool.query('SELECT revision,changed_at FROM venue_incidents')).rows[0];await anchorPast();
 const rows=await reminders();assert.equal(rows.length,1);assert.notEqual(rows[0].id,opened.id);const payload=db.outbox.open(rows[0]);assert('issue' in payload);assert.equal(payload.notification,'reminder');
 assert.deepEqual((await db.pool.query('SELECT revision,changed_at FROM venue_incidents')).rows[0],before);
 const slot=(await db.pool.query('SELECT reminder_due_at,reminder_status FROM venue_alert_recipients')).rows[0];assert.equal(slot.reminder_status,'queued');
 for(let i=0;i<2;i++){await due();await monitor.runOnce();}assert.deepEqual((await reminders()).map(r=>r.id),[rows[0].id]);assert.deepEqual((await db.pool.query('SELECT reminder_due_at,reminder_status FROM venue_alert_recipients')).rows[0],slot);
});
test('reminderDeadlineSurvivesRestartAndConfigChange',async()=>{
 const opened=await sentOpening();await due();await monitor.runOnce();const slot=(await db.pool.query('SELECT * FROM venue_alert_recipients')).rows[0];
 assert.ok(slot.reminder_due_at);assert.equal(slot.reminder_due_at.getTime()-opened.finished_at.getTime(),3000);assert.equal((await reminders()).length,0);
 const next=(await db.pool.query('SELECT next_check_at FROM venue_monitors')).rows[0].next_check_at;assert.equal(next.getTime(),slot.reminder_due_at.getTime());
 monitor=new MonitorWorker(db.secondPool,db.outbox,{quietSeconds:0,reminderSeconds:0});await due();await monitor.runOnce();assert.deepEqual((await db.pool.query('SELECT * FROM venue_alert_recipients')).rows[0],slot);
 await db.pool.query("UPDATE venue_alert_recipients SET reminder_due_at=clock_timestamp()-interval '1 second'");await due();await monitor.runOnce();assert.equal((await reminders()).length,1);
});
test('reminderUsesRefreshedRemoteEvidence',async()=>{
 await remote();await monitor.runOnce();await pastDeadline();await monitor.runOnce();const delivered:ServiceAlert[]=[];while(await emailWorker(delivered).runOnce()){}
 const observed=(await db.pool.query("UPDATE remote_probe_observations SET checked_at=clock_timestamp(),failure='tls' WHERE service='public' RETURNING checked_at")).rows[0].checked_at.toISOString();
 await anchorPast();const rows=await reminders();assert.equal(rows.length,1);const message=db.outbox.open(rows[0]);assert('issue' in message);assert.equal(message.issue,'public_route_failed');assert.equal(message.checkedAt,observed);assert.equal(message.notification,'reminder');
});

async function queuedReminder(remoteIssue=false){
 if(remoteIssue){await remote();await monitor.runOnce();await pastDeadline();await monitor.runOnce();const sent:ServiceAlert[]=[];while(await emailWorker(sent).runOnce()){}assert.equal(sent.length,1);}
 else await sentOpening();
 await anchorPast();const rows=await reminders();assert.equal(rows.length,1);return rows[0];
}
for(const change of ['owner','preference','disabled','email','verified','revoked','service','environment','placement','hostname','revision','opening','episode','snapshot','episodeRevision','episodeStatus','claim','lease','expiry'] as const)test('reminderHandoffRechecksEveryGate: '+change,async()=>{
 const row=await queuedReminder(true),delivered:ServiceAlert[]=[];
 let ready!:()=>void,resume!:()=>void;const reached=new Promise<void>(r=>{ready=r;}),held=new Promise<void>(r=>{resume=r;});
 const query=db.secondPool.query;
 db.secondPool.query=(async(...args:unknown[])=>{
  const result=await Reflect.apply(query,db.secondPool,args);
  if(typeof args[0]==='string'&&args[0].startsWith('SELECT expires_at > clock_timestamp()')){ready();await held;}
  return result;
 }) as typeof db.secondPool.query;
 const sending=emailWorker(delivered,db.secondPool).runOnce();
 try{
  await reached;
  const statements={
   owner:'UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',preference:'UPDATE account_alert_preferences SET enabled=false WHERE account_id=$1',disabled:'UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1',email:"UPDATE cloud_credentials SET email='changed@example.test' WHERE account_id=$1",verified:'UPDATE cloud_credentials SET email_verified_at=NULL WHERE account_id=$1',
   revoked:'UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',service:"UPDATE installation_services SET state='unconfigured' WHERE installation_id=$1",environment:"UPDATE venues SET environment='production' WHERE id=$1",placement:'DELETE FROM remote_placements WHERE venue_id=$1',hostname:"DELETE FROM remote_hostnames WHERE venue_id=$1 AND kind='public'",revision:'UPDATE venue_incidents SET revision=revision+1 WHERE venue_id=$1',
   opening:"UPDATE service_alert_deliveries SET outbox_id=$1 WHERE notification='transition' AND state='open'",episode:'UPDATE venue_alert_episodes SET installation_id=$1',snapshot:'DELETE FROM venue_alert_recipients WHERE account_id=$1',episodeRevision:'UPDATE venue_alert_episodes SET opening_revision=opening_revision+1 WHERE incident_id=$1',episodeStatus:"UPDATE venue_alert_episodes SET status='suppressed' WHERE incident_id=$1",claim:'UPDATE email_outbox SET claim_id=gen_random_uuid() WHERE id=$1',lease:"UPDATE email_outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",expiry:"UPDATE email_outbox SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
  };
  if(change==='placement')await db.pool.query('DELETE FROM remote_hostnames WHERE venue_id=$1',[venue.venueId]);
  let target=['owner','preference','disabled','email','verified'].includes(change)?owner.accountId:['revoked','service'].includes(change)?venue.installationId:['environment','placement','hostname','revision'].includes(change)?venue.venueId:row.id;
  if(change==='episode'){
   target=randomUUID();await db.pool.query('INSERT INTO installations(id,venue_id,public_key,revoked_at,superseded_by) VALUES($1,$2,$3,clock_timestamp(),$4)',[target,venue.venueId,'previous-'+target,venue.installationId]);
  }
  if(change==='opening'){
   const message=db.outbox.open(row);assert('issue' in message);delete message.notification;
   target=await transaction(db.pool,c=>db.outbox.enqueue(c,'service_alert',message));
  }
  if(change==='snapshot')target=owner.accountId;
  if(change==='episodeRevision'||change==='episodeStatus')target=(await episode()).incident_id;
  await db.pool.query(statements[change],[target]);resume();await sending;
  assert.equal(delivered.length,0,'no reminder after '+change+' changes during the last database wait');
  const final=(await reminders())[0];assert.equal(final.status,change==='claim'?'processing':'cancelled');
 }finally{resume();await sending;db.secondPool.query=query;}
});
test('reminder encrypted payload must agree with its delivery discriminator',async()=>{
 const row=await queuedReminder(),message=db.outbox.open(row);assert('issue' in message);delete message.notification;
 const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(db.keys.test,'hex'),nonce);cipher.setAAD(Buffer.from(JSON.stringify([row.id,'service_alert','test'])));
 const encrypted=Buffer.concat([cipher.update(JSON.stringify(message),'utf8'),cipher.final()]);
 await db.pool.query('UPDATE email_outbox SET payload=$1 WHERE id=$2',[Buffer.concat([nonce,cipher.getAuthTag(),encrypted]),row.id]);
 const delivered:ServiceAlert[]=[];await emailWorker(delivered).runOnce();assert.equal(delivered.length,0,'a valid transition payload cannot travel on a reminder link');assert.equal((await reminders())[0].status,'cancelled');
});
test('reminderHandoffRefreshesCurrentLanguage',async()=>{
 await queuedReminder();await db.pool.query("UPDATE account_alert_preferences SET locale='es'");const delivered:ServiceAlert[]=[];await emailWorker(delivered).runOnce();assert.equal(delivered.length,1);assert.equal(delivered[0]!.locale,'es');assert.equal(delivered[0]!.notification,'reminder');
});
test('reminderRetryKeepsTheSameOutboxIdentity',async()=>{
 const row=await queuedReminder();const mailer={async sendVerification(){},async sendPasswordReset(){},async sendPasswordChanged(){},async sendServiceAlert(){throw new EmailDeliveryError('delivery_deferred');}};
 await new EmailWorker(db.pool,db.outbox,mailer).runOnce();assert.equal((await reminders())[0].status,'pending');assert.equal((await reminders())[0].failures,1);
 await due();await monitor.runOnce();assert.deepEqual((await reminders()).map(r=>r.id),[row.id]);
 await db.pool.query('UPDATE email_outbox SET available_at=clock_timestamp() WHERE id=$1',[row.id]);const delivered:ServiceAlert[]=[];await emailWorker(delivered).runOnce();assert.equal(delivered.length,1);assert.equal((await reminders())[0].status,'sent');assert.equal((await reminders())[0].attempts,2);
});
async function capturedReminders(){
 const list=await fetch(process.env.MAILPIT_TEST_URL+'/api/v1/messages');assert.equal(list.status,200);
 const summaries=(await list.json() as {messages:{ID:string;Subject:string}[]}).messages.filter(m=>m.Subject==='Waitron Cloud: a venue still needs attention');
 const messages=[];
 for(const summary of summaries){
  const detail=await fetch(process.env.MAILPIT_TEST_URL+'/api/v1/message/'+summary.ID);assert.equal(detail.status,200);
  const message=await detail.json() as {Text:string;To:{Address:string}[]};if(message.Text.includes(venue.venueId))messages.push(message);
 }
 return messages;
}
test('independentEmailProcessesClaimReminderOnce',async()=>{
 const row=await queuedReminder();assert.equal((await capturedReminders()).length,0);
 const peers=[child('mail-once'),child('mail-once')];
 try{await Promise.all(peers.map(p=>p.finished));}finally{for(const p of peers)if(p.handle.exitCode===null)p.handle.kill('SIGTERM');await Promise.allSettled(peers.map(p=>p.finished));}
 const final=(await reminders())[0];assert.equal(final.id,row.id);assert.equal(final.status,'sent');assert.equal(final.attempts,1);assert.equal(final.message_id,null,'local capture commits sent without optional SMTP metadata');
 const captured=await capturedReminders();assert.equal(captured.length,1);assert.equal(captured[0]!.To[0]!.Address,'quiet@example.test');assert(captured[0]!.Text.includes('This issue is still open. Check your account for current service status.'));assert(!captured[0]!.Text.includes((await episode()).id));
});

for(const change of ['owner','preference','disabled','verified'] as const)test('due reminder cancels its slot permanently after '+change+' loss',async()=>{
 await sentOpening();const changes={owner:'UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',preference:'UPDATE account_alert_preferences SET enabled=false WHERE account_id=$1',disabled:'UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1',verified:'UPDATE cloud_credentials SET email_verified_at=NULL WHERE account_id=$1'};
 await db.pool.query(changes[change],[owner.accountId]);await anchorPast();assert.equal((await reminders()).length,0);const slot=(await db.pool.query('SELECT reminder_due_at,reminder_status FROM venue_alert_recipients')).rows[0];assert.equal(slot.reminder_status,'cancelled');assert.ok(slot.reminder_due_at);
 await db.pool.query('UPDATE organisation_memberships SET is_owner=true; UPDATE account_alert_preferences SET enabled=true; UPDATE cloud_accounts SET disabled_at=NULL; UPDATE cloud_credentials SET email_verified_at=clock_timestamp()');await due();await monitor.runOnce();assert.equal((await reminders()).length,0);assert.deepEqual((await db.pool.query('SELECT reminder_due_at,reminder_status FROM venue_alert_recipients')).rows[0],slot);
});
test('reminder deadline is written once even if a receipt timestamp changes',async()=>{
 await sentOpening();await due();await monitor.runOnce();const initial=(await db.pool.query('SELECT reminder_due_at FROM venue_alert_recipients')).rows[0].reminder_due_at;assert.ok(initial);
 await db.pool.query("UPDATE email_outbox SET finished_at=clock_timestamp()-interval '1 hour' WHERE status='sent'");await due();await monitor.runOnce();assert.equal((await reminders()).length,0);assert.equal((await db.pool.query('SELECT reminder_due_at FROM venue_alert_recipients')).rows[0].reminder_due_at.getTime(),initial.getTime());
});
test('due reminder admission rechecks its saved opening receipt',async()=>{
 await sentOpening();await due();await monitor.runOnce();const slot=(await db.pool.query('SELECT * FROM venue_alert_recipients')).rows[0],e=await episode();assert.ok(slot.reminder_due_at);
 const pending=await transaction(db.pool,c=>db.outbox.enqueue(c,'service_alert',{email:'quiet@example.test',incidentId:e.incident_id,venueId:venue.venueId,revision:1,issue:'disconnected',state:'open'}));
 await db.pool.query("UPDATE service_alert_deliveries SET outbox_id=$1 WHERE notification='transition'",[pending]);await db.pool.query("UPDATE venue_alert_recipients SET reminder_due_at=clock_timestamp()-interval '1 second'");await due();await monitor.runOnce();
 assert.equal((await reminders()).length,0);assert.equal((await db.pool.query('SELECT reminder_status FROM venue_alert_recipients')).rows[0].reminder_status,'cancelled');
});
test('a reminder lease takeover refuses the stale completion receipt',async()=>{
 const row=await queuedReminder();let ready!:()=>void,resume!:()=>void;const started=new Promise<void>(r=>{ready=r;}),held=new Promise<void>(r=>{resume=r;});
 const mailer={async sendVerification(){},async sendPasswordReset(){},async sendPasswordChanged(){},async sendServiceAlert(){ready();await held;return{transport:'smtp' as const,messageId:'<stale@fixture.test>'};}};
 const old=new EmailWorker(db.secondPool,db.outbox,mailer).runOnce();
 try{
  await started;await db.pool.query("UPDATE email_outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[row.id]);
  const delivered:ServiceAlert[]=[];await emailWorker(delivered).runOnce();assert.equal(delivered.length,1);assert.equal((await reminders())[0].attempts,2);resume();await old;
  assert.equal((await reminders())[0].status,'sent');assert.equal((await reminders())[0].message_id,null);assert.equal((await reminders())[0].id,row.id);
 }finally{resume();await old;}
});
test('uncommitted reminder admission is invisible to an independent email process',async()=>{
 await sentOpening();const e=await episode(),client=await db.secondPool.connect();await client.query('BEGIN');let committed=false;
 assert.equal((await capturedReminders()).length,0);
 try{
  const id=await db.outbox.enqueue(client,'service_alert',{email:'quiet@example.test',locale:'en',incidentId:e.incident_id,venueId:venue.venueId,revision:e.opening_revision,issue:'disconnected',state:'open',notification:'reminder'});
  await client.query("INSERT INTO service_alert_deliveries(outbox_id,incident_id,revision,state,account_id,episode_id,notification) VALUES($1,$2,$3,'open',$4,$5,'reminder')",[id,e.incident_id,e.opening_revision,owner.accountId,e.id]);
  await client.query("UPDATE venue_alert_recipients SET reminder_due_at=clock_timestamp(),reminder_status='queued' WHERE episode_id=$1",[e.id]);
  const beforeCommit=child('mail-once');try{await beforeCommit.finished;}finally{if(beforeCommit.handle.exitCode===null)beforeCommit.handle.kill('SIGTERM');await Promise.allSettled([beforeCommit.finished]);}
  assert.equal((await reminders()).length,0);assert.equal((await capturedReminders()).length,0,'admission causes no transport call');
  await client.query('COMMIT');committed=true;
  const afterCommit=child('mail-once');try{await afterCommit.finished;}finally{if(afterCommit.handle.exitCode===null)afterCommit.handle.kill('SIGTERM');await Promise.allSettled([afterCommit.finished]);}
  assert.equal((await reminders())[0].id,id);assert.equal((await reminders())[0].status,'sent');assert.equal((await reminders())[0].attempts,1);assert.equal((await capturedReminders()).length,1);
 }finally{if(!committed)await client.query('ROLLBACK');client.release();}
});

async function recoveries(){return(await db.pool.query("SELECT e.*,d.account_id FROM service_alert_deliveries d JOIN email_outbox e ON e.id=d.outbox_id WHERE d.state='recovered' ORDER BY e.created_at,e.id")).rows;}
// Omitting unchanged-state recovery reconciliation loses the accepted opening's late receipt.
test('acceptedOpeningFinishesDuringRecovery',async()=>{
 const opened=await opening();let accepted!:()=>void,finish!:()=>void;
 const handoff=new Promise<void>(r=>accepted=r),release=new Promise<void>(r=>finish=r);
 const worker=new EmailWorker(db.pool,db.outbox,{async sendVerification(){},async sendPasswordReset(){},async sendPasswordChanged(){},async sendServiceAlert(){accepted();await release;}});
 const sending=(async()=>{while(await worker.runOnce()){} })();await handoff;
 try{await contact(0);await monitor.runOnce();assert.equal((await recoveries()).length,0);assert.equal((await episode()).recovery_complete,false);}
 finally{finish();await sending;}
 assert.equal((await db.pool.query('SELECT status FROM email_outbox WHERE id=$1',[opened.id])).rows[0].status,'sent');
 await due();await Promise.all([monitor.runOnce(),new MonitorWorker(db.pool,db.outbox).runOnce()]);
 const recovered=await recoveries();assert.equal(recovered.length,1,'late sent receipt creates one recovery');
 await due();await new MonitorWorker(db.pool,db.outbox).runOnce();assert.deepEqual((await recoveries()).map(r=>r.id),recovered.map(r=>r.id));
 const delivered:ServiceAlert[]=[];while(await emailWorker(delivered).runOnce()){}assert.deepEqual(delivered.map(m=>m.state),['recovered']);
 await due();await monitor.runOnce();assert.equal((await episode()).recovery_complete,true);
});
for(const outcome of ['failed','expired','cancelled'] as const)test('late recovery refuses '+outcome+' opening',async()=>{
 const opened=await opening();await db.pool.query("UPDATE email_outbox SET status='processing',claim_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '1 minute' WHERE id=$1",[opened.id]);await contact(0);await monitor.runOnce();
 await db.pool.query("UPDATE email_outbox SET status=$2,finished_at=clock_timestamp(),payload=NULL,key_id=NULL,claim_id=NULL,lease_until=NULL WHERE id=$1",[opened.id,outcome]);
 await due();await monitor.runOnce();assert.equal((await recoveries()).length,0);assert.equal((await episode()).recovery_complete,true);
 assert.equal((await db.pool.query('SELECT recovery_status FROM venue_alert_recipients')).rows[0].recovery_status,'cancelled');
});
for(const lost of ['preference','owner'] as const)test('late receipt cannot revive lost '+lost,async()=>{
 const opened=await opening();await db.pool.query("UPDATE email_outbox SET status='processing',claim_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '1 minute' WHERE id=$1",[opened.id]);
 await contact(0);await monitor.runOnce();
 if(lost==='preference')await db.pool.query('UPDATE account_alert_preferences SET enabled=false');else await db.pool.query('UPDATE organisation_memberships SET is_owner=false');
 await db.pool.query("UPDATE email_outbox SET status='sent',payload=NULL,key_id=NULL,claim_id=NULL,lease_until=NULL,finished_at=clock_timestamp() WHERE id=$1",[opened.id]);await due();await monitor.runOnce();
 assert.equal((await recoveries()).length,0);assert.equal((await db.pool.query('SELECT recovery_status FROM venue_alert_recipients')).rows[0].recovery_status,'cancelled');
 if(lost==='preference')await db.pool.query('UPDATE account_alert_preferences SET enabled=true');else await db.pool.query('UPDATE organisation_memberships SET is_owner=true');
 await due();await monitor.runOnce();assert.equal((await recoveries()).length,0);
});
for(const legacy of [false,true])test('recovery handoff requires its sent opening '+(legacy?'legacy':'mapped'),async()=>{
 await sentOpening();await contact(0);await monitor.runOnce();assert.equal((await recoveries()).length,1);
 const d=(await db.pool.query("SELECT * FROM service_alert_deliveries WHERE state='open'")).rows[0];
 const pending=await transaction(db.pool,async c=>(await db.outbox.enqueueServiceAlerts(c,[{email:'quiet@example.test',locale:'en',incidentId:d.incident_id,venueId:venue.venueId,revision:1,issue:'disconnected',state:'open'}]))[0]);
 await db.pool.query('UPDATE service_alert_deliveries SET outbox_id=$2 WHERE outbox_id=$1',[d.outbox_id,pending]);
 if(legacy)await db.pool.query('UPDATE service_alert_deliveries SET episode_id=NULL');
 const delivered:ServiceAlert[]=[];while(await emailWorker(delivered).runOnce()){}assert.deepEqual(delivered,[],'no sent opening means no recovery handoff');
 assert.equal((await recoveries())[0].status,'cancelled');
});
test('suppressionCancelsEveryFutureSlot',async()=>{
 await sentOpening();await anchorPast();assert.equal((await reminders()).length,1);
 await db.pool.query("UPDATE installation_services SET state='unconfigured' WHERE installation_id=$1",[venue.installationId]);await due();await monitor.runOnce();
 assert.equal((await episode()).status,'suppressed');assert.equal((await reminders())[0].status,'cancelled','pending reminder is cancelled at suppression');
 const slot=(await db.pool.query('SELECT * FROM venue_alert_recipients')).rows[0];assert.equal(slot.reminder_status,'cancelled');assert.equal(slot.recovery_status,'cancelled');
 const delivered:ServiceAlert[]=[];while(await emailWorker(delivered).runOnce()){}assert.deepEqual(delivered,[]);
});
test('reopenUsesNewEpisode',async()=>{
 await sentOpening();const first=await episode();await contact(0);await monitor.runOnce();assert.equal((await recoveries()).length,1);
 await contact(901);await monitor.runOnce();const next=await episode();assert.notEqual(next.id,first.id);assert.equal(next.opening_revision,3);
 assert.equal((await db.pool.query('SELECT recovery_complete FROM venue_alert_episodes WHERE id=$1',[first.id])).rows[0].recovery_complete,true);
 assert.equal((await recoveries())[0].status,'cancelled');await pastDeadline();await monitor.runOnce();
 const delivered:ServiceAlert[]=[];while(await emailWorker(delivered).runOnce()){}assert.deepEqual(delivered.map(m=>[m.state,m.revision]),[['open',3]]);
});
test('cleanupProtectsLateReceiptAndQueuedRecovery',async()=>{
 const notified=await extraOwner(true);await opening();
 const opened=(await db.pool.query("SELECT e.*,d.account_id FROM email_outbox e JOIN service_alert_deliveries d ON d.outbox_id=e.id WHERE d.state='open'")).rows;
 const old=opened.find(r=>r.account_id===notified),late=opened.find(r=>r.account_id===owner.accountId);
 await db.pool.query("UPDATE email_outbox SET status='sent',finished_at=clock_timestamp()-interval '2 days',payload=NULL,key_id=NULL WHERE id=$1",[old.id]);
 await db.pool.query("UPDATE email_outbox SET status='processing',claim_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '1 minute' WHERE id=$1",[late.id]);
 await contact(0);await monitor.runOnce();await new UsageReconciler(db.pool).runOnce(100);
 const cleanup=new HistoryCleanup(db.pool),policy={cutoffs:{emailDeliveries:new Date(Date.now()-86400000).toISOString()},chunkSize:1};
 await cleanup.run(policy,{apply:true});assert.equal((await db.pool.query('SELECT count(*) FROM email_outbox WHERE id=$1',[old.id])).rows[0].count,'1','queued recovery still needs its opening receipt');
 await db.pool.query("UPDATE email_outbox SET status='sent',payload=NULL,key_id=NULL,claim_id=NULL,lease_until=NULL,finished_at=clock_timestamp()-interval '2 days' WHERE id=$1",[late.id]);
 await new UsageReconciler(db.pool).runOnce(100);await cleanup.run(policy,{apply:true});assert.equal((await db.pool.query('SELECT count(*) FROM email_outbox WHERE id=$1',[late.id])).rows[0].count,'1','late receipt must survive until reconciliation');
 await due();await monitor.runOnce();assert.equal((await recoveries()).length,2);
 const delivered:ServiceAlert[]=[];while(await emailWorker(delivered).runOnce()){}assert.equal(delivered.length,2);await due();await monitor.runOnce();assert.equal((await episode()).recovery_complete,true);
 await db.pool.query("UPDATE email_outbox SET finished_at=clock_timestamp()-interval '2 days' WHERE kind='service_alert'");await new UsageReconciler(db.pool).runOnce(100);
 await db.pool.query("UPDATE venue_alert_episodes SET opened_at=opened_at-interval '2 days',opening_due_at=opening_due_at-interval '2 days'");
 for(let n=0;n<10;n++){const report=await cleanup.run(policy,{apply:true});assert.ok(report.categories.emailDeliveries!.deleted<=1);}
 assert.equal((await alerts()).length,0);assert.equal((await db.pool.query('SELECT count(*) FROM venue_alert_episodes')).rows[0].count,'0');assert.equal((await db.pool.query('SELECT count(*) FROM venue_alert_recipients')).rows[0].count,'0');
});

for(const outcome of ['sent','failed','expired','cancelled'] as const)test('reminderTerminalOutcomeMetersOnce '+outcome,async()=>{
 await queuedReminder();const reminder=(await reminders())[0];
 if(outcome==='expired')await db.pool.query("UPDATE email_outbox SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[reminder.id]);
 if(outcome==='cancelled')await db.pool.query('UPDATE account_alert_preferences SET enabled=false');
 const delivered:ServiceAlert[]=[];
 const worker=outcome==='failed'?new EmailWorker(db.pool,db.outbox,{async sendVerification(){},async sendPasswordReset(){},async sendPasswordChanged(){},async sendServiceAlert(){throw new EmailDeliveryError('delivery_rejected');}}):emailWorker(delivered);
 while(await worker.runOnce()){}assert.equal((await reminders())[0].status,outcome);
 const usage=new UsageReconciler(db.pool);await usage.runOnce(100);await usage.runOnce(100);
 const events=(await db.pool.query('SELECT event_type,quantity::text FROM usage_events WHERE source_reference=$1',[reminder.id])).rows;assert.deepEqual(events,[{event_type:'message.service_alert_'+outcome,quantity:'1'}]);
});
test('a recovered episode cannot infer a sent receipt from stale opening completion',async()=>{
 const opened=await opening();let accepted!:()=>void,finish!:()=>void;
 const handoff=new Promise<void>(r=>accepted=r),release=new Promise<void>(r=>finish=r);
 const worker=new EmailWorker(db.pool,db.outbox,{async sendVerification(){},async sendPasswordReset(){},async sendPasswordChanged(){},async sendServiceAlert(){accepted();await release;}});
 const sending=(async()=>{while(await worker.runOnce()){} })();await handoff;
 try{await contact(0);await monitor.runOnce();await db.pool.query("UPDATE email_outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[opened.id]);const delivered:ServiceAlert[]=[];while(await emailWorker(delivered,db.secondPool).runOnce()){}assert.deepEqual(delivered,[]);}
 finally{finish();await sending;}
 await due();await monitor.runOnce();assert.equal((await recoveries()).length,0);assert.equal((await db.pool.query('SELECT status FROM email_outbox WHERE id=$1',[opened.id])).rows[0].status,'cancelled');
});
test('accepted old opening after reopening cannot produce obsolete recovery',async()=>{
 const opened=await opening();let accepted!:()=>void,finish!:()=>void;
 const handoff=new Promise<void>(r=>accepted=r),release=new Promise<void>(r=>finish=r);
 const worker=new EmailWorker(db.pool,db.outbox,{async sendVerification(){},async sendPasswordReset(){},async sendPasswordChanged(){},async sendServiceAlert(){accepted();await release;}});
 const sending=(async()=>{while(await worker.runOnce()){} })();await handoff;
 try{await contact(0);await monitor.runOnce();await contact(901);await monitor.runOnce();assert.equal((await recoveries()).length,0);}
 finally{finish();await sending;}
 assert.equal((await db.pool.query('SELECT status FROM email_outbox WHERE id=$1',[opened.id])).rows[0].status,'sent');await due();await monitor.runOnce();assert.equal((await recoveries()).length,0);
});
for(const stage of ['snapshot','opening','reminder','recovery'] as const)test('second '+stage+' batch rolls every notification and slot back',async()=>{
 for(let n=0;n<102;n++)await extraOwner(true);
 if(stage!=='snapshot'){await contact(901);await monitor.runOnce();}
 if(stage==='reminder'||stage==='recovery'){
  await pastDeadline();await monitor.runOnce();
  await db.pool.query("UPDATE email_outbox SET status='sent',payload=NULL,key_id=NULL,finished_at=clock_timestamp()-interval '4 seconds' WHERE kind='service_alert'");
 }
 const beforeOutbox=(await alerts()).map(r=>r.id),beforeSlots=(await db.pool.query('SELECT * FROM venue_alert_recipients ORDER BY account_id')).rows;
 const table=stage==='snapshot'?'venue_alert_recipients':'service_alert_deliveries';
 await db.pool.query(`CREATE TABLE fixture_batch_count(n integer NOT NULL);INSERT INTO fixture_batch_count VALUES(0);
  CREATE FUNCTION fixture_fail_second_batch() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE calls integer;BEGIN UPDATE fixture_batch_count SET n=n+1 RETURNING n INTO calls;IF calls=2 THEN RAISE EXCEPTION 'fixture second batch rejected';END IF;RETURN NULL;END$$;
  CREATE TRIGGER fixture_second_batch AFTER INSERT ON ${table} FOR EACH STATEMENT EXECUTE FUNCTION fixture_fail_second_batch()`);
 try{
  if(stage==='snapshot')await contact(901);else if(stage==='opening')await pastDeadline();else if(stage==='reminder')await due();else await contact(0);
  await assert.rejects(monitor.runOnce(),/fixture second batch rejected/);
  assert.deepEqual((await alerts()).map(r=>r.id),beforeOutbox);assert.deepEqual((await db.pool.query('SELECT * FROM venue_alert_recipients ORDER BY account_id')).rows,beforeSlots);
  if(stage==='snapshot')assert.equal((await db.pool.query('SELECT count(*) FROM venue_alert_episodes')).rows[0].count,'0');
  else if(stage==='opening')assert.equal((await episode()).opening_processed_at,null);
  else if(stage==='recovery')assert.equal((await episode()).status,'open');
 }finally{await db.pool.query(`DROP TRIGGER fixture_second_batch ON ${table};DROP FUNCTION fixture_fail_second_batch();DROP TABLE fixture_batch_count`);}
 await due();await monitor.runOnce();
 if(stage==='snapshot')assert.equal((await db.pool.query('SELECT count(*) FROM venue_alert_recipients')).rows[0].count,'103');
 else if(stage==='opening')assert.equal((await alerts()).length,103);
 else if(stage==='reminder')assert.equal((await reminders()).length,103);
 else assert.equal((await recoveries()).length,103);
 await due();await monitor.runOnce();assert.equal((await alerts()).length,stage==='snapshot'?0:stage==='opening'?103:206);
});
test('a replaced installation cannot leave a recovered old episode waiting forever',async()=>{
 await sentOpening();const old=await episode(),next=randomUUID();
 await transaction(db.pool,async c=>{
  await c.query("INSERT INTO installations(id,venue_id,public_key,last_contact_at,revoked_at,superseded_by) VALUES($1,$2,$3,clock_timestamp(),clock_timestamp(),$4)",[next,venue.venueId,'replacement-'+next,venue.installationId]);
  await c.query('UPDATE installations SET superseded_by=$1,revoked_at=clock_timestamp() WHERE id=$2',[next,venue.installationId]);await c.query('UPDATE installations SET superseded_by=NULL,revoked_at=NULL WHERE id=$1',[next]);
  await c.query("INSERT INTO installation_services(installation_id,service,state) VALUES($1,'remote_access','ready')",[next]);
 });await due();await monitor.runOnce();
 const obsolete=(await db.pool.query('SELECT * FROM venue_alert_episodes WHERE id=$1',[old.id])).rows[0];assert.equal(obsolete.status,'suppressed');assert.equal(obsolete.recovery_complete,true);assert.equal((await recoveries()).length,0);
});
async function settledCycle(){
 await sentOpening();const e=(await db.pool.query("SELECT e.id FROM venue_alert_episodes e JOIN venue_incidents i ON i.id=e.incident_id WHERE i.kind='disconnected' ORDER BY e.opening_revision DESC LIMIT 1")).rows[0];await contact(0);await monitor.runOnce();const sent:ServiceAlert[]=[];while(await emailWorker(sent).runOnce()){}await due();await monitor.runOnce();return e.id as string;
}
test('cleanup progresses past older episodes whose receipts are still fresh',async()=>{
 const fresh=await settledCycle(),aged=await settledCycle();assert.notEqual(fresh,aged);
 await db.pool.query("UPDATE venue_alert_episodes SET opened_at=opened_at-interval '10 days',opening_due_at=opening_due_at-interval '10 days' WHERE id=$1",[fresh]);
 await db.pool.query("UPDATE venue_alert_episodes SET opened_at=opened_at-interval '3 days',opening_due_at=opening_due_at-interval '3 days' WHERE id=$1",[aged]);
 await db.pool.query("UPDATE email_outbox SET finished_at=clock_timestamp()-interval '2 days' WHERE id IN (SELECT outbox_id FROM service_alert_deliveries WHERE episode_id=$1)",[aged]);await new UsageReconciler(db.pool).runOnce(100);
 const cleanup=new HistoryCleanup(db.pool),policy={cutoffs:{emailDeliveries:new Date(Date.now()-86400000).toISOString()},chunkSize:1};
 for(let n=0;n<6;n++){const report=await cleanup.run(policy,{apply:true});assert.ok(report.categories.emailDeliveries!.deleted<=1);if(!report.categories.emailDeliveries!.hasMore)break;}
 const count=async(id:string)=>(await db.pool.query('SELECT count(*) FROM service_alert_deliveries WHERE episode_id=$1',[id])).rows[0].count;
 assert.equal(await count(aged),'0','a fresh older episode cannot monopolize every cleanup batch');assert.equal(await count(fresh),'2','fresh opening and recovery receipts remain');
});
for(const state of ['recovered','suppressed'] as const)test('unchanged settled '+state+' episode performs no history writes',async()=>{
 const id=await settledCycle();
 if(state==='suppressed'){await db.pool.query("UPDATE installation_services SET state='unconfigured' WHERE installation_id=$1",[venue.installationId]);await due();await monitor.runOnce();}
 const snapshot=async()=>({episode:(await db.pool.query('SELECT xmin::text AS version FROM venue_alert_episodes WHERE id=$1',[id])).rows,recipients:(await db.pool.query('SELECT account_id,xmin::text AS version FROM venue_alert_recipients WHERE episode_id=$1 ORDER BY account_id',[id])).rows});
 const before=await snapshot();for(let n=0;n<3;n++){await due();await monitor.runOnce();assert.deepEqual(await snapshot(),before,'completed alert history must not be rewritten on each unchanged scan');}
});
for(const closure of ['recovered','suppressed'] as const)test('a sent reminder remains done after '+closure,async()=>{
 await queuedReminder();const delivered:ServiceAlert[]=[];while(await emailWorker(delivered).runOnce()){}assert.equal(delivered[0]!.notification,'reminder');
 if(closure==='recovered')await contact(0);else{await db.pool.query("UPDATE installation_services SET state='unconfigured' WHERE installation_id=$1",[venue.installationId]);await due();}
 await monitor.runOnce();assert.equal((await db.pool.query('SELECT reminder_status FROM venue_alert_recipients')).rows[0].reminder_status,'done','a committed send retains its settled reminder outcome');assert.equal((await reminders())[0].status,'sent');
});
for(const closure of ['recovered','suppressed'] as const)test('an in-flight reminder retains its committed outcome after '+closure,async()=>{
 await queuedReminder();let accepted!:()=>void,finish!:()=>void;const handoff=new Promise<void>(r=>accepted=r),release=new Promise<void>(r=>finish=r);
 const worker=new EmailWorker(db.pool,db.outbox,{async sendVerification(){},async sendPasswordReset(){},async sendPasswordChanged(){},async sendServiceAlert(){accepted();await release;}});
 const sending=worker.runOnce();await handoff;
 try{
  if(closure==='recovered')await contact(0);else{await db.pool.query("UPDATE installation_services SET state='unconfigured' WHERE installation_id=$1",[venue.installationId]);await due();}
  await monitor.runOnce();assert.equal((await db.pool.query('SELECT reminder_status FROM venue_alert_recipients')).rows[0].reminder_status,'queued','a handed-off send is still in progress');assert.equal((await reminders())[0].status,'processing');
 }finally{finish();await sending;}
 await due();await monitor.runOnce();assert.equal((await reminders())[0].status,'sent');assert.equal((await db.pool.query('SELECT reminder_status FROM venue_alert_recipients')).rows[0].reminder_status,'done');
});
test('suppressed episode retries cancellation skipped by a locked pending opening',async()=>{
 const opened=await opening(),holder=await db.secondPool.connect();await holder.query('BEGIN');await holder.query('SELECT id FROM email_outbox WHERE id=$1 FOR UPDATE',[opened.id]);
 try{await db.pool.query("UPDATE installation_services SET state='unconfigured' WHERE installation_id=$1",[venue.installationId]);await due();await monitor.runOnce();assert.equal((await alerts())[0].status,'pending');}
 finally{await holder.query('ROLLBACK');holder.release();}
 await due();await monitor.runOnce();assert.equal((await alerts())[0].status,'cancelled','an unchanged suppressed episode still cancels work whose row was locked');
});
