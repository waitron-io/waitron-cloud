import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const module = await import('./joined-evidence.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./joined-evidence.mjs', import.meta.url).href) return {};
  throw error;
});
const read = name => JSON.parse(readFileSync(new URL('../../docs/cost-model/' + name + '.json', import.meta.url)));
const fixture = () => ({ stream: read('measurements'),
  services: [read('service-mail-retry-fiscal-lifecycle'), read('service-signup-recovery-fiscal-refusal')],
  api: read('remote-owner-public-api'), browser: read('remote-owner-browser') });
const build = input => {
  assert.equal(typeof module.buildLocalEvidence, 'function', 'join independently measured driver samples');
  return module.buildLocalEvidence(input);
};
const bad = { message: 'Invalid cloud cost joined evidence' };

// A combined clock or total would falsely turn independent experiments into a venue day.
test('joinedEvidencePreservesSeparateWindowsSourcesScopesAndUnknownCosts', () => {
  const input = fixture(), result = build(input);
  assert.equal(result.kind, 'local-driver-evidence'); assert.equal(result.schemaVersion, 1);
  assert.equal(result.costMeasured, false); assert.equal(result.dailyCost, null); assert.equal(result.monthlyCost, null);
  assert.deepEqual(result.dataBoundary, { classification: 'anonymous-aggregate', rawIncluded: false, exportSchema: 1 });
  assert.deepEqual(Object.keys(result.experiments), ['stream', 'services', 'api', 'browser']);
  assert.equal(result.experiments.stream.cloudRevision, '67774bcbe85283c614b1b64a3cdcee585531629d');
  assert.equal(result.experiments.api.source.cloudRevision, '582d6e7e6ad7184650e3332ef46813bd9f711e42');
  assert.equal(result.experiments.browser.source.cloudRevision, '4c26e9f052ff880f65b138ba9ac8fe5440b97771');
  assert.deepEqual([result.experiments.stream.window.elapsedSeconds,
    result.experiments.api.window.elapsedSeconds, result.experiments.browser.window.elapsedSeconds], [1287.607, 3.338753, 4.884778]);
  assert.equal(result.experiments.api.scope, 'generated-venue-api-scenario');
  assert.equal(result.experiments.browser.scope, 'generated-owner-dashboard-scenario');
  assert.equal(result.experiments.stream.cadence.factor, 1000);
  assert.deepEqual(result.unmeasured, ['archive-capture', 'application-restore', 'representative-remote-activity',
    'public-browser-journey', 'monthly-frequencies', 'provider-billing', 'daily-projection']);
  input.stream.inputs[0].value = 1;
  assert.equal(result.experiments.stream.inputs.find(row => row.id === 'successful-sales').value, 207);
  assert.equal(result.experiments.stream.inputs.find(row => row.id === 'orders-per-day').value, 207, 'detach the complete result');
});

// Dropping failed attempts, retry groups or observer phases understates the measured work.
test('joinedEvidenceRetainsStreamRestoreAndAllServiceAttemptsWithoutAddingScenarios', () => {
  const { stream, services, api, browser } = build(fixture()).experiments;
  assert.deepEqual(stream.accounting.producer, { attempts: 342, bytesIn: 2243287, bytesOut: 6071372 });
  assert.equal(stream.accounting.requests.find(row => row.phase === 'setup' && row.outcome === 'transport-error').failed, 7);
  assert.equal(stream.accounting.requests.find(row => row.phase === 'restore' && row.operation === 'get').bytesIn, 876426);
  assert.deepEqual(services.map(row => row.summary.mail), [
    { attempts: 4, accepted: 3, refused: 1, retried: 1, bytes: null },
    { attempts: 3, accepted: 3, refused: 0, retried: 0, bytes: null },
  ]);
  assert.deepEqual(services.map(row => [row.summary.fiscal.attempts, row.summary.fiscal.failed, row.summary.fiscal.retried]), [[8, 2, 1], [1, 1, 0]]);
  assert.deepEqual(api.measurement.evidence.map(row => [row.audience, row.requests, row.snapshot.producer.bytesFromGateway]),
    [['staff', 9, 29867], ['public', 6, 21956]]);
  assert.deepEqual(browser.measurement.snapshot.producer, { connections: 25, bytesToGateway: 77762, bytesFromGateway: 2836968 });
  assert.equal(browser.measurement.streamBodyBytes, null);
  assert.equal(browser.measurement.completedResponseBodyBytes, 2765205);
  assert.equal(browser.measurement.unfinishedStreamRequests, 1);
  assert.equal(browser.measurement.cachedRequests, 3);
  assert.equal(browser.frequency.ownerSessionsPerMonth, null);
});

