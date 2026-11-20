import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import test from 'node:test';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {execFileSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareKindOutsideBaseline} from './kubernetes-outside.mjs';
import {withStockholmStorageIdentity} from './kubernetes-storage-identity.mjs';
import {runKubernetesCheck} from './kubernetes-check.mjs';

import * as servicesScript from './kubernetes-services.mjs';
const {installServicesDatabase, servicesCredentialFiles, servicesStorageSettings} = servicesScript;

test('measured stops cover all three machines and the live roles before returning a receipt', async () => {
  const nodes = ['a', 'b', 'c'], changes = [];
  const run = (role, publication, overrides = {}) => {
    let healthy = true;
    return servicesScript.measureServiceStops({nodes, holdMs: 360_000,
      inventory: async () => {
        assert.ok(healthy, 'inventory must follow a healthy rejoin');
        return {primary: 'b', gateway: 'a', operator: role, fluxSource: 'c', fluxApply: 'c'};
      },
      stopNode: async (node, {whileStopped, afterRestart, measured}) => {
        assert.ok(measured);
        healthy = false;
        changes.push('off:' + node);
        const result = await whileStopped({started: 1000, stoppedAt: 2000, holdMs: 360_000});
        await afterRestart();
        return {...result, stopped: node, offMs: 360_000};
      },
      restore: async node => {changes.push('return:' + node);},
      healthy: async node => {healthy = true; return {storeRepairedOn: node};},
      observe: async ({ready, stopped, replacement, reconcile, holdMs}) => {
        assert.equal(holdMs, 360_000);
        ready(); assert.equal(await stopped(), 2000); await replacement();
        return {recovery: {signup: {result: {worker: overrides.mail ?? 'surviving-mail'}},
          backup: {result: {controllerScope: 'verifier', attemptId: 'attempt', retained: overrides.retained ?? true}}},
          reconciliation: await reconcile()};
      },
      reconcile: async (_node, _before, survivors) => ({primary: survivors[0], outsideStore: true,
        publication, flux: {appliedRevision: 'a'.repeat(40)}}),
      ...overrides.context,
    });
  };
  const legs = await run('b', {worker: 'publication', completedMs: 1200});
  assert.deepEqual(legs.map(row => row.stopped), ['b', 'c', 'a']);
  assert.deepEqual(changes, ['off:b', 'return:b', 'off:c', 'return:c', 'off:a', 'return:a']);
  assert.equal(legs[0].roles.primary, 'b');
  assert.equal(legs[0].rejoin.storeRepairedOn, 'b');
  await assert.rejects(async () => run('other', {worker: 'publication', completedMs: 1200}), /services\.stop_role:operator/);
  await assert.rejects(async () => run('b', undefined), /services\.stop_publication/);
  const publication = {worker: 'publication', completedMs: 1200};
  await assert.rejects(run('b', publication, {mail: ''}), /services\.stop_mail_worker/);
  await assert.rejects(run('b', publication, {retained: false}), /services\.stop_backup_worker/);
  await assert.rejects(run('b', publication, {context: {nodes: ['a', 'b']}}), /services\.stop_three_nodes/);
  let request;
  await assert.rejects(run('b', publication, {context: {async observe({ready, stopped, signal}) {
    request = signal;
    ready();
    await stopped();
    throw Error('synthetic probe failed during stop');
  }}}), /synthetic probe failed during stop/);
  assert.equal(request.aborted, true);
});

test('the full restart requires healthy routes, fresh transport failures and recovery before restoring a backup', async () => {
  for (const routeStillResponding of [undefined, 'public', 'bad certificate']) {
    const seen = [], signal = new AbortController().signal;
    const down = label => async () => {
      seen.push(label);
      if (routeStillResponding === label) return {status: 503};
      if (routeStillResponding === 'bad certificate') throw Object.assign(Error('TLS'), {code: 'CERT_HAS_EXPIRED'});
      throw Object.assign(Error('unreachable'), {code: 'ECONNREFUSED'});
    };
    const run = servicesScript.measureServiceRestart({
      signal, checkStore: async () => {seen.push('store');},
      storeOutage: down('store outage'),
      restore: async () => {seen.push('data restored'); return {primary: 'original-copy'};},
      probes: {
        session: async () => {seen.push('account');}, remote: async () => {seen.push('routes');},
        outage: {account: down('account outage'), staff: down('staff'), public: down('public')},
        backupAfterRestart: async () => {seen.push('backup'); return {retainedPointId: 'original', pointId: 'new'};},
      },
      async restartAll(outage) {
        seen.push('stopped');
        const result = await outage({signal, confirmStopped: async () => {seen.push('confirmed');}});
        seen.push('restarted');
        return {outage: result, recoveryMs: 100};
      },
    });
    if (routeStillResponding) {
      await assert.rejects(run, /services.cold_transport/);
      assert.ok(!seen.includes('restarted'));
    } else {
      const result = await run;
      assert.deepEqual(result.outage, {account: 'ECONNREFUSED', staff: 'ECONNREFUSED', public: 'ECONNREFUSED', store: 'ECONNREFUSED'});
      assert.deepEqual(seen, ['account', 'routes', 'store', 'stopped', 'confirmed', 'account outage', 'staff', 'public',
        'store outage', 'confirmed', 'restarted', 'data restored', 'account', 'routes', 'store', 'backup']);
      assert.equal(result.primary, 'original-copy');
      assert.equal(result.backup.pointId, 'new');
    }
  }
});

