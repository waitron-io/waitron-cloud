// This explicit local integration command uses prepared public code and synthetic sales only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as adapter from '../waitron-adapter.mjs';

const fixture = JSON.parse(readFileSync(process.env.COST_SYNTHETIC_CONFIG, 'utf8'));
const initial = {
  taxpayer: { country: 'ES', taxId: '12345678Z', legalName: 'Synthetic SL' },
  location: { name: 'Synthetic venue', invoiceLocales: ['es'], operationDescription: 'Servicio',
    timeZone: 'Europe/Madrid', dayCutover: '06:00:00' },
  nodeName: 'Synthetic node', seriesCode: 'R', fullSeriesCode: 'F', idSistemaInformatico: 'WR',
};
const config = {
  localEndpoints: { s3: 'http://s3:8333', postgres: 'postgresql://fixture:fixture@postgres:5432/fixture',
    smtp: 'smtp://mailpit:1025', fiscal: 'http://fiscal:8080', gateway: 'https://gateway:443' },
  senders: { fiscal: 'disabled', mail: 'capture', acme: 'disabled', dns: 'disabled' },
};
const sale = i => {
  const instant = new Date(Date.UTC(2026, 0, 1, 12, i));
  return { origin: { source: 'operator_script', deviceId: null }, locale: 'es', invoiceLocales: ['es'],
    total: '12.10', lines: [{ lineNo: 1, name: 'Synthetic item', descriptions: { es: 'Synthetic item' },
      quantity: '1', unitPrice: '10.00', vatRate: '21.00', lineTotal: '10.00' }],
    clock: { now: () => ({ instant, offsetMinutes: 60, confident: true, confidence: 'anchored', anchorAgeSeconds: 0 }) },
    settlement: { kind: 'immediate', tenders: [{ method: 'cash', amount: '12.10', tipAmount: '0', settledAt: instant }] } };
};
async function open(t) {
  assert.equal(typeof adapter.openReplay, 'function', 'the adapter must invoke the prepared real Waitron runtime');
  const stateRoot = mkdtempSync(join(fixture.stateParent, 'conformance-')); chmodSync(stateRoot, 0o700);
  let replay;
  t.after(async () => { try { await replay?.close(); } finally { rmSync(stateRoot, { recursive: true, force: true }); } });
  replay = await adapter.openReplay({ codeRoot: fixture.codeRoot, stateRoot, config, initial });
  return { replay, stateRoot };
}
// Bypassing recordSale, changing its inputs, or omitting transactions breaks these stored effects.
test('allBillsReplayedThroughRecordSale', async t => {
  const { replay, stateRoot } = await open(t);
  await Promise.all([replay.recordSale(sale(0)), replay.recordSale(sale(1)), replay.recordSale(sale(2))]);
  const db = new DatabaseSync(join(stateRoot, 'venue/venue.db'), { readOnly: true });
  try {
    assert.deepEqual(db.prepare('SELECT invoice_number, total FROM sales ORDER BY invoice_number').all()
      .map(r => ({ ...r })), [{ invoice_number: 1, total: 1210 }, { invoice_number: 2, total: 1210 }, { invoice_number: 3, total: 1210 }]);
    assert.equal(db.prepare('SELECT count(*) AS n FROM sale_lines').get().n, 3);
    assert.equal(db.prepare('SELECT count(*) AS n FROM tenders').get().n, 3);
    assert.equal(db.prepare('SELECT count(*) AS n FROM sale_settlements').get().n, 3);
    assert.equal(db.prepare("SELECT count(*) AS n FROM envios WHERE estado='pendiente'").get().n, 3);
    assert.equal(db.prepare('SELECT next_number AS n FROM invoice_series WHERE code=\'R\'').get().n, 4);
    assert.equal(db.prepare('SELECT count(*) AS n FROM registros_facturacion').get().n, 3);
    const hashes = db.prepare('SELECT huella FROM registros_facturacion ORDER BY secuencia').all();
    assert.equal(new Set(hashes.map(r => r.huella)).size, 3);
    assert.ok(hashes.every(r => /^[A-F0-9]{64}$/.test(r.huella)));
  } finally { db.close(); }
  const writer = new DatabaseSync(join(stateRoot, 'venue/venue.db'));
  try { assert.throws(() => writer.prepare('UPDATE sales SET total=0').run(), /append.only/); }
  finally { writer.close(); }
  assert.deepEqual(await replay.verify(), { ok: true, issues: 0 });
  assert.deepEqual(replay.counts(), { attempted: 3, successful: 3, failed: 0 });
});
test('failedSaleRollsBackWithoutWeakeningNormalChecks', async t => {
  const { replay, stateRoot } = await open(t); const invalid = sale(0);
  invalid.vatBreakdown = [{ rate: '21.00', base: '10.00', tax: '0' }];
  await assert.rejects(replay.recordSale(invalid), { message: 'Invalid cloud cost replay runtime' });
  await replay.recordSale(sale(1));
  const db = new DatabaseSync(join(stateRoot, 'venue/venue.db'), { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT count(*) AS n FROM sales').get().n, 1);
    assert.equal(db.prepare('SELECT invoice_number AS n FROM sales').get().n, 1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM registros_facturacion').get().n, 1);
  } finally { db.close(); }
  assert.deepEqual(replay.counts(), { attempted: 2, successful: 1, failed: 1 });
});
test('closeWaitsForAdmittedSalesAndIsIdempotent', async t => {
  const { replay, stateRoot } = await open(t);
  const submitted = replay.recordSale(sale(0)); const closing = replay.close();
  await assert.doesNotReject(submitted); await closing; await replay.close();
  await assert.rejects(replay.recordSale(sale(1)), /Invalid cloud cost replay runtime/);
  const db = new DatabaseSync(join(stateRoot, 'venue/venue.db'), { readOnly: true });
  try { assert.equal(db.prepare('SELECT count(*) AS n FROM sales').get().n, 1); }
  finally { db.close(); }
});
// Removing the transaction would leave the sale and allocated number after settlement refuses it.
test('lateSettlementFailureRollsBackSaleAndAllocation', async t => {
  const { replay, stateRoot } = await open(t); const invalid = sale(0);
  invalid.settlement.tenders[0].amount = '11.00';
  await assert.rejects(replay.recordSale(invalid), /Invalid cloud cost replay runtime/);
  const db = new DatabaseSync(join(stateRoot, 'venue/venue.db'), { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT count(*) AS n FROM sales').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM tenders').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM registros_facturacion').get().n, 0);
    assert.equal(db.prepare("SELECT next_number AS n FROM invoice_series WHERE code='R'").get().n, 1);
  } finally { db.close(); }
  await replay.recordSale(sale(1));
  assert.deepEqual(replay.counts(), { attempted: 2, successful: 1, failed: 1 });
});
test('sourceIdentityCannotBeInjectedIntoFreshReplay', async t => {
  const { replay, stateRoot } = await open(t);
  for (const identity of [{ nodeId: 'source-node' }, { seriesId: 'source-series' }])
    await assert.rejects(replay.recordSale({ ...sale(0), ...identity }), /Invalid cloud cost replay runtime/);
  const db = new DatabaseSync(join(stateRoot, 'venue/venue.db'), { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT count(*) AS n FROM sales').get().n, 0);
    assert.equal(db.prepare("SELECT next_number AS n FROM invoice_series WHERE code='R'").get().n, 1);
  } finally { db.close(); }
  assert.deepEqual(replay.counts(), { attempted: 2, successful: 0, failed: 2 });
});
