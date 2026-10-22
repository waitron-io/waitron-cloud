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
