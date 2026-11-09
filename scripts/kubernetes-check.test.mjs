import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bootstrap} from '../deploy/local-stack/bootstrap.mjs';
import {runTestCloudClients} from './test-cloud-integration.mjs';
import {testRuntimeEnvironment} from '../deploy/test-cloud/runtime.mjs';

test('Kubernetes account selects its proxy while other roles discard that input and secrets', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'cloud-kube-runtime-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const config = await bootstrap(directory);
  const input = {CLOUD_TEST_SERVICE_PLANS: '1', CLOUD_HTTP_TRUSTED_PROXY_IPS: '10.244.0.12', NODE_AUTH_TOKEN: 'synthetic-not-forwarded'};
  const account = testRuntimeEnvironment('account', config, input);
  assert.equal(account.CLOUD_HTTP_TRUSTED_PROXY_IPS, '10.244.0.12');
  assert.equal(account.NODE_AUTH_TOKEN, undefined);
  assert.equal(testRuntimeEnvironment('account', config, {}).CLOUD_HTTP_TRUSTED_PROXY_IPS, '10.79.0.2');
  for (const role of ['email', 'monitor', 'usage', 'probe', 'backup', 'gateway', 'manifest', 'reconcile', 'translation']) {
    const environment = testRuntimeEnvironment(role, config, input);
    assert.equal(environment.CLOUD_HTTP_TRUSTED_PROXY_IPS, undefined, role);
    assert.equal(environment.NODE_AUTH_TOKEN, undefined, role);
  }
});

test('client build reports a missing builder without disclosing private Docker output', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'cloud-kube-build-'));
  const before = process.env.PATH;
  t.after(async () => {process.env.PATH = before; await rm(directory, {recursive: true, force: true});});
  const image = 'sha256:' + 'b'.repeat(64);
  await writeFile(join(directory, 'docker'), `#!${process.execPath}
const a=process.argv.slice(2);
if(a[0]==='image'&&a[1]==='inspect')console.log(JSON.stringify([{Id:${JSON.stringify(image)},RepoTags:['d620-pinned:local'],Config:{Labels:{'cloud.waitron-revision':'ec91a9e34d2daba146f4ee61850ea4136ad5cfb7'}}}]));
if(a[0]==='build'){process.stderr.write('DEPRECATED: The legacy builder is deprecated. Install the buildx component. PRIVATE_BUILD_CANARY');process.exit(17);}
`, {mode: 0o700});
  process.env.PATH = directory + ':' + before;
  await assert.rejects(runTestCloudClients({image: 'sha256:' + 'a'.repeat(64), waitronImage: image}), error => {
    assert.equal(error.message, 'integration.command_failed:client-build:integration.client_build_legacy_builder');
    assert.equal(String(error.stack).includes('PRIVATE_BUILD_CANARY'), false);
    return true;
  });
});
