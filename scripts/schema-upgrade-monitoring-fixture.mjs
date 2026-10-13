import assert from 'node:assert/strict';
import {randomBytes,randomUUID,generateKeyPairSync} from 'node:crypto';
import {source,digest} from './schema-upgrade-fixture.mjs';

export async function monitoringState(pool){
 const hasEpisodes=(await pool.query("SELECT to_regclass('venue_alert_episodes') AS name")).rows[0].name!==null;
 const value={incidents:(await pool.query('SELECT * FROM venue_incidents ORDER BY id')).rows,
  mail:(await pool.query("SELECT * FROM email_outbox WHERE kind='service_alert' ORDER BY id")).rows,
  deliveries:(await pool.query('SELECT * FROM service_alert_deliveries ORDER BY outbox_id')).rows};
 if(hasEpisodes){value.episodes=(await pool.query('SELECT * FROM venue_alert_episodes ORDER BY id')).rows;value.recipients=(await pool.query('SELECT * FROM venue_alert_recipients ORDER BY episode_id,account_id')).rows;}
 return value;
}
async function due(pool,venue){await pool.query("UPDATE venue_monitors SET next_check_at=CASE WHEN venue_id=$1 THEN clock_timestamp() ELSE clock_timestamp()+interval '1 day' END",[venue]);}
export async function legacyMonitoring(root,pool,email){
 const {MonitorWorker}=await source(root,'packages/registration/src/monitoring.ts');
 const {EmailOutbox}=await source(root,'packages/registration/src/email-outbox.ts');
 // Legacy rows are already processed with both captured timings off, independently of new config.
 const before=(await pool.query('SELECT outbox_id FROM service_alert_deliveries ORDER BY outbox_id')).rows;
 const worker=new MonitorWorker(pool,new EmailOutbox(email),{quietSeconds:120,reminderSeconds:180});
 await worker.schedule();
 const venues=(await pool.query('SELECT venue_id FROM venue_monitors ORDER BY venue_id')).rows;
 for(const row of venues){await due(pool,row.venue_id);await worker.runOnce();}
 const after=(await pool.query("SELECT outbox_id FROM service_alert_deliveries WHERE state='open' ORDER BY outbox_id")).rows;
 const original=new Set(before.map(r=>r.outbox_id));assert.ok(after.every(r=>original.has(r.outbox_id)),'enabling timings must not admit historical opening or reminder');
 assert.equal((await pool.query("SELECT count(*) FROM service_alert_deliveries WHERE notification='reminder'")).rows[0].count,'0');
 return true;
}
export async function seedMonitoring(root,pool,state,email){
 const {EmailOutbox,EmailWorker}=await source(root,'packages/registration/src/email-outbox.ts');
 const {transaction}=await source(root,'packages/registration/src/transaction.ts');
 const outbox=new EmailOutbox(email);
 if((await pool.query("SELECT to_regclass('venue_alert_episodes') AS name")).rows[0].name===null){
  const records=[];
  for(let n=0;n<state.installations.length;n++){
   const installation=state.installations[n],owner=state.owners[n];
   await pool.query("INSERT INTO account_alert_preferences(account_id,enabled,locale) VALUES($1,true,'en')",[owner.accountId]);
   await pool.query("UPDATE installation_services SET state='ready' WHERE installation_id=$1 AND service IN ('remote_access','retained_snapshots')",[installation.installationId]);
   await pool.query("UPDATE installations SET last_contact_at=clock_timestamp()-interval '1 day' WHERE id=$1",[installation.installationId]);
   for(const [kind,status,outcome] of [['disconnected','open',n===0?'sent':'pending'],['snapshot_stale','recovered','processing'],['verification_failed','suppressed','failed']]){
    const incident=randomUUID(),revision=status==='open'?1:2;
    await pool.query("INSERT INTO venue_incidents(id,venue_id,kind,status,revision,opened_at,changed_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()-interval '1 hour',clock_timestamp())",[incident,installation.venueId,kind,status,revision]);
    const id=await transaction(pool,async c=>{
     const [id]=await outbox.enqueueServiceAlerts(c,[{email:owner.email,locale:'en',incidentId:incident,venueId:installation.venueId,revision:1,issue:kind,state:'open'}]);
     await c.query("INSERT INTO service_alert_deliveries(outbox_id,incident_id,revision,state,account_id) VALUES($1,$2,1,'open',$3)",[id,incident,owner.accountId]);return id;
    });
    if(outcome==='sent'||outcome==='failed')await pool.query("UPDATE email_outbox SET status=$2,payload=NULL,key_id=NULL,finished_at=clock_timestamp() WHERE id=$1",[id,outcome]);
    else if(outcome==='processing')await pool.query("UPDATE email_outbox SET status='processing',claim_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '20 minutes',attempts=1 WHERE id=$1",[id]);
    else await pool.query("UPDATE email_outbox SET available_at=clock_timestamp()+interval '20 minutes' WHERE id=$1",[id]);
    records.push({id,incident,accountId:owner.accountId});
   }
  }
  await pool.query('UPDATE relay_control SET stopped=true');
  return{legacy:records};
 }
 const {RegistrationStore}=await source(root,'packages/registration/src/index.ts');
 const {MonitorWorker}=await source(root,'packages/registration/src/monitoring.ts');
 const {createLocalAccountMailer}=await source(root,'packages/registration/src/local-mailer.ts');
 const mailer=createLocalAccountMailer({port:email.smtpPort??Number(process.env.MAILPIT_TEST_SMTP_PORT)});
 const cases={};
 for(const [name,quiet] of [['quiet',120],['reminder',0],['late',0]]){
  const owner=state.owners[name==='reminder'?1:0];
  const binding={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
  const store=new RegistrationStore(pool);await store.start(binding);await store.approveCloud(binding,owner.accountId);await store.approveLocal(binding,randomUUID());const installation=await store.complete(binding);
  await pool.query("UPDATE installation_services SET state='ready' WHERE installation_id=$1 AND service='remote_access'",[installation.installationId]);
  await pool.query("UPDATE installations SET last_contact_at=clock_timestamp()-interval '1 day' WHERE id=$1",[installation.installationId]);
  const monitor=new MonitorWorker(pool,outbox,{quietSeconds:quiet,reminderSeconds:180});await monitor.schedule();await due(pool,installation.venueId);await monitor.runOnce();
  const episode=(await pool.query('SELECT e.* FROM venue_alert_episodes e JOIN venue_incidents i ON i.id=e.incident_id WHERE i.venue_id=$1',[installation.venueId])).rows[0];
  const opened=(await pool.query("SELECT e.* FROM service_alert_deliveries d JOIN email_outbox e ON e.id=d.outbox_id WHERE d.episode_id=$1 AND d.state='open'",[episode.id])).rows[0];
  if(name==='reminder'){
   // Only this opening is eligible for a live claim; old claims are deliberately not expired.
   while(await new EmailWorker(pool,outbox,mailer).runOnce()){}
   assert.equal((await pool.query('SELECT status FROM email_outbox WHERE id=$1',[opened.id])).rows[0].status,'sent');await due(pool,installation.venueId);await monitor.runOnce();
  }
  if(name==='late'){
   let accepted,release;const handoff=new Promise(r=>accepted=r),pause=new Promise(r=>release=r);
   const worker=new EmailWorker(pool,outbox,{...mailer,async sendServiceAlert(message,context){await mailer.sendServiceAlert(message,context);accepted();await pause;}});
   const sending=worker.runOnce();await handoff;
   try{await pool.query('UPDATE installations SET last_contact_at=clock_timestamp() WHERE id=$1',[installation.installationId]);await due(pool,installation.venueId);await monitor.runOnce();assert.equal((await pool.query("SELECT count(*) FROM service_alert_deliveries WHERE episode_id=$1 AND state='recovered'",[episode.id])).rows[0].count,'0');}
   finally{release();await sending;}
   assert.equal((await pool.query('SELECT status FROM email_outbox WHERE id=$1',[opened.id])).rows[0].status,'sent');
  }
  cases[name]={episodeId:episode.id,venueId:installation.venueId,accountId:owner.accountId};
 }
 const snapshot=await monitoringState(pool);
 return{cases,snapshot};
}
export async function restoredMonitoring(root,pool,proof,email){
 const before=await monitoringState(pool);assert.equal(digest(before),digest(proof.snapshot),'restored monitoring state is byte-identical');
 const {EmailOutbox,EmailWorker}=await source(root,'packages/registration/src/email-outbox.ts');
 const {MonitorWorker}=await source(root,'packages/registration/src/monitoring.ts');
 const outbox=new EmailOutbox(email),pending=before.mail.filter(r=>r.payload!==null);
 assert.ok(pending.length>0);for(const row of pending)assert.ok(outbox.open(row).incidentId);
 for(const keys of [{activeKeyId:email.activeKeyId,keys:{[email.activeKeyId]:randomBytes(32).toString('hex')}},{activeKeyId:'replacement',keys:{replacement:randomBytes(32).toString('hex')}}]){
  let delivered=0;const bad=new EmailOutbox(keys),row=pending[0];assert.throws(()=>bad.open(row));
  // A separate transaction gives the worker a due claim, then rolls back its refusal experiment.
  const client=await pool.connect();await client.query('BEGIN');
  try{
   await client.query("UPDATE email_outbox SET available_at=clock_timestamp()+interval '1 day',lease_until=clock_timestamp()+interval '1 day' WHERE status IN ('pending','processing')");
   await client.query("UPDATE email_outbox SET available_at=clock_timestamp(),lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[row.id]);
   const isolated={query:(...args)=>client.query(...args),async connect(){return{
    query:(sql,...args)=>client.query(sql==='BEGIN'?'SAVEPOINT fixture_email_claim':sql==='COMMIT'?'RELEASE SAVEPOINT fixture_email_claim':sql==='ROLLBACK'?'ROLLBACK TO SAVEPOINT fixture_email_claim':sql,...args),
    on:(...args)=>client.on(...args),removeListener:(...args)=>client.removeListener(...args),release(){},
   };}};
   const worker=new EmailWorker(isolated,bad,{async sendVerification(){delivered++;},async sendPasswordReset(){delivered++;},async sendPasswordChanged(){delivered++;},async sendServiceAlert(){delivered++;}});
   // Savepoints keep the real claim/refusal SQL inside this disposable fixture transaction.
   assert.equal(await worker.runOnce(),true);assert.equal(delivered,0);
   const refused=(await client.query('SELECT last_error,failures FROM email_outbox WHERE id=$1',[row.id])).rows[0];assert.equal(refused.last_error,'payload_unavailable');assert.equal(refused.failures,row.failures+1);
  }finally{await client.query('ROLLBACK');client.release();}
 }
 assert.equal(digest(await monitoringState(pool)),digest(before),'key refusal cannot alter the restored queue');
 assert.deepEqual(before.episodes.map(e=>[e.id,e.opening_due_at]),proof.snapshot.episodes.map(e=>[e.id,e.opening_due_at]));
 assert.deepEqual(before.recipients,proof.snapshot.recipients);
 const monitor=new MonitorWorker(pool,outbox,{quietSeconds:0,reminderSeconds:0});
 for(const name of ['quiet','reminder']){await due(pool,proof.cases[name].venueId);await monitor.runOnce();}
 const after=await monitoringState(pool);
 for(const name of ['quiet','reminder']){
  const id=proof.cases[name].episodeId;assert.deepEqual(after.episodes.find(e=>e.id===id),before.episodes.find(e=>e.id===id));assert.deepEqual(after.recipients.filter(r=>r.episode_id===id),before.recipients.filter(r=>r.episode_id===id));
 }
 await due(pool,proof.cases.late.venueId);await monitor.runOnce();await due(pool,proof.cases.late.venueId);await new MonitorWorker(pool,outbox).runOnce();
 const recovery=(await pool.query("SELECT e.* FROM email_outbox e JOIN service_alert_deliveries d ON d.outbox_id=e.id WHERE d.episode_id=$1 AND d.state='recovered'",[proof.cases.late.episodeId])).rows;
 assert.equal(recovery.length,1);assert.equal(outbox.open(recovery[0]).state,'recovered');
 return{deadlinesPreserved:true,recipientSnapshotPreserved:true,lateReceiptRecovery:true,restoredMatchingKeys:true,restoredWrongKeysRefused:true,restoredMissingKeysRefused:true};
}
