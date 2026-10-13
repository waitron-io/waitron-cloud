import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after, before, beforeEach, test} from 'node:test';
import {Pool} from 'pg';
import {migrate,migrationNames} from '../src/migrate.ts';
import {hashSecret} from '@waitron-cloud/identity';

const schema = `factor_schema_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({connectionString: process.env.TEST_DATABASE_URL});
const pool = new Pool({connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}`});
const account = randomUUID(), other = randomUUID(), session = randomUUID();
const hash = 'ab'.repeat(32), fingerprint = 'cd'.repeat(32), generation = randomUUID();
before(async () => {await admin.query(`CREATE SCHEMA ${schema}`); await migrate(pool);});
after(async () => {await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();});
beforeEach(async () => {
  await pool.query('TRUNCATE cloud_accounts CASCADE');
  await pool.query('INSERT INTO cloud_accounts(id) VALUES($1),($2)', [account, other]);
  await pool.query('INSERT INTO cloud_credentials(account_id,email,password_hash) VALUES($1,$2,$3)',
    [account, 'owner@example.test', await hashSecret('existing-owner-password')]);
  await pool.query('INSERT INTO platform_permissions(account_id,permission) VALUES($1,$2)', [account, 'operations.read']);
  await pool.query('INSERT INTO cloud_sessions(id,token_hash,csrf_hash,account_id) VALUES($1,$2,$3,$4)',
    [session, hash, fingerprint, account]);
});
async function present(name: string) {
  assert.notEqual((await pool.query('SELECT to_regclass($1) AS relation', [name])).rows[0].relation,
    null, `${name} is not persisted`);
}
async function refuses(action: Promise<unknown>, code: string) {
  await assert.rejects(action, (error: unknown) => (error as {code?: string}).code === code);
}
const state = () => pool.query(`INSERT INTO cloud_authenticator_factors(account_id,version,secret_generation,secret_envelope)
  VALUES($1,1,$2,'v1.test.nonce.tag.ciphertext')`, [account, generation]);
const challenge = (attempts = 0, limit = 3, expires = '2030-01-01') => pool.query(`INSERT INTO cloud_factor_login_challenges
  (token_hash,account_id,password_fingerprint,factor_version,created_at,expires_at,attempts,attempt_limit)
  VALUES($1,$2,$3,1,'2029-01-01',$4,$5,$6)`, [hash, account, fingerprint, expires, attempts, limit]);

