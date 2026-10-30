import {test} from 'node:test';
import assert from 'node:assert/strict';
import {measureRemoteBrowser} from './browser.mjs';
import {runBrowserFixture, withBrowserDiagnostics, parseBrowserDiagnostics} from './fixtures/browser-diagnostics.mjs';

// Losing lifecycle observations would hide which request blocked the unchanged journey.
for (const mode of ['pending-before', 'failed-overview', 'error-overview', 'finished-overview', 'late-before', 'aborted-before', 'saturated'])
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
  const page = {locator, on() {}, setDefaultTimeout() {}, async evaluate() {return true;}, async goto() {}, async reload() {
    reconnect = true;
    events.get('request')(overview);
    if (mode === 'saturated') for (let i = 1; i < 1005; i++) events.get('request')(request('/management-api/reports/overview?PRIVATE=' + i));
    if (mode === 'aborted-before') events.get('requestfailed')(before);
    if (mode === 'late-before') events.get('requestfinished')(before);
    if (mode === 'failed-overview') events.get('requestfailed')(overview);
    if (mode === 'error-overview' || mode === 'finished-overview') {
      events.get('response')({url: overview.url, request: () => overview, status: () => mode === 'error-overview' ? 503 : 200});
      events.get('requestfinished')(overview);
    }
  }};
  const context = {async addInitScript() {}, on: (event, listener) => events.set(event, listener), async newPage() {
    if (mode === 'pending-before' || mode === 'late-before' || mode === 'aborted-before') {
      events.get('request')(before);
      events.get('response')({url: before.url, request: () => before, status: () => 200});
    }
    return page;
  }, async newCDPSession() {return {async send() {}, on() {}};}};
  // The pre-reload stream has headers and is open; drain(true) retains it.
  before.resourceType = () => 'eventsource';
  if (mode === 'aborted-before') before.failure = () => ({errorText: 'net::ERR_ABORTED'});
  const chromium = {async launch() {return {async newContext() {return context;}, async close() {}};}};
  const want = {
    'pending-before': 'before:live:ok:1,before:live:pending:1,before:live:started:1,reconnect:overview:pending:1,reconnect:overview:started:1',
    'late-before': 'before:live:finished:1,before:live:ok:1,before:live:started:1,reconnect:overview:pending:1,reconnect:overview:started:1',
    'aborted-before': 'before:live:aborted:1,before:live:ok:1,before:live:started:1,reconnect:overview:pending:1,reconnect:overview:started:1',
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

async function trafficAfterReload(emit) {
  const events = new Map();
  let reconnect = false;
  const locator = selector => ({locator: child => locator(child), first() {return this;}, or() {return this;},
    async fill() {}, async click() {}, async isVisible() {return false;}, async waitFor() {
      if (reconnect && selector.includes('takings')) throw Error('PRIVATE_REFUSAL');
    }});
  const page = {locator, on() {}, setDefaultTimeout() {}, async evaluate() {return true;}, async goto() {}, async reload() {
    reconnect = true;
    await emit((event, value) => events.get(event)(value));
  }};
  const context = {async addInitScript() {}, on: (event, listener) => events.set(event, listener), async newPage() {return page;},
    async newCDPSession() {return {async send() {}, on() {}};}};
  const chromium = {async launch() {return {async newContext() {return context;}, async close() {}};}};
  let evidence;
  await assert.rejects(measureRemoteBrowser({chromium, staffHostname: 'staff.generated.example.test',
    email: 'generated@example.test', password: 'PRIVATE_PASSWORD'}), error => {
    evidence = error.browserTraffic;
    assert.equal(error.message, 'Invalid cloud cost browser journey');
    assert.equal(error.browserPhase, 'reconnect');
    return true;
  });
  assert.doesNotMatch(evidence, /PRIVATE|secret|example|https|\//);
  return evidence;
}
const trafficRequest = (path, type = 'fetch') => ({url: () => 'https://staff.generated.example.test' + path,
  resourceType: () => type, sizes: async () => ({requestBodySize: 0, responseBodySize: 1}),
  failure: () => ({errorText: 'PRIVATE_NETWORK_ERROR'})});

test('browserTrafficClassifiesEveryRouteWithoutPrivatePaths', async () => {
  const evidence = await trafficAfterReload(emit => {
    for (const [path, type] of [
      ['/manage/?secret=PRIVATE_DOCUMENT', 'document'], ['/manage/assets/PRIVATE_BUNDLE.js?secret=PRIVATE', 'script'],
      ['/management-api/session/me?secret=PRIVATE', 'fetch'], ['/management-api/reports/overview?secret=PRIVATE', 'fetch'],
      ['/management-api/reports/overdue-orders?secret=PRIVATE', 'fetch'], ['/management-api/PRIVATE_ENDPOINT?secret=PRIVATE', 'fetch'],
      ['/PRIVATE_PATH?secret=PRIVATE', 'fetch'], ['/PRIVATE_STREAM?secret=PRIVATE', 'eventsource'],
    ]) emit('request', trafficRequest(path, type));
    emit('request', {...trafficRequest('/PRIVATE'), url: () => 'https://PRIVATE.example/PRIVATE_PATH?secret=PRIVATE'});
  });
  assert.equal(evidence, 'reconnect:api:pending:1,reconnect:api:started:1,reconnect:asset:pending:1,reconnect:asset:started:1,reconnect:document:pending:1,reconnect:document:started:1,reconnect:live:pending:1,reconnect:live:started:1,reconnect:other:pending:1,reconnect:other:started:1,reconnect:outside:pending:1,reconnect:outside:started:1,reconnect:overdue:pending:1,reconnect:overdue:started:1,reconnect:overview:pending:1,reconnect:overview:started:1,reconnect:session:pending:1,reconnect:session:started:1');
});

test('browserTrafficClassifiesRevalidationAndEveryLifecycleEvent', async () => {
  const evidence = await trafficAfterReload(async emit => {
    for (const status of [200, 302, 304, 401, 403, 503]) {
      const req = trafficRequest('/management-api/reports/overview?secret=PRIVATE');
      emit('request', req); emit('response', {url: req.url, request: () => req, status: () => status});
      emit('requestfinished', req);
    }
    const failed = trafficRequest('/management-api/reports/overview?secret=PRIVATE');
    emit('request', failed); emit('requestfailed', failed);
    const aborted = {...trafficRequest('/management-api/reports/overview'), failure: () => ({errorText: 'net::ERR_ABORTED'})};
    emit('request', aborted); emit('requestfailed', aborted);
    const unknownSize = {...trafficRequest('/management-api/reports/overview'), sizes: async () => {throw Error('PRIVATE_SIZE');}};
    emit('request', unknownSize); emit('requestfinished', unknownSize);
  });
  assert.equal(evidence, 'reconnect:overview:aborted:1,reconnect:overview:error:1,reconnect:overview:failed:1,reconnect:overview:finished:7,reconnect:overview:not-modified:1,reconnect:overview:ok:1,reconnect:overview:redirect:1,reconnect:overview:refused:2,reconnect:overview:size-failed:1,reconnect:overview:started:9');
});

test('browserTrafficGrammarKeepsEveryBucketAtItsExactBound', () => {
  // Literal route/event inventories are independent of both the producer and parser.
  const routes = ['outside', 'live', 'session', 'overview', 'overdue', 'api', 'asset', 'document', 'other'];
  const events = ['started', 'ok', 'not-modified', 'redirect', 'refused', 'error', 'finished', 'size-failed', 'aborted', 'failed', 'pending'];
  const traffic = ['before', 'reconnect'].flatMap(phase => routes.flatMap(route => events.map(event => phase + ':' + route + ':' + event + ':999'))).join(',');
  assert.equal(traffic.split(',').length, 198);
  const script = `import {withBrowserDiagnostics} from ${JSON.stringify(new URL('./fixtures/browser-diagnostics.mjs', import.meta.url).href)};
    await withBrowserDiagnostics(async () => {throw Object.assign(Error('Invalid cloud cost browser journey'), {
      browserPhase: 'reconnect', browserTraffic: ${JSON.stringify(traffic)}
    });}, line => process.stderr.write(line + '\\n'));`;
  assert.throws(() => runBrowserFixture(process.execPath, ['--input-type=module', '-e', script], {}), error => {
    assert.equal(error.journeyRefused, true); assert.equal(error.browserTraffic, traffic); return true;
  });
  const messages = [];
  return withBrowserDiagnostics(async () => {throw Object.assign(Error('PRIVATE'), {
    browserPhase: 'reconnect', browserTraffic: traffic + ',reconnect:api:pending:1'
  });}, line => messages.push(line)).catch(() => {
    assert.deepEqual(messages, ['cost_browser_phase=reconnect']);
    assert.equal(parseBrowserDiagnostics('cost_browser_phase=reconnect\ncost_browser_traffic=' + traffic + ',reconnect:api:pending:1\n').browserTraffic, undefined);
  });
});
