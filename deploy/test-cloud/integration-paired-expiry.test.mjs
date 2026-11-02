import assert from 'node:assert/strict';
import {test} from 'node:test';

const load = async () => {
  const api = await import('./test-fixtures/integration-paired-expiry.mjs').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url?.endsWith('/integration-paired-expiry.mjs')) return {};
    throw error;
  });
  assert.equal(typeof api.observePairedSnapshotExpiry, 'function', 'The paired expiry observer is missing');
  return api.observePairedSnapshotExpiry;
};
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function initial() {
  const binding = {organisationId: uuid(2), venueId: uuid(3), installationId: uuid(4)};
  return {version: 1, kind: 'test-cloud-withdrawal', runId: uuid(1),
    cloud: {head: 'a'.repeat(40), tree: 'b'.repeat(40), image: 'sha256:' + 'c'.repeat(64), dirty: false, files: 1696, runtimeSha256: 'd'.repeat(64)},
    installation: {...binding},
    stream: {...binding, before: {writeStatus: 200, readStatus: 200, outsidePrefixRefused: true, neighbourRefused: true},
      after: {writeStatus: 403, readStatus: 403, durationMs: 3400}, restartObserved: true,
      retainedData: true, readerPreserved: true, installationPreserved: true, plan: 'free'},
    gateway: {...binding, staffRefused: true, publicRefused: true, peerRemoved: true, cachedConfigurationMasked: true,
      installationPreserved: true, restartObserved: true, plan: 'free', durationMs: 3100},
    snapshot: {...binding, pointId: uuid(5), requestedAt: 1000, acceptedAt: 2000, expiresAt: '1970-01-01T00:15:01.000Z',
      downgradedAt: 300000, observedAt: 301000, remainingMs: 600000, writeStatus: 200, expiryObserved: false,
      newGrantRefused: true, status: 'residual-access'}};
}
function scenario() {
  let wall = 301000, monotonic = 100;
  const input = initial(), waits = [];
  return {input, waits,
    now: () => wall, elapsed: () => monotonic,
    advance: (wallMs, elapsedMs = wallMs) => {wall += wallMs; monotonic += elapsedMs;},
    wait: async ms => {waits.push(ms); wall += ms; monotonic += ms;},
    observe: async () => ({...input.snapshot, observedAt: wall, remainingMs: 0, writeStatus: 403, expiryObserved: true, status: 'expired'})};
}

test('the same paired grant is observed after real waiting and retains its run, source and withdrawal evidence', async () => {
  const observe = await load(), s = scenario(), before = structuredClone(s.input);
  const result = await observe({withdrawal: s.input, ...s});
  assert.deepEqual(s.waits, [601000]);
  assert.deepEqual(result, {...before, snapshot: {...before.snapshot, observedAt: 902000, remainingMs: 0,
    writeStatus: 403, expiryObserved: true, status: 'expired'}});
  assert.deepEqual(s.input, before);
  result.cloud.head = 'e'.repeat(40); assert.equal(s.input.cloud.head, 'a'.repeat(40));
});
test('the observer must make a fresh provider request after waiting', async () => {
  const observe = await load(), s = scenario();
  await assert.rejects(observe({withdrawal: s.input, ...s, observe: async () => {throw Error('provider unavailable');}}), /provider unavailable/);
});
test('wall-clock acceleration cannot replace the actual remaining lifetime', async () => {
  const observe = await load(), s = scenario();
  await assert.rejects(observe({withdrawal: s.input, ...s, wait: async () => s.advance(601000, 0)}));
});
test('an early wake cannot reach the provider probe', async () => {
  const observe = await load(), s = scenario(); let reached = false;
  await assert.rejects(observe({withdrawal: s.input, ...s, wait: async () => s.advance(599999), observe: async () => {reached = true; return s.observe();}}));
  assert.equal(reached, false);
});
test('a backwards wall clock cannot claim a bounded observation', async () => {
  const observe = await load(), s = scenario();
  await assert.rejects(observe({withdrawal: s.input, ...s, wait: async () => s.advance(-1, 601000)}));
});
test('an excessive wait cannot publish a bounded refusal', async () => {
  const observe = await load(), s = scenario();
  await assert.rejects(observe({withdrawal: s.input, ...s, wait: async () => s.advance(611001)}));
});
for (const [name, change] of [
  ['another organisation', v => v.organisationId = uuid(9)], ['another venue', v => v.venueId = uuid(9)],
  ['another installation', v => v.installationId = uuid(9)], ['another snapshot', v => v.pointId = uuid(9)],
  ['another request', v => v.requestedAt = 2000], ['another accepted write', v => v.acceptedAt = 2500],
  ['another expiry', v => v.expiresAt = '1970-01-01T00:15:00.000Z'], ['another downgrade', v => v.downgradedAt = 300001],
  ['a fresh grant', v => v.newGrantRefused = false], ['a still-live credential', v => Object.assign(v, {observedAt: 900000, remainingMs: 1000, writeStatus: 200, expiryObserved: false, status: 'residual-access'})],
  ['an unavailable provider', v => v.writeStatus = 503], ['a stale observation', v => v.observedAt = 901000],
  ['an invented observation', v => v.observedAt = 908001], ['private extensions', v => v.credentials = 'private'],
]) test('paired expiry refuses ' + name, async () => {
  const observe = await load(), s = scenario();
  await assert.rejects(observe({withdrawal: s.input, ...s, observe: async () => {const v = await s.observe(); change(v); return v;}}));
});
test('already-expired independent evidence cannot replace this run initial live write', async () => {
  const observe = await load(), s = scenario();
  Object.assign(s.input.snapshot, {observedAt: 902000, remainingMs: 0, writeStatus: 403, expiryObserved: true, status: 'expired'});
  await assert.rejects(observe({withdrawal: s.input, ...s, now: () => 902000}));
});
test('a stale initial write cannot start a new lifetime wait', async () => {
  const observe = await load(), s = scenario(); s.advance(10001);
  await assert.rejects(observe({withdrawal: s.input, ...s}));
});
test('missing initial withdrawal evidence refuses before waiting', async () => {
  const observe = await load(), s = scenario(); delete s.input.stream;
  await assert.rejects(observe({withdrawal: s.input, ...s})); assert.deepEqual(s.waits, []);
});
