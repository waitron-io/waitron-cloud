import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {bootstrap} from '../deploy/local-stack/bootstrap.mjs';
import {runtimeEnvironment} from '../deploy/local-stack/runtime.mjs';
import {storageRuntime} from '../deploy/kubernetes/storage-identity.mjs';
import {storageNamespace} from '../deploy/kubernetes/secrets.mjs';
import {servicesInspection, servicesNamespace, servicesOrigin, servicesPod, servicesDaemonSet, servicesVerifier, servicesStoreHost, storeCaPath,
  verifierScratchPath, verifierScratchVolume} from '../deploy/kubernetes/services.mjs';
import {installStockholmDatabase} from './kubernetes-data.mjs';
import {cleanUp, migrationJob, requireTls} from './kubernetes-database.mjs';
import {configurePolicy, withStockholmStorageIdentity} from './kubernetes-storage-identity.mjs';
import {healRejoinedStore, storageBucket, storageClient, storeMetrics, waitForStoreDrives} from './kubernetes-storage-proof.mjs';
import {storeNodePort, waitForStore} from './kubernetes-storage.mjs';
import {meshNodeAddress} from './kubernetes-outside.mjs';
import {kindHoldMs} from './kubernetes-node-loss.mjs';
import {startRemoteRehearsal, untilRemote} from './kubernetes-remote.mjs';
import {createKubernetesVerifier, forwardKubernetesPod, loadVerifierImage} from './kubernetes-check.mjs';
import {parseIntegrationJson, runTestCloudClients} from './test-cloud-integration.mjs';
import {observeP1} from './p1-observer.mjs';

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

export async function configureServices(context, kube, store, custody) {
  if (context.baseline) {
    // Each service machine has store copies. A stale endpoint on a stopped machine cannot serve a read.
    await context.kube(['-n', storageNamespace, 'patch', 'service', 's3', '--type=merge', '-p',
      JSON.stringify({spec: {internalTrafficPolicy: 'Local'}})]);
  }
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
  const replies = completed.flatMap((row, index) => row.status === 'fulfilled' ? [{...row.value, worker: pods[index]}] : []);
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
  return new Response(response.text, {status: response.status, headers: {'x-rehearsal-mail-worker': response.worker}});
}

export async function measureServiceStops({nodes, inventory, stopNode, restore, healthy, reconcile, probes, holdMs,
  signal, observe = observeP1}) {
  assert.ok(nodes.length === 3 && new Set(nodes).size === 3, 'services.stop_three_nodes');
  const uncovered = new Set(['primary', 'gateway', 'operator', 'fluxSource', 'fluxApply']);
  const remaining = [...nodes], legs = [];
  while (remaining.length) {
    const roles = await inventory(signal);
    const score = node => [...uncovered].filter(role => roles[role] === node).length;
    const node = remaining.reduce((best, candidate) => score(candidate) > score(best) ? candidate : best);
    remaining.splice(remaining.indexOf(node), 1);
    process.stderr.write('D621 stop inventory ' + JSON.stringify({node, roles}) + '\n');
    const survivors = nodes.filter(name => name !== node);
    const stopped = Promise.withResolvers();
    stopped.promise.catch(() => {});
    let stopping, fault;
    const leg = new AbortController();
    const limit = AbortSignal.any([leg.signal, ...[signal].filter(Boolean)]);
    const observation = observe({probes, holdMs, signal: limit, stopped: () => stopped.promise, replacement: () => stopped.promise,
      reconcile: () => reconcile(node, roles, survivors, {...fault, signal: limit}),
      ready() {
        stopping = Promise.resolve().then(() => stopNode(node, {measured: true, afterRestart: options => restore(node, options),
          async whileStopped(details) {
            fault = details;
            assert.equal(fault.holdMs, holdMs, 'services.stop_hold');
            stopped.resolve(fault.stoppedAt);
            const expire = () => leg.abort(fault.signal.reason);
            fault.signal?.addEventListener('abort', expire, {once: true});
            try {return await observation;}
            finally {fault.signal?.removeEventListener('abort', expire);}
          }}));
        stopping.catch(stopped.reject);
      }});
    try {await observation;}
    catch (error) {
      leg.abort(error);
      await stopping?.catch(() => {});
      throw error;
    }
    const receipt = await stopping;
    assert.ok(receipt?.stopped === node && receipt.offMs >= holdMs, 'services.stop_missing:' + node);
    const {signup, backup} = receipt.recovery;
    const {primary, publication, outsideStore, flux} = receipt.reconciliation;
    assert.ok(signup.result?.worker, 'services.stop_mail_worker');
    assert.ok(backup.result?.controllerScope && backup.result.attemptId && backup.result.retained, 'services.stop_backup_worker');
    assert.ok(survivors.includes(primary) && outsideStore && flux?.appliedRevision, 'services.stop_service_recovery');
    if (roles.primary === node) assert.ok(publication?.worker && Number.isFinite(publication.completedMs), 'services.stop_publication');
    for (const role of uncovered) if (roles[role] === node) uncovered.delete(role);
    const rejoin = await healthy(node, signal);
    legs.push({...receipt, roles, rejoin});
  }
  for (const role of uncovered) assert.fail('services.stop_role:' + role);
  return legs;
}

