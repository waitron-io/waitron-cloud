import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Pool} from 'pg';
import {fixture} from './fixtures/relay-worker.ts';

// Replace database operations, but exercise the fixture and real Pool.end lifecycle.
// Losing any cleanup step must leave a pool open or an owned schema undropped.
for (const stage of ['create', 'migration', 'clock', 'success'] as const) {
  test(`relay fixture releases pools and its schema after ${stage}`, async t => {
    const failure = new Error(`forced ${stage} failure`);
    const pools = new Set<Pool>(), ended: Pool[] = [], schemas = new Set<string>();
    const end: () => Promise<void> = Pool.prototype.end;
    t.mock.method(Pool.prototype, 'end', async function(this: Pool) {
      pools.add(this); ended.push(this);
      return end.call(this);
    });
    t.mock.method(Pool.prototype, 'query', async function(this: Pool, sql: string) {
      pools.add(this);
      if (sql.startsWith('CREATE SCHEMA ')) {
        if (stage === 'create') throw failure;
        schemas.add(sql.slice('CREATE SCHEMA '.length));
      } else if (sql.startsWith('DROP SCHEMA ')) {
        assert.equal(ended.length, 1, 'worker pool closes before dropping schema');
        assert.ok(schemas.delete(sql.slice('DROP SCHEMA '.length, -' CASCADE'.length)), 'drop only the created schema');
      } else {
        assert.equal(sql, 'SELECT clock_timestamp() AS now');
        if (stage === 'clock') throw failure;
      }
      return {rows: [{now: new Date('2026-10-27T12:00:00.000Z')}]};
    });
    try {
      const setup = () => fixture(async pool => {
        pools.add(pool);
        if (stage === 'migration') throw failure;
      });
      if (stage === 'success') {
        const f = await setup();
        assert.equal(ended.length, 0, 'successful setup keeps its pools available');
        assert.equal(schemas.size, 1);
        await f.close();
      } else await assert.rejects(setup(), error => error === failure);
      assert.equal(ended.length, 2, 'both allocated pools must close');
      assert.equal(new Set(ended).size, 2, 'close each pool once');
      assert.ok(ended.every(pool => pool.ended), 'real pools finish closing');
      assert.equal(schemas.size, 0, 'no owned schema remains');
    } finally {
      for (const pool of pools) if (!pool.ended) await end.call(pool);
    }
  });
}

for (const setupFails of [false, true]) for (const stage of ['pool', 'drop', 'admin']) {
  test(`relay fixture attempts remaining cleanup after ${stage} fails, setup failure ${setupFails}`, async t => {
    const failure = new Error('forced migration failure'), cleanup = new Error(`forced ${stage} cleanup failure`);
    const events: string[] = [], pools = new Set<Pool>();
    let admin: Pool;
    const end: () => Promise<void> = Pool.prototype.end;
    t.mock.method(Pool.prototype, 'end', async function(this: Pool) {
      pools.add(this);
      const label = this === admin ? 'admin' : 'pool';
      events.push(label);
      await end.call(this);
      if (stage === label) throw cleanup;
    });
    t.mock.method(Pool.prototype, 'query', async function(this: Pool, sql: string) {
      pools.add(this);
      if (sql.startsWith('CREATE SCHEMA ')) admin = this;
      if (sql.startsWith('DROP SCHEMA ')) {
        events.push('drop');
        if (stage === 'drop') throw cleanup;
      }
      return {rows: [{now: new Date('2026-10-27T12:00:00.000Z')}]};
    });
    try {
      const run = async () => {
        const f = await fixture(async pool => {pools.add(pool); if (setupFails) throw failure;});
        await f.close();
      };
      await assert.rejects(run(), error => setupFails
        ? error instanceof AggregateError && error.cause === failure && error.errors.includes(failure) && error.errors.includes(cleanup)
        : error === cleanup);
      assert.deepEqual(events, ['pool', 'drop', 'admin'], 'a cleanup failure must not skip later resources');
      assert.equal(pools.size, 2);
      assert.ok([...pools].every(pool => pool.ended));
    } finally {
      for (const pool of pools) if (!pool.ended) await end.call(pool);
    }
  });
}
