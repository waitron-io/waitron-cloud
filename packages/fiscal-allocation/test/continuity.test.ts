import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture } from '../../registration/test/fixtures/relay-worker.ts';
import { transaction } from '../../registration/src/transaction.ts';
import { requireCurrentHistory, fenceWriter, projectHistory } from '../src/continuity.ts';
import { scope, reserve } from './fixtures.ts';
import { authorityFixture, retain, continuityTrace } from './continuity-fixture.ts';

const refused = (code: string) => (error: { code?: string }) => {
  assert.equal(error.code, code);
  return true;
};
async function seeded() {
  const a = await authorityFixture();
  const f = await fixture();
  const v = await f.venue();
  const venueId = (
    await f.pool.query('SELECT venue_id FROM installations WHERE id=$1', [v.installation])
  ).rows[0].venue_id;
  const input = { ...reserve(), venueId, operationId: randomUUID() };
  await a.request('seed', { input, accountId: v.account, count: 41 });
  const authority = a.adapter();
  const grant = await fenceWriter(authority, scope);
  const history = await requireCurrentHistory(authority, scope, grant);
  await transaction(f.pool, (c) => projectHistory(c, history));
  return {
    a,
    f,
    authority,
    grant,
    input,
    accountId: v.account,
    async close() {
      await a.close();
      await f.close();
    },
  };
}
test('a restored old PostgreSQL backup cannot reissue C000042 and complete reconciliation permits C000043', async () => {
  const mark = continuityTrace('old-backup');
  mark('seed-start');
  const s = await seeded();
  mark('seed-complete');
  const directory = await mkdtemp(join(tmpdir(), 'fiscal-pg-backup-'));
  const target = 'fiscal_restore_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  let restored: Pool | undefined;
  try {
    const file = join(directory, 'before42.dump');
    // pg_dump/restore execute inside the wrapper's own PostgreSQL container.
    const container = execFileSync('docker', ['ps', '--format', '{{.ID}} {{.Ports}}'], {
      encoding: 'utf8',
    })
      .split('\n')
      .find((line) => line.includes(':' + new URL(process.env.TEST_DATABASE_URL!).port + '->5432'))
      ?.split(' ')[0];
    assert.ok(container, 'find only this wrapper-owned database');
    mark('dump-start');
    const dump = execFileSync('docker', [
      'exec',
      container,
      'pg_dump',
      '-U',
      'postgres',
      '-d',
      'cloud_test',
      '-Fc',
      '-n',
      s.f.schema,
    ]);
    mark('dump-complete');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(file, dump);
    mark('first-reserve-start');
    const initialReserve = await s.a.worker('reserve', {
      input: s.input,
      accountId: s.accountId,
      grant: s.grant,
    });
    mark('first-reserve-result', { result: initialReserve });
    mark('restore-start');
    await admin.query(`CREATE DATABASE ${target}`);
    execFileSync(
      'docker',
      ['exec', '-i', container, 'pg_restore', '-U', 'postgres', '-d', target, '--exit-on-error'],
      { input: dump },
    );
    mark('restore-complete');
    const connection = new URL(process.env.TEST_DATABASE_URL!);
    connection.pathname = '/' + target;
    restored = new Pool({
      connectionString: connection.href,
      options: `-c search_path=${s.f.schema}`,
    });
    assert.equal(
      (await restored.query('SELECT c_high_water FROM fiscal_registry_scopes')).rows[0]
        .c_high_water,
      41,
    );
    mark('old-candidate-start');
    const result = await s.a.worker('reserve-candidate', {
      input: { ...s.input, operationId: randomUUID() },
      accountId: s.accountId,
      grant: s.grant,
      identity: 'C000042',
    });
    mark('old-candidate-result', { result });
    assert.equal(result.code, 'history_uncertain');
    const history = await requireCurrentHistory(s.authority, scope, s.grant);
    await transaction(restored, (c) => projectHistory(c, history));
    assert.equal(
      (
        await restored.query(
          "SELECT installation_identity FROM fiscal_registry_allocations WHERE installation_identity='C000042'",
        )
      ).rows[0].installation_identity,
      'C000042',
    );
    mark('next-reserve-start');
    const next = await s.a.worker('reserve', {
      input: { ...s.input, operationId: randomUUID() },
      accountId: s.accountId,
      grant: s.grant,
    });
    mark('next-reserve-result', { result: next });
    assert.equal(next.receipt.payload.allocation.installationIdentity, 'C000043');
    await transaction(restored, async (c) =>
      projectHistory(c, await requireCurrentHistory(s.authority, scope, s.grant)),
    );
    assert.equal(
      (await restored.query('SELECT c_high_water FROM fiscal_registry_scopes')).rows[0]
        .c_high_water,
      43,
    );
    const identities = (
      await restored.query(
        "SELECT installation_identity FROM fiscal_registry_allocations WHERE installation_identity IN ('C000042','C000043') ORDER BY installation_identity",
      )
    ).rows.map((r) => r.installation_identity);
    assert.deepEqual(identities, ['C000042', 'C000043']);
    await retain('task2-old-backup-proof', {
      restoredHighWater: 41,
      refusedCandidate: result,
      grant: s.grant,
      reconciledWitness: history.witness,
      next,
      identities,
      projected: (
        await restored.query('SELECT event,result FROM fiscal_registry_events ORDER BY sequence')
      ).rows,
    });
  } finally {
    mark('cleanup-start');
    await restored?.end();
    await admin.query(`DROP DATABASE IF EXISTS ${target}`);
    await admin.end();
    await rm(directory, { recursive: true, force: true });
    await s.close();
    mark('cleanup-complete');
  }
});
for (const fault of [
  'stale',
  'future',
  'unsigned',
  'wrong-key',
  'wrong-scope',
  'wrong-nonce',
  'wrong-digest',
  'missing-event',
  'changed-request',
  'changed-receipt',
  'changed-allocation',
  'changed-high-water',
  'duplicate-operation',
  'unknown-event-key',
]) {
  test('current history refuses ' + fault + ' before projecting any row', async () => {
    const s = await seeded();
    try {
      await s.a.request('fault', { fault });
      await assert.rejects(
        requireCurrentHistory(s.authority, scope, s.grant),
        refused('history_uncertain'),
      );
      const before = (
        await s.f.pool.query('SELECT to_jsonb(t) AS row FROM fiscal_registry_scopes t')
      ).rows;
      await assert.rejects(
        transaction(s.f.pool, async (c) =>
          projectHistory(c, await requireCurrentHistory(s.authority, scope, s.grant)),
        ),
        refused('history_uncertain'),
      );
      assert.deepEqual(
        (await s.f.pool.query('SELECT to_jsonb(t) AS row FROM fiscal_registry_scopes t')).rows,
        before,
      );
    } finally {
      await s.close();
    }
  });
}
test('missing authority and a bounded stalled call refuse without exposing provider errors', async () => {
  await assert.rejects(requireCurrentHistory(null, scope, null), refused('continuity_unavailable'));
  const a = await authorityFixture();
  try {
    const stalled = a.adapter({ current: async () => new Promise(() => {}) });
    await assert.rejects(
      requireCurrentHistory(stalled, scope, null),
      refused('continuity_unavailable'),
    );
    await assert.rejects(
      requireCurrentHistory(
        a.adapter({
          current: async () => {
            throw Error('private provider detail');
          },
        }),
        scope,
        null,
      ),
      refused('continuity_unavailable'),
    );
  } finally {
    await a.close();
  }
});
test('expired and substituted writer grants cannot append or reconcile as current writer', async () => {
  const s = await seeded();
  try {
    for (const fault of ['expired-writer', 'writer-id', 'writer-expiry']) {
      await s.a.request('fault', { fault });
      await assert.rejects(fenceWriter(s.authority, scope), refused('history_uncertain'));
    }
    await s.a.request('fault', { fault: 'none' });
    const changed = {
      ...s.grant,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };
    await assert.rejects(
      requireCurrentHistory(s.authority, scope, changed),
      refused('history_uncertain'),
    );
  } finally {
    await s.close();
  }
});
test('old worker loses its append race after a separately started replacement fences it', async () => {
  const mark = continuityTrace('replacement-writer');
  mark('seed-start');
  const s = await seeded();
  mark('seed-complete');
  try {
    mark('replacement-fence-start');
    const replacement = await s.a.worker('fence', {});
    mark('replacement-fence-result', { result: replacement });
    assert.notEqual(replacement.grant.fence, s.grant.fence);
    mark('old-worker-start');
    const old = await s.a.worker('raw-reserve', {
      input: s.input,
      accountId: s.accountId,
      grant: s.grant,
      expectedSequence: '41',
    });
    mark('old-worker-result', { result: old });
    assert.equal(old.code, 'history_uncertain');
    await assert.rejects(
      requireCurrentHistory(s.authority, scope, s.grant),
      refused('history_uncertain'),
    );
    mark('replacement-worker-start');
    const success = await s.a.worker('reserve', {
      input: s.input,
      accountId: s.accountId,
      grant: replacement.grant,
    });
    mark('replacement-worker-result', { result: success });
    assert.equal(success.receipt.payload.allocation.installationIdentity, 'C000042');
    await retain('task2-writer-replacement-proof', {
      oldGrant: s.grant,
      replacement,
      oldWorker: old,
      success,
    });
  } finally {
    await s.close();
  }
});
test('independent durable append survives lost reply, PostgreSQL rollback and worker/authority restart', async () => {
  const s = await seeded();
  try {
    await s.a.request('fault', { fault: 'lost-reply' });
    const result = await s.a.worker('reserve', {
      input: s.input,
      accountId: s.accountId,
      grant: s.grant,
    });
    assert.equal(result.receipt.payload.allocation.installationIdentity, 'C000042');
    const history = await requireCurrentHistory(s.authority, scope, s.grant);
    await s.f.pool.query(
      'CREATE TABLE commit_failure(account_id uuid REFERENCES cloud_accounts(id) DEFERRABLE INITIALLY DEFERRED)',
    );
    await assert.rejects(
      transaction(s.f.pool, async (c) => {
        await projectHistory(c, history);
        await c.query('INSERT INTO commit_failure VALUES($1)', [randomUUID()]);
      }),
      { code: '23503' },
    );
    assert.equal(
      (await s.f.pool.query('SELECT c_high_water FROM fiscal_registry_scopes')).rows[0]
        .c_high_water,
      41,
    );
    await s.a.restart();
    const retry = await s.a.worker('reserve', {
      input: s.input,
      accountId: s.accountId,
      grant: s.grant,
    });
    assert.deepEqual(retry.receipt, result.receipt);
    await transaction(s.f.pool, async (c) =>
      projectHistory(c, await requireCurrentHistory(s.a.adapter(), scope, s.grant)),
    );
    const row = (
      await s.f.pool.query(
        'SELECT event,result FROM fiscal_registry_events WHERE operation_id=$1',
        [s.input.operationId],
      )
    ).rows[0];
    assert.deepEqual(row.result, result.receipt);
    assert.deepEqual(row.event, result.event);
    assert.equal(
      (await s.f.pool.query('SELECT count(*) FROM fiscal_registry_events')).rows[0].count,
      '42',
    );
    await retain('task2-lost-reply-proof', {
      discardedReply: true,
      commitFailure: '23503',
      result,
      retry,
      projected: row,
      recoveredWitness: (await requireCurrentHistory(s.a.adapter(), scope, s.grant)).witness,
    });
  } finally {
    await s.close();
  }
});
test('two workers contend for the next name then reuse only the exact original operation', async () => {
  const s = await seeded();
  try {
    const second = { ...s.input, operationId: randomUUID() };
    const results = await Promise.all([
      s.a.worker('reserve', {
        input: s.input,
        accountId: s.accountId,
        grant: s.grant,
      }),
      s.a.worker('reserve', {
        input: second,
        accountId: s.accountId,
        grant: s.grant,
      }),
    ]);
    assert.ok(
      results.every((r) => r.receipt),
      'both workers receive a receipt: ' + JSON.stringify(results.map((r) => r.code ?? 'receipt')),
    );
    assert.deepEqual(results.map((r) => r.receipt.payload.allocation.installationIdentity).sort(), [
      'C000042',
      'C000043',
    ]);
    const retry = await s.a.worker('reserve', {
      input: s.input,
      accountId: s.accountId,
      grant: s.grant,
    });
    assert.deepEqual(retry.receipt, results[0].receipt);
    const changed = await s.a.worker('reserve', {
      input: {
        ...s.input,
        binding: { ...s.input.binding, targetNodeId: 'different' },
      },
      accountId: s.accountId,
      grant: s.grant,
    });
    assert.equal(changed.code, 'binding_conflict');
    await retain('task2-two-worker-proof', { results, retry, changed });
  } finally {
    await s.close();
  }
});
test('a challenged current prefix must belong to the complete newer journal', async () => {
  const s = await seeded();
  try {
    const old = await s.authority.current(scope, 'before');
    await s.a.worker('reserve', {
      input: s.input,
      accountId: s.accountId,
      grant: s.grant,
    });
    await s.a.request('fault', { fault: 'divergent-current-prefix', old });
    await assert.rejects(
      requireCurrentHistory(s.authority, scope, s.grant),
      refused('history_uncertain'),
    );
  } finally {
    await s.close();
  }
});
test('a verified history that expires during a PostgreSQL lock wait cannot project', async () => {
  const mark = continuityTrace('expired-witness');
  mark('seed-start');
  const s = await seeded(),
    held = await s.f.pool.connect();
  mark('seed-complete');
  try {
    const a = s.a.adapter();
    const shorter = {
      ...a,
      verification: {
        ...a.verification,
        policy: { ...a.verification.policy, witnessMaxAgeMs: 150 },
      },
    };
    await held.query('BEGIN');
    await held.query('LOCK TABLE fiscal_registry_scopes IN ACCESS EXCLUSIVE MODE');
    mark('verification-start');
    const history = await requireCurrentHistory(shorter, scope, s.grant);
    mark('witness-verified', { observedAt: history.witness.observedAt });
    const acquired = () => mark('projection-client-acquired');
    s.f.pool.on('acquire', acquired);
    mark('projection-request');
    const outcome = transaction(s.f.pool, (c) => {
      mark('projection-start');
      return projectHistory(c, history);
    }).then(
      () => { mark('projection-complete'); return { code: 'passed' }; },
      (e) => { mark('projection-refused', { result: e }); return { code: e.code }; },
    ).finally(() => s.f.pool.removeListener('acquire', acquired));
    let waiting = false;
    for (let i = 0; i < 100 && !waiting; i++) {
      await held.query('SELECT pg_stat_clear_snapshot()');
      waiting = (
        await held.query(
          "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE 'INSERT INTO fiscal_registry_scopes%') AS yes",
          [s.f.schema],
        )
      ).rows[0].yes;
      if (!waiting) await delay(10);
    }
    mark('lock-observation', { waiting });
    assert.equal(waiting, true, 'projection reached the held database lock');
    mark('expiry-wait-start');
    await delay(175);
    mark('lock-release-start');
    await held.query('ROLLBACK');
    mark('lock-release-complete');
    assert.equal((await outcome).code, 'history_uncertain');
  } finally {
    await held.query('ROLLBACK');
    held.release();
    await s.close();
  }
});
test('a malformed candidate is refused before it reaches the independent append', async () => {
  const s = await seeded();
  try {
    const result = await s.a.worker('malformed-reserve', {
      input: s.input,
      accountId: s.accountId,
      grant: s.grant,
    });
    assert.equal(result.code, 'invalid_input');
    assert.equal((await requireCurrentHistory(s.authority, scope, s.grant)).witness.cHighWater, 41);
  } finally {
    await s.close();
  }
});
test('unverified supplied history and a locally divergent projection refuse', async () => {
  const s = await seeded();
  try {
    const history = await requireCurrentHistory(s.authority, scope, s.grant);
    await assert.rejects(
      transaction(s.f.pool, (c) => projectHistory(c, structuredClone(history))),
      refused('history_uncertain'),
    );
    await s.f.pool.query('UPDATE fiscal_registry_scopes SET history_digest=$1', ['f'.repeat(64)]);
    await assert.rejects(
      transaction(s.f.pool, (c) => projectHistory(c, history)),
      refused('history_uncertain'),
    );
  } finally {
    await s.close();
  }
});
test('an unknown append outcome never creates a second optimistic claim', async () => {
  const s = await seeded();
  try {
    await s.a.request('fault', { fault: 'lost-reply-and-history-outage' });
    const result = await s.a.worker('reserve', {
      input: s.input,
      accountId: s.accountId,
      grant: s.grant,
    });
    assert.equal(result.code, 'history_uncertain');
    await s.a.request('fault', { fault: 'none' });
    const retry = await s.a.worker('reserve', {
      input: s.input,
      accountId: s.accountId,
      grant: s.grant,
    });
    assert.equal(retry.receipt.payload.allocation.installationIdentity, 'C000042');
    assert.equal((await requireCurrentHistory(s.authority, scope, s.grant)).witness.cHighWater, 42);
  } finally {
    await s.close();
  }
});
