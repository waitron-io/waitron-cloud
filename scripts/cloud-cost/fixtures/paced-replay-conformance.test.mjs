// Generated sales and the pinned public runtime only; no venue source is opened here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { openReplay } from '../waitron-adapter.mjs';
import { runIsolatedReplay } from '../isolated-replay.mjs';

const prepared = JSON.parse(readFileSync(process.env.COST_SYNTHETIC_CONFIG, 'utf8'));
const stack = JSON.parse(readFileSync(process.env.COST_STACK_FIXTURE, 'utf8'));
const docker = argv => execFileSync('docker', argv, { env: { PATH: process.env.PATH, LANG: 'C', TZ: 'UTC' },
  encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const fingerprint = database => ['', '-wal', '-shm'].map(suffix => existsSync(database + suffix)
  ? createHash('sha256').update(readFileSync(database + suffix)).digest('hex') : null);

// Small, immediate replays miss the native stream's interaction with checkpoints and compaction.
test('pacedReplayRestoresEverySaleWithValidStructureAfterSustainedWrites', async t => {
  const parent = realpathSync(mkdtempSync(join(prepared.stateParent, 'paced-controller-')));
  const source = join(parent, 'source'), root = join(parent, 'owned');
  for (const path of [source, root]) mkdirSync(path, { mode: 0o700 });
  const token = randomBytes(32).toString('hex'), journal = { token, path: join(root, 'journal.json') };
  writeFileSync(join(root, '.cloud-cost-owner'), token, { mode: 0o600 });
  writeFileSync(journal.path, JSON.stringify({ schemaVersion: 1, source, root, ownershipToken: token }), { mode: 0o600 });
  const codeRoot = join(root, 'code'); cpSync(prepared.codeRoot, codeRoot, { recursive: true });
  cpSync(stack.litestreamBinary, join(codeRoot, 'litestream'));
  const config = { localEndpoints: { s3: 'http://s3:8333', postgres: 'postgresql://fixture:fixture@postgres:5432/fixture',
    smtp: 'smtp://mailpit:1025', fiscal: 'http://fiscal:8080', gateway: 'https://gateway:443' },
  senders: { fiscal: 'disabled', mail: 'capture', acme: 'disabled', dns: 'disabled' } };
  const initial = { taxpayer: { country: 'ES', taxId: '12345678Z', legalName: 'Synthetic SL' },
    location: { name: 'Synthetic venue', invoiceLocales: ['es'], operationDescription: 'Servicio',
      timeZone: 'Europe/Madrid', dayCutover: '06:00:00' },
    nodeName: 'Synthetic node', seriesCode: 'R', fullSeriesCode: 'F', idSistemaInformatico: 'WR' };
  let writer;
  t.after(async () => {
    try { await writer?.close(); }
    finally {
      for (const id of docker(['ps', '-aq', '--no-trunc', '--filter', 'label=io.waitron.cloud-cost.owner=' + token]).split('\n').filter(Boolean))
        docker(['rm', '-f', '-v', id]);
      for (const id of docker(['network', 'ls', '-q', '--filter', 'label=io.waitron.cloud-cost.owner=' + token]).split('\n').filter(Boolean))
        docker(['network', 'rm', id]);
      rmSync(parent, { recursive: true });
    }
  });
  writer = await openReplay({ codeRoot: prepared.codeRoot, stateRoot: source, config, initial });
  const instants = ['2026-01-01T12:00:00.000Z', ...Array.from({ length: 207 }, (_, i) =>
    new Date(Date.parse('2026-01-02T12:00:00.000Z') + i * 30000).toISOString())];
  for (const at of instants) {
    const instant = new Date(at);
    await writer.recordSale({ origin: { source: 'operator_script', deviceId: null }, locale: 'es', invoiceLocales: ['es'], total: '12.10',
      lines: [{ lineNo: 1, name: 'Generated item', descriptions: { es: 'Artículo' }, quantity: '1',
        unitPrice: '10.00', vatRate: '21.00', lineTotal: '10.00' }],
      clock: { now: () => ({ instant, offsetMinutes: 60, confident: true, confidence: 'anchored', anchorAgeSeconds: 0 }) },
      settlement: { kind: 'immediate', tenders: [{ method: 'cash', amount: '12.10', tipAmount: '0', settledAt: instant }] } });
  }
  const database = join(source, 'venue/venue.db'), db = new DatabaseSync(database, { readOnly: true });
  let locationId;
  try { locationId = db.prepare('SELECT id FROM locations').get().id; } finally { db.close(); }
  const before = fingerprint(database);
  const result = await runIsolatedReplay({ source, root, journal, codeRoot, database, locationId, config, initial,
    expected: { sales: 208, paid: 208, tradingDays: 2, busiest: 207 },
    originalInventory: { timeZone: 'Europe/Madrid', days: 2, busiest: 207 },
    cadence: { mode: 'accelerated', factor: 100 }, replayWindowSeconds: 120, windowSeconds: 200, image: stack.image,
    stream: { binarySha256: createHash('sha256').update(readFileSync(join(codeRoot, 'litestream'))).digest('hex'),
      copyImage: docker(['image', 'inspect', 'node:26.11.1-slim', '--format', '{{.Id}}']),
      startupSeconds: 2, idleSeconds: 2, windowSeconds: 150 } });
  assert.deepEqual(result.admission.replay.counts, { expected: 207, attempted: 207, successful: 207, failed: 0 });
  assert.ok(result.admission.replay.timing.elapsedSeconds >= 61.8);
  assert.deepEqual(result.admission.stream.restored, { sales: 207, integrity: true });
  assert.deepEqual(result.admission.stream.native, { version: '0.5.17', writerStarts: 1, phaseRestarts: 0 });
  assert.deepEqual(result.streamAccounting.discrepancy, { attempts: 0, bytesIn: 0, bytesOut: 0 });
  assert.deepEqual(result.cleanup, { workerContainers: 0, networks: 0, privateCopies: 0 });
  assert.deepEqual(fingerprint(database), before);
  assert.equal(existsSync(join(root, 'isolated-replay')), false);
  assert.equal(docker(['ps', '-aq', '--filter', 'label=io.waitron.cloud-cost.owner=' + token]), '');
  assert.equal(docker(['network', 'ls', '-q', '--filter', 'label=io.waitron.cloud-cost.owner=' + token]), '');
});
