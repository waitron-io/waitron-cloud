import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

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

test('outside services run one restarting copy per cell machine with a scoped inspector', () => {
  const {kind, spec} = deployment.servicesDaemonSet('owned:cloud', ['node-a', 'node-b', 'node-c'], 'fixture-cell');
  assert.equal(kind, 'DaemonSet');
  assert.deepEqual(spec.selector.matchLabels, spec.template.metadata.labels);
  const pod = spec.template.spec;
  assert.equal(pod.nodeName, undefined);
  assert.equal(pod.restartPolicy, 'Always');
  assert.deepEqual(pod.affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms,
    ['node-a', 'node-b', 'node-c'].map(name => ({
      matchFields: [{key: 'metadata.name', operator: 'In', values: [name]}],
    })));
  const {env, envFrom} = pod.containers.find(container => container.name === 'inspect');
  assert.equal(env.find(row => row.name === 'CLOUD_STOCKHOLM_REMOTE_CELL').value, 'fixture-cell');
  assert.deepEqual(envFrom, [{secretRef: {name: 'services-backup'}}]);
});

test('outside workers use the shared inbox and authenticate with their node name', () => {
  const {spec: {template: {spec}}} = deployment.servicesDaemonSet('owned:cloud', ['node-a', 'node-b', 'node-c'], 'fixture-cell');
  const {env} = spec.containers.find(row => row.name === 'email');
  assert.equal(env.find(row => row.name === 'CLOUD_SMTP_HOST').value, '10.77.0.4');
  assert.equal(env.find(row => row.name === 'CLOUD_SMTP_PORT').value, '1025');
  assert.deepEqual(env.find(row => row.name === 'CLOUD_SMTP_USER').valueFrom, {fieldRef: {fieldPath: 'spec.nodeName'}});
  assert.equal(spec.containers.some(row => row.name === 'mailpit'), false);
  assert.equal(spec.volumes.some(row => row.name === 'mail'), false);
});

test('the Amazon image manifest prepares the Mailpit image used by outside services', async () => {
  const manifest = JSON.parse(await readFile(new URL('./local-checks.yaml', import.meta.url), 'utf8'));
  assert.ok(manifest.items.some(row => row.spec?.containers?.some(
    container => container.name === 'mailpit' && container.image === deployment.mailpitImage)));
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
    containers: [{name: 'docker', args: ['--host=unix:///docker-socket/docker.sock'], volumeMounts: []},
      {name: 'verifier', securityContext: {capabilities: {drop: ['ALL']}},
      env: [{name: 'DOCKER_HOST', value: 'unix:///docker-socket/docker.sock'}],
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
  assert.equal(worker.securityContext.runAsUser, 1000);
  assert.equal(worker.securityContext.runAsGroup, 1000);
  assert.deepEqual(worker.securityContext.capabilities, {drop: ['ALL']});
  assert.equal(pod.spec.securityContext.fsGroup, 1000);
  assert.ok(pod.spec.containers.find(row => row.name === 'docker').args.includes('--group=1000'));
});

test('snapshot inspection uses worker storage credentials without account signing keys', () => {
  const {spec} = deployment.servicesInspection('owned:cloud').spec.template;
  const [inspect] = spec.containers;
  assert.equal(inspect.name, 'inspect');
  assert.deepEqual(inspect.envFrom, [{secretRef: {name: 'services-backup'}}]);
  assert.deepEqual(spec.volumes.map(volume => volume.name), ['db-ca', 'store-ca']);
});

test('remote inspection stays on the account machine during a worker-machine stop', () => {
  const {spec} = deployment.servicesInspection('owned:cloud', 'fixture-cell', 'account-node').spec.template;
  assert.equal(spec.nodeName, 'account-node');
});
