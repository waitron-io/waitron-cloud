// Only the external storage process, SDK and meter are simulated; cleanup and ownership are real.
import { registerHooks } from 'node:module';
import { EventEmitter } from 'node:events';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fault = process.argv[2], records = [];
const parent = realpathSync(mkdtempSync(join(tmpdir(), 'storage-diagnostic-')));
const source = join(parent, 'source'), root = join(parent, 'owned');
mkdirSync(source, { mode: 0o700 }); mkdirSync(root, { mode: 0o700 });
const token = 'a'.repeat(64), journal = { token, path: join(root, 'journal.json') };
writeFileSync(join(root, '.cloud-cost-owner'), token, { mode: 0o600 });
writeFileSync(journal.path, JSON.stringify({ schemaVersion: 1, source, root, ownershipToken: token }), { mode: 0o600 });
let cleanup = false, present = false, collected = false;
const refuse = () => { throw Error('PRIVATE_STORAGE_CANARY'); };
const child = new EventEmitter();
child.pid = 12345;
child.kill = () => { collected = true; queueMicrotask(() => child.emit('close', 0)); return true; };
globalThis.storageProbe = {
  spawn: () => child,
  createMeter: () => ({ snapshot: () => {
    if (fault === 'accounting') refuse();
    return { reconciled: true, accounting: {}, observedRequests: [] };
  } }),
  createMeteringProxy: async () => ({ url: 'http://127.0.0.1:9999', close: async () => {
    if (['proxy-close', 'two-failures', 'reporter'].includes(fault)) refuse();
  } }),
  instrumentStorageClient: () => {}, correlatedStorageAttempt: () => {},
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
  async send(command) {
    const name = command.constructor.name;
    if (cleanup && ({ 'bucket-inventory': 'ListBucketsCommand', 'bucket-present': 'HeadBucketCommand',
      'multipart-list': 'ListMultipartUploadsCommand', 'object-list': 'ListObjectsV2Command',
      'two-failures': 'ListObjectsV2Command', 'delete-bucket': 'DeleteBucketCommand' })[fault] === name) refuse();
    if (name === 'CreateBucketCommand') { present = true; return {}; }
    if (name === 'DeleteBucketCommand') { present = false; return {}; }
    if (name === 'HeadBucketCommand') {
      if (!present) throw Object.assign(Error('PRIVATE_ABSENCE'), { $metadata: { httpStatusCode: 404 } });
      return { $metadata: { httpStatusCode: 200 } };
    }
    if (name === 'ListBucketsCommand') return { Buckets: [] };
    if (name === 'ListObjectsV2Command') return { Contents: [], IsTruncated: false };
    if (name === 'ListMultipartUploadsCommand') return { Uploads: [], IsTruncated: false };
    throw Error('Unexpected command');
  }
  destroy() { if (cleanup && fault === 'client-close') refuse(); }
};
try {
  const { openWorkerStorage } = await import('../worker-storage.mjs');
  const storage = await openWorkerStorage({ source, root, journal, sdk, onDiagnostic: event => {
    if (fault === 'reporter') refuse();
    records.push(event);
  } });
  cleanup = true;
  let message = null;
  try { await storage.finish(fault === 'finish-input' ? { private: 'PRIVATE_CANARY' }
    : fault === 'retained-inventory' ? { retained: { since: 0, bytes: 4, objects: 1 } } : {}); }
  catch (error) { message = error.message; }
  await storage.close().catch(() => {});
  console.log(JSON.stringify({ message, records, collected, rootRetained: existsSync(join(root, 'local-storage')) }));
} finally { rmSync(parent, { recursive: true, force: true }); }
