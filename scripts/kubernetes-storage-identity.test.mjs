import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import test from 'node:test';
import {promisify} from 'node:util';
import {withStockholmStore} from './kubernetes-storage-proof.mjs';

test('only the storage identity rehearsal builds a store with grant timing', async () => {
  for (const openId of [undefined, {configUrl: 'https://issuer.example.test/discovery'}]) {
    let buildArgs;
    const noDocker = Error('end before starting Docker');
    const run = async (binary, args) => {
      if (binary === 'docker' && args[0] === 'buildx') {
        buildArgs = args;
        throw noDocker;
      }
      assert.deepEqual([binary, ...args], ['docker', 'image', 'inspect', 'test:store']);
      return '';
    };
    await assert.rejects(withStockholmStore({cluster: 'test', run, kube: async () => ''},
      () => assert.fail('store setup continued after build failure'), openId), error => error === noDocker);
    assert.equal(buildArgs.includes('WAITRON_GRANT_TIMING=1'), Boolean(openId));
  }
});

test('a real grant renews during a Kind machine outage and reads after rejoin', {
  skip: process.env.TEST_KUBERNETES_STORAGE_IDENTITY !== '1', timeout: 2_700_000,
}, async () => {
  const child = promisify(execFile)(process.execPath, ['scripts/kubernetes-check.mjs', '--storage-identity'],
    {timeout: 2_600_000, maxBuffer: 2 * 1024 * 1024});
  child.child.stderr.pipe(process.stderr);
  const {stdout, stderr} = await child;
  const {storage, nodes} = JSON.parse(stdout);
  assert.ok(nodes.some(node => node.name === storage.stopped));
  assert.ok(nodes.some(node => node.name === storage.issuerSurvivor));
  assert.notEqual(storage.issuerSurvivor, storage.stopped);
  assert.ok(storage.failoverMs <= 90_000);
  assert.equal(storage.expiredGrantRefused, true);
  assert.equal(storage.renewedGrantReadAfterRejoin, true);
  assert.match(stderr, /WAITRON grant validation-start elapsed=/);
  assert.match(stderr, /WAITRON grant save-start elapsed=/);
  assert.match(stderr, /WAITRON grant peer-reload-start elapsed=/);
  assert.match(stderr, /WAITRON grant response-ready elapsed=/);
  console.log(JSON.stringify(storage));
});
