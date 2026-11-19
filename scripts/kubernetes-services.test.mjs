import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import test from 'node:test';
import {runKubernetesCheck} from './kubernetes-check.mjs';

import {installServicesDatabase, servicesCredentialFiles, servicesStorageSettings} from './kubernetes-services.mjs';

test('the migration job follows all three prepared PostgreSQL copies and gates the service startup', async () => {
  const nodes = [1, 2, 3].map(number => ({name: 'node-' + number, id: 'id-' + number}));
  const prepared = [], stages = [];
  await installServicesDatabase({
    nodes,
    run: async (binary, args, options) => {
      assert.equal(binary, 'docker');
      assert.equal(args.at(-1), 'database-storage');
      assert.match(options.input, /\/var\/local\/d621-postgres/);
      prepared.push(args[2]);
    },
    kube: async (args, options) => {
      stages.push(args[2]);
      if (args[2] === 'create') {
        const job = JSON.parse(options.input);
        assert.equal(job.metadata.namespace, 'd621-data');
        assert.equal(job.metadata.name, 'migrate');
        assert.match(job.spec.template.spec.containers[0].command[2], /sslmode=verify-full.*\n.*migrate-cli\.ts/);
      } else assert.deepEqual(args.slice(3, 5), ['--for=condition=Complete', 'job/migrate']);
    },
    installDatabase: async ({nodes}) => {
      assert.deepEqual(nodes, ['node-1', 'node-2', 'node-3']);
      assert.deepEqual(prepared, ['id-1', 'id-2', 'id-3']);
      stages.push('database-ready');
    },
  }, 'owned:cloud');
  assert.deepEqual(stages, ['database-ready', 'create', 'wait']);
});

test('an owned Linux Kind cell signs in and admits a genuine restored backup', {
  skip: process.env.TEST_KUBERNETES_SERVICES !== '1', timeout: 35 * 60 * 1000,
}, async () => {
  assert.equal(process.platform, 'linux');
  const {services} = await runKubernetesCheck('kind-services');
  assert.equal(services.signup, true);
  assert.equal(services.signIn, true);
  assert.equal(services.emailActionProof, true);
  assert.equal(services.pairing.persistedRenewal, true);
  assert.equal(services.inboxRequiresAuthentication, true);
  assert.equal(services.smtpRefusals, true);
  assert.equal(services.backup.independentStoredDigest, true);
  assert.equal(services.backup.workerVerification.sha256, services.backup.sha256);
  assert.equal(services.backup.workerVerification.status, 'passed');
  assert.equal(services.backup.workerVerification.childAbsent, true);
  assert.equal(services.backup.workerVerification.workerStoppedNaturally, true);
  assert.ok(Number.isSafeInteger(services.backup.bytes) && services.backup.bytes > 0);
  assert.equal(services.verifierScratchBytes, 1024 ** 3);
  console.log(`D621 verifier scratch: ${services.backup.bytes} archive bytes, ${services.verifierScratchBytes} bytes allocated`);
  assert.equal(services.alteredPublicationRefused, true);
  assert.equal(services.operationsReady, true);
  assert.deepEqual(services.cleanup.remaining, []);
});

test('rehearsal credential files contain complete password and digest lines', () => {
  const files = servicesCredentialFiles('synthetic-smtp', 'synthetic-inbox');
  assert.equal(files.mail['smtp-auth'], 'sender:synthetic-smtp\n');
  assert.equal(files.mail['ui-auth'], 'inbox:synthetic-inbox\n');
  assert.match(files.corpus, /^[a-f0-9]{64}\n$/);
});

test('only the account role receives the proof signing key and write credentials', () => {
  const {privateKey} = generateKeyPairSync('ed25519');
  const custody = {signingKey: privateKey.export({type: 'pkcs8', format: 'pem'}), masterKey: 'a'.repeat(64)};
  const credentials = {role: 'arn:minio:iam:::role/rehearsal',
    accountCredentials: {accessKeyId: 'account-access', secretAccessKey: 'account-secret'},
    workerCredentials: {accessKeyId: 'worker-access', secretAccessKey: 'worker-secret'}};
  const values = servicesStorageSettings(custody, credentials, 'https://172.30.250.2:30900');
  assert.equal(values['services-account'].CLOUD_BACKUP_ACCESS_KEY, 'account-access');
  assert.equal(values['services-backup'].CLOUD_BACKUP_ACCESS_KEY, 'worker-access');
  assert.equal(values['services-account'].CLOUD_BACKUP_SECRET_KEY, 'account-secret');
  assert.equal(values['services-backup'].CLOUD_BACKUP_SECRET_KEY, 'worker-secret');
  assert.ok(values['services-account'].CLOUD_BACKUP_AUTHORITY);
  assert.equal(values['services-backup'].CLOUD_BACKUP_AUTHORITY, undefined);
});
