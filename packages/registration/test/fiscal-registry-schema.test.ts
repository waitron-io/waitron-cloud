import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { after, test } from 'node:test';
import { Pool } from 'pg';
import { migrate, migrationNames } from '../src/migrate.ts';
import { migrationRelease } from './fixtures/migration-release.ts';
import { fixture } from './fixtures/relay-worker.ts';
const { checkConsumerSchema } = await import(
  new URL('../../../deploy/local-stack/runtime.mjs', import.meta.url).href
);
const { hasReleaseMigrationCount } = await import(
  new URL('../../../scripts/database-recovery-migrations.mjs', import.meta.url).href
);
import { payload, binding } from './fixtures/fiscal-registry-schema.ts';
const root = new URL('../../../', import.meta.url).pathname;
const release = await migrationRelease(37);
after(() => release.close());
const tables = [
  'fiscal_registry_allocations',
  'fiscal_registry_events',
  'fiscal_registry_paper_events',
  'fiscal_registry_operation_routes',
];
async function oldState(pool: Pool) {
  const result: Record<string, unknown> = {};
  for (const { tablename } of (
    await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename NOT LIKE 'fiscal_registry_%' AND tablename NOT LIKE 'translation_%' ORDER BY tablename",
    )
  ).rows)
    result[tablename] = (
      await pool.query(
        `SELECT to_jsonb(t) AS value FROM ${tablename === 'organisations' ? '(SELECT id,name FROM organisations)' : '"' + tablename + '"'} t${tablename === 'installation_services' ? " WHERE t.service <> 'content_translation'" : ''} ORDER BY to_jsonb(t)::text`,
      )
    ).rows;
  return result;
}
async function seed(f: Awaited<ReturnType<typeof fixture>>) {
  const v = await f.venue();
  await v.submit();
  await f.pool.query(
    "INSERT INTO cloud_authenticator_factors(account_id,version,secret_generation,secret_envelope) VALUES($1,1,gen_random_uuid(),'retained-fixture')",
    [v.account],
  );
  return v;
}
async function allocation(pool: Pool, account: string, venue: string, identity = 'C000042') {
  const p = payload(),
    id = randomUUID();
  p.allocation.allocationId = id;
  p.allocation.installationIdentity = identity;
  p.allocation.series = p.allocation.series.map((x) => ({
    ...x,
    code: x.code.replace('C000042', identity),
  }));
  await pool.query(
    `INSERT INTO fiscal_registry_scopes(taxpayer_nif,software_id,environment,c_high_water,sequence,history_digest,writer_fence) VALUES('89890001K','WT','preproduction',42,42,$1,2) ON CONFLICT DO NOTHING`,
    ['a'.repeat(64)],
  );
  await pool.query(
    `INSERT INTO fiscal_registry_allocations(allocation_id,taxpayer_nif,software_id,environment,installation_identity,venue_id,account_id,allocation,binding,custody_version,entitlement_version,initial_receipt)
 VALUES($1,'89890001K','WT','preproduction',$2,$3,$4,$5,$6,'custody-1','entitlement-1',$7)`,
    [id, identity, venue, account, p.allocation, binding, { fixture: 'initial-signed-receipt' }],
  );
  return id;
}
test('populated release37 upgrades concurrently without changing any old row or digest', async () => {
  const f = await fixture(release.migrate);
  const second = new Pool({
    connectionString: process.env.TEST_DATABASE_URL,
    options: `-c search_path=${f.schema}`,
  });
  try {
    await seed(f);
    const before = await oldState(f.pool);
    await Promise.all([migrate(f.pool), migrate(second)]);
    await migrate(second);
    const after = await oldState(f.pool);
    for (const name of [
      'billing_businesses', 'billing_charge_lines', 'billing_charges', 'billing_events',
      'billing_hosted_days', 'billing_paid_periods', 'billing_payment_attempts',
      'billing_payment_methods', 'billing_payment_observations', 'billing_prices',
      'billing_trials', 'billing_venues', 'billing_service_authority',
      'billing_allowance_versions', 'billing_allowance_reservations',
      'remote_traffic_processes', 'remote_traffic_samples', 'remote_traffic_coverage',
    ]) {
      assert.deepEqual(after[name], [], name);
      delete after[name];
    }
    const { backup_verification_attempts, backup_verification_policy, remote_forward_observations, remote_forward_reporters, ...retained } = after;
    assert.deepEqual({ ...retained, schema_migrations: before.schema_migrations }, before);
    assert.deepEqual(backup_verification_attempts, []);
    assert.deepEqual(remote_forward_observations, []);
    assert.deepEqual(remote_forward_reporters, []);
    assert.deepEqual(backup_verification_policy, [{ value: {
      id: 1, revision: 0, target: null, verifier_image: null, release_ready: false,
    } }]);
    assert.deepEqual((await f.pool.query('SELECT service_plan,service_plan_revision FROM organisations')).rows,
      [{service_plan: 'free', service_plan_revision: 0}]);
    assert.equal((await f.pool.query("SELECT count(*)::integer AS n FROM installations i WHERE NOT EXISTS(SELECT 1 FROM installation_services s WHERE s.installation_id=i.id AND s.service='content_translation' AND s.state='ready')")).rows[0].n, 0);
    const ledger = (await f.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
    assert.equal(ledger.length, migrationNames.length);
    assert.equal(ledger[37].name, '038_fiscal_allocation_registry.sql');
    assert.deepEqual(
      (
        await f.pool.query(
          'SELECT to_jsonb(t) AS value FROM schema_migrations t ORDER BY name LIMIT 37',
        )
      ).rows,
      before.schema_migrations,
    );
    for (const name of ['fiscal_registry_scopes', ...tables])
      assert.equal((await f.pool.query(`SELECT count(*) FROM ${name}`)).rows[0].count, '0');
  } finally {
    await second.end();
    await f.close();
  }
});
test('interrupted038 rolls back its tables and populated old rows then retry succeeds', async () => {
  const f = await fixture(release.migrate),
    held = await f.pool.connect();
  try {
    await seed(f);
    const before = await oldState(f.pool);
    await held.query('BEGIN');
    await held.query('LOCK TABLE schema_migrations IN SHARE MODE');
    const outcome = migrate(f.pool).then(
      () => ({ ok: true, error: '' }),
      (e) => ({ ok: false, error: String(e) }),
    );
    let pid: number | undefined;
    for (let i = 0; i < 200 && !pid; i++) {
      pid = (
        await f.pool.query(
          "SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE 'INSERT INTO schema_migrations%'",
          [f.schema],
        )
      ).rows[0]?.pid;
      if (!pid) await delay(10);
    }
    assert.ok(pid, '038 waits at the migration-ledger insert');
    await f.pool.query('SELECT pg_cancel_backend($1)', [pid]);
    assert.equal((await outcome).ok, false);
    await held.query('ROLLBACK');
    assert.deepEqual(await oldState(f.pool), before);
    assert.equal(
      (await f.pool.query("SELECT to_regclass('fiscal_registry_scopes') AS name")).rows[0].name,
      null,
    );
    await migrate(f.pool);
    assert.equal(
      (await f.pool.query('SELECT count(*) FROM schema_migrations')).rows[0].count,
      String(migrationNames.length),
    );
  } finally {
    await held.query('ROLLBACK');
    held.release();
    await f.close();
  }
});
test('runtime cannot update delete or truncate permanent names events or paper facts', async () => {
  const f = await fixture(),
    role = 'fiscal_runtime_' + randomUUID().replaceAll('-', '');
  try {
    const v = await seed(f),
      venue = (
        await f.pool.query('SELECT venue_id FROM installations WHERE id=$1', [v.installation])
      ).rows[0].venue_id,
      id = await allocation(f.pool, v.account, venue);
    await f.pool.query(
      `INSERT INTO fiscal_registry_events(event_id,taxpayer_nif,software_id,environment,sequence,operation_id,action,request_digest,allocation_id,event,result) VALUES($1,'89890001K','WT','preproduction',42,$2,'reserve',$3,$4,$5,$6)`,
      [
        randomUUID(),
        randomUUID(),
        'b'.repeat(64),
        id,
        { fixture: 'immutable-event' },
        { fixture: 'signed-result' },
      ],
    );
    await f.pool.query(
      `INSERT INTO fiscal_registry_paper_events(event_id,taxpayer_nif,software_id,environment,custodian_id,register_revision,block_digest,event_digest,fact) VALUES($1,'89890001K','WT','preproduction','custodian',1,$2,$3,$4)`,
      [randomUUID(), 'c'.repeat(64), 'd'.repeat(64), { fixture: 'immutable-paper-fact' }],
    );
    await f.pool.query(
      'INSERT INTO fiscal_registry_operation_routes(operation_id,venue_id,account_id,scope,action,request_digest) VALUES($1,$2,$3,$4,$5,$6)',
      [
        randomUUID(),
        venue,
        v.account,
        {
          taxpayerNif: '89890001K',
          softwareId: 'WT',
          environment: 'preproduction',
        },
        'reserve',
        'e'.repeat(64),
      ],
    );
    const before = await Promise.all(
      tables.map(
        async (name) => (await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${name} t`)).rows,
      ),
    );
    await f.pool.query(`CREATE ROLE ${role} NOLOGIN`);
    await f.pool.query(`GRANT USAGE ON SCHEMA ${f.schema} TO ${role}`);
    await f.pool.query(
      `GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON ${tables.join(',')},cloud_accounts TO ${role}`,
    );
    const client = await f.pool.connect();
    try {
      await client.query(`SET ROLE ${role}`);
      for (const name of tables)
        for (const sql of [
          `UPDATE ${name} SET ${name === 'fiscal_registry_allocations' ? 'custody_version' : name === 'fiscal_registry_events' || name === 'fiscal_registry_operation_routes' ? 'action' : 'custodian_id'}=${name === 'fiscal_registry_events' || name === 'fiscal_registry_operation_routes' ? "'consume'" : "'changed'"}`,
          `DELETE FROM ${name}`,
          `TRUNCATE ${name} CASCADE`,
        ])
          await assert.rejects(client.query(sql), (e: { code: string }) => {
            assert.equal(e.code, '55000');
            return true;
          });
      await client.query('INSERT INTO cloud_accounts(id) VALUES($1)', [randomUUID()]);
    } finally {
      await client.query('RESET ROLE');
      client.release();
    }
    assert.deepEqual(
      await Promise.all(
        tables.map(
          async (name) => (await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${name} t`)).rows,
        ),
      ),
      before,
    );
    await f.pool.query(
      'ALTER TABLE fiscal_registry_events ADD COLUMN migration_capability boolean',
    );
    await f.pool.query('ALTER TABLE fiscal_registry_events DROP COLUMN migration_capability');
  } finally {
    await f.close();
    const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    try {
      await admin.query(`DROP ROLE IF EXISTS ${role}`);
    } finally {
      await admin.end();
    }
  }
});
test('namespace uniqueness crosses organisations and retained rows prevent venue/account deletion', async () => {
  const f = await fixture();
  try {
    const a = await seed(f),
      b = await f.venue(),
      venue = (
        await f.pool.query('SELECT venue_id FROM installations WHERE id=$1', [a.installation])
      ).rows[0].venue_id,
      other = (
        await f.pool.query('SELECT venue_id FROM installations WHERE id=$1', [b.installation])
      ).rows[0].venue_id;
    const id = await allocation(f.pool, a.account, venue);
    await assert.rejects(allocation(f.pool, b.account, other), {
      code: '23505',
    });
    assert.equal(
      (
        await f.pool.query(
          'SELECT installation_identity FROM fiscal_registry_allocations WHERE allocation_id=$1',
          [id],
        )
      ).rows[0].installation_identity,
      'C000042',
    );
    await assert.rejects(f.pool.query('DELETE FROM venues WHERE id=$1', [venue]), {
      code: '23503',
    });
    await assert.rejects(f.pool.query('DELETE FROM cloud_accounts WHERE id=$1', [a.account]), {
      code: '23503',
    });
    const second = await allocation(f.pool, b.account, other, 'C000043');
    assert.notEqual(second, id);
  } finally {
    await f.close();
  }
});
test('SQL refuses out-of-range namespace counters and invalid or mismatched identities', async () => {
  const f = await fixture();
  try {
    const v = await seed(f),
      venue = (
        await f.pool.query('SELECT venue_id FROM installations WHERE id=$1', [v.installation])
      ).rows[0].venue_id;
    await allocation(f.pool, v.account, venue);
    for (const value of [-1, 1000000])
      await assert.rejects(
        f.pool.query('UPDATE fiscal_registry_scopes SET c_high_water=$1', [value]),
        { code: '23514' },
      );
    for (const identity of [
      'C000000',
      'S000000',
      'P000000',
      'C1000000',
      'E8ZZZZZZZZZZZZZZZZZZZZZZZZZ',
    ])
      await assert.rejects(allocation(f.pool, v.account, venue, identity), {
        code: '23514',
      });
    const id = randomUUID();
    await assert.rejects(
      f.pool.query(
        `INSERT INTO fiscal_registry_allocations(allocation_id,taxpayer_nif,software_id,environment,installation_identity,venue_id,account_id,allocation,binding,custody_version,entitlement_version,initial_receipt) VALUES($1,'89890001K','WT','preproduction','C000050',$2,$3,$4,$5,'1','1','{}')`,
        [id, venue, v.account, payload().allocation, binding],
      ),
      { code: '23514' },
    );
  } finally {
    await f.close();
  }
});
test('current consumers refuse missing extra changed and pre-registry migration ledgers', async () => {
  const f = await fixture(release.migrate);
  try {
    await assert.rejects(checkConsumerSchema(f.pool, root));
    assert.equal(hasReleaseMigrationCount('37'), false);
    await migrate(f.pool);
    assert.equal(migrationNames[37], '038_fiscal_allocation_registry.sql');
    await checkConsumerSchema(f.pool, root);
    assert.equal(hasReleaseMigrationCount(String(migrationNames.length)), true);
    for (const count of ['36', '37', String(migrationNames.length - 1), String(migrationNames.length + 1)]) assert.equal(hasReleaseMigrationCount(count), false);
    const tail = (
      await f.pool.query(
        "SELECT * FROM schema_migrations WHERE name='038_fiscal_allocation_registry.sql'",
      )
    ).rows[0];
    await f.pool.query(
      "DELETE FROM schema_migrations WHERE name='038_fiscal_allocation_registry.sql'",
    );
    await assert.rejects(checkConsumerSchema(f.pool, root), /schema_incompatible/);
    await f.pool.query('INSERT INTO schema_migrations(name,digest,applied_at) VALUES($1,$2,$3)', [
      tail.name,
      tail.digest,
      tail.applied_at,
    ]);
    await f.pool.query('UPDATE schema_migrations SET digest=$2 WHERE name=$1', [
      tail.name,
      'wrong',
    ]);
    await assert.rejects(checkConsumerSchema(f.pool, root), /schema_incompatible/);
    await f.pool.query('UPDATE schema_migrations SET digest=$2 WHERE name=$1', [
      tail.name,
      tail.digest,
    ]);
    await f.pool.query(
      "INSERT INTO schema_migrations(name,digest) VALUES('999_future.sql','unknown')",
    );
    await assert.rejects(checkConsumerSchema(f.pool, root), /schema_incompatible/);
  } finally {
    await f.close();
  }
});