test('the outside store probe reports a closed connection before TLS can start', async t => {
  const listener = createServer(socket => socket.destroy());
  listener.listen(0, '127.0.0.1');
  t.after(() => listener.close());
  await once(listener, 'listening');
  await assert.rejects(async () => servicesScript.readOutsideStore({
    host: '127.0.0.1', port: listener.address().port, signal: t.signal,
  }), {code: 'ECONNRESET'});
});

test('Git recovery starts while the database is moving and finishes before measuring a stable publication worker', async () => {
  const database = Promise.withResolvers(), git = Promise.withResolvers();
  let gitStarted = false, publicationStarted = false;
  const started = performance.now();
  const recovery = servicesScript.measureServiceRecovery({
    node: 'a', roles: {primary: 'a'}, survivors: ['b', 'c'], fault: {started},
    writablePrimary: () => database.promise, outsideStoreReady: async () => true,
    async proveGit() {gitStarted = true; return git.promise;},
    async publication() {publicationStarted = true; return {worker: 'survivor'};},
  });
  const ranWhileDatabaseMoved = gitStarted;
  database.resolve('b');
  await new Promise(setImmediate);
  const ranBeforeGitFinished = publicationStarted;
  git.resolve({appliedRevision: 'a'.repeat(40)});
  const result = await recovery;
  assert.equal(ranWhileDatabaseMoved, true);
  assert.equal(ranBeforeGitFinished, false);
  assert.equal(result.primary, 'b');
  assert.deepEqual(result.publication, {worker: 'survivor'});
});

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

test('the prepared database runs migrations without reinstalling the database', async () => {
  const applied = [];
  await installServicesDatabase({
    databasePrepared: true, nodes: [],
    run: () => assert.fail('must keep the prepared PostgreSQL copies'),
    installDatabase: () => assert.fail('must keep the installed database'),
    kube: async args => {applied.push(args[2]);},
  }, 'owned:cloud');
  assert.deepEqual(applied, ['create', 'wait']);
});

test('the approved issuer is ready before the prepared store is installed with OpenID', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'service-identity-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const calls = [];
  const result = await withStockholmStorageIdentity({
    directory, signal: AbortSignal.timeout(5000),
    run: async (binary, args) => {
      if (binary === 'docker' && args[0] === 'image') return '';
      assert.equal(binary, 'openssl', 'only the prepared store installer may start the store');
      execFileSync(binary, args, {stdio: 'ignore'});
    },
    kube: async (args, {input} = {}) => {
      if (args.includes('rollout')) {calls.push('issuer ready'); return;}
      if (args.includes('get')) return '{"items":[]}';
      calls.push(...JSON.parse(input).items.map(item => item.kind));
    },
    async installStore(openId) {
      calls.push('store install');
      assert.match(openId.configUrl, /^https:\/\/storage-identity\./);
      assert.match(openId.ca, /BEGIN CERTIFICATE/);
      return {ca: 'synthetic store certificate'};
    },
  }, async store => {calls.push('services'); return store.ca;});
  assert.deepEqual(calls.slice(-3), ['issuer ready', 'store install', 'services']);
  assert.equal(result, 'synthetic store certificate');
});

test('the Kind baseline keeps a cached controller image and removes the image it pulled', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'service-controller-images-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const key = 'A'.repeat(43) + '=';
  const imageNames = {kept: 'ghcr.io/fluxcd/source-controller', fresh: 'ghcr.io/fluxcd/kustomize-controller'};
  const actions = [], resumed = [];
  let pid = 123;
  const outside = await prepareKindOutsideBaseline({directory, cluster: 'owned',
    nodes: [1, 2, 3].map(n => ({name: 'node-' + n, ip: '192.0.2.' + n, id: String(n)})),
    prepareBundle: async () => join(directory, 'synthetic-flux.json'),
    run: async (binary, args) => {
      if (binary === 'wg') return key;
      if (binary === 'nsenter') resumed.push(args);
      if (binary !== 'docker') return '';
      if (args[0] === 'inspect') return String(pid);
      const image = args.at(-1).split('@')[0];
      if (args[0] === 'image' && args[1] === 'inspect' && image === imageNames.fresh) throw Error('No such image: ' + args.at(-1));
      if (args[0] === 'pull' || args[1] === 'rm') actions.push([args[0], image]);
      return '';
    }});
  const beforeRestart = resumed.length;
  assert.equal(typeof outside.restoreNode, 'function');
  pid = 456;
  await outside.restoreNode('node-2');
  assert.equal(resumed.length, beforeRestart + 1);
  assert.deepEqual(resumed.at(-1), ['-t', '456', '-n', 'wg-quick', 'up', join(directory, 'mesh-node-1', 'wg0.conf')]);
  await outside.close();
  assert.deepEqual(actions, [['image', 'owned:source-controller'], ['pull', imageNames.fresh],
    ['image', 'owned:kustomize-controller'], ['image', imageNames.fresh]]);
});

