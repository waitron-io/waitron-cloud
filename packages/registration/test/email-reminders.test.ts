import {resetSchema} from './fixtures/reset-schema.ts';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {test,before,after,beforeEach} from 'node:test';
import {randomUUID,generateKeyPairSync,createCipheriv,randomBytes} from 'node:crypto';
import {database} from '../../account-http/test/fixtures.ts';
import {SignupStore,RegistrationStore} from '../src/index.ts';
import {MonitorWorker} from '../src/monitoring.ts';
import {EmailWorker} from '../src/email-outbox.ts';
import {UsageReconciler} from '../src/usage-metering.ts';
import {EmailDeliveryError} from '../src/email-delivery.ts';
import type {ServiceAlert} from '../src/service-alert.ts';
import {transaction} from '../src/transaction.ts';
let db:Awaited<ReturnType<typeof database>>,monitor:MonitorWorker;
let owner:{accountId:string;organisationId:string;legalBusinessId:string},venue:{installationId:string;venueId:string};
before(async()=>{db=await database();});after(async()=>db?.close());
beforeEach(async()=>{
 await resetSchema(db.pool);
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

function child(mode:string){
 const processHandle=spawn(process.execPath,[new URL('./fixtures/monitoring-quiet-process.ts',import.meta.url).pathname,mode],{stdio:['ignore','pipe','pipe','ipc'],env:{PATH:process.env.PATH,TEST_DATABASE_URL:process.env.TEST_DATABASE_URL,MAILPIT_TEST_SMTP_PORT:process.env.MAILPIT_TEST_SMTP_PORT}});
 let errors='';processHandle.stderr!.on('data',data=>{errors+=data;});
 const finished=new Promise<void>((resolve,reject)=>{processHandle.once('error',reject);processHandle.once('exit',code=>code===0?resolve():reject(Error('child failed: '+errors)));});
 processHandle.send({schema:db.schema,keys:db.keys,quietSeconds:2,reminderSeconds:3});
 return {handle:processHandle,finished};
}
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
