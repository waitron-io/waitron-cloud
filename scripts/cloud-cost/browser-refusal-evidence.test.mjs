import {test} from 'node:test';
import assert from 'node:assert/strict';
import {measureRemoteBrowser} from './browser.mjs';

let privateReads = 0;
const privateName = Object.defineProperty(Error('PRIVATE_NAME'), 'name', {get() {privateReads++; throw Error('PRIVATE_GETTER');}});
const {proxy: revoked, revoke} = Proxy.revocable(Error('PRIVATE_REVOKED'), {});
revoke();

// Losing a fixed observation must hide it from the real journey's public refusal.
for (const [name, thrown, session, pageError, wantFailure, wantSession, wantPage] of [
  ['timeout-accepted', Object.assign(Error('PRIVATE_TIMEOUT https://private.example/token'), {name: 'TimeoutError'}), 200, false, 'timeout', 'accepted', 'clear'],
  ['timeout-refused', Object.assign(Error('PRIVATE_TIMEOUT'), {name: 'TimeoutError'}), 401, false, 'timeout', 'refused', 'clear'],
  ['other-response', Error('PRIVATE_OTHER'), 503, true, 'other', 'other', 'error'],
  ['no-response', undefined, undefined, false, 'other', 'unseen', 'clear'],
  ['private-name', privateName, undefined, false, 'other', 'unseen', 'clear'],
  ['revoked-refusal', revoked, undefined, false, 'other', 'unseen', 'clear'],
]) test('browserReconnectRetainsSafeFailureEvidence_' + name, async () => {
  const events = new Map(), pageEvents = new Map();
  let reconnect = false, closed = 0;
  const locator = selector => ({
    locator: child => locator(child), first() {return this;}, or() {return this;},
    async fill() {}, async click() {}, async isVisible() {return false;},
    async waitFor() {if (reconnect && selector.includes('takings')) throw thrown;},
  });
  const response = (status, path = '/management-api/session/me') => ({
    status: () => status, url: () => 'https://staff.generated.example.test' + path,
  });
  const page = {locator, on: (event, listener) => pageEvents.set(event, listener), setDefaultTimeout() {}, async goto() {
    events.get('response')(response(200));
    pageEvents.get('pageerror')(Error('PRIVATE_BEFORE_RECONNECT'));
  },
    async reload() {
      reconnect = true;
      if (session !== undefined) events.get('response')(response(session));
      // An unrelated accepted API response cannot overwrite the session refusal.
      events.get('response')(response(200, '/management-api/overview'));
      if (pageError) pageEvents.get('pageerror')(Error('PRIVATE_PAGE_ERROR'));
    },
  };
  const context = {on: (event, listener) => events.set(event, listener),
    async newPage() {return page;}, async newCDPSession() {return {async send() {}, on() {}};},
  };
  const chromium = {async launch() {return {async newContext() {return context;}, async close() {closed++;}};}};
  await assert.rejects(measureRemoteBrowser({chromium, staffHostname: 'staff.generated.example.test',
    email: 'generated@example.test', password: 'PRIVATE_PASSWORD'}), error => {
    assert.equal(error.message, 'Invalid cloud cost browser journey');
    assert.equal(error.browserPhase, 'reconnect'); assert.equal(error.browserStep, 'takings');
    assert.equal(error.browserFailure, wantFailure);
    assert.equal(error.browserSession, wantSession);
    assert.equal(error.browserPage, wantPage);
    for (const key of ['browserFailure', 'browserSession', 'browserPage'])
      assert.equal(Object.getOwnPropertyDescriptor(error, key).enumerable, false);
    assert.doesNotMatch(error.stack + JSON.stringify(error), /PRIVATE_|private\.example/);
    return true;
  });
  assert.equal(closed, 1, 'failure cleanup still closes the browser');
  assert.equal(privateReads, 0, 'classifying the refusal never reads a private name accessor');
});

const diagnostics = await import('./fixtures/browser-diagnostics.mjs');

