import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import test from 'node:test';

// Returning to the stalled mirror for every index must exhaust this install's bound.
test('Linux APT completes four signed suites and sixteen indexes through the available mirror', {
  skip: process.platform !== 'linux', timeout: 60000,
}, async () => {
  const {stdout} = await promisify(execFile)('python3', ['scripts/fixtures/ci-browser-apt.py', '--multi-component'], {
    timeout: 55000, maxBuffer: 2 ** 20,
  });
  assert.deepEqual(JSON.parse(stdout), {allSixteenIndexesFetched: true, fallbackDownloaded: true});
});

// A fallback that fetches release metadata alone cannot satisfy the compressed index checks.
test('Linux APT completes compressed package, translation and command indexes by their signed hashes', {
  skip: process.platform !== 'linux', timeout: 60000,
}, async () => {
  const {stdout} = await promisify(execFile)('python3', ['scripts/fixtures/ci-browser-apt.py', '--runner-indexes'], {
    timeout: 55000, maxBuffer: 2 ** 20,
  });
  assert.deepEqual(JSON.parse(stdout), {
    allSixteenIndexesFetched: true, allFortyEightIndexesFetched: true, fallbackDownloaded: true,
  });
});
