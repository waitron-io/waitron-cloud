import {resetSchema} from './fixtures/reset-schema.ts';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {createSession} from '@waitron-cloud/identity';
import {database} from '../../account-http/test/fixtures.ts';
import {EmailWorker,InstallationStore,RegistrationStore,SignupStore,createLeaseIssuer,transaction} from '../src/index.ts';
import {MonitorWorker} from '../src/monitoring.ts';
let db:Awaited<ReturnType<typeof database>>,owner:{accountId:string;organisationId:string;legalBusinessId:string},venue:{installationId:string;venueId:string},installationKey:string;
const original=['continuous_backup','remote_access','retained_snapshots'];
before(async()=>{db=await database();});after(async()=>db?.close());
beforeEach(async()=>{
 await resetSchema(db.pool);
 const signup=new SignupStore(db.pool,db.outbox);await signup.request('readers@example.test');
 const mail=db.outbox.open((await db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert('token' in mail);
 owner=await signup.complete(mail.token,{password:'A sufficiently long password',organisationName:'Sol',legalBusinessName:'Sol SL',countryCode:'ES'});
 installationKey=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url');
 const r=new RegistrationStore(db.pool),binding={operationId:randomUUID(),installationKey,localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
 await r.start(binding);await r.approveCloud(binding,owner.accountId);await r.approveLocal(binding,randomUUID());venue=await r.complete(binding);
 await db.pool.query(`INSERT INTO installation_services(installation_id,service,state) VALUES($1,'content_translation','ready')
  ON CONFLICT (installation_id,service) DO UPDATE SET state='ready'`,[venue.installationId]);
 await db.pool.query("INSERT INTO account_alert_preferences(account_id,enabled,locale) VALUES($1,true,'en')",[owner.accountId]);
});
const remote=(state:string)=>db.pool.query("UPDATE installation_services SET state=$2 WHERE installation_id=$1 AND service='remote_access'",[venue.installationId,state]);
const silent=async()=>{await db.pool.query("UPDATE installations SET last_contact_at=clock_timestamp()-interval '901 seconds' WHERE id=$1",[venue.installationId]);await db.pool.query('UPDATE venue_monitors SET next_check_at=clock_timestamp()');};
const alerts=async()=>(await db.pool.query("SELECT status FROM email_outbox WHERE kind='service_alert'")).rows.map(r=>r.status as string);
test('a venue with only translation ready is not scheduled for monitoring',async()=>{
 assert.equal(await new MonitorWorker(db.pool,db.outbox).schedule(),0);
});
test('a monitored venue whose original services all stop raises no alert because translation is ready',async()=>{
 const monitor=new MonitorWorker(db.pool,db.outbox);
 await remote('ready');assert.equal(await monitor.schedule(),1);
 await remote('unconfigured');await silent();await monitor.runOnce();
 assert.deepEqual(await alerts(),[]);
});
test('a queued alert is cancelled at delivery once only translation is ready',async()=>{
 const monitor=new MonitorWorker(db.pool,db.outbox),sent:unknown[]=[];
 await remote('ready');await monitor.schedule();await silent();await monitor.runOnce();
 assert.equal((await alerts()).length,1);
 await remote('unconfigured');
 const worker=new EmailWorker(db.pool,db.outbox,{async sendVerification(){},async sendPasswordReset(){},async sendPasswordChanged(){},async sendServiceAlert(message:unknown){sent.push(message);}});
 for(let n=0;n<20&&await worker.runOnce();n++);
 assert.equal(sent.length,0);assert.deepEqual(await alerts(),['cancelled']);
});
test('the configuration reply shows the three original services',async()=>{
 assert.deepEqual((await new RegistrationStore(db.pool).configuration(installationKey)).services.map(s=>s.service),original);
});
test('the account listing shows the three original services',async()=>{
 const session=await transaction(db.pool,c=>createSession(c,owner.accountId));
 const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
 const listed=await new InstallationStore(db.pool,issuer,'https://cloud.example.test').listWithSession(session.token);
 assert.deepEqual(listed[0]!.services.map(s=>s.service),original);
});
test('a disconnected incident is suppressed when the original services stop',async()=>{
 const monitor=new MonitorWorker(db.pool,db.outbox);
 await remote('ready');await monitor.schedule();await silent();await monitor.runOnce();
 assert.equal((await db.pool.query("SELECT status FROM venue_incidents WHERE venue_id=$1 AND kind='disconnected'",[venue.venueId])).rows[0].status,'open');
 await remote('unconfigured');await silent();await monitor.runOnce();
 assert.equal((await db.pool.query("SELECT status FROM venue_incidents WHERE venue_id=$1 AND kind='disconnected'",[venue.venueId])).rows[0].status,'suppressed');
});
