import {test} from 'node:test';
import assert from 'node:assert/strict';
const helper = await import('./fixtures/browser-diagnostics.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});

test('browserReporterRetainsTheFixedPhaseAndOriginalRefusal', async () => {
  assert.equal(typeof helper.withBrowserDiagnostics, 'function');
  const refusal = Error('PRIVATE_BROWSER_CANARY');
  Object.defineProperty(refusal, 'browserPhase', {value: 'accounting'});
  const messages = [];
  await assert.rejects(helper.withBrowserDiagnostics(async () => {throw refusal;}, value => messages.push(value)), error => error === refusal);
  assert.deepEqual(messages, ['cost_browser_phase=accounting']);
});

test('browserReporterNeverReadsPrivateAccessorsOrPrintsUnknownPhases', async () => {
  assert.equal(typeof helper.withBrowserDiagnostics, 'function');
  let reads = 0;
  const accessor = Object.defineProperty(Error('PRIVATE'), 'browserPhase', {get() {reads++; throw Error('PRIVATE');}});
  const messages = [];
  for (const refusal of [accessor, Object.assign(Error('PRIVATE'), {browserPhase: 'PRIVATE'}), Error('PRIVATE'), null])
    await assert.rejects(helper.withBrowserDiagnostics(async () => {throw refusal;}, value => messages.push(value)), error => error === refusal);
  assert.equal(reads, 0);
  assert.deepEqual(messages, []);
});

test('browserReporterReturnsTheUnchangedSuccessfulJourney', async () => {
  assert.equal(typeof helper.withBrowserDiagnostics, 'function');
  const messages = [], result = {actions: ['sign-in']};
  assert.equal(await helper.withBrowserDiagnostics(async () => result, value => messages.push(value)), result);
  assert.deepEqual(messages, []);
});
