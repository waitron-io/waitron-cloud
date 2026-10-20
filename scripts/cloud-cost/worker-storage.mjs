import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, lstatSync, realpathSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createMeter, createMeteringProxy, instrumentStorageClient, correlatedStorageAttempt } from './meter.mjs';
import { assertOwnedRoot } from './schema.mjs';

const fail = () => { throw Error('Invalid cloud cost worker storage'); };
const need = value => { if (!value) fail(); };
export const streamCounters = ({ reconciled, accounting, observedRequests }) => ({ reconciled, accounting, observedRequests });

// Only the isolated worker may start this local backend. Its bucket and directory are fresh.
// No host port, provider endpoint or caller-selected deletion target is admitted here.
export async function openWorkerStorage(args) {
  const { sdk, signal } = args, directory = join(args.root, 'local-storage');
  let identity, child, done, proxy, client, meter, created = false, stopping = false, exited = false, bad = false, disposal, evidence;
  let retained, retainedInvalid = false, last = -Infinity;
  const clock = args.clock ?? (() => performance.now() / 1000);
  const now = () => {
    const time = clock(); need(typeof time === 'number' && Number.isFinite(time) && time >= 0 && time >= last);
    last = time; return time;
  };
  const bucket = 'cost-' + randomUUID(), target = 'http://127.0.0.1:8334';
  const record = entry => {
    assertOwnedRoot(args); const value = JSON.parse(readFileSync(args.journal.path, 'utf8'));
    (value.localResources ??= []).push(entry); writeFileSync(args.journal.path, JSON.stringify(value), { mode: 0o600 });
  };
  const healthy = () => need(!signal?.aborted && !exited && !bad);
  let cleanupSignal;
  const send = command => {
    assertOwnedRoot(args); if (!cleanupSignal) healthy();
    return client.send(command, { abortSignal: cleanupSignal ?? signal });
  };
  const makeClient = phase => {
    const value = new sdk.S3Client({ endpoint: proxy.url, region: 'eu-north-1', forcePathStyle: true, maxAttempts: 1,
      requestHandler: { connectionTimeout: 1000, requestTimeout: 2000 }, credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } });
    instrumentStorageClient({ client: value, meter, phase, endpoint: proxy.url }); return value;
  };
  const listObjects = async () => {
    const rows = [], seen = new Set(); let ContinuationToken;
    do {
      const found = await send(new sdk.ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1000, ContinuationToken }));
      need(Array.isArray(found.Contents ?? []) && typeof found.IsTruncated === 'boolean');
      for (const row of found.Contents ?? []) {
        need(typeof row.Key === 'string' && row.Key.startsWith('stream/') && !seen.has(row.Key));
        seen.add(row.Key); rows.push(row); need(rows.length <= 10000);
      }
      if (!found.IsTruncated) break;
      need(typeof found.NextContinuationToken === 'string' && found.NextContinuationToken.length > 0
        && found.NextContinuationToken !== ContinuationToken && (found.Contents?.length ?? 0) > 0);
      ContinuationToken = found.NextContinuationToken;
    } while (true);
    return rows;
  };
  const uploads = async () => {
    const result = await send(new sdk.ListMultipartUploadsCommand({ Bucket: bucket, MaxUploads: 1000 }));
    need(result.IsTruncated === false && Array.isArray(result.Uploads ?? [])); return result.Uploads ?? [];
  };
  const bucketPresent = async () => {
    let result;
    try { result = await send(new sdk.HeadBucketCommand({ Bucket: bucket })); }
    catch (error) { if (error.$metadata?.httpStatusCode === 404) return false; throw error; }
    need(result.$metadata?.httpStatusCode === 200); return true;
  };
  const bucketInventory = async () => {
    const result = await send(new sdk.ListBucketsCommand({}));
    need(result.ContinuationToken === undefined && Array.isArray(result.Buckets ?? [])
      && (result.Buckets ?? []).every(b => typeof b?.Name === 'string' && b.Name.length > 0));
    return result.Buckets ?? [];
  };
  const dispose = () => disposal ??= (async () => {
    cleanupSignal = AbortSignal.timeout(10000);
    if (proxy) { client?.destroy(); client = makeClient('cleanup'); }
    const failures = []; const attempt = async fn => { try { await fn(); } catch { failures.push(true); } };
    if (created) await attempt(async () => {
      assertOwnedRoot(args); record({ kind: 'storage-bucket', state: 'cleanup-intent', bucket });
      // Bucket lists can omit a created bucket; only the owned bucket's direct 404 proves absence.
      await bucketInventory();
      if (await bucketPresent()) {
        // The caller has stopped its writer. Match the final native inventory before pricing cleanup.
        const pending = await uploads(), objects = await listObjects();
        if (retained && (pending.length !== 0 || objects.length !== retained.objects
          || objects.some(row => !Number.isSafeInteger(row.Size) || row.Size < 0)
          || objects.reduce((n, row) => n + row.Size, 0) !== retained.bytes)) retainedInvalid = true;
        for (const row of pending) {
          need(typeof row.Key === 'string' && row.Key.startsWith('stream/') && typeof row.UploadId === 'string' && row.UploadId.length > 0);
          await send(new sdk.AbortMultipartUploadCommand({ Bucket: bucket, Key: row.Key, UploadId: row.UploadId }));
        }
        for (const row of objects) {
          const from = now();
          await send(new sdk.DeleteObjectCommand({ Bucket: bucket, Key: row.Key }));
          const by = now();
          if (retained && !retainedInvalid) {
            // A deletion can commit anywhere between request admission and its completed reply.
            retained.low += row.Size * (from - retained.since); retained.high += row.Size * (by - retained.since);
            retained.deleted++;
          }
        }
        need((await listObjects()).length === 0 && (await uploads()).length === 0);
        await send(new sdk.DeleteBucketCommand({ Bucket: bucket }));
      }
      need(!await bucketPresent() && !(await bucketInventory()).some(b => b.Name === bucket));
      record({ kind: 'storage-bucket', state: 'removed', bucket }); created = false;
    });
    let counters;
    await attempt(async () => { if (meter) {
      const value = meter.snapshot(); need(value.reconciled); counters = streamCounters(value);
      if (retained) {
        need(!retainedInvalid && retained.deleted === retained.objects);
        const windowSeconds = now() - retained.since;
        need(Number.isFinite(retained.high) && retained.high >= retained.low && retained.low >= 0
          && retained.high <= retained.bytes * windowSeconds);
        counters.retainedStorage = { status: 'measured', scope: 'unversioned-cleanup-tail', windowSeconds,
          initialBytes: retained.bytes, deletedObjects: retained.deleted, remainingBytes: 0, remainingObjects: 0,
          byteSeconds: { low: retained.low, high: retained.high } };
      }
    } });
    await attempt(async () => { client?.destroy(); });
    await attempt(async () => { await proxy?.close(); });
    if (child) await attempt(async () => {
      assertOwnedRoot(args); stopping = true;
      if (!exited) child.kill('SIGTERM');
      // All storage requests have settled; forced backend teardown cannot alter their evidence.
      const timer = setTimeout(() => { child.kill('SIGKILL'); }, 2000);
      try { await done; } finally { clearTimeout(timer); }
      need(!bad); record({ kind: 'storage-process', state: 'collected', pid: child.pid });
    });
    if (failures.length === 0 && identity) await attempt(async () => {
      assertOwnedRoot(args); const s = lstatSync(directory);
      need(realpathSync(directory) === directory && s.ino === identity.ino && s.dev === identity.dev);
      record({ kind: 'storage-root', state: 'cleanup-intent', path: directory }); rmSync(directory, { recursive: true });
      need(!existsSync(directory)); record({ kind: 'storage-root', state: 'removed', path: directory });
    });
    if (failures.length || retainedInvalid) fail(); return counters;
  })();
  try {
    assertOwnedRoot(args); healthy();
    need(!existsSync(directory) && typeof sdk?.S3Client === 'function');
    record({ kind: 'storage-root', state: 'intent', path: directory }); mkdirSync(directory, { mode: 0o700 }); identity = lstatSync(directory);
    record({ kind: 'storage-process', state: 'intent' });
    child = spawn('weed', ['mini', '-dir=' + directory, '-ip=127.0.0.1', '-ip.bind=127.0.0.1',
      '-master.port=9333', '-master.port.grpc=19333', '-volume.port=8080', '-volume.port.grpc=18080',
      '-filer.port=8888', '-filer.port.grpc=18888', '-s3.port=8334', '-admin.ui=false', '-webdav=false', '-s3.port.iceberg=0', '-s3.port.lance=0'],
    { env: { PATH: process.env.PATH, HOME: args.root }, stdio: 'ignore' });
    done = new Promise(resolve => {
      child.once('error', () => { bad = true; });
      child.once('close', () => { exited = true; if (!stopping) bad = true; resolve(); });
    });
    if (child.pid) record({ kind: 'storage-process', state: 'started', pid: child.pid }); else fail();
    meter = createMeter({ phase: 'setup', clock: now });
    proxy = await createMeteringProxy({ target, meter, classify: correlatedStorageAttempt });
    client = makeClient('setup');
    const deadline = performance.now() + 30000; let ready = false;
    while (performance.now() < deadline) {
      healthy();
      try { const value = await send(new sdk.ListBucketsCommand({})); need(Array.isArray(value.Buckets ?? [])
        && !(value.Buckets ?? []).some(b => b.Name === bucket)); ready = true; break; } catch { healthy(); }
      await delay(100, undefined, { signal });
    }
    need(ready); healthy();
    record({ kind: 'storage-bucket', state: 'intent', bucket }); created = true;
    await send(new sdk.CreateBucketCommand({ Bucket: bucket }));
    need((await listObjects()).length === 0 && (await uploads()).length === 0);
    healthy();
    record({ kind: 'storage-bucket', state: 'ready', bucket });
    return { target, bucket, finish: async (options = {}) => {
      try {
        need(options && Object.getPrototypeOf(options) === Object.prototype
          && Reflect.ownKeys(options).every(k => k === 'retained'));
        const input = options.retained;
        if (input !== undefined) {
          need(input && Object.getPrototypeOf(input) === Object.prototype
            && Reflect.ownKeys(input).length === 3 && Reflect.ownKeys(input).every(k => ['since', 'bytes', 'objects'].includes(k)
              && !Object.getOwnPropertyDescriptor(input, k).get));
          need(typeof input.since === 'number' && Number.isFinite(input.since) && input.since >= 0 && input.since <= now()
            && ['bytes', 'objects'].every(k => Number.isSafeInteger(input[k]) && input[k] >= 0));
          if (retained) need(['since', 'bytes', 'objects'].every(k => input[k] === retained[k]));
          else { need(!disposal); retained = { ...input, low: 0, high: 0, deleted: 0 }; }
        } else need(!retained);
        if (evidence) return structuredClone(evidence);
        healthy(); evidence = await dispose(); return structuredClone(evidence);
      } catch { await dispose().catch(() => {}); fail(); }
    }, close: async () => { await dispose(); } };
  } catch { await dispose().catch(() => {}); fail(); }
}
