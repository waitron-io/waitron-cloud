import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { storeFixture } from './store-fixture.ts';
import { FiscalAllocationStore } from '../src/store.ts';

test('list refuses retained receipts when current taxpayer custody is unavailable', async () => {
  const s = await storeFixture();
  try {
    const v = await s.venue();
    await s.store.reserve(v.session.token, v.session.csrfToken, v.input);
    await s.f.pool.query('UPDATE fiscal_test_authority SET custody=false WHERE account_id=$1', [
      v.account,
    ]);
    await assert.rejects(
      s.store.list(v.session.token, v.session.csrfToken, {
        version: 1,
        venueId: v.id,
        cursor: null,
        limit: 50,
      }),
      { code: 'custody_unavailable' },
    );
  } finally {
    await s.close();
  }
});
test('consumption custody version changing after the durable append burns the name without disclosing a stale receipt', async () => {
  const s = await storeFixture();
  try {
    const v = await s.venue(),
      r = await s.store.reserve(v.session.token, v.session.csrfToken, v.input);
    let changed = false;
    const a = s.options.continuity!,
      custody = s.options.custody!;
    const store = new FiscalAllocationStore(s.f.pool, {
      ...s.options,
      continuity: {
        ...a,
        claim: async (input) => {
          const result = await a.claim(input);
          changed = true;
          return result;
        },
      },
      custody: {
        check: async (...args) => ({
          ...(await custody.check(...args)),
          custodyVersion: changed ? 'custody-2' : 'custody-1',
        }),
      },
    });
    const input = {
      version: 1 as const,
      operationId: randomUUID(),
      allocationId: r.payload.allocation.allocationId,
      binding: r.payload.binding,
      oldMachineOffline: true,
      oldMachineAbsent: false,
      noParallelRecovery: true,
      confirmedAt: new Date().toISOString(),
    };
    await assert.rejects(store.consume(v.session.token, v.session.csrfToken, input), {
      code: 'custody_unavailable',
    });
    const events = (
      await s.a.request('history', { scope: v.input.scope, afterSequence: '0', nonce: 'test' })
    ).events;
    assert.equal(events.length, 2);
    assert.equal(events[1].receipt.payload.state, 'consumed');
    assert.equal(
      (
        await s.f.pool.query(
          "SELECT count(*)::int AS n FROM fiscal_registry_events WHERE action='consume'",
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await s.close();
  }
});
test('venue pages and operation status use targeted event access rather than scanning other tenants', async () => {
  const s = await storeFixture(),
    c = await s.f.pool.connect();
  try {
    const v = await s.venue();
    await c.query('BEGIN;SET LOCAL enable_seqscan=off');
    const list = (
      await c.query(
        `EXPLAIN (FORMAT JSON) SELECT DISTINCT ON(allocation_id) result FROM fiscal_registry_events
      WHERE result->'payload'->>'venueId'=$1 ORDER BY allocation_id,sequence DESC`,
        [v.id],
      )
    ).rows[0]['QUERY PLAN'][0].Plan;
    function accesses(p: any): any[] {
      return [p, ...(p.Plans ?? []).flatMap(accesses)].filter(
        (x) => x['Relation Name'] === 'fiscal_registry_events',
      );
    }
    const plans = accesses(list);
    assert.ok(plans.length > 0);
    assert.ok(
      plans.every((p) => p['Node Type'] !== 'Seq Scan'),
      'a page must not scan the entire event table',
    );
    assert.ok(
      JSON.stringify(list).includes('Index Cond'),
      'venue selection must constrain the index',
    );
    const status = (
      await c.query(
        'EXPLAIN (FORMAT JSON) SELECT result FROM fiscal_registry_events WHERE operation_id=$1',
        [randomUUID()],
      )
    ).rows[0]['QUERY PLAN'][0].Plan;
    assert.ok(JSON.stringify(status).includes('Index Cond'));
  } finally {
    await c.query('ROLLBACK');
    c.release();
    await s.close();
  }
});
