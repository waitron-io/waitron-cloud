import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const module = await import('./projection.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./projection.mjs', import.meta.url).href) return {};
  throw error;
});
const read = name => JSON.parse(readFileSync(new URL('../../docs/cost-model/' + name + '.json', import.meta.url)));
const assumption = (id, value, unit = 'count') => ({ id, value, unit, status: value === null ? 'unknown' : 'assumed',
  source: value === null ? null : 'assumption:workload-assumption', scope: 'venue', region: 'local',
  observedAt: null, effectiveAt: null, bounds: value === null ? null : { low: value, base: value, high: value, assumption: 'workload-assumption' },
  reason: value === null ? 'not-measured' : 'workload-assumption' });
const timing = () => ({ runId: '48e38340-d882-4709-89ad-b83462b69e4e', cloudRevision: '67774bcbe85283c614b1b64a3cdcee585531629d',
  phases: [{ phase: 'startup', elapsedSeconds: 5.136279961 }, { phase: 'workload', elapsedSeconds: 54.181285149000004 },
    { phase: 'idle', elapsedSeconds: 1200.008791962 }, { phase: 'verification', elapsedSeconds: 0.020755958999870927 },
    { phase: 'restore', elapsedSeconds: 0.11534016600012365 }] });
const fixture = () => ({ samples: read('local-driver-evidence').experiments, streamTiming: timing(), ownerScenario: 'browser',
  serviceScenarios: { 'mail-retry-fiscal': 'f559fb09-d163-45cd-834e-195640ab5aa6', 'signup-recovery': '2cbf0b33-e88a-40fb-a5f8-b19477fc8c8c' },
  assumptions: Object.fromEntries([
    ['orders-per-day', 414], ['days-per-month', 30], ['startups-per-day', 1],
    ['idle-seconds-per-day', 2400.017583924, 'seconds'], ['workload-cadence-factor', 1],
    ['stream-restores-per-month', 2], ['owner-sessions-per-month', 3], ['public-api-runs-per-month', 4],
    ['mail-retry-fiscal-runs-per-month', 2], ['signup-recovery-runs-per-month', 0], ['archive-replay-runs-per-month', 2],
  ].map(([id, value, unit]) => [id, assumption(id, value, unit)])) });
const project = value => {
  assert.equal(typeof module.projectUsage, 'function', 'project independent measured components using explicit assumptions');
  return module.projectUsage(value);
};
const bad = { message: 'Invalid cloud cost projection' };
const component = (result, id) => result.components.find(row => row.id === id);

// Scaling everything by sales loses startup and idle costs and invents restore frequency.
test('streamProjectionScalesEachPhaseWithoutScalingSetupOrCleanupIntoDailyWork', () => {
  const result = project(fixture());
  const workload = component(result, 'stream-workload'), startup = component(result, 'stream-startup');
  assert.equal(workload.daily[0].attempts, 112); assert.equal(workload.daily[0].bytesOut, 8627892);
  assert.equal(workload.monthly[0].attempts, 3360);
  assert.equal(startup.daily[0].attempts, 21); assert.equal(startup.monthly[0].attempts, 630);
  assert.equal(component(result, 'stream-idle').daily[0].attempts, 342);
  assert.equal(component(result, 'stream-restore').monthly[0].attempts, 62);
  assert.equal(component(result, 'stream-restore').daily, null);
  assert.deepEqual(result.experimentOnly.requests.map(row => row.phase), ['observer', 'observer', 'setup', 'setup', 'setup',
    'cleanup', 'cleanup', 'cleanup', 'cleanup', 'cleanup']);
  assert.equal(result.costMeasured, false); assert.equal(result.complete, false);
  assert.equal(result.dailyCost, null); assert.equal(result.monthlyCost, null);
  assert.ok(result.unmeasured.includes('provider-billing')); assert.ok(result.unmeasured.includes('stream-schedule-boundaries'));
});

// Rounding per-row estimates or dropping failures understates a later bounded replay manifest.
test('fractionalExpectedCountsAndFailedRetriedOperationsSurviveProjection', () => {
  const f = fixture(); f.assumptions['orders-per-day'] = assumption('orders-per-day', 1);
  const row = component(project(f), 'stream-workload').daily[0];
  assert.equal(row.attempts, 56 / 207); assert.equal(row.outcome, 'success'); assert.equal(row.retryOrdinal, 0);
  const service = component(project(f), 'service-mail-retry-fiscal');
  assert.deepEqual(service.monthly.mail, { attempts: 8, accepted: 6, refused: 2, retried: 2, bytes: null });
  assert.equal(service.monthly.fiscal.attempts, 16); assert.equal(service.monthly.fiscal.failed, 4);
});

