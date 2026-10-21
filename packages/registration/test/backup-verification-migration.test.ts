import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {after, before, test} from 'node:test';
import {Pool, type PoolClient} from 'pg';
import {migrate, migrationNames} from '../src/migrate.ts';
import {backupVerificationRequestDigest, backupVerificationTargetDigests, type BackupVerificationRequest, type BackupVerificationResult} from '../../backups/src/verification-protocol.ts';

const admin = new Pool({connectionString: process.env.TEST_DATABASE_URL});
const schema = `verification_${randomUUID().replaceAll('-', '')}`;
const pool = new Pool({connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}`});
const target = JSON.parse(await readFile(new URL('../../../deploy/backup-verifier/target.json', import.meta.url), 'utf8'));
const image = `local/waitron@sha256:${'2'.repeat(64)}`;
before(async () => {await admin.query(`CREATE SCHEMA ${schema}`); await migrate(pool);});
after(async () => {await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();});

async function legacyMigrate(p: Pool) {
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,digest text NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp())');
    for (const name of migrationNames.slice(0, 42)) {
      const sql = await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name,digest) VALUES($1,$2)', [name, createHash('sha256').update(sql).digest('hex')]);
    }
    await client.query('COMMIT');
  } finally {await client.query('ROLLBACK'); client.release();}
}

async function seed(client: PoolClient) {
  const organisation = randomUUID(), business = randomUUID(), venue = randomUUID(), installation = randomUUID();
  const account = randomUUID(), node = randomUUID(), point = randomUUID(), job = randomUUID();
  const capturedAt = '2026-10-20T08:00:00.000Z', digest = '1'.repeat(64), modules = {core: 3};
  await client.query('INSERT INTO cloud_accounts(id) VALUES($1)', [account]);
  await client.query('INSERT INTO organisations(id) VALUES($1)', [organisation]);
  await client.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)', [business, organisation]);
  await client.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,'test')", [venue, organisation, business, randomUUID()]);
  await client.query('INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,$3)', [installation, venue, randomUUID()]);
  await client.query("INSERT INTO backup_locations(venue_id,installation_id,endpoint,bucket,region) VALUES($1,$2,'https://storage.test',$3,'test')", [venue, installation, venue]);
  await client.query("INSERT INTO backup_key_versions(venue_id,version,sealed) VALUES($1,1,'sealed-archive-key')", [venue]);
  await client.query('INSERT INTO backup_captures(id,venue_id,installation_id,key_version) VALUES($1,$2,$3,1)', [point, venue, installation]);
  await client.query(`INSERT INTO backup_points(id,venue_id,installation_id,key_version,kind,object_key,digest,size,captured_at,retention,source_node_id,modules)
    VALUES($1,$2,$3,1,'snapshot',$4,$5,42,$6,'daily',$7,$8)`, [point, venue, installation, `snapshots/${point}`, digest, capturedAt, node, modules]);
  await client.query("INSERT INTO backup_jobs(id,kind,venue_id,target_id) VALUES($1,'verify',$2,$3)", [job, venue, point]);
  return {point, venue, installation, account, node, job, capturedAt, digest, modules};
}

async function fixture() {
  assert.notEqual((await pool.query("SELECT to_regclass('backup_point_qualification') AS relation")).rows[0].relation, null,
    'the new migration must supply current qualification independently of the historical ledger');
  const c = await pool.connect(); await c.query('BEGIN');
  const f = await seed(c);
  return {...f, c, async close() {await c.query('ROLLBACK'); c.release();}};
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function policy(f: Fixture, ready = true) {
  await f.c.query('UPDATE backup_verification_policy SET revision=1,target=$1,verifier_image=$2,release_ready=$3 WHERE id=1', [target, image, ready]);
}
async function qualification(f: Fixture) {
  return (await f.c.query('SELECT current_verification,qualified_target_digest,verification_id,last_reason FROM backup_point_qualification WHERE point_id=$1', [f.point])).rows[0];
}
function requestFor(f: Fixture): BackupVerificationRequest {
  return {protocol: 'backup-data-restore/v1', captureId: f.point, pointId: f.point, venueId: f.venue,
    sourceInstallationId: f.installation, sourceNodeId: f.node, capturedAt: f.capturedAt,
    archive: {sha256: f.digest, bytes: 42, manifestVersion: 1, environment: 'preproduction', modules: f.modules},
    backupKey: {version: 1, reference: `cloud-backup:${f.venue}:1`}, target: structuredClone(target), verifierImage: image,
    attempt: {jobId: f.job, number: 1, claimId: randomUUID(), controllerScope: 'controller-fixture', childToken: randomUUID(), deadline: '2026-10-20T08:00:30.000Z'}};
}
function passed(request: BackupVerificationRequest): BackupVerificationResult {
  return {protocol: request.protocol, requestDigest: backupVerificationRequestDigest(request), attemptToken: request.attempt.childToken,
    measuredArchive: {sha256: request.archive.sha256, bytes: request.archive.bytes}, targetDigest: target.digest, policyDigest: target.policyDigest,
    modules: target.modules.map((m: {name: string; semanticsVersion: number}) => ({name: m.name, semanticsVersion: m.semanticsVersion,
      status: 'passed', checks: [{code: 'data', status: 'passed'}]})), status: 'passed', reason: 'none', activation: 'not_attempted'};
}
async function evidence(f: Fixture, options: {request?: BackupVerificationRequest; result?: BackupVerificationResult | null; status?: string; reason?: string; cleanup?: boolean; admitted?: boolean; state?: string} = {}) {
  const request = options.request ?? requestFor(f), id = randomUUID();
  const result = options.result === undefined ? passed(request) : options.result;
  const metadata = {objectKey: `snapshots/${f.point}`, retention: 'daily', venueId: f.venue, installationId: f.installation,
    keyVersion: 1, digest: f.digest, size: 42, capturedAt: f.capturedAt, sourceNodeId: f.node, modules: f.modules};
  const finished = options.state !== 'running';
  await f.c.query(`INSERT INTO backup_verification_attempts(id,point_id,job_id,protocol,request,request_digest,point_metadata,
    target_digest,policy_revision,verifier_image,claim_id,attempt_number,controller_scope,child_token,deadline,
    state,status,reason,result,child_id,cleanup_confirmed,finished_at,admitted_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
  [id, f.point, f.job, request.protocol, request, backupVerificationRequestDigest(request), metadata, request.target.digest,
    request.verifierImage, request.attempt.claimId, request.attempt.number, request.attempt.controllerScope, request.attempt.childToken,
    request.attempt.deadline, options.state ?? 'finished', finished ? options.status ?? 'passed' : null,
    finished ? options.reason ?? 'none' : null, finished ? result : null, finished && result ? 'child-fixture' : null,
    finished && (options.cleanup ?? true), finished ? new Date('2026-10-20T08:00:20.000Z') : null,
    finished && options.admitted !== false ? new Date('2026-10-20T08:00:21.000Z') : null]);
  return {id, request, result};
}
async function pointAt(f: Fixture, id: string) {
  await f.c.query('UPDATE backup_points SET current_evidence_id=$2,last_attempt_id=$2 WHERE id=$1', [f.point, id]);
}
async function rejected(f: Fixture, run: () => Promise<unknown>, codes = ['23514', '23502', '23503', '23505', '55000']) {
  await f.c.query('SAVEPOINT rejected');
  try {await assert.rejects(run, (e: {code?: string}) => codes.includes(e.code ?? ''));}
  finally {await f.c.query('ROLLBACK TO SAVEPOINT rejected'); await f.c.query('RELEASE SAVEPOINT rejected');}
}

