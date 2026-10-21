import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import * as local from './local.mjs';

const invalid = { message: 'Invalid cloud cost replay cadence' };
const available = () => assert.equal(typeof local.replayScheduledSales, 'function', 'the local runner needs a bounded sale scheduler');
const event = (offsetSeconds, n) => ({ offsetSeconds, sale: { n, private: 'SYNTHETIC_PRIVATE_SALE' } });
function fixture(t, offsets = [0, 20, 20, 50], duration = 0.5) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE committed (n INTEGER, at REAL)'); t.after(() => db.close());
  let now = 900000;
  const timing = { now: () => now, wait: async ms => { now += ms; } };
  const args = { events: offsets.map(event), expectedSales: offsets.length,
    cadence: { mode: 'accelerated', factor: 10 }, windowSeconds: 10, timing,
    recordSale: async sale => { db.prepare('INSERT INTO committed VALUES (?,?)').run(sale.n, (now - 900000) / 1000); now += duration * 1000; } };
  const rows = () => db.prepare('SELECT * FROM committed ORDER BY rowid').all().map(v => ({ ...v }));
  return { args, rows, advance: ms => now += ms };
}

// Scaling the wrong interval, sorting ties, or adding write duration to each wait changes stored arrival times.
test('acceleratedCadencePreservesEverySaleAndUsesAbsoluteTargets', async t => {
  available(); const f = fixture(t);
  const result = await local.replayScheduledSales(f.args);
  assert.deepEqual(f.rows(), [{ n: 0, at: 0 }, { n: 1, at: 2 }, { n: 2, at: 2.5 }, { n: 3, at: 5 }]);
  assert.deepEqual(result, { complete: true, cadence: { mode: 'accelerated', factor: 10, coveredSeconds: 50 },
    counts: { expected: 4, attempted: 4, successful: 4, failed: 0 }, timing: { elapsedSeconds: 5.5, maxLagSeconds: 0.5 } });
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE'), false);
});

test('originalCadenceKeepsInitialSilenceAndUnscaledIntervals', async t => {
  available(); const f = fixture(t, [1, 3]);
  const result = await local.replayScheduledSales({ ...f.args, cadence: { mode: 'original', factor: 1 } });
  assert.deepEqual(f.rows(), [{ n: 0, at: 1 }, { n: 1, at: 3 }]);
  assert.deepEqual(result.cadence, { mode: 'original', factor: 1, coveredSeconds: 3 });
  assert.deepEqual(result.timing, { elapsedSeconds: 3.5, maxLagSeconds: 0 });
});

// Invalid tail entries must be rejected before even the first valid sale is committed.
test('invalidOrIncompleteScheduleRefusedBeforeAnySale', async t => {
  available(); const f = fixture(t);
  for (const change of [
    { events: [] }, { events: [event(0, 0)], expectedSales: 2 }, { expectedSales: 0 }, { expectedSales: 4.5 },
    { events: [event(0, 0), event(-1, 1)], expectedSales: 2 },
    { events: [event(0, 0), event(NaN, 1)], expectedSales: 2 },
    { events: [event(0, 0), event(Infinity, 1)], expectedSales: 2 },
    { events: [event(1, 0), event(0, 1)], expectedSales: 2 },
    { events: [event(0, 0), { ...event(1, 1), payload: 'SYNTHETIC_PRIVATE' }], expectedSales: 2 },
    { events: [event(0, 0), { offsetSeconds: 1, sale: null }], expectedSales: 2 },
    { events: [event(0, 0), { offsetSeconds: '1', sale: {} }], expectedSales: 2 },
    { cadence: { mode: 'original', factor: 2 } }, { cadence: { mode: 'accelerated', factor: 0.5 } },
    { cadence: { mode: 'accelerated', factor: Infinity } }, { cadence: { mode: 'other', factor: 10 } },
    { cadence: { mode: 'accelerated', factor: 10, private: 'SYNTHETIC_PRIVATE' } },
    { windowSeconds: 0 }, { windowSeconds: 3601 }, { windowSeconds: Infinity },
    { windowSeconds: 5 }, { recordSale: undefined },
  ]) await assert.rejects(local.replayScheduledSales({ ...f.args, ...change }), invalid);
  assert.deepEqual(f.rows(), []);
});

test('cancelledBeforeStartCannotWrite', async t => {
  available(); const f = fixture(t); const controller = new AbortController(); controller.abort(new Error('SYNTHETIC_PRIVATE'));
  await assert.rejects(local.replayScheduledSales({ ...f.args, signal: controller.signal }), invalid);
  assert.deepEqual(f.rows(), []);
});

test('cancellationDuringWaitDoesNotAdmitTheNextSale', async t => {
  available(); const f = fixture(t, [0, 20]); const controller = new AbortController();
  await assert.rejects(local.replayScheduledSales({ ...f.args, signal: controller.signal,
    timing: { now: f.args.timing.now, wait: async ms => { f.advance(ms); controller.abort(); } } }), invalid);
  assert.deepEqual(f.rows(), [{ n: 0, at: 0 }]);
});

test('lateWakeAndSlowSaleCannotClaimACompleteSample', async t => {
  available(); const f = fixture(t, [0, 20]);
  await assert.rejects(local.replayScheduledSales({ ...f.args,
    timing: { now: f.args.timing.now, wait: async () => f.advance(10000) } }), invalid);
  assert.deepEqual(f.rows(), [{ n: 0, at: 0 }]);
  const slow = fixture(t, [0], 11);
  await assert.rejects(local.replayScheduledSales(slow.args), invalid);
  assert.deepEqual(slow.rows(), [{ n: 0, at: 0 }]);
});

