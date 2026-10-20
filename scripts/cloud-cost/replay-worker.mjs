// The host controller invokes this only after effective network isolation and source-copy checks.
import { readFileSync, writeFileSync, mkdirSync, renameSync, lstatSync } from 'node:fs';
import { createRequire } from 'node:module';
import { openWorkerStorage, streamCounters } from './worker-storage.mjs';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { replayPrivateDay } from './private-replay.mjs';

async function run() {
  const source = '/state/source', root = '/state/private';
  mkdirSync(source, { mode: 0o700 }); mkdirSync(root, { mode: 0o700 });
  const token = randomBytes(32).toString('hex'), journal = { path: root + '/journal.json', token };
  writeFileSync(root + '/.cloud-cost-owner', token, { mode: 0o600, flag: 'wx' });
  const database = root + '/venue-copy.db'; renameSync('/state/input.db', database);
  const identity = lstatSync(database);
  writeFileSync(journal.path, JSON.stringify({ schemaVersion: 1, source, root, ownershipToken: token,
    localResources: [{ kind: 'database-copy', state: 'ready', path: database, ino: identity.ino, dev: identity.dev }] }), { mode: 0o600, flag: 'wx' });
  const options = JSON.parse(readFileSync('/state/config.json', 'utf8'));
  let storage;
  try {
    let stream;
    if (options.stream) {
      const sdk = createRequire('/app/packages/backups/package.json')('@aws-sdk/client-s3');
      storage = await openWorkerStorage({ source, root, journal, sdk });
      const { binarySha256, startupSeconds, idleSeconds, windowSeconds } = options.stream;
      stream = { binary: '/code/litestream', binarySha256, startupSeconds, idleSeconds, windowSeconds,
        target: storage.target, bucket: storage.bucket, versioned: false, sdk };
    }
    const result = await replayPrivateDay({ ...options, ...(stream ? { stream } : {}), source, root, journal, database, codeRoot: '/code', stateRoot: root + '/replay' });
    if (storage) {
      const native = result.stream;
      const { retainedStorage, ...administration } = await storage.finish({ retained: {
        since: native.stream.storageEndedAt, bytes: native.stream.storage.objects.bytes,
        objects: native.stream.storage.objects.currentVersions,
      } });
      result.stream = { phases: native.stream.phases, requests: streamCounters(native.stream.requests),
        administration, retainedStorage, storage: native.stream.storage, native: native.native, restored: native.restored,
        cleanup: { ...native.cleanup, listeners: 0, clients: 0, buckets: 0, objects: 0, multipartUploads: 0 } };
    }
    writeFileSync('/state/result.json', JSON.stringify(result), { mode: 0o600, flag: 'wx' });
  } finally { await storage?.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(() => { process.exitCode = 1; });
}
