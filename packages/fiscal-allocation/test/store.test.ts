import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { FiscalAllocationStore } from '../src/store.ts';
import { canonical, signReceipt } from '../src/evidence.ts';
import { requireCurrentHistory } from '../src/continuity.ts';
import { scope, bases, binding, payload } from './fixtures.ts';
import { storeFixture, blocked } from './store-fixture.ts';
import { retain } from './continuity-fixture.ts';
import type { PoolClient } from 'pg';
import type { AllocationReceipt } from '../src/types.ts';

const refused = (code: string) => (e: { code?: string }) => {
  assert.equal(e.code, code);
  return true;
};
const consume = (r: AllocationReceipt) => ({
  version: 1 as const,
  operationId: randomUUID(),
  allocationId: r.payload.allocation.allocationId,
  binding: { ...r.payload.binding },
  oldMachineOffline: true,
  oldMachineAbsent: false,
  noParallelRecovery: true,
  confirmedAt: new Date().toISOString(),
});

test('two organisations share C names but cannot inspect each other’s venue receipts', async () => {
  const s = await storeFixture();
  try {
    const a = await s.venue(),
      b = await s.venue();
    const results = await Promise.all([
      s.store.reserve(a.session.token, a.session.csrfToken, a.input),
      s.store.reserve(b.session.token, b.session.csrfToken, b.input),
    ]);
    assert.deepEqual(results.map((r) => r.payload.allocation.installationIdentity).sort(), [
      'C000001',
      'C000002',
    ]);
    for (const [v, r] of [
      [a, results[0]],
      [b, results[1]],
    ] as const) {
      assert.deepEqual(
        r!.payload.allocation.series,
        bases.map((x) => ({
          ...x,
          code: x.code + '-' + r!.payload.allocation.installationIdentity,
        })),
      );
      assert.deepEqual(r!.payload.binding, binding);
      const page = await s.store.list(v.session.token, v.session.csrfToken, {
        version: 1,
        venueId: v.id,
        cursor: null,
        limit: 50,
      });
      assert.deepEqual(page.items, [r]);
    }
    await assert.rejects(
      s.store.status(a.session.token, a.session.csrfToken, {
        version: 1,
        venueId: b.id,
        operationId: b.input.operationId,
      }),
      refused('permission_denied'),
    );
    await assert.rejects(
      s.store.list(a.session.token, a.session.csrfToken, {
        version: 1,
        venueId: b.id,
        cursor: null,
        limit: 50,
      }),
      refused('permission_denied'),
    );
  } finally {
    await s.close();
  }
});
test('stored status checks entitlement and custody once before returning the exact receipt', async () => {
  const s = await storeFixture();
  try {
    const v = await s.venue();
    const receipt = await s.store.reserve(v.session.token, v.session.csrfToken, v.input);
    const checks: string[] = [];
    const store = new FiscalAllocationStore(s.f.pool, {
      ...s.options,
      entitlement: {
        async check(c, ...args) {
          checks.push('entitlement');
          assert.equal(args[1], v.id);
          assert.equal(args[2], 'read');
          return s.options.entitlement!.check(c, ...args);
        },
      },
      custody: {
        async check(c, ...args) {
          checks.push('custody');
          assert.equal(args[1], v.id);
          assert.deepEqual(args[2], scope);
          return s.options.custody!.check(c, ...args);
        },
      },
    });
    assert.deepEqual(
      await store.status(v.session.token, v.session.csrfToken, {
        version: 1, venueId: v.id, operationId: v.input.operationId,
      }),
      { version: 1, state: 'recorded', receipt },
    );
    assert.deepEqual(checks, ['entitlement', 'custody']);
  } finally {
    await s.close();
  }
});
for (const denial of ['entitlement', 'custody', 'ownership'] as const) {
  test(`stored status refuses a receipt after ${denial} authority is withdrawn`, async () => {
    const s = await storeFixture();
    try {
      const v = await s.venue();
      const receipt = await s.store.reserve(v.session.token, v.session.csrfToken, v.input);
      let denied = false;
      const store = new FiscalAllocationStore(s.f.pool, {
        ...s.options,
        entitlement: {
          async check(c, ...args) {
            const result = await s.options.entitlement!.check(c, ...args);
            return { ...result, allowed: result.allowed && !denied };
          },
        },
      });
      const read = () => store.status(v.session.token, v.session.csrfToken, {
        version: 1, venueId: v.id, operationId: v.input.operationId,
      });
      assert.deepEqual(await read(), { version: 1, state: 'recorded', receipt });
      if (denial === 'entitlement') denied = true;
      else if (denial === 'custody')
        await s.f.pool.query('UPDATE fiscal_test_authority SET custody=false WHERE account_id=$1', [v.account]);
      else
        await s.f.pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1', [v.account]);
      await assert.rejects(read(), refused(denial === 'ownership' ? 'permission_denied' : `${denial}_unavailable`));
    } finally {
      await s.close();
    }
  });
}
test('two independent authenticated workers allocate one shared namespace and retain exact retries', async () => {
  const s = await storeFixture();
  try {
    const a = await s.venue(),
      b = await s.venue();
    const connection = {
      connectionString: process.env.TEST_DATABASE_URL,
      application_name: s.f.schema,
      options: `-c search_path=${s.f.schema} -c statement_timeout=5000`,
    };
    const inputs = [a, b].map((v) => ({
      connection,
      token: v.session.token,
      csrf: v.session.csrfToken,
      input: v.input,
    }));
    const results = await Promise.all(inputs.map((input) => s.a.worker('store-reserve', input)));
    assert.deepEqual(
      results.map((r) => r.receipt?.payload.allocation.installationIdentity).sort(),
      ['C000001', 'C000002'],
    );
    assert.notEqual(results[0].pid, results[1].pid);
    assert.notEqual(results[0].pid, process.pid);
    const retries = await Promise.all(inputs.map((input) => s.a.worker('store-reserve', input)));
    assert.deepEqual(
      retries.map((r) => r.receipt),
      results.map((r) => r.receipt),
    );
    await retain('task3-two-worker-proof', {
      workerPids: results.map((r) => r.pid),
      receipts: results.map((r) => r.receipt),
      retryReceipts: retries.map((r) => r.receipt),
      rows: (
        await s.f.pool.query(
          'SELECT installation_identity,venue_id FROM fiscal_registry_allocations ORDER BY installation_identity',
        )
      ).rows,
    });
  } finally {
    await s.close();
  }
});
test('the current owner consuming a reservation is recorded as the authenticated Cloud actor', async () => {
  const s = await storeFixture();
  try {
    const a = await s.venue(),
      b = await s.venue(),
      r = await s.store.reserve(a.session.token, a.session.csrfToken, a.input);
    await s.f.pool.query(
      'INSERT INTO organisation_memberships(account_id,organisation_id,is_owner) VALUES($1,$2,true)',
      [b.account, a.organisation],
    );
    const receipt = await s.store.consume(b.session.token, b.session.csrfToken, consume(r));
    assert.equal(receipt.payload.cloudAccountId, b.account);
    assert.deepEqual(receipt.payload.allocation, r.payload.allocation);
    assert.equal(receipt.payload.venueId, a.id);
  } finally {
    await s.close();
  }
});
test('same operation returns the identical signed snapshot after restart', async () => {
  const s = await storeFixture();
  try {
    const v = await s.venue(),
      r = await s.store.reserve(v.session.token, v.session.csrfToken, v.input);
    const restarted = new FiscalAllocationStore(s.f.pool, s.options);
    assert.equal(
      canonical(await restarted.reserve(v.session.token, v.session.csrfToken, v.input)),
      canonical(r),
    );
    assert.deepEqual(
      await restarted.status(v.session.token, v.session.csrfToken, {
        version: 1,
        venueId: v.id,
        operationId: v.input.operationId,
      }),
      { version: 1, state: 'recorded', receipt: r },
    );
    assert.equal(
      (await s.f.pool.query('SELECT count(*)::int AS n FROM fiscal_registry_allocations')).rows[0]
        .n,
      1,
    );
  } finally {
    await s.close();
  }
});
test('an injected continuity adapter keeps its prototype methods and receiver', async () => {
  const s = await storeFixture();
  try {
    const v = await s.venue(),
      inner = s.options.continuity!;
    class Adapter {
      readonly verification = inner.verification;
      readonly upstream = inner;
      current(...args: Parameters<typeof inner.current>) {
        return this.upstream.current(...args);
      }
      history(...args: Parameters<typeof inner.history>) {
        return this.upstream.history(...args);
      }
      fence(...args: Parameters<typeof inner.fence>) {
        return this.upstream.fence(...args);
      }
      claim(...args: Parameters<typeof inner.claim>) {
        return this.upstream.claim(...args);
      }
    }
    const store = new FiscalAllocationStore(s.f.pool, { ...s.options, continuity: new Adapter() });
    assert.equal(
      (await store.reserve(v.session.token, v.session.csrfToken, v.input)).payload.allocation
        .installationIdentity,
      'C000001',
    );
  } finally {
    await s.close();
  }
});
for (const field of [
  'eventId',
  'sourceId',
  'targetNodeId',
  'operatorId',
  'incidentEvidence',
] as const)
  test('original operation refuses changed ' + field, async () => {
    const s = await storeFixture();
    try {
      const v = await s.venue();
      await s.store.reserve(v.session.token, v.session.csrfToken, v.input);
      await assert.rejects(
        s.store.reserve(v.session.token, v.session.csrfToken, {
          ...v.input,
          binding: { ...binding, [field]: 'different' },
        }),
        refused('binding_conflict'),
      );
    } finally {
      await s.close();
    }
  });
