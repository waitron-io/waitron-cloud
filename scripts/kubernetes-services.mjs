import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {get} from 'node:https';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {bootstrap} from '../deploy/local-stack/bootstrap.mjs';
import {runtimeEnvironment} from '../deploy/local-stack/runtime.mjs';
import {storageRuntime} from '../deploy/kubernetes/storage-identity.mjs';
import {storageNamespace} from '../deploy/kubernetes/secrets.mjs';
import {servicesInspection, servicesNamespace, servicesOrigin, servicesPod, servicesDaemonSet, servicesVerifier, servicesStoreHost, storeCaPath, outsideMailHost,
  verifierScratchPath, verifierScratchVolume} from '../deploy/kubernetes/services.mjs';
import {installStockholmDatabase} from './kubernetes-data.mjs';
import {cleanUp, migrationJob, requireTls} from './kubernetes-database.mjs';
import {configurePolicy, withStockholmStorageIdentity} from './kubernetes-storage-identity.mjs';
import {healRejoinedStore, seedStoreRepairProbe, storageBucket, storageClient, storeMetrics, waitForStoreDrives} from './kubernetes-storage-proof.mjs';
import {storeNodePort, waitForStore} from './kubernetes-storage.mjs';
import {meshNodeAddress} from './kubernetes-outside.mjs';
import {kindHoldMs} from './kubernetes-node-loss.mjs';
import {startRemoteRehearsal, untilRemote} from './kubernetes-remote.mjs';
import {createKubernetesVerifier, forwardKubernetesPod, loadVerifierImage} from './kubernetes-check.mjs';
import {parseIntegrationJson, runTestCloudClients} from './test-cloud-integration.mjs';
import {prepareDatabaseWitness} from './kubernetes-cold-restart.mjs';
import {measureP1Check as measureCheck, observeP1, p1SignupLimits} from './p1-observer.mjs';

const require = createRequire(new URL('../packages/backups/package.json', import.meta.url));
const {CreateBucketCommand} = require('@aws-sdk/client-s3');
const asset = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const timeout = 185_000;
const databaseRejoinMs = 180_000;
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