test('migration persists independent factor, challenge, recovery and replay state', async () => {
  for (const table of ['cloud_authenticator_factors', 'cloud_factor_enrolments', 'cloud_factor_login_challenges',
    'cloud_factor_recovery_codes', 'cloud_factor_replays']) await present(table);
  await state(); await challenge();
  const before = (await pool.query('SELECT * FROM cloud_authenticator_factors')).rows;
  const sessions = (await pool.query('SELECT * FROM cloud_sessions')).rows;
  await migrate(pool);
  assert.deepEqual((await pool.query('SELECT * FROM cloud_authenticator_factors')).rows, before);
  assert.deepEqual((await pool.query('SELECT * FROM cloud_sessions')).rows, sessions);
});
test('populated 34-to-35 upgrade preserves credentials, permissions and sessions', async () => {
  await present('cloud_authenticator_factors');
  await pool.query('DROP TABLE relay_control');
  await pool.query("DELETE FROM schema_migrations WHERE name='036_relay_operator_stop.sql'");
  await pool.query(`DROP TABLE cloud_factor_enrolments,cloud_factor_login_challenges,
    cloud_factor_recovery_codes,cloud_factor_replays,cloud_authenticator_factors;
    ALTER TABLE cloud_sessions DROP CONSTRAINT cloud_sessions_factor_account_unique`);
  await pool.query("DELETE FROM schema_migrations WHERE name='035_authenticator_factor.sql'");
  assert.equal((await pool.query('SELECT count(*) FROM schema_migrations')).rows[0].count, '34');
  const tables = ['cloud_credentials', 'platform_permissions', 'cloud_sessions'];
  const before = await Promise.all(tables.map(table => pool.query(`SELECT * FROM ${table}`)));
  await migrate(pool);
  const ledger=(await pool.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map(row=>row.name);
  assert.equal(ledger.slice(0,35).length,35);
  assert.deepEqual(ledger.slice(0,35),migrationNames.slice(0,35));
  assert.equal(ledger.length,36);
  assert.equal(ledger.at(-1),'036_relay_operator_stop.sql');
  for (const [i, table] of tables.entries()) {
    assert.deepEqual((await pool.query(`SELECT * FROM ${table}`)).rows, before[i]!.rows);
  }
});
test('inactive factor rows retain their version and refuse partial active secrets', async () => {
  await present('cloud_authenticator_factors'); await state();
  await pool.query('UPDATE cloud_authenticator_factors SET version=2,secret_generation=NULL,secret_envelope=NULL');
  assert.equal((await pool.query('SELECT version FROM cloud_authenticator_factors')).rows[0].version, 2);
  await refuses(pool.query('UPDATE cloud_authenticator_factors SET secret_envelope=$1', ['ciphertext']), '23514');
  await refuses(pool.query('UPDATE cloud_authenticator_factors SET version=-1'), '23514');
});
test('pending enrolment is bound to a session belonging to the same account', async () => {
  await present('cloud_factor_enrolments');
  const insert = (owner: string) => pool.query(`INSERT INTO cloud_factor_enrolments
    (id,token_hash,account_id,session_id,password_fingerprint,base_version,secret_envelope,created_at,expires_at,attempt_limit)
    VALUES($1,$2,$3,$4,$5,0,'ciphertext','2029-01-01','2030-01-01',3)`,
    [generation, hash, owner, session, fingerprint]);
  await refuses(insert(other), '23503'); await insert(account);
  await refuses(pool.query('DELETE FROM cloud_sessions WHERE id=$1', [session]), '23503');
});
test('challenge limits refuse negative or exhausted-over-budget state and empty lifetimes', async () => {
  await present('cloud_factor_login_challenges');
  await refuses(challenge(-1), '23514'); await refuses(challenge(4), '23514');
  await refuses(challenge(0, 0), '23514'); await refuses(challenge(0, 3, '2029-01-01'), '23514');
  await challenge(3);
  assert.equal((await pool.query('SELECT attempts FROM cloud_factor_login_challenges')).rows[0].attempts, 3);
  await refuses(pool.query('UPDATE cloud_factor_login_challenges SET password_fingerprint=$1', ['raw-password']), '23514');
  await refuses(pool.query('UPDATE cloud_factor_login_challenges SET token_hash=$1', ['raw-token']), '23514');
  await refuses(pool.query('UPDATE cloud_factor_login_challenges SET factor_version=0'), '23514');
});
test('recovery hashes are unique within an account and secret generation', async () => {
  await present('cloud_factor_recovery_codes');
  const insert = (owner: string) => pool.query(`INSERT INTO cloud_factor_recovery_codes
    (account_id,secret_generation,factor_version,code_hash) VALUES($1,$2,1,$3)`, [owner, generation, hash]);
  await insert(account); await refuses(insert(account), '23505'); await insert(other);
  await refuses(pool.query('UPDATE cloud_factor_recovery_codes SET code_hash=$1', ['raw-code']), '23514');
});
test('replay steps cannot be inserted twice for one account and secret generation', async () => {
  await present('cloud_factor_replays');
  const insert = (owner: string) => pool.query(`INSERT INTO cloud_factor_replays
    (account_id,secret_generation,time_step,code_hash,valid_until) VALUES($1,$2,1,$3,'2030-01-01')`,
    [owner, generation, hash]);
  await insert(account); await refuses(insert(account), '23505'); await insert(other);
  await refuses(pool.query('UPDATE cloud_factor_replays SET time_step=-1'), '23514');
  await refuses(pool.query('UPDATE cloud_factor_replays SET code_hash=$1', ['123456']), '23514');
});