test('original operation refuses changed bases and never burns another name', async () => {
  const s = await storeFixture();
  try {
    const v = await s.venue();
    await s.store.reserve(v.session.token, v.session.csrfToken, v.input);
    await assert.rejects(
      s.store.reserve(v.session.token, v.session.csrfToken, {
        ...v.input,
        bases: [...bases, { code: 'B', purpose: 'standard' }],
      }),
      refused('binding_conflict'),
    );
    assert.equal(
      (await requireCurrentHistory(s.options.continuity!, scope, null)).witness.cHighWater,
      1,
    );
  } finally {
    await s.close();
  }
});
test('caller cannot omit the independently configured full series', async () => {
  const s = await storeFixture();
  try {
    const v = await s.venue();
    await assert.rejects(
      s.store.reserve(v.session.token, v.session.csrfToken, {
        ...v.input,
        bases: bases.filter((b) => b.purpose !== 'full'),
      }),
      refused('binding_conflict'),
    );
    assert.equal(
      (await requireCurrentHistory(s.options.continuity!, scope, null)).witness.cHighWater,
      0,
    );
  } finally {
    await s.close();
  }
});
for (const column of ['custody', 'operator_verified'])
  test('unproved ' + column + ' refuses before claiming a name', async () => {
    const s = await storeFixture();
    try {
      const v = await s.venue();
      await s.f.pool.query(`UPDATE fiscal_test_authority SET ${column}=false WHERE account_id=$1`, [
        v.account,
      ]);
      await assert.rejects(
        s.store.reserve(v.session.token, v.session.csrfToken, v.input),
        refused('custody_unavailable'),
      );
      assert.equal(
        (await requireCurrentHistory(s.options.continuity!, scope, null)).witness.cHighWater,
        0,
      );
    } finally {
      await s.close();
    }
  });
