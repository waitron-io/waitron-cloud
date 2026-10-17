import {resetSchema} from './fixtures/reset-schema.ts';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { after, before, beforeEach, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { RegistrationStore, type ConnectionBinding } from '../src/index.ts';
import { migrate, migrationNames } from '../src/migrate.ts';
import { MonitorWorker } from '../src/monitoring.ts';
import { EmailOutbox } from '../src/email-outbox.ts';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Use pnpm test, or supply TEST_DATABASE_URL for a disposable PostgreSQL database');
const schema = `test_${randomUUID().replaceAll('-', '')}`;
const options = `-c search_path=${schema} -c statement_timeout=10000`;
const admin = new Pool({ connectionString: url });
const pool = new Pool({ connectionString: url, options, application_name: `${schema}_first` });
const otherPool = new Pool({ connectionString: url, options, application_name: `${schema}_second` });
const store = new RegistrationStore(pool);
const other = new RegistrationStore(otherPool);
const accountId = randomUUID();
const organisationId = randomUUID();
const legalBusinessId = randomUUID();
const secondOrganisationId = randomUUID();
const secondBusinessId = randomUUID();
function binding(overrides: Partial<ConnectionBinding> = {}): ConnectionBinding {
  return { operationId: randomUUID(), installationKey: `key:${randomUUID()}`, localVenueId: randomUUID(),
    environment: 'test', organisationId, legalBusinessId, ...overrides };
}
async function approved(input = binding()) {
  await store.start(input);
  await store.approveLocal(input, randomUUID());
  await store.approveCloud(input, accountId);
  return input;
}
async function count(table: string) {
  // Callers are test literals; table names never come from application input.
  return Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
}
async function expectCode(action: Promise<unknown>, code: string) {
  await assert.rejects(action, (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === code);
}
before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await Promise.all([migrate(pool), migrate(otherPool)]);
});
after(async () => {
  await Promise.all([pool.end(), otherPool.end()]);
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});
beforeEach(async () => {
  await resetSchema(pool);
  await pool.query('INSERT INTO cloud_accounts (id) VALUES ($1)', [accountId]);
  await pool.query('INSERT INTO organisations (id) VALUES ($1), ($2)', [organisationId, secondOrganisationId]);
  await pool.query('INSERT INTO legal_businesses (id, organisation_id) VALUES ($1, $2), ($3, $4)',
    [legalBusinessId, organisationId, secondBusinessId, secondOrganisationId]);
  await pool.query('INSERT INTO organisation_memberships (account_id, organisation_id, can_register_venues) VALUES ($1, $2, true), ($1, $3, true)',
    [accountId, organisationId, secondOrganisationId]);
});

test('migration remains repeatable after concurrent initial application', async () => {
  await migrate(pool);
  const legacyNames=(await pool.query("SELECT name FROM schema_migrations WHERE name<'034_relay_admission_bounds.sql' ORDER BY name")).rows.map(row=>row.name);
  assert.equal(legacyNames.length, 33);
  assert.equal(legacyNames.at(-8), '026_support_grants.sql');
  assert.equal(legacyNames.at(-7), '027_pairing_code_protection.sql');
  assert.equal(legacyNames.at(-6), '028_recovery_code_protection.sql');
  assert.equal(legacyNames.at(-5), '029_backup_verification_unavailable.sql');
  assert.equal(legacyNames.at(-4), '030_staff_certificate_exchange.sql');
  assert.equal(legacyNames.at(-3), '031_relay_grants.sql');
  assert.equal(legacyNames.at(-2), '032_relay_messages.sql');
  assert.equal(legacyNames.at(-1), '033_relay_worker.sql');
  assert.deepEqual(legacyNames, migrationNames.slice(0,33));
  assert.equal(migrationNames.slice(0,35).length,35);
  assert.equal(migrationNames[33],'034_relay_admission_bounds.sql');
  assert.equal(migrationNames[34],'035_authenticator_factor.sql');
  assert.equal(migrationNames.length,42);assert.equal(migrationNames[41],'042_organisation_service_plans.sql');assert.equal(migrationNames[40],'041_content_translation_service.sql');assert.equal(migrationNames[39],'040_translation_result_json.sql');
  assert.equal(migrationNames[35],'036_relay_operator_stop.sql');
  assert.equal(migrationNames[36],'037_monitoring_quiet_escalation.sql');
  assert.equal(migrationNames[37],'038_fiscal_allocation_registry.sql');assert.equal(migrationNames[38],'039_translation_jobs.sql');
  assert.equal(await count('schema_migrations'), migrationNames.length);
});

