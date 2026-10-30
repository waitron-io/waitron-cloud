import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const helper = await import('./streamed-day-diagnostics.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./streamed-day-diagnostics.mjs', import.meta.url).href) return {};
  throw error;
});
const prefix = 'streamed-day-refusal ';
const trace = [{ kind: 'replay', stage: 'stream-finish' }, { kind: 'stream-refusal', stage: 'quiesce-checkpoint' }];
const observation = () => ({ stage: 'private-replay', trace });

test('streamedDayFailureRetainsValidatedReplayTraceAndExactOriginalRefusal', async () => {
  assert.equal(typeof helper.withStreamedDayDiagnostics, 'function', 'retain replay evidence before the synthetic catch discards it');
  const original = Error('PRIVATE_ERROR /state/private'), messages = [];
  await assert.rejects(helper.withStreamedDayDiagnostics(async () => { throw original; }, observation,
    text => messages.push(text)), error => error === original);
  assert.deepEqual(messages, [prefix + JSON.stringify({ schemaVersion: 1, stage: 'private-replay', traceAvailable: true, trace })]);
});

test('streamedDaySuccessDoesNotInspectOrReportDiagnostics', async () => {
  assert.equal(typeof helper.withStreamedDayDiagnostics, 'function');
  const untouched = () => assert.fail('success needs no diagnostic');
  const result = {};
  assert.equal(await helper.withStreamedDayDiagnostics(async () => result, untouched, untouched), result);
});

test('streamedDayTraceRetainsOnlyTheLast32Events', async () => {
  assert.equal(typeof helper.withStreamedDayDiagnostics, 'function');
  const original = Error('PRIVATE_ERROR'), messages = [];
  const events = [{ kind: 'replay', stage: 'input' }, ...Array.from({ length: 32 }, () => trace[1])];
  await assert.rejects(helper.withStreamedDayDiagnostics(async () => { throw original; },
    () => ({ stage: 'private-replay', trace: events }), text => messages.push(text)), error => error === original);
  assert.equal(JSON.parse(messages[0].slice(prefix.length)).trace.length, 32);
  assert.deepEqual(JSON.parse(messages[0].slice(prefix.length)).trace[0], trace[1]);
});

for (const [name, events] of [
  ['private-stage', [{ kind: 'replay-refusal', stage: 'PRIVATE_STAGE' }]],
  ['private-extra-field', [{ kind: 'replay-refusal', stage: 'cleanup', private: 'PRIVATE_TOKEN' }]],
  ['non-array', 'PRIVATE_TRACE'],
]) test('streamedDayInvalidTraceStillReportsFixedOuterStage_' + name, async () => {
  assert.equal(typeof helper.withStreamedDayDiagnostics, 'function');
  const messages = [], original = Error('PRIVATE_ERROR');
  await assert.rejects(helper.withStreamedDayDiagnostics(async () => { throw original; },
    () => ({ stage: 'private-replay', trace: events }), text => messages.push(text)), error => error === original);
  assert.deepEqual(messages, [prefix + JSON.stringify({ schemaVersion: 1, stage: 'private-replay', traceAvailable: false, trace: [] })]);
});

test('streamedDayUnknownOuterStageCannotExposePrivateData', async () => {
  assert.equal(typeof helper.withStreamedDayDiagnostics, 'function');
  const messages = [], original = Error('PRIVATE_ERROR');
  await assert.rejects(helper.withStreamedDayDiagnostics(async () => { throw original; },
    () => ({ stage: 'PRIVATE_STAGE', trace: [] }), text => messages.push(text)), error => error === original);
  assert.equal(JSON.parse(messages[0].slice(prefix.length)).stage, 'unknown');
  assert.doesNotMatch(messages.join(''), /PRIVATE/);
});

for (const fault of ['observe', 'report']) test('streamedDayDiagnosticFailurePreservesRefusal_' + fault, async () => {
  assert.equal(typeof helper.withStreamedDayDiagnostics, 'function');
  const original = Error('PRIVATE_ORIGINAL');
  const broken = () => { throw Error('PRIVATE_REPORT'); };
  await assert.rejects(helper.withStreamedDayDiagnostics(async () => { throw original; },
    fault === 'observe' ? broken : observation, broken), error => error === original);
});