async function certificates({directory, run, baseline}) {
  const ca = join(directory, 'services-ca.crt'), caKey = join(directory, 'services-ca.key');
  const certificate = join(directory, 'services.crt'), key = join(directory, 'services.key');
  const csr = join(directory, 'services.csr');
  const subjectAltName = 'subjectAltName=DNS:' + new URL(servicesOrigin).hostname + ',IP:127.0.0.1' +
    (baseline ? ',IP:' + outsideMailHost : '');
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
  const transport = createTransport({host:process.env.CLOUD_SMTP_HOST,port:Number(process.env.CLOUD_SMTP_PORT),secure:true,forceAuth:true,
    auth:{user:process.env.CLOUD_SMTP_USER,pass},connectionTimeout:3000,greetingTimeout:3000,socketTimeout:3000});
  try {await transport.sendMail({from:'cloud@example.test',to,subject:'Synthetic rehearsal',text:'Synthetic rehearsal'});}
  finally {transport.close();}
};
await assert.rejects(send('control@example.test', 'wrong-password'), {code:'EAUTH'});
await assert.rejects(send('control@example.invalid', process.env.CLOUD_SMTP_PASSWORD), {code:'EENVELOPE'});
`;

export function servicesCredentialFiles(smtpPassword, inboxPassword, senders = ['sender']) {
  return {
    mail: {'smtp-auth': senders.map(sender => sender + ':' + smtpPassword + '\n').join(''), 'ui-auth': 'inbox:' + inboxPassword + '\n'},
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

export function renderServicesProxy(source, baseline) {
  const proxy = source.replace('bind :3000', 'bind :3443').replace('server account account:3000', 'server account 127.0.0.1:3000');
  if (!baseline) return proxy;
  // A transaction marker survives to proxy-generated responses, where the request path is unavailable.
  return proxy.replace('  default_backend account', [
    '  http-request set-var(txn.p1_session) int(1) if { path -m str /api/account/session }',
    '  http-after-response set-header X-Waitron-Test-Account-Node "${TEST_CLOUD_ACCOUNT_NODE}" if { var(txn.p1_session) -m found }',
    '  default_backend account',
  ].join('\n'));
}

export async function configureServices(context, kube, store, custody) {
  if (context.baseline) {
    // Each service machine has store copies. A stale endpoint on a stopped machine cannot serve a read.
    await context.kube(['-n', storageNamespace, 'patch', 'service', 's3', '--type=merge', '-p',
      JSON.stringify({spec: {internalTrafficPolicy: 'Local'}})]);
  }
  const node = context.nodes[0], endpoint = 'https://' + node.ip + ':' + storeNodePort;
  const s3 = storageClient(node, store);
  try {
    await s3.send(CreateBucketCommand, {}, context.signal);
    if (context.stopServiceNodes) await seedStoreRepairProbe(s3, context.signal);
  }
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
  const signupLimits = context.stopServiceNodes ? p1SignupLimits(context.env?.CLOUD_SIGNUP_LIMITS) : undefined;
  const signupSetting = signupLimits ? JSON.stringify(signupLimits) : context.env?.CLOUD_SIGNUP_LIMITS;
  await secret('services-account', {...emailVariables, CLOUD_HTTP_RATE_KEY, CLOUD_INSTALLATION_ISSUER_KEY,
    ...(signupSetting !== undefined && {CLOUD_SIGNUP_LIMITS: signupSetting}),
    CLOUD_PAIRING_ACTIVE_KEY_ID, CLOUD_PAIRING_KEYS, CLOUD_PORTAL_ASSETS_DIR, CLOUD_FACTOR_ACTIVE_KEY_ID, CLOUD_FACTOR_KEYS, CLOUD_FACTOR_POLICY, ...storage['services-account']});
  await secret('services-monitor', emailVariables);
  await secret('services-backup', storage['services-backup']);
  await secret('services-email', {...emailVariables, ...(!context.baseline && {CLOUD_SMTP_USER: 'sender'}), CLOUD_SMTP_PASSWORD: smtpPassword});
  const {mail, corpus} = servicesCredentialFiles(smtpPassword, inboxPassword,
    context.baseline ? context.nodes.map(row => row.name) : undefined);
  const mailFiles = {'tls.crt': tls.cert, 'tls.key': tls.key, ...mail};
  if (!context.baseline) await secret('services-mail', mailFiles);
  await secret('services-proxy-key', {'proxy.pem': tls.cert + tls.key});
  const proxy = renderServicesProxy(await asset('deploy/test-cloud/proxy.cfg'), context.baseline);
  await create(resource('ConfigMap', 'services-proxy', {data: {'haproxy.cfg': proxy, 'ca.crt': tls.root, 'passwords.sha256': corpus}}));
  await create(resource('ConfigMap', 'services-store-ca', {data: {'ca.crt': store.ca}}));
  return {ca: tls.root, tls, config, runtimeDirectory, mailFiles, signupRequestsPerHour: signupLimits?.requestsPerHour, mailAuthorization: 'Basic ' + Buffer.from('inbox:' + inboxPassword).toString('base64')};
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

export function readyServicePods(rows, {stopped, containers = []}) {
  return rows.filter(row => {
    if (row.spec.nodeName === stopped || row.metadata.deletionTimestamp) return false;
    // A worker restarting after database failover does not stop another container from serving.
    if (containers.length) return containers.every(name => row.status.containerStatuses?.some(
      container => container.name === name && container.ready));
    return row.status.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True');
  });
}

export async function readStockholmWriter(bindKube, signal) {
  const at = new Date().toISOString();
  const limit = AbortSignal.any([signal, AbortSignal.timeout(950)]);
  let writer;
  try {
    const kube = await bindKube(limit);
    const read = async args => parseIntegrationJson(await kube(['-n', servicesNamespace, 'get', ...args, '-o', 'json'], {signal: limit}));
    const pod = (await read(['cluster', 'cloud-db'])).status?.currentPrimary;
    assert.match(pod ?? '', /^cloud-db-\d+$/, 'services.writer_name');
    const {metadata, spec, status} = await read(['pod', pod]);
    const postgres = status.containerStatuses?.find(container => container.name === 'postgres');
    writer = {pod, uid: metadata.uid, node: spec.nodeName, restartCount: postgres?.restartCount,
      lastExitReason: postgres?.lastState?.terminated?.reason};
    const postmasterStart = await kube(['-n', servicesNamespace, 'exec', pod, '-c', 'postgres', '--',
      'psql', '-U', 'postgres', '-Atqc', 'SELECT pg_postmaster_start_time()'], {signal: limit});
    assert.ok(Number.isFinite(Date.parse(postmasterStart)), 'services.writer_start_time');
    return {at, ...writer, postmasterStart};
  } catch (error) {
    signal.throwIfAborted();
    return {at, ...writer, gap: error.code ?? error.name};
  }
}

export async function readStockholmDiagnostics(bindKube, signal) {
  const limit = AbortSignal.any([signal, AbortSignal.timeout(8_000)]);
  const token = value => typeof value === 'string' && /^[\w./-]{1,80}$/.test(value) ? value : undefined;
  const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)) ? value : undefined;
  const fields = row => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
  const logRows = raw => raw.split('\n').flatMap(line => {
    try {
      const {record, level, reason, logger} = JSON.parse(line.slice(line.indexOf('{')));
      return [fields({at: timestamp(line.split(' ')[0]), level: token(level ?? record?.error_severity),
        reason: token(reason ?? record?.reason), component: token(logger), sqlstate: token(record?.sql_state_code)})];
    } catch {return [];}
  });
  const readEvents = raw => parseIntegrationJson(raw).items.filter(event =>
    event.involvedObject?.kind === 'Node' || [servicesNamespace, 'cnpg-system', 'flux-system'].includes(event.involvedObject?.namespace))
    .map(event => fields({at: timestamp(event.eventTime || event.lastTimestamp || event.metadata?.creationTimestamp),
      reason: token(event.reason), component: token(event.reportingComponent || event.source?.component)}));
  const log = (namespace, label, ...args) => ['-n', namespace, 'logs', '-l', label,
    '--tail=80', '--timestamps', '--ignore-errors=true', ...args];
  const postgres = log(servicesNamespace, 'cnpg.io/cluster=cloud-db', '-c', 'postgres');
  const commands = {postgres, postgresPrevious: [...postgres, '--previous'],
    operator: log('cnpg-system', 'app.kubernetes.io/name=cloudnative-pg'),
    flux: log('flux-system', 'app in (source-controller,kustomize-controller)'), events: ['get', 'events', '-A', '-o', 'json']};
  try {
    const kube = await bindKube(limit);
    return Object.fromEntries(await Promise.all(Object.entries(commands).map(async ([name, args]) => {
      try {
        const raw = await kube(args, {signal: limit});
        return [name, name === 'events' ? readEvents(raw) : logRows(raw)];
      } catch (error) {return [name, {gap: error.code ?? error.name}];}
    })));
  } catch (error) {return {gap: error.code ?? error.name};}
}

async function monitorStockholmDatabase({bindKube, signal, stage}, work) {
  if (!bindKube) return work(async () => {});
  const controller = new AbortController();
  const limit = AbortSignal.any([signal, controller.signal]);
  const write = (kind, record) => process.stderr.write('D621 database ' + kind + ' ' + JSON.stringify({stage, ...record}) + '\n');
  const takeSample = async () => write('sample', await readStockholmWriter(bindKube, limit));
  let next = performance.now() + 1000;
  await takeSample();
  const polling = (async () => {
    while (!limit.aborted) {
      await delay(Math.max(0, next - performance.now()), undefined, {signal: limit});
      await takeSample();
      next = Math.max(next + 1000, performance.now());
    }
  })().catch(error => {if (!limit.aborted) write('sample', {gap: error.code ?? error.name});});
  try {
    return await work(async (point, request = signal) => {
      const at = new Date().toISOString();
      write('diagnostics', {point, at, ...await readStockholmDiagnostics(bindKube, AbortSignal.any([limit, request]))});
    });
  } finally {
    controller.abort();
    await polling;
  }
}

export async function measureServiceStops({nodes, inventory, stopNode, restore, healthy, reconcile, probes, holdMs,
  signal, spaceSignup, requireSignedUpload = false, recordFailures = false, recordEvidence, bindEvidenceKube, observe = observeP1}) {
  assert.ok(nodes.length === 3 && new Set(nodes).size === 3, 'services.stop_three_nodes');
  if (requireSignedUpload) assert.equal(typeof probes?.signedBackupReservations, 'function', 'services.signed_backup_probe_missing');
  const uncovered = new Set(['primary', 'gateway', 'operator', 'fluxSource', 'fluxApply']);
  const remaining = [...nodes], legs = [];
  while (remaining.length) {
    const roles = await inventory(signal);
    const score = node => [...uncovered].filter(role => roles[role] === node).length;
    const node = remaining.reduce((best, candidate) => score(candidate) > score(best) ? candidate : best);
    remaining.splice(remaining.indexOf(node), 1);
    const failures = recordFailures ? [] : undefined;
    if (failures) recordEvidence?.('stop:' + node, failures);
    const check = (name, work) => measureCheck(failures, signal, 'services.stop_' + name, work);
    const checkInbox = await check('inbox_before', () => probes?.inboxWitness?.(signal));
    const checkReservations = requireSignedUpload && roles.primary === node ?
      await check('signed_reservations_before', () => probes.signedBackupReservations()) : undefined;
    process.stderr.write('D621 stop inventory ' + JSON.stringify({node, roles}) + '\n');
    const survivors = nodes.filter(name => name !== node);
    const stopped = Promise.withResolvers();
    stopped.promise.catch(() => {});
    let stopping, fault;
    const leg = new AbortController();
    const limit = AbortSignal.any([leg.signal, ...[signal].filter(Boolean)]);
    const sessionBeforeStop = await check('session_activity', () => probes?.sessionActivity?.(limit));
    await monitorStockholmDatabase({bindKube: bindEvidenceKube, signal: limit, stage: 'stop:' + node}, async snapshot => {
      const observation = observe({probes, holdMs, recordFailures, signal: limit, stopped: () => stopped.promise, replacement: () => stopped.promise,
        async reconcile(repairSignal) {
          const [result, mailRetained] = await Promise.all([
            reconcile(node, roles, survivors, {...fault, signal: repairSignal ?? limit}),
            measureCheck(failures, repairSignal ?? limit, 'services.stop_inbox', () => checkInbox?.(repairSignal ?? limit)),
          ]);
          return {...result, ...(mailRetained && {mailRetained})};
        },
        ready() {
          stopping = Promise.resolve().then(() => stopNode(node, {measured: true, afterRestart: options => restore(node, options),
            async whileStopped(details) {
              fault = details;
              assert.equal(fault.holdMs, holdMs, 'services.stop_hold');
              stopped.resolve(fault.stoppedAt);
              const expire = () => leg.abort(fault.signal.reason);
              fault.signal?.addEventListener('abort', expire, {once: true});
              try {return await observation;}
              finally {
                fault.signal?.removeEventListener('abort', expire);
                await snapshot('hold', fault.signal);
              }
            }}));
          stopping.catch(stopped.reject);
        }});
      try {
        const observed = await observation;
        if (failures) failures.push(...(observed.failures ?? []));
      }
      catch (error) {
        leg.abort(error);
        await stopping?.catch(() => {});
        throw error;
      }
      const receipt = await stopping;
      assert.ok(receipt?.stopped === node && receipt.offMs >= holdMs, 'services.stop_missing:' + node);
      const {signup, backup} = receipt.recovery;
      const {primary, publication, outsideStore, flux} = receipt.reconciliation ?? {};
      await check('mail_worker', () => assert.ok(survivors.includes(signup.result?.worker), 'services.stop_mail_worker'));
      await check('backup_worker', () => assert.ok(backup.result?.controllerScope && backup.result.attemptId && backup.result.retained, 'services.stop_backup_worker'));
      await check('service_recovery', () => assert.ok(survivors.includes(primary) && outsideStore && flux?.appliedRevision, 'services.stop_service_recovery'));
      if (roles.primary === node) {
        await check('publication', () => assert.ok(publication?.worker && Number.isFinite(publication.completedMs), 'services.stop_publication'));
      }
      for (const role of uncovered) if (roles[role] === node) uncovered.delete(role);
      const rejoin = await healthy(node, signal);
      await snapshot('rejoined');
      await check('signed_reservations_after', () => checkReservations?.());
      legs.push({...receipt, roles, rejoin, ...(failures && {failures}), ...(sessionBeforeStop && {sessionBeforeStop})});
    });
    if (remaining.length && spaceSignup) {
      await spaceSignup(signal);
      signal?.throwIfAborted();
    }
  }
  for (const role of uncovered) await measureCheck(legs.at(-1).failures, signal, 'services.stop_role:' + role,
    () => assert.fail('services.stop_role:' + role));
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

export function readOutsideStore({host, port = 9000, ca, signal}) {
  return new Promise((resolve, reject) => {
    const request = get({host, port, ca, signal, servername: servicesStoreHost, agent: false,
      path: '/minio/health/cluster'}, response => {
      response.resume();
      resolve(response.statusCode);
    });
    request.once('error', reject);
    request.setTimeout(3000, () => request.destroy(Object.assign(Error('services.store_connection_timeout'), {code: 'ETIMEDOUT'})));
  });
}

export async function measureServiceRestart({restartAll, inventory, probes, checkStore, storeOutage, restore, prepare,
  inspectionReady, signal, recordFailures = false, recordEvidence, bindEvidenceKube}) {
  const failures = recordFailures ? [] : undefined;
  if (failures) recordEvidence?.('restart', failures);
  const check = (name, work) => measureCheck(failures, signal, 'services.cold_' + name, work);
  const healthy = limit => Promise.all([probes.session(limit), probes.remote(limit), checkStore(limit)]);
  await check('services_before', () => untilRemote(async limit => {await healthy(limit); return true;}, 30_000, signal, 'cold_services_before'));
  const witness = await prepare?.();
  // Placement is diagnostic because this stop targets every machine.
  let reason;
  const roles = await inventory(signal).catch(error => {
    const cause = error?.cause;
    const commandError = cause?.cause;
    reason = cause?.code ?? commandError?.code ?? commandError?.signal ?? cause?.name;
  });
  signal.throwIfAborted();
  process.stderr.write('D621 all-machine stop inventory ' +
    JSON.stringify(roles ? {roles} : {unavailable: 'remote.stop_role_inventory', reason}) + '\n');
  const checkInbox = await check('inbox_before', () => probes.inboxWitness?.(signal));
  const sessionBeforeStop = await check('session_activity', () => probes.sessionActivity?.(signal));
  const outage = snapshot => async ({signal, confirmStopped}) => {
    await confirmStopped(signal);
    const endpoints = Object.entries({...probes.outage, store: storeOutage});
    const observed = await Promise.allSettled(endpoints.map(([name, request]) => check('outage:' + name, async () => {
      let failure;
      await assert.rejects(() => request(signal), error => {
        signal.throwIfAborted();
        const code = error.code === 'ABORT_ERR' && error.cause?.name === 'TimeoutError' ?
          'ETIMEDOUT' : error.code ?? error.cause?.code;
        failure = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code) ?
          code : /^integration\.(?:api_timeout|remote_probe_timeout)$/.test(error.message) ? error.message : undefined;
        assert.ok(failure !== undefined, 'services.cold_transport:' + name + ': ' + error.message);
        return true;
      }, 'services.cold_transport:' + name);
      return [name, failure];
    })));
    const failed = observed.find(row => row.status === 'rejected');
    if (failed) throw failed.reason;
    await confirmStopped(signal);
    await snapshot('hold', signal);
    return Object.fromEntries(observed.map(row => row.value).filter(Boolean));
  };
  const api = await monitorStockholmDatabase({bindKube: bindEvidenceKube, signal, stage: 'restart'}, async snapshot => {
    const result = await restartAll(outage(snapshot));
    await snapshot('rejoined');
    return result;
  });
  const data = await restore(witness);
  const mailRetained = await check('inbox_after', () => checkInbox?.(signal));
  const clientDeadline = AbortSignal.any([signal, AbortSignal.timeout(300_000)]);
  const started = performance.now();
  const checked = await check('services_after', () => untilRemote(healthy, 300_000, clientDeadline, 'cold_services_after'));
  const sessionAfterRestart = checked?.[0];
  const canInspect = await check('inspection_ready', () => untilRemote(inspectionReady, 300_000, clientDeadline, 'cold_inspection_ready'));
  const backup = canInspect ? await check('backup', () => probes.backupAfterRestart(clientDeadline)) : undefined;
  if (failures) {
    if (!canInspect) failures.push({check: 'services.cold_backup_blocked', count: 1});
    failures.push(...(backup?.failures ?? []));
  }
  return {...api, ...data, roles, backup, ...(failures && {failures}), ...(mailRetained && {mailRetained}),
    ...(sessionBeforeStop && {sessionBeforeStop}), ...(sessionAfterRestart && {sessionAfterRestart}),
    clientRecoveryMs: Math.round(performance.now() - started)};
}

export async function repairReturningStore({name, nodes, kindOutside, store, run, repair, signal,
  read = storeMetrics, heal = healRejoinedStore}) {
  const index = nodes.findIndex(node => node.name === name), node = nodes[index], ordinal = index * 2;
  const drives = await waitForStoreDrives(limit => read(node.ip, store, limit),
    ['store-' + ordinal, 'store-' + (ordinal + 1)], repair);
  const storeRepairAttempts = await heal({node, account: store, run, signal: repair});
  if (kindOutside) {
    try {
      const sample = await read(kindOutside.ip, store, signal);
      const count = sample.split('\n').find(line => line.startsWith('minio_cluster_health_erasure_set_online_drives{'));
      process.stderr.write(`Store WireGuard sample on ${name}: ${count ?? 'no drive count'}\n`);
    } catch (error) {
      process.stderr.write(`Store WireGuard sample on ${name} failed: ${error.message}\n`);
      signal.throwIfAborted();
      try {process.stderr.write(await kindOutside.describeStorePath(node, signal) + '\n');}
      catch (error) {process.stderr.write(error.message + '\n');}
      signal.throwIfAborted();
    }
  }
  return {drives, storeRepairedOn: name, storeRepairAttempts};
}

export async function runKubernetesServices(context) {
  const {cluster, nodes, run, image, waitronImage, verificationTarget, env, kubeconfig, kubeTarget, signal,
    remote, stopGatewayNode, stopServiceNodes, stopNode, stopSignal = signal, restartAll, prepareOutside, baseline, amazon, importVerifierImage,
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
      context = {...context, nodes: nodes.map((node, index) => ({...node, ip: meshNodeAddress(index)})),
        ...(!amazon && {storeBridgeAddresses: nodes.map(node => node.ip)})};
    }
    process.stderr.write('Preparing the three PostgreSQL copies and Cloud schema\n');
    await installServicesDatabase(context, tag);
    return await withStockholmStorageIdentity(context, async (store, custody) => {
      const settings = await configureServices(context, kube, store, custody);
      const {ca, mailAuthorization, config, signupRequestsPerHour} = settings;
      const outsideMailPort = baseline ? await outside.startInbox(settings.mailFiles) : undefined;
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
      const emailPods = baseline ? (await readyServices(signal, 'email')).map(row => row.metadata.name) : ['cloud-services'];
      assert.equal(emailPods.length, baseline ? nodes.length : 1, 'services.smtp_workers');
      for (const email of emailPods) await exec(email, 'email', ['node', '--input-type=module', '-e', smtpRefusals]);
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
      }, expected.length === 3 ? databaseRejoinMs : 90_000, limit, 'one_writable_primary');
      const outsideStore = signal => run('curl', ['-fsS', '--max-time', '3', '--cacert', store.caPath, '--resolve',
        servicesStoreHost + ':9000:' + remoteTarget.gatewayIp,
        'https://' + servicesStoreHost + ':9000/minio/health/cluster'], {signal});
      const result = await runTestCloudClients({image, waitronImage, verificationTarget, ...mode, kubernetes: {
        cluster, network: cluster, namespace: servicesNamespace, account: 'kube-account',
        proxyIp: baseline ? remoteTarget.gatewayIp : context.nodes[0].ip, port: ports[3443], mailPort: outsideMailPort ?? ports[8025], ca, mailAuthorization, storeCa: store.ca,
        stockholmRemote: remoteTarget, verifier, verifierImage: context.verifierImage, amazon, signal, signupRequestsPerHour,
        ...(restartAll && {restartServices: probes => measureServiceRestart({
          restartAll, inventory, probes, checkStore: outsideStore, signal, recordFailures: amazon?.measuredStops === true,
          recordEvidence: context.recordEvidence, bindEvidenceKube: context.bindEvidenceKube,
          async inspectionReady(limit) {return (await readyServices(limit, 'inspect')).length > 0;},
          storeOutage: signal => readOutsideStore({host: remoteTarget.gatewayIp, ca: store.ca, signal}),
          prepare: () => prepareDatabaseWitness({kube: context.kube, signal,
            initialReadiness: {ms: databaseRejoinMs, signal: stopSignal}}),
          async restore(witness) {
            const started = performance.now();
            const limit = AbortSignal.any([signal, AbortSignal.timeout(240_000)]);
            for (const name of names) await outside.restoreNode?.(name, {signal: limit});
            const [database] = await Promise.all([witness(),
              writablePrimary(names, limit), waitForStore({nodes: names, kube: context.kube, signal: limit})]);
            return {...database, dataRecoveryMs: Math.round(performance.now() - started)};
          },
        })}),
        ...(stopServiceNodes && {stopServices: (probes, spaceSignup) => measureServiceStops({nodes: names, inventory, signal: stopSignal, probes, holdMs,
          spaceSignup, recordFailures: amazon?.measuredStops === true, requireSignedUpload: process.env.TEST_CLOUD_INTEGRATION_REQUIRE_SIGNED_UPLOAD === '1',
          recordEvidence: context.recordEvidence, bindEvidenceKube: context.bindEvidenceKube,
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
            const kindOutside = !amazon && {ip: context.nodes.find(node => node.name === name).ip,
              describeStorePath: outside.describeStorePath};
            return {primary, ...await repairReturningStore({name, nodes, kindOutside, store, run, repair, signal})};
          },
          reconcile: (node, roles, survivors, fault) => measureServiceRecovery({
            node, roles, survivors, fault, writablePrimary, proveGit: outside.proveSurviving, publication: probes.publication,
            outsideStoreReady: signal => untilRemote(async limit => {
              await outsideStore(limit);
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
    const mailLog = await outside?.inboxLogs?.()?.catch(() => '');
    if (mailLog) process.stderr.write('outside Mailpit\n' + mailLog + '\n');
    for (const [pod, containers] of [
      ['cloud-services', ['account', 'email', 'proxy', 'monitor', 'usage', 'probe', baseline ? 'inspect' : 'mailpit']],
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