test('both approvals create one link with the original services unconfigured', async () => {
  const input = await approved();
  const result = await store.complete(input);
  assert.equal(result.organisationId, organisationId);
  assert.equal(result.legalBusinessId, legalBusinessId);
  assert.equal(await count('venues'), 1);
  assert.equal(await count('installations'), 1);
  const config = await store.configuration(input.installationKey);
  assert.equal(config.venueId, result.venueId);
  assert.deepEqual(config.services, [
    { service: 'continuous_backup', state: 'unconfigured' },
    { service: 'remote_access', state: 'unconfigured' },
    { service: 'retained_snapshots', state: 'unconfigured' },
  ]);
});

test('missing either approval never creates a venue', async () => {
  const localOnly = binding();
  await store.start(localOnly);
  await store.approveLocal(localOnly, randomUUID());
  await expectCode(store.complete(localOnly), 'approval_required');
  const cloudOnly = binding();
  await store.start(cloudOnly);
  await store.approveCloud(cloudOnly, accountId);
  await expectCode(store.complete(cloudOnly), 'approval_required');
  assert.equal(await count('venues'), 0);
});

test('expired request rejects approval and completion without writes', async () => {
  const input = await approved();
  await pool.query("UPDATE connection_requests SET expires_at = clock_timestamp() - interval '1 second'");
  await expectCode(store.approveLocal(input, randomUUID()), 'request_expired');
  await expectCode(store.approveCloud(input, accountId), 'request_expired');
  await expectCode(store.complete(input), 'request_expired');
  assert.equal(await count('venues'), 0);
});

test('retries preserve the original expiry and reject any changed binding', async () => {
  const input = await approved();
  const expiry = (await pool.query('SELECT expires_at FROM connection_requests')).rows[0].expires_at;
  await store.start(input);
  assert.deepEqual((await pool.query('SELECT expires_at FROM connection_requests')).rows[0].expires_at, expiry);
  for (const changed of [
    { organisationId: secondOrganisationId, legalBusinessId: secondBusinessId },
    { legalBusinessId: secondBusinessId }, { localVenueId: randomUUID() }, { environment: 'production' },
  ]) {
    const wrong = { ...input, ...changed };
    await expectCode(store.start(wrong), 'binding_conflict');
    await expectCode(store.approveLocal(wrong, randomUUID()), 'binding_conflict');
    await expectCode(store.approveCloud(wrong, accountId), 'binding_conflict');
    await expectCode(store.complete(wrong), 'binding_conflict');
  }
  // Operation IDs are scoped to installation identity, so another identity cannot use its approvals.
  await expectCode(store.complete({ ...input, installationKey: 'another-key' }), 'request_not_found');
});

test('a local approval receipt cannot be rebound to another request', async () => {
  const first = binding();
  const second = binding();
  const receipt = randomUUID();
  await store.start(first);
  await store.start(second);
  await store.approveLocal(first, receipt);
  await store.approveLocal(first, receipt);
  await expectCode(store.approveLocal(first, randomUUID()), 'approval_conflict');
  await expectCode(store.approveLocal(second, receipt), 'approval_conflict');
});