test('the Kind baseline does not pull over a failed image inventory query', async () => {
  const failure = Error('Docker daemon disconnected');
  const commands = [];
  await assert.rejects(prepareKindOutsideBaseline({cluster: 'owned', directory: '/unused',
    nodes: [{name: 'node-a'}], prepareBundle: async () => 'synthetic-flux.json',
    run: async (binary, args) => {
      commands.push([binary, ...args.slice(0, 2)]);
      throw failure;
    }}), error => error === failure);
  assert.deepEqual(commands, [['docker', 'image', 'inspect']]);
});

test('the outside rehearsal routes internal storage requests to the local store copies', async () => {
  assert.equal(typeof servicesScript.configureServices, 'function');
  const configured = Error('storage route captured');
  await assert.rejects(servicesScript.configureServices({
    baseline: true,
    async kube(args) {
      assert.deepEqual(args.slice(0, -1), ['-n', 'd621-store', 'patch', 'service', 's3', '--type=merge', '-p']);
      assert.deepEqual(JSON.parse(args.at(-1)), {spec: {internalTrafficPolicy: 'Local'}});
      throw configured;
    },
  }), error => error === configured);
});

test('a surviving inbox stays readable while another service container restarts', () => {
  assert.equal(typeof servicesScript.readyServicePods, 'function');
  const pod = (name, readiness, containers) => ({
    metadata: {name: 'service-' + name}, spec: {nodeName: name},
    status: {conditions: [{type: 'Ready', status: readiness ? 'True' : 'False'}],
      containerStatuses: containers.map(([name, ready]) => ({name, ready}))},
  });
  const rows = [
    pod('a', true, [['account', true], ['mailpit', true], ['email', true]]),
    pod('b', false, [['account', true], ['mailpit', true], ['email', false]]),
    pod('c', false, [['account', true], ['mailpit', false], ['email', true]]),
  ];
  assert.deepEqual(servicesScript.readyServicePods(rows, {stopped: 'a', containers: ['account', 'mailpit']})
    .map(row => row.metadata.name), ['service-b']);
  assert.deepEqual(servicesScript.readyServicePods(rows, {}).map(row => row.metadata.name), ['service-a']);
});

test('a mail list combines surviving inboxes and finds a message outside the first one', async () => {
  assert.equal(typeof servicesScript.readServicesInbox, 'function');
  const fetch = async (pod, path) => {
    if (pod === 'unreachable') throw Error('node stopped');
    if (path === 'messages') return {status: 200, text: JSON.stringify({messages: [{ID: pod}]})};
    return pod === 'on-c' && path === 'message/on-c' ? {status: 200, text: '{"ID":"on-c"}'} : {status: 404, text: 'not found'};
  };
  const inbox = (path, auth) => servicesScript.readServicesInbox(['unreachable', 'on-b', 'on-c'], fetch, path, auth);
  assert.deepEqual(await (await inbox('messages', 'synthetic')).json(), {messages: [{ID: 'on-b'}, {ID: 'on-c'}]});
  const message = await inbox('message/on-c', 'synthetic');
  assert.deepEqual(await message.json(), {ID: 'on-c'});
  assert.equal(message.headers.get('x-rehearsal-mail-worker'), 'on-c');
  assert.equal((await inbox('message/absent', 'synthetic')).status, 404);
});

test('the unauthenticated check needs a reply from every listed inbox', async () => {
  const failure = Error('inbox could not be reached');
  await assert.rejects(servicesScript.readServicesInbox(['protected', 'unavailable'], async pod => {
    if (pod === 'unavailable') throw failure;
    return {status: 401, text: 'unauthorized'};
  }, 'messages', ''), error => error.cause === failure);
});

test('an unprotected surviving inbox cannot hide behind other inboxes that reject the request', async () => {
  assert.equal(typeof servicesScript.readServicesInbox, 'function');
  const response = await servicesScript.readServicesInbox(['protected', 'open'], async pod =>
    pod === 'protected' ? {status: 401, text: 'unauthorized'} : {status: 200, text: '{"messages":[]}'}, 'messages', '');
  assert.equal(response.status, 200, 'the caller must see that a surviving inbox accepted the unauthenticated request');
});

