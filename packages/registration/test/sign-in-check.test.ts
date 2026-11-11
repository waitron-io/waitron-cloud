import assert from 'node:assert/strict';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {after, before, beforeEach, test} from 'node:test';
import {Pool} from 'pg';
import {hashSecret, encryptFactorSecret} from '@waitron-cloud/identity';
import {EmailOutbox, EmailWorker, PasswordLoginStore, PasswordRecoveryStore} from '../src/index.ts';
import {resetSchema} from './fixtures/reset-schema.ts';
import {transaction} from '../src/transaction.ts';
import {resolveSession} from '@waitron-cloud/identity';
import {migrate} from '../src/migrate.ts';

if (!process.env.TEST_DATABASE_URL) throw new Error('Run through scripts/test-postgres.mjs');
const schema = `sign_in_check_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({connectionString: process.env.TEST_DATABASE_URL});
const pool = new Pool({connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema} -c statement_timeout=10000`, application_name: schema});
const accountId = randomUUID(), email = 'owner@example.test', password = 'A synthetic account password';
const outbox = new EmailOutbox({activeKeyId: 'test', keys: {test: '07'.repeat(32)}});
const policy = {loginLifetimeMs: 300_000, challengeAttempts: 5};
before(async () => {await admin.query(`CREATE SCHEMA ${schema}`); await migrate(pool);});
after(async () => {await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();});

beforeEach(async () => {
  await resetSchema(pool);
  await pool.query('INSERT INTO cloud_accounts(id) VALUES($1)', [accountId]);
  await pool.query('INSERT INTO cloud_credentials(account_id,email,password_hash,email_verified_at) VALUES($1,$2,$3,clock_timestamp())', [accountId,email,await hashSecret(password)]);
  await pool.query('INSERT INTO cloud_passkey_users(account_id,user_handle) VALUES($1,$2)', [accountId,randomBytes(32)]);
  await pool.query(`INSERT INTO cloud_passkeys(id,account_id,credential_id,public_key,counter,device_type,backed_up)
    VALUES($1,$2,'c3ludGhldGlj',$3,0,'multiDevice',true)`, [randomUUID(),accountId,Buffer.from([1,2,3])]);
});

test('password fallback for a passkey owner queues an email check before any session', async () => {
  const result = await new PasswordLoginStore(pool, null, policy, outbox).start({email,password});
  assert.equal(result.kind, 'email');
  assert.equal((await pool.query('SELECT count(*) FROM cloud_sessions')).rows[0].count, '0');
  assert.equal((await pool.query('SELECT count(*) FROM email_outbox')).rows[0].count, '1');
});


test('a mailbox code completes one session and cannot be replayed', async () => {
  const store = new PasswordLoginStore(pool,null,policy,outbox);
  const challenge = await store.start({email,password});
  assert.equal(challenge.kind,'email');
  const message = outbox.open((await pool.query('SELECT * FROM email_outbox')).rows[0]);
  assert.ok('code' in message);
  assert.match(message.code,/^[0-9]{6}$/);
  assert.equal(typeof store.completeEmailCheck,'function','mailbox completion is not implemented');
  const credentials = await store.completeEmailCheck(challenge.challengeToken,message.code);
  assert.equal((await transaction(pool,client => resolveSession(client,credentials.token))).accountId,accountId);
  await assert.rejects(store.completeEmailCheck(challenge.challengeToken,message.code),error => error instanceof Error && 'code' in error && error.code === 'credentials_invalid');
  assert.equal((await pool.query('SELECT count(*) FROM cloud_sessions')).rows[0].count,'1');
});

async function queued(store = new PasswordLoginStore(pool,null,policy,outbox)) {
  const challenge = await store.start({email,password});
  assert.equal(challenge.kind,'email');
  const message = outbox.open((await pool.query("SELECT * FROM email_outbox WHERE kind='sign_in_check' ORDER BY created_at DESC LIMIT 1")).rows[0]);
  assert.ok('code' in message);
  return {...challenge,code:message.code};
}
const refused = (action: Promise<unknown>) => assert.rejects(action,error => error instanceof Error && 'code' in error && error.code === 'credentials_invalid');

