// Observe successful native exchanges without replacing transport, signatures or responses.
import assert from 'node:assert/strict';
import {appendFile, readFile, writeFile, rm, chmod} from 'node:fs/promises';
import {createServer} from 'node:http';
import {randomUUID, createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {dirname} from 'node:path';
import {createRequire} from 'node:module';
import {Agent} from 'node:https';
import {lookup} from 'node:dns';
import {createCloudConnection} from '/waitron/apps/server/src/cloud-client.ts';
import {pendingRequest} from '/waitron/apps/server/src/cloud-installation.ts';
const require = createRequire('/waitron/apps/server/package.json');
if (process.env.CLOUD_TEST_STREAM === '1') {
  const {startIntegrationTransport} = await import('/proof/integration-transport.mjs');
  await startIntegrationTransport();
}
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const response = await nativeFetch(url, options);
  const target = new URL(url);
  if (target.origin === 'https://waitron.local:3000' && /^\/api\/(pairing|installations)\/[a-z-]+$/.test(target.pathname)) {
    const observed = {path: target.pathname, status: response.status};
    if (target.pathname === '/api/installations/backup-reserve' && response.status === 403) {
      const body = await response.clone().json();
      observed.error = body.error === 'permission_denied' ? 'permission_denied' : 'unexpected';
      observed.grantIssued = Object.keys(body).some(key => key !== 'error');
    }
    await appendFile(process.env.CLOUD_TEST_ROOT + '/exchanges.jsonl', JSON.stringify(observed) + '\n', {mode: 0o600});
  }
  return response;
};
await import('/waitron/apps/server/scripts/cloud-integration-fixture.ts');
const root = process.env.CLOUD_TEST_ROOT;
const ready = JSON.parse(await readFile(root + '/ready.json', 'utf8'));
const cloud = createCloudConnection({stateDir: root, origin: 'https://waitron.local:3000', localVenueId: ready.localVenueId, environment: 'test'});
// The private socket calls the same module in the owning server process, preserving its state lock.
const socket = root + '/proof.sock'; await rm(socket, {force: true});
const control = createServer(async (req, res) => {
  let diagnostic;
  try {
    assert.equal(req.method, 'POST');
    if (req.url === '/rollback-refresh') {
      const {renewIntegrationAfterRollback} = await import('/proof/integration-renewal.mjs');
      res.end(JSON.stringify(await renewIntegrationAfterRollback(root, pendingRequest, () => cloud.refresh(), value => {diagnostic = value;})));
      return;
    }
    if (req.url === '/paid-remote') {
      let input = '';
      for await (const part of req) {input += part; assert.ok(input.length < 16384);}
      const {paidRemoteClient} = await import('/proof/integration-paid-remote-client.mjs');
      res.end(JSON.stringify(await paidRemoteClient(root, JSON.parse(input), nativeFetch)));
      return;
    }
    if (req.url === '/free-remote') {
      let input = '';
      for await (const part of req) {input += part; assert.ok(input.length < 16384);}
      const {proveIntegrationFreeRemote} = await import('/proof/integration-free-remote.mjs');
      res.end(JSON.stringify(await proveIntegrationFreeRemote(root, JSON.parse(input))));
      return;
    }
    if (req.url === '/storage-withdrawal') {
      let input = '';
      for await (const part of req) {input += part; assert.ok(input.length < 16384);}
      const {probeIntegrationStorage} = await import('/proof/integration-storage-client.mjs');
      res.end(JSON.stringify(await probeIntegrationStorage(root, JSON.parse(input))));
      return;
    }
    if (req.url === '/snapshot-exposure') {
      let input = '';
      for await (const part of req) {input += part; assert.ok(input.length < 16384);}
      const {probeIntegrationSnapshotExposure} = await import('/proof/integration-snapshot-client.mjs');
      res.end(JSON.stringify(await probeIntegrationSnapshotExposure(root, JSON.parse(input))));
      return;
    }
    if (req.url === '/stream-start') {
      const {startIntegrationStream} = await import('/proof/integration-stream.mjs');
      res.end(JSON.stringify(await startIntegrationStream(root)));
      return;
    }
    if (req.url === '/recovery-authority') {
      const {prepareIntegrationRecoveryAuthority} = await import('/proof/integration-recovery-authority.mjs');
      res.end(JSON.stringify(await prepareIntegrationRecoveryAuthority(root)));
      return;
    }
    if (req.url === '/verification-state') {
      const {prepareIntegrationVerificationState} = await import('/proof/integration-verification-state.mjs');
      res.end(JSON.stringify(await prepareIntegrationVerificationState(root)));
      return;
    }
    if (req.url === '/snapshot-publish') {
      assert.equal(process.env.CLOUD_TEST_BACKUP_STATE, '1');
      const requestedAt = Date.now();
      const grant = await cloud.reserveCapture(randomUUID());
      const metadata = await new Promise((resolve, reject) => {
        const scratch = dirname(root);
        const child = spawn(process.execPath, ['--permission', '--allow-fs-read=*', '--allow-fs-write=' + scratch,
          '--allow-worker', '--allow-child-process', '--allow-addons', '--import', require.resolve('tsx'),
          '/waitron/apps/server/scripts/cloud-backup-fixture.ts'], {
          cwd: '/waitron/apps/server', env: {...process.env, TMPDIR: scratch, TSX_DISABLE_CACHE: '1'}, stdio: ['pipe', 'pipe', 'pipe'],
        });
        let output = '', invalid = false;
        const timer = setTimeout(() => {invalid = true; child.kill('SIGKILL');}, 30000);
        child.stdout.on('data', part => {if (output.length + part.length > 65536) {invalid = true; child.kill('SIGKILL');} else output += part;});
        child.stderr.resume(); child.stdin.on('error', () => {});
        child.once('error', () => {invalid = true;});
        child.once('close', code => {
          clearTimeout(timer);
          try {assert.equal(invalid, false); assert.equal(code, 0); resolve(JSON.parse(output.trim().split('\n').at(-1)));}
          catch {reject(Error('integration.capture_failed'));}
        });
        child.stdin.end(JSON.stringify({command: 'capture', recoveryKey: grant.recoveryKey}));
      });
      const {readIntegrationSourceIdentity}=await import('/proof/integration-source-identity.mjs');
      assert.equal(metadata.sourceNodeId, (await readIntegrationSourceIdentity(root)).nodeId);
      assert.equal(metadata.networkDenied, true);
      const bytes = await readFile(root + '/captured.backup.enc');
      const digest = createHash('sha256').update(bytes).digest('hex');
      const {S3Client, PutObjectCommand} = require('@aws-sdk/client-s3');
      const storage = new S3Client({endpoint: grant.location.endpoint, region: grant.location.region,
        credentials: grant.credentials, forcePathStyle: true, maxAttempts: 1,
        // The API hostname is pinned to the proxy; storage keeps that TLS name on its own service.
        requestHandler: {httpsAgent: new Agent({ca: await readFile('/proof/ca.pem'),
          lookup: (hostname, options, done) => lookup(hostname === 'waitron.local' ? 'storage' : hostname, options, done)})}});
      try {
        const written = await storage.send(new PutObjectCommand({Bucket: grant.location.bucket, Key: grant.incomingKey, Body: bytes}), {abortSignal: AbortSignal.timeout(10000)});
        assert.equal(written.$metadata.httpStatusCode, 200);
        const state = JSON.parse(await readFile(root + '/cloud-connection.json', 'utf8'));
        await writeFile(root + '/snapshot-access.json', JSON.stringify({id: grant.id, venueId: grant.venueId, installationId: grant.installationId,
          identitySha256: createHash('sha256').update(state.publicKey).digest('hex'), archiveSha256: digest,
          location: grant.location, incomingKey: grant.incomingKey, credentials: grant.credentials,
          expiresAt: grant.expiresAt, requestedAt, acceptedAt: Date.now(), writeStatus: written.$metadata.httpStatusCode}), {mode: 0o600});
      }
      finally {storage.destroy();}
      const point = await cloud.publishCapture(grant.id, {digest, size: bytes.length, capturedAt: metadata.manifest.createdAt,
        retention: 'daily', sourceNodeId: metadata.sourceNodeId, modules: metadata.manifest.modules});
      assert.equal(point.id, grant.id); assert.equal(point.digest, digest); assert.equal(point.size, bytes.length);
      assert.equal(point.verification, 'pending');
      res.end(JSON.stringify({status: 'published', pointId: point.id, sourceNodeId: metadata.sourceNodeId,
        sha256: digest, bytes: bytes.length, verification: point.verification, networkDeniedDuringCapture: metadata.networkDenied, signedPublication: true}));
      return;
    }
    assert.equal(req.url, '/snapshot-refusal');
    let refused = false;
    try {await cloud.reserveCapture(randomUUID());} catch {refused = true;}
    assert.equal(refused, true);
    const lines = (await readFile(root + '/exchanges.jsonl', 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const observed = lines.filter(value => value.path === '/api/installations/backup-reserve').at(-1);
    assert.deepEqual(observed, {path: '/api/installations/backup-reserve', status: 403, error: 'permission_denied', grantIssued: false});
    res.end(JSON.stringify({status: 'proved', httpStatus: observed.status, error: observed.error, grantIssued: observed.grantIssued}));
  } catch {res.statusCode = 500; res.end(JSON.stringify({error: 'fixture_refused', ...(diagnostic ? {diagnostic} : {})}));}
});
await new Promise(resolve => control.listen(socket, resolve)); await chmod(socket, 0o600);
