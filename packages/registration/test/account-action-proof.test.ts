import assert from 'node:assert/strict';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {before,after,beforeEach,test} from 'node:test';
import {Pool} from 'pg';
import {createSession,hashSecret} from '@waitron-cloud/identity';
import * as registration from '../src/index.ts';
import {migrate} from '../src/migrate.ts';
import {resetSchema} from './fixtures/reset-schema.ts';
import {transaction} from '../src/transaction.ts';
import {openProofWindow} from './fixtures/action-proof.ts';
import {createAccountRecoveryCodes} from '../src/account-recovery-codes.ts';

if(!process.env.TEST_DATABASE_URL)throw new Error('Run through scripts/test-postgres.mjs');
const schema=`action_proof_${randomUUID().replaceAll('-','')}`;
const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema} -c statement_timeout=10000`});
const accountId=randomUUID(),email='owner@example.test';
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const outbox=new registration.EmailOutbox({activeKeyId:'test',keys:{test:'07'.repeat(32)}});
let actor:Awaited<ReturnType<typeof createSession>>;
before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
beforeEach(async()=>{
  await resetSchema(pool);await pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[accountId]);
  await pool.query('INSERT INTO cloud_credentials(account_id,email,password_hash,email_verified_at) VALUES($1,$2,$3,clock_timestamp())',[accountId,email,await hashSecret('Synthetic owner password')]);
  actor=await transaction(pool,c=>createSession(c,accountId));
});
const refused=(p:Promise<unknown>)=>assert.rejects(p,e=>e instanceof Error&&'code' in e&&e.code==='proof_required');
function store(){assert.equal(typeof registration.AccountActionProofStore,'function','fresh action proof is missing');return new registration.AccountActionProofStore(pool,null,{challengeAttempts:3},outbox);}
async function queued(s:ReturnType<typeof store>){
  const challenge=await s.email(actor.token,actor.csrfToken);
  const message=outbox.open((await pool.query("SELECT * FROM email_outbox WHERE kind='sign_in_check' ORDER BY created_at DESC LIMIT 1")).rows[0]);
  assert.ok('code' in message);return {...challenge,code:message.code};
}

test('ordinary sign-in has no action window; email proof opens only its current session for ten minutes',async()=>{
  const s=store();await refused(transaction(pool,c=>registration.requireAccountActionProof(c,actor.token,actor.csrfToken)));
  const other=await transaction(pool,c=>createSession(c,accountId)),challenge=await queued(s);
  await assert.rejects(s.completeEmail(other.token,other.csrfToken,challenge.challengeToken,challenge.code));
  await s.completeEmail(actor.token,actor.csrfToken,challenge.challengeToken,challenge.code);
  for(let i=0;i<2;i++)assert.equal((await transaction(pool,c=>registration.requireAccountActionProof(c,actor.token,actor.csrfToken))).accountId,accountId);
  await refused(transaction(pool,c=>registration.requireAccountActionProof(c,other.token,other.csrfToken)));
  await assert.rejects(s.completeEmail(actor.token,actor.csrfToken,challenge.challengeToken,challenge.code));
  assert.equal((await pool.query('SELECT count(*) FROM cloud_sessions')).rows[0].count,'2','proof must not create another session');
  await pool.query("UPDATE cloud_sessions SET action_proved_at=clock_timestamp()-interval '10 minutes' WHERE token_hash=$1",[digest(actor.token)]);
  await refused(transaction(pool,c=>registration.requireAccountActionProof(c,actor.token,actor.csrfToken)));
});

test('email proof cannot be completed by the ordinary sign-in endpoint',async()=>{
  const challenge=await queued(store());
  await assert.rejects(new registration.PasswordLoginStore(pool,null,{loginLifetimeMs:300000,challengeAttempts:3},outbox).completeEmailCheck(challenge.challengeToken,challenge.code));
  assert.equal((await pool.query('SELECT count(*) FROM cloud_sessions')).rows[0].count,'1');
});

test('wrong email codes exhaust the configured attempts without opening a window',async()=>{
  const s=store(),challenge=await queued(s),wrong=challenge.code==='123456'?'654321':'123456';
  for(let i=0;i<3;i++)await assert.rejects(s.completeEmail(actor.token,actor.csrfToken,challenge.challengeToken,wrong));
  assert.equal((await pool.query('SELECT attempts FROM cloud_sign_in_checks')).rows[0].attempts,3);
  await assert.rejects(s.completeEmail(actor.token,actor.csrfToken,challenge.challengeToken,challenge.code));
  await refused(transaction(pool,c=>registration.requireAccountActionProof(c,actor.token,actor.csrfToken)));
});

test('email proof refuses an enrolled app and app proof is single-use even across windows',async()=>{
  const keys={activeKeyId:'test',keys:{test:'07'.repeat(32)}};
  const {encryptFactorSecret}=await import('@waitron-cloud/identity');
  const {createHmac}=await import('node:crypto');
  const secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  await pool.query('INSERT INTO cloud_authenticator_factors(account_id,version,secret_generation,secret_envelope) VALUES($1,1,$2,$3)',[accountId,randomUUID(),encryptFactorSecret(secret,keys,{accountId,version:1,purpose:'active'})]);
  const s=new registration.AccountActionProofStore(pool,keys,{challengeAttempts:3},outbox);
  await assert.rejects(s.email(actor.token,actor.csrfToken));
  const bytes=Buffer.alloc(8);bytes.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const mac=createHmac('sha1',Buffer.from('12345678901234567890')).update(bytes).digest();
  const code=((mac.readUInt32BE(mac[19]!&15)&0x7fffffff)%1000000).toString().padStart(6,'0');
  assert.equal(typeof s.factor,'function','app re-proof is missing');
  await s.factor(actor.token,actor.csrfToken,{kind:'totp',code});
  assert.equal((await transaction(pool,c=>registration.requireAccountActionProof(c,actor.token,actor.csrfToken))).accountId,accountId);
  await assert.rejects(s.factor(actor.token,actor.csrfToken,{kind:'totp',code}));
});

for(const change of ['expiry','password','email','logout'] as const)test(`a pending email proof cannot open a window after ${change}`,async()=>{
  const s=store(),challenge=await queued(s);
  if(change==='expiry')await pool.query("UPDATE cloud_sign_in_checks SET created_at=statement_timestamp()-interval '6 minutes',expires_at=statement_timestamp()-interval '1 minute'");
  if(change==='password')await pool.query('UPDATE cloud_credentials SET password_hash=$1',[await hashSecret('Another synthetic password')]);
  if(change==='email')await pool.query("UPDATE cloud_credentials SET email='other@example.test'");
  if(change==='logout')await pool.query('UPDATE cloud_sessions SET ended_at=clock_timestamp()');
  await assert.rejects(s.completeEmail(actor.token,actor.csrfToken,challenge.challengeToken,challenge.code));
  assert.equal((await pool.query('SELECT action_proved_at FROM cloud_sessions')).rows[0].action_proved_at,null);
});

test('security controls share the acting window while a passkey change revokes other sessions and pending work',async()=>{
  const passkeys=new registration.PasskeyStore(pool,{rpName:'Waitron Cloud',rpId:'cloud.example.test',origin:'https://cloud.example.test'});
  const factors=new registration.AuthenticatorFactorStore(pool,{activeKeyId:'test',keys:{test:'07'.repeat(32)}},{pendingLifetimeMs:300000,enrolmentAttempts:3});
  await refused(passkeys.registrationOptions(actor.token,actor.csrfToken,'Synthetic owner password'));
  await refused(factors.begin({...actor,password:'Synthetic owner password'}));
  const s=store(),challenge=await queued(s);await s.completeEmail(actor.token,actor.csrfToken,challenge.challengeToken,challenge.code);
  const peer=await transaction(pool,c=>createSession(c,accountId));await openProofWindow(pool,peer.token);
  const before=(await s.status(actor.token)).freshUntil;
  const first=await passkeys.registrationOptions(actor.token,actor.csrfToken,'');
  const pending=await factors.begin({...actor,password:''});assert.ok(pending.pendingToken);
  const id=randomUUID();await pool.query(`INSERT INTO cloud_passkeys(id,account_id,credential_id,public_key,counter,device_type,backed_up)
    VALUES($1,$2,'c3ludGhldGlj',$3,0,'multiDevice',true)`,[id,accountId,Buffer.from([1,2,3])]);
  // The raw fixture insert stands in for a pre-existing key, so retain the email window to exercise removal itself.
  assert.equal(await passkeys.remove(actor.token,actor.csrfToken,id,''),true);
  await assert.rejects(factors.activate({...actor,password:''},pending.pendingToken,'123456'),e=>e instanceof Error&&'code' in e&&e.code==='setup_unavailable');
  assert.equal((await s.status(actor.token)).freshUntil,before);
  assert.equal((await transaction(pool,c=>registration.requireAccountActionProof(c,actor.token,actor.csrfToken))).accountId,accountId);
  await refused(transaction(pool,c=>registration.requireAccountActionProof(c,peer.token,peer.csrfToken)));
  assert.ok((await pool.query('SELECT consumed_at FROM cloud_webauthn_ceremonies WHERE id=$1',[first.ceremonyId])).rows[0].consumed_at);
});

test('revoking the window also refuses delayed completion authority',async()=>{
 const s=store(),challenge=await queued(s);await s.completeEmail(actor.token,actor.csrfToken,challenge.challengeToken,challenge.code);
 const {invalidateAccountActionProof}=await import('../src/account-action-proof.ts');
 await transaction(pool,c=>invalidateAccountActionProof(c,accountId));
 await refused(transaction(pool,c=>registration.requireAccountActionProof(c,actor.token,actor.csrfToken,false)));
});

test('an app code that expires during its replay write cannot open a window or retain replay effects',async()=>{
 const {encryptFactorSecret}=await import('@waitron-cloud/identity'),keys={activeKeyId:'test',keys:{test:'07'.repeat(32)}};
 await pool.query('INSERT INTO cloud_authenticator_factors(account_id,version,secret_generation,secret_envelope) VALUES($1,1,$2,$3)',[accountId,randomUUID(),encryptFactorSecret('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',keys,{accountId,version:1,purpose:'active'})]);
 await pool.query('CREATE TABLE proof_clock(moment timestamptz NOT NULL)');await pool.query('INSERT INTO proof_clock VALUES($1)',[new Date(59000)]);
 await pool.query(`CREATE FUNCTION ${schema}.clock_timestamp() RETURNS timestamptz LANGUAGE SQL VOLATILE AS 'SELECT moment FROM ${schema}.proof_clock'`);
 const timed=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema},pg_catalog -c statement_timeout=10000`,application_name:schema});
 const blocker=await pool.connect();let work:Promise<void>|undefined;
 try{
  await blocker.query('BEGIN');await blocker.query('LOCK TABLE cloud_factor_replays IN SHARE MODE');
  work=refused(new registration.AccountActionProofStore(timed,keys,{challengeAttempts:3},outbox).factor(actor.token,actor.csrfToken,{kind:'totp',code:'287082'}));
  let waiting=false;for(let i=0;i<100;i++){if((await admin.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE 'INSERT INTO cloud_factor_replays%'",[schema])).rowCount){waiting=true;break;}await new Promise(r=>setTimeout(r,10));}
  assert.ok(waiting,'the real replay write must have started');await pool.query('UPDATE proof_clock SET moment=$1',[new Date(91000)]);await blocker.query('COMMIT');await work;
  assert.equal((await pool.query('SELECT count(*) FROM cloud_factor_replays')).rows[0].count,'0');assert.equal((await pool.query('SELECT action_proved_at FROM cloud_sessions')).rows[0].action_proved_at,null);
 }finally{await blocker.query('ROLLBACK');blocker.release();await work?.catch(()=>{});await timed.end();await pool.query(`DROP FUNCTION ${schema}.clock_timestamp()`);}
});

test('email expiry during window persistence keeps its attempt but cannot publish proof',async()=>{
 const s=store(),challenge=await queued(s),now=new Date();
 await pool.query('CREATE TABLE email_proof_clock(moment timestamptz NOT NULL,later timestamptz NOT NULL)');
 await pool.query('INSERT INTO email_proof_clock VALUES($1,$2)',[now,new Date(Date.parse(challenge.expiresAt)+1)]);
 await pool.query(`CREATE FUNCTION ${schema}.clock_timestamp() RETURNS timestamptz LANGUAGE SQL VOLATILE AS 'SELECT moment FROM ${schema}.email_proof_clock'`);
 await pool.query(`CREATE FUNCTION expire_email_proof() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE email_proof_clock SET moment=later; RETURN NEW; END $$`);
 await pool.query('CREATE TRIGGER expire_email_proof BEFORE UPDATE OF action_proved_at ON cloud_sessions FOR EACH ROW EXECUTE FUNCTION expire_email_proof()');
 const timed=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema},pg_catalog -c statement_timeout=10000`});
 try{
  const result=await new registration.AccountActionProofStore(timed,null,{challengeAttempts:3},outbox).completeEmail(actor.token,actor.csrfToken,challenge.challengeToken,challenge.code).catch(e=>e);
  assert.equal((await pool.query('SELECT action_proved_at FROM cloud_sessions')).rows[0].action_proved_at,null,'an expired email must not open a window');
  assert.equal(result?.code,'proof_required');const row=(await pool.query('SELECT attempts,consumed_at FROM cloud_sign_in_checks')).rows[0];assert.equal(row.attempts,1);assert.equal(row.consumed_at,null);
 }finally{await timed.end();await pool.query(`DROP FUNCTION ${schema}.clock_timestamp()`);}
});


test('proof methods offer recovery only while an unused account code exists',async()=>{
 await pool.query('INSERT INTO cloud_passkey_users(account_id,user_handle) VALUES($1,$2)',[accountId,Buffer.alloc(32,1)]);
 const id=randomUUID();await pool.query(`INSERT INTO cloud_passkeys(id,account_id,credential_id,public_key,counter,device_type,backed_up) VALUES($1,$2,'b3duZXI',$3,0,'multiDevice',true)`,[id,accountId,Buffer.from([1,2,3])]);
 assert.deepEqual((await store().status(actor.token)).methods,['passkey']);
 await transaction(pool,c=>createAccountRecoveryCodes(c,accountId));
 assert.deepEqual((await store().status(actor.token)).methods,['passkey','recovery']);
 await pool.query('UPDATE cloud_factor_recovery_codes SET consumed_at=clock_timestamp()');
 assert.deepEqual((await store().status(actor.token)).methods,['passkey']);
});


test('authorised app setup can complete after its proof window expires',async()=>{
 const s=store(),challenge=await queued(s);await s.completeEmail(actor.token,actor.csrfToken,challenge.challengeToken,challenge.code);
 const factors=new registration.AuthenticatorFactorStore(pool,{activeKeyId:'test',keys:{test:'07'.repeat(32)}},{pendingLifetimeMs:300000,enrolmentAttempts:3});
 await pool.query("UPDATE cloud_sessions SET action_proved_at=clock_timestamp()-interval '9 minutes 59 seconds'");
 const pending=await factors.begin({...actor,password:''});await pool.query("UPDATE cloud_sessions SET action_proved_at=clock_timestamp()-interval '10 minutes 1 second'");
 const bits=[...pending.secret].map(c=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0')).join(''),key=Buffer.from(bits.match(/.{8}/g)!.map(b=>parseInt(b,2))),counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const mac=createHmac('sha1',key).update(counter).digest(),offset=mac[19]!&15,code=((mac.readUInt32BE(offset)&0x7fffffff)%1000000).toString().padStart(6,'0');
 const changed=await factors.activate({...actor,password:''},pending.pendingToken,code);assert.equal(changed.active,true);assert.equal(changed.recoveryCodes?.length,10);
});
