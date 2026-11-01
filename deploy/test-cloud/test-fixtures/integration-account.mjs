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
import {inspectIntegrationRecovery} from './integration-recovery-evidence.mjs';
import {inspectIntegrationStream} from './integration-stream-evidence.mjs';
import {inspectIntegrationRetainedSnapshot} from './integration-retained-snapshot-evidence.mjs';
import {ManagedStreams} from '../../../packages/backups/src/managed-streams.ts';
import {inspectIntegrationContinuousState} from './integration-continuous-recovery-evidence.mjs';
const {Pool} = createRequire(new URL('../../../packages/registration/package.json', import.meta.url))('pg');
const {S3Client, CreateBucketCommand, ListObjectsV2Command, DeleteObjectsCommand} = createRequire(new URL('../../../packages/backups/package.json', import.meta.url))('@aws-sdk/client-s3');
let input = '';
for await (const part of process.stdin) {input += part; assert.ok(input.length < 16384);}
const {organisationId, plan, installationId, phase, pointId, sha256, bytes, sourceNodeId, image, requestId, attemptId, targetDigest, desiredStatus, generation, recoverableAt} = JSON.parse(input);
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
    if (phase === 'inspect-continuous-recovery') {
      const row = (await pool.query(`SELECT r.*,q.id AS request_id,q.operation_id,q.protocol_version,q.verification_target AS request_target,
        v.organisation_id,i.superseded_by,i.revoked_at FROM backup_recoveries r
        JOIN backup_recovery_requests q ON q.operation_id=r.id JOIN venues v ON v.id=r.venue_id
        JOIN installations i ON i.id=$2 AND i.venue_id=r.venue_id WHERE r.id=$1`, [requestId, installationId])).rows[0];
      assert.ok(row);
      console.log(JSON.stringify(inspectIntegrationContinuousState(row, {requestId, venueId: rows[0].venue_id,
        organisationId, sourceNodeId, generation, recoverableAt}, desiredStatus)));
    } else if (phase === 'remove-test-stream' || phase === 'inspect-snapshot-fallback') {
      assert.equal(process.env.CLOUD_TEST_SERVICE_PLANS, '1');
      const venueId = rows[0].venue_id, prefix = 'streams/' + venueId + '/';
      const runtime = await openTestCaptureRuntime({pool, directory: '/run/local-stack', mode: 'test-free-paid'});
      const location = {endpoint: 'https://waitron.local:8333', bucket: 'venue-' + venueId, region: 'local'};
      const storage = new S3Client({...location, forcePathStyle: true, maxAttempts: 1,
        credentials: {accessKeyId: config.storage.accessKeyId, secretAccessKey: config.storage.secretAccessKey},
        requestHandler: {httpsAgent: new Agent({ca: await readFile('/run/local-stack/lan/ca.pem')})}});
      const list = async () => {
        const objects = []; let continuation;
        do {
          assert.ok(objects.length < 10000);
          const reply = await storage.send(new ListObjectsV2Command({Bucket: location.bucket, Prefix: prefix,
            ...(continuation ? {ContinuationToken: continuation} : {})}), {abortSignal: AbortSignal.timeout(10000)});
          for (const object of reply.Contents ?? []) {assert.ok(object.Key.startsWith(prefix)); objects.push({Key: object.Key});}
          continuation = reply.IsTruncated ? reply.NextContinuationToken : undefined;
          if (reply.IsTruncated) assert.ok(continuation);
        } while (continuation);
        return objects;
      };
      const retained = async () => {
        const point = (await pool.query('SELECT * FROM backup_points WHERE id=$1 AND installation_id=$2 AND venue_id=$3', [pointId, installationId, venueId])).rows[0];
        assert.ok(point);
        inspectIntegrationRetainedSnapshot(point, await runtime.options.objects(location).read(point.object_key),
          {pointId, installationId, venueId, sha256, bytes, sourceNodeId, attemptId});
      };
      try {
        await retained();
        if (phase === 'remove-test-stream') {
          assert.equal(Number((await pool.query("SELECT count(*) FROM backup_recoveries WHERE venue_id=$1 AND source_kind='continuous' AND status<>'closed'", [venueId])).rows[0].count), 0);
          const objects = await list(); assert.ok(objects.length > 0, 'integration.real_stream_required');
          for (let offset = 0; offset < objects.length; offset += 1000) {
            const result = await storage.send(new DeleteObjectsCommand({Bucket: location.bucket, Delete: {Objects: objects.slice(offset, offset + 1000)}}), {abortSignal: AbortSignal.timeout(10000)});
            assert.equal(result.Errors?.length ?? 0, 0);
          }
          const removed = await pool.query('DELETE FROM backup_managed_streams WHERE venue_id=$1 AND installation_id=$2 AND source_node_id=$3 RETURNING venue_id', [venueId, installationId, sourceNodeId]);
          assert.equal(removed.rowCount, 1);
        }
        const streamObjects = (await list()).length;
        const pointerRows = Number((await pool.query('SELECT count(*) FROM backup_managed_streams WHERE venue_id=$1', [venueId])).rows[0].count);
        assert.equal(streamObjects, 0); assert.equal(pointerRows, 0);
        await retained();
        console.log(JSON.stringify({streamObjects, pointerRows, retainedSnapshotUnchanged: true}));
      } finally {storage.destroy(); runtime.close();}
    } else if (phase === 'inspect-stream') {
      const runtime=await openTestCaptureRuntime({pool,directory:'/run/local-stack',mode:'test-free-paid'});
      let invariant='observer';
      try {
        const row=(await pool.query('SELECT configuration_revision,superseded_by,revoked_at FROM installations WHERE id=$1',[installationId])).rows[0];
        assert.equal(row.superseded_by,null);assert.equal(row.revoked_at,null);
        const streams=new ManagedStreams(pool,runtime.options.vault,runtime.options.managedStreams,'test-free-paid');
        const observed=await streams.observe(installationId,row.configuration_revision);
        invariant='snapshot';
        const point=(await pool.query('SELECT * FROM backup_points WHERE id=$1 AND installation_id=$2 AND venue_id=$3',[pointId,installationId,rows[0].venue_id])).rows[0];
        assert.ok(point);
        const location={endpoint:'https://waitron.local:8333',bucket:'venue-'+rows[0].venue_id,region:'local'};
        const stored=await runtime.options.objects(location).read(point.object_key);
        inspectIntegrationRetainedSnapshot(point,stored,{pointId,installationId,venueId:rows[0].venue_id,sha256,bytes,sourceNodeId,attemptId});
        assert.equal(point.verification,'verified');
        console.log(JSON.stringify(inspectIntegrationStream({venueId:observed.venueId,installationId:observed.installationId,
          sourceNodeId:observed.sourceNodeId,localVenueId:observed.localVenueId,generation:observed.generation,
          recoverableAt:observed.recoverableAt,checkedAt:observed.checkedAt,nativeStreaming:true,signedPointerVerified:true,
          retainedSnapshotUnchanged:true,noSupersession:true,noActivation:true},
          {venueId:rows[0].venue_id,installationId,sourceNodeId,localVenueId:rows[0].local_venue_id,generation,recoverableAt})));
      } catch(error) {
        const named=/^integration\.stream_[A-Za-z0-9_]+/.exec(error.message)?.[0];
        console.error(named??'integration.stream_'+invariant);
        throw error;
      } finally {runtime.close();}
    } else if (phase === 'inspect-recovery') {
      const row = (await pool.query(`SELECT r.*,q.id AS request_id,q.operation_id,q.protocol_version,q.verification_target AS request_target,
        p.current_evidence_id,p.digest,p.size,v.organisation_id,i.superseded_by,i.revoked_at
        FROM backup_recoveries r JOIN backup_recovery_requests q ON q.operation_id=r.id
        JOIN backup_points p ON p.id=r.point_id JOIN venues v ON v.id=r.venue_id
        JOIN installations i ON i.id=p.installation_id WHERE r.id=$1 AND i.id=$2`, [requestId, installationId])).rows[0];
      assert.ok(row, 'integration.recovery_missing');
      console.log(JSON.stringify(inspectIntegrationRecovery(row,
        {requestId, venueId: rows[0].venue_id, organisationId, pointId, attemptId, targetDigest, sha256, bytes}, desiredStatus)));
    } else if (phase === 'configure-verification' || phase === 'inspect-verification') {
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
