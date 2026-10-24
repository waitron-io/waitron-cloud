import { test } from 'node:test';
import assert from 'node:assert/strict';
const helper = await import('./fixtures/replay-diagnostics.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});

// Relying on the test reporter's default Error rendering hides nested events as [Object].
test('pacedReplayReporterPrintsTheCompleteTraceAndRethrowsTheOriginalRefusal', async () => {
  assert.equal(typeof helper.withReplayDiagnostics, 'function');
  const error = Object.assign(Error('Invalid isolated cloud cost replay'), { diagnostic: {
    stage: 'replay', trace: [{ kind: 'stream-refusal', stage: 'restore-integrity' }],
  } });
  const messages = [];
  await assert.rejects(helper.withReplayDiagnostics(async () => { throw error; }, text => messages.push(text)), found => found === error);
  assert.deepEqual(messages, ['{"stage":"replay","trace":[{"kind":"stream-refusal","stage":"restore-integrity"}]}']);
});

test('pacedReplayReporterLeavesSuccessfulResultsUnchanged', async () => {
  assert.equal(typeof helper.withReplayDiagnostics, 'function');
  const messages = [];
  assert.equal(await helper.withReplayDiagnostics(async () => 207, text => messages.push(text)), 207);
  assert.deepEqual(messages, []);
});

for (const [name, makeError] of [
  ['null', () => null],
  ['undefined', () => undefined],
  ['throwing descriptor trap', () => new Proxy(Error('Replay refused'), {
    getOwnPropertyDescriptor() { throw Error('Descriptor inspection refused'); },
    get() { throw Error('Property read refused'); },
  })],
  ['revoked proxy', () => {
    const {proxy, revoke} = Proxy.revocable(Error('Replay refused'), {});
    revoke();
    return proxy;
  }],
  ['circular diagnostic', () => {
    const diagnostic = {stage: 'replay'};
    diagnostic.trace = diagnostic;
    return Object.assign(Error('Replay refused'), {diagnostic});
  }],
  ['unserializable diagnostic', () => Object.assign(Error('Replay refused'), {diagnostic: {elapsed: 1n}})],
]) test('pacedReplayReporterPreservesTheOriginalRefusalWith_' + name, async () => {
  const original = makeError(), messages = [];
  let caught = false;
  try { await helper.withReplayDiagnostics(async () => { throw original; }, text => messages.push(text)); }
  catch (error) { caught = true; assert.ok(error === original, 'preserve the exact thrown value'); }
  assert.equal(caught, true, 'the replay must still refuse');
  assert.deepEqual(messages, []);
});

test('pacedReplayReporterDoesNotInvokeDiagnosticAccessors', async () => {
  const original = Error('Replay refused'), messages = [];
  let reads = 0;
  Object.defineProperty(original, 'diagnostic', {get() { reads++; return {stage: 'replay'}; }});
  await assert.rejects(helper.withReplayDiagnostics(async () => { throw original; }, text => messages.push(text)), error => error === original);
  assert.equal(reads, 0, 'diagnostics must not execute error accessors');
  assert.deepEqual(messages, []);
});

test('pacedReplayReporterPreservesTheOriginalRefusalWhenTheReporterThrows', async () => {
  const original = Object.assign(Error('Replay refused'), {diagnostic: {stage: 'replay'}});
  let attempts = 0;
  await assert.rejects(helper.withReplayDiagnostics(async () => { throw original; }, () => {
    attempts++;
    throw Error('Report output refused');
  }), error => error === original);
  assert.equal(attempts, 1);
});
