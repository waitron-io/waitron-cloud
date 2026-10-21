import { test } from 'node:test';
import assert from 'node:assert/strict';
const module = await import('./service-receipt.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./service-receipt.mjs', import.meta.url).href) return {};
  throw error;
});
const bad = { message: 'Invalid cloud cost service receipt' };
function fixture() {
  const row = (outcome, retryOrdinal, bytesIn) => ({ phase: 'workload', operation: 'fiscal', requestClass: 'fiscal',
    outcome, retryOrdinal, attempts: 1, successful: outcome === 'success' ? 1 : 0,
    failed: outcome === 'success' ? 0 : 1, retried: retryOrdinal ? 1 : 0,
    bytesIn, bytesOut: 7, attemptedBytesIn: bytesIn, attemptedBytesOut: 7 });
  const requests = [row('server-error', 0, 2), row('success', 1, 4), row('client-error', 0, 4)];
  return {
    metadata: { runId: '12345678-1234-4234-8234-123456789012', cloudRevision: 'a'.repeat(40),
      window: { startedAt: '2026-10-21T00:00:00.000Z', endedAt: '2026-10-21T00:01:00.000Z', elapsedSeconds: 60 } },
    mail: { scope: 'captured-mail-operations', status: 'measured', reconciled: true,
      producer: { attempts: 3, accepted: 2, refused: 1, retried: 1 }, observer: { attempts: 3, accepted: 2, refused: 1 },
      discrepancy: { attempts: 0, accepted: 0, refused: 0 }, operations: [
        { action: 'password_changed', outcome: 'refused', retryOrdinal: 0, attempts: 1 },
        { action: 'password_changed', outcome: 'accepted', retryOrdinal: 1, attempts: 1 },
        { action: 'verification', outcome: 'accepted', retryOrdinal: 0, attempts: 1 },
      ], billing: { quantity: null, status: 'unknown' } },
    fiscal: { status: 'measured', reconciled: true, gaps: ['request-billing:unknown'],
      billing: [{ phase: 'workload', requestClass: 'fiscal', quantity: null, status: 'unknown' }],
      observedRequests: structuredClone(requests), accounting: { requests, objects: [],
        producer: { attempts: 3, bytesIn: 10, bytesOut: 21 }, observer: { attempts: 3, bytesIn: 10, bytesOut: 21 },
        discrepancy: { attempts: 0, bytesIn: 0, bytesOut: 0 } } },
    cleanup: { listeners: 0, clients: 0, schemas: 0 },
  };
}
function build(f) {
  assert.equal(typeof module.buildServiceReceipt, 'function', 'admit local service measurements before anonymous export');
  return module.buildServiceReceipt(f);
}

// Dropping refusals, retries or one service must change these independently calculated counts.
test('serviceReceiptKeepsBothIndependentMetersAndScenarioCountsWithoutInventingFrequencies', () => {
  const f = fixture(), receipt = build(f);
  assert.deepEqual(receipt.summary, {
    mail: { attempts: 3, accepted: 2, refused: 1, retried: 1, bytes: null },
    fiscal: { attempts: 3, successful: 1, failed: 2, retried: 1, bodyBytesIn: 10, bodyBytesOut: 21 },
  });
  assert.deepEqual(receipt.mail, f.mail); assert.deepEqual(receipt.fiscal, f.fiscal);
  assert.deepEqual(receipt.frequency, { mailScenariosPerMonth: null, fiscalScenariosPerMonth: null });
  assert.equal(receipt.scope, 'local-scenario'); assert.equal(receipt.costMeasured, false);
  assert.equal(receipt.kind, 'local-service-aggregate'); assert.equal(receipt.schemaVersion, 1);
  assert.deepEqual(receipt.dataBoundary, { classification: 'anonymous-aggregate', rawIncluded: false, exportSchema: 1 });
  assert.deepEqual(receipt.metadata, f.metadata); assert.deepEqual(receipt.cleanup, { listeners: 0, clients: 0, schemas: 0 });
  assert.deepEqual(module.validateServiceReceipt(receipt), receipt);
  f.mail.producer.attempts = 50; f.fiscal.accounting.requests[0].bytesIn = 500;
  assert.equal(receipt.summary.mail.attempts, 3); assert.equal(receipt.fiscal.accounting.requests[0].bytesIn, 2);
});

