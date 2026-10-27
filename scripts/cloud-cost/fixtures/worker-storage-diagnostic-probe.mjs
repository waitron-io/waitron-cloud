// Only the external storage process, SDK and meter are simulated; cleanup and ownership are real.
import { registerHooks } from 'node:module';
import { EventEmitter } from 'node:events';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fault = process.argv[2], action = process.argv[3] ?? 'finish', records = [];
const parent = realpathSync(mkdtempSync(join(tmpdir(), 'storage-diagnostic-')));
const source = join(parent, 'source'), root = join(parent, 'owned');
mkdirSync(source, { mode: 0o700 }); mkdirSync(root, { mode: 0o700 });
const token = 'a'.repeat(64), journal = { token, path: join(root, 'journal.json') };
writeFileSync(join(root, '.cloud-cost-owner'), token, { mode: 0o600 });
writeFileSync(journal.path, JSON.stringify({ schemaVersion: 1, source, root, ownershipToken: token }), { mode: 0o600 });
let cleanup = false, present = false, collected = false, destroyed = 0, accountingDone = false, deleted = false;
let proxyClosed = 0, clientCount = 0, cleanupRequests = 0;
const refuse = () => { throw Error('PRIVATE_STORAGE_CANARY'); };
const child = new EventEmitter();
child.pid = 12345;
child.kill = () => {
  collected = true;
  if (fault === 'root-remove') rmSync(join(root, 'local-storage'), { recursive: true });
  if (fault === 'process-collect') child.emit('error', Error('PRIVATE_CHILD_ERROR'));
  queueMicrotask(() => child.emit('close', 0)); return true;
};
globalThis.storageProbe = {
  spawn: () => child,
  createMeter: () => ({ snapshot: () => {
    if (fault === 'accounting') refuse();
    accountingDone = true;
    return { reconciled: true, accounting: {}, observedRequests: [] };
  } }),
  createMeteringProxy: async () => ({ url: 'http://127.0.0.1:9999', close: async () => {
    proxyClosed++;
    if (['proxy-close', 'two-failures', 'reporter', 'async-reporter'].includes(fault)) refuse();
  } }),
  instrumentStorageClient: () => {
    if (cleanup && fault === 'cleanup-client-instrumentation') refuse();
  }, correlatedStorageAttempt: () => {},
};
registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.endsWith('/worker-storage.mjs')) {
    if (specifier === 'node:child_process') return { url: 'data:text/javascript,export const spawn=globalThis.storageProbe.spawn;', shortCircuit: true };
    if (specifier === './meter.mjs') return { url: 'data:text/javascript,export const {createMeter,createMeteringProxy,instrumentStorageClient,correlatedStorageAttempt}=globalThis.storageProbe;', shortCircuit: true };
  }
  return next(specifier, context);
} });
const sdk = {};
for (const name of ['ListBuckets', 'HeadBucket', 'ListObjectsV2', 'ListMultipartUploads', 'CreateBucket', 'DeleteBucket', 'DeleteObject', 'AbortMultipartUpload']) {
  sdk[name + 'Command'] = { [name + 'Command']: class {} }[name + 'Command'];
}
sdk.S3Client = class {
  constructor() {
    clientCount++;
    if (cleanup && fault === 'cleanup-client-construction') refuse();
  }
  async send(command) {
    if (cleanup) cleanupRequests++;
    const name = command.constructor.name;
    if (cleanup && ({ 'bucket-inventory': 'ListBucketsCommand', 'bucket-present': 'HeadBucketCommand',
      'multipart-list': 'ListMultipartUploadsCommand', 'object-list': 'ListObjectsV2Command',
      'two-failures': 'ListObjectsV2Command', 'delete-bucket': 'DeleteBucketCommand',
      'delete-object': 'DeleteObjectCommand', 'abort-upload': 'AbortMultipartUploadCommand',
      'concurrent': 'ListBucketsCommand' })[fault] === name) refuse();
    if (name === 'CreateBucketCommand') { present = true; return {}; }
    if (name === 'DeleteBucketCommand') { present = false; return {}; }
    if (name === 'HeadBucketCommand') {
      if (!present) throw Object.assign(Error('PRIVATE_ABSENCE'), { $metadata: { httpStatusCode: 404 } });
      return { $metadata: { httpStatusCode: 200 } };
    }
    if (name === 'ListBucketsCommand') return { Buckets: [] };
    if (name === 'DeleteObjectCommand') { deleted = true; return {}; }
    if (name === 'ListObjectsV2Command') return { Contents: cleanup && fault === 'delete-object' && !deleted
      ? [{ Key: 'stream/PRIVATE_OBJECT', Size: 4 }] : [], IsTruncated: false };
    if (name === 'ListMultipartUploadsCommand') return { Uploads: cleanup && fault === 'abort-upload'
      ? [{ Key: 'stream/PRIVATE_UPLOAD', UploadId: 'PRIVATE_ID' }] : [], IsTruncated: false };
    throw Error('Unexpected command');
  }
  destroy() {
    if (cleanup) {
      destroyed++;
      if (['cleanup-client-open', 'close-only'].includes(fault)) refuse();
      if (fault === 'first-client-close' && destroyed === 1) refuse();
      if (fault === 'client-close' && destroyed === 2) refuse();
    }
  }
};
try {
  const { openWorkerStorage } = await import('../worker-storage.mjs');
  const controller = new AbortController();
  const storage = await openWorkerStorage({ source, root, journal, sdk, signal: controller.signal,
    clock: () => fault === 'retained-accounting' && accountingDone ? NaN : 12, onDiagnostic: event => {
    if (fault === 'reporter') refuse();
    if (fault === 'async-reporter') return Promise.reject(Error('PRIVATE_ASYNC_REPORTER'));
    records.push(event);
  } });
  cleanup = true;
  if (fault === 'storage-health') controller.abort();
  if (fault === 'bucket-ownership') writeFileSync(journal.path, '{}', { mode: 0o600 });
  let message = null;
  const closing = (fault === 'concurrent' || action === 'concurrent') ? storage.close().catch(() => {}) : undefined;
  try { if (fault === 'close-only' || action === 'close') await storage.close(); else await storage.finish(fault === 'finish-input' ? { private: 'PRIVATE_CANARY' }
    : fault === 'retained-inventory' ? { retained: { since: 0, bytes: 4, objects: 1 } }
    : fault === 'retained-accounting' ? { retained: { since: 0, bytes: 0, objects: 0 } } : {}); }
  catch (error) { message = error.message; }
  await closing;
  await storage.close().catch(() => {});
  await new Promise(resolve => setImmediate(resolve));
  const entries = JSON.parse(readFileSync(journal.path, 'utf8')).localResources ?? [];
  console.log(JSON.stringify({ message, records, collected, proxyClosed, clientCount, destroyed, cleanupRequests,
    bucketRemoved: entries.some(e => e.kind === 'storage-bucket' && e.state === 'removed'),
    bucketCleanupIntents: entries.filter(e => e.kind === 'storage-bucket' && e.state === 'cleanup-intent').length, rootRetained: existsSync(join(root, 'local-storage')) }));
} finally { rmSync(parent, { recursive: true, force: true }); }