// Blank frequencies are missing evidence; zero is an explicit assumption, never an empty-input default.
test('missingFrequencyStaysUnknownWhileExplicitZeroKeepsRequiredStartupAndIdle', () => {
  const f = fixture();
  for (const id of ['owner-sessions-per-month', 'stream-restores-per-month']) f.assumptions[id] = assumption(id, null);
  f.assumptions['orders-per-day'] = assumption('orders-per-day', 0);
  const r = project(f);
  assert.equal(component(r, 'owner-browser').monthly, null);
  assert.equal(component(r, 'stream-restore').monthly, null);
  assert.ok(r.gaps.includes('owner-sessions-per-month:unknown'));
  assert.ok(r.gaps.includes('stream-restores-per-month:unknown'));
  assert.equal(component(r, 'stream-workload').daily[0].attempts, 0);
  assert.equal(component(r, 'stream-startup').daily[0].attempts, 21);
  assert.equal(component(r, 'stream-idle').daily[0].attempts, 342);
});

// Owner API and browser actions overlap; only the chosen scenario may be projected.
test('ownerScenarioSelectionAvoidsDoubleCountingAndLeavesPublicTrafficSeparate', () => {
  const f = fixture(), browser = project(f);
  assert.equal(component(browser, 'owner-browser').monthly.bytesFromGateway, 8510904);
  assert.equal(component(browser, 'owner-api'), undefined);
  f.ownerScenario = 'api'; const api = project(f);
  assert.equal(component(api, 'owner-api').monthly.bytesFromGateway, 89601);
  assert.equal(component(api, 'owner-browser'), undefined);
  assert.equal(component(api, 'public-api').monthly.bytesFromGateway, 87824);
  assert.ok(api.unmeasured.includes('public-browser-journey'));
  assert.ok(api.unmeasured.includes('tunnel-to-provider-billing'));
});

// A one-sale HTTP fixture cannot silently become the selected-day archive's transfer measurement.
test('archiveProjectionUsesSelectedReplayCaptureAndDoesNotClaimMeasuredStorageTransfer', () => {
  const result = project(fixture()), archive = component(result, 'archive-capture-restore');
  assert.equal(archive.monthly.capturedBytes, 7055354);
  assert.equal(archive.monthly.restoredSales, 414);
  assert.equal(archive.monthly.storageHttpBytes, null);
  assert.ok(result.unmeasured.includes('representative-archive-shape'));
  assert.ok(result.unmeasured.includes('storage-retention-projection'));
});

// Dropping assumptions or source windows turns an extrapolation into false measured evidence.
test('projectedComponentsRetainStatusesAssumptionsWindowsAndExactProducingSources', () => {
  const f = fixture(), before = structuredClone(f), r = project(f);
  assert.deepEqual(f, before);
  assert.deepEqual(r.sources, f.samples);
  assert.deepEqual(r.streamTiming, f.streamTiming);
  assert.deepEqual(r.assumptions, f.assumptions);
  assert.deepEqual(component(r, 'stream-workload').statuses, ['measured', 'assumed']);
  assert.equal(component(r, 'stream-workload').source, 'receipt:48e38340-d882-4709-89ad-b83462b69e4e');
  assert.equal(component(r, 'archive-capture-restore').source, 'revision:73cd7239fc24d34271bca351e5b23c20aa9295ca');
  f.samples.stream.accounting.requests[0].attempts = 999;
  f.assumptions['orders-per-day'].value = 999;
  assert.equal(r.sources.stream.accounting.requests[0].attempts, 3);
  assert.equal(r.assumptions['orders-per-day'].value, 414);
});

test('cadenceAndMonthAssumptionsChangeOnlyTheirDependentComponents', () => {
  const f = fixture(); f.assumptions['workload-cadence-factor'] = assumption('workload-cadence-factor', 2);
  f.assumptions['days-per-month'] = assumption('days-per-month', 31);
  const r = project(f);
  assert.equal(component(r, 'stream-workload').daily[0].attempts, 224);
  assert.equal(component(r, 'stream-workload').monthly[0].attempts, 6944);
  assert.equal(component(r, 'stream-startup').monthly[0].attempts, 651);
  assert.equal(component(r, 'owner-browser').monthly.bytesFromGateway, 8510904);
});

