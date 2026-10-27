import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import test from 'node:test';

function expectedIndexRequests(targets) {
  const suites = ['noble', 'noble-updates', 'noble-backports', 'noble-security'];
  const components = ['main', 'universe', 'restricted', 'multiverse'];
  return suites.flatMap(suite => components.flatMap(component => targets.map(target =>
    `/second/dists/${suite}/${component}/${target}`))).sort();
}

// The alternative must supply every signed index before the package can be downloaded.
test('Linux APT completes four signed suites and sixteen indexes through the available mirror', {
  skip: process.platform !== 'linux', timeout: 60000,
}, async () => {
  const {stdout} = await promisify(execFile)('python3', ['scripts/fixtures/ci-browser-apt.py', '--multi-component'], {
    timeout: 55000, maxBuffer: 2 ** 20,
  });
  assert.deepEqual(JSON.parse(stdout), {
    indexRequests: expectedIndexRequests(['binary-amd64/Packages']), fallbackDownloaded: true,
  });
});

// A fallback that fetches release metadata alone cannot satisfy the compressed index checks.
test('Linux APT keeps compressed package, translation and command indexes on stable paths', {
  skip: process.platform !== 'linux', timeout: 60000,
}, async () => {
  const {stdout} = await promisify(execFile)('python3', ['scripts/fixtures/ci-browser-apt.py', '--runner-indexes'], {
    timeout: 55000, maxBuffer: 2 ** 20,
  });
  assert.deepEqual(JSON.parse(stdout), {
    indexRequests: expectedIndexRequests(['binary-amd64/Packages.xz', 'i18n/Translation-en.xz', 'cnf/Commands-amd64.xz']),
    fallbackDownloaded: true,
  });
});

// Changing the acquisition path must retain validation against the signed index digest.
test('Linux APT refuses altered compressed index bytes after signed release fallback', {
  skip: process.platform !== 'linux', timeout: 60000,
}, async () => {
  const {stdout} = await promisify(execFile)('python3', ['scripts/fixtures/ci-browser-apt.py', '--index-hash'], {
    timeout: 55000, maxBuffer: 2 ** 20,
  });
  assert.deepEqual(JSON.parse(stdout), {indexHashRefused: true});
});
