import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureRemoteBrowser } from './browser.mjs';

// Reading an option before checking its descriptor can execute a private getter and
// expose its error before the fixed public refusal is established.
for (const key of ['chromium', 'staffHostname', 'email', 'password'])
test('browserRefusesPrivateGetterBeforeReading_' + key, async () => {
  const options = { chromium: {}, staffHostname: 'generated.example.test', email: 'generated@example.test', password: 'generated' };
  let reads = 0;
  Object.defineProperty(options, key, { get() { reads++; throw Error('PRIVATE_BROWSER_CANARY'); }, enumerable: true });
  await assert.rejects(() => measureRemoteBrowser(options), { message: 'Invalid cloud cost browser journey' });
  assert.equal(reads, 0, 'untrusted accessors never run');
});

test('browserFailureNamesItsPhaseWithoutExposingThePrivateLaunchError', async () => {
  let launches = 0;
  await assert.rejects(() => measureRemoteBrowser({
    chromium: {async launch() {launches++; throw Error('PRIVATE_LAUNCH_CANARY');}},
    staffHostname: 'staff.generated.example.test', email: 'generated@example.test', password: 'generated',
  }), error => {
    assert.equal(error.message, 'Invalid cloud cost browser journey');
    assert.equal(error.browserPhase, 'launch');
    assert.equal(Object.prototype.propertyIsEnumerable.call(error, 'browserPhase'), false);
    assert.doesNotMatch(error.stack, /PRIVATE_LAUNCH_CANARY/);
    return true;
  });
  assert.equal(launches, 1);
});

// Losing a reconnect marker would hide which unchanged browser operation refused.
for (const step of ['reload', 'takings', 'overdue-empty', 'requests', 'logout'])
test('browserReconnectFailureIdentifies_' + step, async t => {
  const events = new Map();
  let reconnect = false, browserCloses = 0, contextCloses = 0;
  const refuse = () => { throw Error('PRIVATE_RECONNECT_CANARY https://private.example/token'); };
  const locator = selector => ({
    locator: child => locator(child), first() { return this; }, or() { return this; },
    async fill() {}, async click() { if (step === 'logout' && selector.includes('logout')) refuse(); }, async isVisible() { return false; },
    async waitFor() {
      if (reconnect && (step === 'takings' && selector.includes('takings')
        || step === 'overdue-empty' && selector.includes('overdue-empty'))) refuse();
    },
  });
  const page = {
    locator, on() {}, setDefaultTimeout() {}, async goto() {},
    async reload() {
      reconnect = true;
      if (step === 'reload') refuse();
      if (step === 'requests') {
        // Keep a real drain input outstanding; only its clock is advanced.
        events.get('request')({url: () => 'https://staff.generated.example.test/manage/', resourceType: () => 'document'});
        let now = 0;
        t.mock.method(Date, 'now', () => now += 4000);
      }
    },
  };
  const context = {
    on: (name, listener) => events.set(name, listener), async newPage() { return page; },
    async newCDPSession() { return {async send() {}, on() {}}; },
    async close() { contextCloses++; },
  };
  const chromium = {async launch() { return {async newContext() { return context; }, async close() {browserCloses++;}}; }};
  await assert.rejects(() => measureRemoteBrowser({chromium,
    staffHostname: 'staff.generated.example.test', email: 'generated@example.test', password: 'generated'}), error => {
    assert.equal(error.browserPhase, step === 'logout' ? 'logout' : 'reconnect');
    assert.equal(error.browserStep, step === 'logout' ? undefined : step);
    assert.equal(Object.prototype.propertyIsEnumerable.call(error, 'browserStep'), false);
    assert.equal(error.message, 'Invalid cloud cost browser journey');
    assert.doesNotMatch(error.stack, /PRIVATE_RECONNECT_CANARY|private\.example/);
    return true;
  });
  assert.equal(browserCloses, 1, 'the failing journey still closes its browser');
  assert.equal(contextCloses, 0, 'the successful close phase was never reached');
});