// Unknown data is refused even when it could otherwise be dropped during summarisation.
for (const path of ['', 'metadata', 'metadata.window', 'mail', 'mail.producer', 'mail.observer', 'mail.discrepancy',
  'mail.billing', 'mail.operations.0', 'fiscal', 'fiscal.billing.0', 'fiscal.accounting',
  'fiscal.accounting.producer', 'fiscal.accounting.observer', 'fiscal.accounting.discrepancy',
  'fiscal.accounting.requests.0', 'fiscal.observedRequests.0', 'cleanup']) {
  test('serviceReceiptRefusesUnknownField_' + (path || 'input'), () => {
    const f = fixture(), target = path ? path.split('.').reduce((v, k) => v[k], f) : f;
    target.private = 'PRIVATE_CANARY'; assert.throws(() => build(f), bad);
  });
}
for (const [name, change] of [
  ['missing-service', f => { delete f.mail; }],
  ['mail-status', f => { f.mail.status = 'unknown'; }],
  ['mail-unreconciled', f => { f.mail.reconciled = false; }],
  ['mail-scope', f => { f.mail.scope = 'PRIVATE_CANARY'; }],
  ['mail-observer', f => { f.mail.observer.accepted++; }],
  ['mail-discrepancy', f => { f.mail.discrepancy.attempts = 1; }],
  ['mail-row-sum', f => { f.mail.operations[0].attempts++; }],
  ['mail-retry-sum', f => { f.mail.producer.retried = 0; }],
  ['mail-zero-row', f => { f.mail.operations[0].attempts = 0; }],
  ['mail-fraction', f => { f.mail.operations[0].retryOrdinal = 0.5; }],
  ['mail-unsafe-count', f => { f.mail.producer.attempts = Number.MAX_SAFE_INTEGER + 1; }],
  ['mail-action', f => { f.mail.operations[0].action = 'PRIVATE_CANARY'; }],
  ['mail-outcome', f => { f.mail.operations[0].outcome = 'PRIVATE_CANARY'; }],
  ['mail-duplicate', f => { f.mail.operations.push(structuredClone(f.mail.operations[0])); }],
  ['mail-billing', f => { f.mail.billing.quantity = 3; f.mail.billing.status = 'measured'; }],
  ['fiscal-status', f => { f.fiscal.status = 'unknown'; }],
  ['fiscal-unreconciled', f => { f.fiscal.reconciled = false; }],
  ['fiscal-observer', f => { f.fiscal.accounting.observer.bytesIn++; }],
  ['fiscal-discrepancy', f => { f.fiscal.accounting.discrepancy.bytesOut++; }],
  ['fiscal-paired-rows', f => { f.fiscal.observedRequests[0].retryOrdinal = 1; }],
  ['fiscal-operation', f => { f.fiscal.accounting.requests[0].operation = 'put'; f.fiscal.observedRequests[0].operation = 'put'; }],
  ['fiscal-class', f => { f.fiscal.accounting.requests[0].requestClass = 's3-write'; f.fiscal.observedRequests[0].requestClass = 's3-write'; }],
  ['fiscal-phase', f => { f.fiscal.accounting.requests[0].phase = 'cleanup'; f.fiscal.observedRequests[0].phase = 'cleanup'; }],
  ['fiscal-row-sum', f => { for (const rows of [f.fiscal.accounting.requests, f.fiscal.observedRequests]) {
    rows[0].bytesIn++; rows[0].attemptedBytesIn++;
  } }],
  ['fiscal-outcome-counts', f => { f.fiscal.accounting.requests[0].successful = 1; f.fiscal.observedRequests[0].successful = 1; }],
  ['fiscal-outcome-inversion', f => { for (const rows of [f.fiscal.accounting.requests, f.fiscal.observedRequests]) {
    rows[0].successful = 1; rows[0].failed = 0;
  } }],
  ['fiscal-retry-counts', f => { f.fiscal.accounting.requests[1].retried = 0; f.fiscal.observedRequests[1].retried = 0; }],
  ['fiscal-attempted-bytes', f => { f.fiscal.accounting.requests[0].attemptedBytesIn = 1; f.fiscal.observedRequests[0].attemptedBytesIn = 1; }],
  ['fiscal-duplicate', f => { for (const rows of [f.fiscal.accounting.requests, f.fiscal.observedRequests]) rows.push(structuredClone(rows[0])); }],
  ['fiscal-object', f => { f.fiscal.accounting.objects.push({ key: 'PRIVATE_CANARY' }); }],
  ['fiscal-gap', f => { f.fiscal.gaps.push('PRIVATE_CANARY'); }],
  ['fiscal-billing', f => { f.fiscal.billing[0].quantity = 3; f.fiscal.billing[0].status = 'measured'; }],
  ['no-mail-operations', f => { f.mail.operations = []; }],
  ['no-fiscal-operations', f => { f.fiscal.accounting.requests = []; f.fiscal.observedRequests = []; }],
  ['uncollected-listener', f => { f.cleanup.listeners = 1; }],
  ['uncollected-client', f => { f.cleanup.clients = 1; }],
  ['uncollected-schema', f => { f.cleanup.schemas = 1; }],
  ['raw-run', f => { f.metadata.runId = 'PRIVATE_CANARY'; }],
  ['raw-revision', f => { f.metadata.cloudRevision = 'PRIVATE_CANARY'; }],
  ['invalid-date', f => { f.metadata.window.startedAt = '2026-02-31T00:00:00.000Z'; }],
  ['inconsistent-time', f => { f.metadata.window.elapsedSeconds = 61; }],
  ['reversed-window', f => { f.metadata.window.endedAt = '2026-10-20T00:00:00.000Z'; }],
  ['oversized-window', f => { f.metadata.window.endedAt = '2026-10-21T03:00:00.000Z'; f.metadata.window.elapsedSeconds = 10800; }],
  ['empty-window', f => { f.metadata.window.endedAt = f.metadata.window.startedAt; f.metadata.window.elapsedSeconds = 0; }],
]) test('serviceReceiptRefuses_' + name, () => {
  const f = fixture(); change(f); assert.throws(() => build(f), bad);
});