test('ended entitlement denies new reservation while retained reads succeed', async () => {
  const s = await storeFixture();
  try {
    const v = await s.venue(),
      r = await s.store.reserve(v.session.token, v.session.csrfToken, v.input);
    await s.f.pool.query('UPDATE fiscal_test_authority SET entitlement=false WHERE account_id=$1', [
      v.account,
    ]);
    await assert.rejects(
      s.store.reserve(v.session.token, v.session.csrfToken, {
        ...v.input,
        operationId: randomUUID(),
      }),
      refused('entitlement_unavailable'),
    );
    assert.deepEqual(
      (
        await s.store.list(v.session.token, v.session.csrfToken, {
          version: 1,
          venueId: v.id,
          cursor: null,
          limit: 50,
        })
      ).items,
      [r],
    );
  } finally {
    await s.close();
  }
});
for (const action of ['consume', 'abandon'] as const)
  test(action + ' is terminal and its name stays occupied', async () => {
    const s = await storeFixture();
    try {
      const v = await s.venue(),
        r = await s.store.reserve(v.session.token, v.session.csrfToken, v.input);
      const input =
        action === 'consume'
          ? consume(r)
          : {
              version: 1 as const,
              operationId: randomUUID(),
              allocationId: r.payload.allocation.allocationId,
              binding,
            };
      const terminal = await s.store[action](v.session.token, v.session.csrfToken, input as any);
      assert.equal(terminal.payload.state, action === 'consume' ? 'consumed' : 'abandoned');
      assert.deepEqual(terminal.payload.allocation, r.payload.allocation);
      assert.deepEqual(
        await s.store[action](v.session.token, v.session.csrfToken, input as any),
        terminal,
      );
      const inverse = action === 'consume' ? 'abandon' : 'consume';
      await assert.rejects(
        s.store[inverse](
          v.session.token,
          v.session.csrfToken,
          (inverse === 'consume'
            ? consume(r)
            : {
                version: 1,
                operationId: randomUUID(),
                allocationId: r.payload.allocation.allocationId,
                binding,
              }) as any,
        ),
        refused('binding_conflict'),
      );
      const fresh = await s.store.reserve(v.session.token, v.session.csrfToken, {
        ...v.input,
        operationId: randomUUID(),
      });
      assert.equal(fresh.payload.allocation.installationIdentity, 'C000002');
      assert.deepEqual(
        (
          await s.store.list(v.session.token, v.session.csrfToken, {
            version: 1,
            venueId: v.id,
            cursor: null,
            limit: 50,
          })
        ).items
          .map((r) => r.payload.state)
          .sort(),
        [terminal.payload.state, 'reserved'].sort(),
      );
    } finally {
      await s.close();
    }
  });