test('Cloud permission is required at approval and rechecked at completion', async () => {
  const input = await approved();
  await pool.query('UPDATE organisation_memberships SET can_register_venues = false');
  await expectCode(store.approveCloud(input, accountId), 'permission_denied');
  await expectCode(store.complete(input), 'permission_denied');
  await pool.query('UPDATE organisation_memberships SET can_register_venues = true');
  await pool.query('UPDATE cloud_accounts SET disabled_at = clock_timestamp()');
  await expectCode(store.complete(input), 'permission_denied');
  assert.equal(await count('venues'), 0);
});

test('legal business must belong to the chosen organisation', async () => {
  await expectCode(store.start(binding({ legalBusinessId: secondBusinessId })), 'business_not_found');
  assert.equal(await count('connection_requests'), 0);
});

test('two workers blocked on the same request return exactly the same registration', async () => {
  const input = await approved();
  const blocker = await pool.connect();
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT 1 FROM connection_requests FOR UPDATE');
    const completions = Promise.all([store.complete(input), other.complete(input)]);
    let blocked = false;
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        const result = await admin.query("SELECT count(*) FROM pg_stat_activity WHERE application_name = ANY($1) AND wait_event_type = 'Lock'",
          [[`${schema}_first`, `${schema}_second`]]);
        if (Number(result.rows[0].count) === 2) { blocked = true; break; }
        await delay(20);
      }
    } finally {
      await blocker.query('COMMIT');
    }
    const [first, second] = await completions;
    assert.ok(blocked, 'both independent PostgreSQL sessions must reach the request lock');
    assert.deepEqual(first, second);
    assert.equal(await count('venues'), 1);
    assert.equal(await count('installations'), 1);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
});

test('requests for the same venue cannot transfer ownership or replace a server', async () => {
  const first = await approved();
  const result = await store.complete(first);
  for (const changes of [
    { organisationId: secondOrganisationId, legalBusinessId: secondBusinessId },
    { installationKey: `key:${randomUUID()}` },
  ]) {
    const input = await approved({ ...first, operationId: randomUUID(), ...changes });
    await expectCode(store.complete(input), 'registration_conflict');
  }
  assert.equal(await count('venues'), 1);
  assert.equal((await store.configuration(first.installationKey)).venueId, result.venueId);
});

test('concurrent distinct requests for one local venue create only one link', async () => {
  const first = await approved();
  const second = await approved(binding({ localVenueId: first.localVenueId }));
  const results = await Promise.allSettled([store.complete(first), other.complete(second)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const rejected = results.find(r => r.status === 'rejected');
  assert.equal(rejected?.reason.code, 'registration_conflict');
  assert.equal(await count('venues'), 1);
  assert.equal(await count('installations'), 1);
});

test('one installation key cannot register a second venue and failed transaction leaves no orphan', async () => {
  const first = await approved();
  await store.complete(first);
  const second = await approved(binding({ installationKey: first.installationKey }));
  await expectCode(store.complete(second), 'registration_conflict');
  assert.equal(await count('venues'), 1);
  assert.equal(await count('installations'), 1);
  assert.equal((await pool.query('SELECT result FROM connection_requests WHERE operation_id = $1', [second.operationId])).rows[0].result, null);
});

test('new processes resume approved requests and recover a committed result after lost reply', () => {
  const input = binding();
  const run = (action: string) => execFileSync(process.execPath, ['test/fixtures/restart.ts'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, TEST_DATABASE_OPTIONS: options },
    input: JSON.stringify({ action, binding: input, accountId, receiptId: randomUUID() }),
  });
  run('prepare');
  const first = JSON.parse(run('complete'));
  const retry = JSON.parse(run('complete'));
  assert.deepEqual(first, retry);
});

test('completed retries survive request expiry without issuing another registration', async () => {
  const input = await approved();
  const result = await store.complete(input);
  await pool.query("UPDATE connection_requests SET expires_at = clock_timestamp() - interval '1 second'");
  assert.deepEqual(await store.complete(input), result);
  assert.equal(await count('installations'), 1);
});

test('configuration is scoped to the authenticated installation and preserves failed service state', async () => {
  const first = await approved();
  const second = await approved(binding({ organisationId: secondOrganisationId, legalBusinessId: secondBusinessId }));
  const a = await store.complete(first);
  const b = await store.complete(second);
  await pool.query("UPDATE installation_services SET state = 'failed' WHERE installation_id = $1 AND service = 'continuous_backup'", [a.installationId]);
  const config = await store.configuration(first.installationKey);
  assert.equal(config.venueId, a.venueId);
  assert.notEqual(config.venueId, b.venueId);
  assert.equal(config.services.find(s => s.service === 'continuous_backup')?.state, 'failed');
  assert.equal((await store.configuration(second.installationKey)).services.find(s => s.service === 'continuous_backup')?.state, 'unconfigured');
  await expectCode(store.configuration('unknown-key'), 'installation_unavailable');
  await pool.query('UPDATE installations SET revoked_at = clock_timestamp() WHERE id = $1', [a.installationId]);
  await expectCode(store.configuration(first.installationKey), 'installation_unavailable');
  await expectCode(store.complete(first), 'installation_unavailable');
});

async function whileBlocked(input: ConnectionBinding, block: (client: import('pg').PoolClient) => Promise<void>, release: (client: import('pg').PoolClient) => Promise<void>, code: string) {
  const blocker = await pool.connect();
  let completion: Promise<void> | undefined;
  try {
    await blocker.query('BEGIN');
    await block(blocker);
    completion = expectCode(other.complete(input), code);
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const { rows } = await admin.query("SELECT count(*) FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'", [`${schema}_second`]);
      if (Number(rows[0].count) === 1) { blocked = true; break; }
      await delay(20);
    }
    await release(blocker);
    await blocker.query('COMMIT');
    await completion;
    assert.ok(blocked, 'completion must reach the contested database lock');
    assert.equal(await count('venues'), 0);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await completion;
  }
}

