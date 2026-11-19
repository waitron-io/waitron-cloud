import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {bootstrap} from '../deploy/local-stack/bootstrap.mjs';
import {runtimeEnvironment} from '../deploy/local-stack/runtime.mjs';
import {storageRuntime} from '../deploy/kubernetes/storage-identity.mjs';
import {servicesInspection, servicesNamespace, servicesOrigin, servicesPod, servicesVerifier, storeCaPath,
  verifierScratchPath, verifierScratchVolume} from '../deploy/kubernetes/services.mjs';
import {installStockholmDatabase} from './kubernetes-data.mjs';
import {cleanUp, migrationJob, requireTls} from './kubernetes-database.mjs';
import {configurePolicy, withStockholmStorageIdentity} from './kubernetes-storage-identity.mjs';
import {storageBucket, storageClient} from './kubernetes-storage-proof.mjs';
import {storeNodePort} from './kubernetes-storage.mjs';
import {createKubernetesVerifier, forwardKubernetesPod, loadVerifierImage} from './kubernetes-check.mjs';
import {parseIntegrationJson, runTestCloudClients} from './test-cloud-integration.mjs';

const require = createRequire(new URL('../packages/backups/package.json', import.meta.url));
const {CreateBucketCommand} = require('@aws-sdk/client-s3');
const asset = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const timeout = 185_000;
const resource = (kind, name, body) => ({
  apiVersion: kind === 'Job' ? 'batch/v1' : 'v1', kind, metadata: {name, namespace: servicesNamespace}, ...body,
});
const randomPassword = () => randomBytes(24).toString('base64url');

export async function installServicesDatabase(context, image) {
  const {nodes, run, kube, installDatabase = installStockholmDatabase} = context;
  const input = await asset('deploy/kubernetes/bounded-amazon/bootstrap.sh');
  for (const node of nodes) {
    await run('docker', ['exec', '-i', node.id, 'bash', '-s', '--', 'database-storage'], {input});
  }
  await installDatabase({...context, nodes: nodes.map(({name}) => name)});
  await kube(['-n', servicesNamespace, 'create', '-f', '-'], {
    input: JSON.stringify(resource('Job', 'migrate', {spec: migrationJob(image)})),
  });
  await kube(['-n', servicesNamespace, 'wait', '--for=condition=Complete', 'job/migrate', '--timeout=130s'], {timeout: 135_000});
}

async function certificates({directory, run}) {
  const ca = join(directory, 'services-ca.crt'), caKey = join(directory, 'services-ca.key');
  const certificate = join(directory, 'services.crt'), key = join(directory, 'services.key');
  const csr = join(directory, 'services.csr');
  const subjectAltName = 'subjectAltName=DNS:' + new URL(servicesOrigin).hostname + ',IP:127.0.0.1';
  const openssl = args => run('openssl', args, {timeout: 30_000});
  await openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-keyout', caKey, '-out', ca, '-subj', '/CN=Waitron rehearsal CA', '-addext', 'basicConstraints=critical,CA:TRUE']);
  await openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', csr,
    '-subj', '/CN=cloud.example.test', '-addext', subjectAltName]);
  await openssl(['x509', '-req', '-in', csr, '-out', certificate, '-days', '1', '-CA', ca, '-CAkey', caKey,
    '-CAcreateserial', '-copy_extensions', 'copy']);
  const [root, cert, privateKey] = await Promise.all([ca, certificate, key].map(path => readFile(path, 'utf8')));
  return {root, cert, key: privateKey, caKey: await readFile(caKey, 'utf8')};
}

const smtpRefusals = `
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {createTransport} = createRequire(new URL('./packages/registration/package.json', import.meta.url))('nodemailer');
const send = async (to, pass) => {
  const transport = createTransport({host:'127.0.0.1',port:1025,secure:true,forceAuth:true,
    auth:{user:process.env.CLOUD_SMTP_USER,pass},connectionTimeout:3000,greetingTimeout:3000,socketTimeout:3000});
  try {await transport.sendMail({from:'cloud@example.test',to,subject:'Synthetic rehearsal',text:'Synthetic rehearsal'});}
  finally {transport.close();}
};
await assert.rejects(send('control@example.test', 'wrong-password'), {code:'EAUTH'});
await assert.rejects(send('control@example.invalid', process.env.CLOUD_SMTP_PASSWORD), {code:'EENVELOPE'});
`;