test('consumption preserves complete approval and refuses missing isolation and changed operator', async () => {
  const s = await storeFixture();
  try {
    const v = await s.venue(),
      r = await s.store.reserve(v.session.token, v.session.csrfToken, v.input),
      input = consume(r);
    for (const bad of [
      { ...input, oldMachineOffline: false },
      { ...input, oldMachineAbsent: true },
      { ...input, noParallelRecovery: false },
    ])
      await assert.rejects(
        s.store.consume(v.session.token, v.session.csrfToken, bad),
        refused('invalid_input'),
      );
    await assert.rejects(
      s.store.consume(v.session.token, v.session.csrfToken, {
        ...input,
        binding: { ...binding, operatorId: 'different' },
      }),
      refused('binding_conflict'),
    );
    const result = await s.store.consume(v.session.token, v.session.csrfToken, input);
    assert.deepEqual(result.payload.approval, {
      version: 1,
      eventId: 'event-1',
      operatorId: 'operator-1',
      sourceId: 'source-1',
      targetNodeId: 'node-1',
      incidentEvidence: 'incident-1',
      oldMachineOffline: true,
      oldMachineAbsent: false,
      noParallelRecovery: true,
      confirmedAt: input.confirmedAt,
    });
  } finally {
    await s.close();
  }
});
test('changed independently configured bases require a fresh allocation before consumption', async () => {
  const s = await storeFixture();
  try {
    const v = await s.venue(),
      r = await s.store.reserve(v.session.token, v.session.csrfToken, v.input);
    await s.f.pool.query('UPDATE fiscal_test_authority SET bases=$2 WHERE account_id=$1', [
      v.account,
      JSON.stringify([...bases, { code: 'B', purpose: 'full' }]),
    ]);
    await assert.rejects(
      s.store.consume(v.session.token, v.session.csrfToken, consume(r)),
      refused('binding_conflict'),
    );
    assert.equal(
      (await requireCurrentHistory(s.options.continuity!, scope, null)).events.length,
      1,
    );
  } finally {
    await s.close();
  }
});
test('setup consumption requires absence and preserves the setup mode', async () => {
  const s = await storeFixture();
  try {
    const v = await s.venue(),
      r = await s.store.reserve(v.session.token, v.session.csrfToken, {
        ...v.input,
        mode: 'initial-setup',
      }),
      input = consume(r);
    await assert.rejects(
      s.store.consume(v.session.token, v.session.csrfToken, input),
      refused('invalid_input'),
    );
    const result = await s.store.consume(v.session.token, v.session.csrfToken, {
      ...input,
      oldMachineAbsent: true,
      oldMachineOffline: false,
    });
    assert.equal(result.payload.mode, 'initial-setup');
    assert.equal(result.payload.approval!.oldMachineAbsent, true);
  } finally {
    await s.close();
  }
});
test('ownership revoked while waiting on its row prevents receipt disclosure', async () => {
  const s = await storeFixture();
  const blocker = await s.f.pool.connect();
  try {
    const v = await s.venue();
    await blocker.query('BEGIN');
    await blocker.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1', [
      v.account,
    ]);
    const pending = s.store.reserve(v.session.token, v.session.csrfToken, v.input);
    const failure = assert.rejects(pending, refused('permission_denied'));
    await blocked(s.f.pool);
    await blocker.query('COMMIT');
    await failure;
    assert.equal(
      (await requireCurrentHistory(s.options.continuity!, scope, null)).witness.cHighWater,
      0,
    );
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await s.close();
  }
});
for (const delayMs of [0, 350]) {
  test('session expiry during external append burns the name and prevents receipt disclosure' +
    (delayMs ? ' after a slow start' : ''), async (t) => {
    const s = await storeFixture();
    const boundaries: unknown[] = [];
    const started = performance.now();
    try {
      const v = await s.venue();
      let client: PoolClient | undefined;
      let appendCount = 0;
      const appendState: { enteredExpired?: boolean; returnedExpired?: boolean } = {};
      const mark = async (stage: string, c: Pick<PoolClient, 'query'> = s.f.pool) => {
        const state = (await c.query(
          'SELECT clock_timestamp() AS now, absolute_expires_at, clock_timestamp()>=absolute_expires_at AS expired FROM cloud_sessions WHERE account_id=$1',
          [v.account],
        )).rows[0];
        boundaries.push({ stage, elapsedMs: performance.now() - started, ...state });
        return state.expired;
      };
      const original = s.options.continuity!;
      const store = new FiscalAllocationStore(s.f.pool, {
        ...s.options,
        entitlement: {
          async check(c, ...args) {
            client = c;
            await mark('authorization', c);
            return s.options.entitlement!.check(c, ...args);
          },
        },
        continuity: {
          ...original,
          async claim(input) {
            assert.ok(client);
            appendState.enteredExpired = await mark('append-entered', client);
            appendCount++;
            const result = await original.claim(input);
            await mark('append-committed', client);
            // The reservation holds the session row lock, so expire it on that same client.
            // Expiry starts after the real append; setup speed cannot move it before authorization.
            await client.query(
              "UPDATE cloud_sessions SET absolute_expires_at=clock_timestamp()-interval '1 millisecond' WHERE account_id=$1",
              [v.account],
            );
            appendState.returnedExpired = await mark('expired-after-append', client);
            return result;
          },
        },
      });
      if (delayMs) await s.f.pool.query('SELECT pg_sleep($1)', [delayMs / 1000]);
      await mark('before-reserve');
      await assert.rejects(
        store.reserve(v.session.token, v.session.csrfToken, v.input),
        (error: { code?: string }) => {
          boundaries.push({ stage: 'refused', code: error.code });
          return refused('session_expired')(error);
        },
      );
      assert.equal((await requireCurrentHistory(original, scope, null)).witness.cHighWater, 1);
      assert.equal(
        (await s.f.pool.query('SELECT count(*)::int AS n FROM fiscal_registry_events')).rows[0].n,
        0,
      );
      assert.equal(appendCount, 1);
      // Reconciliation can recover a committed append even if its callback throws.
      assert.deepEqual(appendState, { enteredExpired: false, returnedExpired: true });
    } finally {
      t.diagnostic(JSON.stringify(boundaries));
      await s.close();
    }
  });
}
test('missing session and wrong CSRF cannot claim names', async () => {
  const s = await storeFixture();
  try {
    const v = await s.venue();
    await assert.rejects(
      s.store.reserve('invalid', v.session.csrfToken, v.input),
      refused('session_unavailable'),
    );
    await assert.rejects(
      s.store.reserve(v.session.token, 'invalid', v.input),
      refused('csrf_invalid'),
    );
    assert.equal(
      (await requireCurrentHistory(s.options.continuity!, scope, null)).witness.cHighWater,
      0,
    );
  } finally {
    await s.close();
  }
});
test('status unknown does not invent a receipt and reads do not touch session expiry', async () => {
  const s = await storeFixture();
  try {
    const v = await s.venue(),
      before = (
        await s.f.pool.query('SELECT last_seen_at FROM cloud_sessions WHERE account_id=$1', [
          v.account,
        ])
      ).rows[0].last_seen_at;
    assert.deepEqual(
      await s.store.status(v.session.token, v.session.csrfToken, {
        version: 1,
        venueId: v.id,
        operationId: randomUUID(),
      }),
      { version: 1, state: 'unknown', receipt: null },
    );
    assert.deepEqual(
      (
        await s.f.pool.query('SELECT last_seen_at FROM cloud_sessions WHERE account_id=$1', [
          v.account,
        ])
      ).rows[0].last_seen_at,
      before,
    );
  } finally {
    await s.close();
  }
});
test('list pagination is signed and bound to account and venue', async () => {
  const s = await storeFixture();
  try {
    const a = await s.venue(),
      b = await s.venue();
    const first = await s.store.reserve(a.session.token, a.session.csrfToken, a.input);
    const second = await s.store.reserve(a.session.token, a.session.csrfToken, {
      ...a.input,
      operationId: randomUUID(),
    });
    const page = await s.store.list(a.session.token, a.session.csrfToken, {
      version: 1,
      venueId: a.id,
      cursor: null,
      limit: 1,
    });
    assert.deepEqual(page.items, [first]);
    assert.ok(page.nextCursor);
    assert.deepEqual(
      await s.store.list(a.session.token, a.session.csrfToken, {
        version: 1,
        venueId: a.id,
        cursor: page.nextCursor,
        limit: 1,
      }),
      { version: 1, items: [second], nextCursor: null },
    );
    await assert.rejects(
      s.store.list(b.session.token, b.session.csrfToken, {
        version: 1,
        venueId: b.id,
        cursor: page.nextCursor,
        limit: 1,
      }),
      refused('invalid_input'),
    );
    await assert.rejects(
      s.store.list(a.session.token, a.session.csrfToken, {
        version: 1,
        venueId: a.id,
        cursor: Buffer.from(
          canonical({
            ...JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString('utf8')),
            signature: Buffer.alloc(64).toString('base64url'),
          }),
        ).toString('base64url'),
        limit: 1,
      }),
      refused('invalid_input'),
    );
  } finally {
    await s.close();
  }
});
test('pages retain every venue allocation when namespace sequences coincide', async () => {
  const s = await storeFixture();
  try {
    const v = await s.venue(),
      first = await s.store.reserve(v.session.token, v.session.csrfToken, v.input),
      signer = s.options.signer!;
    const trust = {
      issuer: signer.issuer,
      keys: new Map([...s.options.trust!.keys, [signer.keyId, signer.publicKey]]),
    };
    const allocation = {
      ...first.payload.allocation,
      allocationId: randomUUID(),
      taxpayerNif: '12345678Z',
      issuedAt: '2026-10-13T10:00:00.000Z',
    };
    const r = signReceipt(
      {
        ...payload(),
        allocation,
        cloudAccountId: v.account,
        venueId: v.id,
        continuity: { ...first.payload.continuity, scope: { ...scope, taxpayerNif: '12345678Z' } },
        issuer: signer.issuer,
      },
      signer,
    );
    await s.f.pool.query('INSERT INTO fiscal_registry_scopes VALUES($1,$2,$3,1,1,$4,1)', [
      '12345678Z',
      'WT',
      'preproduction',
      '0'.repeat(64),
    ]);
    await s.f.pool.query(
      'INSERT INTO fiscal_registry_allocations VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [
        allocation.allocationId,
        allocation.taxpayerNif,
        'WT',
        'preproduction',
        allocation.installationIdentity,
        v.id,
        v.account,
        allocation,
        binding,
        'custody-1',
        'entitlement-1',
        r,
      ],
    );
    await s.f.pool.query(
      'INSERT INTO fiscal_registry_events VALUES($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10)',
      [
        randomUUID(),
        allocation.taxpayerNif,
        'WT',
        'preproduction',
        randomUUID(),
        'reserve',
        '0'.repeat(64),
        allocation.allocationId,
        {},
        r,
      ],
    );
    const store = new FiscalAllocationStore(s.f.pool, { ...s.options, trust });
    const one = await store.list(v.session.token, v.session.csrfToken, {
      version: 1,
      venueId: v.id,
      cursor: null,
      limit: 1,
    });
    assert.ok(one.nextCursor);
    const two = await store.list(v.session.token, v.session.csrfToken, {
      version: 1,
      venueId: v.id,
      cursor: one.nextCursor,
      limit: 1,
    });
    assert.equal(two.items.length, 1);
    assert.deepEqual(
      [...one.items, ...two.items].map((x) => x.payload.allocation.allocationId).sort(),
      [first.payload.allocation.allocationId, allocation.allocationId].sort(),
    );
    assert.equal(two.nextCursor, null);
  } finally {
    await s.close();
  }
});
