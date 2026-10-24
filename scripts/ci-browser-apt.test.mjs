import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import test from 'node:test';

// A missing alternate, relaxed signature check or ignored package hash must fail this journey.
test('Linux APT escapes a stalled mirror and refuses unavailable or unverified archives', {
  skip: process.platform !== 'linux', timeout: 60000,
}, async () => {
  const {stdout} = await promisify(execFile)('python3', ['scripts/fixtures/ci-browser-apt.py'], {
    timeout: 55000, maxBuffer: 2 ** 20,
  });
  assert.deepEqual(JSON.parse(stdout), {
    fallbackDownloaded: true, exhaustedRefused: true, signatureRefused: true, packageHashRefused: true,
  });
});