export async function measureServiceRecovery({node, roles, survivors, fault, writablePrimary, outsideStoreReady,
  proveGit, publication}) {
  const fluxDeadline = 180_000 - (performance.now() - fault.started);
  assert.ok(fluxDeadline > 0, 'services.stop_flux_deadline');
  const gitSignal = AbortSignal.any([fault.signal, AbortSignal.timeout(Math.ceil(fluxDeadline))].filter(Boolean));
  const [database, outsideStore, flux] = await Promise.all([
    writablePrimary(survivors, fault.signal).then(primary => ({primary, recoveredMs: Math.round(performance.now() - fault.started)})),
    outsideStoreReady(fault.signal), proveGit(survivors, gitSignal),
  ]);
  // Flux rolls the publication deployment. Measure new work once its worker is stable.
  const renewed = roles.primary === node ? await publication(survivors, fault) : undefined;
  return {...database, publication: renewed, outsideStore, flux};
}

export async function runKubernetesServices(context) {
  const {cluster, nodes, run, image, waitronImage, verificationTarget, env, kubeconfig, kubeTarget, signal,
    remote, stopGatewayNode, stopServiceNodes, stopNode, prepareOutside, baseline, amazon, importVerifierImage,
    holdMs = kindHoldMs} = context;
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
      const names = nodes.map(row => row.name);
      const read = async (namespace, args, signal) =>
        parseIntegrationJson(await context.kube(['-n', namespace, 'get', ...args, '-o', 'json'], {signal}));
      const list = async (namespace, args, signal) => (await read(namespace, args, signal)).items;
      const primary = async signal => {
        const {status} = await read(servicesNamespace, ['cluster', 'cloud-db'], signal);
        const {metadata, spec} = await read(servicesNamespace, ['pod', status.currentPrimary], signal);
        return {pod: metadata.name, node: spec.nodeName};
      };
      const inventory = limit => untilRemote(async signal => {
        const [database, gateway, operators, election, flux] = await Promise.all([
          primary(signal), read(servicesNamespace, ['lease', 'remote-gateway'], signal),
          list('cnpg-system', ['pods', '-l', 'app.kubernetes.io/name=cloudnative-pg'], signal),
          list('cnpg-system', ['leases'], signal), list('flux-system', ['pods'], signal),
        ]);
        const holder = gateway.spec.holderIdentity?.split(':')[0];
        const activeGateway = await read(servicesNamespace, ['pod', holder], signal);
        const leaders = election.map(row => row.spec.holderIdentity?.split('_')[0]);
        const operator = operators.find(row => leaders.includes(row.metadata.name));
        const fluxNode = app => flux.find(row => row.metadata.labels?.app === app &&
          row.status.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True'))?.spec.nodeName;
        const roles = {primary: database.node, gateway: activeGateway.spec.nodeName, operator: operator?.spec.nodeName,
          fluxSource: fluxNode('source-controller'), fluxApply: fluxNode('kustomize-controller')};
        return Object.values(roles).every(node => names.includes(node)) && roles;
      }, 30_000, limit, 'stop_role_inventory');
      const writablePrimary = (expected, limit) => untilRemote(async signal => {
        const writer = await primary(signal);
        if (!expected.includes(writer.node)) return false;
        const [endpoints, pods] = await Promise.all([
          list(servicesNamespace, ['endpointslices', '-l', 'kubernetes.io/service-name=cloud-db-rw'], signal),
          list(servicesNamespace, ['pods', '-l', 'cnpg.io/cluster=cloud-db,cnpg.io/podRole=instance'], signal),
        ]);
        const destinations = endpoints.flatMap(slice => slice.endpoints)
          .filter(row => row.conditions.ready).map(row => row.targetRef?.name);
        if (destinations.length !== 1 || destinations[0] !== writer.pod) return false;
        const active = pods.filter(row => !row.metadata.deletionTimestamp && expected.includes(row.spec.nodeName));
        if (new Set(active.map(row => row.spec.nodeName)).size !== expected.length) return false;
        const states = await Promise.all(active.map(async row => [
          row.metadata.name, await exec(row.metadata.name, 'postgres', ['psql', '-U', 'postgres', '-Atqc',
            "SELECT pg_is_in_recovery() || ':' || current_setting('transaction_read_only')"], undefined, signal),
        ]));
        return states.every(([pod, state]) => state === (pod === writer.pod ? 'false:off' : 'true:on')) && writer.node;
      }, expected.length === 3 ? 180_000 : 90_000, limit, 'one_writable_primary');
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
        ...(stopServiceNodes && {stopServices: probes => measureServiceStops({nodes: names, inventory, signal, probes, holdMs,
          stopNode: (node, options) => stopNode(node, {...options, whileStopped(fault) {
            stopped = node;
            return options.whileStopped(fault);
          }}),
          restore: (node, options) => outside.restoreNode?.(node, options),
          healthy: async (name, signal) => {
            stopped = undefined;
            const repair = AbortSignal.any([signal, AbortSignal.timeout(180_000)]);
            const [primary] = await Promise.all([writablePrimary(names, repair),
              waitForStore({nodes: names, kube: context.kube, signal: repair}),
              untilRemote(async limit => (await readyServices(limit)).length === names.length, 180_000, repair, 'services_rejoined')]);
            const ordinal = names.indexOf(name) * 2, node = context.nodes.find(row => row.name === name);
            const drives = await waitForStoreDrives(limit => storeMetrics(node.ip, store, limit),
              ['store-' + ordinal, 'store-' + (ordinal + 1)], repair);
            const storeRepairAttempts = await healRejoinedStore({node, account: store, run, signal: repair});
            return {primary, drives, storeRepairedOn: name, storeRepairAttempts};
          },
          reconcile: (node, roles, survivors, fault) => measureServiceRecovery({
            node, roles, survivors, fault, writablePrimary, proveGit: outside.proveSurviving, publication: probes.publication,
            outsideStoreReady: signal => untilRemote(async limit => {
              await run('curl', ['-fsS', '--max-time', '3', '--cacert', store.caPath, '--resolve',
                servicesStoreHost + ':9000:' + remoteTarget.gatewayIp,
                'https://' + servicesStoreHost + ':9000/minio/health/cluster'], {signal: limit});
              return true;
            }, 90_000, signal, 'outside_store_ready'),
          })})}),
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