// Reject altered sources before publication rather than silently losing their limitations.
const changes = [
  ['missing-driver', f => { delete f.browser; }],
  ['raw-top', f => { f.privatePath = 'PRIVATE_CANARY'; }],
  ['raw-stream', f => { f.stream.accounting.requests[0].key = 'PRIVATE_CANARY'; }],
  ['unreconciled-stream', f => { f.stream.accounting.observer.bytesIn++; f.stream.accounting.discrepancy.bytesIn++; }],
  ['failed-stream-check', f => { f.stream.checks[0].passed = false; }],
  ['missing-stream-check', f => { f.stream.checks.shift(); }],
  ['unclean-stream', f => { f.stream.cleanup.ownedObjects = 1; }],
  ['false-stream-source', f => { f.stream.inputs[0].source = 'receipt:12345678-1234-4234-8234-123456789012'; }],
  ['false-stream-units', f => { f.stream.inputs[0].unit = 'bytes'; }],
  ['stream-false-replay-count', f => { f.stream.inputs.find(row => row.id === 'successful-sales').value--; }],
  ['stream-projection', f => { f.stream.inputs.find(row => row.id === 'archive-bytes').value = 0;
    f.stream.inputs.find(row => row.id === 'archive-bytes').status = 'measured'; }],
  ['no-services', f => { f.services = []; }],
  ['duplicate-service', f => { f.services[1] = structuredClone(f.services[0]); }],
  ['raw-service', f => { f.services[0].summary.mail.email = 'PRIVATE_CANARY'; }],
  ['service-retry-lost', f => { f.services[0].mail.producer.retried = 0; }],
  ['raw-api-source', f => { f.api.source.hostname = 'PRIVATE_CANARY'; }],
  ['raw-api-action', f => { f.api.measurement.evidence[0].actions[0].cookie = 'PRIVATE_CANARY'; }],
  ['api-wrong-pin', f => { f.api.source.waitronRevision = 'a'.repeat(40); }],
  ['api-invalid-window', f => { f.api.window.elapsedSeconds++; }],
  ['api-incomplete', f => { f.api.measurement.costMeasured = true; }],
  ['api-missing-public', f => { f.api.measurement.evidence.pop(); }],
  ['api-disguised-array', f => { f.api.measurement.evidence = { ...f.api.measurement.evidence, length: 2, raw: 'PRIVATE_CANARY' }; }],
  ['api-wrong-audience', f => { f.api.measurement.evidence[0].audience = 'public'; }],
  ['api-missing-action', f => { f.api.measurement.evidence[0].actions.pop(); }],
  ['api-wrong-status', f => { f.api.measurement.evidence[0].actions[0].status = 200; }],
  ['api-unmatched-body', f => { f.api.measurement.evidence[0].responseBodyBytes++; }],
  ['api-unmatched-request', f => { f.api.measurement.evidence[0].requests++; }],
  ['api-unreconciled-socket', f => { f.api.measurement.evidence[0].snapshot.observer.bytesFromGateway++; }],
  ['api-nonzero-discrepancy', f => { f.api.measurement.evidence[0].snapshot.discrepancy.connections = 1; }],
  ['api-missing-overhead-limit', f => { f.api.measurement.evidence[0].snapshot.excludedOverhead.pop(); }],
  ['api-private-limitation', f => { f.api.limitations[0] = 'PRIVATE_CANARY'; }],
  ['raw-browser-window', f => { f.browser.window.sourcePath = 'PRIVATE_CANARY'; }],
  ['raw-browser-scenario', f => { f.browser.scenario.email = 'PRIVATE_CANARY'; }],
  ['browser-private-runtime', f => { f.browser.source.image = 'PRIVATE_CANARY'; }],
  ['browser-no-caching', f => { f.browser.scenario.coldLoadAndCachedReload = false; }],
  ['browser-failed-request', f => { f.browser.measurement.failedRequests++; }],
  ['browser-unmatched-completion', f => { f.browser.measurement.completedRequests++; }],
  ['browser-unmatched-streams', f => { f.browser.measurement.interruptedStreamRequests += 10; f.browser.measurement.completedRequests -= 10; }],
  ['browser-invented-stream-bytes', f => { f.browser.measurement.streamBodyBytes = 0; }],
  ['browser-empty-assets', f => { f.browser.measurement.requests.script = 0; f.browser.measurement.completedRequests -= 2; }],
  ['browser-empty-cache', f => { f.browser.measurement.cachedRequests = 0; }],
  ['browser-unreconciled-socket', f => { f.browser.measurement.snapshot.observer.bytesToGateway++; }],
  ['browser-false-frequency', f => { f.browser.frequency.ownerSessionsPerMonth = 1; }],
  ['browser-missing-limit', f => { f.browser.unmeasured.pop(); }],
];
for (const [name, change] of changes) test('joinedEvidenceRefuses_' + name, () => {
  const f = fixture(); change(f); assert.throws(() => build(f), bad);
});

for (const key of ['stream', 'services', 'api', 'browser']) test('joinedEvidenceDoesNotExecuteProducerGetter_' + key, () => {
  const f = fixture(); let invoked = false;
  Object.defineProperty(f, key, { get() { invoked = true; throw Error('PRIVATE_CANARY'); }, enumerable: true });
  try { assert.throws(() => build(f), bad); } finally { assert.equal(invoked, false); }
});

for (const [name, change] of [
  ['array-property', f => { f.services.raw = 'PRIVATE_CANARY'; }],
  ['nested-accessor', f => { Object.defineProperty(f.api.source, 'nodeVersion', { get() { throw Error('PRIVATE_CANARY'); } }); }],
  ['symbol', f => { f.browser[Symbol('PRIVATE_CANARY')] = 1; }],
  ['sparse-array', f => { delete f.services[0]; }],
  ['cycle', f => { f.raw = f; }],
]) test('joinedEvidenceRefusesHiddenData_' + name, () => {
  const f = fixture(); change(f); assert.throws(() => build(f), bad);
});