test('event sequences operation IDs and paper revisions cannot fork within a namespace', async () => {
  const f = await fixture();
  try {
    const v = await seed(f),
      venue = (
        await f.pool.query('SELECT venue_id FROM installations WHERE id=$1', [v.installation])
      ).rows[0].venue_id;
    const id = await allocation(f.pool, v.account, venue),
      op = randomUUID();
    const event = (sequence: number, operation: string) =>
      f.pool.query(
        `INSERT INTO fiscal_registry_events(event_id,taxpayer_nif,software_id,environment,sequence,operation_id,action,request_digest,allocation_id,event,result)
      VALUES($1,'89890001K','WT','preproduction',$2,$3,'reserve',$4,$5,'{}','{}')`,
        [randomUUID(), sequence, operation, 'b'.repeat(64), id],
      );
    await event(1, op);
    await assert.rejects(event(1, randomUUID()), { code: '23505' });
    await assert.rejects(event(2, op), { code: '23505' });
    const paper = () =>
      f.pool.query(
        `INSERT INTO fiscal_registry_paper_events(event_id,taxpayer_nif,software_id,environment,custodian_id,register_revision,block_digest,event_digest,fact)
      VALUES($1,'89890001K','WT','preproduction','custodian',1,$2,$3,'{}')`,
        [randomUUID(), 'c'.repeat(64), 'd'.repeat(64)],
      );
    await paper();
    await assert.rejects(paper(), { code: '23505' });
    assert.equal(
      (await f.pool.query('SELECT count(*) FROM fiscal_registry_events')).rows[0].count,
      '1',
    );
    assert.equal(
      (await f.pool.query('SELECT count(*) FROM fiscal_registry_paper_events')).rows[0].count,
      '1',
    );
  } finally {
    await f.close();
  }
});
