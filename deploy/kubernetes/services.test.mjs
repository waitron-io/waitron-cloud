import assert from 'node:assert/strict';
import test from 'node:test';

import * as deployment from './services.mjs';

test('Cloud roles start through the TLS schema gate with production service plans', () => {
  const {metadata, spec} = deployment.servicesPod('owned:cloud', 'owned-control-plane');
  assert.equal(metadata.namespace, 'd621-data');
  assert.equal(spec.nodeName, 'owned-control-plane');
  assert.equal(spec.automountServiceAccountToken, false);
  const commands = {
    account: 'packages/account-http/src/server-cli.ts',
    email: 'packages/registration/src/email-worker-cli.ts',
    monitor: 'packages/registration/src/monitor-cli.ts',
    usage: 'packages/registration/src/usage-reconcile-cli.ts',
    probe: 'packages/remote-access/src/probe-cli.ts',
  };
  for (const [name, entry] of Object.entries(commands)) {
    const service = spec.containers.find(container => container.name === name);
    assert.equal(service.image, 'owned:cloud');
    assert.equal(service.env.find(row => row.name === 'PGURI').valueFrom.secretKeyRef.name, 'cloud-db-app');
    assert.match(service.command[2], /sslmode=verify-full&sslrootcert=\/run\/db-ca\/ca.crt/);
    assert.match(service.command[2], /schema-consumer\.mjs/);
    assert.ok(service.command[2].includes(entry));
    for (const [key, value] of Object.entries({NODE_ENV: 'production', CLOUD_TEST_SERVICE_PLANS: '0',
      CLOUD_VENUE_SERVICE_LEVELS: '0', CLOUD_REQUIRE_ENROLLMENT: 'false'})) {
      assert.equal(service.env.find(row => row.name === key).value, value);
    }
  }
  assert.equal(spec.volumes.find(volume => volume.name === 'db-ca').secret.secretName, 'cloud-db-ca');
  assert.deepEqual(spec.containers.find(row => row.name === 'proxy').ports, [{containerPort: 3443, hostPort: 3000}]);
});

test('Mailpit accepts only authenticated TLS mail to synthetic addresses', () => {
  const {spec} = deployment.servicesPod('owned:cloud', 'owned-control-plane');
  const mail = spec.containers.find(row => row.name === 'mailpit');
  assert.ok(mail.args.includes('--smtp-require-tls'));
  assert.equal(mail.args[mail.args.indexOf('--smtp') + 1], '127.0.0.1:1025');
  assert.equal(mail.args[mail.args.indexOf('--listen') + 1], '127.0.0.1:8025');
  assert.ok(mail.args.includes('--smtp-auth-file'));
  assert.ok(mail.args.includes('--ui-auth-file'));
  const allowed = new RegExp(mail.args[mail.args.indexOf('--smtp-allowed-recipients') + 1]);
  assert.equal(allowed.test('someone@example.test'), true);
  assert.equal(allowed.test('someone@example.test.com'), false);
  assert.deepEqual(mail.args.filter(arg => /relay|forward|auth-accept-any/.test(arg)), []);
});

test('the backup worker waits for its exact release image before using its private daemon', () => {
  const revision = 'bd0f485bfc4dd951e69e417d98fbbde194879424';
  const pod = deployment.servicesVerifier({metadata: {name: 'verifier'}, spec: {
    hostAliases: [{ip: 'unused'}], volumes: [{name: 'config', hostPath: {path: '/host'}}, {name: 'socket', emptyDir: {}}],
    containers: [{name: 'docker', volumeMounts: []}, {name: 'verifier', env: [{name: 'DOCKER_HOST', value: 'unix:///docker-socket/docker.sock'}],
      volumeMounts: [{name: 'config', mountPath: '/run/local-stack'}, {name: 'socket', mountPath: '/docker-socket'}]}],
  }}, 'owned:cloud', revision, 'owned-control-plane');
  const worker = pod.spec.containers.find(row => row.name === 'verifier');
  assert.equal(pod.metadata.namespace, 'd621-data');
  assert.equal(pod.spec.nodeName, 'owned-control-plane');
  assert.equal(pod.spec.hostAliases, undefined);
  assert.deepEqual(pod.spec.volumes.filter(row => row.hostPath), [{
    name: 'verifier-scratch', hostPath: {path: '/var/local/d621-verifier-scratch', type: 'Directory'},
  }]);
  assert.match(worker.command[2], /until \[ -f \/run\/backup-verifier\/image-loaded \]/);
  assert.match(worker.command[2], /schema-consumer\.mjs packages\/backups\/src\/worker-cli\.ts/);
  const env = Object.fromEntries(worker.env.map(row => [row.name, row.value]));
  assert.equal(env.LOCAL_STACK_CONFIG_DIR, '/run/backup-verifier');
  assert.equal(env.CLOUD_VERIFIER_OWNER, 'waitron-cloud-test-backup');
  assert.equal(env.CLOUD_VERIFIER_WAITRON_REVISION, revision);
  assert.equal(env.CLOUD_VERIFIER_SCRATCH_VOLUME, 'd621-verifier-scratch');
  for (const container of pod.spec.containers) {
    assert.deepEqual(container.volumeMounts.find(row => row.name === 'verifier-scratch'),
      {name: 'verifier-scratch', mountPath: '/var/local/d621-verifier-scratch'});
  }
  assert.equal(env.DOCKER_HOST, 'unix:///docker-socket/docker.sock');
  assert.deepEqual(worker.envFrom, [{secretRef: {name: 'services-backup'}}]);
});

test('snapshot inspection uses worker storage credentials without account signing keys', () => {
  const {spec} = deployment.servicesInspection('owned:cloud').spec.template;
  const [inspect] = spec.containers;
  assert.equal(inspect.name, 'inspect');
  assert.deepEqual(inspect.envFrom, [{secretRef: {name: 'services-backup'}}]);
  assert.deepEqual(spec.volumes.map(volume => volume.name), ['db-ca', 'store-ca']);
});