test('upgrade_legacy_success_is_protected_but_not_current', async () => {
  const name = `legacy_verification_${randomUUID().replaceAll('-', '')}`;
  const p = new Pool({connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${name}`});
  await admin.query(`CREATE SCHEMA ${name}`);
  try {
    await legacyMigrate(p); const c = await p.connect(); const f = await seed(c);
    await c.query("INSERT INTO backup_recoveries(id,venue_id,point_id,account_id,target_public_key,mode) VALUES($1,$2,$3,$4,$5,'failure')", [randomUUID(), f.venue, f.point, f.account, randomUUID()]);
    await c.query('INSERT INTO backup_recovery_requests(id,public_key,code_hash) VALUES($1,$2,$3)', [randomUUID(), randomUUID(), '5'.repeat(64)]);
    const oldTables = (await c.query('SELECT tablename FROM pg_tables WHERE schemaname=current_schema() ORDER BY tablename')).rows.map(row => row.tablename as string);
    async function allOldRows() {
      const rows: Record<string, unknown> = {};
      for (const name of oldTables) rows[name] = (await p.query(`SELECT to_jsonb(t)-ARRAY['current_evidence_id','last_attempt_id','protocol_version','verification_target','verification_attempt_id'] AS row FROM "${name}" t ORDER BY 1`)).rows;
      delete rows.schema_migrations;
      return rows;
    }
    await c.query("UPDATE backup_points SET verification='verified' WHERE id=$1", [f.point]);
    await c.query("INSERT INTO backup_verifications(id,point_id,digest,verifier,outcome) VALUES($1,$2,$3,'legacy','verified')", [randomUUID(), f.point, f.digest]);
    const before = (await c.query(`SELECT to_jsonb(p) AS point,(SELECT jsonb_agg(to_jsonb(v)) FROM backup_verifications v) AS history,
      (SELECT jsonb_agg(to_jsonb(k)) FROM backup_key_versions k) AS keys FROM backup_points p`)).rows;
    c.release(); const allBefore = await allOldRows(); await migrate(p);
    assert.notEqual((await p.query("SELECT to_regclass('backup_point_qualification') AS relation")).rows[0].relation, null, '043 supplies a fail-closed current view');
    assert.deepEqual((await p.query(`SELECT to_jsonb(p)-'current_evidence_id'-'last_attempt_id' AS point,
      (SELECT jsonb_agg(to_jsonb(v)) FROM backup_verifications v) AS history,
      (SELECT jsonb_agg(to_jsonb(k)) FROM backup_key_versions k) AS keys FROM backup_points p`)).rows, before);
    assert.deepEqual((await p.query('SELECT current_evidence_id,last_attempt_id FROM backup_points')).rows, [{current_evidence_id: null, last_attempt_id: null}]);
    assert.equal((await p.query('SELECT current_verification FROM backup_point_qualification')).rows[0].current_verification, 'pending');
    assert.equal((await p.query("SELECT EXISTS(SELECT 1 FROM backup_verifications WHERE point_id=$1 AND outcome='verified') AS protected", [f.point])).rows[0].protected, true);
    assert.deepEqual(await allOldRows(), allBefore, 'the additive migration preserves every pre-existing stored row and ciphertext');
    assert.deepEqual((await p.query('SELECT protocol_version,verification_target FROM backup_recovery_requests')).rows, [{protocol_version: null, verification_target: null}]);
    assert.deepEqual((await p.query('SELECT verification_attempt_id,verification_target FROM backup_recoveries')).rows, [{verification_attempt_id: null, verification_target: null}]);
  } finally {await p.end(); await admin.query(`DROP SCHEMA ${name} CASCADE`);}
});

test('empty_policy_is_fail_closed', async () => {
  const f = await fixture(); try {
    assert.deepEqual((await f.c.query('SELECT * FROM backup_verification_policy')).rows, [{id: 1, revision: '0', target: null, verifier_image: null, release_ready: false}]);
    assert.deepEqual(await qualification(f), {current_verification: 'pending', qualified_target_digest: null, verification_id: null, last_reason: null});
    await rejected(f, () => f.c.query('UPDATE backup_verification_policy SET release_ready=true'));
    await rejected(f, () => f.c.query('INSERT INTO backup_verification_policy(id) VALUES(2)'));
  } finally {await f.close();}
});

test('complete_admitted_passed_evidence_qualifies_only_after_release', async () => {
  const f = await fixture(); try {
    await policy(f, false); const e = await evidence(f); await pointAt(f, e.id);
    assert.equal((await qualification(f)).current_verification, 'pending');
    await f.c.query('UPDATE backup_verification_policy SET release_ready=true');
    assert.deepEqual(await qualification(f), {current_verification: 'verified', qualified_target_digest: target.digest, verification_id: e.id, last_reason: 'none'});
  } finally {await f.close();}
});

for (const [label, sql] of [
  ['policy revision', 'UPDATE backup_verification_policy SET revision=2'],
  ['policy image', `UPDATE backup_verification_policy SET verifier_image='other/waitron@sha256:${'3'.repeat(64)}'`],
  ['release gate', 'UPDATE backup_verification_policy SET release_ready=false'],
  ['deleting', 'UPDATE backup_points SET deleting=true'], ['deleted', 'UPDATE backup_points SET deleted_at=clock_timestamp()'],
  ['continuous', "UPDATE backup_points SET kind='continuous'"],
  ['digest', `UPDATE backup_points SET digest='${'4'.repeat(64)}'`], ['size', 'UPDATE backup_points SET size=43'],
  ['key', 'UPDATE backup_points SET key_version=2'], ['object', "UPDATE backup_points SET object_key='other-object'"],
  ['retention', "UPDATE backup_points SET retention='monthly'"], ['capture time', "UPDATE backup_points SET captured_at=captured_at+interval '1 second'"],
  ['source node', 'UPDATE backup_points SET source_node_id=gen_random_uuid()'], ['modules', "UPDATE backup_points SET modules='{}'"],
  ['capture identity', 'UPDATE backup_captures SET installation_id=$1'],
] as const) test(`current_qualification_rechecks_${label.replaceAll(' ', '_')}`, async () => {
  const f = await fixture(); try {
    await policy(f); const e = await evidence(f); await pointAt(f, e.id);
    assert.equal((await qualification(f)).current_verification, 'verified');
    await f.c.query("INSERT INTO backup_key_versions(venue_id,version,sealed) VALUES($1,2,'retained-old-key')", [f.venue]);
    const other = await seed(f.c);
    const parameters = sql.includes('$1') ? [other.installation, f.point] : [f.point];
    await f.c.query(sql + (sql.includes('backup_verification_policy') ? '' : ` WHERE id=$${parameters.length}`), sql.includes('backup_verification_policy') ? [] : parameters);
    assert.deepEqual({...await qualification(f), last_reason: null}, {current_verification: 'pending', qualified_target_digest: null, verification_id: null, last_reason: null});
  } finally {await f.close();}
});

test('malformed_evidence_cannot_qualify', async () => {
  const f = await fixture(); try {
    await policy(f);
    for (const change of [
      (r: BackupVerificationResult) => {r.activation = 'attempted' as never;},
      (r: BackupVerificationResult) => {r.requestDigest = 'a'.repeat(64);},
      (r: BackupVerificationResult) => {r.attemptToken = 'foreign-child';},
      (r: BackupVerificationResult) => {r.targetDigest = 'b'.repeat(64);},
      (r: BackupVerificationResult) => {r.policyDigest = 'c'.repeat(64);},
      (r: BackupVerificationResult) => {r.measuredArchive!.bytes++;},
      (r: BackupVerificationResult) => {r.measuredArchive!.sha256 = 'd'.repeat(64);},
      (r: BackupVerificationResult) => {r.measuredArchive = null;},
      (r: BackupVerificationResult) => {r.modules = [];},
      (r: BackupVerificationResult) => {r.modules = [...r.modules, r.modules[0]!];},
      (r: BackupVerificationResult) => {r.modules = [{...r.modules[0]!, semanticsVersion: 999}, ...r.modules.slice(1)];},
      (r: BackupVerificationResult) => {r.modules = [{...r.modules[0]!, status: 'unsupported'}, ...r.modules.slice(1)];},
      (r: BackupVerificationResult) => {r.modules = [{...r.modules[0]!, checks: []}, ...r.modules.slice(1)];},
      (r: BackupVerificationResult) => {r.modules = [{...r.modules[0]!, checks: [{code: 'data', status: 'invalid'}]}, ...r.modules.slice(1)];},
      (r: BackupVerificationResult) => {r.modules = [{...r.modules[0]!, checks: [{code: 'data', status: 'passed'}, {code: 'data', status: 'passed'}]}, ...r.modules.slice(1)];},
      (r: BackupVerificationResult) => {r.modules = [{...r.modules[0]!, checks: [{code: 'invented' as never, status: 'passed'}]}, ...r.modules.slice(1)];},
    ]) {
      const request = requestFor(f), result = passed(request); change(result);
      // Rejecting storage or withholding qualification are both safe; a malformed result must never be current.
      await f.c.query('SAVEPOINT malformed');
      try {
        const e = await evidence(f, {request, result}); await pointAt(f, e.id);
        assert.equal((await qualification(f)).current_verification, 'pending');
      } catch (error) {if ((error as {code?: string}).code !== '23514') throw error;}
      finally {await f.c.query('ROLLBACK TO SAVEPOINT malformed'); await f.c.query('RELEASE SAVEPOINT malformed');}
    }
    await rejected(f, () => evidence(f, {result: null}));
    await rejected(f, () => evidence(f, {cleanup: false}));
    await rejected(f, () => evidence(f, {status: 'unavailable', reason: 'free-form-error', result: null}));
    await rejected(f, () => f.c.query("UPDATE backup_verification_policy SET target='{}'"));
  } finally {await f.close();}
});

test('stored_request_bindings_cannot_be_substituted', async () => {
  const f = await fixture(); try {
    await policy(f);
    for (const mutate of [
      (r: BackupVerificationRequest) => {r.venueId = randomUUID();},
      (r: BackupVerificationRequest) => {r.sourceInstallationId = randomUUID();},
      (r: BackupVerificationRequest) => {r.sourceNodeId = randomUUID();},
      (r: BackupVerificationRequest) => {r.capturedAt = '2026-10-20T07:00:00.000Z';},
      (r: BackupVerificationRequest) => {r.archive.sha256 = 'a'.repeat(64);},
      (r: BackupVerificationRequest) => {r.archive.bytes = 43;},
      (r: BackupVerificationRequest) => {r.archive.modules = {};},
      (r: BackupVerificationRequest) => {r.archive.manifestVersion = 2;},
      (r: BackupVerificationRequest) => {r.archive.environment = 'production';},
      (r: BackupVerificationRequest) => {r.backupKey.version = 2;},
      (r: BackupVerificationRequest) => {r.backupKey.reference = 'foreign-key';},
    ]) {
      const request = requestFor(f); mutate(request);
      const e = await evidence(f, {request}); await pointAt(f, e.id);
      assert.equal((await qualification(f)).current_verification, 'pending');
    }
    const request = requestFor(f); const e = await evidence(f, {request}); await pointAt(f, e.id);
    assert.equal((await qualification(f)).current_verification, 'verified');
  } finally {await f.close();}
});

test('incomplete_policy_target_never_opens_the_release_gate', async () => {
  const f = await fixture(); try {
    for (const mutate of [
      (t: typeof target) => {delete t.runtime;}, (t: typeof target) => {t.version = 2;},
      (t: typeof target) => {delete t.runtime.fingerprint;}, (t: typeof target) => {t.runtime.revision = 'unversioned';},
      (t: typeof target) => {t.runtime.release = '';}, (t: typeof target) => {t.digest = 'not-a-digest';},
      (t: typeof target) => {delete t.compositionDigest;}, (t: typeof target) => {delete t.migrationDigest;},
      (t: typeof target) => {delete t.policyDigest;}, (t: typeof target) => {t.modules = [];},
      (t: typeof target) => {t.runtime.revision = Number('1'.repeat(40));},
      (t: typeof target) => {t.digest = BigInt('1'.repeat(64)).toString(); t.digest = JSON.parse(t.digest);},
      (t: typeof target) => {t.modules = {};}, (t: typeof target) => {t.modules[0].unexpected = 'secret';},
      (t: typeof target) => {t.modules[0].name = 'Bad Name';}, (t: typeof target) => {t.modules[0].packageVersion = '';},
      (t: typeof target) => {t.modules[0].name = 'bad_name';},
      (t: typeof target) => {t.modules[0].schema = -1;}, (t: typeof target) => {t.modules[0].semanticsVersion = 0;},
      (t: typeof target) => {t.modules[0].schema = 1.5;}, (t: typeof target) => {t.modules[0].schema = 9007199254740992;},
      (t: typeof target) => {t.modules[0].migrationTable = '';}, (t: typeof target) => {t.modules[0].migrationDigest = 'bad';},
      (t: typeof target) => {t.modules[0].migrationTable = 'not_a_migration_table';},
      (t: typeof target) => {t.modules[0].policyDigest = 'bad';}, (t: typeof target) => {t.modules[0].requires = [];},
      (t: typeof target) => {t.modules[1].name = t.modules[0].name;},
      (t: typeof target) => {t.modules[1].migrationTable = t.modules[0].migrationTable;},
      (t: typeof target) => {t.modules[0].requires = {missing_owner: '1.0.0'};},
      (t: typeof target) => {t.modules[0].requires = {[t.modules[1].name]: ''};},
    ]) {
      const bad = structuredClone(target); mutate(bad);
      await rejected(f, () => f.c.query('UPDATE backup_verification_policy SET revision=1,target=$1,verifier_image=$2,release_ready=true', [bad, image]));
    }
    await policy(f); const e = await evidence(f); await pointAt(f, e.id);
    assert.equal((await qualification(f)).current_verification, 'verified');
    const changed = structuredClone(target); changed.runtime.release += '-changed';
    await f.c.query('UPDATE backup_verification_policy SET target=$1', [changed]);
    assert.equal((await qualification(f)).current_verification, 'pending', 'the entire descriptor is bound, even if its digest field is copied');
  } finally {await f.close();}
});

test('complete_wire_target_can_use_spaced_ranges_and_long_migration_table_names', async () => {
  const f = await fixture(); try {
    const descriptor = structuredClone(target);
    descriptor.modules[0].requires = {[descriptor.modules[1].name]: '>=1.0.0 <2.0.0'};
    descriptor.modules[0].migrationTable = '__' + 'a'.repeat(254);
    Object.assign(descriptor, backupVerificationTargetDigests(descriptor));
    await f.c.query('UPDATE backup_verification_policy SET revision=1,target=$1,verifier_image=$2 WHERE id=1', [descriptor, image]);
    assert.equal((await f.c.query('SELECT target FROM backup_verification_policy')).rows[0].target.digest, descriptor.digest);
    assert.equal((await qualification(f)).current_verification, 'pending');
  } finally {await f.close();}
});

test('admitted_success_cannot_survive_a_later_inconclusive_attempt', async () => {
  const f = await fixture(); try {
    await policy(f); const e = await evidence(f); await pointAt(f, e.id);
    const unavailable = await evidence(f, {result: null, status: 'unavailable', reason: 'secret_unavailable'});
    await f.c.query('UPDATE backup_points SET last_attempt_id=$2 WHERE id=$1', [f.point, unavailable.id]);
    assert.deepEqual(await qualification(f), {current_verification: 'pending', qualified_target_digest: null, verification_id: null, last_reason: 'secret_unavailable'});
  } finally {await f.close();}
});

test('running_binding_can_finish_once_without_mutating_its_identity', async () => {
  const f = await fixture(); try {
    await policy(f); const e = await evidence(f, {state: 'running'});
    await f.c.query(`UPDATE backup_verification_attempts SET state='finished',status='passed',reason='none',result=$2,
      child_id='owned-child',cleanup_confirmed=true,finished_at='2026-10-20T08:00:20Z',admitted_at='2026-10-20T08:00:21Z' WHERE id=$1`, [e.id, passed(e.request)]);
    await pointAt(f, e.id);
    assert.equal((await qualification(f)).current_verification, 'verified');
    await rejected(f, () => f.c.query('UPDATE backup_verification_attempts SET admitted_at=clock_timestamp() WHERE id=$1', [e.id]));
  } finally {await f.close();}
});

test('inconclusive_attempt_does_not_turn_a_point_into_an_integrity_failure', async () => {
  const f = await fixture(); try {
    await policy(f);
    for (const [status, reason] of [['unavailable', 'secret_unavailable'], ['unsupported', 'module_missing'], ['needs_authority', 'module_data_check_requires_authority']] as const) {
      const request = requestFor(f), result = passed(request); result.status = status; result.reason = reason;
      const e = await evidence(f, {request, result: status === 'unavailable' ? null : result, status, reason});
      await pointAt(f, e.id);
      assert.deepEqual(await qualification(f), {current_verification: 'pending', qualified_target_digest: null, verification_id: null, last_reason: reason});
    }
  } finally {await f.close();}
});

test('replay_is_unique_and_point_pointers_cannot_cross_points', async () => {
  const f = await fixture(); try {
    await policy(f); const request = requestFor(f), e = await evidence(f, {request});
    await rejected(f, () => evidence(f, {request}), ['23505']);
    const sameClaim = structuredClone(request); sameClaim.attempt.childToken = randomUUID(); sameClaim.attempt.number++;
    await rejected(f, () => evidence(f, {request: sameClaim}), ['23505']);
    const otherRequest = requestFor(f); otherRequest.attempt.childToken = request.attempt.childToken;
    await rejected(f, () => evidence(f, {request: otherRequest}), ['23505']);
    const other = await seed(f.c);
    for (const field of ['current_evidence_id', 'last_attempt_id']) await rejected(f,
      () => f.c.query(`UPDATE backup_points SET ${field}=$2 WHERE id=$1`, [other.point, e.id]), ['23503']);
  } finally {await f.close();}
});

test('unavailable_is_separate_from_history_and_preserves_prior_invalid', async () => {
  const f = await fixture(); try {
    await policy(f); const request = requestFor(f), result = passed(request);
    result.status = 'invalid'; result.reason = 'module_integrity';
    result.modules = [{...result.modules[0]!, status: 'invalid', checks: [{code: 'data', status: 'invalid'}]}, ...result.modules.slice(1)];
    const invalid = await evidence(f, {request, result, status: 'invalid', reason: 'module_integrity'}); await pointAt(f, invalid.id);
    assert.equal((await qualification(f)).current_verification, 'failed');
    const unavailable = await evidence(f, {result: null, status: 'unavailable', reason: 'cleanup_uncertain', cleanup: false});
    await f.c.query('UPDATE backup_points SET last_attempt_id=$2 WHERE id=$1', [f.point, unavailable.id]);
    assert.deepEqual(await qualification(f), {current_verification: 'failed', qualified_target_digest: null, verification_id: invalid.id, last_reason: 'cleanup_uncertain'});
    assert.equal((await f.c.query('SELECT count(*) FROM backup_verifications WHERE point_id=$1', [f.point])).rows[0].count, '0');
    await f.c.query('UPDATE backup_verification_policy SET revision=2,release_ready=false');
    assert.equal((await qualification(f)).current_verification, 'failed', 'inconclusive or a policy switch never clears a deterministic integrity failure');
  } finally {await f.close();}
});

test('running_or_unadmitted_evidence_is_not_a_verdict', async () => {
  const f = await fixture(); try {
    await policy(f); const running = await evidence(f, {state: 'running'}); await pointAt(f, running.id);
    assert.equal((await qualification(f)).current_verification, 'pending');
    const finished = await evidence(f, {admitted: false}); await pointAt(f, finished.id);
    assert.equal((await qualification(f)).current_verification, 'pending');
    assert.equal((await qualification(f)).last_reason, null, 'unadmitted output supplies no current reason');
    await rejected(f, () => f.c.query("UPDATE backup_verification_attempts SET status='passed' WHERE id=$1", [running.id]));
  } finally {await f.close();}
});

test('partial_attempt_rows_and_secret_transport_cannot_be_stored_as_evidence', async () => {
  const f = await fixture(); try {
    await policy(f); const running = await evidence(f, {state: 'running'});
    const original = (await f.c.query('SELECT to_jsonb(a) AS row FROM backup_verification_attempts a WHERE id=$1', [running.id])).rows[0].row;
    function draft() {
      const row = structuredClone(original); row.id = randomUUID(); row.claim_id = randomUUID(); row.child_token = randomUUID();
      row.request.attempt.claimId = row.claim_id; row.request.attempt.childToken = row.child_token;
      row.request_digest = backupVerificationRequestDigest(row.request);
      return row;
    }
    async function insert(row: typeof original) {
      return f.c.query('INSERT INTO backup_verification_attempts SELECT * FROM jsonb_populate_record(NULL::backup_verification_attempts,$1::jsonb)', [row]);
    }
    await insert(draft());
    for (const change of [
      (row: typeof original) => {row.request.captureId = randomUUID();},
      (row: typeof original) => {row.request.pointId = randomUUID();},
      (row: typeof original) => {row.request.verifierImage = `other/waitron@sha256:${'3'.repeat(64)}`;},
      (row: typeof original) => {row.target_digest = 'a'.repeat(64);},
      (row: typeof original) => {row.request.attempt.jobId = randomUUID();},
      (row: typeof original) => {row.request.attempt.claimId = randomUUID();},
      (row: typeof original) => {row.attempt_number++;},
      (row: typeof original) => {row.controller_scope = 'other-scope';},
      (row: typeof original) => {row.request.attempt.childToken = randomUUID();},
      (row: typeof original) => {row.request.attempt.deadline = '2026-10-20T08:00:31.000Z';},
      (row: typeof original) => {row.request.recoveryKey = 'synthetic-secret-never-transport-in-evidence';},
      (row: typeof original) => {row.request.backupKey.secret = 'synthetic-secret';},
      (row: typeof original) => {row.request.archive.secret = 'synthetic-secret';},
      (row: typeof original) => {row.request.attempt.secret = 'synthetic-secret';},
      (row: typeof original) => {row.point_metadata.secret = 'synthetic-secret';},
      (row: typeof original) => {row.state = 'finished';},
      (row: typeof original) => {row.cleanup_confirmed = true;},
      (row: typeof original) => {row.status = 'passed';},
    ]) {
      const row = draft(); change(row); await rejected(f, () => insert(row));
    }
  } finally {await f.close();}
});

test('bound_identity_and_finished_evidence_are_immutable', async () => {
  const f = await fixture(); try {
    await policy(f); const running = await evidence(f, {state: 'running'});
    await rejected(f, () => f.c.query('UPDATE backup_verification_attempts SET policy_revision=2 WHERE id=$1', [running.id]));
    const e = await evidence(f);
    for (const change of ["reason='unexpected'", "request='{}'", 'cleanup_confirmed=false', "state='running',status=NULL,reason=NULL,result=NULL,finished_at=NULL,admitted_at=NULL,child_id=NULL,cleanup_confirmed=false"])
      await rejected(f, () => f.c.query(`UPDATE backup_verification_attempts SET ${change} WHERE id=$1`, [e.id]));
  } finally {await f.close();}
});

test('old_recovery_has_no_v2_identity', async () => {
  const f = await fixture(); try {
    const id = randomUUID();
    await f.c.query("INSERT INTO backup_recoveries(id,venue_id,point_id,account_id,target_public_key,mode) VALUES($1,$2,$3,$4,$5,'failure')", [id, f.venue, f.point, f.account, randomUUID()]);
    await f.c.query('INSERT INTO backup_recovery_requests(id,public_key,code_hash) VALUES($1,$2,$3)', [randomUUID(), randomUUID(), '5'.repeat(64)]);
    assert.deepEqual((await f.c.query('SELECT protocol_version,verification_target FROM backup_recovery_requests')).rows, [{protocol_version: null, verification_target: null}]);
    assert.deepEqual((await f.c.query('SELECT verification_attempt_id,verification_target FROM backup_recoveries')).rows, [{verification_attempt_id: null, verification_target: null}]);
    await rejected(f, () => f.c.query('UPDATE backup_recovery_requests SET protocol_version=2'));
    await rejected(f, () => f.c.query('UPDATE backup_recoveries SET verification_target=$1', [target]));
    await policy(f); const e = await evidence(f); const other = await seed(f.c);
    await rejected(f, () => f.c.query('UPDATE backup_recoveries SET point_id=$2,verification_attempt_id=$3,verification_target=$4 WHERE id=$1', [id, other.point, e.id, target]), ['23503']);
  } finally {await f.close();}
});

test('concurrent_upgrade_is_once_and_applied_sql_unchanged', async () => {
  assert.equal(migrationNames.at(-1), '043_backup_target_verification.sql', 'the release must include the additive migration');
  const name = `concurrent_verification_${randomUUID().replaceAll('-', '')}`;
  const p = new Pool({connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${name}`});
  await admin.query(`CREATE SCHEMA ${name}`);
  try {
    await legacyMigrate(p); const before = (await p.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
    await Promise.all([migrate(p), migrate(p)]); await migrate(p);
    const rows = (await p.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
    assert.equal(rows.length, 43); assert.deepEqual(rows.slice(0, 42), before);
    assert.equal((await p.query('SELECT count(*) FROM backup_verification_policy')).rows[0].count, '1');
    await p.query("UPDATE schema_migrations SET digest='changed' WHERE name='043_backup_target_verification.sql'");
    await assert.rejects(migrate(p), /Applied migration has changed: 043_backup_target_verification.sql/);
  } finally {await p.end(); await admin.query(`DROP SCHEMA ${name} CASCADE`);}
});
