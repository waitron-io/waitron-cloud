// Observe native exchanges without replacing transport, signatures or responses.
import assert from 'node:assert/strict';
import {fixtureFailureDiagnostic} from '/proof/integration-renewal.mjs';
import {observeBackupReservation} from '/proof/integration-snapshot-client.mjs';
import {appendFile, readFile, writeFile, rm, chmod} from 'node:fs/promises';
import {createServer} from 'node:http';
import {randomUUID, createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {dirname} from 'node:path';
import {createRequire} from 'node:module';
import {createCloudConnection} from '/waitron/apps/server/src/cloud-client.ts';
import {pendingRequest} from '/waitron/apps/server/src/cloud-installation.ts';
const require = createRequire('/waitron/apps/server/package.json');
if (process.env.CLOUD_TEST_STREAM === '1') {
  const {startIntegrationTransport} = await import('/proof/integration-transport.mjs');
  await startIntegrationTransport();
}
const origin = process.env.CLOUD_TEST_ORIGIN ?? 'https://waitron.local:3000';
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const target = new URL(url);
  const record = observed => appendFile(process.env.CLOUD_TEST_ROOT + '/exchanges.jsonl',
    JSON.stringify({path: target.pathname, ...observed}) + '\n', {mode: 0o600});
  if (target.origin === origin && target.pathname === '/api/installations/backup-reserve') {
    return observeBackupReservation(() => nativeFetch(url, options), record);
  }
  const response = await nativeFetch(url, options);
  if (target.origin === origin && /^\/api\/(pairing|installations)\/[a-z-]+$/.test(target.pathname)) {
    const observed = {status: response.status};
    if (process.env.CLOUD_TEST_STORE_CA && target.pathname === '/api/installations/backup-publish' && response.status === 409) {
      const body = await response.clone().json();
      observed.error = body.error === 'object_mismatch' ? 'object_mismatch' : 'unexpected';
    }
    await record(observed);
  }
  return response;
};
await import('/waitron/apps/server/scripts/cloud-integration-fixture.ts');
const root = process.env.CLOUD_TEST_ROOT;
const ready = JSON.parse(await readFile(root + '/ready.json', 'utf8'));
const {openVenueDatabase,readCloudVenueId}=require('@waitron/db');
const cloud = createCloudConnection({stateDir: root, origin, environment: 'test',
  async readVenueId(){const store=await openVenueDatabase(root+'/venue',{exclusive:false});try{return await readCloudVenueId(store.venue);}finally{await store.close();}},
  async recordVenueId(){throw new Error('Pair through the running server management API');}});
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
    if (req.url === '/snapshot-publish' || req.url === '/snapshot-altered') {
      const altered = req.url === '/snapshot-altered';
      if (altered) assert.ok(process.env.CLOUD_TEST_STORE_CA, 'integration.altered_snapshot_scope');
      assert.equal(process.env.CLOUD_TEST_BACKUP_STATE, '1');
      const requestedAt = Date.now();
      const {putIntegrationSnapshot,reserveLegacyIntegrationSnapshot}=await import('/proof/integration-snapshot-client.mjs');
      const captureId=randomUUID();
      // The stream withdrawal proof observes the lifetime of a legacy session.
      const grant=process.env.CLOUD_TEST_STREAM==='1'
        ?await reserveLegacyIntegrationSnapshot(root,captureId)
        :await cloud.reserveCapture(captureId);
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
      const storeCa = process.env.CLOUD_TEST_STORE_CA;
      const uploaded = altered ? Buffer.from(bytes) : bytes;
      if (altered) uploaded[0] ^= 1;
      const written=await putIntegrationSnapshot(grant,uploaded,storeCa);
      assert.equal(written,200);
      if (!altered && grant.credentials) {
        const state = JSON.parse(await readFile(root + '/cloud/connection.json', 'utf8'));
        await writeFile(root + '/snapshot-access.json', JSON.stringify({id: grant.id, venueId: grant.venueId, installationId: grant.installationId,
          identitySha256: createHash('sha256').update(state.publicKey).digest('hex'), archiveSha256: digest,
          location: grant.location, incomingKey: grant.incomingKey, credentials: grant.credentials,
          expiresAt: grant.expiresAt, requestedAt, acceptedAt: Date.now(), writeStatus: written}), {mode: 0o600});
      }
      const publication = () => cloud.publishCapture(grant.id, {digest, size: bytes.length, capturedAt: metadata.manifest.createdAt,
        retention: 'daily', sourceNodeId: metadata.sourceNodeId, modules: metadata.manifest.modules});
      if (altered) {
        await assert.rejects(publication);
        const exchanges = (await readFile(root + '/exchanges.jsonl', 'utf8')).trim().split('\n').map(line => JSON.parse(line));
        assert.deepEqual(exchanges.at(-1), {path: '/api/installations/backup-publish', status: 409, error: 'object_mismatch'});
        res.end(JSON.stringify({pointId: grant.id, refused: true}));
        return;
      }
      const point = await publication();
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
  } catch (error) {res.statusCode = 500; res.end(JSON.stringify({error: 'fixture_refused',
    diagnostic: (diagnostic ? diagnostic + ':' : '') + fixtureFailureDiagnostic(error)}));}
});
await new Promise(resolve => control.listen(socket, resolve)); await chmod(socket, 0o600);
