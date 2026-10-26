import { test } from 'node:test';
import assert from 'node:assert/strict';
const helper = await import('./fixtures/ownership-diagnostics.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./fixtures/ownership-diagnostics.mjs', import.meta.url).href) return {};
  throw error;
});
const state = () => ({ elapsedMilliseconds: 32142.94, changed: false, signalAborted: false });
const original = Object.assign(Error('PRIVATE_ORIGINAL'), { path: '/PRIVATE_ERROR' });
async function reportFor(entries, observation = state) {
  assert.equal(typeof helper.withOwnershipDiagnostics, 'function', 'report the reached journal stage without changing the refusal');
  const messages = [];
  await assert.rejects(helper.withOwnershipDiagnostics(async () => { throw original; },
    () => JSON.stringify({ ownershipToken: 'PRIVATE_TOKEN', localResources: entries }), observation,
    message => messages.push(message)), error => error === original);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].includes('PRIVATE'), false);
  return JSON.parse(messages[0].slice('ownership-start-refusal '.length));
}

test('ownershipFailureReportsPreparationBeforeTheWorkerStartsWithoutPrivateFields', async () => {
  assert.deepEqual(await reportFor([
    { kind: 'network', state: 'started', id: 'PRIVATE_ID' },
    { kind: 'outbound-proof', state: 'intent', containerIds: ['PRIVATE_ID'] },
    { kind: 'container', state: 'removed' }, { kind: 'network', state: 'removed' },
  ]), { schemaVersion: 1, elapsedMilliseconds: 32143, changed: false, signalAborted: false,
    journalReadable: true, workerStarted: false, lastPreparation: 'outbound-proof:intent' });
});

test('ownershipFailureDistinguishesAnAdmittedWorkerFromAPreparationRefusal', async () => {
  assert.deepEqual(await reportFor([
    { kind: 'database-copy', state: 'ready', path: '/PRIVATE_DATABASE' },
    { kind: 'replay-worker', state: 'started', id: 'PRIVATE_ID' },
    { kind: 'isolated-replay', state: 'cleanup-intent', path: '/PRIVATE_ROOT' },
  ], () => ({ elapsedMilliseconds: 8.4, changed: true, signalAborted: true })),
  { schemaVersion: 1, elapsedMilliseconds: 8, changed: true, signalAborted: true,
    journalReadable: true, workerStarted: true, lastPreparation: 'replay-worker:started' });
});

for (const [kind, stage] of [
  ['isolated-replay','intent'], ['isolated-replay','ready'], ['network','intent'], ['network','started'],
  ['container','intent'], ['container','started'], ['outbound-proof','intent'], ['outbound-proof','ready'],
  ['replay-isolation','ready'], ['source-copy-stage','intent'], ['source-copy-container','intent'],
  ['source-copy-container','created'], ['source-copy-isolation','ready'], ['database-copy','intent'], ['database-copy','ready'],
]) test('ownershipFailureRetainsThePreparationStage_' + kind + '_' + stage, async () => {
  const report = await reportFor([{ kind, state: stage }]);
  assert.equal(report.lastPreparation, kind + ':' + stage);
  assert.equal(report.workerStarted, false);
});

test('ownershipReporterLeavesSuccessUntouchedWithoutReadingTheJournalOrObservation', async () => {
  assert.equal(typeof helper.withOwnershipDiagnostics, 'function');
  const untouched = () => assert.fail('a successful run needs no failure diagnostics');
  assert.equal(await helper.withOwnershipDiagnostics(async () => 207, untouched, untouched, untouched), 207);
});

for (const [name, read] of [
  ['unreadable', () => { throw Error('PRIVATE_READ'); }], ['invalid', () => '{PRIVATE'],
  ['nonarray', () => JSON.stringify({localResources: {private: 'PRIVATE'}})],
  ['oversized', () => JSON.stringify({private: 'PRIVATE'.repeat(12000)})],
]) test('ownershipReporterPreservesRefusalWithoutAReadableJournal_' + name, async () => {
  assert.equal(typeof helper.withOwnershipDiagnostics, 'function');
  const messages = [];
  await assert.rejects(helper.withOwnershipDiagnostics(async () => { throw original; }, read, state,
    text => messages.push(text)), error => error === original);
  assert.equal(messages.length, 1);
  assert.deepEqual(JSON.parse(messages[0].slice('ownership-start-refusal '.length)), {
    schemaVersion: 1, elapsedMilliseconds: 32143, changed: false, signalAborted: false,
    journalReadable: false, workerStarted: null, lastPreparation: 'unknown',
  });
});

test('ownershipReporterOmitsUnknownFieldsAndBoundsOutputForLargeJournals', async () => {
  const report = await reportFor([...Array.from({length: 500}, () => ({kind: 'PRIVATE_KIND',state: 'PRIVATE_STATE'})),
    {kind: 'replay-worker',state: 'PRIVATE_STATE'}, null, 'PRIVATE_RAW']);
  assert.equal(report.lastPreparation, 'unknown'); assert.equal(report.workerStarted, false);
  assert.ok(JSON.stringify(report).length < 256);
});

for (const [name, report] of [
  ['throws', () => { throw Error('PRIVATE_REPORTER'); }],
  ['rejects', async () => { throw Error('PRIVATE_ASYNC_REPORTER'); }],
]) test('ownershipReporterPreservesTheOriginalFailureWhenReporting_' + name, async () => {
  assert.equal(typeof helper.withOwnershipDiagnostics, 'function');
  await assert.rejects(helper.withOwnershipDiagnostics(async () => { throw original; },
    () => '{}', state, report), error => error === original);
});

// A refusal before the poll must retain the very assertion that exposes missed ownership mutation.
test('ownershipReporterPreservesTheActualUnreachedOwnershipAssertion', async () => {
  const messages = [];
  await assert.rejects(helper.withOwnershipDiagnostics(async () => assert.equal(false, true),
    () => JSON.stringify({localResources: [{kind: 'replay-isolation', state: 'ready'}]}), state,
    text => messages.push(text)), error => error.code === 'ERR_ASSERTION' && error.actual === false && error.expected === true);
  const report = JSON.parse(messages[0].slice('ownership-start-refusal '.length));
  assert.equal(report.workerStarted, false); assert.equal(report.changed, false);
  assert.equal(report.lastPreparation, 'replay-isolation:ready');
});

for (const [input, expected] of [[-1, 0], [1e12, 1000000000], [Infinity, 0], [NaN, 0]])
  test('ownershipReporterBoundsElapsedTime_' + String(input), async () => {
    const report = await reportFor([], () => ({elapsedMilliseconds: input, changed: 'PRIVATE_CHANGED', signalAborted: 'PRIVATE_ABORT'}));
    assert.equal(report.elapsedMilliseconds, expected);
    assert.equal(report.changed, false); assert.equal(report.signalAborted, false);
  });