test('wrong mailbox codes spend the configured attempt limit durably', async () => {
  const store = new PasswordLoginStore(pool,null,policy,outbox), challenge = await queued(store);
  for (let i=0;i<5;i++) await refused(store.completeEmailCheck(challenge.challengeToken,'wrong'));
  assert.equal((await pool.query('SELECT attempts FROM cloud_sign_in_checks')).rows[0].attempts,5);
  await refused(store.completeEmailCheck(challenge.challengeToken,challenge.code));
  assert.equal((await pool.query('SELECT count(*) FROM cloud_sessions')).rows[0].count,'0');
});

test('an expired mailbox check cannot issue a session', async () => {
  const store = new PasswordLoginStore(pool,null,policy,outbox), challenge = await queued(store);
  await pool.query("UPDATE cloud_sign_in_checks SET created_at=statement_timestamp()-interval '6 minutes',expires_at=statement_timestamp()-interval '1 minute'");
  await refused(store.completeEmailCheck(challenge.challengeToken,challenge.code));
  assert.equal((await pool.query('SELECT count(*) FROM cloud_sessions')).rows[0].count,'0');
});

test('a changed password or email cannot retain an older mailbox proof', async t => {
  for (const field of ['password','email'] as const) await t.test(field,async () => {
    const store = new PasswordLoginStore(pool,null,policy,outbox), challenge = await queued(store);
    if (field==='password') await pool.query('UPDATE cloud_credentials SET password_hash=$1',[await hashSecret('Another synthetic account password')]);
    else await pool.query("UPDATE cloud_credentials SET email='changed@example.test'");
    await refused(store.completeEmailCheck(challenge.challengeToken,challenge.code));
    assert.equal((await pool.query('SELECT count(*) FROM cloud_sessions')).rows[0].count,'0');
  });
});


test('an app enrolled while email is pending still wins at completion and the next password sign-in', async () => {
  const keys = {activeKeyId:'test',keys:{test:'07'.repeat(32)}};
  const store = new PasswordLoginStore(pool,keys,policy,outbox), challenge = await queued(store);
  await pool.query(`INSERT INTO cloud_authenticator_factors(account_id,version,secret_generation,secret_envelope) VALUES($1,1,$2,$3)`,
    [accountId,randomUUID(),encryptFactorSecret('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',keys,{accountId,version:1,purpose:'active'})]);
  await refused(store.completeEmailCheck(challenge.challengeToken,challenge.code));
  assert.equal((await store.start({email,password})).kind,'factor');
  assert.equal((await pool.query('SELECT count(*) FROM email_outbox')).rows[0].count,'1');
  assert.equal((await pool.query('SELECT count(*) FROM cloud_sessions')).rows[0].count,'0');
});

test('two independent completions consume one mailbox code and create exactly one session', async () => {
  const store = new PasswordLoginStore(pool,null,policy,outbox), challenge = await queued(store);
  const results = await Promise.allSettled([store.completeEmailCheck(challenge.challengeToken,challenge.code),store.completeEmailCheck(challenge.challengeToken,challenge.code)]);
  assert.equal(results.filter(result => result.status==='fulfilled').length,1);
  assert.equal(results.filter(result => result.status==='rejected' && result.reason.code==='credentials_invalid').length,1);
  assert.equal((await pool.query('SELECT count(*) FROM cloud_sessions')).rows[0].count,'1');
});

test('mailbox codes keep leading zeroes and are bound to the opaque browser challenge', async () => {
  const store = new PasswordLoginStore(pool,null,policy,outbox), challenge = await queued(store);
  const code = '000123';
  const hash = createHash('sha256').update(JSON.stringify(['cloud-email-sign-in-v1',challenge.challengeToken,code])).digest('hex');
  await pool.query('UPDATE cloud_sign_in_checks SET code_hash=$1',[hash]);
  await refused(store.completeEmailCheck('A'.repeat(43),code));
  assert.equal((await store.completeEmailCheck(challenge.challengeToken,code)).accountId,accountId);
});