test('failedSaleStopsTheSequenceWithoutLeakingItsError', async t => {
  available(); const f = fixture(t);
  await assert.rejects(local.replayScheduledSales({ ...f.args, recordSale: async sale => {
    if (sale.n === 1) throw new Error('SYNTHETIC_PRIVATE_SALE');
    await f.args.recordSale(sale);
  } }), e => e.message === invalid.message && !e.stack.includes('SYNTHETIC_PRIVATE'));
  assert.deepEqual(f.rows(), [{ n: 0, at: 0 }]);
});

test('cancellationDrainsAdmittedSaleBeforeReturning', async t => {
  available(); const f = fixture(t, [0, 1]); const controller = new AbortController();
  let release, admitted; const entering = new Promise(r => admitted = r);
  const gate = new Promise(r => release = r); let returned = false;
  const running = local.replayScheduledSales({ ...f.args, signal: controller.signal, recordSale: async (sale, signal) => {
    assert.equal(signal.aborted, false); admitted(); await gate;
    assert.equal(signal.aborted, true); await f.args.recordSale(sale);
  } });
  const rejected = assert.rejects(running, invalid).then(() => { returned = true; });
  await entering; controller.abort(); await delay(10);
  assert.equal(returned, false, 'admitted writes must finish before scratch cleanup');
  release(); await rejected;
  assert.deepEqual(f.rows(), [{ n: 0, at: 0 }]);
});

test('physicalDeadlineSignalsTheWriterAndWaitsForItsCleanup', async t => {
  available(); const f = fixture(t, [0], 0); let observedAbort = false;
  await assert.rejects(local.replayScheduledSales({ ...f.args, timing: undefined, windowSeconds: 0.03,
    recordSale: async (sale, signal) => {
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      observedAbort = true; await f.args.recordSale(sale);
    } }), invalid);
  assert.equal(observedAbort, true);
  assert.deepEqual(f.rows(), [{ n: 0, at: 0 }]);
});

test('realTimerWaitIsCancelledWithoutAdmittingSale', async t => {
  available(); const f = fixture(t, [5]); const controller = new AbortController();
  const abort = setTimeout(() => controller.abort(), 20); t.after(() => clearTimeout(abort));
  await assert.rejects(local.replayScheduledSales({ ...f.args, timing: undefined,
    cadence: { mode: 'original', factor: 1 }, signal: controller.signal }), invalid);
  assert.deepEqual(f.rows(), []);
});

test('clockRegressionAndInvalidClockRefuseBeforeNextWrite', async t => {
  available();
  for (const invalidTime of [NaN, Infinity, -1, '0']) {
    const f = fixture(t);
    await assert.rejects(local.replayScheduledSales({ ...f.args, timing: { ...f.args.timing, now: () => invalidTime } }), invalid);
    assert.deepEqual(f.rows(), []);
  }
  const f = fixture(t, [0, 20]);
  await assert.rejects(local.replayScheduledSales({ ...f.args, timing: {
    now: f.args.timing.now, wait: async () => f.advance(-1000),
  } }), invalid);
  assert.deepEqual(f.rows(), [{ n: 0, at: 0 }]);
});

test('earlyWakeIsRecheckedAndCannotMoveSaleForward', async t => {
  available(); const f = fixture(t, [1], 0);
  const result = await local.replayScheduledSales({ ...f.args, cadence: { mode: 'original', factor: 1 },
    timing: { now: f.args.timing.now, wait: async ms => f.advance(Math.min(ms, 250)) } });
  assert.deepEqual(f.rows(), [{ n: 0, at: 1 }]);
  assert.equal(result.timing.elapsedSeconds, 1);
});

test('scheduleCannotChangeDuringAnEarlierAdmittedWrite', async t => {
  available(); const f = fixture(t, [0, 20]); const original = f.args.events[1].sale;
  const result = await local.replayScheduledSales({ ...f.args, recordSale: async sale => {
    if (sale.n === 0) { f.args.events[1] = event(0, 99); f.args.events.pop(); }
    else assert.equal(sale, original, 'the private sale payload must not be translated by the scheduler');
    await f.args.recordSale(sale);
  } });
  assert.deepEqual(f.rows(), [{ n: 0, at: 0 }, { n: 1, at: 2 }]);
  assert.equal(result.counts.successful, 2);
});

test('nonAdvancingWaitCannotSpinOrPretendToObserveTime', async t => {
  available(); const f = fixture(t, [1], 0); let waits = 0;
  await assert.rejects(local.replayScheduledSales({ ...f.args, cadence: { mode: 'original', factor: 1 },
    timing: { now: f.args.timing.now, wait: async () => { if (++waits > 1) f.advance(1000); } } }), invalid);
  assert.deepEqual(f.rows(), []);
});

test('oversizedScheduleAndInvalidSignalRefusedWithoutRawErrors', async t => {
  available(); const f = fixture(t, [0, 20, 20, 50], 0);
  const events = Array(100001).fill(event(0, 0));
  await assert.rejects(local.replayScheduledSales({ ...f.args, events, expectedSales: events.length }), invalid);
  for (const signal of [null, {}, 'SYNTHETIC_PRIVATE', { aborted: false,
    addEventListener() { throw new Error('SYNTHETIC_PRIVATE'); },
    removeEventListener() { throw new Error('SYNTHETIC_PRIVATE'); } }])
    await assert.rejects(local.replayScheduledSales({ ...f.args, signal }),
      e => e.message === invalid.message && !e.stack.includes('SYNTHETIC_PRIVATE'));
  assert.deepEqual(f.rows(), []);
});

test('originalCadenceCannotSilentlyAcceptAcceleration', async t => {
  available(); const f = fixture(t, [0, 1], 0);
  await assert.rejects(local.replayScheduledSales({ ...f.args, cadence: { mode: 'original', factor: 2 } }), invalid);
  assert.deepEqual(f.rows(), []);
});
