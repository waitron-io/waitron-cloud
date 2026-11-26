import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import test from 'node:test';
import {once} from 'node:events';
import {get} from 'node:https';
import {createServer} from 'node:net';
import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareKindOutsideBaseline} from './kubernetes-outside.mjs';
import {withStockholmStorageIdentity} from './kubernetes-storage-identity.mjs';
import {loadVerifierImage, runKubernetesCheck} from './kubernetes-check.mjs';
import {runKubernetesNodeLoss} from './kubernetes-node-loss.mjs';
import {readRehearsalVerificationTarget} from '../deploy/test-cloud/test-fixtures/integration-verification-target.mjs';
import {servicesNamespace} from '../deploy/kubernetes/services.mjs';

import * as servicesScript from './kubernetes-services.mjs';
const {installServicesDatabase, servicesCredentialFiles, servicesStorageSettings} = servicesScript;

test('Stockholm records a writer sample gap and selects a controller again on the next read', async () => {
  let selections = 0;
  const sql = 'SELECT pg_postmaster_start_time()';
  const pod = {metadata: {name: 'cloud-db-2', uid: 'synthetic-uid'}, spec: {nodeName: 'node-b'},
    status: {containerStatuses: [{name: 'postgres', restartCount: 2, lastState: {terminated: {reason: 'Error'}}}]}};
  const bindKube = async () => {
    if (++selections === 1) throw Object.assign(Error('controller offline'), {code: 'ETIMEDOUT'});
    return async args => {
      if (args.includes('cluster')) return JSON.stringify({status: {currentPrimary: 'cloud-db-2'}});
      if (args.includes('get')) return JSON.stringify(pod);
      assert.deepEqual(args, ['-n', servicesNamespace, 'exec', 'cloud-db-2', '-c', 'postgres', '--', 'psql', '-U', 'postgres', '-Atqc', sql]);
      return '2026-11-26 20:00:00.123456+00';
    };
  };
  const signal = new AbortController().signal;
  const {at: gapAt, ...gap} = await servicesScript.readStockholmWriter(bindKube, signal);
  const {at: sampleAt, ...sample} = await servicesScript.readStockholmWriter(bindKube, signal);
  assert.ok(Number.isFinite(Date.parse(gapAt)) && Number.isFinite(Date.parse(sampleAt)));
  assert.deepEqual(gap, {gap: 'ETIMEDOUT'});
  assert.deepEqual(sample, {pod: 'cloud-db-2', uid: 'synthetic-uid', node: 'node-b', restartCount: 2,
    lastExitReason: 'Error', postmasterStart: '2026-11-26 20:00:00.123456+00'});
});

test('Stockholm diagnostics keep the previous database shutdown code and omit log messages', async () => {
  const at = '2026-11-26T20:00:00Z';
  const signal = new AbortController().signal;
  const reads = [];
  const kube = async args => {
    reads.push(args);
    if (args.includes('events')) return JSON.stringify({items: [{lastTimestamp: at, reason: 'Killing',
      involvedObject: {namespace: servicesNamespace}, source: {component: 'kubelet'}, message: 'private event message'},
    {lastTimestamp: at, reason: 'NodeNotReady', involvedObject: {kind: 'Node'}, source: {component: 'kubelet'}}]});
    if (args.includes('cnpg-system')) return '{"level":"info","msg":"private-untimestamped-message"}';
    if (!args.includes('--previous')) return `${at} {"level":"info","msg":"private operator message"}`;
    return `${at} {"level":"error","record":{"sql_state_code":"57P01","message":"private PostgreSQL message","query":"SELECT private data"}}`;
  };
  const diagnostic = await servicesScript.readStockholmDiagnostics(async () => kube, signal);
  assert.equal(reads.length, 5);
  assert.deepEqual(diagnostic.postgresPrevious, [{at, level: 'error', sqlstate: '57P01'}]);
  assert.doesNotMatch(JSON.stringify(diagnostic), /private|SELECT/);
  assert.deepEqual(diagnostic.events, [{at, reason: 'Killing', component: 'kubelet'}, {at, reason: 'NodeNotReady', component: 'kubelet'}]);
});