test('failure diagnostics retain only database SQLSTATEs from error records', () => {
  const {servicesDatabaseErrorCodes} = servicesScript;
  assert.equal(typeof servicesDatabaseErrorCodes, 'function');
  const row = (severity, code) => JSON.stringify({record: {error_severity: severity, sql_state_code: code, message: 'private query'}});
  assert.deepEqual(servicesDatabaseErrorCodes([row('ERROR', '40P01'), row('LOG', '08006'),
    row('ERROR', 'private'), 'not JSON', row('FATAL', '08006'), row('ERROR', '40P01')].join('\n')), ['08006', '40P01']);
});

test('outside baseline validates its Cloud image before creating a Kind cell', () => {
  const env = {...process.env, TEST_CLOUD_INTEGRATION_IMAGE: 'cloud:latest'};
  assert.throws(() => execFileSync(process.execPath, ['scripts/kubernetes-check.mjs', '--outside-baseline'],
    {env, stdio: 'pipe'}), error => {
    assert.match(String(error.stderr), /baseline\.cloud_image_id/);
    return true;
  });
});

test('one outside Linux venue signs in, pairs, reaches both HTTPS routes and restores its encrypted backup', {
  skip: process.env.TEST_KUBERNETES_OUTSIDE_BASELINE !== '1', timeout: 48 * 60 * 1000,
}, async () => {
  assert.equal(process.platform, 'linux');
  const stopServiceNodes = process.env.TEST_KUBERNETES_OUTSIDE_SERVICE_STOPS === '1';
  const {services, nodes} = await runKubernetesCheck('kind-baseline', {stopServiceNodes});
  if (stopServiceNodes) {
    const legs = services.serviceStops;
    assert.deepEqual(legs.map(leg => leg.stopped).sort(), nodes.map(node => node.name).sort());
    assert.equal(services.remote.sameTunnel, true);
    for (const leg of legs) {
      assert.ok(leg.offMs >= 360_000);
      for (const probe of ['session', 'remote', 'login', 'signup', 'backup']) {
        assert.ok(leg.recovery[probe].withinMs <= (probe === 'backup' ? 300_000 : 90_000));
        assert.ok(Number.isFinite(leg.recovery[probe].longestGapMs));
      }
      assert.ok(leg.recovery.signup.result.worker);
      assert.equal(leg.recovery.backup.result.retained, true);
      assert.notEqual(leg.recovery.backup.result.attemptId, services.backup.workerVerification.attemptId);
      assert.equal(leg.reconciliation.outsideStore, true);
      assert.match(leg.reconciliation.flux.appliedRevision, /^[a-f0-9]{40}$/);
      assert.equal(leg.rejoin.storeRepairedOn, leg.stopped);
      assert.ok(Number.isInteger(leg.rejoin.storeRepairAttempts) && leg.rejoin.storeRepairAttempts > 0);
      if (leg.roles.primary === leg.stopped) assert.ok(leg.reconciliation.publication.worker.uid);
    }
    assert.deepEqual(Object.keys(services.coldRestart.outage).sort(), ['account', 'public', 'staff', 'store']);
    assert.match(services.coldRestart.primary, /^cloud-db-\d+$/);
    const {retainedPointId, pointId, status, childAbsent} = services.coldRestart.backup;
    assert.ok(retainedPointId && pointId && retainedPointId !== pointId);
    assert.equal(status, 'passed');
    assert.equal(childAbsent, true);
    console.log('D621 cold restart receipt ' + JSON.stringify(services.coldRestart));
    console.log('D621 measured stop receipt ' + JSON.stringify(legs.map(({samples, ...leg}) => ({...leg, probes: samples.length}))));
  }
  assert.equal(services.signup, true);
  assert.equal(services.signIn, true);
  assert.equal(services.pairing.persistedRenewal, true);
  assert.equal(services.remote.staffHttps, true);
  assert.equal(services.remote.publicHttps, true);
  assert.equal(services.remote.peerTraffic, true);
  assert.match(services.flux, /^[a-f0-9]{40}$/);
  assert.equal(services.remote.venueId, services.pairing.venueId);
  assert.equal(services.backup.venueId, services.pairing.venueId);
  assert.equal(services.backup.independentStoredDigest, true);
  assert.equal(services.backup.workerVerification.status, 'passed');
  assert.equal(services.alteredPublicationRefused, true);
  assert.equal(services.inboxRequiresAuthentication, true);
  assert.equal(services.smtpRefusals, true);
  assert.equal(services.operationsReady, true);
  assert.equal(services.verifierScratchBytes, 1024 ** 3);
  assert.deepEqual(services.cleanup.remaining, []);
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
