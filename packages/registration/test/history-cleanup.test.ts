import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after, before, beforeEach, test} from 'node:test';
import {Pool} from 'pg';
import {HistoryCleanup, parseHistoryCleanupPolicy} from '../src/history-cleanup.ts';
import {migrate} from '../src/migrate.ts';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Run through scripts/test-postgres.mjs');
const schema = `history_${randomUUID().replaceAll('-', '')}`;
const options = `-c search_path=${schema} -c statement_timeout=10000`;
const admin = new Pool({connectionString: url});
const pool = new Pool({connectionString: url, options, application_name: `${schema}_cleanup`});
const cleanup = new HistoryCleanup(pool);
const accountId = randomUUID(), organisationId = randomUUID(), businessId = randomUUID();
const venueId = randomUUID(), installationId = randomUUID();
const old = '2020-01-01T00:00:00.000Z', cutoff = '2025-01-01T00:00:00.000Z';
const older = '2019-12-31T23:55:00.000Z';
const future = '2030-01-01T00:00:00.000Z';
const hash = (character: string) => character.repeat(64);

before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
});
after(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});
beforeEach(async () => {
  await pool.query('TRUNCATE organisations, cloud_accounts, email_outbox CASCADE');
  await pool.query('INSERT INTO cloud_accounts(id) VALUES($1)', [accountId]);
  await pool.query('INSERT INTO organisations(id) VALUES($1)', [organisationId]);
  await pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)', [businessId, organisationId]);
  await pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,can_register_venues,is_owner) VALUES($1,$2,true,true)', [accountId, organisationId]);
  await pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,'test')",
    [venueId, organisationId, businessId, randomUUID()]);
  await pool.query('INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,$3)', [installationId, venueId, `key:${installationId}`]);
  await pool.query("INSERT INTO installation_services(installation_id,service) VALUES($1,'remote_access'),($1,'continuous_backup'),($1,'retained_snapshots')", [installationId]);
});

async function count(table: string) {
  return Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
}

test('history cleanup policy accepts only explicit timezone-bearing category cutoffs', () => {
  const policy = parseHistoryCleanupPolicy({
    cutoffs: {
      sessions: '2026-01-02T03:04:05.000Z',
      backupTombstones: '2025-12-01T00:00:00+01:00',
    },
    chunkSize: 37,
  });
  assert.deepEqual(policy, {
    cutoffs: {
      sessions: '2026-01-02T03:04:05.000Z',
      backupTombstones: '2025-11-30T23:00:00.000Z',
    },
    chunkSize: 37,
  });
  assert.equal(Object.isFrozen(policy), true);
  assert.equal(Object.isFrozen(policy.cutoffs), true);
  assert.equal('signupRequests' in policy.cutoffs, false);
});

test('history cleanup policy rejects ambiguous, unknown and unbounded input', () => {
  for (const value of [
    null, [], {}, {cutoffs: null}, {cutoffs: {}, extra: true},
    {cutoffs: {unknown: '2026-01-01T00:00:00Z'}},
    {cutoffs: {sessions: 1}},
    {cutoffs: {sessions: '2026-01-01'}},
    {cutoffs: {sessions: '2026-01-01T00:00:00'}},
    {cutoffs: {sessions: 'not-a-date'}},
    {cutoffs: {}, chunkSize: 0},
    {cutoffs: {}, chunkSize: 1001},
    {cutoffs: {}, chunkSize: 1.5},
  ]) assert.throws(() => parseHistoryCleanupPolicy(value), /Invalid history cleanup policy/);
});

