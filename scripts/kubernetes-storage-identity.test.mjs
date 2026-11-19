import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import test from 'node:test';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {configurePolicy, reportGrantTiming} from './kubernetes-storage-identity.mjs';
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

test('the grant timing report says when no surviving store logged a phase', async ({mock}) => {
  const nodes = ['first', 'second', 'third'].map(name => ({name}));
  const output = mock.method(process.stderr, 'write', () => true);
  await reportGrantTiming({nodes, kube: async () => '2026-11-19T05:00:01Z unrelated store record'},
    'first', '2026-11-19T05:00:00Z');
  assert.deepEqual(output.mock.calls.map(call => call.arguments[0]),
    ['No grant timing markers found on surviving store peers\n']);
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
  assert.match(stderr, /WAITRON grant validation-end elapsed=/);
  assert.match(stderr, /WAITRON grant save-start elapsed=/);
  assert.match(stderr, /WAITRON grant peer-reload-start elapsed=/);
  assert.match(stderr, /WAITRON grant peer-reload-end elapsed=/);
  assert.match(stderr, /WAITRON grant response-ready elapsed=/);
  console.log(JSON.stringify(storage));
});

test('Cloud account and backup worker each get their own credentials for fixture objects', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'services-policy-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const policies = new Map(), users = new Map(), attached = [];
  const run = async (binary, args, options) => {
    if (binary === 'curl') return writeFile(args[args.indexOf('-o') + 1], '');
    if (binary === 'sha256sum') return '';
    if (binary === 'sh') {
      const password = options.input.trim();
      assert.equal(args.some(arg => arg.includes(password)), false);
      users.set(args.at(-1), password);
      return '';
    }
    const [domain, command, action, , name, argument] = args.slice(3);
    if (domain === 'idp') return JSON.stringify({info: [{key: 'roleARN', value: 'arn:minio:iam:::role/rehearsal'}]});
    assert.deepEqual([domain, command], ['admin', 'policy']);
    if (action === 'create') {
      policies.set(name, JSON.parse(await readFile(argument)));
    } else {
      assert.equal(action, 'attach');
      assert.equal(argument, '--user');
      attached.push([name, args.at(-1)]);
    }
    return '';
  };
  const {accountCredentials, workerCredentials} = await configurePolicy({directory, run}, 'https://172.30.250.2:30900',
    {ca: 'public fixture certificate', credentials: {accessKeyId: 'test-admin', secretAccessKey: 'synthetic-unused'}}, true);
  assert.deepEqual(attached, [['services-account', 'services-account'], ['services-worker', 'services-worker']]);
  assert.equal(accountCredentials.accessKeyId, 'services-account');
  assert.equal(workerCredentials.accessKeyId, 'services-worker');
  assert.ok(accountCredentials.secretAccessKey === users.get('services-account'));
  assert.ok(workerCredentials.secretAccessKey === users.get('services-worker'));
  assert.ok(accountCredentials.secretAccessKey !== workerCredentials.secretAccessKey);
  const resources = ['arn:aws:s3:::cloud-storage-rehearsal/incoming/*', 'arn:aws:s3:::cloud-storage-rehearsal/snapshots/*'];
  assert.deepEqual(policies.get('services-account').Statement,
    [{Effect: 'Allow', Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'], Resource: resources}]);
  assert.deepEqual(policies.get('services-worker').Statement,
    [{Effect: 'Allow', Action: ['s3:GetObject', 's3:DeleteObject'], Resource: resources}]);
});
