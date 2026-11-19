import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import test from 'node:test';
import {promisify} from 'node:util';

test('a real grant renews during a Kind machine outage and reads after rejoin', {
  skip: process.env.TEST_KUBERNETES_STORAGE_IDENTITY !== '1', timeout: 2_700_000,
}, async () => {
  const child = promisify(execFile)(process.execPath, ['scripts/kubernetes-check.mjs', '--storage-identity'],
    {timeout: 2_600_000, maxBuffer: 2 * 1024 * 1024});
  child.child.stderr.pipe(process.stderr);
  const {stdout} = await child;
  const {storage, nodes} = JSON.parse(stdout);
  assert.ok(nodes.some(node => node.name === storage.stopped));
  assert.ok(nodes.some(node => node.name === storage.issuerSurvivor));
  assert.notEqual(storage.issuerSurvivor, storage.stopped);
  assert.ok(storage.failoverMs <= 90_000);
  assert.equal(storage.expiredGrantRefused, true);
  assert.equal(storage.renewedGrantReadAfterRejoin, true);
  console.log(JSON.stringify(storage));
});
