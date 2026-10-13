import {resetSchema} from './fixtures/reset-schema.ts';
import assert from 'node:assert/strict';
import {createHash, createHmac, randomUUID} from 'node:crypto';
import {after, before, beforeEach, test} from 'node:test';
import {Pool} from 'pg';
import {encryptFactorSecret, hashSecret, resolveSession} from '@waitron-cloud/identity';
import * as registration from '../src/index.ts';
import {migrate} from '../src/migrate.ts';
import {transaction} from '../src/transaction.ts';

if (!process.env.TEST_DATABASE_URL) throw new Error('Run the PostgreSQL test wrapper');
const schema = `factor_login_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({connectionString: process.env.TEST_DATABASE_URL});
const pool = new Pool({connectionString: process.env.TEST_DATABASE_URL,
  options: `-c search_path=${schema} -c statement_timeout=10000`, application_name: schema});
const accountId = randomUUID();
const generation = randomUUID();
const email = 'owner@example.test';
const password = 'venue-owner-password';
const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const keys = {activeKeyId: 'test', keys: {test: '07'.repeat(32)}};
const policy = {loginLifetimeMs: 300_000, challengeAttempts: 3};
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const proof = (code: string) => ({kind: 'totp' as const, code});
const recovery = (code: string) => ({kind: 'recovery' as const, code});
function totp(now = Date.now()) {
  const bytes = Buffer.alloc(8); bytes.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const mac = createHmac('sha1', Buffer.from('12345678901234567890')).update(bytes).digest();
  return ((mac.readUInt32BE(mac[19]! & 15) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}
function store(config: typeof keys | null = keys, rules: typeof policy | null = policy) {
  assert.equal(typeof registration.PasswordLoginStore, 'function', 'password factor challenges are unavailable');
  return new registration.PasswordLoginStore(pool, config, rules);
}
async function refused(action: Promise<unknown>, code = 'credentials_invalid') {
  await assert.rejects(action, (e: unknown) => e instanceof Error && 'code' in e && e.code === code);
}
async function enrol(version = 1, owner = accountId) {
  await pool.query(`INSERT INTO cloud_authenticator_factors (account_id,version,secret_generation,secret_envelope)
    VALUES ($1,$2,$3,$4)`, [owner, version, generation,
    encryptFactorSecret(secret, keys, {accountId: owner, version, purpose: 'active'})]);
}
async function challenge(s = store()) {
  const result = await s.start({email, password});
  assert.equal(result.kind, 'factor');
  assert.deepEqual(Object.keys(result).sort(), ['challengeToken', 'expiresAt', 'kind']);
  assert.match(result.challengeToken, /^[A-Za-z0-9_-]{43}$/);
  return result.challengeToken;
}
async function seedCode(code: string, owner = accountId, version = 1) {
  await pool.query(`INSERT INTO cloud_factor_recovery_codes (account_id,secret_generation,factor_version,code_hash)
    VALUES ($1,$2,$3,$4)`, [owner,generation,version,
    digest(JSON.stringify(['cloud-factor-recovery-v1',owner,version,code.toUpperCase()]))]);
}
async function sessionCount() {return Number((await pool.query('SELECT count(*) FROM cloud_sessions')).rows[0].count);}
before(async () => {await admin.query(`CREATE SCHEMA ${schema}`); await migrate(pool);});
after(async () => {await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();});
beforeEach(async () => {
  await resetSchema(pool);
  await pool.query('INSERT INTO cloud_accounts (id) VALUES ($1)', [accountId]);
  await pool.query('INSERT INTO cloud_credentials (account_id,email,password_hash) VALUES ($1,$2,$3)',
    [accountId,email,await hashSecret(password)]);
});

test('without a factor login still creates a full session when factor configuration is absent', async () => {
  const result = await store(null, null).start({email: `  ${email.toUpperCase()} `,password});
  assert.equal(result.kind, 'session');
  assert.equal((await transaction(pool,c => resolveSession(c,result.credentials.token))).accountId,accountId);
  assert.equal(await sessionCount(), 1);
});
test('factor challenges store only a hash and cannot authenticate a session endpoint', async () => {
  await enrol(); const token = await challenge();
  const row = (await pool.query('SELECT * FROM cloud_factor_login_challenges')).rows[0];
  assert.equal(row.token_hash,digest(token)); assert.equal(row.account_id,accountId);
  assert.equal(row.factor_version,1); assert.equal(row.attempts,0); assert.equal(row.attempt_limit,3);
  assert.equal(row.expires_at - row.created_at,300_000);
  assert.equal(JSON.stringify(row).includes(token),false); assert.equal(await sessionCount(),0);
  await refused(transaction(pool,c => resolveSession(c,token)), 'session_unavailable');
});
test('unknown, wrong, disabled and passwordless accounts receive the same refusal', async () => {
  const s = store();
  await refused(s.start({email:'unknown@example.test',password}));
  await refused(s.start({email,password:'incorrect'}));
  await pool.query('UPDATE cloud_accounts SET disabled_at = clock_timestamp()'); await refused(s.start({email,password}));
  await pool.query('UPDATE cloud_accounts SET disabled_at = NULL');
  await pool.query('UPDATE cloud_credentials SET password_hash = NULL'); await refused(s.start({email,password}));
  assert.equal(await sessionCount(),0); assert.equal((await pool.query('SELECT count(*) FROM cloud_factor_login_challenges')).rows[0].count,'0');
});
test('one valid authenticator completion consumes its challenge and rejects replay on another challenge', async () => {
  await enrol(); const s=store(); const first=await challenge(s); const second=await challenge(s); const code=totp();
  const credentials=await s.complete(first,proof(code));
  assert.equal((await transaction(pool,c=>resolveSession(c,credentials.token))).accountId,accountId);
  assert.equal(await sessionCount(),1);
  await refused(s.complete(first,proof(code))); await refused(s.complete(second,proof(code)));
  const rows=(await pool.query('SELECT * FROM cloud_factor_replays')).rows;
  assert.ok(rows.length >= 1); assert.ok(rows.every(r=>r.code_hash !== code && r.account_id===accountId));
  assert.ok((await pool.query('SELECT consumed_at FROM cloud_factor_login_challenges WHERE token_hash=$1',[digest(first)])).rows[0].consumed_at);
});
test('two independent completions of the same challenge create exactly one session', async () => {
  await enrol(); const token=await challenge(); const code=totp();
  const otherPool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
  try {
    const other=new registration.PasswordLoginStore(otherPool,keys,policy);
    const results=await Promise.allSettled([store().complete(token,proof(code)),other.complete(token,proof(code))]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.filter(r=>r.status==='rejected' && r.reason.code==='credentials_invalid').length,1);
    assert.equal(await sessionCount(),1);
  } finally {await otherPool.end();}
});
test('wrong proofs durably exhaust the budget without consuming proof or creating a session', async () => {
  await enrol(); const token=await challenge();
  for(let i=0;i<3;i++) await refused(store().complete(token,proof('not-six-digits')));
  assert.equal((await pool.query('SELECT attempts,consumed_at FROM cloud_factor_login_challenges')).rows[0].attempts,3);
  await refused(store().complete(token,proof(totp())));
  assert.equal((await pool.query('SELECT attempts,consumed_at FROM cloud_factor_login_challenges')).rows[0].consumed_at,null);
  assert.equal((await pool.query('SELECT count(*) FROM cloud_factor_replays')).rows[0].count,'0');
  assert.equal(await sessionCount(),0);
});
test('unknown, malformed, expired and consumed challenge tokens cannot create sessions', async () => {
  await enrol(); const token=await challenge();
  for(const value of ['bad',digest(token),'A'.repeat(43)]) await refused(store().complete(value,proof(totp())));
  await pool.query("UPDATE cloud_factor_login_challenges SET created_at=clock_timestamp()-interval '10 minutes',expires_at=clock_timestamp()-interval '1 second'");
  await refused(store().complete(token,proof(totp()))); assert.equal(await sessionCount(),0);
});
test('a changed password, disabled account, removed factor or changed factor version invalidates the challenge', async () => {
  await enrol();
  const original=(await pool.query('SELECT password_hash FROM cloud_credentials')).rows[0].password_hash;
  for(const change of ['password','disabled','removed','version']) {
    const token=await challenge();
    if(change==='password') await pool.query('UPDATE cloud_credentials SET password_hash=$1',[await hashSecret('changed-password')]);
    if(change==='disabled') await pool.query('UPDATE cloud_accounts SET disabled_at=clock_timestamp()');
    if(change==='removed') await pool.query('UPDATE cloud_authenticator_factors SET secret_envelope=NULL,secret_generation=NULL');
    if(change==='version') await pool.query('UPDATE cloud_authenticator_factors SET version=2,secret_envelope=$1',
      [encryptFactorSecret(secret,keys,{accountId,version:2,purpose:'active'})]);
    await refused(store().complete(token,proof(totp()))); assert.equal(await sessionCount(),0);
    await pool.query('UPDATE cloud_credentials SET password_hash=$1',[original]);
    await pool.query('UPDATE cloud_accounts SET disabled_at=NULL');
    await pool.query('DELETE FROM cloud_authenticator_factors'); await enrol();
  }
});
test('recovery codes are account/version-bound, single-use and cannot authenticate alone', async () => {
  await enrol(); const s=store(); const code='0123456789ABCDEF0123456789ABCDEF'; await seedCode(code);
  const token=await challenge(s);
  const credentials=await s.complete(token,recovery('01234567-89abcdef-01234567-89abcdef'));
  assert.equal(credentials.accountId,accountId); assert.equal(await sessionCount(),1);
  await refused(s.complete(await challenge(s),recovery(code)));
  const other=randomUUID(); await pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[other]);
  await seedCode('11111111111111111111111111111111',other);
  await refused(s.complete(await challenge(s),recovery('11111111111111111111111111111111')));
  await seedCode('22222222222222222222222222222222',accountId,2);
  // Isolate the metadata guard from the independent version-bound hash guard.
  await pool.query('UPDATE cloud_factor_recovery_codes SET code_hash=$1 WHERE factor_version=2',
    [digest(JSON.stringify(['cloud-factor-recovery-v1',accountId,1,'22222222222222222222222222222222']))]);
  await refused(s.complete(await challenge(s),recovery('22222222222222222222222222222222')));
  assert.equal(await sessionCount(),1);
});
test('missing policy or unreadable keys refuse active-factor password login without affecting no-factor login', async () => {
  await enrol();
  await refused(store(keys,null).start({email,password}),'temporarily_unavailable');
  for(const bad of [null,{activeKeyId:'test',keys:{test:'08'.repeat(32)}}]) {
    await refused(store(bad).complete(await challenge(),recovery('0123456789ABCDEF0123456789ABCDEF')),'temporarily_unavailable');
    await refused(store(bad).complete(await challenge(),proof(totp())),'temporarily_unavailable');
  }
  assert.equal(await sessionCount(),0);
});

async function blocked(queryPart: string) {
  const {setTimeout: delay}=await import('node:timers/promises');
  for(let i=0;i<150;i++) {
    const row=await admin.query(`SELECT 1 FROM pg_stat_activity WHERE application_name=$1
      AND wait_event_type='Lock' AND query LIKE $2`,[schema,`%${queryPart}%`]);
    if(row.rowCount) return;
    await delay(10);
  }
  assert.fail(`operation never waited for ${queryPart}`);
}
test('expiry during a challenge lock wait creates no session and spends no attempt', async () => {
  await enrol(); const token=await challenge(); const blocker=await pool.connect(); let completion:Promise<void>|undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query("UPDATE cloud_factor_login_challenges SET expires_at=clock_timestamp()+interval '500 milliseconds' WHERE token_hash=$1",[digest(token)]);
    completion=refused(store().complete(token,proof(totp())));
    await blocked('cloud_factor_login_challenges');
    const {setTimeout:delay}=await import('node:timers/promises'); await delay(550);
    await blocker.query('COMMIT'); await completion;
    assert.equal(await sessionCount(),0);
    assert.equal((await pool.query('SELECT attempts FROM cloud_factor_login_challenges')).rows[0].attempts,0);
  } finally {await blocker.query('ROLLBACK'); blocker.release(); await completion;}
});
test('expiry during a recovery-row wait preserves the code while durably spending the attempt', async () => {
  await enrol(); const code='33333333333333333333333333333333'; await seedCode(code); const token=await challenge();
  await pool.query("UPDATE cloud_factor_login_challenges SET expires_at=clock_timestamp()+interval '500 milliseconds'");
  const blocker=await pool.connect(); let completion:Promise<void>|undefined;
  try {
    await blocker.query('BEGIN'); await blocker.query('SELECT * FROM cloud_factor_recovery_codes FOR UPDATE');
    completion=refused(store().complete(token,recovery(code))); await blocked('cloud_factor_recovery_codes');
    const {setTimeout:delay}=await import('node:timers/promises'); await delay(550);
    await blocker.query('COMMIT'); await completion;
    assert.equal(await sessionCount(),0);
    assert.equal((await pool.query('SELECT attempts,consumed_at FROM cloud_factor_login_challenges')).rows[0].attempts,1);
    assert.equal((await pool.query('SELECT consumed_at FROM cloud_factor_recovery_codes')).rows[0].consumed_at,null);
  } finally {await blocker.query('ROLLBACK'); blocker.release(); await completion;}
});
test('expiry after proof consumption while session creation waits rolls back all effects but keeps the attempt', async () => {
  await enrol(); const code='44444444444444444444444444444444'; await seedCode(code); const token=await challenge();
  await pool.query("UPDATE cloud_factor_login_challenges SET expires_at=clock_timestamp()+interval '500 milliseconds'");
  const blocker=await pool.connect(); let completion:Promise<void>|undefined;
  try {
    await blocker.query('BEGIN'); await blocker.query('LOCK TABLE cloud_sessions IN ACCESS EXCLUSIVE MODE');
    completion=refused(store().complete(token,recovery(code))); await blocked('INSERT INTO cloud_sessions');
    const {setTimeout:delay}=await import('node:timers/promises'); await delay(550);
    await blocker.query('COMMIT'); await completion;
    assert.equal(await sessionCount(),0);
    const row=(await pool.query('SELECT attempts,consumed_at FROM cloud_factor_login_challenges')).rows[0];
    assert.equal(row.attempts,1); assert.equal(row.consumed_at,null);
    assert.equal((await pool.query('SELECT consumed_at FROM cloud_factor_recovery_codes')).rows[0].consumed_at,null);
  } finally {await blocker.query('ROLLBACK'); blocker.release(); await completion;}
});
test('concurrent distinct challenges cannot spend a recovery code twice', async () => {
  await enrol(); const code='55555555555555555555555555555555'; await seedCode(code);
  const first=await challenge(),second=await challenge();
  const results=await Promise.allSettled([store().complete(first,recovery(code)),store().complete(second,recovery(code))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected' && r.reason.code==='credentials_invalid').length,1);
  assert.equal(await sessionCount(),1);
});
test('a proof already accepted by another operation is rejected for login', async () => {
  await enrol(); const token=await challenge(); const code=totp(); const step=Math.floor(Date.now()/30_000);
  await pool.query(`INSERT INTO cloud_factor_replays (account_id,secret_generation,time_step,code_hash,valid_until)
    VALUES($1,$2,$3,$4,clock_timestamp()+interval '2 minutes')`,[accountId,generation,step,
    digest(JSON.stringify(['cloud-factor-proof-v1',accountId,generation,code]))]);
  await refused(store().complete(token,proof(code))); assert.equal(await sessionCount(),0);
});
test('a reset committed while completion waits on the account invalidates the password challenge', async () => {
  await enrol(); const token=await challenge(); const blocker=await pool.connect(); let completion:Promise<void>|undefined;
  try {
    await blocker.query('BEGIN'); await blocker.query('SELECT id FROM cloud_accounts WHERE id=$1 FOR UPDATE',[accountId]);
    completion=refused(store().complete(token,proof(totp()))); await blocked('cloud_accounts');
    await blocker.query('UPDATE cloud_credentials SET password_hash=$1',[await hashSecret('reset-password')]);
    await blocker.query('COMMIT'); await completion; assert.equal(await sessionCount(),0);
    assert.equal((await pool.query('SELECT consumed_at FROM cloud_factor_login_challenges')).rows[0].consumed_at,null);
  } finally {await blocker.query('ROLLBACK'); blocker.release(); await completion;}
});

test('authenticator expiry during session creation cannot commit a stale proof even while its challenge stays live', async () => {
  await enrol();
  // A schema-local clock gives the RFC vector a deterministic window; all effects and waits use PostgreSQL.
  await pool.query('CREATE TABLE factor_test_clock(moment timestamptz NOT NULL)');
  await pool.query('INSERT INTO factor_test_clock VALUES($1)',[new Date(59_000)]);
  await pool.query(`CREATE FUNCTION ${schema}.clock_timestamp() RETURNS timestamptz LANGUAGE SQL VOLATILE
    AS 'SELECT moment FROM ${schema}.factor_test_clock'`);
  const timedPool=new Pool({connectionString:process.env.TEST_DATABASE_URL,
    options:`-c search_path=${schema},pg_catalog -c statement_timeout=10000`,application_name:schema});
  const s=new registration.PasswordLoginStore(timedPool,keys,policy);
  const token=await challenge(s); const blocker=await pool.connect(); let completion:Promise<{value?:unknown;error?:{code:string}}>|undefined;
  try {
    await blocker.query('BEGIN'); await blocker.query('LOCK TABLE cloud_sessions IN ACCESS EXCLUSIVE MODE');
    completion=s.complete(token,proof('287082')).then(value=>({value}),error=>({error}));
    await blocked('INSERT INTO cloud_sessions');
    await pool.query('UPDATE factor_test_clock SET moment=$1',[new Date(91_000)]);
    await blocker.query('COMMIT');
    const result=await completion;
    assert.equal(result.error?.code,'credentials_invalid');
    assert.equal(await sessionCount(),0);
    const row=(await pool.query('SELECT attempts,consumed_at,expires_at FROM cloud_factor_login_challenges')).rows[0];
    assert.equal(row.attempts,1); assert.equal(row.consumed_at,null); assert.ok(row.expires_at>new Date(91_000));
    assert.equal((await pool.query('SELECT count(*) FROM cloud_factor_replays')).rows[0].count,'0');
  } finally {
    await blocker.query('ROLLBACK'); blocker.release(); await completion; await timedPool.end();
    await pool.query(`DROP FUNCTION ${schema}.clock_timestamp()`); await pool.query('DROP TABLE factor_test_clock');
  }
});


test('concurrent different recovery codes cannot complete the same challenge twice', async () => {
  await enrol(); const token=await challenge();
  const codes=['66666666666666666666666666666666','77777777777777777777777777777777'];
  for(const code of codes) await seedCode(code);
  const results=await Promise.allSettled(codes.map(code=>store().complete(token,recovery(code))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected' && r.reason.code==='credentials_invalid').length,1);
  assert.equal(await sessionCount(),1);
  assert.equal((await pool.query('SELECT count(*) FROM cloud_factor_recovery_codes WHERE consumed_at IS NOT NULL')).rows[0].count,'1');
});
test('unexpected session-write failures roll back the attempt and all proof effects', async () => {
  await enrol(); const token=await challenge(); const code='88888888888888888888888888888888'; await seedCode(code);
  await pool.query(`CREATE FUNCTION reject_factor_session() RETURNS trigger LANGUAGE plpgsql AS
    'BEGIN RAISE EXCEPTION USING ERRCODE = ''P0001'', MESSAGE = ''fixture session failure''; END'`);
  await pool.query('CREATE TRIGGER reject_factor_session BEFORE INSERT ON cloud_sessions FOR EACH ROW EXECUTE FUNCTION reject_factor_session()');
  try {
    await assert.rejects(store().complete(token,recovery(code)),(e:unknown)=>!!e && typeof e==='object' && 'code' in e && e.code==='P0001');
    assert.equal(await sessionCount(),0);
    const row=(await pool.query('SELECT attempts,consumed_at FROM cloud_factor_login_challenges')).rows[0];
    assert.equal(row.attempts,0); assert.equal(row.consumed_at,null);
    assert.equal((await pool.query('SELECT consumed_at FROM cloud_factor_recovery_codes')).rows[0].consumed_at,null);
  } finally {await pool.query('DROP TRIGGER reject_factor_session ON cloud_sessions'); await pool.query('DROP FUNCTION reject_factor_session()');}
});
async function fixedClock(milliseconds:number) {
  await pool.query('CREATE TABLE factor_test_clock(moment timestamptz NOT NULL)');
  await pool.query('INSERT INTO factor_test_clock VALUES($1)',[new Date(milliseconds)]);
  await pool.query(`CREATE FUNCTION ${schema}.clock_timestamp() RETURNS timestamptz LANGUAGE SQL VOLATILE
    AS 'SELECT moment FROM ${schema}.factor_test_clock'`);
  const timedPool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema},pg_catalog`,application_name:schema});
  return {pool:timedPool,async close(){await timedPool.end();await pool.query(`DROP FUNCTION ${schema}.clock_timestamp()`);await pool.query('DROP TABLE factor_test_clock');}};
}
test('colliding authenticator codes record all matched steps and reject a later partial overlap', async () => {
  await enrol(); const clock=await fixedClock(910738*30_000);
  try {
    const s=new registration.PasswordLoginStore(clock.pool,keys,policy);
    const first=await challenge(s),second=await challenge(s);
    await s.complete(first,proof('911617'));
    const rows=(await pool.query('SELECT time_step,valid_until FROM cloud_factor_replays ORDER BY time_step')).rows;
    assert.deepEqual(rows.map(r=>Number(r.time_step)),[910737,910738]);
    assert.ok(rows.every(r=>r.valid_until.getTime()===910740*30_000));
    await pool.query('UPDATE factor_test_clock SET moment=$1',[new Date(910739*30_000)]);
    await refused(s.complete(second,proof('911617'))); assert.equal(await sessionCount(),1);
  } finally {await clock.close();}
});
test('any already consumed matched step rejects a colliding code without recording its other step', async () => {
  await enrol(); const clock=await fixedClock(910738*30_000);
  try {
    const s=new registration.PasswordLoginStore(clock.pool,keys,policy); const token=await challenge(s);
    await pool.query(`INSERT INTO cloud_factor_replays(account_id,secret_generation,time_step,code_hash,valid_until)
      VALUES($1,$2,910737,$3,$4)`,[accountId,generation,'f'.repeat(64),new Date(910739*30_000)]);
    await refused(s.complete(token,proof('911617'))); assert.equal(await sessionCount(),0);
    assert.equal((await pool.query('SELECT count(*) FROM cloud_factor_replays')).rows[0].count,'1');
  } finally {await clock.close();}
});
test('a live code digest rejects replay even when the matching step set has changed', async () => {
  await enrol(); const clock=await fixedClock(59_000);
  try {
    const s=new registration.PasswordLoginStore(clock.pool,keys,policy); const token=await challenge(s);
    await pool.query(`INSERT INTO cloud_factor_replays(account_id,secret_generation,time_step,code_hash,valid_until)
      VALUES($1,$2,0,$3,$4)`,[accountId,generation,
      digest(JSON.stringify(['cloud-factor-proof-v1',accountId,generation,'287082'])),new Date(90_000)]);
    await refused(s.complete(token,proof('287082'))); assert.equal(await sessionCount(),0);
  } finally {await clock.close();}
});
