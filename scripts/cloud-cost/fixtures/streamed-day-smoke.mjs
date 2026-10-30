// Generated venue only; this is a real native-stream join, never a source-data reader.
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { openReplay } from '/code/cost-waitron-adapter.mjs';
import { preparePrivateCopy } from '/code/cloud-cost-runner/local.mjs';
import { replayPrivateDay } from '/code/cloud-cost-runner/private-replay.mjs';
import { withStreamedDayDiagnostics } from '/code/cloud-cost-runner/streamed-day-diagnostics.mjs';
const sdk = createRequire('/app/packages/backups/package.json')('@aws-sdk/client-s3');
const parent = '/state/generated-streamed-day', source = parent + '/source', root = parent + '/owned';
let sourceReplay, copy, client, created = false, stage = 'setup';
const diagnosticTrace = [];
const Bucket = 'synthetic-streamed-day';
const mode = process.argv[2] ?? 'normal';
async function run() {
  for (const path of [parent, source, root]) mkdirSync(path, { mode: 0o700 });
  const { config, initial } = JSON.parse(readFileSync('/state/replay-config.json', 'utf8'));
  stage = 'source-open'; sourceReplay = await openReplay({ codeRoot: '/code', stateRoot: source, config, initial });
  for (const at of ['2026-01-01T12:00:00.000Z', '2026-01-02T12:00:00.000Z', '2026-01-02T12:00:00.050Z', '2026-01-02T12:00:00.100Z']) {
    const instant = new Date(at);
    stage = 'source-sale'; await sourceReplay.recordSale({ origin: { source: 'operator_script', deviceId: null }, locale: 'es', invoiceLocales: ['es'], total: '12.10',
      lines: [{ lineNo: 1, name: 'PRIVATE_STREAMED_DAY_ITEM', descriptions: { es: 'Artículo' }, quantity: '1', unitPrice: '10.00', vatRate: '21.00', lineTotal: '10.00' }],
      clock: { now: () => ({ instant, offsetMinutes: 60, confident: true, confidence: 'anchored', anchorAgeSeconds: 0 }) },
      settlement: { kind: 'immediate', tenders: [{ method: 'cash', amount: '12.10', tipAmount: '0', settledAt: instant }] } });
  }
  stage = 'source-close'; await sourceReplay.close();
  const token = randomBytes(32).toString('hex'), journal = { token, path: root + '/journal.json' };
  writeFileSync(root + '/.cloud-cost-owner', token, { mode: 0o600 });
  writeFileSync(journal.path, JSON.stringify({ schemaVersion: 1, source, root, ownershipToken: token }), { mode: 0o600 });
  const args = { source, root, journal };
  const sourceDb = new DatabaseSync(source + '/venue/venue.db', { readOnly: true }); let locationId;
  try { locationId = sourceDb.prepare('SELECT id FROM locations').get().id;
    stage = 'source-copy'; copy = await preparePrivateCopy({ ...args, database: source + '/venue/venue.db' });
  } finally { sourceDb.close(); }
  const fingerprint = () => createHash('sha256').update(readFileSync(copy.database)).digest('hex'), before = fingerprint();
  client = new sdk.S3Client({ endpoint: 'http://127.0.0.1:8334', region: 'eu-north-1', forcePathStyle: true, maxAttempts: 1,
    credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } });
  stage = 'bucket'; await client.send(new sdk.CreateBucketCommand({ Bucket })); created = true;
  const abort = new AbortController(); let result = null, refused = false, lastPhase;
  const observed = [], began = performance.now();
  stage = 'private-replay'; try { result = await replayPrivateDay({ ...args, database: copy.database, locationId, codeRoot: '/code', stateRoot: root + '/replay', config, initial,
    expected: { sales: 4, paid: 4, tradingDays: 2, busiest: 3 }, originalInventory: { timeZone: 'Europe/Madrid', days: 2, busiest: 3 },
    cadence: { mode: 'accelerated', factor: 100 }, windowSeconds: 10, signal: abort.signal,
    onDiagnostic(event) { observed.push({ ...event, elapsedMs: Math.round(performance.now() - began) });
      diagnosticTrace.push(event); if (diagnosticTrace.length > 32) diagnosticTrace.shift(); },
    onProgress(value) { lastPhase = value.phase; if (mode === 'cancel' && value.successfulSales === 1) abort.abort(); },
    stream: { binary: '/code/litestream', binarySha256: createHash('sha256').update(readFileSync('/code/litestream')).digest('hex'),
      target: 'http://127.0.0.1:8334', sdk, bucket: Bucket, versioned: false, startupSeconds: 2, idleSeconds: 2,
      windowSeconds: mode === 'deadline' ? 4.01 : 60 } }); }
  catch { if (mode === 'normal') throw Error('Synthetic normal replay refused'); refused = true; }
  if (mode === 'cancel' && !abort.signal.aborted || mode === 'deadline'
    && !observed.some(event => event.kind === 'replay-refusal' && event.elapsedMs >= 4010)) {
    console.error(JSON.stringify({ mode, lastPhase: lastPhase ?? null, refused, observed }));
    throw Error('Synthetic stop not reached');
  }
  stage = 'result'; const entries = JSON.parse(readFileSync(journal.path, 'utf8')).localResources;
  const started = entries.filter(e => e.kind === 'stream-process' && e.state === 'started');
  const collected = started.every(e => {
    if (!entries.some(r => r.kind === 'stream-process' && r.state === 'collected' && r.pid === e.pid)) return false;
    try { process.kill(e.pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; }
  });
  const inventory = await client.send(new sdk.ListObjectsV2Command({ Bucket }));
  const inventoryBytes = (inventory.Contents ?? []).reduce((n, row) => n + row.Size, 0);
  const clean = !existsSync(root + '/replay') && !existsSync(root + '/native-stream');
  return { result, refused, inventoryBytes, sourceUnchanged: before === fingerprint(), collected: (mode === 'deadline' ? started.length <= 2 : started.length === (mode === 'normal' ? 3 : 2)) && collected, clean,
    leaked: /PRIVATE_|2026-|\/state|synthetic-|taxId|locationId/.test(JSON.stringify(result)) };
}
try { process.stdout.write(JSON.stringify(await withStreamedDayDiagnostics(run,
  () => ({ stage, trace: diagnosticTrace }), text => console.error(text)))); }
catch { console.error('Synthetic streamed-day stage: ' + stage); process.exitCode = 1; }
finally {
  await sourceReplay?.close(); await copy?.close();
  if (created) {
    const found = await client.send(new sdk.ListObjectsV2Command({ Bucket }));
    for (const row of found.Contents ?? []) await client.send(new sdk.DeleteObjectCommand({ Bucket, Key: row.Key }));
    await client.send(new sdk.DeleteBucketCommand({ Bucket }));
  }
  client?.destroy(); rmSync(parent, { recursive: true, force: true });
}