export function servicesCredentialFiles(smtpPassword, inboxPassword) {
  return {
    mail: {'smtp-auth': 'sender:' + smtpPassword + '\n', 'ui-auth': 'inbox:' + inboxPassword + '\n'},
    corpus: createHash('sha256').update('Synthetic compromised D621 password').digest('hex') + '\n',
  };
}

export function servicesStorageSettings(custody, {role, accountCredentials, workerCredentials}, endpoint) {
  const account = storageRuntime(custody, role, endpoint, 'us-east-1', storeCaPath, accountCredentials);
  const {CLOUD_BACKUP_AUTHORITY, ...backup} = account;
  return {'services-account': account, 'services-backup': {...backup,
    CLOUD_BACKUP_ACCESS_KEY: workerCredentials.accessKeyId,
    CLOUD_BACKUP_SECRET_KEY: workerCredentials.secretAccessKey,
  }};
}

async function configureServices(context, kube, store, custody) {
  const node = context.nodes[0], endpoint = 'https://' + node.ip + ':' + storeNodePort;
  const s3 = storageClient(node, store);
  try {await s3.send(CreateBucketCommand, {}, context.signal);}
  finally {s3.close();}
  const roles = await configurePolicy(context, endpoint, store, true);
  const storage = servicesStorageSettings(custody, roles, endpoint);
  const runtimeDirectory = join(context.directory, 'services-runtime');
  const config = await bootstrap(runtimeDirectory);
  const emailVariables = {CLOUD_EMAIL_ACTIVE_KEY_ID: config.email.activeKeyId, CLOUD_EMAIL_KEYS: JSON.stringify(config.email.keys)};
  const {
    CLOUD_HTTP_RATE_KEY, CLOUD_INSTALLATION_ISSUER_KEY, CLOUD_PAIRING_ACTIVE_KEY_ID, CLOUD_PAIRING_KEYS, CLOUD_PORTAL_ASSETS_DIR,
    CLOUD_FACTOR_ACTIVE_KEY_ID, CLOUD_FACTOR_KEYS,
  } = runtimeEnvironment('account', config, {}, servicesOrigin);
  const smtpPassword = randomPassword(), inboxPassword = randomPassword(), tls = await certificates(context);
  const create = value => kube(['create', '-f', '-'], JSON.stringify(value));
  const secret = async (name, stringData) => {
    try {await create(resource('Secret', name, {stringData}));}
    catch {throw Error('services.secret_create:' + name);}
  };
  const limit = {limit: 10, windowSeconds: 300};
  const CLOUD_FACTOR_POLICY = JSON.stringify({loginLifetimeMs: 300000, pendingLifetimeMs: 300000,
    challengeAttempts: 5, enrolmentAttempts: 5, loginAccount: limit, completeIp: limit, completeAccount: limit,
    completeChallenge: limit, manageIp: limit, manageAccount: limit});
  await secret('services-account', {...emailVariables, CLOUD_HTTP_RATE_KEY, CLOUD_INSTALLATION_ISSUER_KEY,
    CLOUD_PAIRING_ACTIVE_KEY_ID, CLOUD_PAIRING_KEYS, CLOUD_PORTAL_ASSETS_DIR, CLOUD_FACTOR_ACTIVE_KEY_ID, CLOUD_FACTOR_KEYS, CLOUD_FACTOR_POLICY, ...storage['services-account']});
  await secret('services-monitor', emailVariables);
  await secret('services-backup', storage['services-backup']);
  await secret('services-email', {...emailVariables, CLOUD_SMTP_USER: 'sender', CLOUD_SMTP_PASSWORD: smtpPassword});
  const {mail, corpus} = servicesCredentialFiles(smtpPassword, inboxPassword);
  await secret('services-mail', {'tls.crt': tls.cert, 'tls.key': tls.key, ...mail});
  await secret('services-proxy-key', {'proxy.pem': tls.cert + tls.key});
  const proxy = (await asset('deploy/test-cloud/proxy.cfg'))
    .replace('bind :3000', 'bind :3443').replace('server account account:3000', 'server account 127.0.0.1:3000');
  await create(resource('ConfigMap', 'services-proxy', {data: {'haproxy.cfg': proxy, 'ca.crt': tls.root, 'passwords.sha256': corpus}}));
  await create(resource('ConfigMap', 'services-store-ca', {data: {'ca.crt': store.ca}}));
  return {ca: tls.root, tls, config, runtimeDirectory, mailAuthorization: 'Basic ' + Buffer.from('inbox:' + inboxPassword).toString('base64')};
}

