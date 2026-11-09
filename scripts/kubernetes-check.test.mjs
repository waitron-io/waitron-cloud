import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
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

// Without the target binding guard, an incomplete Kubernetes target can silently run Compose.
test('Kubernetes journey refuses an incomplete target before building or creating Compose services', async () => {
  await assert.rejects(runTestCloudClients({image: 'sha256:' + 'a'.repeat(64), waitronImage: 'sha256:' + 'b'.repeat(64),
    kubernetes: {namespace: 'default'}}), /integration.kubernetes_binding/);
});

// This exercises the actual native clients and every retained refusal against Kubernetes.
test('one-node Kubernetes services sign in, pair, carry remote traffic and withdraw it', {
  skip: process.env.TEST_KUBERNETES_CHECK !== '1', timeout: 900000,
}, () => {
  const run = spawnSync(process.execPath, ['scripts/kubernetes-check.mjs'], {encoding: 'utf8', timeout: 840000});
  assert.equal(run.status, 0, run.stderr);
  const reply = JSON.parse(run.stdout);
  assert.match(reply.kubernetes.cluster, /^d620-/);
  assert.equal(reply.accountMail.free, 'proved'); assert.equal(reply.accountMail.paid, 'proved');
  assert.equal(reply.clients.demoVenues, 2); assert.equal(reply.clients.restartIdentity, 'proved');
  assert.deepEqual(reply.freeRemote.submit, {status: 403, error: 'permission_denied'});
  assert.deepEqual(reply.freeRemote.invalidProof, {status: 401, error: 'invalid_proof'});
  assert.equal(reply.paidRemote.routes.staffAvailability, 200);
  assert.equal(reply.paidRemote.routes.publicAfterChallenge, 200);
  assert.equal(reply.paidRemote.withdrawal.peerRemoved, true);
  assert.deepEqual(reply.cleanup.remaining, []);
  assert.equal(reply.kubernetes.removed, true);
});

test('PR1 refuses authorised recovery rather than reaching a Compose-only verifier', async () => {
  await assert.rejects(runTestCloudClients({image: 'sha256:' + 'a'.repeat(64), waitronImage: 'sha256:' + 'b'.repeat(64),
    paidAuthorisedRecovery: true, kubernetes: {cluster: 'd620-abc', namespace: 'default', account: 'kube-account',
      ca: 'not-consumed', network: 'kind', proxyIp: '172.18.0.2', port: 3000, mailPort: 8025,
      exec: () => assert.fail('must not reach cluster'), remote: {worker: () => assert.fail('must not reach worker')}}}),
  /integration.kubernetes_scope/);
});
