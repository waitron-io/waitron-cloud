import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {bootstrap} from '../deploy/local-stack/bootstrap.mjs';
import {runtimeEnvironment} from '../deploy/local-stack/runtime.mjs';
import {storageRuntime} from '../deploy/kubernetes/storage-identity.mjs';
import {servicesInspection, servicesNamespace, servicesOrigin, servicesPod, servicesDaemonSet, servicesVerifier, servicesStoreHost, storeCaPath,
  verifierScratchPath, verifierScratchVolume} from '../deploy/kubernetes/services.mjs';
import {installStockholmDatabase} from './kubernetes-data.mjs';
import {cleanUp, migrationJob, requireTls} from './kubernetes-database.mjs';
import {configurePolicy, withStockholmStorageIdentity} from './kubernetes-storage-identity.mjs';
import {storageBucket, storageClient} from './kubernetes-storage-proof.mjs';
import {storeNodePort, waitForStore} from './kubernetes-storage.mjs';
import {meshNodeAddress} from './kubernetes-outside.mjs';
import {startRemoteRehearsal, untilRemote} from './kubernetes-remote.mjs';
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
  const {nodes, run, kube, databasePrepared, installDatabase = installStockholmDatabase} = context;
  if (!databasePrepared) {
    const input = await asset('deploy/kubernetes/bounded-amazon/bootstrap.sh');
    for (const node of nodes) {
      await run('docker', ['exec', '-i', node.id, 'bash', '-s', '--', 'database-storage'], {input});
    }
    await installDatabase({...context, nodes: nodes.map(({name}) => name)});
  }
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
  const storage = servicesStorageSettings(custody, roles, context.baseline ? 'https://' + servicesStoreHost + ':9000' : endpoint);
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

export function servicesDatabaseErrorCodes(log) {
  const codes = new Set();
  for (const line of log.split('\n')) {
    try {
      const {record} = JSON.parse(line);
      const code = record?.sql_state_code;
      if (typeof code === 'string' && /^[A-Z0-9]{5}$/.test(code) &&
          ['ERROR', 'FATAL', 'PANIC'].includes(record.error_severity)) codes.add(code);
    } catch {}
  }
  return [...codes].sort();
}

const inboxRequest = `
  import {readFileSync} from 'node:fs';
  const {path, authorization} = JSON.parse(readFileSync(0, 'utf8'));
  const response = await fetch('http://127.0.0.1:8025/api/v1/' + path, {
    headers: authorization ? {authorization} : {}, signal: AbortSignal.timeout(5000),
  });
  console.log(JSON.stringify({status: response.status, text: await response.text()}));
`;

export function readyServicePods(rows, {stopped, containers = []}) {
  return rows.filter(row => {
    if (row.spec.nodeName === stopped || row.metadata.deletionTimestamp) return false;
    // A worker restarting after database failover does not stop another container from serving.
    if (containers.length) return containers.every(name => row.status.containerStatuses?.some(
      container => container.name === name && container.ready));
    return row.status.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True');
  });
}

export async function readServicesInbox(pods, fetch, path, authorization) {
  const completed = await Promise.allSettled(pods.map(pod => fetch(pod, path, authorization)));
  const replies = completed.filter(row => row.status === 'fulfilled').map(row => row.value);
  if (!replies.length || (!authorization && replies.length !== pods.length)) {
    throw Error('services.inbox_unreachable', {cause: completed.find(row => row.status === 'rejected')?.reason});
  }
  if (!authorization) {
    const response = replies.find(reply => reply.status !== 401) ?? replies[0];
    return new Response(response.text, {status: response.status});
  }
  const found = replies.filter(reply => reply.status === 200);
  if (path === 'messages' && found.length) {
    return Response.json({messages: found.flatMap(reply => parseIntegrationJson(reply.text).messages)});
  }
  const response = found[0] ?? replies.find(reply => reply.status !== 404) ?? replies[0];
  return new Response(response.text, {status: response.status});
}

