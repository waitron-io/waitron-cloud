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
  const bucket = 'cost-' + randomUUID(), target = 'http://127.0.0.1:8334';
  const record = entry => {
    assertOwnedRoot(args); const value = JSON.parse(readFileSync(args.journal.path, 'utf8'));
    (value.localResources ??= []).push(entry); writeFileSync(args.journal.path, JSON.stringify(value), { mode: 0o600 });
  };
  const healthy = () => need(!signal?.aborted && !exited && !bad);
  let cleanupSignal;
  const send = command => { assertOwnedRoot(args); return client.send(command, { abortSignal: cleanupSignal ?? signal }); };
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
  const dispose = () => disposal ??= (async () => {
    cleanupSignal = AbortSignal.timeout(10000);
    if (proxy) { client?.destroy(); client = makeClient('cleanup'); }
    const failures = []; const attempt = async fn => { try { await fn(); } catch { failures.push(true); } };
    if (created) await attempt(async () => {
      assertOwnedRoot(args); record({ kind: 'storage-bucket', state: 'cleanup-intent', bucket });
      for (const row of await uploads()) {
        need(typeof row.Key === 'string' && row.Key.startsWith('stream/') && typeof row.UploadId === 'string' && row.UploadId.length > 0);
        await send(new sdk.AbortMultipartUploadCommand({ Bucket: bucket, Key: row.Key, UploadId: row.UploadId }));
      }
      for (const row of await listObjects()) await send(new sdk.DeleteObjectCommand({ Bucket: bucket, Key: row.Key }));
      need((await listObjects()).length === 0 && (await uploads()).length === 0);
      await send(new sdk.DeleteBucketCommand({ Bucket: bucket }));
      const found = await send(new sdk.ListBucketsCommand({})); need(!(found.Buckets ?? []).some(b => b.Name === bucket));
      record({ kind: 'storage-bucket', state: 'removed', bucket }); created = false;
    });
    let counters;
    await attempt(async () => { if (meter) { const value = meter.snapshot(); need(value.reconciled); counters = streamCounters(value); } });
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
    if (failures.length) fail(); return counters;
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
    meter = createMeter({ phase: 'setup', clock: () => performance.now() / 1000 });
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
    record({ kind: 'storage-bucket', state: 'ready', bucket });
    return { target, bucket, finish: async () => {
      if (evidence) return structuredClone(evidence);
      healthy();
      evidence = await dispose(); return structuredClone(evidence);
    }, close: async () => { await dispose(); } };
  } catch { await dispose().catch(() => {}); fail(); }
}