test('Stockholm emits the first writer sample before the stop and snapshots at hold and rejoin', async t => {
  const {signal} = new AbortController();
  const log = t.mock.method(process.stderr, 'write', () => true);
  const bindKube = async () => async args => {
    if (args.includes('cluster')) return '{"status":{"currentPrimary":"cloud-db-1"}}';
    if (args.includes('pod')) return '{"metadata":{"uid":"one"},"spec":{"nodeName":"node-a"},"status":{}}';
    return args.includes('exec') ? '2026-11-26 20:00:00+00' : '{"items":[]}';
  };
  await servicesScript.monitorStockholmDatabase({bindKube, signal, stage: 'stop:node-a'}, async snapshot => {
    assert.match(log.mock.calls[0].arguments[0], /D621 database sample .*postmasterStart/);
    await snapshot('hold');
    await snapshot('rejoined');
  });
  assert.deepEqual(log.mock.calls.slice(1).map(({arguments: [line]}) => JSON.parse(line.slice(line.indexOf('{'))).point),
    ['hold', 'rejoined']);
});

test('only the outside account proxy identifies itself on session replies, including its own errors', async () => {
  const source = await readFile(new URL('../deploy/test-cloud/proxy.cfg', import.meta.url), 'utf8');
  const legacy = source.replace('bind :3000', 'bind :3443').replace('server account account:3000', 'server account 127.0.0.1:3000');
  const render = servicesScript.renderServicesProxy;
  assert.equal(render(source, false), legacy);
  const frontend = render(source, true).split('frontend account_https\n')[1].split('\nbackend account')[0];
  assert.match(frontend, /http-request set-var\(txn\.p1_session\) int\(1\) if \{ path -m str \/api\/account\/session \}/);
  assert.match(frontend, /http-after-response set-header X-Waitron-Test-Account-Node "\$\{TEST_CLOUD_ACCOUNT_NODE\}" if \{ var\(txn\.p1_session\) -m found \}/);
});