for (const [key, label, allowed] of [
  ['browserFailure', 'failure', ['timeout', 'other']],
  ['browserSession', 'session', ['accepted', 'refused', 'other', 'unseen']],
  ['browserPage', 'page', ['error', 'clear']],
]) {
  for (const value of allowed) test('browserRefusalEvidenceCrossesRealChild_' + key + '_' + value, () => {
    const script = `
      import {withBrowserDiagnostics} from ${JSON.stringify(new URL('./fixtures/browser-diagnostics.mjs', import.meta.url).href)};
      const refusal = Object.assign(Error('Invalid cloud cost browser journey'), {
        browserPhase: 'reconnect', browserStep: 'takings', ${key}: '${value}', privateValue: 'PRIVATE_CHILD_CANARY'
      });
      await withBrowserDiagnostics(async () => {throw refusal;}, text => process.stderr.write(text + '\\n'));
    `;
    assert.throws(() => diagnostics.runBrowserFixture(process.execPath, ['--input-type=module', '-e', script], {}), error => {
      assert.equal(error.journeyRefused, true);
      assert.equal(error.browserPhase, 'reconnect'); assert.equal(error.browserStep, 'takings');
      assert.equal(error[key], value);
      assert.doesNotMatch(error.stack + JSON.stringify(error), /PRIVATE_CHILD_CANARY/);
      return true;
    });
  });

  test('browserRefusalEvidenceRejectsUnsafeFields_' + key, async () => {
    let reads = 0;
    const messages = [];
    for (const original of [
      Object.assign(Error('PRIVATE'), {browserPhase: 'reconnect', [key]: 'PRIVATE https://private.example'}),
      Object.assign(Error('PRIVATE'), {browserPhase: 'reconnect', [key]: allowed[0] + '\n'}),
      Object.defineProperties(Error('PRIVATE'), {browserPhase: {value: 'reconnect'},
        [key]: {get() {reads++; throw Error('PRIVATE_GETTER');}}}),
      new Proxy(Object.assign(Error('PRIVATE'), {browserPhase: 'reconnect'}), {
        getOwnPropertyDescriptor(target, property) {
          if (property === key) throw Error('PRIVATE_TRAP');
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
      }),
      Object.assign(Error('PRIVATE'), {browserPhase: 'login', [key]: allowed[0]}),
    ]) await assert.rejects(diagnostics.withBrowserDiagnostics(async () => {throw original;}, text => messages.push(text)), e => e === original);
    assert.equal(reads, 0);
    assert.deepEqual(messages, ['cost_browser_phase=reconnect', 'cost_browser_phase=reconnect',
      'cost_browser_phase=reconnect', 'cost_browser_phase=reconnect', 'cost_browser_phase=login']);
    for (const input of [
      `cost_browser_phase=reconnect\ncost_browser_${label}=PRIVATE\n`,
      `cost_browser_phase=reconnect\nprefix cost_browser_${label}=${allowed[0]}\n`,
      `cost_browser_phase=login\ncost_browser_${label}=${allowed[0]}\n`,
      `cost_browser_${label}=${allowed[0]}\n`,
      `cost_browser_phase=reconnect\ncost_browser_${label}=${allowed[0]}suffix\n`,
    ]) assert.equal(diagnostics.parseBrowserDiagnostics(input)[key], undefined);
  });
}

for (const [key, value, label] of [
  ['browserFailure', 'timeout', 'failure'], ['browserSession', 'refused', 'session'], ['browserPage', 'error', 'page'],
]) test('browserEvidenceOutputFailurePreservesOriginal_' + key, async () => {
  const original = Object.assign(Error('PRIVATE_ORIGINAL'), {browserPhase: 'reconnect', [key]: value});
  const messages = [];
  await assert.rejects(diagnostics.withBrowserDiagnostics(async () => {throw original;}, text => {
    messages.push(text);
    if (text.startsWith('cost_browser_' + label + '=')) throw Error('PRIVATE_OUTPUT');
  }), error => error === original);
  assert.deepEqual(messages, ['cost_browser_phase=reconnect', 'cost_browser_' + label + '=' + value]);
});

// Moving evidence outside its phase would mislabel an earlier journey refusal.
test('browserEvidenceStaysAbsentOutsideReconnect', async () => {
  const chromium = {async launch() {throw Error('PRIVATE_LAUNCH');}};
  await assert.rejects(measureRemoteBrowser({chromium, staffHostname: 'staff.generated.example.test',
    email: 'generated@example.test', password: 'PRIVATE_PASSWORD'}), error => {
    assert.equal(error.browserPhase, 'launch');
    for (const key of ['browserFailure', 'browserSession', 'browserPage'])
      assert.equal(Object.getOwnPropertyDescriptor(error, key), undefined);
    assert.equal(error.message, 'Invalid cloud cost browser journey');
    return true;
  });
});
