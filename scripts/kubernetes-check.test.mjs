import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bootstrap} from '../deploy/local-stack/bootstrap.mjs';
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