test('permission revocation committed during a lock wait is respected', async () => {
  const input = await approved();
  await whileBlocked(input,
    client => client.query('UPDATE organisation_memberships SET can_register_venues = false').then(() => {}),
    async () => {}, 'permission_denied');
});

test('expiry uses wall time after waiting for the permission lock', async () => {
  const input = await approved();
  await pool.query("UPDATE connection_requests SET expires_at = clock_timestamp() + interval '1 second'");
  await whileBlocked(input,
    client => client.query('SELECT 1 FROM organisation_memberships FOR UPDATE').then(() => {}),
    async (client) => {
      const { rows } = await client.query(`SELECT a.xact_start < r.expires_at AS started_before_expiry
        FROM pg_stat_activity a CROSS JOIN connection_requests r WHERE a.application_name = $1`, [`${schema}_second`]);
      assert.equal(rows[0].started_before_expiry, true);
      await delay(1100);
    }, 'request_expired');
});

for (const mode of ['query', 'between-queries']) {
  test(`terminated transaction backend rejects without killing the process (${mode})`, () => {
    const output = execFileSync(process.execPath, ['test/fixtures/connection-loss.ts', mode], {
      cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 10_000,
      env: process.env, stdio: ['pipe', 'pipe', 'pipe'],
    });
    assert.deepEqual(JSON.parse(output), { rejected: true, poolUsable: true });
  });
}

test('completed result survives approver permission loss without creating new authority', async () => {
  const input = await approved();
  const result = await store.complete(input);
  await pool.query('UPDATE organisation_memberships SET can_register_venues = false');
  assert.deepEqual(await store.complete(input), result);
  await pool.query('UPDATE cloud_accounts SET disabled_at = clock_timestamp()');
  assert.deepEqual(await store.complete(input), result);
  assert.equal(await count('installations'), 1);
  await pool.query('UPDATE installations SET revoked_at = clock_timestamp()');
  await expectCode(store.complete(input), 'installation_unavailable');
});

