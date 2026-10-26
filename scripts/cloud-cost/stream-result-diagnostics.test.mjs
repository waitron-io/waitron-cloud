import { test } from 'node:test';
import assert from 'node:assert/strict';
const helper = await import('./fixtures/stream-result-diagnostics.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./fixtures/stream-result-diagnostics.mjs', import.meta.url).href) return {};
  throw error;
});
const journal = () => JSON.stringify({ ownershipToken: 'PRIVATE_TOKEN', localResources: [
  { kind: 'replay-worker', state: 'started', id: 'PRIVATE_ID' },
  { kind: 'container', state: 'removed', path: '/PRIVATE_ROOT' },
] });
const refusal = () => Object.assign(Error('Invalid isolated cloud cost replay'), { diagnostic: {
  stage: 'replay', trace: [{ kind: 'stream-refusal', stage: 'restore-integrity' }],
  raw: 'PRIVATE_DIAGNOSTIC',
} });
async function failedControl(observation, read = journal) {
  assert.equal(typeof helper.withStreamResultDiagnostics, 'function', 'report a refusal hidden by the unchanged result-boundary assertion');
  const messages = [];
  let original;
  try { assert.equal(false, true, 'reach the changed result at the actual host boundary'); }
  catch (error) { original = error; }
  await assert.rejects(helper.withStreamResultDiagnostics(async () => { throw original; }, read,
    () => ({ elapsedMilliseconds: 12054.15, changed: false, signalAborted: false, resultRead: false, ...observation }),
    text => messages.push(text)), error => error === original);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].includes('PRIVATE'), false);
  assert.ok(messages[0].length < 8192);
  assert.ok(messages[0].startsWith('isolated-stream-result-refusal '));
  return JSON.parse(messages[0].slice('isolated-stream-result-refusal '.length));
}

test('streamResultReporterPreservesTheUnreachedBoundaryAssertionAndRetainsTheWorkerRefusal', async () => {
  assert.deepEqual(await failedControl({ refusal: refusal() }), {
    schemaVersion: 1, elapsedMilliseconds: 12054, changed: false, signalAborted: false,
    journalReadable: true, workerStarted: true, lastPreparation: 'replay-worker:started', resultRead: false,
    refusal: { reason: 'isolated-replay', stage: 'replay', controllerStage: 'unknown',
      trace: [{ kind: 'stream-refusal', stage: 'restore-integrity' }] },
  });
});

test('streamResultReporterDistinguishesAReadResultFromAnUnchangedResult', async () => {
  const report = await failedControl({ resultRead: true, refusal: Object.assign(refusal(), {
    diagnostic: { stage: 'result', controllerStage: 'stream-admission', trace: [] },
  }) });
  assert.equal(report.resultRead, true); assert.equal(report.changed, false);
  assert.deepEqual(report.refusal, { reason: 'isolated-replay', stage: 'result', controllerStage: 'stream-admission', trace: [] });
});

test('streamResultReporterLeavesExpectedRefusalsAndSuccessfulControlsSilent', async () => {
  assert.equal(typeof helper.withStreamResultDiagnostics, 'function');
  const untouched = () => assert.fail('a passing control needs no failure evidence');
  const result = {};
  assert.equal(await helper.withStreamResultDiagnostics(async () => {
    await assert.rejects(async () => { throw refusal(); }, { message: 'Invalid isolated cloud cost replay' });
    assert.equal(true, true, 'reach the changed result at the actual host boundary');
    return result;
  }, untouched, untouched, untouched), result);
});

for (const stage of ['configuration', 'storage-open', 'replay', 'storage-cleanup', 'result', 'unknown', 'worker-diagnostic-invalid'])
  test('streamResultReporterRetainsFixedWorkerStage_' + stage, async () => {
    const report = await failedControl({refusal: Object.assign(refusal(), {diagnostic: {stage}})});
    assert.equal(report.refusal.stage, stage);
  });
for (const stage of ['worker-result', 'replay-admission', 'stream-admission'])
  test('streamResultReporterRetainsFixedControllerStage_' + stage, async () => {
    const report = await failedControl({refusal: Object.assign(refusal(), {diagnostic: {stage: 'result', controllerStage: stage}})});
    assert.equal(report.refusal.controllerStage, stage);
  });