export async function runKubernetesServices(context) {
  const {cluster, nodes, run, image, waitronImage, verificationTarget, env, kubeconfig, signal, remote} = context;
  const tag = cluster + ':cloud';
  const kubeArgs = ['--kubeconfig', kubeconfig, '-n', servicesNamespace];
  const kube = (args, input, cleanup = false, requestSignal) => context.kube(['-n', servicesNamespace, ...args], {
    input, timeout, signal: cleanup ? null : AbortSignal.any([signal, requestSignal].filter(Boolean)),
  });
  const create = value => kube(['create', '-f', '-'], JSON.stringify(value));
  const forwards = [];
  let failure, remoteTarget;
  await run('docker', ['tag', image, tag]);
  try {
    await run('kind', ['load', 'docker-image', '--name', cluster, tag], {timeout});
    process.stderr.write('Preparing the three PostgreSQL copies and Cloud schema\n');
    await installServicesDatabase(context, tag);
    return await withStockholmStorageIdentity(context, async (store, custody) => {
      const settings = await configureServices(context, kube, store, custody);
      const {ca, mailAuthorization, config} = settings;
      await create(servicesPod(tag, nodes[0].name, remote));
      await create(servicesInspection(tag, remote ? config.gateway.cellId : undefined));
      await kube(['wait', '--for=condition=Ready', 'pod/cloud-services', '--timeout=180s']);
      await kube(['wait', '--for=condition=Ready', 'pod', '-l', 'job-name=services-inspection', '--timeout=180s']);
      const exec = (pod, container, command, input, limit) =>
        kube(['exec', '-i', pod, '-c', container, '--', ...command], input, false, limit);
      const pod = async (name, cleanup, optional) => {
        const reply = await kube(['get', 'pod', name, '-o', 'json', ...(optional ? ['--ignore-not-found'] : [])], undefined, cleanup);
        return reply ? parseIntegrationJson(reply) : undefined;
      };
      const command = (pod, container, script, input, limit) =>
        exec(pod, container, ['sh', '-ec', requireTls + script], input, limit);
      const ready = `
        import {localHealthFetch} from "./deploy/local-stack/operations-health.mjs";
        const host = new URL(process.env.CLOUD_PORTAL_ORIGIN).host;
        const response = await localHealthFetch(new URL("http://127.0.0.1:3000/api/health/ready"),
          {host, forwardedFor: "127.0.0.1", signal: AbortSignal.timeout(2000)});
        await response.text();
        if (response.status !== 200) {
          console.error("services.account_readiness_status:" + response.status);
          process.exitCode = 1;
        }
      `;
      for (let attempt = 0; ; attempt++) {
        try {await exec('cloud-services', 'account', ['node', '--input-type=module', '-e', ready]); break;}
        catch (error) {if (attempt === 29) throw error; await delay(1000, undefined, {signal});}
      }
      await exec('cloud-services', 'email', ['node', '--input-type=module', '-e', smtpRefusals]);
      const ports = await forwardKubernetesPod(kubeArgs, 'cloud-services', [3443, 8025], env, forwards);
      if (remote) {
        const {startRemoteRehearsal} = await import('./kubernetes-remote.mjs');
        remoteTarget = await startRemoteRehearsal({context, kube, create, tag, settings});
      }
      const manifest = !remote && JSON.parse(await asset('deploy/kubernetes/local-checks.yaml'));
      const template = !remote && servicesVerifier(manifest.items.find(row => row.metadata.name === 'verifier'), tag,
        verificationTarget.runtime.revision, nodes[0].name);
      const verifier = !remote && createKubernetesVerifier({template, kube, pod, classicImages: true,
        async loadImage(id) {
          await verifier.docker(['volume', 'create', '--driver', 'local',
            '--label', 'cloud.backup-verifier.scratch=waitron-cloud-test-backup',
            '--opt', 'type=none', '--opt', 'o=bind', '--opt', 'device=' + verifierScratchPath, verifierScratchVolume]);
          await loadVerifierImage(id, [...kubeArgs, 'exec', '-i', 'pod/verifier', '-c', 'docker', '--', 'docker', 'load'], env, signal);
        }});
      process.stderr.write(remote ? 'Running authenticated signup, box pairing and gateway handover\n' :
        'Running authenticated signup, box pairing and native backup verification\n');
      const result = await runTestCloudClients({image, waitronImage, verificationTarget, ...(remote ? {stockholmRemote: true} : {services: true}), kubernetes: {
        cluster, network: cluster, namespace: servicesNamespace, account: 'kube-account',
        proxyIp: nodes[0].ip, port: ports[3443], mailPort: ports[8025], ca, mailAuthorization, storeCa: store.ca, ...(remote ? {stockholmRemote: remoteTarget} : {verifier}),
        exec: async (role, args, input, limit) => {
          assert.deepEqual([role, ...args], ['account', 'node', 'deploy/test-cloud/test-fixtures/integration-account.mjs']);
          return command('job/services-inspection', 'inspect', 'CLOUD_STOCKHOLM_REHEARSAL=1 exec ' + args.join(' '), input, limit);
        },
      }});
      if (remote) return result;
      const operations = parseIntegrationJson(await command('cloud-services', 'account', `exec node --input-type=module -e '
        import {createRequire} from "node:module";
        import {operationsStatus} from "./packages/operations/src/status.ts";
        import {localHealthFetch} from "./deploy/local-stack/operations-health.mjs";
        const {Pool} = createRequire(new URL("./packages/operations/package.json", import.meta.url))("pg");
        const pool = new Pool({connectionString:process.env.DATABASE_URL, connectionTimeoutMillis:5000,
          statement_timeout:10000, options:"-c default_transaction_read_only=on"});
        const host = new URL(process.env.CLOUD_PORTAL_ORIGIN).host;
        try {
          const status = await operationsStatus(pool, {controlApiUrl: "http://127.0.0.1:3000",
            fetch: (url, options) => localHealthFetch(url, {...options, host, forwardedFor: "127.0.0.1"})});
          console.log(JSON.stringify(status.components.controlApi));
        } finally {await pool.end();}
      '`));
      assert.equal(operations.ready, true, 'services.operations_readiness');
      await exec('job/services-inspection', 'inspect', ['touch', '/tmp/inspection-complete']);
      await kube(['wait', '--for=condition=Complete', 'job/services-inspection', '--timeout=30s']);
      return {...result, operationsReady: true, smtpRefusals: true};
    });
  } catch (error) {
    failure = error;
    if (remote) {
      for (const [name, args] of [
        ['gateway candidates', ['get', 'pods', '-l', 'app=remote-gateway', '-o', 'wide']],
        ['gateway processes', ['logs', '-l', 'app=remote-gateway', '--tail=20', '--prefix']],
        ['remote worker', ['logs', 'pod/remote-worker', '--tail=20']],
      ]) {
        const log = await kube(args, undefined, true).catch(() => '');
        if (log) process.stderr.write(name + '\n' + log + '\n');
      }
    }
    for (const [pod, containers] of [
      ['cloud-services', ['account', 'email', 'proxy', 'mailpit', 'monitor', 'usage', 'probe']],
      ['verifier', ['verifier', 'docker']], ['job/migrate', ['migrate']], ['job/services-inspection', ['inspect']],
    ]) for (const container of containers) {
      const logs = await kube(['logs', pod, '-c', container, '--tail=20'], undefined, true).catch(() => '');
      if (logs) process.stderr.write(pod + '/' + container + '\n' + logs + '\n');
    }
    throw error;
  } finally {
    for (const {child, closed} of forwards) {child.kill('SIGKILL'); await closed;}
    await cleanUp(failure, async () => {
      try {await remoteTarget?.close();}
      finally {await run('docker', ['image', 'rm', tag], {signal: null});}
    });
  }
}