test('expiry during a venue insert wait rolls back the installation, services and result', async () => {
  const input = await approved();
  await pool.query("UPDATE connection_requests SET expires_at = clock_timestamp() + interval '1 second'");
  const blocker = await pool.connect();
  let completion: Promise<void> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query(`INSERT INTO venues (id, organisation_id, legal_business_id, local_venue_id, environment)
      VALUES ($1, $2, $3, $4, $5)`, [randomUUID(), organisationId, legalBusinessId, input.localVenueId, input.environment]);
    completion = expectCode(other.complete(input), 'request_expired');
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const { rows } = await admin.query(`SELECT query FROM pg_stat_activity
        WHERE application_name = $1 AND wait_event_type = 'Lock'`, [`${schema}_second`]);
      if (rows[0]?.query.startsWith('INSERT INTO venues')) { blocked = true; break; }
      await delay(20);
    }
    await delay(1100);
    await blocker.query('COMMIT');
    await completion;
    assert.ok(blocked, 'completion must wait on the venue insert after its first expiry check');
    assert.equal(await count('installations'), 0);
    assert.equal(await count('installation_services'), 0);
    const { rows } = await pool.query('SELECT result, completed_at FROM connection_requests');
    assert.deepEqual(rows[0], { result: null, completed_at: null });
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await completion;
  }
});

test('unexpected database uniqueness errors remain distinguishable from registration conflicts', async () => {
  const input = await approved();
  await pool.query(`CREATE FUNCTION inject_collision() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE unique_violation USING MESSAGE = 'injected failure', CONSTRAINT = 'unexpected_collision'; END $$;
    CREATE TRIGGER inject_collision BEFORE INSERT ON installation_services
    FOR EACH ROW EXECUTE FUNCTION inject_collision()`);
  try {
    await assert.rejects(store.complete(input), (error: unknown) =>
      typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
        && 'constraint' in error && error.constraint === 'unexpected_collision');
    assert.equal(await count('venues'), 0);
    assert.equal(await count('installations'), 0);
  } finally {
    await pool.query('DROP TRIGGER inject_collision ON installation_services; DROP FUNCTION inject_collision()');
  }
});

test('concurrent approved requests sharing a key serialize an existing unlinked venue', async () => {
  const localVenueId = randomUUID();
  const installationKey = `key:${randomUUID()}`;
  const venueId = randomUUID();
  // An unlinked venue bypasses insert-conflict serialization, so its row lock must arbitrate installation creation.
  await pool.query(`INSERT INTO venues (id, organisation_id, legal_business_id, local_venue_id, environment)
    VALUES ($1, $2, $3, $4, 'test')`, [venueId, organisationId, legalBusinessId, localVenueId]);
  const first = await approved(binding({localVenueId, installationKey}));
  const second = await approved({...first, operationId: randomUUID()});
  const blocker = await pool.connect();
  let firstCompletion: Promise<unknown> | undefined, secondCompletion: Promise<unknown> | undefined;
  const waitForLock = async (application: string) => {
    for (let n = 0; n < 100; n++) {
      const result = await admin.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'", [application]);
      if (result.rowCount) return;
      await delay(20);
    }
    assert.fail(`operation did not reach a database lock: ${application}`);
  };
  try {
    await pool.query(`CREATE TABLE installation_gate (id integer PRIMARY KEY); INSERT INTO installation_gate VALUES(1);
      CREATE FUNCTION pause_installation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        PERFORM id FROM installation_gate WHERE id=1 FOR UPDATE; RETURN NEW;
      END $$;
      CREATE TRIGGER pause_installation BEFORE INSERT ON installations FOR EACH ROW EXECUTE FUNCTION pause_installation()`);
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM installation_gate WHERE id=1 FOR UPDATE');
    firstCompletion = store.complete(first); void firstCompletion.catch(() => {});
    await waitForLock(`${schema}_first`);
    secondCompletion = other.complete(second); void secondCompletion.catch(() => {});
    await waitForLock(`${schema}_second`);
    await blocker.query('COMMIT');
    const [firstResult, secondResult] = await Promise.all([firstCompletion, secondCompletion]);
    assert.deepEqual(secondResult, firstResult);
    assert.equal(await count('venues'), 1);
    assert.equal(await count('installations'), 1);
    const requests = await pool.query('SELECT result FROM connection_requests ORDER BY operation_id');
    assert.deepEqual(requests.rows, [{result: firstResult}, {result: firstResult}]);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await Promise.allSettled([firstCompletion, secondCompletion]);
    await pool.query('DROP TRIGGER IF EXISTS pause_installation ON installations; DROP FUNCTION IF EXISTS pause_installation(); DROP TABLE IF EXISTS installation_gate');
  }
});