test('dry run and apply bound identity, registration, delivery and operation history', async () => {
  await pool.query(`INSERT INTO cloud_sessions(token_hash,csrf_hash,account_id,created_at,last_seen_at,absolute_expires_at,ended_at)
    VALUES($1,$2,$3,$4,$4,$4,$4),($5,$6,$3,$4,$4,$4,$4),($7,$8,$3,$9,$9,$9,NULL)`,
  [hash('a'), hash('b'), accountId, old, hash('c'), hash('d'), hash('e'), hash('f'), future]);
  await pool.query(`INSERT INTO cloud_webauthn_ceremonies(id,kind,challenge,account_id,session_token_hash,created_at,expires_at)
    VALUES($1,'registration','live_challenge',$2,$3,$4,$5)`,
  [randomUUID(), accountId, hash('c'), future, '2030-01-01T00:05:00.000Z']);
  await pool.query(`INSERT INTO cloud_webauthn_ceremonies(id,kind,challenge,created_at,expires_at,consumed_at)
    VALUES($1,'authentication','old_challenge',$2,$3,$3)`, [randomUUID(), old, '2020-01-01T00:05:00.000Z']);

  await pool.query(`INSERT INTO signup_requests(token_hash,email,created_at,expires_at)
    VALUES($1,'remove@example.test',$3,$4),($2,'blocked@example.test',$3,$4),($5,'recent@example.test',$6,$7)`,
  [hash('1'), hash('2'), older, old, hash('3'), '2029-12-31T23:55:00.000Z', future]);
  await pool.query(`INSERT INTO email_outbox(id,kind,token_hash,key_id,payload,status,created_at,expires_at,available_at)
    VALUES($1,'verification',$2,'key',decode('00','hex'),'pending',$3,$4,$3)`, [randomUUID(), hash('2'), old, future]);
  await pool.query(`INSERT INTO password_reset_requests(token_hash,email,created_at,expires_at,consumed_at)
    VALUES($1,'reset@example.test',$2,$3,$3),($4,'recent-reset@example.test',$5,$6,NULL)`,
  [hash('4'), older, old, hash('5'), '2029-12-31T23:55:00.000Z', future]);

  await pool.query(`INSERT INTO pairing_requests(id,public_key,local_venue_id,environment,code_hash,expires_at)
    VALUES($1,'pair-old',$2,'test',$3,$4),($5,'pair-recent',$6,'test',$7,$8)`,
  [randomUUID(), randomUUID(), hash('6'), old, randomUUID(), randomUUID(), hash('7'), future]);
  await pool.query(`INSERT INTO connection_requests(operation_id,installation_key,local_venue_id,environment,organisation_id,legal_business_id,created_at,expires_at)
    VALUES($1,'connection-old',$2,'test',$3,$4,$5,$5),($6,'connection-recent',$7,'test',$3,$4,$8,$8)`,
  [randomUUID(), randomUUID(), organisationId, businessId, old, randomUUID(), randomUUID(), future]);
  await pool.query(`INSERT INTO installation_operations(installation_id,operation_id,digest,result,created_at)
    VALUES($1,$2,'old-digest','{}',$3),($1,$4,'recent-digest','{}',$5)`,
  [installationId, randomUUID(), old, randomUUID(), future]);

  const genericOutbox = randomUUID(), alertOutbox = randomUUID(), incidentId = randomUUID();
  await pool.query(`INSERT INTO email_outbox(id,kind,status,created_at,expires_at,available_at,finished_at)
    VALUES($1,'password_changed','sent',$3,$3,$3,$3),($2,'service_alert','sent',$3,$3,$3,$3)`,
  [genericOutbox, alertOutbox, old]);
  await pool.query(`INSERT INTO venue_incidents(id,venue_id,kind,status,revision,opened_at,changed_at)
    VALUES($1,$2,'disconnected','recovered',2,$3,$3)`, [incidentId, venueId, old]);
  await pool.query(`INSERT INTO service_alert_deliveries(outbox_id,incident_id,revision,state,account_id)
    VALUES($1,$2,2,'recovered',$3)`, [alertOutbox, incidentId, accountId]);

  const policy = parseHistoryCleanupPolicy({cutoffs: {
    sessions: cutoff, signupRequests: cutoff, passwordResetRequests: cutoff, webauthnCeremonies: cutoff,
    pairingRequests: cutoff, registrationOperations: cutoff, emailDeliveries: cutoff,
  }, chunkSize: 100});
  const beforeCounts = {
    sessions: await count('cloud_sessions'), signup: await count('signup_requests'), reset: await count('password_reset_requests'),
    ceremonies: await count('cloud_webauthn_ceremonies'), pairing: await count('pairing_requests'),
    connections: await count('connection_requests'), operations: await count('installation_operations'),
    outbox: await count('email_outbox'), deliveries: await count('service_alert_deliveries'), incidents: await count('venue_incidents'),
  };
  const dry = await cleanup.run(policy, {apply: false});
  assert.deepEqual({sessions: dry.categories.sessions, signup: dry.categories.signupRequests,
    reset: dry.categories.passwordResetRequests, ceremonies: dry.categories.webauthnCeremonies,
    pairing: dry.categories.pairingRequests, operations: dry.categories.registrationOperations,
    delivery: dry.categories.emailDeliveries}, {
    sessions: {cutoff, eligible: 1, blocked: 1, deleted: 0, hasMore: true},
    signup: {cutoff, eligible: 1, blocked: 1, deleted: 0, hasMore: true},
    reset: {cutoff, eligible: 1, blocked: 0, deleted: 0, hasMore: true},
    ceremonies: {cutoff, eligible: 1, blocked: 0, deleted: 0, hasMore: true},
    pairing: {cutoff, eligible: 1, blocked: 0, deleted: 0, hasMore: true},
    operations: {cutoff, eligible: 2, blocked: 0, deleted: 0, hasMore: true},
    delivery: {cutoff, eligible: 2, blocked: 0, deleted: 0, hasMore: true},
  });
  assert.deepEqual({
    sessions: await count('cloud_sessions'), signup: await count('signup_requests'), reset: await count('password_reset_requests'),
    ceremonies: await count('cloud_webauthn_ceremonies'), pairing: await count('pairing_requests'),
    connections: await count('connection_requests'), operations: await count('installation_operations'),
    outbox: await count('email_outbox'), deliveries: await count('service_alert_deliveries'), incidents: await count('venue_incidents'),
  }, beforeCounts);

  const applied = await cleanup.run(policy, {apply: true});
  assert.equal(applied.categories.sessions?.deleted, 1);
  assert.equal(applied.categories.registrationOperations?.deleted, 2);
  assert.equal(applied.categories.emailDeliveries?.deleted, 2);
  assert.deepEqual({sessions: await count('cloud_sessions'), signup: await count('signup_requests'),
    reset: await count('password_reset_requests'), ceremonies: await count('cloud_webauthn_ceremonies'),
    pairing: await count('pairing_requests'), connections: await count('connection_requests'),
    operations: await count('installation_operations'), outbox: await count('email_outbox'),
    deliveries: await count('service_alert_deliveries'), incidents: await count('venue_incidents')},
  {sessions: 2, signup: 2, reset: 1, ceremonies: 1, pairing: 1, connections: 1,
    operations: 1, outbox: 1, deliveries: 0, incidents: 1});
});
