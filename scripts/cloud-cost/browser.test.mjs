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
