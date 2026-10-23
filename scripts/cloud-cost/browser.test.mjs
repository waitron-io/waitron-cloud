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