for (const differentKey of [false, true]) test(`pairing ${differentKey ? 'conflict' : 'retry'} allows a concurrent monitor incident to commit`, async () => {
  const initial = await approved();
  const installed = await store.complete(initial);
  const request = await approved({ ...initial, operationId: randomUUID(),
    ...(differentKey ? { installationKey: `key:${randomUUID()}` } : {}) });
  await pool.query("UPDATE installation_services SET state='ready' WHERE installation_id=$1 AND service='remote_access'", [installed.installationId]);
  await pool.query("UPDATE installations SET last_contact_at=clock_timestamp()-interval '16 minutes' WHERE id=$1", [installed.installationId]);
  const monitor = new MonitorWorker(pool, new EmailOutbox({ activeKeyId: 'test', keys: { test: randomBytes(32).toString('hex') } }));
  await monitor.schedule();
  const blocker = await pool.connect();
  let scan: Promise<boolean> | undefined, completion: Promise<unknown> | undefined;
  const waitForLock = async (application: string, query: string) => {
    for (let n = 0; n < 100; n++) {
      const result = await admin.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE $2", [application, query]);
      if (result.rowCount) return;
      await delay(20);
    }
    assert.fail(`operation did not reach expected lock: ${query}`);
  };
  try {
    // Pause the real worker before its incident foreign-key check, with its installation lock held.
    await pool.query(`CREATE TABLE incident_gate (id integer PRIMARY KEY); INSERT INTO incident_gate VALUES(1);
      CREATE FUNCTION pause_incident() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        PERFORM id FROM incident_gate WHERE id=1 FOR UPDATE; RETURN NEW;
      END $$;
      CREATE TRIGGER pause_incident BEFORE INSERT ON venue_incidents FOR EACH ROW EXECUTE FUNCTION pause_incident()`);
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM incident_gate WHERE id=1 FOR UPDATE');
    scan = monitor.runOnce(); void scan.catch(() => {});
    await waitForLock(`${schema}_first`, 'INSERT INTO venue_incidents%');
    completion = other.complete(request); void completion.catch(() => {});
    await waitForLock(`${schema}_second`, 'SELECT * FROM installations WHERE venue_id%');
    await blocker.query('COMMIT');
    const [observed, paired] = await Promise.allSettled([scan, completion]);
    assert.equal(observed.status, 'fulfilled', observed.status === 'rejected' ? String(observed.reason) : '');
    assert.equal(observed.status === 'fulfilled' && observed.value, true);
    if (differentKey) {
      assert.equal(paired.status, 'rejected');
      assert.equal(paired.status === 'rejected' && paired.reason.code, 'registration_conflict');
    } else {
      assert.equal(paired.status, 'fulfilled', paired.status === 'rejected' ? String(paired.reason) : '');
      assert.deepEqual(paired.status === 'fulfilled' && paired.value, installed);
    }
    const incidents = await pool.query('SELECT kind,status,revision FROM venue_incidents WHERE venue_id=$1', [installed.venueId]);
    assert.deepEqual(incidents.rows, [{ kind: 'disconnected', status: 'open', revision: 1 }]);
    assert.equal(await count('installations'), 1);
    assert.equal((await store.configuration(initial.installationKey)).installationId, installed.installationId);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await Promise.allSettled([scan, completion]);
    await pool.query('DROP TRIGGER IF EXISTS pause_incident ON venue_incidents; DROP FUNCTION IF EXISTS pause_incident(); DROP TABLE IF EXISTS incident_gate');
  }
});