test('serviceReceiptRejectsDuplicateGroupsEvenWhenAllTotalsAndIndependentRowsMatch', () => {
  const mail = fixture(); mail.mail.operations.push(structuredClone(mail.mail.operations[0]));
  mail.mail.producer.attempts = 4; mail.mail.producer.refused = 2;
  mail.mail.observer.attempts = 4; mail.mail.observer.refused = 2;
  assert.throws(() => build(mail), bad);
  const fiscal = fixture();
  for (const rows of [fiscal.fiscal.accounting.requests, fiscal.fiscal.observedRequests]) rows.push(structuredClone(rows[0]));
  for (const counter of [fiscal.fiscal.accounting.producer, fiscal.fiscal.accounting.observer]) {
    counter.attempts = 4; counter.bytesIn = 12; counter.bytesOut = 28;
  }
  assert.throws(() => build(fiscal), bad);
});

test('serviceReceiptRejectsRawFieldsEvenWhenBothFiscalObserversContainTheSameCanary', () => {
  const f = fixture();
  f.fiscal.accounting.requests[0].private = 'PRIVATE_CANARY';
  f.fiscal.observedRequests[0].private = 'PRIVATE_CANARY';
  assert.throws(() => build(f), bad);
});

test('serviceReceiptRejectsDifferentFiscalGroupsDespiteMatchingIndependentTotals', () => {
  const f = fixture();
  f.fiscal.observedRequests[0].outcome = 'client-error';
  f.fiscal.observedRequests[2].outcome = 'server-error';
  assert.throws(() => build(f), bad);
});

test('serviceReceiptRejectsAccessorsPrototypesAndArrayFieldsWithoutEvaluatingPrivateCode', () => {
  let calls = 0;
  const cases = [
    f => Object.defineProperty(f.mail, 'scope', { get() { calls++; throw Error('PRIVATE_CANARY'); } }),
    f => Object.setPrototypeOf(f.mail, { private: 'PRIVATE_CANARY' }),
    f => { f.mail.operations.private = 'PRIVATE_CANARY'; },
    f => { delete f.mail.operations[0]; },
    f => { f.fiscal.accounting.requests = Array(10001); },
    f => { f.mail.operations = Array(10001); },
    f => Object.defineProperty(f.mail.operations, '0', { get() { calls++; throw Error('PRIVATE_CANARY'); } }),
  ];
  for (const change of cases) { const f = fixture(); change(f); assert.throws(() => build(f), bad); }
  assert.equal(calls, 0);
});

test('serviceReceiptPublishedValidationRefusesAlteredTotalsScopeAndInventedMonthlyValues', () => {
  for (const change of [r => { r.summary.mail.refused = 0; }, r => { r.summary.fiscal.bodyBytesOut = 0; },
    r => { r.summary.mail.bytes = 0; }, r => { r.frequency.mailScenariosPerMonth = 1; },
    r => { r.frequency.fiscalScenariosPerMonth = 1; }, r => { r.costMeasured = true; },
    r => { r.scope = 'venue-month'; }, r => { r.private = 'PRIVATE_CANARY'; }]) {
    const receipt = build(fixture()); change(receipt);
    assert.throws(() => module.validateServiceReceipt(receipt), bad);
  }
});

test('serviceReceiptPublishedValidationRejectsHiddenAndArrayDataAtEveryExportedLevel', () => {
  for (const path of ['', 'dataBoundary', 'summary', 'summary.mail', 'summary.fiscal', 'frequency']) {
    const receipt = build(fixture()), target = path ? path.split('.').reduce((v, k) => v[k], receipt) : receipt;
    Object.defineProperty(target, 'private', { value: 'PRIVATE_CANARY' });
    assert.throws(() => module.validateServiceReceipt(receipt), bad, path || 'receipt');
  }
});
