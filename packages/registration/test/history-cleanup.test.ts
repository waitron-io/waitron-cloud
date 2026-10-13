import {resetSchema} from './fixtures/reset-schema.ts';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {after, before, beforeEach, test} from 'node:test';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {Pool} from 'pg';
import {HistoryCleanup, parseHistoryCleanupPolicy} from '../src/history-cleanup.ts';
import {UsageReconciler} from '../src/usage-metering.ts';
import {migrate} from '../src/migrate.ts';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Run through scripts/test-postgres.mjs');
const schema = `history_${randomUUID().replaceAll('-', '')}`;
const options = `-c search_path=${schema} -c statement_timeout=10000`;
const admin = new Pool({connectionString: url});
const pool = new Pool({connectionString: url, options, application_name: `${schema}_cleanup`});
const otherPool = new Pool({connectionString: url, options, application_name: `${schema}_worker`});
const racePool = new Pool({connectionString: url, options: `${options} -c lock_timeout=150`, application_name: `${schema}_race`});
const cleanup = new HistoryCleanup(pool);
const execute = promisify(execFile);
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
  await Promise.all([pool.end(), otherPool.end(), racePool.end()]);
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});
beforeEach(async () => {
  await resetSchema(pool);
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

function cliDatabaseUrl() {
  const databaseUrl = new URL(url!);
  databaseUrl.searchParams.set('options', `-c search_path=${schema} -c statement_timeout=10000`);
  return databaseUrl.href;
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

test('a future cutoff is refused before it can delete live authority or fresh replay results', async () => {
  await pool.query(`INSERT INTO cloud_sessions(token_hash,csrf_hash,account_id,created_at,last_seen_at,absolute_expires_at)
    VALUES($1,$2,$3,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '12 hours')`,
  [hash('9'), hash('0'), accountId]);
  await pool.query(`INSERT INTO installation_operations(installation_id,operation_id,digest,result)
    VALUES($1,$2,'fresh-result','{}')`, [installationId, randomUUID()]);
  const policy = parseHistoryCleanupPolicy({cutoffs: {sessions: future, registrationOperations: future}});
  await assert.rejects(cleanup.run(policy, {apply: true}), /Invalid history cleanup policy/);
  assert.equal(await count('cloud_sessions'), 1);
  assert.equal(await count('installation_operations'), 1);
});

test('one run removes an expired WebAuthn ceremony before its ended session', async () => {
  const tokenHash = hash('7');
  await pool.query(`INSERT INTO cloud_sessions(token_hash,csrf_hash,account_id,created_at,last_seen_at,absolute_expires_at,ended_at)
    VALUES($1,$2,$3,$4,$4,$4,$4)`, [tokenHash, hash('6'), accountId, old]);
  await pool.query(`INSERT INTO cloud_webauthn_ceremonies(id,kind,challenge,account_id,session_token_hash,created_at,expires_at,consumed_at)
    VALUES($1,'registration','expired-session-challenge',$2,$3,$4,$5,$5)`,
  [randomUUID(), accountId, tokenHash, older, old]);

  const report = await cleanup.run(parseHistoryCleanupPolicy({cutoffs: {
    sessions: cutoff, webauthnCeremonies: cutoff,
  }}), {apply: true});

  assert.equal(report.categories.webauthnCeremonies?.deleted, 1);
  assert.equal(report.categories.sessions?.deleted, 1);
  assert.equal(await count('cloud_webauthn_ceremonies'), 0);
  assert.equal(await count('cloud_sessions'), 0);
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

  const genericOutbox = randomUUID(), alertOutbox = randomUUID(), openOutbox = randomUUID();
  const incidentId = randomUUID(), openIncidentId = randomUUID();
  await pool.query(`INSERT INTO email_outbox(id,kind,status,created_at,expires_at,available_at,finished_at)
    VALUES($1,'password_changed','sent',$4,$4,$4,$4),($2,'service_alert','sent',$4,$4,$4,$4),
      ($3,'service_alert','sent',$4,$4,$4,$4)`, [genericOutbox, alertOutbox, openOutbox, old]);
  await pool.query(`INSERT INTO venue_incidents(id,venue_id,kind,status,revision,opened_at,changed_at)
    VALUES($1,$2,'disconnected','recovered',2,$3,$3),($4,$2,'snapshot_stale','open',1,$3,$3)`,
  [incidentId, venueId, old, openIncidentId]);
  await pool.query(`INSERT INTO service_alert_deliveries(outbox_id,incident_id,revision,state,account_id)
    VALUES($1,$3,2,'recovered',$5),($2,$4,1,'open',$5)`,
  [alertOutbox, openOutbox, incidentId, openIncidentId, accountId]);

  await new UsageReconciler(pool).runOnce(100);

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
    delivery: {cutoff, eligible: 2, blocked: 1, deleted: 0, hasMore: true},
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
    operations: 1, outbox: 2, deliveries: 1, incidents: 2});
});

test('backup cleanup preserves work and references while chunks resume across workers', async () => {
  await pool.query(`INSERT INTO backup_locations(venue_id,installation_id,endpoint,bucket,region)
    VALUES($1,$2,'https://storage.example.test','history-bucket','test')`, [venueId, installationId]);
  await pool.query("INSERT INTO backup_key_versions(venue_id,version,sealed) VALUES($1,1,'sealed')", [venueId]);
  const pointA = '00000000-0000-4000-8000-000000000011';
  const protectedPoint = '00000000-0000-4000-8000-000000000012';
  const recoveredPoint = '00000000-0000-4000-8000-000000000013';
  const blockedPoint = '00000000-0000-4000-8000-000000000014';
  const node = randomUUID();
  for (const [id, deleted] of [[pointA, true], [protectedPoint, false], [recoveredPoint, true], [blockedPoint, true]] as const) {
    await pool.query(`INSERT INTO backup_captures(id,venue_id,installation_id,key_version,created_at,expired_at,cleaned_at)
      VALUES($1,$2,$3,1,$4,$5,$5)`, [id, venueId, installationId, old, deleted ? old : null]);
    await pool.query(`INSERT INTO backup_points(id,venue_id,installation_id,key_version,kind,object_key,digest,size,captured_at,retention,source_node_id,modules,verification,deleting,deleted_at)
      VALUES($1,$2,$3,1,'snapshot',$4,$5,1,$6,'daily',$7,'{}','verified',$8,$9)`,
    [id, venueId, installationId, `snapshots/${id}`, id.slice(-1).repeat(64), old, node, deleted, deleted ? old : null]);
  }
  await pool.query(`INSERT INTO backup_verifications(id,point_id,digest,verifier,outcome,checked_at)
    VALUES($1,$2,$3,'history-test','verified',$4),($5,$6,$7,'history-test','verified',$4)`,
  [randomUUID(), pointA, '1'.repeat(64), old, randomUUID(), recoveredPoint, '3'.repeat(64)]);

  const oldRecovery = randomUUID(), blockedRecovery = randomUUID(), activeRecovery = randomUUID();
  await pool.query(`INSERT INTO backup_recoveries(id,venue_id,point_id,account_id,target_public_key,mode,status,created_at,expires_at)
    VALUES($1,$2,$3,$4,'recovery-complete','failure','closed',$5,$5),
      ($6,$2,$7,$4,'recovery-blocked','failure','closed',$5,$5),
      ($8,$2,$9,$4,'recovery-active','failure','pending',$10,$10)`,
  [oldRecovery, venueId, recoveredPoint, accountId, old, blockedRecovery, blockedPoint, activeRecovery, protectedPoint, future]);
  await pool.query(`INSERT INTO backup_recovery_requests(id,public_key,code_hash,expires_at,account_id,operation_id)
    VALUES($1,'recovery-complete',$2,$3,$4,$1)`, [oldRecovery, hash('8'), old, accountId]);
  await pool.query(`INSERT INTO installation_replacements(id,venue_id,old_installation_id,public_key,peer_public_key,local_venue_id,node_id,created_at,completed_at,result)
    VALUES($1,$2,$3,'replacement-complete','peer-complete',$4,$5,$6,$6,'{}'),
      ($7,$2,$3,'replacement-incomplete','peer-incomplete',$8,$9,$6,NULL,NULL)`,
  [oldRecovery, venueId, installationId, randomUUID(), randomUUID(), old,
    blockedRecovery, randomUUID(), randomUUID()]);

  const lockedJob = '00000000-0000-4000-8000-000000000021';
  const freeJob = '00000000-0000-4000-8000-000000000022';
  await pool.query(`INSERT INTO backup_jobs(id,kind,venue_id,target_id,status,available_at,last_success_at)
    VALUES($1,'verify',$3,$4,'completed',$5,$5),($2,'verify',$3,$6,'completed',$5,$5),
      ($7,'incoming',$3,$3,'pending',$5,NULL),($8,'retention',$3,$3,'failed',$5,NULL)`,
  [lockedJob, freeJob, venueId, randomUUID(), old, randomUUID(), randomUUID(), randomUUID()]);
  await new UsageReconciler(pool).runOnce(100);
  const policy = parseHistoryCleanupPolicy({cutoffs: {
    backupJobs: cutoff, recoveryHistory: cutoff, backupTombstones: cutoff,
  }, chunkSize: 1});
  const dry = await cleanup.run(policy, {apply: false});
  assert.deepEqual(dry.categories.backupJobs, {cutoff, eligible: 2, blocked: 0, deleted: 0, hasMore: true});
  assert.deepEqual(dry.categories.recoveryHistory, {cutoff, eligible: 1, blocked: 1, deleted: 0, hasMore: true});
  assert.deepEqual(dry.categories.backupTombstones, {cutoff, eligible: 1, blocked: 2, deleted: 0, hasMore: true});

  const lock = await otherPool.connect();
  await lock.query('BEGIN');
  await lock.query('SELECT id FROM backup_jobs WHERE id=$1 FOR UPDATE', [lockedJob]);
  try {
    const first = await cleanup.run(policy, {apply: true});
    assert.equal(first.categories.backupJobs?.deleted, 1, 'the unlocked completed job is the first chunk');
    assert.equal(first.categories.recoveryHistory?.deleted, 1);
    assert.equal(first.categories.backupTombstones?.deleted, 1);
    assert.equal((await pool.query('SELECT count(*) FROM backup_jobs WHERE id=$1', [lockedJob])).rows[0].count, '1');
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
  }

  const restarted = new HistoryCleanup(pool);
  const second = await restarted.run(policy, {apply: true});
  assert.equal(second.categories.backupJobs?.deleted, 1);
  assert.equal(second.categories.recoveryHistory?.deleted, 0);
  assert.equal(second.categories.backupTombstones?.deleted, 1);
  assert.equal(await count('backup_recovery_requests'), 0);
  assert.equal((await pool.query('SELECT count(*) FROM installation_replacements WHERE id=$1', [oldRecovery])).rows[0].count, '0');
  assert.equal((await pool.query('SELECT count(*) FROM backup_recoveries WHERE id=$1', [oldRecovery])).rows[0].count, '0');
  assert.equal((await pool.query('SELECT count(*) FROM backup_recoveries WHERE id IN($1,$2)', [blockedRecovery, activeRecovery])).rows[0].count, '2');
  assert.equal((await pool.query('SELECT count(*) FROM backup_points WHERE id=ANY($1::uuid[])', [[pointA, recoveredPoint]])).rows[0].count, '0');
  assert.equal((await pool.query('SELECT count(*) FROM backup_captures WHERE id=ANY($1::uuid[])', [[pointA, recoveredPoint]])).rows[0].count, '0');
  assert.equal((await pool.query('SELECT count(*) FROM backup_points WHERE id=ANY($1::uuid[])', [[protectedPoint, blockedPoint]])).rows[0].count, '2');
  assert.equal((await pool.query("SELECT count(*) FROM backup_jobs WHERE status IN('pending','running','failed')")).rows[0].count, '2');
});

test('cleanup preserves every metered source until reconciliation records it',async()=>{
 await pool.query(`INSERT INTO backup_locations(venue_id,installation_id,endpoint,bucket,region)
  VALUES($1,$2,'https://storage.example.test','usage-guard','test')`,[venueId,installationId]);
 await pool.query("INSERT INTO backup_key_versions(venue_id,version,sealed) VALUES($1,1,'sealed')",[venueId]);
 const pointId=randomUUID(),recoveryId=randomUUID(),operationId=randomUUID(),outboxId=randomUUID(),incidentId=randomUUID();
 await pool.query(`INSERT INTO backup_captures(id,venue_id,installation_id,key_version,created_at,expired_at,cleaned_at)
  VALUES($1,$2,$3,1,$4,$4,$4)`,[pointId,venueId,installationId,old]);
 await pool.query(`INSERT INTO backup_points(id,venue_id,installation_id,key_version,kind,object_key,digest,size,captured_at,retention,source_node_id,modules,verification,deleting,deleted_at)
  VALUES($1,$2,$3,1,'snapshot',$4,$5,17,$6,'daily',$7,'{}','verified',true,$6)`,
 [pointId,venueId,installationId,`snapshots/${pointId}`,'d'.repeat(64),old,randomUUID()]);
 await pool.query(`INSERT INTO backup_recoveries(id,venue_id,point_id,account_id,target_public_key,mode,status,created_at,expires_at,restored_at)
  VALUES($1,$2,$3,$4,$5,'failure','closed',$6,$6,$6)`,[recoveryId,venueId,pointId,accountId,`usage-guard-${recoveryId}`,old]);
 await pool.query("INSERT INTO installation_operations(installation_id,operation_id,digest,result,created_at) VALUES($1,$2,'usage-guard','{}',$3)",[installationId,operationId,old]);
 await pool.query(`INSERT INTO email_outbox(id,kind,status,created_at,expires_at,available_at,finished_at)
  VALUES($1,'service_alert','sent',$2,$2,$2,$2)`,[outboxId,old]);
 await pool.query(`INSERT INTO venue_incidents(id,venue_id,kind,status,revision,opened_at,changed_at)
  VALUES($1,$2,'disconnected','recovered',2,$3,$3)`,[incidentId,venueId,old]);
 await pool.query("INSERT INTO service_alert_deliveries(outbox_id,incident_id,revision,state,account_id) VALUES($1,$2,2,'recovered',$3)",[outboxId,incidentId,accountId]);
 const policy=parseHistoryCleanupPolicy({cutoffs:{registrationOperations:cutoff,emailDeliveries:cutoff,recoveryHistory:cutoff,backupTombstones:cutoff},chunkSize:100});
 const blocked=await cleanup.run(policy,{apply:true});
 assert.deepEqual(blocked.categories.registrationOperations,{cutoff,eligible:0,blocked:1,deleted:0,hasMore:false});
 assert.deepEqual(blocked.categories.emailDeliveries,{cutoff,eligible:0,blocked:1,deleted:0,hasMore:false});
 assert.deepEqual(blocked.categories.recoveryHistory,{cutoff,eligible:0,blocked:1,deleted:0,hasMore:false});
 assert.deepEqual(blocked.categories.backupTombstones,{cutoff,eligible:0,blocked:1,deleted:0,hasMore:false});
 assert.equal(await count('usage_events'),0);
 const reconciliation=await new UsageReconciler(pool).runOnce(100);
 assert.ok(Object.values(reconciliation.sources).every(source=>source.caughtUp));
 assert.equal(await count('usage_events'),6);
 const cleaned=await cleanup.run(policy,{apply:true});
 assert.equal(cleaned.categories.registrationOperations?.deleted,1);
 assert.equal(cleaned.categories.emailDeliveries?.deleted,1);
 assert.equal(cleaned.categories.recoveryHistory?.deleted,1);
 assert.equal(cleaned.categories.backupTombstones?.deleted,1);
 assert.equal(await count('usage_events'),6);
});

test('history cleanup CLI defaults to dry-run and fails closed without exposing policy contents', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cloud-history-policy-'));
  const policyPath = join(directory, 'policy.json');
  const malformedPath = join(directory, 'private-policy.json');
  const secret = 'private-retention-decision';
  const run = (args: string[]) => execute(process.execPath, ['src/history-cleanup-cli.ts', ...args], {
    cwd: new URL('..', import.meta.url).pathname,
    env: {...process.env, DATABASE_URL: cliDatabaseUrl()},
    encoding: 'utf8',
    timeout: 10000,
  });
  try {
    await writeFile(policyPath, JSON.stringify({cutoffs: {emailDeliveries: cutoff}, chunkSize: 1}));
    await writeFile(malformedPath, `{not-json:${secret}}`);
    await pool.query(`INSERT INTO email_outbox(id,kind,status,created_at,expires_at,available_at,finished_at)
      VALUES($1,'password_changed','sent',$2,$2,$2,$2)`, [randomUUID(), old]);
    const dry = await run(['--policy', policyPath]);
    const dryReport = JSON.parse(dry.stdout);
    assert.equal(dry.stderr, '');
    assert.equal(dryReport.schemaVersion, 1);
    assert.equal(dryReport.mode, 'dry-run');
    assert.equal(dryReport.categories.emailDeliveries.deleted, 0);
    assert.equal(await count('email_outbox'), 1);

    const applied = await run(['--policy', policyPath, '--apply']);
    assert.equal(JSON.parse(applied.stdout).categories.emailDeliveries.deleted, 1);
    assert.equal(await count('email_outbox'), 0);

    for (const args of [['--policy', malformedPath], ['--policy', join(directory, 'missing.json')]]) {
      await assert.rejects(run(args), error => {
        assert.equal(typeof error, 'object');
        const result = error as {stdout: string; stderr: string};
        assert.equal(result.stdout, '');
        assert.equal(result.stderr, 'History cleanup failed; check database, migrations and policy\n');
        assert.ok(!result.stderr.includes(secret));
        return true;
      });
    }

    const migration = await pool.query("DELETE FROM schema_migrations WHERE name='021_history_cleanup.sql' RETURNING *");
    try {
      await assert.rejects(run(['--policy', policyPath]), (error: unknown) => {
        const result = error as {stdout: string; stderr: string};
        assert.equal(result.stdout, '');
        assert.equal(result.stderr, 'History cleanup failed; check database, migrations and policy\n');
        return true;
      });
    } finally {
      await pool.query('INSERT INTO schema_migrations(name,digest,applied_at) VALUES($1,$2,$3)',
        [migration.rows[0].name, migration.rows[0].digest, migration.rows[0].applied_at]);
    }
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('email cleanup skips a terminal delivery whose dependent row is worker-locked', async () => {
  const outboxId = randomUUID(), incidentId = randomUUID();
  await pool.query(`INSERT INTO email_outbox(id,kind,status,created_at,expires_at,available_at,finished_at)
    VALUES($1,'service_alert','sent',$2,$2,$2,$2)`, [outboxId, old]);
  await pool.query(`INSERT INTO venue_incidents(id,venue_id,kind,status,revision,opened_at,changed_at)
    VALUES($1,$2,'disconnected','recovered',2,$3,$3)`, [incidentId, venueId, old]);
  await pool.query(`INSERT INTO service_alert_deliveries(outbox_id,incident_id,revision,state,account_id)
    VALUES($1,$2,2,'recovered',$3)`, [outboxId, incidentId, accountId]);
  await new UsageReconciler(pool).runOnce(100);
  const worker = await otherPool.connect();
  await worker.query('BEGIN');
  await worker.query('SELECT outbox_id FROM service_alert_deliveries WHERE outbox_id=$1 FOR UPDATE', [outboxId]);
  try {
    const report = await new HistoryCleanup(racePool).run(
      parseHistoryCleanupPolicy({cutoffs: {emailDeliveries: cutoff}, chunkSize: 1}), {apply: true});
    assert.deepEqual(report.categories.emailDeliveries,
      {cutoff, eligible: 1, blocked: 0, deleted: 0, hasMore: true});
    assert.equal(await count('email_outbox'), 1);
    assert.equal(await count('service_alert_deliveries'), 1);
  } finally {
    await worker.query('ROLLBACK');
    worker.release();
  }
});

test('recovery cleanup skips a closed operation whose replacement row is worker-locked', async () => {
  await pool.query(`INSERT INTO backup_locations(venue_id,installation_id,endpoint,bucket,region)
    VALUES($1,$2,'https://storage.example.test','locked-recovery','test')`, [venueId, installationId]);
  await pool.query("INSERT INTO backup_key_versions(venue_id,version,sealed) VALUES($1,1,'sealed')", [venueId]);
  const pointId = randomUUID(), recoveryId = randomUUID();
  await pool.query(`INSERT INTO backup_captures(id,venue_id,installation_id,key_version,created_at)
    VALUES($1,$2,$3,1,$4)`, [pointId, venueId, installationId, old]);
  await pool.query(`INSERT INTO backup_points(id,venue_id,installation_id,key_version,kind,object_key,digest,size,captured_at,retention,source_node_id,modules,verification)
    VALUES($1,$2,$3,1,'snapshot',$4,$5,1,$6,'daily',$7,'{}','verified')`,
  [pointId, venueId, installationId, `snapshots/${pointId}`, 'a'.repeat(64), old, randomUUID()]);
  await pool.query(`INSERT INTO backup_recoveries(id,venue_id,point_id,account_id,target_public_key,mode,status,created_at,expires_at)
    VALUES($1,$2,$3,$4,'locked-recovery-key','failure','closed',$5,$5)`,
  [recoveryId, venueId, pointId, accountId, old]);
  await pool.query(`INSERT INTO installation_replacements(id,venue_id,old_installation_id,public_key,peer_public_key,local_venue_id,node_id,created_at,completed_at,result)
    VALUES($1,$2,$3,'locked-replacement','locked-peer',$4,$5,$6,$6,'{}')`,
  [recoveryId, venueId, installationId, randomUUID(), randomUUID(), old]);
  const worker = await otherPool.connect();
  await worker.query('BEGIN');
  await worker.query('SELECT id FROM installation_replacements WHERE id=$1 FOR UPDATE', [recoveryId]);
  try {
    const report = await new HistoryCleanup(racePool).run(
      parseHistoryCleanupPolicy({cutoffs: {recoveryHistory: cutoff}, chunkSize: 1}), {apply: true});
    assert.deepEqual(report.categories.recoveryHistory,
      {cutoff, eligible: 1, blocked: 0, deleted: 0, hasMore: true});
    assert.equal(await count('backup_recoveries'), 1);
    assert.equal(await count('installation_replacements'), 1);
  } finally {
    await worker.query('ROLLBACK');
    worker.release();
  }
});

test('tombstone cleanup skips a point whose verification row is worker-locked', async () => {
  await pool.query(`INSERT INTO backup_locations(venue_id,installation_id,endpoint,bucket,region)
    VALUES($1,$2,'https://storage.example.test','locked-tombstone','test')`, [venueId, installationId]);
  await pool.query("INSERT INTO backup_key_versions(venue_id,version,sealed) VALUES($1,1,'sealed')", [venueId]);
  const pointId = randomUUID(), verificationId = randomUUID();
  await pool.query(`INSERT INTO backup_captures(id,venue_id,installation_id,key_version,created_at,expired_at,cleaned_at)
    VALUES($1,$2,$3,1,$4,$4,$4)`, [pointId, venueId, installationId, old]);
  await pool.query(`INSERT INTO backup_points(id,venue_id,installation_id,key_version,kind,object_key,digest,size,captured_at,retention,source_node_id,modules,verification,deleting,deleted_at)
    VALUES($1,$2,$3,1,'snapshot',$4,$5,1,$6,'daily',$7,'{}','verified',true,$6)`,
  [pointId, venueId, installationId, `snapshots/${pointId}`, 'b'.repeat(64), old, randomUUID()]);
  await pool.query(`INSERT INTO backup_verifications(id,point_id,digest,verifier,outcome,checked_at)
    VALUES($1,$2,$3,'locked-verifier','verified',$4)`, [verificationId, pointId, 'b'.repeat(64), old]);
  await new UsageReconciler(pool).runOnce(100);
  const worker = await otherPool.connect();
  await worker.query('BEGIN');
  await worker.query('SELECT id FROM backup_verifications WHERE id=$1 FOR UPDATE', [verificationId]);
  try {
    const report = await new HistoryCleanup(racePool).run(
      parseHistoryCleanupPolicy({cutoffs: {backupTombstones: cutoff}, chunkSize: 1}), {apply: true});
    assert.deepEqual(report.categories.backupTombstones,
      {cutoff, eligible: 1, blocked: 0, deleted: 0, hasMore: true});
    assert.equal(await count('backup_points'), 1);
    assert.equal(await count('backup_captures'), 1);
    assert.equal(await count('backup_verifications'), 1);
  } finally {
    await worker.query('ROLLBACK');
    worker.release();
  }
});

test('tombstone cleanup cannot remove a completed job unless its category is enabled', async () => {
  await pool.query(`INSERT INTO backup_locations(venue_id,installation_id,endpoint,bucket,region)
    VALUES($1,$2,'https://storage.example.test','job-bound-tombstone','test')`, [venueId, installationId]);
  await pool.query("INSERT INTO backup_key_versions(venue_id,version,sealed) VALUES($1,1,'sealed')", [venueId]);
  const pointId = randomUUID();
  await pool.query(`INSERT INTO backup_captures(id,venue_id,installation_id,key_version,created_at,expired_at,cleaned_at)
    VALUES($1,$2,$3,1,$4,$4,$4)`, [pointId, venueId, installationId, old]);
  await pool.query(`INSERT INTO backup_points(id,venue_id,installation_id,key_version,kind,object_key,digest,size,captured_at,retention,source_node_id,modules,verification,deleting,deleted_at)
    VALUES($1,$2,$3,1,'snapshot',$4,$5,1,$6,'daily',$7,'{}','verified',true,$6)`,
  [pointId, venueId, installationId, `snapshots/${pointId}`, 'c'.repeat(64), old, randomUUID()]);
  await pool.query(`INSERT INTO backup_jobs(kind,venue_id,target_id,status,available_at,last_success_at)
    VALUES('verify',$1,$2,'completed',$3,$3)`, [venueId, pointId, old]);
  await new UsageReconciler(pool).runOnce(100);

  const tombstonesOnly = await cleanup.run(
    parseHistoryCleanupPolicy({cutoffs: {backupTombstones: cutoff}}), {apply: true});
  assert.deepEqual(tombstonesOnly.categories.backupTombstones,
    {cutoff, eligible: 0, blocked: 1, deleted: 0, hasMore: false});
  assert.equal(await count('backup_jobs'), 1);
  assert.equal(await count('backup_points'), 1);

  const authorised = await cleanup.run(
    parseHistoryCleanupPolicy({cutoffs: {backupJobs: cutoff, backupTombstones: cutoff}}), {apply: true});
  assert.equal(authorised.categories.backupJobs?.deleted, 1);
  assert.equal(authorised.categories.backupTombstones?.deleted, 1);
  assert.equal(await count('backup_jobs'), 0);
  assert.equal(await count('backup_points'), 0);
});