test('measured stops cover all three machines and the live roles before returning a receipt', async t => {
  const nodes = ['a', 'b', 'c'], changes = [];
  const run = (role, publication, overrides = {}) => {
    let healthy = true;
    return servicesScript.measureServiceStops({nodes, holdMs: 360_000,
      inventory: async () => {
        assert.ok(healthy, 'inventory must follow a healthy rejoin');
        overrides.stages?.push('inventory');
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
      healthy: async node => {
        healthy = true;
        overrides.stages?.push('healthy:' + node);
        return {storeRepairedOn: node};
      },
      observe: async ({ready, stopped, replacement, reconcile, holdMs}) => {
        overrides.stages?.push('observe');
        assert.equal(holdMs, 360_000);
        ready(); assert.equal(await stopped(), 2000); await replacement();
        const reconciliation = await reconcile();
        return {recovery: {signup: {result: {worker: overrides.mail ?? reconciliation.primary}},
          backup: {result: {controllerScope: 'verifier', attemptId: 'attempt', retained: overrides.retained ?? true}}},
          reconciliation};
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
  await assert.rejects(run('b', publication, {mail: 'b'}), /services\.stop_mail_worker/);
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

  await t.test('Stockholm retains failed checks across stops, after verifying each rejoin', async () => {
    changes.length = 0;
    const legs = await run('b', undefined, {mail: '', context: {recordFailures: true,
      probes: {async sessionActivity() {throw Error('session unavailable');}},
    }});
    assert.deepEqual(legs.map(leg => leg.stopped), ['b', 'c', 'a']);
    assert.deepEqual(changes, ['off:b', 'return:b', 'off:c', 'return:c', 'off:a', 'return:a']);
    assert.deepEqual(legs[0].rejoin, {storeRepairedOn: 'b'});
    assert.deepEqual(legs[0].failures.map(({check}) => check),
      ['services.stop_session_activity', 'services.stop_mail_worker', 'services.stop_publication']);
  });

  await t.test('Stockholm stops if a returning machine cannot be verified', async () => {
    changes.length = 0;
    await assert.rejects(run('b', publication, {mail: '', context: {recordFailures: true,
      async healthy() {throw Error('database did not rejoin');},
    }}), /database did not rejoin/);
    assert.deepEqual(changes, ['off:b', 'return:b']);
  });

  await t.test('Stockholm starts sampling before the observer clock and captures diagnostics after service rejoin', async t => {
    const stages = [];
    const log = t.mock.method(process.stderr, 'write', line => {
      if (line.startsWith('D621 database ')) {
        const {stage, point} = JSON.parse(line.slice(line.indexOf('{')));
        if (stage === 'stop:b') stages.push(point ?? 'sample');
      }
      return true;
    });
    await run('b', publication, {stages, context: {signal: new AbortController().signal, recordFailures: true,
      bindEvidenceKube: async () => {throw Object.assign(Error('offline'), {code: 'ETIMEDOUT'});},
    }});
    assert.ok(log.mock.callCount() > 0);
    assert.ok(stages.indexOf('sample') < stages.indexOf('observe'));
    assert.ok(stages.indexOf('hold') < stages.indexOf('healthy:b'));
    assert.ok(stages.indexOf('healthy:b') < stages.indexOf('rejoined'));
  });

  await t.test('the inbox witness is captured before each stop and read during it', async () => {
    changes.length = 0;
    const windows = [];
    await run('b', publication, {context: {probes: {async inboxWitness() {
      windows.push([...changes]);
      return async () => windows.push([...changes]);
    }}}});
    assert.deepEqual(windows, [[], ['off:b'], changes.slice(0, 2), changes.slice(0, 3),
      changes.slice(0, 4), changes.slice(0, 5)]);
  });

  await t.test('a single session activity request precedes each stop and its reply reaches the receipt', async () => {
    changes.length = 0;
    const stages = [], expiresAt = '2026-11-25T22:30:00.000Z';
    const reply = {status: 200, expiresAt};
    const legs = await run('b', publication, {stages, context: {probes: {async sessionActivity() {
      stages.push('activity');
      return reply;
    }}}});
    assert.deepEqual(stages, ['inventory', 'activity', 'observe', 'healthy:b', 'inventory', 'activity', 'observe', 'healthy:c',
      'inventory', 'activity', 'observe', 'healthy:a']);
    assert.deepEqual(legs.map(leg => leg.sessionBeforeStop), [reply, reply, reply]);
  });

  await t.test('signed reservation evidence brackets only the database primary stop', async () => {
    changes.length = 0;
    const windows = [];
    const legs = await run('c', publication, {context: {requireSignedUpload: true, probes: {async signedBackupReservations() {
      windows.push([...changes]);
      return async () => windows.push([...changes]);
    }}}});
    assert.equal(legs[0].stopped, 'c');
    assert.deepEqual(windows, [changes.slice(0, -2), changes]);
    assert.deepEqual(changes.slice(-2), ['off:b', 'return:b']);
    await assert.rejects(run('c', publication, {context: {requireSignedUpload: true, probes: {}}}),
      /services\.signed_backup_probe_missing/);
  });

  await t.test('signup spacing finishes after each rejoin and before the next inventory or observation', async () => {
    changes.length = 0;
    const stages = [], gap = Promise.withResolvers(), {signal} = new AbortController();
    const measured = run('b', publication, {stages, context: {signal, async spaceSignup(limit) {
      assert.equal(limit, signal);
      stages.push('spacing');
      await gap.promise;
    }}});
    await new Promise(setImmediate);
    const duringGap = {stages: [...stages], changes: [...changes]};
    gap.resolve();
    await measured;
    assert.deepEqual(duringGap, {stages: ['inventory', 'observe', 'healthy:b', 'spacing'],
      changes: ['off:b', 'return:b']});
    assert.deepEqual(stages, ['inventory', 'observe', 'healthy:b', 'spacing',
      'inventory', 'observe', 'healthy:c', 'spacing', 'inventory', 'observe', 'healthy:a']);
  });

  await t.test('an abort during signup spacing ends the rehearsal before the next stop', async () => {
    changes.length = 0;
    const stages = [], controller = new AbortController(), reason = Error('local rehearsal cancelled');
    await assert.rejects(run('b', publication, {stages, context: {signal: controller.signal,
      spaceSignup: async () => controller.abort(reason),
    }}), error => error === reason);
    assert.deepEqual(stages, ['inventory', 'observe', 'healthy:b']);
    assert.deepEqual(changes, ['off:b', 'return:b']);
  });
});

const coldRoles = {primary: 'b', gateway: 'a', operator: 'c', fluxSource: 'b', fluxApply: 'a'};
const coldSession = {status: 200, expiresAt: '2026-11-25T22:30:00.000Z'};
const lookupCommandError = fields => Object.assign(Error('synthetic command output'), fields);
const kindLookupError = fields => Error('inventory command failed', {cause: lookupCommandError(fields)});
for (const [name, routeStillResponding, placement, reason, recordFailures] of [
  ['the full restart requires healthy routes, fresh transport failures and recovery before restoring a backup'],
  ['the full restart rejects a responding public route', 'public'],
  ['the Stockholm full restart records a responding public route and still restores a backup', 'public', undefined, undefined, true],
  ['the full restart rejects an expired certificate as evidence of network loss', 'bad certificate'],
  ['the full restart reports unavailable placement and still stops', undefined,
    kindLookupError({code: 'EHOSTUNREACH'}), 'EHOSTUNREACH'],
  ['the full restart reports a killed Kind placement command', undefined,
    kindLookupError({code: null, signal: 'SIGKILL'}), 'SIGKILL'],
  ['the full restart reports a timed-out Stockholm placement command', undefined,
    lookupCommandError({code: 'ETIMEDOUT'}), 'ETIMEDOUT'],
  ['the full restart propagates cancellation during placement before stopping machines', undefined, 'cancelled'],
]) {
  test(name, async t => {
    const seen = [], controller = new AbortController(), {signal} = controller;
    const cancelled = Error('rehearsal cancelled');
    const log = t.mock.method(process.stderr, 'write');
    let inspectionChecks = 0;
    const down = label => async () => {
      seen.push(label);
      if (routeStillResponding === label) return {status: 503};
      if (routeStillResponding === 'bad certificate') throw Object.assign(Error('TLS'), {code: 'CERT_HAS_EXPIRED'});
      throw Object.assign(Error('unreachable'), {code: 'ECONNREFUSED'});
    };
    const run = servicesScript.measureServiceRestart({
      signal, recordFailures, checkStore: async () => {seen.push('store');},
      async inventory(limit) {
        assert.equal(limit, signal);
        if (placement === 'cancelled') controller.abort(cancelled);
        if (placement) throw Error('remote.stop_role_inventory', {cause: placement});
        return coldRoles;
      },
      storeOutage: down('store outage'),
      prepare: async () => () => {seen.push('retained row and new write'); return {primary: 'original-copy'};},
      restore: async verify => {seen.push('data restored'); return verify();},
      inspectionReady: async () => {
        seen.push('inspect');
        return ++inspectionChecks === 2;
      },
      probes: {
        sessionActivity: async () => {seen.push('activity'); return coldSession;},
        session: async () => {seen.push('account'); return coldSession;}, remote: async () => {seen.push('routes');},
        async inboxWitness() {
          seen.push('saved mail');
          return async () => {seen.push('read retained mail'); return true;};
        },
        outage: {account: down('account outage'), staff: down('staff'), public: down('public')},
        backupAfterRestart: async () => {
          assert.equal(inspectionChecks, 2, 'the backup requires a ready inspector');
          seen.push('backup');
          return {retainedPointId: 'original', pointId: 'new'};
        },
      },
      async restartAll(outage) {
        seen.push('stopped');
        if (placement !== 'cancelled') {
          const expected = placement ? {unavailable: 'remote.stop_role_inventory', reason} : {roles: coldRoles};
          assert.ok(log.mock.calls.some(({arguments: [line]}) =>
            line === 'D621 all-machine stop inventory ' + JSON.stringify(expected) + '\n'),
          'placement must be logged before the machines stop');
        }
        const result = await outage({signal, confirmStopped: async () => {seen.push('confirmed');}});
        seen.push('restarted');
        return {outage: result, recoveryMs: 100};
      },
    });
    if (placement === 'cancelled') {
      await assert.rejects(run, error => error === cancelled);
      assert.ok(!seen.includes('stopped'));
    } else if (recordFailures) {
      const result = await run;
      assert.deepEqual(result.failures.map(({check}) => check), ['services.cold_outage:public']);
      assert.equal(result.outage.public, undefined);
      assert.equal(result.outage.staff, 'ECONNREFUSED');
      assert.equal(result.backup.retainedPointId, 'original');
      assert.ok(seen.indexOf('restarted') < seen.indexOf('backup'));
    } else if (routeStillResponding) {
      await assert.rejects(run, /services.cold_transport/);
      assert.ok(!seen.includes('restarted'));
    } else {
      const result = await run;
      assert.deepEqual(result.outage, {account: 'ECONNREFUSED', staff: 'ECONNREFUSED', public: 'ECONNREFUSED', store: 'ECONNREFUSED'});
      assert.deepEqual(seen, ['account', 'routes', 'store', 'saved mail', 'activity', 'stopped', 'confirmed', 'account outage', 'staff', 'public',
        'store outage', 'confirmed', 'restarted', 'data restored', 'retained row and new write', 'read retained mail', 'account', 'routes', 'store',
        'inspect', 'inspect', 'backup']);
      assert.equal(result.primary, 'original-copy');
      assert.equal(result.backup.pointId, 'new');
      assert.deepEqual(result.sessionBeforeStop, coldSession);
      assert.deepEqual(result.sessionAfterRestart, coldSession);
      assert.deepEqual(result.roles, placement ? undefined : coldRoles);
    }
  });
}

test('the full restart refuses to stop when witness preparation fails', async () => {
  const failure = Error('cold_restart.initial_primary');
  let stopped = false;
  await assert.rejects(servicesScript.measureServiceRestart({
    signal: new AbortController().signal,
    probes: {session: async () => {}, remote: async () => {}}, checkStore: async () => {},
    inventory: async () => coldRoles,
    prepare: async () => {throw failure;},
    restartAll: async () => {stopped = true;},
  }), error => error === failure);
  assert.equal(stopped, false);
});

test('a silent outside account connection expires as transport loss', async t => {
  const sockets = new Set();
  const listener = createServer(socket => sockets.add(socket));
  listener.listen(0, '127.0.0.1');
  t.after(() => {for (const socket of sockets) socket.destroy(); listener.close();});
  await once(listener, 'listening');
  const lost = async () => {throw Object.assign(Error('unreachable'), {code: 'ECONNREFUSED'});};
  for (const parentExpires of [false, true]) {
    const parent = new AbortController(), {signal} = parent;
    const reason = new DOMException('parent deadline', 'TimeoutError');
    const run = servicesScript.measureServiceRestart({
      signal, inventory: async () => coldRoles, checkStore: async () => {}, storeOutage: lost,
      restore: async () => ({}), inspectionReady: async () => true,
      probes: {
        session: async () => {}, remote: async () => {}, backupAfterRestart: async () => ({}),
        outage: {staff: lost, public: lost, account: signal => new Promise((_, reject) => {
          const limit = AbortSignal.any([signal, AbortSignal.timeout(100)]);
          const request = get({host: '127.0.0.1', port: listener.address().port, agent: false, signal: limit});
          request.once('error', reject);
          if (parentExpires) parent.abort(reason);
        })},
      },
      async restartAll(outage) {return {outage: await outage({signal, confirmStopped: async () => {}})};},
    });
    if (parentExpires) await assert.rejects(run, error => error === reason);
    else assert.equal((await run).outage.account, 'ETIMEDOUT');
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
  let pid = 123, beforeRestart, systemdReads = 0;
  const outside = await prepareKindOutsideBaseline({directory, cluster: 'owned',
    nodes: [1, 2, 3].map(n => ({name: 'node-' + n, ip: '192.0.2.' + n, id: String(n)})),
    prepareBundle: async () => join(directory, 'synthetic-flux.json'),
    run: async (binary, args) => {
      if (binary === 'wg') return key;
      if (binary === 'nsenter') resumed.push(args);
      if (binary !== 'docker') return '';
      if (args[0] === 'inspect') return args.at(-1) === '2' ? String(pid) : '123';
      if (args[0] === 'exec' && args[1] === '2' && args[3] === '/proc/1/comm') {
        assert.equal(resumed.length, beforeRestart, 'WireGuard must wait for systemd');
        return systemdReads++ === 0 ? 'entrypoint' : 'systemd';
      }
      const image = args.at(-1).split('@')[0];
      if (args[0] === 'image' && args[1] === 'inspect' && image === imageNames.fresh) throw Error('No such image: ' + args.at(-1));
      if (args[0] === 'pull' || args[1] === 'rm') actions.push([args[0], image]);
      return '';
    }});
  beforeRestart = resumed.length;
  assert.equal(typeof outside.restoreNode, 'function');
  pid = 456;
  await outside.restoreNode('node-2');
  assert.equal(resumed.length, beforeRestart + 1);
  assert.deepEqual(resumed.at(-1), ['-t', '456', '-n', 'wg-quick', 'up', join(directory, 'mesh-node-1', 'wg0.conf')]);
  assert.equal(systemdReads, 2);
  await outside.describeStorePath({id: '2'}, AbortSignal.timeout(5000));
  assert.deepEqual(resumed.slice(-2), [['-t', '456', '-n', 'iptables', '-t', 'mangle', '-nvL', 'D618-OUTSIDE'],
    ['-t', '456', '-n', 'ip', 'route', 'get', '10.77.0.4']]);
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

for (const [target, describeStorePath, logText] of [
  ['Kind', async () => 'filter and route captured', /filter and route captured/],
  ['Kind with failed inspection', () => {throw Error('inspection failed');}, /inspection failed/],
  ['Amazon'],
]) {
  const repairIp = describeStorePath ? '172.30.250.3' : '10.77.0.2';
  test(`${target} returns both peer counts and repairs through ${repairIp}`, async t => {
    const log = t.mock.method(process.stderr, 'write', () => true);
    const events = [], signal = AbortSignal.timeout(5000);
    const nodes = [{name: 'node-a'}, {name: 'node-b', ip: repairIp}];
    const kindOutside = describeStorePath && {ip: '10.77.0.2', describeStorePath};
    const result = await servicesScript.repairReturningStore({name: 'node-b', nodes, kindOutside, signal, repair: signal,
      read: async ip => {
        const peer = events.push(ip) + 1;
        if (kindOutside && ip === kindOutside.ip) throw Error('synthetic timeout');
        return `minio_cluster_health_erasure_set_online_drives{pool="0",server="store-${peer}.store-peers.d621-store.svc.cluster.local:9000",set="0"} 6`;
      },
      heal: async ({node}) => {events.push('repair ' + node.ip); return 1;},
    });
    assert.deepEqual(result, {drives: 'store-2=6, store-3=6', storeRepairedOn: 'node-b', storeRepairAttempts: 1});
    assert.deepEqual(events, [repairIp, repairIp, 'repair ' + repairIp, ...(kindOutside ? [kindOutside.ip] : [])]);
    if (kindOutside) assert.match(log.mock.calls.map(call => call.arguments[0]).join(''), logText);
  });
}

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

test('a surviving account route stays ready while another service container restarts', () => {
  assert.equal(typeof servicesScript.readyServicePods, 'function');
  const pod = (name, readiness, containers) => ({
    metadata: {name: 'service-' + name}, spec: {nodeName: name},
    status: {conditions: [{type: 'Ready', status: readiness ? 'True' : 'False'}],
      containerStatuses: containers.map(([name, ready]) => ({name, ready}))},
  });
  const rows = [
    pod('a', true, [['account', true], ['proxy', true], ['email', true]]),
    pod('b', false, [['account', true], ['proxy', true], ['email', false]]),
    pod('c', false, [['account', true], ['proxy', false], ['email', true]]),
  ];
  assert.deepEqual(servicesScript.readyServicePods(rows, {stopped: 'a', containers: ['account', 'proxy']})
    .map(row => row.metadata.name), ['service-b']);
  assert.deepEqual(servicesScript.readyServicePods(rows, {}).map(row => row.metadata.name), ['service-a']);
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

const stopOutsideServiceNodes = process.env.TEST_KUBERNETES_OUTSIDE_SERVICE_STOPS === '1';
test('one outside Linux venue signs in, pairs, reaches both HTTPS routes and restores its encrypted backup', {
  skip: process.env.TEST_KUBERNETES_OUTSIDE_BASELINE !== '1', timeout: (stopOutsideServiceNodes ? 54 : 48) * 60 * 1000,
}, async () => {
  assert.equal(process.platform, 'linux');
  const {TEST_CLOUD_INTEGRATION_IMAGE: image, TEST_CLOUD_INTEGRATION_WAITRON_IMAGE: waitronImage,
    TEST_KUBERNETES_OUTSIDE_VERIFIER_IMAGE: verifierImage} = process.env;
  const {services, nodes} = verifierImage ? await runKubernetesNodeLoss({outsideServices: true,
    services: async context => {
      assert.notEqual(waitronImage, verifierImage);
      return servicesScript.runKubernetesServices({...context, baseline: true, image, waitronImage, verifierImage,
        verificationTarget: await readRehearsalVerificationTarget(), prepareOutside: prepareKindOutsideBaseline,
        stopServiceNodes: stopOutsideServiceNodes, restartAll: stopOutsideServiceNodes ? context.restartAll : undefined,
        importVerifierImage: (id, args) => {
          assert.equal(id, verifierImage, 'the verifier must load the saved image');
          return loadVerifierImage(id, [...context.kubeTarget(), '-n', servicesNamespace, ...args], context.env, context.signal);
        }});
    }}) : await runKubernetesCheck('kind-baseline', {stopServiceNodes: stopOutsideServiceNodes});
  if (stopOutsideServiceNodes) {
    const legs = services.serviceStops;
    assert.deepEqual(legs.map(leg => leg.stopped).sort(), nodes.map(node => node.name).sort());
    assert.equal(services.remote.sameTunnel, true);
    for (const leg of legs) {
      assert.ok(leg.offMs >= 360_000);
      assert.equal(leg.sessionBeforeStop.status, 200);
      assert.ok(Number.isFinite(Date.parse(leg.sessionBeforeStop.expiresAt)));
      assert.deepEqual(leg.recovery.session.result, leg.sessionBeforeStop);
      for (const probe of ['session', 'remote', 'login', 'signup', 'backup']) {
        assert.ok(leg.recovery[probe].withinMs <= (probe === 'backup' ? 300_000 : 90_000));
        assert.ok(Number.isFinite(leg.recovery[probe].longestGapMs));
      }
      assert.ok(leg.recovery.signup.result.worker);
      assert.equal(leg.reconciliation.mailRetained, true);
      assert.equal(leg.recovery.backup.result.retained, true);
      assert.notEqual(leg.recovery.backup.result.attemptId, services.backup.workerVerification.attemptId);
      assert.equal(leg.reconciliation.outsideStore, true);
      assert.match(leg.reconciliation.flux.appliedRevision, /^[a-f0-9]{40}$/);
      assert.equal(leg.rejoin.storeRepairedOn, leg.stopped);
      assert.ok(Number.isInteger(leg.rejoin.storeRepairAttempts) && leg.rejoin.storeRepairAttempts > 0);
      if (leg.roles.primary === leg.stopped) assert.ok(leg.reconciliation.publication.worker.uid);
    }
    assert.deepEqual(Object.keys(services.coldRestart.outage).sort(), ['account', 'public', 'staff', 'store']);
    assert.equal(services.coldRestart.sessionBeforeStop?.status, 200);
    assert.ok(Number.isFinite(Date.parse(services.coldRestart.sessionBeforeStop.expiresAt)));
    assert.deepEqual(services.coldRestart.sessionAfterRestart, services.coldRestart.sessionBeforeStop);
    assert.match(services.coldRestart.primary, /^cloud-db-\d+$/);
    assert.equal(services.coldRestart.mailRetained, true);
    const {retainedPointId, pointId, status, childAbsent} = services.coldRestart.backup;
    assert.ok(retainedPointId && pointId && retainedPointId !== pointId);
    assert.equal(retainedPointId, legs.at(-1).recovery.backup.result.pointId);
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
  const outside = servicesCredentialFiles('synthetic-smtp', 'synthetic-inbox', ['node-a', 'node-b', 'node-c']);
  assert.equal(outside.mail['smtp-auth'], 'node-a:synthetic-smtp\nnode-b:synthetic-smtp\nnode-c:synthetic-smtp\n');
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
