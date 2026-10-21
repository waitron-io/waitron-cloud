import { isDeepStrictEqual } from 'node:util';
import { validateReceipt } from './schema.mjs';
import { validateServiceReceipt } from './service-receipt.mjs';
import { validateArchiveEvidence } from './archive-evidence.mjs';

const fail = () => { throw Error('Invalid cloud cost joined evidence'); };
const need = value => { if (!value) fail(); };
const count = value => Number.isSafeInteger(value) && value >= 0;
const exact = (value, keys) => need(value && !Array.isArray(value)
  && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
const equal = (value, expected) => need(isDeepStrictEqual(value, expected));
const counters = (value, keys) => { exact(value, keys); need(keys.every(key => count(value[key]))); };
const boundary = { classification: 'anonymous-aggregate', rawIncluded: false, exportSchema: 1 };
const pin = 'fbadd15785464e59747e697c11048bfbc6e4938f';
const apiLimitations = [
  'Generated venue API actions; full browser assets and background updates are unmeasured.',
  'Socket bytes include TLS records; IP/TCP overhead and the mapping of tunnel counters to AWS billing are unmeasured.',
  'Monthly owner/public frequencies and complete venue cost remain unknown.',
];
const browserGaps = ['representative-venue-activity', 'public-browser-journey', 'stream-response-bodies',
  'ip-tcp-overhead', 'tunnel-to-provider-billing'];

// Inspect the whole graph before reading producer fields. Accessors and hidden
// array properties must refuse publication without executing private code.
function plain(value, ancestors = new Set(), budget = { remaining: 50000 }) {
  need(--budget.remaining >= 0);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { need(Number.isFinite(value)); return; }
  if (typeof value === 'string') { need(value.length <= 512); return; }
  need(value && typeof value === 'object' && ancestors.size < 20 && !ancestors.has(value));
  const array = Array.isArray(value), keys = Reflect.ownKeys(value);
  need(Object.getPrototypeOf(value) === (array ? Array.prototype : Object.prototype));
  if (array) need(value.length <= 10000 && keys.length === value.length + 1
    && keys.every(key => key === 'length' || typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length));
  ancestors.add(value);
  for (const key of keys) {
    need(typeof key === 'string'); const descriptor = Object.getOwnPropertyDescriptor(value, key);
    need(Object.hasOwn(descriptor, 'value')); plain(descriptor.value, ancestors, budget);
  }
  ancestors.delete(value);
}
function window(value, browser = false) {
  exact(value, ['startedAt', 'endedAt', 'elapsedSeconds', ...(browser ? ['includesSetupAndCleanup'] : [])]);
  for (const key of ['startedAt', 'endedAt']) need(typeof value[key] === 'string'
    && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3,6}(Z|\+00:00)$/.test(value[key]) && Number.isFinite(Date.parse(value[key])));
  const elapsed = (Date.parse(value.endedAt) - Date.parse(value.startedAt)) / 1000;
  need(typeof value.elapsedSeconds === 'number' && value.elapsedSeconds > 0 && value.elapsedSeconds <= 7200
    && Math.abs(elapsed - value.elapsedSeconds) < 0.001);
  if (browser) need(value.includesSetupAndCleanup === true);
}
function runtime(value, browser = false) {
  exact(value, ['cloudRevision', 'waitronRevision', 'runtimeSha256', 'nodeVersion', 'image',
    ...(browser ? ['browserImage', 'browserNodeVersion', 'chromiumVersion', 'dashboardSha256'] : [])]);
  need(/^[a-f0-9]{40}$/.test(value.cloudRevision) && value.waitronRevision === pin
    && /^[a-f0-9]{64}$/.test(value.runtimeSha256) && /^v\d+\.\d+\.\d+$/.test(value.nodeVersion)
    && /^sha256:[a-f0-9]{64}$/.test(value.image));
  if (browser) need(/^sha256:[a-f0-9]{64}$/.test(value.browserImage)
    && /^v\d+\.\d+\.\d+$/.test(value.browserNodeVersion) && /^\d+\.\d+\.\d+\.\d+$/.test(value.chromiumVersion)
    && /^[a-f0-9]{64}$/.test(value.dashboardSha256));
}
function socket(value, audience) {
  exact(value, ['scope', 'audience', 'status', 'reconciled', 'producer', 'observer', 'discrepancy', 'excludedOverhead']);
  need(value.scope === 'gateway-tcp-stream' && value.audience === audience && value.status === 'measured' && value.reconciled === true);
  for (const key of ['producer', 'observer', 'discrepancy']) counters(value[key], ['connections', 'bytesToGateway', 'bytesFromGateway']);
  need(value.producer.connections > 0 && value.producer.connections <= 1000
    && value.producer.bytesToGateway > 0 && value.producer.bytesFromGateway > 0);
  equal(value.producer, value.observer); equal(value.discrepancy, { connections: 0, bytesToGateway: 0, bytesFromGateway: 0 });
  equal(value.excludedOverhead, ['ip', 'tcp', 'wireguard']);
}
function tunnel(value) { counters(value, ['received', 'sent']); need(value.received > 0 && value.sent > 0); }
function stream(value) {
  validateReceipt(value); need(value.kind === 'local-aggregate' && value.waitronRevision === pin);
  need(Object.entries(value.cleanup).every(([key, n]) => key === 'residualKinds' ? n.length === 0 : n === 0));
  equal(value.accounting.producer, value.accounting.observer);
  equal(value.accounting.discrepancy, { attempts: 0, bytesIn: 0, bytesOut: 0 });
  const measured = { 'orders-per-day': 'count', 'successful-sales': 'count', 'bill-count': 'count',
    'database-bytes': 'bytes', 'database-growth-bytes': 'bytes', 'replay-seconds': 'seconds',
    'stream-byte-seconds-low': 'byte-seconds', 'stream-byte-seconds-high': 'byte-seconds', 'stream-storage-seconds': 'seconds' };
  const inputs = Object.fromEntries(value.inputs.map(row => [row.id, row]));
  need(value.inputs.length === 26 && Object.keys(measured).every(key => inputs[key]?.status === 'measured'));
  for (const row of value.inputs) {
    if (Object.hasOwn(measured, row.id)) need(row.status === 'measured' && row.unit === measured[row.id]
      && row.source === 'receipt:' + value.runId && row.observedAt === value.window.endedAt && row.region === 'local' && row.scope === 'venue');
    else need(row.status === 'unknown');
  }
  const sales = inputs['successful-sales'].value;
  need(sales > 0 && sales === inputs['orders-per-day'].value && sales === inputs['bill-count'].value
    && inputs['stream-byte-seconds-low'].value <= inputs['stream-byte-seconds-high'].value);
  equal(value.checks, [
    { code: 'no-raw-data', passed: true, count: 1 }, { code: 'outbound-denied', passed: true, count: 5 },
    { code: 'all-sales-replayed', passed: true, count: sales },
    { code: 'accounting-reconciled', passed: true, count: value.accounting.producer.attempts },
    { code: 'cleanup-complete', passed: true, count: 0 },
  ]);
}
const actions = {
  staff: [['anonymous-read-refused', 401], ['invalid-sign-in-refused', 401], ['sign-in', 200], ['staff-read', 200],
    ['dashboard-canvases-read', 200], ['dashboard-theme-read', 200], ['staff-reconnect-read', 200], ['sign-out', 204], ['signed-out-read-refused', 401]],
  public: [['unchallenged-public-refused', 403], ['challenge', 200], ['proof-worker-read', 200], ['proof-submit', 204],
    ['public-availability-read', 200], ['public-management-refused', 404]],
};
function api(value) {
  exact(value, ['schemaVersion', 'scope', 'source', 'window', 'measurement', 'limitations']);
  need(value.schemaVersion === 1 && value.scope === 'generated-venue-api-scenario');
  runtime(value.source); window(value.window); equal(value.limitations, apiLimitations);
  const m = value.measurement; exact(m, ['kind', 'costMeasured', 'evidence', 'tunnelTotals']);
  need(m.kind === 'pinned-waitron-api-gateway' && m.costMeasured === false && Array.isArray(m.evidence) && m.evidence.length === 2);
  for (const [i, audience] of ['staff', 'public'].entries()) {
    const row = m.evidence[i];
    exact(row, ['audience', 'scenario', 'requests', 'requestBodyBytes', 'responseBodyBytes', 'actions', 'snapshot']);
    need(row.audience === audience && row.scenario === (audience === 'staff' ? 'owner-management-api' : 'public-availability-api'));
    need(['requests', 'requestBodyBytes', 'responseBodyBytes'].every(key => count(row[key])) && Array.isArray(row.actions));
    equal(row.actions.map(a => [a.action, a.status]), actions[audience]);
    for (const a of row.actions) {
      exact(a, ['action', 'status', 'requestBodyBytes', 'responseBodyBytes']);
      need(count(a.requestBodyBytes) && count(a.responseBodyBytes));
    }
    need(row.requests === row.actions.length && row.requestBodyBytes === row.actions.reduce((sum, a) => sum + a.requestBodyBytes, 0)
      && row.responseBodyBytes === row.actions.reduce((sum, a) => sum + a.responseBodyBytes, 0));
    socket(row.snapshot, audience);
    need(row.snapshot.producer.connections === row.requests && row.snapshot.producer.bytesToGateway > row.requestBodyBytes
      && row.snapshot.producer.bytesFromGateway > row.responseBodyBytes);
  }
  tunnel(m.tunnelTotals);
}
function browser(value) {
  exact(value, ['schemaVersion', 'kind', 'dataBoundary', 'scope', 'source', 'window', 'scenario', 'measurement', 'tunnelTotals', 'frequency', 'unmeasured']);
  need(value.schemaVersion === 1 && value.kind === 'local-browser-aggregate' && value.scope === 'generated-owner-dashboard-scenario');
  equal(value.dataBoundary, boundary); runtime(value.source, true); window(value.window, true);
  equal(value.scenario, { locale: 'en-GB', width: 1280, height: 900, serverComposition: 'selected-pinned-handlers',
    productionServerAlertSources: false, coldLoadAndCachedReload: true });
  const m = value.measurement, numeric = ['completedRequestBodyBytes', 'completedResponseBodyBytes', 'completedRequests',
    'interruptedStreamRequests', 'unfinishedStreamRequests', 'failedRequests', 'unexpectedResponses', 'pageErrors', 'outsideRequests', 'cachedRequests'];
  exact(m, ['kind', 'costMeasured', 'actions', 'requests', ...numeric, 'streamBodyBytes', 'bodyBytesCoverage', 'snapshot']);
  need(m.kind === 'pinned-waitron-browser-gateway' && m.costMeasured === false && numeric.every(key => count(m[key])));
  equal(m.actions, ['login-page', 'sign-in', 'dashboard-read', 'browser-reconnect', 'sign-out']);
  counters(m.requests, ['document', 'script', 'stylesheet', 'image', 'font', 'api', 'eventsource', 'other']);
  const requests = Object.values(m.requests).reduce((sum, n) => sum + n, 0);
  need(count(requests) && m.requests.document >= 2 && m.requests.script > 0 && m.requests.api > 0 && m.requests.eventsource > 0
    && m.cachedRequests > 0 && m.cachedRequests <= m.completedRequests
    && m.completedRequests + m.interruptedStreamRequests + m.unfinishedStreamRequests === requests
    && m.interruptedStreamRequests + m.unfinishedStreamRequests <= m.requests.eventsource);
  need(m.streamBodyBytes === null && m.bodyBytesCoverage === 'completed-requests-only'
    && m.failedRequests === 0 && m.unexpectedResponses === 0 && m.pageErrors === 0 && m.outsideRequests === 0);
  socket(m.snapshot, 'staff');
  need(m.completedResponseBodyBytes > 0 && m.snapshot.producer.bytesFromGateway > m.completedResponseBodyBytes
    && m.snapshot.producer.bytesToGateway > m.completedRequestBodyBytes);
  tunnel(value.tunnelTotals); equal(value.frequency, { ownerSessionsPerMonth: null }); equal(value.unmeasured, browserGaps);
}

