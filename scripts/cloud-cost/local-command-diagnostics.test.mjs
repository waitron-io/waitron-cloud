import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const helper = await import('./fixtures/local-command-diagnostics.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./fixtures/local-command-diagnostics.mjs', import.meta.url).href) return {};
  throw error;
});
const journal = () => JSON.stringify({ ownershipToken: 'PRIVATE_TOKEN', localResources: [
  {kind: 'outbound-proof', state: 'intent', id: 'PRIVATE_ID'},
  {kind: 'container', state: 'removed', path: '/PRIVATE_ROOT'},
] });
async function failedControl(observed, read = journal) {
  assert.equal(typeof helper.withLocalCommandDiagnostics, 'function', 'retain the child outcome before fixture teardown');
  const messages = [], original = new assert.AssertionError({actual: false, expected: true, operator: 'strictEqual'});
  await assert.rejects(helper.withLocalCommandDiagnostics(async () => {throw original;}, read,
    () => ({elapsedMilliseconds: 20014.7, requestedSignal: 'SIGINT', sent: false, timerFired: false,
      result: {status: 1, signal: null}, stdoutBytes: 0, stderrBytes: 34, ...observed}), text => messages.push(text)),
    error => error === original);
  assert.equal(messages.length, 1);
  assert.ok(messages[0].startsWith('local-command-refusal '));
  assert.equal(messages[0].includes('PRIVATE'), false);
  assert.ok(messages[0].length < 1024);
  return JSON.parse(messages[0].slice('local-command-refusal '.length));
}

test('localCommandReporterRetainsEarlyExitAndLastPreparationWithoutRawOutput', async () => {
  assert.deepEqual(await failedControl({stdout: 'PRIVATE_STDOUT', stderr: 'PRIVATE_STDERR', error: Error('PRIVATE_ERROR')}), {
    schemaVersion: 1, elapsedMilliseconds: 20015, changed: false, signalAborted: false,
    journalReadable: true, workerStarted: false, lastPreparation: 'outbound-proof:intent',
    requestedSignal: 'SIGINT', sent: false, timerFired: false, childClosed: true,
    status: 1, signal: null, stdoutBytes: 0, stderrBytes: 34,
  });
});

test('localCommandReporterDistinguishesForcedCollectionAfterAdmission', async () => {
  const report = await failedControl({requestedSignal: 'SIGTERM', sent: true, timerFired: true,
    result: {status: null, signal: 'SIGKILL'}}, () => JSON.stringify({localResources: [{kind: 'replay-worker', state: 'started'}]}));
  assert.equal(report.workerStarted, true); assert.equal(report.lastPreparation, 'replay-worker:started');
  assert.equal(report.sent, true); assert.equal(report.timerFired, true);
  assert.equal(report.requestedSignal, 'SIGTERM'); assert.equal(report.status, null); assert.equal(report.signal, 'SIGKILL');
});

test('localCommandReporterDistinguishesMissingCloseFromAnUnknownJournal', async () => {
  const report = await failedControl({result: undefined}, () => {throw Error('PRIVATE_READ');});
  assert.equal(report.childClosed, false); assert.equal(report.status, null); assert.equal(report.signal, null);
  assert.equal(report.journalReadable, false); assert.equal(report.workerStarted, null);
});

test('localCommandReporterLeavesPassingAssertionsSilent', async () => {
  assert.equal(typeof helper.withLocalCommandDiagnostics, 'function');
  const untouched = () => assert.fail('successful checks need no failure diagnostics');
  assert.equal(await helper.withLocalCommandDiagnostics(async () => 42, untouched, untouched, untouched), 42);
});

for (const [name, report] of [['throws', () => {throw Error('PRIVATE_REPORT');}],
  ['rejects', async () => {throw Error('PRIVATE_REPORT');}]])
  test('localCommandReporterPreservesOriginalFailureWhenReporting_' + name, async () => {
    assert.equal(typeof helper.withLocalCommandDiagnostics, 'function');
    const original = Error('PRIVATE_ORIGINAL');
    await assert.rejects(helper.withLocalCommandDiagnostics(async () => {throw original;}, journal, () => ({}), report), error => error === original);
  });

for (const [value, expected] of [[-1, 0], [1e12, 1000000000], [NaN, 0], [Infinity, 0], ['PRIVATE_COUNT', 0]])
  test('localCommandReporterBoundsOutputCounts_' + String(value), async () => {
    const report = await failedControl({stdoutBytes: value, stderrBytes: value, requestedSignal: 'PRIVATE_SIGNAL',
      sent: 'PRIVATE_SENT', timerFired: 'PRIVATE_TIMER', result: {status: 'PRIVATE_STATUS', signal: 'PRIVATE_SIGNAL'}});
    assert.equal(report.stdoutBytes, expected); assert.equal(report.stderrBytes, expected);
    assert.equal(report.status, null); assert.equal(report.signal, null); assert.equal(report.requestedSignal, 'unknown');
    assert.equal(report.sent, false); assert.equal(report.timerFired, false);
  });

test('localCommandReporterRetainsAnActualChildExitWithoutPublishingItsStreams', async () => {
  const child = spawn(process.execPath, ['-e', 'console.log("PRIVATE_STDOUT");console.error("PRIVATE_STDERR");process.exitCode=7;'], {stdio: ['ignore', 'pipe', 'pipe']});
  let stdoutBytes = 0, stderrBytes = 0;
  child.stdout.on('data', bytes => {stdoutBytes += bytes.length;});
  child.stderr.on('data', bytes => {stderrBytes += bytes.length;});
  const result = await new Promise((resolve, reject) => {child.once('error', reject); child.once('close', (status, signal) => resolve({status, signal}));});
  const report = await failedControl({result, stdoutBytes, stderrBytes});
  assert.equal(report.status, 7); assert.equal(report.signal, null); assert.equal(report.childClosed, true);
  assert.equal(report.stdoutBytes, 15); assert.equal(report.stderrBytes, 15);
});
