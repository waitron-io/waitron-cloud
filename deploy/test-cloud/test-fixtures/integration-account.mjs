import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {loadRuntime} from '../../local-stack/runtime.mjs';
import {Agent} from 'node:https';
import {readFile} from 'node:fs/promises';
import {inspectIntegrationSnapshot} from './integration-snapshot-evidence.mjs';
import {openTestCaptureRuntime} from '../service-runtime.mjs';
import {BackupCatalogue} from '../../../packages/backups/src/catalogue.ts';
import {setVerificationPolicy} from '../../../packages/backups/src/verification-admission.ts';
import {transaction} from '../../../packages/registration/src/transaction.ts';
import {inspectIntegrationVerification} from './integration-verification-evidence.mjs';
const {Pool} = createRequire(new URL('../../../packages/registration/package.json', import.meta.url))('pg');
const {S3Client, CreateBucketCommand} = createRequire(new URL('../../../packages/backups/package.json', import.meta.url))('@aws-sdk/client-s3');
let input = '';
for await (const part of process.stdin) {input += part; assert.ok(input.length < 16384);}
const {organisationId, plan, installationId, phase, pointId, sha256, bytes, sourceNodeId, image} = JSON.parse(input);
const config = await loadRuntime('/run/local-stack');
const pool = new Pool({connectionString: `postgres://${config.database.user}:${config.database.password}@postgres:5432/${config.database.name}`, connectionTimeoutMillis: 5000, statement_timeout: 10000});
try {
  if (!installationId) {
    assert.ok(plan === 'free' || plan === 'paid');
    const args = plan === 'paid' ? ['set', '--organisation', organisationId, '--plan', 'paid'] : ['show', '--organisation', organisationId];
    const {stdout} = await promisify(execFile)(process.execPath, ['packages/registration/src/organisation-plan-cli.ts', ...args], {
      env: {...process.env, CLOUD_TEST_SERVICE_PLANS: '1', DATABASE_URL: `postgres://${config.database.user}:${config.database.password}@postgres:5432/${config.database.name}`}, timeout: 15000, maxBuffer: 16384,
    });
    const result = JSON.parse(stdout);
    assert.equal(result.plan, plan);
    console.log(JSON.stringify(result));
  } else {
    const {rows} = await pool.query('SELECT v.organisation_id,v.local_venue_id,i.venue_id FROM installations i JOIN venues v ON v.id=i.venue_id WHERE i.id=$1', [installationId]);
    assert.equal(rows.length, 1); assert.equal(rows[0].organisation_id, organisationId);
    if (phase === 'configure-verification' || phase === 'inspect-verification') {
      assert.match(image ?? '', /^sha256:[a-f0-9]{64}$/);
      const target = JSON.parse(await readFile(new URL('../../backup-verifier/target.json', import.meta.url), 'utf8'));
      if (phase === 'configure-verification') {
        // Only the disposable proof database qualifies this target; deployment remains disabled.
        await transaction(pool, client => setVerificationPolicy(client, target, 'local.waitron-verifier@' + image, true));
        console.log(JSON.stringify({configured: true}));
      } else {
        const point = (await pool.query('SELECT * FROM backup_points WHERE id=$1 AND installation_id=$2 AND venue_id=$3', [pointId, installationId, rows[0].venue_id])).rows[0];
        assert.ok(point, 'integration.verification_point_missing');
        const attempt = (await pool.query('SELECT a.*,q.current_verification FROM backup_verification_attempts a JOIN backup_point_qualification q ON q.verification_id=a.id WHERE a.id=$1 AND a.point_id=$2', [point.current_evidence_id, pointId])).rows[0];
        assert.ok(attempt, 'integration.verification_admission_missing');
        const evidence = inspectIntegrationVerification(point, attempt, {pointId, installationId, venueId: rows[0].venue_id, sourceNodeId, sha256, bytes}, target.digest, image);
        const job = (await pool.query("SELECT status,attempts,last_success_at,last_error FROM backup_jobs WHERE kind='verify' AND target_id=$1", [pointId])).rows[0];
        assert.equal(job.status, 'pending'); assert.equal(job.attempts, 0); assert.ok(job.last_success_at); assert.equal(job.last_error, null);
        assert.equal((await pool.query('SELECT superseded_by FROM installations WHERE id=$1', [installationId])).rows[0].superseded_by, null);
        assert.equal(Number((await pool.query('SELECT count(*) FROM backup_recoveries WHERE venue_id=$1', [rows[0].venue_id])).rows[0].count), 0);
        console.log(JSON.stringify({...evidence, noSupersession: true}));
      }
    } else if (phase === 'provision-snapshot' || phase === 'inspect-snapshot') {
      const runtime = await openTestCaptureRuntime({pool, directory: '/run/local-stack', mode: 'test-free-paid'});
      const location = {endpoint: 'https://waitron.local:8333', bucket: 'venue-' + rows[0].venue_id, region: 'local'};
      try {
        if (phase === 'provision-snapshot') {
          const storage = new S3Client({...location, forcePathStyle: true, maxAttempts: 1,
            credentials: {accessKeyId: config.storage.accessKeyId, secretAccessKey: config.storage.secretAccessKey},
            requestHandler: {httpsAgent: new Agent({ca: await readFile('/run/local-stack/lan/ca.pem')})}});
          try {await storage.send(new CreateBucketCommand({Bucket: location.bucket}), {abortSignal: AbortSignal.timeout(10000)});}
          finally {storage.destroy();}
          await new BackupCatalogue(pool, runtime.options.vault, runtime.options.objects, 'test-free-paid').provision(installationId, location);
          console.log(JSON.stringify({provisioned: true}));
        } else {
          const {rows: points} = await pool.query('SELECT * FROM backup_points WHERE id=$1 AND installation_id=$2 AND venue_id=$3', [pointId, installationId, rows[0].venue_id]);
          assert.equal(points.length, 1); const point = points[0];
          const stored = await runtime.options.objects(location).read(point.object_key);
          console.log(JSON.stringify(inspectIntegrationSnapshot(point, stored,
            {pointId, installationId, venueId: rows[0].venue_id, sha256, bytes, sourceNodeId})));
        }
      } finally {runtime.close();}
    } else {
      const operations = await pool.query('SELECT result FROM installation_operations WHERE installation_id=$1', [installationId]);
      assert.ok(operations.rows.some(row => row.result.lease), 'integration.persisted_renewal_missing');
      console.log(JSON.stringify({organisationId, venueId: rows[0].venue_id, localVenueId: rows[0].local_venue_id, persistedRenewal: true}));
    }
  }
} finally {await pool.end();}