test('mailbox expiry while session insertion waits rolls back the session and consumption', async t => {
  const store = new PasswordLoginStore(pool,null,policy,outbox), challenge = await queued(store);
  const blocker = await pool.connect(); let completion: Promise<void> | undefined;
  try {
    await pool.query("UPDATE cloud_sign_in_checks SET expires_at=clock_timestamp()+interval '2 seconds'");
    await blocker.query('BEGIN');
    await blocker.query('LOCK TABLE cloud_sessions IN ACCESS EXCLUSIVE MODE');
    completion = refused(store.completeEmailCheck(challenge.challengeToken,challenge.code));
    await t.waitFor(async () => assert.equal((await pool.query(`SELECT count(*) FROM pg_stat_activity WHERE application_name=$1
      AND wait_event_type='Lock' AND query LIKE 'INSERT INTO cloud_sessions%'`,[schema])).rows[0].count,'1'),{timeout:5000});
    await blocker.query('SELECT pg_sleep(2.1)');
    await blocker.query('COMMIT'); await completion;
    const check = (await pool.query('SELECT attempts,consumed_at FROM cloud_sign_in_checks')).rows[0];
    assert.equal(check.attempts,1); assert.equal(check.consumed_at,null);
    assert.equal((await pool.query('SELECT count(*) FROM cloud_sessions')).rows[0].count,'0');
  } finally {await blocker.query('ROLLBACK');blocker.release();await completion;}
});


test('the email worker delivers the queued mailbox code through its own template', async () => {
  const challenge = await queued(), sent: {code:string;email:string}[] = [];
  const unexpected = async () => {throw new Error('wrong account email kind');};
  const worker = new EmailWorker(pool,outbox,{sendVerification:unexpected,sendPasswordReset:unexpected,sendPasswordChanged:unexpected,sendServiceAlert:unexpected,
    async sendSignInCheck(message: {code:string;email:string}) {sent.push(message);}});
  assert.equal(await worker.runOnce(),true); assert.equal(await worker.runOnce(),false);
  assert.equal(sent.length,1); assert.equal(sent[0]!.code,challenge.code); assert.equal(sent[0]!.email,email);
  const row = (await pool.query('SELECT status,payload FROM email_outbox')).rows[0];
  assert.equal(row.status,'sent'); assert.equal(row.payload,null);
});

test('password reset cancels pending mailbox challenges and their queued messages', async () => {
  const store = new PasswordLoginStore(pool,null,policy,outbox), challenge = await queued(store);
  const recovery = new PasswordRecoveryStore(pool,outbox); await recovery.request(email);
  const reset = outbox.open((await pool.query("SELECT * FROM email_outbox WHERE kind='password_reset'")).rows[0]);
  assert.ok('token' in reset);
  await recovery.complete(reset.token,'A different synthetic account password');
  assert.ok((await pool.query('SELECT consumed_at FROM cloud_sign_in_checks')).rows[0].consumed_at);
  await refused(store.completeEmailCheck(challenge.challengeToken,challenge.code));
  const delivered: string[] = [];
  const worker = new EmailWorker(pool,outbox,{async sendVerification() {delivered.push('verification');},async sendPasswordReset() {delivered.push('reset');},
    async sendPasswordChanged() {delivered.push('changed');},async sendServiceAlert() {delivered.push('alert');},async sendSignInCheck() {delivered.push('check');}});
  while (await worker.runOnce()) {}
  assert.deepEqual(delivered,['changed']);
});


test('an outbox refusal rolls back both the mailbox challenge and session issuance',async()=>{
  await pool.query("ALTER TABLE email_outbox ADD CONSTRAINT refuse_test_check CHECK(kind<>'sign_in_check')");
  try{await assert.rejects(new PasswordLoginStore(pool,null,policy,outbox).start({email,password}),/refuse_test_check/);}
  finally{await pool.query('ALTER TABLE email_outbox DROP CONSTRAINT refuse_test_check');}
  for(const table of ['cloud_sessions','cloud_sign_in_checks','email_outbox'])assert.equal((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count,'0',table);
});
