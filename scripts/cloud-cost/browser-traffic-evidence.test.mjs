import {test} from 'node:test';
import assert from 'node:assert/strict';
import {measureRemoteBrowser} from './browser.mjs';
import {runBrowserFixture, withBrowserDiagnostics, parseBrowserDiagnostics} from './fixtures/browser-diagnostics.mjs';

// Losing lifecycle observations would hide which request blocked the unchanged journey.
for (const mode of ['pending-before', 'failed-overview', 'error-overview', 'finished-overview', 'late-before', 'saturated'])
test('browserReconnectTrafficEvidence_' + mode, async () => {
  const events = new Map();
  let reconnect = false;
  const request = path => ({url: () => 'https://staff.generated.example.test' + path,
    resourceType: () => 'fetch', sizes: async () => ({requestBodySize: 0, responseBodySize: 10}),
    failure: () => ({errorText: 'PRIVATE_NETWORK_ERROR'})});
  const before = request('/management-api/private?secret=PRIVATE_QUERY');
  const overview = request('/management-api/reports/overview?secret=PRIVATE_QUERY');
  const locator = selector => ({locator: child => locator(child), first() {return this;}, or() {return this;},
    async fill() {}, async click() {}, async isVisible() {return false;},
    async waitFor() {
      if (reconnect && selector.includes('takings')) throw Object.assign(Error('PRIVATE_TIMEOUT'), {name: 'TimeoutError'});
    }});
  const page = {locator, on() {}, setDefaultTimeout() {}, async goto() {}, async reload() {
    reconnect = true;
    events.get('request')(overview);
    if (mode === 'saturated') for (let i = 1; i < 1005; i++) events.get('request')(request('/management-api/reports/overview?PRIVATE=' + i));
    if (mode === 'late-before') {
      events.get('response')({url: before.url, request: () => before, status: () => 200});
      events.get('requestfinished')(before);
    }
    if (mode === 'failed-overview') events.get('requestfailed')(overview);
    if (mode === 'error-overview' || mode === 'finished-overview') {
      events.get('response')({url: overview.url, request: () => overview, status: () => mode === 'error-overview' ? 503 : 200});
      events.get('requestfinished')(overview);
    }
  }};
  const context = {on: (event, listener) => events.set(event, listener), async newPage() {
    if (mode === 'pending-before' || mode === 'late-before') events.get('request')(before);
    return page;
  }, async newCDPSession() {return {async send() {}, on() {}};}};
  // A pre-reload EventSource may still be open; drain(true) must retain it.
  before.resourceType = () => 'eventsource';
  const chromium = {async launch() {return {async newContext() {return context;}, async close() {}};}};
  const want = {
    'pending-before': 'before:live:pending:1,before:live:started:1,reconnect:overview:pending:1,reconnect:overview:started:1',
    'late-before': 'before:live:finished:1,before:live:ok:1,before:live:started:1,reconnect:overview:pending:1,reconnect:overview:started:1',
    'saturated': 'reconnect:overview:pending:999,reconnect:overview:started:999',
    'failed-overview': 'reconnect:overview:failed:1,reconnect:overview:started:1',
    'error-overview': 'reconnect:overview:error:1,reconnect:overview:finished:1,reconnect:overview:started:1',
    'finished-overview': 'reconnect:overview:finished:1,reconnect:overview:ok:1,reconnect:overview:started:1',
  }[mode];
  await assert.rejects(measureRemoteBrowser({chromium, staffHostname: 'staff.generated.example.test',
    email: 'generated@example.test', password: 'PRIVATE_PASSWORD'}), error => {
    assert.equal(error.browserPhase, 'reconnect');
    assert.equal(error.browserTraffic, want);
    assert.equal(Object.getOwnPropertyDescriptor(error, 'browserTraffic').enumerable, false);
    assert.doesNotMatch(error.stack + JSON.stringify(error) + error.browserTraffic, /PRIVATE_|secret|example/);
    return true;
  });
});

test('browserTrafficEvidenceCrossesRealChild', () => {
  const script = `import {withBrowserDiagnostics} from ${JSON.stringify(new URL('./fixtures/browser-diagnostics.mjs', import.meta.url).href)};
    await withBrowserDiagnostics(async () => {throw Object.assign(Error('Invalid cloud cost browser journey'), {
      browserPhase: 'reconnect', browserTraffic: 'before:live:pending:1,reconnect:overview:error:2'
    });}, line => process.stderr.write(line + '\\n'));`;
  assert.throws(() => runBrowserFixture(process.execPath, ['--input-type=module', '-e', script], {}), error => {
    assert.equal(error.journeyRefused, true);
    assert.equal(error.browserTraffic, 'before:live:pending:1,reconnect:overview:error:2');
    return true;
  });
});

test('browserTrafficEvidenceRejectsUnboundedAndPrivateOutput', async () => {
  const messages = [];
  let reads = 0;
  for (const value of ['PRIVATE_URL', 'reconnect:PRIVATE:pending:1', 'reconnect:overview:pending:1000',
    'reconnect:overview:pending:0', 'reconnect:overview:pending:1\n',
    'reconnect:overview:pending:1,'.repeat(1000), {toString() {reads++; return 'none';}}]) {
    const error = Object.assign(Error('PRIVATE'), {browserPhase: 'reconnect', browserTraffic: value});
    await assert.rejects(withBrowserDiagnostics(async () => {throw error;}, line => messages.push(line)), e => e === error);
    if (typeof value === 'string' && !value.endsWith('\n')) assert.equal(parseBrowserDiagnostics('cost_browser_phase=reconnect\ncost_browser_traffic=' + value + '\n').browserTraffic, undefined);
  }
  assert.equal(reads, 0);
  assert.deepEqual(messages, Array(7).fill('cost_browser_phase=reconnect'));
});

test('browserTrafficEvidenceContainsHostileInspectionAndOutput', async () => {
  let reads = 0;
  const original = Object.defineProperties(Error('PRIVATE'), {browserPhase: {value: 'reconnect'},
    browserTraffic: {get() {reads++; throw Error('PRIVATE_GETTER');}}});
  const messages = [];
  await assert.rejects(withBrowserDiagnostics(async () => {throw original;}, line => messages.push(line)), e => e === original);
  assert.equal(reads, 0);
  assert.deepEqual(messages, ['cost_browser_phase=reconnect']);
  const outputFailure = Object.assign(Error('PRIVATE'), {browserPhase: 'reconnect', browserTraffic: 'none'});
  await assert.rejects(withBrowserDiagnostics(async () => {throw outputFailure;}, () => {throw Error('PRIVATE_OUTPUT');}), e => e === outputFailure);
});

test('browserTrafficEvidenceStaysInsideReconnect', async () => {
  const original = Object.assign(Error('PRIVATE'), {browserPhase: 'login', browserTraffic: 'before:session:refused:1'});
  const messages = [];
  await assert.rejects(withBrowserDiagnostics(async () => {throw original;}, line => messages.push(line)), e => e === original);
  assert.deepEqual(messages, ['cost_browser_phase=login']);
  assert.equal(parseBrowserDiagnostics('cost_browser_phase=login\ncost_browser_traffic=before:session:refused:1\n').browserTraffic, undefined);
});
