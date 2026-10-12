import assert from 'node:assert/strict';
import {createHash, createHmac, randomUUID} from 'node:crypto';
import {after, before, beforeEach, test} from 'node:test';
import {Pool} from 'pg';
import {createSession, decryptFactorSecret, encryptFactorSecret, endSession, hashSecret, resolveSession, revokeAccountSession} from '@waitron-cloud/identity';
import * as registration from '../src/index.ts';
import {migrate} from '../src/migrate.ts';
import {transaction} from '../src/transaction.ts';
import {recoveryAndDeliver} from './fixtures/delivery.ts';

if (!process.env.TEST_DATABASE_URL) throw new Error('Run the PostgreSQL test wrapper');
const schema = `factor_manage_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({connectionString: process.env.TEST_DATABASE_URL});
const pool = new Pool({connectionString: process.env.TEST_DATABASE_URL,
  options: `-c search_path=${schema} -c statement_timeout=10000`, application_name: schema});
const accountId = randomUUID(), generation = randomUUID();
const email = 'owner@example.test', password = 'venue-owner-password';
const oldSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const keys = {activeKeyId: 'test', keys: {test: '07'.repeat(32)}};
const policy = {pendingLifetimeMs: 300_000, enrolmentAttempts: 3};
const loginPolicy = {loginLifetimeMs: 300_000, challengeAttempts: 3};
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const proof = (code: string) => ({kind: 'totp' as const, code});
const recovery = (code: string) => ({kind: 'recovery' as const, code});
function base32Bytes(secret: string) {
  const bits = [...secret].map(c => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5, '0')).join('');
  return Buffer.from(bits.match(/.{8}/g)!.map(b => parseInt(b, 2)));
}
function totp(secret: string, now = Date.now()) {
  const bytes = Buffer.alloc(8); bytes.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const mac = createHmac('sha1', base32Bytes(secret)).update(bytes).digest();
  return ((mac.readUInt32BE(mac[19]! & 15) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}
function store(config: typeof keys | null = keys, rules: typeof policy | null = policy, database = pool) {
  assert.equal(typeof registration.AuthenticatorFactorStore, 'function', 'authenticator management is unavailable');
  return new registration.AuthenticatorFactorStore(database, config, rules);
}
async function refused(action: Promise<unknown>, code = 'permission_denied') {
  await assert.rejects(action, (e: unknown) => e instanceof Error && 'code' in e && e.code === code);
}
async function authority() {return {...await transaction(pool, c => createSession(c, accountId)), password};}
async function active() {
  await pool.query(`INSERT INTO cloud_authenticator_factors(account_id,version,secret_generation,secret_envelope)
    VALUES($1,1,$2,$3)`, [accountId,generation,encryptFactorSecret(oldSecret, keys, {accountId,version:1,purpose:'active'})]);
}
async function seedCode(code: string, owner = accountId) {
  await pool.query(`INSERT INTO cloud_factor_recovery_codes(account_id,secret_generation,factor_version,code_hash)
    VALUES($1,$2,1,$3)`, [owner,generation,digest(JSON.stringify(['cloud-factor-recovery-v1',owner,1,code]))]);
}
async function factor() {return (await pool.query('SELECT * FROM cloud_authenticator_factors WHERE account_id=$1',[accountId])).rows[0];}
async function assertEnded() {assert.equal((await pool.query('SELECT count(*) FROM cloud_sessions WHERE ended_at IS NULL')).rows[0].count,'0');}
async function loginChallenge() {
  const result=await new registration.PasswordLoginStore(pool,keys,loginPolicy).start({email,password});
  assert.equal(result.kind,'factor'); return result.challengeToken;
}
before(async () => {await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
after(async () => {await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
beforeEach(async () => {
  await pool.query('TRUNCATE cloud_accounts,password_reset_requests,email_outbox CASCADE');
  await pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[accountId]);
  await pool.query(`INSERT INTO cloud_credentials(account_id,email,password_hash,email_verified_at)
    VALUES($1,$2,$3,clock_timestamp())`,[accountId,email,await hashSecret(password)]);
});

test('enrolment leaves password login unchanged until confirmation, then ends every session and returns hashed recovery codes once', async () => {
  const a=await authority();await authority();const s=store();
  assert.deepEqual(await s.status(a.token),{active:false,version:0,recoveryCodesRemaining:0,available:true});
  const pending=await s.begin(a);
  assert.match(pending.secret,/^[A-Z2-7]{32}$/);assert.match(pending.pendingToken,/^[A-Za-z0-9_-]{43}$/);
  const uri=new URL(pending.uri);assert.equal(uri.protocol,'otpauth:');assert.equal(uri.hostname,'totp');
  assert.equal(uri.searchParams.get('secret'),pending.secret);assert.equal(uri.searchParams.get('issuer'),'Waitron Cloud');
  assert.equal((await s.status(a.token)).active,false);
  assert.equal((await new registration.PasswordLoginStore(pool,null,null).start({email,password})).kind,'session');
  const row=(await pool.query('SELECT * FROM cloud_factor_enrolments')).rows[0];
  assert.equal(row.session_id,(await pool.query('SELECT id FROM cloud_sessions WHERE token_hash=$1',[digest(a.token)])).rows[0].id);
  assert.equal(row.expires_at-row.created_at,300_000);assert.equal(row.attempt_limit,3);
  assert.equal(JSON.stringify(row).includes(pending.secret),false);assert.equal(JSON.stringify(row).includes(pending.pendingToken),false);
  const changed=await s.activate(a,pending.pendingToken,totp(pending.secret));
  assert.equal(changed.status,'changed');assert.equal(changed.active,true);assert.equal(changed.recoveryCodes.length,10);
  assert.equal(new Set(changed.recoveryCodes).size,10);assert.ok(changed.recoveryCodes.every(c=>/^[0-9A-F]{32}$/.test(c)));
  await assertEnded();assert.equal((await factor()).version,1);
  const codes=(await pool.query('SELECT * FROM cloud_factor_recovery_codes')).rows;
  assert.equal(codes.length,10);assert.ok(codes.every(r=>!changed.recoveryCodes.includes(r.code_hash)));
  const challenge=await loginChallenge();
  await refused(new registration.PasswordLoginStore(pool,keys,loginPolicy).complete(challenge,proof(totp(pending.secret))),'credentials_invalid');
  const credentials=await new registration.PasswordLoginStore(pool,keys,loginPolicy).complete(challenge,recovery(changed.recoveryCodes[0]!));
  assert.deepEqual(await s.status(credentials.token),{active:true,version:1,recoveryCodesRemaining:9,available:true});
  assert.equal('recoveryCodes' in await s.status(credentials.token),false);
});
test('wrong password, CSRF, missing session and passkey-created session without factor proof cannot manage an active factor', async () => {
  await active();const a=await authority();const s=store();const code='0'.repeat(32);await seedCode(code);
  for(const bad of [{...a,password:'wrong'},{...a,csrfToken:'A'.repeat(43)},{...a,token:'A'.repeat(43)}]) {
    const auth={...bad,proof:recovery(code)};
    await refused(s.begin(auth));await refused(s.regenerate(auth));await refused(s.remove(auth));
  }
  await refused(s.begin(a));await refused(s.regenerate(a));await refused(s.remove(a));
  assert.equal((await pool.query('SELECT consumed_at FROM cloud_factor_recovery_codes')).rows[0].consumed_at,null);
  assert.equal((await factor()).version,1);assert.equal((await pool.query('SELECT count(*) FROM cloud_factor_enrolments')).rows[0].count,'0');
});
test('replacement requires old proof again and invalid confirmation spends an attempt without consuming a valid old recovery code', async () => {
  await active();const a=await authority();const codes=['1'.repeat(32),'2'.repeat(32)];for(const c of codes) await seedCode(c);
  const s=store(),pending=await s.begin({...a,proof:recovery(codes[0]!)});
  assert.equal((await factor()).version,1);assert.ok((await pool.query('SELECT consumed_at FROM cloud_factor_recovery_codes WHERE code_hash=$1',[digest(JSON.stringify(['cloud-factor-recovery-v1',accountId,1,codes[0]]))])).rows[0].consumed_at);
  await refused(s.activate({...a,proof:recovery(codes[1]!)},pending.pendingToken,'invalid'));
  let row=(await pool.query('SELECT attempts,consumed_at FROM cloud_factor_enrolments')).rows[0];
  assert.equal(row.attempts,1);assert.equal(row.consumed_at,null);
  assert.equal((await pool.query('SELECT consumed_at FROM cloud_factor_recovery_codes WHERE code_hash=$1',[digest(JSON.stringify(['cloud-factor-recovery-v1',accountId,1,codes[1]]))])).rows[0].consumed_at,null);
  const changed=await s.activate({...a,proof:recovery(codes[1]!)},pending.pendingToken,totp(pending.secret));
  assert.equal(changed.recoveryCodes.length,10);assert.equal((await factor()).version,2);assert.notEqual((await factor()).secret_generation,generation);await assertEnded();
  row=(await pool.query('SELECT attempts,consumed_at FROM cloud_factor_enrolments')).rows[0];assert.equal(row.attempts,2);assert.ok(row.consumed_at);
});
test('starting replacement keeps the old factor available for password sign-in and requires a fresh old proof to confirm',async()=>{
  await active();const a=await authority();for(const code of ['1'.repeat(32),'2'.repeat(32),'3'.repeat(32)]) await seedCode(code);
  const pending=await store().begin({...a,proof:recovery('1'.repeat(32))});
  const credentials=await new registration.PasswordLoginStore(pool,keys,loginPolicy).complete(await loginChallenge(),recovery('2'.repeat(32)));
  assert.equal((await transaction(pool,c=>resolveSession(c,credentials.token))).accountId,accountId);
  assert.equal((await factor()).version,1);
  await refused(store().activate(a,pending.pendingToken,totp(pending.secret)));
  assert.equal((await factor()).version,1);assert.equal((await pool.query('SELECT attempts FROM cloud_factor_enrolments')).rows[0].attempts,1);
  await store().activate({...a,proof:recovery('3'.repeat(32))},pending.pendingToken,totp(pending.secret));await assertEnded();assert.equal((await factor()).version,2);
});
test('activation refusals durably exhaust their budget without publishing a factor', async () => {
  const a=await authority(),s=store(),pending=await s.begin(a);
  for(let i=0;i<3;i++) await refused(s.activate(a,pending.pendingToken,'invalid'));
  await refused(s.activate(a,pending.pendingToken,totp(pending.secret)),'invalid_input');
  assert.equal((await pool.query('SELECT attempts FROM cloud_factor_enrolments')).rows[0].attempts,3);
  assert.equal((await factor()).secret_envelope,null);assert.equal((await pool.query('SELECT count(*) FROM cloud_factor_replays')).rows[0].count,'0');
});
test('pending tokens are bound to their session and superseded or cancelled without changing the active factor', async () => {
  const a=await authority(),other=await authority(),s=store();const first=await s.begin(a);
  await refused(s.activate(other,first.pendingToken,totp(first.secret)),'invalid_input');
  await refused(s.cancel(other.token,other.csrfToken,first.pendingToken),'invalid_input');
  const second=await s.begin(a);await refused(s.activate(a,first.pendingToken,totp(first.secret)),'invalid_input');
  await refused(s.cancel(a.token,'A'.repeat(43),second.pendingToken));
  await s.cancel(a.token,a.csrfToken,second.pendingToken);
  await refused(s.activate(a,second.pendingToken,totp(second.secret)),'invalid_input');
  assert.equal((await factor()).secret_envelope,null);assert.ok((await pool.query('SELECT consumed_at FROM cloud_factor_enrolments')).rows.every(r=>r.consumed_at));
});
test('regeneration changes the authority version and recovery codes but preserves the secret generation and replay history', async () => {
  await active();const a=await authority();await authority();await seedCode('3'.repeat(32));const challenge=await loginChallenge();
  const code=totp(oldSecret);const changed=await store().regenerate({...a,proof:proof(code)});
  const row=await factor();assert.equal(row.version,2);assert.equal(row.secret_generation,generation);
  assert.equal(decryptFactorSecret(row.secret_envelope,keys,{accountId,version:2,purpose:'active'}),oldSecret);
  assert.equal(changed.recoveryCodes.length,10);await assertEnded();
  assert.ok((await pool.query('SELECT count(*) FROM cloud_factor_replays')).rows[0].count>'0');
  await refused(new registration.PasswordLoginStore(pool,keys,loginPolicy).complete(challenge,recovery('3'.repeat(32))),'credentials_invalid');
  await refused(new registration.PasswordLoginStore(pool,keys,loginPolicy).complete(await loginChallenge(),proof(code)),'credentials_invalid');
  const fresh=await authority();await refused(store().regenerate({...fresh,proof:proof(code)}));
  assert.equal((await factor()).version,2);
});
test('regeneration and removal invalidate old recovery hashes while retaining their history without a deletion policy',async()=>{
  await active();const a=await authority();await seedCode('4'.repeat(32));await seedCode('5'.repeat(32));
  const before=(await pool.query('SELECT code_hash FROM cloud_factor_recovery_codes ORDER BY code_hash')).rows;
  const changed=await store().regenerate({...a,proof:recovery('4'.repeat(32))});
  const previous=(await pool.query('SELECT code_hash,consumed_at FROM cloud_factor_recovery_codes WHERE factor_version=1 ORDER BY code_hash')).rows;
  assert.deepEqual(previous.map(r=>({code_hash:r.code_hash})),before);assert.ok(previous.every(r=>r.consumed_at));
  const fresh=await authority();await store().remove({...fresh,proof:recovery(changed.recoveryCodes[0]!)});
  assert.equal((await pool.query('SELECT count(*) FROM cloud_factor_recovery_codes')).rows[0].count,'12');
  assert.ok((await pool.query('SELECT consumed_at FROM cloud_factor_recovery_codes')).rows.every(r=>r.consumed_at));
  assert.equal((await factor()).secret_envelope,null);await assertEnded();
});
test('removal ends every session, invalidates pending challenges and retains the monotonic factor version', async () => {
  await active();await seedCode('4'.repeat(32));await seedCode('5'.repeat(32));const a=await authority();await authority();const challenge=await loginChallenge();
  await store().begin({...a,proof:recovery('4'.repeat(32))});
  assert.deepEqual(await store().remove({...a,proof:recovery('5'.repeat(32))}),{status:'changed',active:false});
  assert.equal((await factor()).version,2);assert.equal((await factor()).secret_envelope,null);await assertEnded();
  assert.ok((await pool.query('SELECT consumed_at FROM cloud_factor_enrolments')).rows.every(r=>r.consumed_at));
  assert.ok((await pool.query('SELECT consumed_at FROM cloud_factor_login_challenges')).rows.every(r=>r.consumed_at));
  await refused(new registration.PasswordLoginStore(pool,keys,loginPolicy).complete(challenge,proof(totp(oldSecret))),'credentials_invalid');
  const fresh=await authority();const pending=await store().begin(fresh);await store().activate(fresh,pending.pendingToken,totp(pending.secret));
  assert.equal((await factor()).version,3);
});
test('missing keys and policy leave status accessible but refuse management and preserve active protection', async () => {
  await active();const a=await authority();
  for(const s of [store(null),store(keys,null),store({activeKeyId:'test',keys:{test:'08'.repeat(32)}})]) {
    assert.deepEqual(await s.status(a.token),{active:true,version:1,recoveryCodesRemaining:0,available:false});
    await refused(s.begin({...a,proof:proof(totp(oldSecret))}),'temporarily_unavailable');
    await refused(s.regenerate({...a,proof:proof(totp(oldSecret))}),'temporarily_unavailable');
    await refused(s.remove({...a,proof:proof(totp(oldSecret))}),'temporarily_unavailable');
  }
  assert.equal((await factor()).version,1);assert.equal((await transaction(pool,c=>resolveSession(c,a.token))).accountId,accountId);
});
test('email reset keeps active secret, recovery codes and replay history but consumes pending factor state and ends sessions', async () => {
  await active();const a=await authority();await seedCode('6'.repeat(32));await seedCode('7'.repeat(32));
  await store().begin({...a,proof:recovery('6'.repeat(32))});await loginChallenge();
  await pool.query(`INSERT INTO cloud_factor_replays(account_id,secret_generation,time_step,code_hash,valid_until)
    VALUES($1,$2,1,$3,clock_timestamp()+interval '1 minute')`,[accountId,generation,'f'.repeat(64)]);
  const replays=(await pool.query('SELECT * FROM cloud_factor_replays')).rows;
  const before=await factor(),codes=(await pool.query('SELECT * FROM cloud_factor_recovery_codes ORDER BY code_hash')).rows;
  const messages:{token:string}[]=[];
  const reset=recoveryAndDeliver(pool,{async sendPasswordReset(m){messages.push(m);},async sendPasswordChanged(){}});
  await reset.request(email);await reset.complete(messages[0]!.token,'replacement-owner-password');
  assert.deepEqual(await factor(),before);assert.deepEqual((await pool.query('SELECT * FROM cloud_factor_recovery_codes ORDER BY code_hash')).rows,codes);
  assert.deepEqual((await pool.query('SELECT * FROM cloud_factor_replays')).rows,replays);
  await assertEnded();assert.ok((await pool.query('SELECT consumed_at FROM cloud_factor_enrolments')).rows.every(r=>r.consumed_at));
  assert.ok((await pool.query('SELECT consumed_at FROM cloud_factor_login_challenges')).rows.every(r=>r.consumed_at));
  const challenge=await new registration.PasswordLoginStore(pool,keys,loginPolicy).start({email,password:'replacement-owner-password'});
  assert.equal(challenge.kind,'factor');
  assert.equal((await new registration.PasswordLoginStore(pool,keys,loginPolicy).complete(challenge.challengeToken,recovery('7'.repeat(32)))).accountId,accountId);
});
test('history cleanup reports factor-referenced ended sessions as blocked and preserves them', async () => {
  const a=await authority();await store().begin(a);
  await pool.query("UPDATE cloud_sessions SET ended_at='2020-01-01'");
  const cleanup=new registration.HistoryCleanup(pool),rules={cutoffs:{sessions:'2025-01-01T00:00:00.000Z'},chunkSize:10};
  const dry=await cleanup.run(rules,{apply:false});assert.equal(dry.categories.sessions!.eligible,0);assert.equal(dry.categories.sessions!.blocked,1);
  const applied=await cleanup.run(rules,{apply:true});assert.equal(applied.categories.sessions!.deleted,0);assert.equal(applied.categories.sessions!.blocked,1);
  assert.equal((await pool.query('SELECT count(*) FROM cloud_sessions')).rows[0].count,'1');
});

async function blocked(queryPart:string) {
  const {setTimeout:delay}=await import('node:timers/promises');
  for(let i=0;i<200;i++) {
    const row=await admin.query(`SELECT 1 FROM pg_stat_activity WHERE application_name=$1
      AND wait_event_type='Lock' AND query LIKE $2`,[schema,`%${queryPart}%`]);
    if(row.rowCount) return;
    await delay(10);
  }
  assert.fail(`operation never waited for ${queryPart}`);
}
async function otherDatabase() {
  return new Pool({connectionString:process.env.TEST_DATABASE_URL,
    options:`-c search_path=${schema} -c statement_timeout=10000`,application_name:schema});
}
for(const operation of ['begin','activate','regenerate','login'] as const) {
  for(const change of ['reset','disable',...(operation==='login'?[]:['logout','revoke','expiry'])] as const) {
    test(`${change} committed during the ${operation} account wait prevents stale authority and leaves factor effects unchanged`,async()=>{
      await active();const a=await authority(),peer=await authority();
      await seedCode('8'.repeat(32));await seedCode('9'.repeat(32));
      const s=store();const pending=operation==='activate'?await s.begin({...a,proof:recovery('8'.repeat(32))}):undefined;
      const challenge=operation==='login'?await loginChallenge():undefined;
      const before=await factor(),codes=(await pool.query('SELECT * FROM cloud_factor_recovery_codes ORDER BY code_hash')).rows;
      const blocker=await pool.connect(),other=await otherDatabase();let work:Promise<void>|undefined;
      try {
        await blocker.query('BEGIN');await blocker.query('SELECT id FROM cloud_accounts WHERE id=$1 FOR UPDATE',[accountId]);
        const target=store(keys,policy,other),auth={...a,proof:recovery('9'.repeat(32))};
        const action=operation==='begin'?target.begin(auth):operation==='activate'?target.activate(auth,pending!.pendingToken,totp(pending!.secret))
          :operation==='regenerate'?target.regenerate(auth):new registration.PasswordLoginStore(other,keys,loginPolicy).complete(challenge!,recovery('9'.repeat(32)));
        work=refused(action,operation==='login'?'credentials_invalid':'permission_denied');await blocked('cloud_accounts');
        if(change==='reset') await blocker.query('UPDATE cloud_credentials SET password_hash=$1 WHERE account_id=$2',[await hashSecret('reset-password'),accountId]);
        if(change==='disable') await blocker.query('UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1',[accountId]);
        if(change==='logout') await endSession(blocker,a.token);
        if(change==='expiry') await blocker.query("UPDATE cloud_sessions SET absolute_expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1",[digest(a.token)]);
        if(change==='revoke') {
          const id=(await blocker.query('SELECT id FROM cloud_sessions WHERE token_hash=$1',[digest(a.token)])).rows[0].id;
          assert.deepEqual(await revokeAccountSession(blocker,peer.token,peer.csrfToken,id),{revoked:true,current:false});
        }
        await blocker.query('COMMIT');await work;
        assert.deepEqual(await factor(),before);assert.deepEqual((await pool.query('SELECT * FROM cloud_factor_recovery_codes ORDER BY code_hash')).rows,codes);
        if(pending) assert.equal((await pool.query('SELECT attempts FROM cloud_factor_enrolments')).rows[0].attempts,0);
        if(challenge) assert.equal((await pool.query('SELECT attempts FROM cloud_factor_login_challenges')).rows[0].attempts,0);
      } finally {await blocker.query('ROLLBACK');blocker.release();await work;await other.end();}
    });
  }
}
test('session expiry while begin waits on its pending-state write rolls back the pending secret and old proof',async()=>{
  await active();const a=await authority();await seedCode('A'.repeat(32));
  await pool.query("UPDATE cloud_sessions SET absolute_expires_at=clock_timestamp()+interval '600 milliseconds'");
  const blocker=await pool.connect();let work:Promise<void>|undefined;
  try {
    await blocker.query('BEGIN');await blocker.query('LOCK TABLE cloud_factor_enrolments IN SHARE MODE');
    work=refused(store().begin({...a,proof:recovery('A'.repeat(32))}));await blocked('UPDATE cloud_factor_enrolments');
    const {setTimeout:delay}=await import('node:timers/promises');await delay(650);await blocker.query('COMMIT');await work;
    assert.equal((await pool.query('SELECT count(*) FROM cloud_factor_enrolments')).rows[0].count,'0');
    assert.equal((await pool.query('SELECT consumed_at FROM cloud_factor_recovery_codes')).rows[0].consumed_at,null);assert.equal((await factor()).version,1);
  } finally {await blocker.query('ROLLBACK');blocker.release();await work;}
});
test('expiry behind a pending-row lock refuses activation before spending its budget',async()=>{
  const a=await authority(),pending=await store().begin(a),blocker=await pool.connect();let work:Promise<void>|undefined;
  try {
    await blocker.query('BEGIN');await blocker.query("UPDATE cloud_factor_enrolments SET expires_at=clock_timestamp()+interval '500 milliseconds'");
    work=refused(store().activate(a,pending.pendingToken,totp(pending.secret)),'invalid_input');await blocked('cloud_factor_enrolments');
    const {setTimeout:delay}=await import('node:timers/promises');await delay(550);await blocker.query('COMMIT');await work;
    assert.equal((await pool.query('SELECT attempts FROM cloud_factor_enrolments')).rows[0].attempts,0);assert.equal((await factor()).secret_envelope,null);
  } finally {await blocker.query('ROLLBACK');blocker.release();await work;}
});
test('activation expiry after factor and recovery writes rolls back every effect while keeping the spent attempt',async()=>{
  await active();const a=await authority();await seedCode('B'.repeat(32));await seedCode('C'.repeat(32));
  const pending=await store().begin({...a,proof:recovery('B'.repeat(32))});await loginChallenge();
  const before=await factor(),codes=(await pool.query('SELECT * FROM cloud_factor_recovery_codes ORDER BY code_hash')).rows;
  await pool.query("UPDATE cloud_factor_enrolments SET expires_at=clock_timestamp()+interval '600 milliseconds'");
  const blocker=await pool.connect();let work:Promise<void>|undefined;
  try {
    await blocker.query('BEGIN');await blocker.query('LOCK TABLE cloud_factor_login_challenges IN SHARE MODE');
    work=refused(store().activate({...a,proof:recovery('C'.repeat(32))},pending.pendingToken,totp(pending.secret)));
    await blocked('UPDATE cloud_factor_login_challenges');
    const {setTimeout:delay}=await import('node:timers/promises');await delay(650);await blocker.query('COMMIT');await work;
    assert.deepEqual(await factor(),before);assert.deepEqual((await pool.query('SELECT * FROM cloud_factor_recovery_codes ORDER BY code_hash')).rows,codes);
    const row=(await pool.query('SELECT attempts,consumed_at FROM cloud_factor_enrolments')).rows[0];assert.equal(row.attempts,1);assert.equal(row.consumed_at,null);
    assert.equal((await pool.query('SELECT count(*) FROM cloud_factor_replays')).rows[0].count,'0');
    assert.equal((await pool.query('SELECT ended_at FROM cloud_sessions WHERE token_hash=$1',[digest(a.token)])).rows[0].ended_at,null);
    assert.equal((await pool.query('SELECT consumed_at FROM cloud_factor_login_challenges')).rows[0].consumed_at,null);
  } finally {await blocker.query('ROLLBACK');blocker.release();await work;}
});
test('unexpected activation write failure rolls back the attempt, proofs and factor changes',async()=>{
  const a=await authority(),pending=await store().begin(a);
  await pool.query(`CREATE FUNCTION reject_recovery_write() RETURNS trigger LANGUAGE plpgsql AS
    'BEGIN RAISE EXCEPTION USING ERRCODE = ''P0001'', MESSAGE = ''fixture recovery failure''; END'`);
  await pool.query('CREATE TRIGGER reject_recovery_write BEFORE INSERT ON cloud_factor_recovery_codes FOR EACH ROW EXECUTE FUNCTION reject_recovery_write()');
  try {
    await assert.rejects(store().activate(a,pending.pendingToken,totp(pending.secret)),(e:unknown)=>!!e && typeof e==='object' && 'code' in e && e.code==='P0001');
    assert.equal((await factor()).secret_envelope,null);assert.equal((await pool.query('SELECT attempts FROM cloud_factor_enrolments')).rows[0].attempts,0);
    assert.equal((await pool.query('SELECT count(*) FROM cloud_factor_replays')).rows[0].count,'0');
    assert.equal((await pool.query('SELECT ended_at FROM cloud_sessions')).rows[0].ended_at,null);
  } finally {await pool.query('DROP TRIGGER reject_recovery_write ON cloud_factor_recovery_codes');await pool.query('DROP FUNCTION reject_recovery_write()');}
});
test('concurrent first enrolments from independent pools supersede exactly one pending operation',async()=>{
  const a=await authority(),b=await authority(),other=await otherDatabase();
  try {
    const results=await Promise.all([store().begin(a),store(keys,policy,other).begin(b)]);
    const rows=(await pool.query('SELECT token_hash,consumed_at FROM cloud_factor_enrolments')).rows;
    assert.equal(rows.filter(r=>!r.consumed_at).length,1);assert.equal(rows.length,2);assert.equal((await factor()).version,0);
    const usable=rows.find(r=>!r.consumed_at)!;
    const index=results.findIndex(r=>digest(r.pendingToken)===usable.token_hash);
    await store().activate(index===0?a:b,results[index]!.pendingToken,totp(results[index]!.secret));await assertEnded();assert.equal((await factor()).version,1);
  } finally {await other.end();}
});
test('concurrent confirmations from independent pools publish exactly one factor and recovery set',async()=>{
  const a=await authority(),pending=await store().begin(a),other=await otherDatabase();
  try {
    const code=totp(pending.secret);
    const results=await Promise.allSettled([store().activate(a,pending.pendingToken,code),store(keys,policy,other).activate(a,pending.pendingToken,code)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected' && r.reason.code==='permission_denied').length,1);
    assert.equal((await factor()).version,1);assert.equal((await pool.query('SELECT count(*) FROM cloud_factor_recovery_codes')).rows[0].count,'10');await assertEnded();
  } finally {await other.end();}
});
test('concurrent regenerations from independent pools cannot publish two recovery sets',async()=>{
  await active();const a=await authority(),b=await authority(),other=await otherDatabase();await seedCode('D'.repeat(32));await seedCode('E'.repeat(32));
  try {
    const results=await Promise.allSettled([store().regenerate({...a,proof:recovery('D'.repeat(32))}),store(keys,policy,other).regenerate({...b,proof:recovery('E'.repeat(32))})]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected' && r.reason.code==='permission_denied').length,1);
    assert.equal((await factor()).version,2);assert.equal((await pool.query('SELECT count(*) FROM cloud_factor_recovery_codes WHERE factor_version=2 AND consumed_at IS NULL')).rows[0].count,'10');
    assert.equal((await pool.query('SELECT count(*) FROM cloud_factor_recovery_codes WHERE factor_version=1')).rows[0].count,'2');await assertEnded();
  } finally {await other.end();}
});

test('a TOTP window ending after regeneration writes rolls back the factor, codes and replay even with a live session',async()=>{
  await active();const a=await authority();await seedCode('F'.repeat(32));
  const before=await factor(),codes=(await pool.query('SELECT * FROM cloud_factor_recovery_codes')).rows;
  await pool.query('CREATE TABLE factor_test_clock(moment timestamptz NOT NULL)');
  await pool.query('INSERT INTO factor_test_clock VALUES($1)',[new Date(59_000)]);
  await pool.query(`CREATE FUNCTION ${schema}.clock_timestamp() RETURNS timestamptz LANGUAGE SQL VOLATILE
    AS 'SELECT moment FROM ${schema}.factor_test_clock'`);
  const timedPool=new Pool({connectionString:process.env.TEST_DATABASE_URL,
    options:`-c search_path=${schema},pg_catalog -c statement_timeout=10000`,application_name:schema});
  const blocker=await pool.connect();let work:Promise<void>|undefined;
  try {
    await blocker.query('BEGIN');await blocker.query('LOCK TABLE cloud_factor_enrolments IN SHARE MODE');
    work=refused(store(keys,policy,timedPool).regenerate({...a,proof:proof('287082')}));await blocked('UPDATE cloud_factor_enrolments');
    await pool.query('UPDATE factor_test_clock SET moment=$1',[new Date(91_000)]);await blocker.query('COMMIT');await work;
    assert.deepEqual(await factor(),before);assert.deepEqual((await pool.query('SELECT * FROM cloud_factor_recovery_codes')).rows,codes);
    assert.equal((await pool.query('SELECT count(*) FROM cloud_factor_replays')).rows[0].count,'0');
    assert.equal((await pool.query('SELECT ended_at FROM cloud_sessions')).rows[0].ended_at,null);
  } finally {
    await blocker.query('ROLLBACK');blocker.release();await work;await timedPool.end();
    await pool.query(`DROP FUNCTION ${schema}.clock_timestamp()`);await pool.query('DROP TABLE factor_test_clock');
  }
});
test('a new-secret confirmation window ending after activation writes preserves its pending attempt but rolls back publication',async()=>{
  const a=await authority(),pending=await store().begin(a);
  const row=(await pool.query('SELECT id FROM cloud_factor_enrolments')).rows[0];
  await pool.query('UPDATE cloud_factor_enrolments SET secret_envelope=$1',[encryptFactorSecret(oldSecret,keys,{accountId,version:1,purpose:'pending',pendingId:row.id})]);
  await pool.query('CREATE TABLE factor_test_clock(moment timestamptz NOT NULL)');
  await pool.query('INSERT INTO factor_test_clock VALUES($1)',[new Date(59_000)]);
  await pool.query(`CREATE FUNCTION ${schema}.clock_timestamp() RETURNS timestamptz LANGUAGE SQL VOLATILE
    AS 'SELECT moment FROM ${schema}.factor_test_clock'`);
  const timedPool=new Pool({connectionString:process.env.TEST_DATABASE_URL,
    options:`-c search_path=${schema},pg_catalog -c statement_timeout=10000`,application_name:schema});
  const blocker=await pool.connect();let work:Promise<void>|undefined;
  try {
    await blocker.query('BEGIN');await blocker.query('LOCK TABLE cloud_factor_login_challenges IN SHARE MODE');
    work=refused(store(keys,policy,timedPool).activate(a,pending.pendingToken,'287082'));await blocked('UPDATE cloud_factor_login_challenges');
    await pool.query('UPDATE factor_test_clock SET moment=$1',[new Date(91_000)]);await blocker.query('COMMIT');await work;
    assert.equal((await factor()).secret_envelope,null);assert.equal((await pool.query('SELECT count(*) FROM cloud_factor_recovery_codes')).rows[0].count,'0');
    assert.equal((await pool.query('SELECT count(*) FROM cloud_factor_replays')).rows[0].count,'0');
    const state=(await pool.query('SELECT attempts,consumed_at FROM cloud_factor_enrolments')).rows[0];assert.equal(state.attempts,1);assert.equal(state.consumed_at,null);
    assert.equal((await pool.query('SELECT ended_at FROM cloud_sessions')).rows[0].ended_at,null);
  } finally {
    await blocker.query('ROLLBACK');blocker.release();await work;await timedPool.end();
    await pool.query(`DROP FUNCTION ${schema}.clock_timestamp()`);await pool.query('DROP TABLE factor_test_clock');
  }
});
test('pending password fingerprint and factor version changes refuse activation without spending its attempt',async()=>{
  const a=await authority(),pending=await store().begin(a);
  const original=(await pool.query('SELECT password_fingerprint FROM cloud_factor_enrolments')).rows[0].password_fingerprint;
  await pool.query('UPDATE cloud_factor_enrolments SET password_fingerprint=$1',['0'.repeat(64)]);
  await refused(store().activate(a,pending.pendingToken,totp(pending.secret)),'invalid_input');
  assert.equal((await pool.query('SELECT attempts FROM cloud_factor_enrolments')).rows[0].attempts,0);
  await pool.query('UPDATE cloud_factor_enrolments SET password_fingerprint=$1,base_version=1',[original]);
  await refused(store().activate(a,pending.pendingToken,totp(pending.secret)),'invalid_input');
  assert.equal((await pool.query('SELECT attempts FROM cloud_factor_enrolments')).rows[0].attempts,0);assert.equal((await factor()).secret_envelope,null);
});
test('cross-account pending tokens cannot spend the other account attempt or publish a factor',async()=>{
  const a=await authority(),pending=await store().begin(a),foreign=randomUUID();
  await pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[foreign]);
  await pool.query('INSERT INTO cloud_credentials(account_id,email,password_hash) VALUES($1,$2,$3)',[foreign,'other@example.test',await hashSecret(password)]);
  const b={...await transaction(pool,c=>createSession(c,foreign)),password};
  await refused(store().activate(b,pending.pendingToken,totp(pending.secret)),'invalid_input');
  await refused(store().cancel(b.token,b.csrfToken,pending.pendingToken),'invalid_input');
  assert.equal((await pool.query('SELECT attempts FROM cloud_factor_enrolments')).rows[0].attempts,0);
  assert.ok((await pool.query('SELECT secret_envelope FROM cloud_authenticator_factors')).rows.every(r=>!r.secret_envelope));
});
test('a password reset snapshot committed during password derivation cannot begin replacement',async()=>{
  await active();const a=await authority();await seedCode('A'.repeat(32));
  const resetHash=await hashSecret('reset-during-derivation-password');
  const name=`${schema}_derivation`,other=new Pool({connectionString:process.env.TEST_DATABASE_URL,
    options:`-c search_path=${schema} -c statement_timeout=10000`,application_name:name});
  const blocker=await pool.connect();let work:Promise<void>|undefined;
  try {
    await blocker.query('BEGIN');await blocker.query('SELECT id FROM cloud_accounts WHERE id=$1 FOR UPDATE',[accountId]);
    work=refused(store(keys,policy,other).begin({...a,proof:recovery('A'.repeat(32))}));
    const {setTimeout:delay}=await import('node:timers/promises');let deriving=false;
    for(let i=0;i<200;i++) {
      const rows=(await admin.query('SELECT state,query,wait_event_type FROM pg_stat_activity WHERE application_name=$1',[name])).rows;
      if(rows.some(r=>r.state==='idle in transaction' && r.query.includes('SELECT c.account_id, c.password_hash'))) {deriving=true;break;}
      if(rows.some(r=>r.wait_event_type==='Lock')) break;
      await delay(1);
    }
    assert.ok(deriving,'must observe the password snapshot released while derivation runs, before the account lock');
    await blocker.query('UPDATE cloud_credentials SET password_hash=$1 WHERE account_id=$2',[resetHash,accountId]);
    await blocker.query('UPDATE cloud_sessions SET ended_at=clock_timestamp() WHERE account_id=$1',[accountId]);
    await blocker.query('COMMIT');await work;
    assert.equal((await factor()).version,1);assert.equal((await pool.query('SELECT count(*) FROM cloud_factor_enrolments')).rows[0].count,'0');
    assert.equal((await pool.query('SELECT consumed_at FROM cloud_factor_recovery_codes')).rows[0].consumed_at,null);
  } finally {await blocker.query('ROLLBACK');blocker.release();await work?.catch(()=>{});await other.end();}
});