test('streamedDayParentPrintsValidatedEvidenceFromAnActualRefusingChild', () => {
  assert.equal(typeof helper.runStreamedDayFixture, 'function', 'print child evidence outside the abbreviated command exception');
  const messages = [];
  const script = `import {withStreamedDayDiagnostics} from ${JSON.stringify(new URL('./streamed-day-diagnostics.mjs', import.meta.url).href)};
    await withStreamedDayDiagnostics(async()=>{throw Error('PRIVATE_CHILD_ERROR')},
      ()=>(${JSON.stringify({ stage: 'private-replay', trace })}), text=>process.stderr.write(text+'\\n'));`;
  assert.throws(() => helper.runStreamedDayFixture(process.execPath, ['--input-type=module', '-e', script],
    { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }, text => messages.push(text)), error => error.status === 1);
  assert.deepEqual(messages, [prefix + JSON.stringify({ schemaVersion: 1, stage: 'private-replay', traceAvailable: true, trace })]);
  assert.doesNotMatch(messages.join(''), /PRIVATE/);
});

test('streamedDayParentLeavesSuccessfulChildOutputUnchangedAndSilent', () => {
  assert.equal(typeof helper.runStreamedDayFixture, 'function');
  assert.equal(helper.runStreamedDayFixture(process.execPath, ['-e', 'process.stdout.write("42")'],
    { encoding: 'utf8', timeout: 5000 }, () => assert.fail('successful child needs no failure report')), '42');
});

for (const [name, text] of [
  ['raw', 'PRIVATE_ERROR'],
  ['extra-field', prefix + JSON.stringify({ schemaVersion: 1, stage: 'private-replay', traceAvailable: true, trace, private: 'PRIVATE_TOKEN' })],
  ['unsafe-trace', prefix + JSON.stringify({ schemaVersion: 1, stage: 'private-replay', traceAvailable: true, trace: [{ kind: 'replay', stage: 'PRIVATE_STAGE' }] })],
  ['oversized', prefix + ' '.repeat(65536)],
]) test('streamedDayParentDoesNotPublishUnvalidatedChildText_' + name, () => {
  assert.equal(typeof helper.runStreamedDayFixture, 'function');
  const messages = [];
  assert.throws(() => helper.runStreamedDayFixture(process.execPath, ['-e', `process.stderr.write(${JSON.stringify(text)});process.exitCode=7`],
    { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }, text => messages.push(text)), error => error.status === 7);
  assert.deepEqual(messages, []);
});

test('streamedDayParentReportFailureCannotReplaceChildExit', () => {
  assert.equal(typeof helper.runStreamedDayFixture, 'function');
  const text = prefix + JSON.stringify({ schemaVersion: 1, stage: 'private-replay', traceAvailable: true, trace });
  assert.throws(() => helper.runStreamedDayFixture(process.execPath, ['-e', `process.stderr.write(${JSON.stringify(text)});process.exitCode=7`],
    { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }, () => { throw Error('PRIVATE_REPORT'); }), error => error.status === 7);
});

for (const mode of ['normal', 'cancel', 'source']) test('streamedDaySmokeRetainsEvidenceAndCleanup_' + mode, () => {
  const child = spawnSync(process.execPath, [new URL('./fixtures/streamed-day-diagnostic-probe.mjs', import.meta.url).pathname, mode],
    { encoding: 'utf8', timeout: 5000 });
  assert.equal(child.signal, null); assert.equal(child.status, mode === 'cancel' ? 0 : 1, child.stderr);
  const messages = child.stderr.split('\n').filter(line => line.startsWith(prefix));
  if (mode === 'cancel') assert.deepEqual(messages, []);
  else {
    assert.equal(messages.length, 1, 'the actual smoke catch must retain a bounded refusal before cleanup');
    const evidence = JSON.parse(messages[0].slice(prefix.length));
    assert.equal(evidence.stage, mode === 'source' ? 'source-open' : 'private-replay');
    assert.deepEqual(evidence.trace, mode === 'source' ? [] : trace);
    assert.doesNotMatch(messages[0], /PRIVATE/);
  }
  const cleanup = JSON.parse(child.stdout.trim().split('\n').at(-1));
  assert.equal(cleanup.removed, true);
  if (mode !== 'source') assert.equal(cleanup.closed, true);
});