// Keep independent windows and scopes intact. Summing API and browser scenarios
// double-counts some owner actions, and scaling either does not measure a venue day.
export function buildLocalEvidence(input) {
  try {
    plain(input);
    const hasArchive = Object.hasOwn(input, 'archive');
    exact(input, ['stream', 'services', 'api', 'browser', ...(hasArchive ? ['archive'] : [])]);
    stream(input.stream);
    need(Array.isArray(input.services) && input.services.length > 0 && input.services.length <= 16);
    for (const service of input.services) validateServiceReceipt(service);
    need(new Set(input.services.map(service => service.metadata.runId)).size === input.services.length);
    api(input.api); browser(input.browser);
    if (hasArchive) validateArchiveEvidence(input.archive);
    return structuredClone({ schemaVersion: 1, kind: 'local-driver-evidence', costMeasured: false, dataBoundary: boundary,
      experiments: { stream: input.stream, services: input.services, api: input.api, browser: input.browser,
        ...(hasArchive ? { archive: input.archive } : {}) },
      dailyCost: null, monthlyCost: null,
      unmeasured: [...(hasArchive ? ['representative-archive-shape', 'archive-storage-http-traffic'] : ['archive-capture', 'application-restore']),
        'representative-remote-activity', 'public-browser-journey',
        'monthly-frequencies', 'provider-billing', 'daily-projection'] });
  } catch { fail(); }
}
