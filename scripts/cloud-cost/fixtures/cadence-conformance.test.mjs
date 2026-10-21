// Run explicitly with a prepared public Waitron runtime and generated synthetic state only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openReplay } from '../waitron-adapter.mjs';
import { replayScheduledSales } from '../local.mjs';

const fixture = JSON.parse(readFileSync(process.env.COST_SYNTHETIC_CONFIG, 'utf8'));
const config = {
  localEndpoints: { s3: 'http://s3:8333', postgres: 'postgresql://fixture:fixture@postgres:5432/fixture',
    smtp: 'smtp://mailpit:1025', fiscal: 'http://fiscal:8080', gateway: 'https://gateway:443' },
  senders: { fiscal: 'disabled', mail: 'capture', acme: 'disabled', dns: 'disabled' },
};
const initial = {
  taxpayer: { country: 'ES', taxId: '12345678Z', legalName: 'Synthetic SL' },
  location: { name: 'Synthetic venue', invoiceLocales: ['es'], operationDescription: 'Servicio',
    timeZone: 'Europe/Madrid', dayCutover: '06:00:00' },
  nodeName: 'Synthetic node', seriesCode: 'R', fullSeriesCode: 'F', idSistemaInformatico: 'WR',
};
const sale = i => {
  const instant = new Date(Date.UTC(2026, 0, 1, 12, i));
  return { origin: { source: 'operator_script', deviceId: null }, locale: 'es', invoiceLocales: ['es'],
    total: '12.10', lines: [{ lineNo: 1, name: `Synthetic item ${i}`, descriptions: { es: `Synthetic item ${i}` },
      quantity: '1', unitPrice: '10.00', vatRate: '21.00', lineTotal: '10.00' }],
    clock: { now: () => ({ instant, offsetMinutes: 60, confident: true, confidence: 'anchored', anchorAgeSeconds: 0 }) },
    settlement: { kind: 'immediate', tenders: [{ method: 'cash', amount: '12.10', tipAmount: '0', settledAt: instant }] } };
};
async function open(t) {
  const stateRoot = mkdtempSync(join(fixture.stateParent, 'cadence-')); chmodSync(stateRoot, 0o700);
  let replay;
  t.after(async () => { try { await replay?.close(); } finally { rmSync(stateRoot, { recursive: true, force: true }); } });
  replay = await openReplay({ codeRoot: fixture.codeRoot, stateRoot, config, initial });
  return { replay, stateRoot };
}

// Dropping, reordering, translating, duplicating, or bypassing a sale changes the durable application records.
for (const cadence of [{ mode: 'original', factor: 1 }, { mode: 'accelerated', factor: 3 }])
  test(`${cadence.mode}SchedulerUsesNormalSaleWriterWithUnchangedFiscalRules`, async t => {
    const { replay, stateRoot } = await open(t);
    const events = [0, 0.05, 0.05, 0.15].map((offsetSeconds, i) => ({ offsetSeconds, sale: sale(i) }));
    const summary = await replayScheduledSales({ events, expectedSales: 4, cadence, windowSeconds: 10,
      recordSale: value => replay.recordSale(value) });
    assert.deepEqual(summary.counts, { expected: 4, attempted: 4, successful: 4, failed: 0 });
    assert.deepEqual(summary.cadence, { ...cadence, coveredSeconds: 0.15 });
    assert.ok(summary.timing.elapsedSeconds >= 0.15 / cadence.factor);
    assert.equal(JSON.stringify(summary).includes('Synthetic'), false);
    const db = new DatabaseSync(join(stateRoot, 'venue/venue.db'), { readOnly: true });
    try {
      assert.deepEqual(db.prepare('SELECT invoice_number, total FROM sales ORDER BY invoice_number').all().map(v => ({ ...v })),
        [{ invoice_number: 1, total: 1210 }, { invoice_number: 2, total: 1210 }, { invoice_number: 3, total: 1210 }, { invoice_number: 4, total: 1210 }]);
      assert.deepEqual(db.prepare('SELECT name FROM sale_lines ORDER BY rowid').all().map(v => v.name),
        ['Synthetic item 0', 'Synthetic item 1', 'Synthetic item 2', 'Synthetic item 3']);
      assert.equal(db.prepare('SELECT count(*) AS n FROM tenders').get().n, 4);
      assert.equal(db.prepare('SELECT count(*) AS n FROM sale_settlements').get().n, 4);
      assert.equal(db.prepare("SELECT count(*) AS n FROM envios WHERE estado='pendiente'").get().n, 4);
      assert.equal(db.prepare('SELECT count(*) AS n FROM registros_facturacion').get().n, 4);
      assert.equal(new Set(db.prepare('SELECT huella FROM registros_facturacion').all().map(v => v.huella)).size, 4);
      assert.equal(db.prepare("SELECT next_number AS n FROM invoice_series WHERE code='R'").get().n, 5);
    } finally { db.close(); }
    assert.deepEqual(replay.counts(), { attempted: 4, successful: 4, failed: 0 });
    assert.deepEqual(await replay.verify(), { ok: true, issues: 0 });
    const writer = new DatabaseSync(join(stateRoot, 'venue/venue.db'));
    try { assert.throws(() => writer.exec('UPDATE sales SET total=0'), /append.only/); }
    finally { writer.close(); }
  });

test('genuineWriterRefusalStopsCadenceAndPreservesRollback', async t => {
  const { replay, stateRoot } = await open(t);
  const events = [0, 0.05, 0.1].map((offsetSeconds, i) => ({ offsetSeconds, sale: sale(i) }));
  events[1].sale.vatBreakdown = [{ rate: '21.00', base: '10.00', tax: '0' }];
  await assert.rejects(replayScheduledSales({ events, expectedSales: 3,
    cadence: { mode: 'original', factor: 1 }, windowSeconds: 10, recordSale: value => replay.recordSale(value) }),
    { message: 'Invalid cloud cost replay cadence' });
  assert.deepEqual(replay.counts(), { attempted: 2, successful: 1, failed: 1 });
  assert.deepEqual(await replay.verify(), { ok: true, issues: 0 });
  const db = new DatabaseSync(join(stateRoot, 'venue/venue.db'), { readOnly: true });
  try {
    assert.deepEqual(db.prepare('SELECT invoice_number, total FROM sales').all().map(v => ({ ...v })), [{ invoice_number: 1, total: 1210 }]);
    assert.deepEqual(db.prepare('SELECT name FROM sale_lines').all().map(v => v.name), ['Synthetic item 0']);
    assert.equal(db.prepare('SELECT count(*) AS n FROM registros_facturacion').get().n, 1);
    assert.equal(db.prepare("SELECT next_number AS n FROM invoice_series WHERE code='R'").get().n, 2);
  } finally { db.close(); }
});
