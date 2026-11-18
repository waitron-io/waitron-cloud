import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createCipheriv} from 'node:crypto';
import {test} from 'node:test';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {migrate} from '../src/migrate.ts';
import {EmailOutbox} from '../src/email-outbox.ts';
import {migrationRelease} from './fixtures/migration-release.ts';

test('retiring certificate expiry suppresses only its open history and waiting reminders',async()=>{
 const old=await migrationRelease(72),schema='retire_expiry_'+randomUUID().replaceAll('-','');
 const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL}),pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);await old.migrate(pool);
  const organisation=randomUUID(),business=randomUUID(),venue=randomUUID(),closedVenue=randomUUID(),installation=randomUUID(),account=randomUUID();
  await pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[account]);await pool.query('INSERT INTO organisations(id) VALUES($1)',[organisation]);await pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[business,organisation]);
  await pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,environment) VALUES($1,$3,$4,'test'),($2,$3,$4,'test')",[venue,closedVenue,organisation,business]);
  await pool.query("INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,'synthetic-migration-key')",[installation,venue]);
  const {validServiceAlert}=await import(pathToFileURL(old.root+'/packages/registration/src/service-alert.ts').href),outbox=new EmailOutbox({activeKeyId:'test',keys:{test:'ab'.repeat(32)}});
  const queued:string[]=[];
  for(const kind of ['public_certificate_expiring','staff_certificate_expiring','public_route_failed']){
   const incident=(await pool.query("INSERT INTO venue_incidents(venue_id,kind,status,revision,opened_at,changed_at) VALUES($1,$2,'open',4,'2026-11-01','2026-11-01') RETURNING id",[venue,kind])).rows[0].id;
   const episode=(await pool.query("INSERT INTO venue_alert_episodes(incident_id,installation_id,opening_revision,opened_at,quiet_seconds,reminder_seconds,opening_due_at,status) VALUES($1,$2,4,'2026-11-01',0,60,'2026-11-01','open') RETURNING id",[incident,installation])).rows[0].id;
   await pool.query("INSERT INTO venue_alert_recipients(episode_id,account_id,reminder_due_at,reminder_status,recovery_status) VALUES($1,$2,'2026-11-01 00:01:00Z','waiting','waiting')",[episode,account]);
   const mail=randomUUID(),message={email:'owner@example.test',incidentId:incident,venueId:venue,revision:4,issue:kind,state:'open',...(kind==='staff_certificate_expiring'?{notification:'reminder'}:{}),checkedAt:'2026-11-01T00:00:00.000Z',...(kind.includes('certificate_expiring')?{certificateNotAfter:'2026-11-10T00:00:00.000Z'}:{})};assert.equal(validServiceAlert(message),true);
   const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from('ab'.repeat(32),'hex'),nonce);cipher.setAAD(Buffer.from(JSON.stringify([mail,'service_alert','test'])));const encrypted=Buffer.concat([cipher.update(JSON.stringify(message),'utf8'),cipher.final()]);
   const row=(await pool.query("INSERT INTO email_outbox(id,kind,key_id,payload,expires_at) VALUES($1,'service_alert','test',$2,clock_timestamp()+interval '1 day') RETURNING *",[mail,Buffer.concat([nonce,cipher.getAuthTag(),encrypted])])).rows[0];if(kind==='public_route_failed')assert.deepEqual(outbox.open(row),message);

   await pool.query("INSERT INTO service_alert_deliveries(outbox_id,incident_id,revision,state,account_id,episode_id,notification) VALUES($1,$2,4,'open',$3,$4,$5)",[mail,incident,account,episode,kind==='staff_certificate_expiring'?'reminder':'transition']);if(kind==='staff_certificate_expiring')await pool.query("UPDATE venue_alert_recipients SET reminder_status='queued' WHERE episode_id=$1",[episode]);if(kind.includes('certificate_expiring'))queued.push(mail);

  }
  const recovered=(await pool.query("INSERT INTO venue_incidents(venue_id,kind,status,revision,opened_at,changed_at) VALUES($1,'public_certificate_expiring','recovered',7,'2026-11-01','2026-11-02') RETURNING id",[closedVenue])).rows[0].id;
  const recoveredEpisode=(await pool.query("INSERT INTO venue_alert_episodes(incident_id,installation_id,opening_revision,opened_at,quiet_seconds,reminder_seconds,opening_due_at,status,recovery_revision,opening_processed_at) VALUES($1,$2,6,'2026-11-01',0,60,'2026-11-01','recovered',7,'2026-11-01') RETURNING id",[recovered,installation])).rows[0].id;
  await pool.query("INSERT INTO venue_alert_recipients(episode_id,account_id,reminder_status,recovery_status) VALUES($1,$2,'waiting','queued')",[recoveredEpisode,account]);
  const recoveredMail=randomUUID(),recoveredMessage={email:'owner@example.test',incidentId:recovered,venueId:closedVenue,revision:7,issue:'public_certificate_expiring',state:'recovered',checkedAt:'2026-11-01T00:00:00.000Z',certificateNotAfter:'2026-11-10T00:00:00.000Z'};assert.equal(validServiceAlert(recoveredMessage),true);
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from('ab'.repeat(32),'hex'),nonce);cipher.setAAD(Buffer.from(JSON.stringify([recoveredMail,'service_alert','test'])));const encrypted=Buffer.concat([cipher.update(JSON.stringify(recoveredMessage),'utf8'),cipher.final()]);
  await pool.query("INSERT INTO email_outbox(id,kind,key_id,payload,expires_at) VALUES($1,'service_alert','test',$2,clock_timestamp()+interval '1 day')",[recoveredMail,Buffer.concat([nonce,cipher.getAuthTag(),encrypted])]);
  await pool.query("INSERT INTO service_alert_deliveries(outbox_id,incident_id,revision,state,account_id,episode_id,notification) VALUES($1,$2,7,'recovered',$3,$4,'transition')",[recoveredMail,recovered,account,recoveredEpisode]);

  const deliveredAccount=randomUUID(),deliveredMail=randomUUID();await pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[deliveredAccount]);
  await pool.query("INSERT INTO venue_alert_recipients(episode_id,account_id,reminder_status,recovery_status) VALUES($1,$2,'cancelled','queued')",[recoveredEpisode,deliveredAccount]);
  await pool.query("INSERT INTO email_outbox(id,kind,status,expires_at,finished_at) VALUES($1,'service_alert','sent',clock_timestamp()+interval '1 day',clock_timestamp())",[deliveredMail]);
  await pool.query("INSERT INTO service_alert_deliveries(outbox_id,incident_id,revision,state,account_id,episode_id,notification) VALUES($1,$2,7,'recovered',$3,$4,'transition')",[deliveredMail,recovered,deliveredAccount,recoveredEpisode]);
  const delivered=(await pool.query('SELECT * FROM email_outbox WHERE id=$1',[deliveredMail])).rows;
  const ledger=(await pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
  const untouched=(await pool.query("SELECT * FROM venue_incidents WHERE kind='public_route_failed' OR status='recovered' ORDER BY id")).rows;
  const routeMail=(await pool.query("SELECT e.* FROM email_outbox e JOIN service_alert_deliveries d ON d.outbox_id=e.id JOIN venue_incidents i ON i.id=d.incident_id WHERE i.kind='public_route_failed'")).rows;
  const routeEpisode=(await pool.query("SELECT e.*,r.reminder_due_at,r.reminder_status,r.recovery_status FROM venue_alert_episodes e JOIN venue_incidents i ON i.id=e.incident_id JOIN venue_alert_recipients r ON r.episode_id=e.id WHERE i.kind='public_route_failed'")).rows;
  await Promise.all([migrate(pool),migrate(pool)]);
  const retired=(await pool.query("SELECT kind,status,revision,changed_at FROM venue_incidents WHERE venue_id=$1 AND kind LIKE '%certificate_expiring' ORDER BY kind",[venue])).rows;
  assert.deepEqual(retired.map(row=>[row.kind,row.status,row.revision]),[['public_certificate_expiring','suppressed',5],['staff_certificate_expiring','suppressed',5]]);assert.ok(retired.every(row=>row.changed_at.getTime()>Date.parse('2026-11-01')));
  assert.deepEqual((await pool.query("SELECT e.status,r.reminder_status FROM venue_alert_episodes e JOIN venue_incidents i ON i.id=e.incident_id JOIN venue_alert_recipients r ON r.episode_id=e.id WHERE i.venue_id=$1 AND i.kind LIKE '%certificate_expiring' ORDER BY i.kind",[venue])).rows,[{status:'suppressed',reminder_status:'cancelled'},{status:'suppressed',reminder_status:'cancelled'}]);
  assert.deepEqual((await pool.query("SELECT e.recovery_complete,e.opening_processed_at IS NOT NULL AS processed,r.recovery_status FROM venue_alert_episodes e JOIN venue_incidents i ON i.id=e.incident_id JOIN venue_alert_recipients r ON r.episode_id=e.id WHERE i.venue_id=$1 AND i.kind LIKE '%certificate_expiring' ORDER BY i.kind",[venue])).rows,[{recovery_complete:true,processed:true,recovery_status:'cancelled'},{recovery_complete:true,processed:true,recovery_status:'cancelled'}]);
  assert.deepEqual((await pool.query("SELECT status,attempts,payload,key_id,finished_at IS NOT NULL AS finished FROM email_outbox WHERE id=ANY($1::uuid[]) ORDER BY id",[queued])).rows,[{status:'cancelled',attempts:0,payload:null,key_id:null,finished:true},{status:'cancelled',attempts:0,payload:null,key_id:null,finished:true}]);
  assert.deepEqual((await pool.query("SELECT e.status,e.recovery_complete,r.reminder_status,r.recovery_status FROM venue_alert_episodes e JOIN venue_alert_recipients r ON r.episode_id=e.id WHERE e.id=$1 AND r.account_id=$2",[recoveredEpisode,account])).rows,[{status:'recovered',recovery_complete:true,reminder_status:'cancelled',recovery_status:'cancelled'}]);
  assert.deepEqual((await pool.query("SELECT status,attempts,payload,key_id FROM email_outbox WHERE id=$1",[recoveredMail])).rows,[{status:'cancelled',attempts:0,payload:null,key_id:null}]);
  assert.deepEqual((await pool.query('SELECT reminder_status,recovery_status FROM venue_alert_recipients WHERE episode_id=$1 AND account_id=$2',[recoveredEpisode,deliveredAccount])).rows,[{reminder_status:'cancelled',recovery_status:'done'}]);
  assert.deepEqual((await pool.query('SELECT * FROM email_outbox WHERE id=$1',[deliveredMail])).rows,delivered);
  assert.deepEqual((await pool.query("SELECT e.* FROM email_outbox e JOIN service_alert_deliveries d ON d.outbox_id=e.id JOIN venue_incidents i ON i.id=d.incident_id WHERE i.kind='public_route_failed'")).rows,routeMail);
  assert.deepEqual((await pool.query("SELECT * FROM venue_incidents WHERE kind='public_route_failed' OR status='recovered' ORDER BY id")).rows,untouched);
  assert.deepEqual((await pool.query("SELECT e.*,r.reminder_due_at,r.reminder_status,r.recovery_status FROM venue_alert_episodes e JOIN venue_incidents i ON i.id=e.incident_id JOIN venue_alert_recipients r ON r.episode_id=e.id WHERE i.kind='public_route_failed'")).rows,routeEpisode);
  assert.deepEqual((await pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows.slice(0,72),ledger);
  const after=(await pool.query('SELECT * FROM venue_incidents ORDER BY id')).rows;await migrate(pool);assert.deepEqual((await pool.query('SELECT * FROM venue_incidents ORDER BY id')).rows,after);
 }finally{await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();await old.close();}
});