for (const [name, value] of [
  ['missing', undefined], ['null', null], ['raw', { message: 'PRIVATE_MESSAGE', diagnostic: {stage: 'PRIVATE_STAGE', controllerStage: 'PRIVATE_CONTROLLER'} }],
  ['proxy', new Proxy({}, {get() { assert.fail('do not read a proxy'); }, getOwnPropertyDescriptor() { assert.fail('do not inspect a proxy'); }})],
]) test('streamResultReporterContainsUnknownRefusals_' + name, async () => {
  const report = await failedControl({refusal: value});
  assert.deepEqual(report.refusal, { reason: 'unknown', stage: 'unknown', controllerStage: 'unknown' });
});

test('streamResultReporterNeverExecutesErrorOrDiagnosticAccessors', async () => {
  let reads = 0;
  const original = Object.defineProperties({}, {message: {get() {reads++; return 'PRIVATE_MESSAGE';}},
    diagnostic: {get() {reads++; return {stage: 'PRIVATE_STAGE'};}}});
  assert.deepEqual((await failedControl({refusal: original})).refusal,
    {reason: 'unknown', stage: 'unknown', controllerStage: 'unknown'});
  const diagnostic = Object.defineProperties({}, {stage: {get() {reads++; return 'PRIVATE_STAGE';}},
    controllerStage: {get() {reads++; return 'PRIVATE_CONTROLLER';}}, trace: {get() {reads++; return ['PRIVATE_TRACE'];}}});
  assert.deepEqual((await failedControl({refusal: Object.assign(refusal(), {diagnostic})})).refusal,
    {reason: 'isolated-replay', stage: 'unknown', controllerStage: 'unknown'});
  assert.equal(reads, 0);
});

for (const [name, trace] of [['raw', [{kind: 'stream-refusal', stage: 'PRIVATE_STAGE'}]],
  ['oversized', Array.from({length: 33}, () => ({kind: 'stream-refusal', stage: 'restore'}))],
  ['extra', [{kind: 'stream-refusal', stage: 'restore', raw: 'PRIVATE_TRACE'}]]])
  test('streamResultReporterContainsInvalidTraces_' + name, async () => {
    const report = await failedControl({refusal: Object.assign(refusal(), {diagnostic: {stage: 'replay', trace}})});
    assert.equal(report.refusal.stage, 'replay'); assert.equal(report.refusal.traceInvalid, true);
    assert.equal(Object.hasOwn(report.refusal, 'trace'), false);
  });

test('streamResultReporterRetainsAValidatedNativeFailureWithoutRawStderr', async () => {
  const trace = [{kind: 'native', operation: 'restore', code: 1, signal: null, stderrBytes: 721,
    stderrFlags: ['error', 'sqlite']}];
  assert.deepEqual((await failedControl({refusal: Object.assign(refusal(), {diagnostic: {stage: 'replay', trace}})})).refusal.trace, trace);
});

for (const [name, report] of [['throws', () => {throw Error('PRIVATE_REPORT');}],
  ['rejects', async () => {throw Error('PRIVATE_ASYNC_REPORT');}]])
  test('streamResultReporterPreservesTheExactFailureWhenOutput_' + name, async () => {
    assert.equal(typeof helper.withStreamResultDiagnostics, 'function');
    const original = Error('PRIVATE_ORIGINAL');
    await assert.rejects(helper.withStreamResultDiagnostics(async () => {throw original;}, journal,
      () => ({refusal: refusal()}), report), error => error === original);
  });

test('streamResultReporterKeepsEvidenceWhenThePrivateJournalCannotBeRead', async () => {
  const report = await failedControl({refusal: refusal()}, () => {throw Error('PRIVATE_JOURNAL');});
  assert.equal(report.journalReadable, false); assert.equal(report.workerStarted, null);
  assert.equal(report.refusal.stage, 'replay');
});

test('streamResultReporterRetainsAnAlreadyRejectedWorkerTraceWithoutPublishingIt', async () => {
  const report = await failedControl({refusal: Object.assign(refusal(), {diagnostic: {stage: 'result', traceInvalid: true}})});
  assert.equal(report.refusal.traceInvalid, true);
  assert.equal(Object.hasOwn(report.refusal, 'trace'), false);
});