export async function runKubernetesServices(context) {
  const {cluster, nodes, run, image, waitronImage, verificationTarget, env, kubeconfig, kubeTarget, signal,
    remote, stopGatewayNode, stopServiceNodes, stopNode, prepareOutside, baseline, amazon, importVerifierImage} = context;
  const tag = cluster + ':cloud';
  const kubeArgs = () => [...(kubeTarget ? kubeTarget() : ['--kubeconfig', kubeconfig]), '-n', servicesNamespace];
  const kube = (args, input, cleanup = false, requestSignal) => context.kube(['-n', servicesNamespace, ...args], {
    input, timeout, signal: cleanup ? null : AbortSignal.any([signal, requestSignal].filter(Boolean)),
  });
  const create = value => kube(['create', '-f', '-'], JSON.stringify(value));
  const forwards = [];
  let failure, remoteTarget, outside;
  if (!amazon) await run('docker', ['tag', image, tag]);
  try {
    if (!amazon) await run('kind', ['load', 'docker-image', '--name', cluster, tag], {timeout});
    if (baseline) {
      outside = await prepareOutside(context, tag);
      context = {...context, nodes: nodes.map((node, index) => ({...node, ip: meshNodeAddress(index)}))};
    }
    process.stderr.write('Preparing the three PostgreSQL copies and Cloud schema\n');
    await installServicesDatabase(context, tag);
    return await withStockholmStorageIdentity(context, async (store, custody) => {
      const settings = await configureServices(context, kube, store, custody);
      const {ca, mailAuthorization, config} = settings;
      if (baseline) {
        await create(servicesDaemonSet(tag, nodes.map(node => node.name), config.gateway.cellId));
        await kube(['rollout', 'status', 'daemonset/cloud-services', '--timeout=180s']);
      } else {
        await create(servicesPod(tag, nodes[0].name, remote));
        await create(remote ? servicesInspection(tag, config.gateway.cellId, nodes[0].name) : servicesInspection(tag));
        await kube(['wait', '--for=condition=Ready', 'pod/cloud-services', '--timeout=180s']);
        await kube(['wait', '--for=condition=Ready', 'pod', '-l', 'job-name=services-inspection', '--timeout=180s']);
      }
      let stopped;
      const readyServices = async (limit, ...containers) => {
        const {items} = parseIntegrationJson(await kube(['get', 'pods', '-l', 'app=cloud-services', '-o', 'json'],
          undefined, false, limit));
        return readyServicePods(items, {stopped, containers});
      };
      const service = async (container, limit) => {
        if (!baseline) return 'cloud-services';
        const [healthy] = await readyServices(limit, container);
        assert.ok(healthy, 'services.no_ready_copy');
        return healthy.metadata.name;
      };
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
        try {await exec(await service('account', signal), 'account', ['node', '--input-type=module', '-e', ready]); break;}
        catch (error) {if (attempt === 29) throw error; await delay(1000, undefined, {signal});}
      }
      await exec(await service('email', signal), 'email', ['node', '--input-type=module', '-e', smtpRefusals]);
      const ports = baseline ? {3443: 3000} : await forwardKubernetesPod(kubeArgs(), 'cloud-services', [3443, 8025], env, forwards);
      if (remote || baseline) {
        if (!baseline) outside = await prepareOutside?.(context, tag);
        remoteTarget = await startRemoteRehearsal({context, kube, create, tag, settings, outside: Boolean(outside),
          installPublication: baseline ? outside.install : undefined});
      }
      const manifest = !remote && JSON.parse(await asset('deploy/kubernetes/local-checks.yaml'));
      const template = !remote && servicesVerifier(manifest.items.find(row => row.metadata.name === 'verifier'), tag,
        verificationTarget.runtime.revision, nodes[0].name);
      const verifier = !remote && createKubernetesVerifier({template, kube, pod, classicImages: true,
        ...(baseline && {async selectNode() {
          const [healthy] = await readyServices(signal, 'inspect');
          assert.ok(healthy, 'services.no_verifier_node');
          return healthy.spec.nodeName;
        }}),
        async loadImage(id) {
          await verifier.docker(['volume', 'create', '--driver', 'local',
            '--label', 'cloud.backup-verifier.scratch=waitron-cloud-test-backup',
            '--opt', 'type=none', '--opt', 'o=bind', '--opt', 'device=' + verifierScratchPath, verifierScratchVolume]);
          const args = ['exec', '-i', 'pod/verifier', '-c', 'docker', '--', 'docker', 'load'];
          if (importVerifierImage) await importVerifierImage(id, args);
          else await loadVerifierImage(id, [...kubeArgs(), ...args], env, signal);
        }});
      process.stderr.write(remote ? 'Running authenticated signup, box pairing and gateway handover\n' :
        'Running authenticated signup, box pairing and native backup verification\n');
      const mode = baseline ? {stockholmBaseline: true} :
        remote ? {stockholmRemote: true, stockholmGatewayMachineLoss: stopGatewayNode} : {services: true};
      const result = await runTestCloudClients({image, waitronImage, verificationTarget, ...mode, kubernetes: {
        cluster, network: cluster, namespace: servicesNamespace, account: 'kube-account',
        proxyIp: baseline ? remoteTarget.gatewayIp : context.nodes[0].ip, port: ports[3443], mailPort: ports[8025], ca, mailAuthorization, storeCa: store.ca,
        stockholmRemote: remoteTarget, verifier, amazon,
        ...(baseline && {async readInbox(path, authorization, limit) {
          return readServicesInbox((await readyServices(limit, 'account', 'mailpit')).map(row => row.metadata.name),
            async (pod, path, authorization) => parseIntegrationJson(await exec(pod, 'account',
              ['node', '--input-type=module', '-e', inboxRequest], JSON.stringify({path, authorization}), limit)),
            path, authorization);
        }}),
        ...(stopServiceNodes && {async stopServices(prove) {
          const legs = [];
          for (const node of nodes) {
            stopped = node.name;
            const evidence = await stopNode(stopped, {
              whileStopped: async fault => {
                const evidence = await prove(fault.signal);
                process.stderr.write('Outside Kind session, mail and stored backup verified during stop\n');
                await untilRemote(async limit => {
                  await run('curl', ['-fsS', '--max-time', '3', '--cacert', store.caPath, '--resolve',
                    servicesStoreHost + ':9000:' + remoteTarget.gatewayIp,
                    'https://' + servicesStoreHost + ':9000/minio/health/cluster'], {signal: limit});
                  return true;
                }, 15_000, fault.signal, 'outside_store_ready');
                return {...evidence, outsideStore: true};
              },
              afterRestart: options => outside.restoreNode(stopped, options),
            });
            stopped = undefined;
            await waitForStore({nodes: nodes.map(row => row.name), kube: context.kube,
              signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)])});
            await untilRemote(async limit => (await readyServices(limit)).length === nodes.length,
              180_000, signal, 'services_rejoined');
            legs.push(evidence);
          }
          return legs;
        }}),
        exec: async (role, args, input, limit) => {
          assert.deepEqual([role, ...args], ['account', 'node', 'deploy/test-cloud/test-fixtures/integration-account.mjs']);
          return command(baseline ? await service('inspect', limit) : 'job/services-inspection', 'inspect', 'CLOUD_STOCKHOLM_REHEARSAL=1 exec ' + args.join(' '), input, limit);
        },
      }});
      if (remote) return result;
      const operations = parseIntegrationJson(await command(await service('account', signal), 'account', `exec node --input-type=module -e '
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
      if (!baseline) {
        await exec('job/services-inspection', 'inspect', ['touch', '/tmp/inspection-complete']);
        await kube(['wait', '--for=condition=Complete', 'job/services-inspection', '--timeout=30s']);
      }
      return {...result, operationsReady: true, smtpRefusals: true, ...(baseline && {flux: outside.revision})};
    });
  } catch (error) {
    failure = error;
    if (baseline && error.message === 'integration.command_failed:client-paid-remote') {
      const log = await context.kube(['-n', servicesNamespace, 'logs', '-l', 'cnpg.io/cluster=cloud-db',
        '-c', 'postgres', '--tail=350'], {signal: null, timeout: 10_000}).catch(() => undefined);
      process.stderr.write('D621 staff certificate database error codes ' +
        (log === undefined ? 'unavailable' : JSON.stringify(servicesDatabaseErrorCodes(log))) + '\n');
    }
    if (remote || baseline) {
      for (const [name, args] of [
        ['gateway candidates', ['get', 'pods', '-l', 'app=remote-gateway', '-o', 'wide']],
        ['gateway processes', ['logs', '-l', 'app=remote-gateway', '--tail=20', '--prefix']],
        ['remote worker', ['logs', '-l', 'app=remote-worker', '--tail=20', '--prefix']],
      ]) {
        const log = await kube(args, undefined, true).catch(() => '');
        if (log) process.stderr.write(name + '\n' + log + '\n');
      }
    }
    for (const [pod, containers] of [
      ['cloud-services', ['account', 'email', 'proxy', 'mailpit', 'monitor', 'usage', 'probe', ...(baseline ? ['inspect'] : [])]],
      ['verifier', ['verifier', 'docker']], ['job/migrate', ['migrate']], ['job/services-inspection', ['inspect']],
    ]) for (const container of containers) {
      if (baseline && pod === 'job/services-inspection') continue;
      const source = baseline && pod === 'cloud-services' ? ['-l', 'app=cloud-services', '--prefix'] : [pod];
      const logs = await kube(['logs', ...source, '-c', container, '--tail=20'], undefined, true).catch(() => '');
      if (logs) process.stderr.write(pod + '/' + container + '\n' + logs + '\n');
    }
    throw error;
  } finally {
    for (const {child, closed} of forwards) {child.kill('SIGKILL'); await closed;}
    await cleanUp(failure, async () => {
      try {
        try {await remoteTarget?.close();}
        finally {await outside?.close();}
      } finally {if (!amazon) await run('docker', ['image', 'rm', tag], {signal: null});}
    });
  }
}
