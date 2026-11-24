import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,after,beforeEach,test} from 'node:test';
import {Pool} from 'pg';
import {createSession} from '@waitron-cloud/identity';
import {CloudActions,EmailWorker,transaction} from '../src/index.ts';
import {migrate} from '../src/migrate.ts';
import {resetSchema} from './fixtures/reset-schema.ts';
import {openProofWindow} from './fixtures/action-proof.ts';
import {testOutbox as outbox} from './fixtures/delivery.ts';
import {createLocalAccountMailer} from '../src/local-mailer.ts';
import {captured} from './fixtures/captured-mail.ts';
import {config as sesConfig,keys as recipientKeys} from './fixtures/mail-attempt.ts';
if(!process.env.TEST_DATABASE_URL)throw Error('Run through scripts/test-postgres.mjs');
const schema='action_notice_'+randomUUID().replaceAll('-','');
const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema} -c statement_timeout=10000`});
const operator=randomUUID();let actor:Awaited<ReturnType<typeof createSession>>,actions:CloudActions;
const proposal={occurrence:'synthetic-mail-incident',cell:'synthetic-cell',target:'synthetic-worker',actionId:'machine_drain',proposal:'Drain synthetic worker',evidence:'Synthetic failed check'};
before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
beforeEach(async()=>{
 await resetSchema(pool);await pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[operator]);
 await pool.query("INSERT INTO cloud_credentials(account_id,email,password_hash,email_verified_at) VALUES($1,'operator@example.test','synthetic-hash',clock_timestamp())",[operator]);
 actor=await transaction(pool,c=>createSession(c,operator));await openProofWindow(pool,actor.token);
 actions=new CloudActions(pool,operator,outbox);
});
const propose=(input=proposal)=>actions.propose(actor.token,actor.csrfToken,input);
async function queued(){const rows=(await pool.query("SELECT * FROM email_outbox WHERE kind='operator_notice'")).rows;assert.equal(rows.length,1);return rows[0];}

test('askAndNoticeCommitTogether: retries keep one encrypted notice and a queue failure rolls the proposal back',async()=>{
 const request=await propose(),row=await queued();
 assert.equal(row.token_hash,null);assert.equal(row.payload.includes(Buffer.from('operator@example.test')),false);
 assert.equal((await pool.query("SELECT notice_id FROM cloud_action_events WHERE request_id=$1 AND kind='notice'",[request.id])).rows[0].notice_id,row.id);
 const retries=await Promise.all([propose(),propose()]);assert.ok(retries.every(r=>r.id===request.id));assert.equal((await queued()).id,row.id);
 await pool.query("ALTER TABLE email_outbox ADD CONSTRAINT synthetic_refuse_notice CHECK(kind<>'operator_notice') NOT VALID");
 try{await assert.rejects(propose({...proposal,occurrence:'synthetic-mail-refused'}),/synthetic_refuse_notice/);}
 finally{await pool.query('ALTER TABLE email_outbox DROP CONSTRAINT synthetic_refuse_notice');}
 assert.equal((await pool.query('SELECT count(*) FROM cloud_action_requests')).rows[0].count,'1');
 assert.equal((await pool.query('SELECT count(*) FROM cloud_action_events')).rows[0].count,'2');assert.equal((await queued()).id,row.id);
});

test('operatorNoticeIgnoresVenueOptOut: verified operator receives Spanish notice and retained history never requeues it',async()=>{
 await pool.query("INSERT INTO account_alert_preferences(account_id,enabled,locale) VALUES($1,false,'es')",[operator]);
 const request=await propose(),row=await queued();assert.deepEqual(outbox.open(row),{email:'operator@example.test',locale:'es'});
 const mailer=createLocalAccountMailer({port:Number(process.env.MAILPIT_TEST_SMTP_PORT),portalOrigin:'http://localhost:3000'});
 const worker=new EmailWorker(pool,outbox,mailer);assert.equal(await worker.runOnce(),true);assert.equal(await worker.runOnce(),false);
 const delivery=(await pool.query('SELECT status,last_error FROM email_outbox WHERE id=$1',[row.id])).rows[0];assert.equal(delivery.status,'sent',delivery.last_error??'notice delivery');
 const mail=await captured(process.env.MAILPIT_TEST_URL!,'Waitron Cloud: acción para revisar','operator@example.test');
 assert.match(mail.Text,/http:\/\/localhost:3000\/operator\/actions/);assert.doesNotMatch(mail.Text,/token=|synthetic-worker/);
 assert.equal((await pool.query('SELECT status FROM email_outbox WHERE id=$1',[row.id])).rows[0].status,'sent');
 const status=async()=>((await actions.read(actor.token)).requests.find(r=>r.id===request.id)!.events.find(e=>e.kind==='notice') as any).noticeStatus;
 assert.equal(await status(),'sent');await pool.query('DELETE FROM email_outbox WHERE id=$1',[row.id]);
 assert.equal((await propose()).id,request.id);assert.equal((await pool.query('SELECT count(*) FROM email_outbox')).rows[0].count,'0');assert.equal(await status(),'unknown');
});

test('a sign-up volume notice reaches the verified operator through Mailpit without a pending action', async () => {
 const day = '2026-11-24';
 const email = 'operator@example.test';
 await transaction(pool,client=>outbox.enqueue(client,'operator_notice',{
  email, locale:'en', event:'signup_volume', accountId:operator, day, threshold:10,
 }));
 const row=await queued();
 const worker=new EmailWorker(pool,outbox,createLocalAccountMailer({
  port:Number(process.env.MAILPIT_TEST_SMTP_PORT),portalOrigin:'http://localhost:3000',
 }));
 assert.equal(await worker.runOnce(),true);
 assert.equal(await worker.runOnce(),false);
 assert.equal((await pool.query('SELECT status FROM email_outbox WHERE id=$1',[row.id])).rows[0].status,'sent');
 const mail=await captured(process.env.MAILPIT_TEST_URL!,'Waitron Cloud: sign-up volume',email);
 assert.match(mail.Text,/2026-11-24.*10|10.*2026-11-24/s);
 assert.doesNotMatch(mail.Text,/operator\/actions|token=/);
});

test('a sign-up volume notice is cancelled if the operator email changes before handoff', async () => {
 await transaction(pool,client=>outbox.enqueue(client,'operator_notice',{
  email:'operator@example.test', locale:'en', event:'signup_volume', accountId:operator, day:'2026-11-24', threshold:10,
 }));
 await pool.query("UPDATE cloud_credentials SET email='new-operator@example.test' WHERE account_id=$1",[operator]);
 const forbidden=async()=>{assert.fail('delivered a notice to a previous address');};
 const worker=new EmailWorker(pool,outbox,{sendVerification:forbidden,sendPasswordReset:forbidden,
  sendPasswordChanged:forbidden,sendServiceAlert:forbidden,sendOperatorNotice:forbidden});
 assert.equal(await worker.runOnce(),true);
 assert.equal(await worker.runOnce(),false);
 assert.equal((await pool.query("SELECT status FROM email_outbox WHERE kind='operator_notice'")).rows[0].status,'cancelled');
});

test('providerTransportRefusesOperatorNotice: unsupported mailer handles the row without invoking any sender',async()=>{
 const request=await propose(),row=await queued(),calls:string[]=[];const forbidden=async()=>{calls.push('unexpected');};
 const worker=new EmailWorker(pool,outbox,{sendVerification:forbidden,sendPasswordReset:forbidden,sendPasswordChanged:forbidden,sendServiceAlert:forbidden});
 assert.equal(await worker.runOnce(),true);assert.equal(await worker.runOnce(),false);assert.deepEqual(calls,[]);
 const result=(await pool.query('SELECT status,last_error,payload FROM email_outbox WHERE id=$1',[row.id])).rows[0];
 assert.equal(result.status,'failed');assert.equal(result.last_error,'delivery_configuration');assert.equal(result.payload,null);
 const notice=(await actions.read(actor.token)).requests.find(r=>r.id===request.id)!.events.find(e=>e.kind==='notice') as any;
 assert.equal(notice.noticeStatus,'failed');
});

test('SES handoff refuses an operator notice even when a capture callback is present',async()=>{
 await propose();const row=await queued(),calls:string[]=[];const forbidden=async()=>{calls.push('unexpected');};
 const worker=new EmailWorker(pool,outbox,{sendVerification:forbidden,sendPasswordReset:forbidden,sendPasswordChanged:forbidden,sendServiceAlert:forbidden,sendOperatorNotice:forbidden},{ses:{config:sesConfig(),recipientKeys}});
 assert.equal(await worker.runOnce(),true);assert.equal(await worker.runOnce(),false);assert.deepEqual(calls,[]);
 assert.equal((await pool.query('SELECT status,last_error FROM email_outbox WHERE id=$1',[row.id])).rows[0].status,'failed');
 assert.equal((await pool.query('SELECT count(*) FROM mail_attempts')).rows[0].count,'0');
});
test('operator notices to the pilot mailbox stay in the local inbox',async()=>{
 const email=`pilot-${randomUUID()}@example.test`;
 await pool.query("UPDATE cloud_credentials SET email=$1 WHERE account_id=$2",[email,operator]);
 await pool.query("INSERT INTO account_alert_preferences(account_id,enabled,locale) VALUES($1,false,'es')",[operator]);
 const request=await propose(),row=await queued();
 const captureMailer=createLocalAccountMailer({port:Number(process.env.MAILPIT_TEST_SMTP_PORT),portalOrigin:'http://localhost:3000'});
 const w=new EmailWorker(pool,outbox,captureMailer,{ses:{config:sesConfig(),recipientKeys},
  sesRecipient:{email,captureMailer}});
 assert.equal(await w.runOnce(),true);assert.equal(await w.runOnce(),false);
 assert.equal((await pool.query('SELECT status FROM email_outbox WHERE id=$1',[row.id])).rows[0].status,'sent');
 assert.equal((await pool.query('SELECT count(*) FROM mail_attempts')).rows[0].count,'0');
 await captured(process.env.MAILPIT_TEST_URL!,'Waitron Cloud: acción para revisar',email);
 assert.ok((await actions.read(actor.token)).requests.some(r=>r.id===request.id));
});
for(const [name,sql] of [
 ['disabled operator',"UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1"],
 ['changed email',"UPDATE cloud_credentials SET email='replacement@example.test' WHERE account_id=$1"],
 ['unverified email','UPDATE cloud_credentials SET email_verified_at=NULL WHERE account_id=$1'],
] as const)test(`notice handoff cancels ${name} before sending`,async()=>{
 await propose();const row=await queued(),calls:string[]=[];await pool.query(sql,[operator]);
 const forbidden=async()=>{calls.push('unexpected');};
 const worker=new EmailWorker(pool,outbox,{sendVerification:forbidden,sendPasswordReset:forbidden,sendPasswordChanged:forbidden,sendServiceAlert:forbidden,sendOperatorNotice:forbidden});
 assert.equal(await worker.runOnce(),true);assert.equal(await worker.runOnce(),false);assert.deepEqual(calls,[]);
 assert.equal((await pool.query('SELECT status FROM email_outbox WHERE id=$1',[row.id])).rows[0].status,'cancelled');
});
