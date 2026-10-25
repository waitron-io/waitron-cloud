// The host controller invokes this only after effective network isolation and source-copy checks.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, unlinkSync, lstatSync } from 'node:fs';
import { createRequire } from 'node:module';
import { openWorkerStorage, streamCounters } from './worker-storage.mjs';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { workerFailureTrace } from './worker-diagnostic.mjs';
import { replayPrivateDay } from './private-replay.mjs';

let stage = 'configuration';
let storageStage;
const trace = [];
const onDiagnostic = event => { trace.push(event); if (trace.length > 32) trace.shift(); };
function recordFailure() {
  // The first refusal remains available after later cleanup; no raw exception is persisted.
  try { writeFileSync('/state/worker-failure.json', JSON.stringify({ schemaVersion: 1, stage }), { mode: 0o600, flag: 'wx' }); }
  catch { /* An existing diagnostic must never be overwritten. */ }
  try { writeFileSync('/state/worker-trace.json', JSON.stringify(workerFailureTrace(trace)), { mode: 0o600, flag: 'wx' }); }
  catch { /* Invalid or unavailable traces do not replace the first refusal. */ }
}

async function run() {
  // SQLite, its WAL and the native stream share the container's temporary filesystem.
  // Sustained writes through a host-shared folder can produce an invalid native restore.
  const source = '/tmp/source', root = '/tmp/private';
  mkdirSync(source, { mode: 0o700 }); mkdirSync(root, { mode: 0o700 });
  const token = randomBytes(32).toString('hex'), journal = { path: root + '/journal.json', token };
  writeFileSync(root + '/.cloud-cost-owner', token, { mode: 0o600, flag: 'wx' });
  const database = root + '/venue-copy.db'; copyFileSync('/state/input.db', database); unlinkSync('/state/input.db');
  const identity = lstatSync(database);
  writeFileSync(journal.path, JSON.stringify({ schemaVersion: 1, source, root, ownershipToken: token,
    localResources: [{ kind: 'database-copy', state: 'ready', path: database, ino: identity.ino, dev: identity.dev }] }), { mode: 0o600, flag: 'wx' });
  const options = JSON.parse(readFileSync('/state/config.json', 'utf8'));
  let storage;
  try {
    let stream;
    if (options.stream) {
      stage = 'storage-open';
      const sdk = createRequire('/app/packages/backups/package.json')('@aws-sdk/client-s3');
      storage = await openWorkerStorage({ source, root, journal, sdk, onDiagnostic });
      const { binarySha256, startupSeconds, idleSeconds, windowSeconds } = options.stream;
      stream = { binary: '/code/litestream', binarySha256, startupSeconds, idleSeconds, windowSeconds,
        target: storage.target, bucket: storage.bucket, versioned: false, sdk };
    }
    stage = 'replay';
    const result = await replayPrivateDay({ ...options, ...(stream ? { stream } : {}), source, root, journal, database, onDiagnostic, codeRoot: '/code', stateRoot: root + '/replay' });
    if (storage) {
      stage = 'storage-cleanup';
      storageStage = 'storage-finish-input';
      const native = result.stream;
      const retained = {
        since: native.stream.storageEndedAt, bytes: native.stream.storage.objects.bytes,
        objects: native.stream.storage.objects.currentVersions,
      };
      storageStage = 'storage-finish';
      const finished = await storage.finish({ retained });
      storageStage = 'storage-finish-result';
      const { retainedStorage, ...administration } = finished;
      result.stream = { phases: native.stream.phases, requests: streamCounters(native.stream.requests),
        administration, retainedStorage, storage: native.stream.storage, native: native.native, restored: native.restored,
        cleanup: { ...native.cleanup, listeners: 0, clients: 0, buckets: 0, objects: 0, multipartUploads: 0 } };
    }
    stage = 'result';
    writeFileSync('/state/worker-trace.json', JSON.stringify(workerFailureTrace(trace)), { mode: 0o600, flag: 'wx' });
    writeFileSync('/state/result.json', JSON.stringify(result), { mode: 0o600, flag: 'wx' });
  } catch {
    if (stage === 'storage-cleanup' && ['storage-finish-input', 'storage-finish-result'].includes(storageStage))
      onDiagnostic({ kind: 'replay-refusal', stage: storageStage });
    recordFailure(); throw Error('Invalid cloud cost replay worker');
  }
  finally { stage = 'storage-cleanup'; await storage?.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(() => { recordFailure(); process.exitCode = 1; });
}
