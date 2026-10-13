import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {migrationRelease} from './fixtures/migration-release.ts';
import {migrate} from '../src/migrate.ts';
import {test,before,after,beforeEach} from 'node:test';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {database} from '../../account-http/test/fixtures.ts';
import {SignupStore,RegistrationStore,InstallationStore,createLeaseIssuer} from '../src/index.ts';
import {MonitorWorker} from '../src/monitoring.ts';
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
