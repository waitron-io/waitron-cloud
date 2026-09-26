import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { Pool } from 'pg';
import { AccountRateLimiter } from '../src/rate-limit.ts';
import { database } from './fixtures.ts';
import { migrate } from '../../registration/src/migrate.ts';
let db: Awaited<ReturnType<typeof database>>;
let limiter: AccountRateLimiter;
before(async () => {db = await database(); limiter = new AccountRateLimiter(db.pool, db.rateKey);});
after(async () => db?.close());
beforeEach(async () => {await db.pool.query('DELETE FROM account_rate_limits');});
const rule = {scope: 'login-ip', subject: '192.0.2.1', limit: 10, windowSeconds: 60};
test('two instances admit only the shared allowance under concurrency', async () => {
  const other = new AccountRateLimiter(db.secondPool, db.rateKey);
  const results = await Promise.all(Array.from({length: 30}, (_, i) => (i % 2 ? other : limiter).consume([rule])));
  assert.equal(results.filter(result => result.allowed).length, 10);
  assert.ok(results.filter(result => !result.allowed).every(result => result.retryAfterSeconds > 0 && result.retryAfterSeconds <= 60));
  assert.equal((await db.pool.query('SELECT attempts FROM account_rate_limits')).rows[0].attempts, 11);
});
test('all rules count refused attempts and overlapping sets do not deadlock', async () => {
  const short = {...rule, scope: 'short', limit: 1}; const long = {...rule, scope: 'long', limit: 2, windowSeconds: 900};
  assert.equal((await limiter.consume([short, long])).allowed, true);
  assert.equal((await limiter.consume([long, short])).allowed, false);
  const blocked = await limiter.consume([short, long]);
  assert.equal(blocked.allowed, false); assert.ok(blocked.retryAfterSeconds > 60);
  await Promise.all(Array.from({length: 10}, (_, i) => limiter.consume(i % 2 ? [short, long] : [long, short])));
  assert.deepEqual((await db.pool.query('SELECT attempts FROM account_rate_limits ORDER BY attempts')).rows.map(row => row.attempts), [2, 3]);
});
test('expired windows reset; scopes and subjects stay independent without storing identities', async () => {
  await limiter.consume([{...rule, limit: 1}]);
  assert.equal((await limiter.consume([{...rule, limit: 1}])).allowed, false);
  assert.equal((await limiter.consume([{...rule, scope: 'reset', limit: 1}])).allowed, true);
  assert.equal((await limiter.consume([{...rule, subject: 'private-owner@example.test', limit: 1}])).allowed, true);
  const stored = JSON.stringify((await db.pool.query('SELECT * FROM account_rate_limits')).rows);
  for (const secret of [rule.subject, 'private-owner@example.test', db.rateKey, 'login-ip']) assert.ok(!stored.includes(secret));
  await db.pool.query("UPDATE account_rate_limits SET expires_at = clock_timestamp() - interval '1 second'");
  assert.equal((await limiter.consume([{...rule, limit: 1}])).allowed, true);
});
test('invalid keys, rules and duplicate identities fail before modifying counters', async () => {
  for (const key of ['', 'x'.repeat(64), 'ab']) assert.throws(() => new AccountRateLimiter(db.pool, key), /Invalid rate configuration/);
  for (const rules of [[], [rule, rule], [{...rule, limit: 0}], [{...rule, limit: 1.5}], [{...rule, windowSeconds: 0}], [{...rule, subject: ''}]]) {
    await assert.rejects(limiter.consume(rules), /Invalid rate rule/);
  }
  assert.equal((await db.pool.query('SELECT count(*) FROM account_rate_limits')).rows[0].count, '0');
});
test('cleanup is bounded and never removes live windows; migration reruns are harmless', async () => {
  await db.pool.query(`INSERT INTO account_rate_limits (key, attempts, expires_at)
    SELECT lpad(to_hex(i), 64, '0'), 1, clock_timestamp() - interval '1 second' FROM generate_series(1, 1005) i`);
  await limiter.consume([rule]);
  assert.equal(await limiter.prune(), 1000); assert.equal(await limiter.prune(), 5); assert.equal(await limiter.prune(), 0);
  assert.equal((await db.pool.query('SELECT count(*) FROM account_rate_limits')).rows[0].count, '1');
  await migrate(db.pool);
  assert.equal((await db.pool.query('SELECT count(*) FROM schema_migrations')).rows[0].count, '20');
});
test('database failure cannot grant allowance', async () => {
  const closed = new Pool({connectionString: process.env.TEST_DATABASE_URL}); await closed.end();
  await assert.rejects(new AccountRateLimiter(closed, db.rateKey).consume([rule]));
});
test('expiry is checked after a contended lock and ignores the application clock', async t => {
  await limiter.consume([{...rule, limit: 1}]);
  const lock = await db.secondPool.connect();
  await lock.query('BEGIN');
  await lock.query("UPDATE account_rate_limits SET expires_at = clock_timestamp() + interval '150 milliseconds'");
  t.mock.method(Date, 'now', () => 0);
  const pending = limiter.consume([{...rule, limit: 1}]);
  try { await new Promise(resolve => setTimeout(resolve, 200)); }
  finally { await lock.query('COMMIT'); lock.release(); }
  assert.equal((await pending).allowed, true);
  assert.equal((await limiter.consume([{...rule, limit: 1}])).allowed, false);
});
test('cleanup skips a locked expired counter while a consumer waits, then preserves its new window', async () => {
  await limiter.consume([rule]);
  const key = (await db.pool.query('SELECT key FROM account_rate_limits')).rows[0].key;
  await limiter.consume([{...rule, subject: '192.0.2.2'}]);
  await db.pool.query("UPDATE account_rate_limits SET expires_at = clock_timestamp() - interval '1 second'");
  const lock = await db.secondPool.connect();
  await lock.query('BEGIN'); await lock.query('SELECT key FROM account_rate_limits WHERE key = $1 FOR UPDATE', [key]);
  const pending = limiter.consume([rule]);
  try {
    // Bound the experiment so a cleanup lock wait fails instead of deadlocking fixture teardown.
    const worker = await db.secondPool.connect();
    try {
      await worker.query('SET statement_timeout = 1000');
      const cleanupPool = {query: worker.query.bind(worker)} as unknown as Pool;
      assert.equal(await new AccountRateLimiter(cleanupPool, db.rateKey).prune(), 1);
    } finally {await worker.query('RESET statement_timeout'); worker.release();}
  } finally {await lock.query('COMMIT'); lock.release();}
  assert.equal((await pending).allowed, true);
  assert.equal(await limiter.prune(), 0);
  assert.equal((await db.pool.query('SELECT attempts FROM account_rate_limits WHERE key = $1', [key])).rows[0].attempts, 1);
});