for (const [name, alter] of [
  ['missing-input', f => { delete f.assumptions['days-per-month']; }],
  ['invalid-count', f => { f.assumptions['orders-per-day'].value = 1.5; }],
  ['negative', f => { f.assumptions['idle-seconds-per-day'].value = -1; }],
  ['false-measured', f => { f.assumptions['orders-per-day'].status = 'measured'; }],
  ['wrong-unit', f => { f.assumptions['orders-per-day'].unit = 'bytes'; }],
  ['wrong-scope', f => { f.assumptions['days-per-month'].scope = 'platform'; }],
  ['mismatched-id', f => { f.assumptions['orders-per-day'].id = 'bill-count'; }],
  ['impossible-day', f => { f.assumptions['idle-seconds-per-day'] = assumption('idle-seconds-per-day', 86401, 'seconds'); }],
  ['impossible-month', f => { f.assumptions['days-per-month'] = assumption('days-per-month', 32); }],
  ['zero-cadence', f => { f.assumptions['workload-cadence-factor'] = assumption('workload-cadence-factor', 0); }],
  ['mixed-owner', f => { f.ownerScenario = 'both'; }],
  ['timing-unbound-run', f => { f.streamTiming.runId = '12345678-1234-4234-8234-123456789012'; }],
  ['timing-unbound-revision', f => { f.streamTiming.cloudRevision = 'a'.repeat(40); }],
  ['zero-idle-window', f => { f.streamTiming.phases[2].elapsedSeconds = 0; }],
  ['missing-phase', f => { f.streamTiming.phases.pop(); }],
  ['overlapping-windows', f => { f.streamTiming.phases[2].elapsedSeconds = 7200; }],
  ['unsafe-source', f => { f.samples.stream.raw = 'PRIVATE_CANARY'; }],
  ['extra-field', f => { f.raw = 'PRIVATE_CANARY'; }],
  ['extra-assumption', f => { f.assumptions.raw = 'PRIVATE_CANARY'; }],
  ['extra-phase-field', f => { f.streamTiming.phases[0].path = 'PRIVATE_CANARY'; }],
  ['overflow', f => { f.assumptions['workload-cadence-factor'] = assumption('workload-cadence-factor', Number.MAX_SAFE_INTEGER); }],
]) test('projectionRefuses-' + name, () => { const f = fixture(); alter(f); assert.throws(() => project(f), bad); });

test('projectionRefusesPrivateAccessorsWithoutRunningThem', () => {
  const f = fixture(); let calls = 0;
  Object.defineProperty(f.assumptions, 'orders-per-day', { get() { calls++; throw Error('PRIVATE_CANARY'); } });
  assert.throws(() => project(f), bad); assert.equal(calls, 0);
});

// Reordering independent receipts must never apply another scenario's frequency.
test('serviceFrequencyIsBoundToReceiptRatherThanArrayOrder', () => {
  const f = fixture(); f.samples.services.reverse();
  assert.equal(component(project(f), 'service-mail-retry-fiscal').monthly.mail.attempts, 8);
  assert.equal(component(project(f), 'service-signup-recovery').monthly.mail.attempts, 0);
});
for (const [name, alter] of [
  ['missing-scenario', f => { delete f.serviceScenarios; }],
  ['unknown-scenario', f => { f.serviceScenarios['mail-retry-fiscal'] = '12345678-1234-4234-8234-123456789012'; }],
  ['reused-scenario', f => { f.serviceScenarios['signup-recovery'] = f.serviceScenarios['mail-retry-fiscal']; }],
]) test('projectionRefuses-' + name, () => { const f = fixture(); alter(f); assert.throws(() => project(f), bad); });

// Retry ordinal identifies an attempt group; it is not a quantity to multiply.
test('projectionPreservesRetryOrdinalWhileScalingAllAttemptQuantities', () => {
  const f = fixture(), stream = f.samples.stream;
  stream.accounting.requests.push({ phase: 'workload', operation: 'put', requestClass: 's3-write', outcome: 'success',
    retryOrdinal: 1, attempts: 2, successful: 2, failed: 0, retried: 2, bytesIn: 0, bytesOut: 12, attemptedBytesIn: 0, attemptedBytesOut: 12 });
  for (const key of ['producer', 'observer']) { stream.accounting[key].attempts += 2; stream.accounting[key].bytesOut += 12; }
  stream.checks.find(row => row.code === 'accounting-reconciled').count += 2;
  const row = component(project(f), 'stream-workload').monthly.at(-1);
  assert.equal(row.retryOrdinal, 1); assert.equal(row.attempts, 120); assert.equal(row.retried, 120);
  assert.equal(row.attemptedBytesOut, 720); assert.equal(row.bytesOut, 720);
});

for (const [name, alter] of [
  ['zero-startup-window', f => { f.streamTiming.phases[0].elapsedSeconds = 0; }],
  ['valid-measured-frequency', f => { f.assumptions['owner-sessions-per-month'] = { ...f.assumptions['owner-sessions-per-month'],
    status: 'measured', source: 'receipt:12345678-1234-4234-8234-123456789012', observedAt: '2026-10-21T00:00:00.000Z', reason: null }; }],
  ['quantity-overflow', f => { f.assumptions['stream-restores-per-month'] = assumption('stream-restores-per-month', Number.MAX_SAFE_INTEGER); }],
]) test('projectionRefuses-' + name, () => { const f = fixture(); alter(f); assert.throws(() => project(f), bad); });
