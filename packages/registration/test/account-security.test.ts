import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {before,after,beforeEach,test} from 'node:test';
import {Pool} from 'pg';
import {createSession,hashSecret,verifySecret} from '@waitron-cloud/identity';
import * as registration from '../src/index.ts';
import {migrate} from '../src/migrate.ts';
import {resetSchema} from './fixtures/reset-schema.ts';
import {openProofWindow} from './fixtures/action-proof.ts';
import {createAccountRecoveryCodes} from '../src/account-recovery-codes.ts';

if(!process.env.TEST_DATABASE_URL)throw new Error('Run through scripts/test-postgres.mjs');
const schema=`account_security_${randomUUID().replaceAll('-','')}`;
const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema} -c statement_timeout=10000`});
const accountId=randomUUID(),email='owner@example.test',password='Synthetic replacement password';
const outbox=new registration.EmailOutbox({activeKeyId:'test',keys:{test:'07'.repeat(32)}});
let actor:Awaited<ReturnType<typeof createSession>>;
before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
beforeEach(async()=>{
  await resetSchema(pool);await pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[accountId]);
  await pool.query('INSERT INTO cloud_credentials(account_id,email,password_hash,email_verified_at) VALUES($1,$2,$3,clock_timestamp())',[accountId,email,await hashSecret('Original synthetic password')]);
  actor=await registration.transaction(pool,c=>createSession(c,accountId));
});
function store(screening?:{check:(password:string)=>Promise<'acceptable'|'compromised'>}){
  assert.equal(typeof registration.AccountSecurityStore,'function','account credential changes are missing');
  return new registration.AccountSecurityStore(pool,outbox,screening);
}
test('password change requires fresh proof, screens passwords, ends sessions and forgets browsers while preserving proofs and codes',async()=>{
  const s=store();
  await assert.rejects(s.password(actor.token,actor.csrfToken,password),{code:'proof_required'});
  await openProofWindow(pool,actor.token);
  await assert.rejects(s.password(actor.token,actor.csrfToken,'short'),{code:'recovery_invalid'});
  await assert.rejects(store({async check(){return 'compromised';}}).password(actor.token,actor.csrfToken,password),{code:'password_compromised'});
  await pool.query('INSERT INTO cloud_passkey_users(account_id,user_handle) VALUES($1,$2)',[accountId,randomBytes(32)]);
  await pool.query(`INSERT INTO cloud_passkeys(id,account_id,credential_id,public_key,counter,device_type,backed_up)
    VALUES($1,$2,'cHJvb2Y',$3,0,'multiDevice',true)`,[randomUUID(),accountId,Buffer.from([1,2,3])]);
  await registration.transaction(pool,c=>createAccountRecoveryCodes(c,accountId));
  const codes=(await pool.query('SELECT * FROM cloud_factor_recovery_codes ORDER BY code_hash')).rows;
  await pool.query(`INSERT INTO cloud_recognised_browsers(token_hash,account_id,created_at,expires_at) VALUES($1,$2,statement_timestamp(),statement_timestamp()+interval '30 days')`,['ab'.repeat(32),accountId]);
  await registration.transaction(pool,c=>createSession(c,accountId));
  await s.password(actor.token,actor.csrfToken,password,'es');
  assert.equal(await verifySecret(password,(await pool.query('SELECT password_hash FROM cloud_credentials')).rows[0].password_hash),true);
  assert.equal((await pool.query('SELECT count(*) FROM cloud_sessions WHERE ended_at IS NULL')).rows[0].count,'0');
  assert.equal((await pool.query('SELECT count(*) FROM cloud_recognised_browsers')).rows[0].count,'0');
  assert.equal((await pool.query('SELECT count(*) FROM cloud_passkeys')).rows[0].count,'1');
  assert.deepEqual((await pool.query('SELECT * FROM cloud_factor_recovery_codes ORDER BY code_hash')).rows,codes);
  const row=(await pool.query('SELECT * FROM email_outbox')).rows[0];
  assert.equal(row.kind,'password_changed');assert.deepEqual(outbox.open(row),{email,locale:'es'});
});

test('password change rechecks the session after password screening waits',async()=>{
  await openProofWindow(pool,actor.token);
  const before=(await pool.query('SELECT password_hash FROM cloud_credentials')).rows[0].password_hash;
  const s=store({async check(){await pool.query('UPDATE cloud_sessions SET ended_at=clock_timestamp()');return 'acceptable';}});
  await assert.rejects(s.password(actor.token,actor.csrfToken,password));
  assert.equal((await pool.query('SELECT password_hash FROM cloud_credentials')).rows[0].password_hash,before);
  assert.equal((await pool.query('SELECT count(*) FROM email_outbox')).rows[0].count,'0');
});

async function pendingEmail(){
  const s=store();await openProofWindow(pool,actor.token);
  await s.email(actor.token,actor.csrfToken,'NEW@example.test','es');
  const row=(await pool.query("SELECT * FROM email_outbox WHERE kind='email_change'")).rows[0];
  assert.ok(row,'email verification must be queued');
  const message=outbox.open(row);assert.ok('token' in message);return {s,message};
}
test('email changes only after verification by the initiating session, then ends sessions and notifies both addresses',async()=>{
  const {s,message}=await pendingEmail();
  assert.equal((await pool.query('SELECT email FROM cloud_credentials')).rows[0].email,email);
  assert.equal(message.email,'new@example.test');assert.equal(message.locale,'es');
  assert.notEqual((await pool.query('SELECT token_hash FROM cloud_email_changes')).rows[0].token_hash,message.token);
  const other=await registration.transaction(pool,c=>createSession(c,accountId));await openProofWindow(pool,other.token);
  await assert.rejects(s.completeEmail(other.token,other.csrfToken,message.token),{code:'change_unavailable'});
  await pool.query("UPDATE cloud_sessions SET action_proved_at=clock_timestamp()-interval '11 minutes' WHERE token_hash=$1",[createHash('sha256').update(actor.token).digest('hex')]);
  const results=await Promise.allSettled([s.completeEmail(actor.token,actor.csrfToken,message.token),s.completeEmail(actor.token,actor.csrfToken,message.token)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1,results.map(r=>r.status==='rejected'?String(r.reason):r.status).join('; '));
  assert.equal((await pool.query('SELECT email FROM cloud_credentials')).rows[0].email,'new@example.test');
  assert.ok((await pool.query('SELECT email_verified_at FROM cloud_credentials')).rows[0].email_verified_at);
  assert.equal((await pool.query('SELECT count(*) FROM cloud_sessions WHERE ended_at IS NULL')).rows[0].count,'0');
  const notices=(await pool.query("SELECT * FROM email_outbox WHERE kind='email_changed'")).rows.map(row=>outbox.open(row));
  assert.deepEqual(notices.map(m=>m.email).sort(),[email,'new@example.test'].sort());
  assert.ok(notices.every(m=>m.locale==='es'));
});

test('duplicate addresses have the same accepted answer, cannot replace the address and queue no verification',async()=>{
  await openProofWindow(pool,actor.token);
  const other=randomUUID();await pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[other]);
  await pool.query('INSERT INTO cloud_credentials(account_id,email) VALUES($1,$2)',[other,'taken@example.test']);
  assert.deepEqual(await store().email(actor.token,actor.csrfToken,'taken@example.test'),{status:'accepted'});
  assert.equal((await pool.query('SELECT count(*) FROM email_outbox')).rows[0].count,'0');
  const {s,message}=await pendingEmail();
  await pool.query('UPDATE cloud_credentials SET email=$1 WHERE account_id=$2',['new@example.test',other]);
  await assert.rejects(s.completeEmail(actor.token,actor.csrfToken,message.token),{code:'change_unavailable'});
  assert.equal((await pool.query('SELECT email FROM cloud_credentials WHERE account_id=$1',[accountId])).rows[0].email,email);
});

for(const change of ['expired','password reset','session ended','security revision','new request'] as const)test(`pending email refuses after ${change}`,async()=>{
  const {s,message}=await pendingEmail();
  if(change==='expired')await pool.query("UPDATE cloud_email_changes SET created_at=statement_timestamp()-interval '31 minutes',expires_at=statement_timestamp()-interval '1 minute'");
  if(change==='password reset'){
    const recovery=new registration.PasswordRecoveryStore(pool,outbox);await recovery.request(email);
    const reset=outbox.open((await pool.query("SELECT * FROM email_outbox WHERE kind='password_reset'")).rows[0]);assert.ok('token' in reset);
    await recovery.complete(reset.token,'Reset synthetic password');
    assert.ok((await pool.query('SELECT consumed_at FROM cloud_email_changes')).rows[0].consumed_at);
  }
  if(change==='session ended')await pool.query('UPDATE cloud_sessions SET ended_at=clock_timestamp()');
  if(change==='security revision')await pool.query('UPDATE cloud_sessions SET action_security_revision=action_security_revision+1');
  if(change==='new request')await s.email(actor.token,actor.csrfToken,'later@example.test');
  await assert.rejects(s.completeEmail(actor.token,actor.csrfToken,message.token));
  assert.equal((await pool.query('SELECT email FROM cloud_credentials')).rows[0].email,email);
  assert.equal((await pool.query("SELECT count(*) FROM email_outbox WHERE kind='email_changed'")).rows[0].count,'0');
});

test('email replacement and session ending roll back together when notices cannot be queued',async()=>{
  const {message}=await pendingEmail();
  const unavailable=new registration.EmailOutbox({activeKeyId:'test',keys:{test:'07'.repeat(32)}});
  unavailable.enqueue=async()=>{throw new Error('synthetic outbox refusal');};
  await assert.rejects(new registration.AccountSecurityStore(pool,unavailable).completeEmail(actor.token,actor.csrfToken,message.token),/synthetic outbox refusal/);
  assert.equal((await pool.query('SELECT email FROM cloud_credentials')).rows[0].email,email);
  assert.equal((await pool.query('SELECT ended_at FROM cloud_sessions')).rows[0].ended_at,null);
  assert.equal((await pool.query('SELECT consumed_at FROM cloud_email_changes')).rows[0].consumed_at,null);
});

test('the mail worker cancels a superseded email link before handing off the latest one',async()=>{
  const {s}=await pendingEmail();await s.email(actor.token,actor.csrfToken,'latest@example.test');
  const sent:string[]=[],unexpected=async()=>{throw new Error('unexpected mail kind');};
  const worker=new registration.EmailWorker(pool,outbox,{sendVerification:unexpected,sendPasswordReset:unexpected,sendPasswordChanged:unexpected,sendServiceAlert:unexpected,
    async sendEmailChange(message){sent.push(message.email);}});
  while(await worker.runOnce()){}
  assert.deepEqual(sent,['latest@example.test']);
  assert.deepEqual((await pool.query('SELECT status,count(*) AS count FROM email_outbox GROUP BY status ORDER BY status')).rows,[{status:'cancelled',count:'1'},{status:'sent',count:'1'}]);
});

test('repeating an email change inside a minute keeps the first link, then allows a fresh request',async()=>{
  const {s,message}=await pendingEmail();
  assert.deepEqual(await s.email(actor.token,actor.csrfToken,message.email),{status:'accepted'});
  assert.equal((await pool.query('SELECT count(*) FROM cloud_email_changes')).rows[0].count,'1');
  assert.equal((await pool.query('SELECT consumed_at FROM cloud_email_changes')).rows[0].consumed_at,null);
  assert.equal((await pool.query('SELECT count(*) FROM email_outbox')).rows[0].count,'1');
  await pool.query("UPDATE cloud_email_changes SET created_at=statement_timestamp()-interval '61 seconds',expires_at=statement_timestamp()+interval '28 minutes'");
  await s.email(actor.token,actor.csrfToken,message.email);
  assert.equal((await pool.query('SELECT count(*) FROM cloud_email_changes')).rows[0].count,'2');
  await assert.rejects(s.completeEmail(actor.token,actor.csrfToken,message.token),{code:'change_unavailable'});
});

test('two accounts requesting the same outside address share one resend wait',async()=>{
  const otherId=randomUUID();await pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[otherId]);
  await pool.query('INSERT INTO cloud_credentials(account_id,email,password_hash) VALUES($1,$2,$3)',[otherId,'second@example.test',await hashSecret('Other synthetic owner password')]);
  const other=await registration.transaction(pool,c=>createSession(c,otherId));
  for(const session of [actor,other])await openProofWindow(pool,session.token);
  const s=store(),answers=await Promise.all([s.email(actor.token,actor.csrfToken,'outside@example.test'),s.email(other.token,other.csrfToken,'outside@example.test')]);
  assert.deepEqual(answers,[{status:'accepted'},{status:'accepted'}]);
  assert.equal((await pool.query('SELECT count(*) FROM cloud_email_changes')).rows[0].count,'1');
  assert.equal((await pool.query('SELECT count(*) FROM email_outbox')).rows[0].count,'1');
});
