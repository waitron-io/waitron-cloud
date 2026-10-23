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

// Omitting a fixed reconnect operation loses it at the generated child boundary.
for (const step of ['reload', 'takings', 'overdue-empty', 'requests'])
test('browserReporterCarriesReconnectOperation_' + step, async () => {
  const refusal = Error('PRIVATE_BROWSER_CANARY');
  Object.defineProperties(refusal, {browserPhase: {value: 'reconnect'}, browserStep: {value: step}});
  const messages = [];
  await assert.rejects(helper.withBrowserDiagnostics(async () => {throw refusal;}, value => messages.push(value)), error => error === refusal);
  assert.deepEqual(messages, ['cost_browser_phase=reconnect', 'cost_browser_step=' + step]);
});

test('browserReporterExcludesUnknownAccessorAndOutOfPhaseSteps', async () => {
  let reads = 0;
  const messages = [];
  for (const refusal of [
    Object.defineProperties(Error('PRIVATE'), {browserPhase: {value: 'reconnect'}, browserStep: {get() {reads++; throw Error('PRIVATE');}}}),
    Object.assign(Error('PRIVATE'), {browserPhase: 'reconnect', browserStep: 'PRIVATE https://private.example'}),
    Object.assign(Error('PRIVATE'), {browserPhase: 'login', browserStep: 'reload'}),
  ]) await assert.rejects(helper.withBrowserDiagnostics(async () => {throw refusal;}, value => messages.push(value)), error => error === refusal);
  assert.equal(reads, 0);
  assert.deepEqual(messages, ['cost_browser_phase=reconnect', 'cost_browser_phase=reconnect', 'cost_browser_phase=login']);
});

// A real child process must carry only the fixed labels into the fixture's refusal.
test('browserDiagnosticsSurviveTheRealChildBoundary', async () => {
  assert.equal(typeof helper.parseBrowserDiagnostics, 'function');
  const {spawnSync} = await import('node:child_process');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import {withBrowserDiagnostics} from ${JSON.stringify(new URL('./fixtures/browser-diagnostics.mjs', import.meta.url).href)};
    const error = Object.defineProperties(Error('PRIVATE_CHILD_CANARY'), {
      browserPhase: {value: 'reconnect'}, browserStep: {value: 'overdue-empty'}});
    await withBrowserDiagnostics(async () => {throw error;}, text => process.stderr.write(text + '\\n'));
  `], {encoding: 'utf8'});
  assert.equal(child.status, 1);
  assert.equal(child.stdout, '');
  assert.deepEqual(helper.parseBrowserDiagnostics(child.stderr), {browserPhase: 'reconnect', browserStep: 'overdue-empty'});
  for (const text of ['cost_browser_phase=PRIVATE\ncost_browser_step=reload\n',
    'prefix cost_browser_phase=reconnect\ncost_browser_step=reload\n',
    'cost_browser_step=reload\n', 'cost_browser_phase=reconnect\ncost_browser_step=PRIVATE\n',
    'cost_browser_phase=reconnect\nnoise cost_browser_step=reload\n']) {
    assert.equal(helper.parseBrowserDiagnostics(text).browserStep, undefined);
    assert.doesNotMatch(JSON.stringify(helper.parseBrowserDiagnostics(text)), /PRIVATE/);
  }
  assert.deepEqual(helper.parseBrowserDiagnostics('cost_browser_phase=login\ncost_browser_step=reload\n'), {browserPhase: 'login', browserStep: undefined});
});

// Dropping metadata from the command's refusal must lose a real child's labels.
test('browserFixtureCommandRetainsOnlySafeChildDiagnostics', () => {
  assert.equal(typeof helper.runBrowserFixture, 'function');
  for (const step of ['reload', 'takings', 'overdue-empty', 'requests']) {
    const script = `process.stderr.write('PRIVATE_CHILD_CANARY\\ncost_browser_phase=reconnect\\ncost_browser_step=${step}\\nError: Invalid cloud cost browser journey\\n'); process.exit(1);`;
    assert.throws(() => helper.runBrowserFixture(process.execPath, ['-e', script], {}), error => {
      assert.equal(error.message, 'Generated local gateway fixture failed');
      assert.equal(error.journeyRefused, true);
      assert.equal(error.browserPhase, 'reconnect');
      assert.equal(error.browserStep, step);
      assert.doesNotMatch(error.stack + JSON.stringify(error), /PRIVATE_CHILD_CANARY/);
      return true;
    });
  }
  assert.equal(helper.runBrowserFixture(process.execPath, ['-e', "process.stdout.write(' completed \\n')"], {}), 'completed');
});

// A descriptor trap must not replace the original refusal or expose its own error.
for (const property of ['browserPhase', 'browserStep'])
test('browserReporterPreservesRefusalWhenInspectionThrows_' + property, async () => {
  const refusal = new Proxy(Object.assign(Error('PRIVATE_ORIGINAL'), {
    browserPhase: 'reconnect', browserStep: 'reload',
  }), {
    getOwnPropertyDescriptor(target, key) {
      if (key === property) throw Error('PRIVATE_DESCRIPTOR_TRAP');
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const messages = [];
  await assert.rejects(helper.withBrowserDiagnostics(async () => {throw refusal;}, value => messages.push(value)), error => error === refusal);
  assert.deepEqual(messages, property === 'browserPhase' ? [] : ['cost_browser_phase=reconnect']);
});

test('browserReporterPreservesARevokedProxyRefusal', async () => {
  const {proxy: refusal, revoke} = Proxy.revocable(Error('PRIVATE_ORIGINAL'), {});
  revoke();
  const messages = [];
  // Node's rejects helper itself reads a property of the rejected value.
  const result = await helper.withBrowserDiagnostics(async () => {throw refusal;}, value => messages.push(value))
    .then(() => ({rejected: false}), error => ({rejected: true, error}));
  assert.equal(result.rejected, true);
  assert.equal(result.error, refusal);
  assert.deepEqual(messages, []);
});

test('browserReporterPreservesRefusalWhenAProxyReturnsAnInvalidDescriptor', async () => {
  const refusal = new Proxy(Object.defineProperty(Error('PRIVATE_ORIGINAL'), 'browserPhase', {
    value: 'reconnect', configurable: false,
  }), {
    getOwnPropertyDescriptor() {return {value: 'PRIVATE_DESCRIPTOR', configurable: true};},
  });
  const messages = [];
  await assert.rejects(helper.withBrowserDiagnostics(async () => {throw refusal;}, value => messages.push(value)), error => error === refusal);
  assert.deepEqual(messages, []);
});
