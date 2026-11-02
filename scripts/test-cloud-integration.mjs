import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {request} from 'node:https';
import {setTimeout as delay} from 'node:timers/promises';
import {verifierIdentityScope, checkVerifierChild} from '../deploy/test-cloud/test-fixtures/integration-verifier-ownership.mjs';
import {inspectIntegrationAuthorisedRecovery} from '../deploy/test-cloud/test-fixtures/integration-recovery-evidence.mjs';
import {inspectIntegrationContinuousRecovery} from '../deploy/test-cloud/test-fixtures/integration-continuous-recovery-evidence.mjs';
import {rollbackRefusalDiagnostic} from '../deploy/test-cloud/test-fixtures/integration-renewal.mjs';
import {captureIntegrationSource, checkIntegrationSource, measureIntegrationFiles} from '../deploy/test-cloud/test-fixtures/integration-source.mjs';
import {parseCapacityVolumeReadings} from '../deploy/test-cloud/test-fixtures/integration-capacity.mjs';
import {readIntegrationInventory} from '../deploy/test-cloud/test-fixtures/integration-inventory.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const origin = 'https://waitron.local:3000', revision = 'ec91a9e34d2daba146f4ee61850ea4136ad5cfb7';
const digest = /^sha256:[a-f0-9]{64}$/;

export function parseIntegrationJson(text) {
  try {return JSON.parse(text);} catch {throw Error('integration.invalid_json');}
}

export async function completeCleanup(steps) {
  const failed = [];
  for (const step of steps) {try {await step.run();} catch {failed.push(step.phase);}}
  if (failed.length) throw Error('integration.cleanup_failed:' + failed.join(','));
}

export function streamCommandDiagnostic(text) {
  const names=['shape','venueId','installationId','sourceNodeId','localVenueId','generation','recoverableAt','observation','identity',
    'nativeStreaming','signedPointerVerified','retainedSnapshotUnchanged','noSupersession','noActivation','observer','snapshot'];
  const found=/integration\.stream_([A-Za-z0-9_]+)/.exec(text)?.[1];
  return names.includes(found) ? ':integration.stream_'+found : '';
}

// Child output may contain account links or local credentials; only fixed phases and invariants escape failures.
function command(args, input = '', phase = args[0], env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, {cwd: root, env: {...process.env, ...env}, stdio: ['pipe', 'pipe', 'pipe']});
    let output = '', diagnostic = '', size = 0, invalid = false;
    const timer = setTimeout(() => {invalid = true; child.kill('SIGKILL');}, 120000);
    const stop = () => {invalid = true; child.kill('SIGTERM');};
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    child.stdout.on('data', part => {size += part.length; if (size > 2 * 1024 * 1024) stop(); else output += part;});
    child.stderr.on('data', part => {size += part.length; if (size > 2 * 1024 * 1024) stop(); else if (phase === 'client-diagnostics') output += part; else if (phase === 'snapshot-inspect-stream' || phase === 'client-rollback-refresh') diagnostic=(diagnostic+part).slice(-4096);});
    child.stdin.on('error', () => {});
    child.once('error', () => {invalid = true;});
    child.once('close', code => {
      clearTimeout(timer); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
      if (invalid || code !== 0) reject(new Error('integration.command_failed:' + phase + streamCommandDiagnostic(diagnostic) + (phase === 'client-rollback-refresh' ? rollbackRefusalDiagnostic(diagnostic) : '')));
      else resolve(output.trim());
    });
    child.stdin.end(input);
  });
}
const lines = text => text.split(/\s+/).filter(Boolean);

export async function runTestCloudCombined({image, waitronImage, protectedContainerIds = []} = {}) {
  return runTestCloudClients({image, waitronImage, protectedContainerIds,
    paidContinuousRecovery: true, freeRemote: true, paidRemote: true,
    measureCapacity: true, measureIntegration: true, schemaRollback: true, sourceProvenance: true});
}

export function checkProtectedContainers(before, after, ids) {
  for (const id of ids) {
    const row = before.find(value => value.startsWith(id + ' '));
    assert.ok(row, 'integration.protected_container_missing');
    assert.ok(after.includes(row), 'integration.protected_container_changed');
  }
  return true;
}

export async function runTestCloudClients({image, waitronImage, protectedContainerIds = [], paidSnapshot = false, paidVerification = false, paidRecovery = false, paidAuthorisedRecovery = false, paidStream = false, paidContinuousRecovery = false, freeRemote = false, paidRemote = false, cloudRollback = false, measureCapacity = false, measureIntegration = false, schemaRollback = false, sourceProvenance = false} = {}) {
  measureCapacity ||= measureIntegration;
  paidStream ||= paidContinuousRecovery;
  paidAuthorisedRecovery ||= paidStream;
  paidRecovery ||= paidAuthorisedRecovery;
  if (!digest.test(image) || !digest.test(waitronImage)) throw Error('integration.image_invalid');
  const source = sourceProvenance ? await captureIntegrationSource(root) : undefined;
  const runId = randomUUID(), project = 'waitron-cloud-test-integration-' + runId.slice(0, 8);
  const directory = await mkdtemp(join(tmpdir(), 'cloud-integration-run-'));
  const override = join(directory, 'proof.yaml'), clientTag = project + '-venue:local', recoveryTag = project + '-recovery:local';
  const owned = [], created = [], removed = [], venueCAs = new Map();
  let built = false, recoveryBuilt = false, started = false, result, cloudSource;
  let verifierWorker, verifierStarted = false, verifierScope, verifierUncertain = false, capacityEvidence;
  const docker = (args, input = '', phase) => command(args, input, phase, {TEST_CLOUD_IMAGE: image});
  const prefix = ['compose', '--project-name', project, '--env-file', 'deploy/test-cloud/test.env', '-f', 'compose.yaml', '-f', 'deploy/test-cloud/compose.yaml', '-f', override];
  const compose = args => docker([...prefix, ...args], '', 'compose-' + args[0]);
  const inventory = () => readIntegrationInventory({docker, protectedIds: protectedContainerIds});
  const before = await inventory();
  checkProtectedContainers(before, before, protectedContainerIds);
  let hostCapacity, startupCapacity;
  const record = (kind, id) => {if (!created.some(value => value.kind === kind && value.id === id)) created.push({kind, id, owner: runId});};
  const control = async (id, phase, choice) => parseIntegrationJson(await docker(['exec', '-i',
    ...(venueCAs.has(id) ? ['--env', 'NODE_EXTRA_CA_CERTS=' + venueCAs.get(id)] : []),
    id, 'node', '/proof/integration-control.mjs'], JSON.stringify({phase, choice}), 'client-' + phase));
  const readVerifierScope = async () => {
    if (!verifierWorker || !verifierStarted) return;
    const path = join(directory, 'verifier-identity.json');
    try {
      await docker(['cp', verifierWorker + ':/run/backup-verifier/verifier-controller/identity.json', path], '', 'verifier-identity');
      const identity = parseIntegrationJson(await readFile(path, 'utf8'));
      verifierScope = verifierIdentityScope(identity, waitronImage);
    } catch (error) {verifierUncertain = true; throw error;}
  };
  const verifierChildren = async () => {
    if (!verifierScope) return [];
    const children = lines(await docker(['ps', '-aq', '--no-trunc', '--filter', 'label=cloud.backup-verifier.owner=waitron-cloud-test-backup', '--filter', 'label=cloud.backup-verifier.scope=' + verifierScope]));
    for (const id of children) {
      assert.match(id, /^[a-f0-9]{64}$/);
      const [info] = parseIntegrationJson(await docker(['inspect', id]));
      checkVerifierChild(info, {id, image: waitronImage, scope: verifierScope});
    }
    return children;
  };
  // Recovery leaves the original stopped; measure its retained volume without restarting it.
  const measureVolumes = measureCapacity ? async names => {
    const id = await docker(['create', '--pull=never', '--label', 'cloud.integration.capacity=' + runId,
      '--network', 'none', '--read-only', '--user', '0:0', '--cap-drop', 'ALL', '--cap-add', 'DAC_OVERRIDE',
      '--security-opt', 'no-new-privileges', '--pids-limit', '16', '--memory', '32m', '--memory-swap', '32m',
      ...names.flatMap((name, i) => ['--mount', 'type=volume,src=' + name + ',dst=/capacity/' + i + ',readonly']),
      '--entrypoint', 'du', image, '-sk', '--', ...names.map((_, i) => '/capacity/' + i)], '', 'capacity-volume-create');
    owned.push(id); record('container', id);
    try {
      return parseCapacityVolumeReadings(names, await docker(['start', '--attach', id], '', 'capacity-volume-read'));
    }
    finally {
      await docker(['rm', '-f', id], '', 'capacity-volume-cleanup');
      owned.splice(owned.indexOf(id), 1);
      removed.push(created.find(value => value.kind === 'container' && value.id === id));
    }
  } : undefined;
  try {
    if (measureCapacity) {
      const {readHostCapacity} = await import('../deploy/test-cloud/test-fixtures/integration-capacity.mjs');
      const diskPath = await docker(['info', '--format', '{{.DockerRootDir}}'], '', 'capacity-data-filesystem');
      hostCapacity = {diskPath, baseline: await readHostCapacity({diskPath})};
    }
    if (source) {
      const id = await docker(['create', '-i', '--pull=never', '--label', 'cloud.integration.owner=' + runId,
        '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--memory', '128m', '--memory-swap', '128m', '--pids-limit', '32', '--workdir', '/app',
        '--entrypoint', 'node', image, 'scripts/test-cloud-image-source.mjs'], '', 'source-create');
      owned.push(id); record('container', id);
      const measured = parseIntegrationJson(await docker(['start', '-ai', id], JSON.stringify({files: source.files}), 'source-measure'));
      assert.deepEqual(measured, await measureIntegrationFiles(root, source.files), 'integration.image_source_mismatch');
      cloudSource = {head: source.head, tree: source.tree, image, dirty: false, ...measured};
    }
    const [base] = JSON.parse(await docker(['image', 'inspect', waitronImage]));
    assert.equal(base.Config.Labels?.['cloud.waitron-revision'], revision, 'integration.waitron_revision');
    const baseTag = base.RepoTags?.[0]; assert.ok(baseTag, 'integration.waitron_tag');
    assert.equal(JSON.parse(await docker(['image', 'inspect', baseTag]))[0].Id, waitronImage);
    await docker(['build', '--pull=false', '--build-arg', 'WAITRON_IMAGE=' + baseTag, '--build-arg', 'WITH_STREAM=' + (paidStream ? '1' : '0'), '--label', 'cloud.integration.owner=' + runId,
      '-f', 'deploy/test-cloud/test-fixtures/integration-venue.Dockerfile', '-t', clientTag, 'deploy/test-cloud/test-fixtures'], '', 'client-build');
    built = true;
    const clientImage = JSON.parse(await docker(['image', 'inspect', clientTag]))[0].Id;
    record('image', clientImage);
    await writeFile(override, `name: ${project}\nservices:\n  gateway-manifest:\n    environment:\n      CLOUD_TEST_SERVICE_PLANS: "${paidRemote ? 1 : 0}"\n  account:\n    environment:\n      CLOUD_TEST_SERVICE_PLANS: "1"\n  storage:\n    environment:\n      CLOUD_TEST_SERVICE_PLANS: "1"\n    ports: !override ["127.0.0.1::8333"]\n  postgres:\n    ports: !override ["127.0.0.1::5432"]\n  mailpit:\n    ports: !override ["127.0.0.1::1025", "127.0.0.1::8025"]\n  proxy:\n    ports: !override ["127.0.0.1::3000"]\n  gateway:\n    ports: !override ["127.0.0.1::443", "127.0.0.1::51820/udp"]\n`, {mode: 0o600});
    started = true;
    const start = () => compose(['up', '--no-build', '--pull', 'never', '--detach', '--wait', '--wait-timeout', '90']);
    if (measureCapacity) {
      const {measureStartupCapacity, observeCapacity} = await import('../deploy/test-cloud/test-fixtures/integration-capacity.mjs');
      startupCapacity = await measureStartupCapacity({start,
        observe: () => observeCapacity({docker, project, runId, waitronImage, startup: true, diskPath: hostCapacity.diskPath, measureVolumes,
          protectedUnchanged: async () => checkProtectedContainers(before, await inventory(), protectedContainerIds)}),
        stop: () => compose(['stop', '--timeout', '10'])});
    } else await start();
    let journeyStage = 'clients';
    const journey = async () => {
    const account = await compose(['ps', '-q', 'account']), proxy = await compose(['ps', '-q', 'proxy']);
    const network = project + '_default';
    const ca = await docker(['exec', proxy, 'cat', '/run/local-stack/lan/ca.pem']);
    assert.match(ca, /BEGIN CERTIFICATE/); assert.doesNotMatch(ca, /PRIVATE/);
    let port = Number((await compose(['port', 'proxy', '3000'])).split(':').at(-1));
    const mailPort = Number((await compose(['port', 'mailpit', '8025'])).split(':').at(-1));
    const api = (path, body, credentials = {}, trust = ca, servername = 'waitron.local') => new Promise((resolve, reject) => {
      const req = request({hostname: '127.0.0.1', port, servername, ca: trust, path, method: body === undefined ? 'GET' : 'POST',
        headers: {host: 'waitron.local:3000', ...(body === undefined ? {} : {origin, 'content-type': 'application/json'}), ...credentials}}, res => {
        let text = '';
        res.on('data', part => {text += part; if (text.length > 65536) req.destroy(Error('integration.response_large'));});
        res.once('error', reject); res.once('end', () => {
          try {resolve({status: res.statusCode, headers: res.headers, body: text ? parseIntegrationJson(text) : null});} catch (error) {reject(error);}
        });
      });
      req.once('error', reject); req.setTimeout(10000, () => req.destroy(Error('integration.api_timeout')));
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
    assert.equal((await api('/api/health/ready')).status, 200);
    await assert.rejects(api('/api/health/ready', undefined, {}, null), /certificate|issuer|verify/i);
    await assert.rejects(api('/api/health/ready', undefined, {}, ca, 'wrong.local'), /certificate|Hostname/i);
    const organisations = [], restarts = [], remoteClients = []; let freeSnapshot, publishedSnapshot, observedStream, continuousRecovery, freeRemoteEvidence, paidRemoteEvidence;
    for (const plan of ['free', 'paid']) {
      const email = `integration-${plan}-${runId}@example.test`, password = 'Disposable account ' + randomUUID();
      assert.equal((await api('/api/account/signup/request', {email})).status, 202);
      let message;
      for (let attempt = 0; attempt < 100; attempt++) {
        const inbox = parseIntegrationJson(await (await fetch(`http://127.0.0.1:${mailPort}/api/v1/messages`, {signal: AbortSignal.timeout(5000)})).text());
        const found = inbox.messages?.find(value => value.To.some(to => to.Address === email));
        if (found) {message = parseIntegrationJson(await (await fetch(`http://127.0.0.1:${mailPort}/api/v1/message/${found.ID}`, {signal: AbortSignal.timeout(5000)})).text()); break;}
        await delay(100);
      }
      const token = /https:\/\/waitron\.local:3000\/signup#token=([A-Za-z0-9_-]{43})/.exec(message?.Text ?? '')?.[1];
      assert.ok(token, 'integration.signup_mail');
      const signup = await api('/api/account/signup/complete', {token, password, organisationName: plan + ' café', legalBusinessName: plan + ' café SL', countryCode: 'ES'});
      assert.equal(signup.status, 201, 'integration.signup');
      const {organisationId, legalBusinessId} = signup.body;
      const planResult = JSON.parse(await docker(['exec', '-i', account, 'node', 'deploy/test-cloud/test-fixtures/integration-account.mjs'], JSON.stringify({organisationId, plan}), 'plan'));
      const login = await api('/api/account/login', {email, password}); assert.equal(login.status, 200, 'integration.login');
      const cookie = login.headers['set-cookie'].map(value => value.split(';')[0]).join('; ');
      const csrf = /__Host-cloud_csrf=([^;]+)/.exec(cookie)?.[1]; assert.ok(csrf);
      const browser = {'cookie': cookie, 'x-csrf-token': csrf};
      const caFile = join(directory, 'ca.pem'); await writeFile(caFile, ca + '\n', {mode: 0o644});
      const stateVolume = await docker(['volume', 'create', '--label', 'com.docker.compose.project=' + project, project + '-' + plan + '-state']);
      record('volume', stateVolume);
      const captureSnapshot = (paidSnapshot || paidVerification || paidRecovery) && plan === 'paid';
      const venueRoot = captureSnapshot ? '/tmp/cloud-integration-state/cloud-integration-backup-' + runId + '/paid' : '/tmp/cloud-integration-state/' + plan;
      const id = await docker(['create', '--pull=never', '--label', 'cloud.integration.owner=' + runId, '--network', network,
        '--add-host', 'waitron.local:' + (paidStream && plan === 'paid' ? '127.0.0.1' : '10.79.0.2'), '--memory', '1024m', '--memory-swap', '1024m', '--read-only', '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges', '--pids-limit', '128', '--user', '1000:1000', '--tmpfs', '/tmp:rw,nosuid,nodev,size=256m,mode=1777',
        '--mount', 'type=bind,src=' + caFile + ',dst=/proof/ca.pem,readonly', '--mount', 'type=volume,src=' + stateVolume + ',dst=/tmp/cloud-integration-state',
        '--env', 'CLOUD_TEST_ROOT=' + venueRoot, '--env', 'CLOUD_TEST_ORIGIN=' + origin,
        ...(captureSnapshot ? ['--env', 'CLOUD_TEST_BACKUP_STATE=1'] : []),
        ...(paidStream && plan === 'paid' ? ['--env', 'CLOUD_TEST_STREAM=1', '--env', 'SSL_CERT_FILE=/proof/ca.pem'] : []),
        '--env', 'NODE_EXTRA_CA_CERTS=/proof/ca.pem', clientImage], '', 'client-create');
      owned.push(id); record('container', id);
      if (captureSnapshot) venueCAs.set(id, venueRoot + '/tls/ca.crt');
      await docker(['start', id]);
      const ready = async () => {
        for (let attempt = 0; attempt < 100; attempt++) {
          const running = await docker(['inspect', '--format', '{{.State.Running}}', id]);
          if (running !== 'true') {
            const logs = await docker(['logs', id], '', 'client-diagnostics');
            const codes = ['ENOENT', 'EACCES', 'EROFS', 'ERR_MODULE_NOT_FOUND', 'ERR_DLOPEN_FAILED', 'SQLITE_CANTOPEN', 'SQLITE_ERROR'].filter(value => logs.includes(value));
            const frames = [...logs.matchAll(/\/waitron\/[a-zA-Z0-9_./-]+:\d+:\d+/g)].map(value => value[0]);
            const named = [...logs.matchAll(/code: ['"]([a-z_]+\.[a-z_]+)['"]/g)].map(value => value[1]);
            throw Error('integration.client_exited:' + [...codes, ...named, ...frames.slice(0, 4)].join(','));
          }
          try {await control(id, 'ready'); return;} catch {await delay(100);}
        }
        throw Error('integration.client_not_ready');
      };
      await ready();
      const startedClient = await control(id, 'start');
      assert.equal(startedClient.environment, 'test');
      const choice = {requestId: startedClient.requestId, organisationId, legalBusinessId};
      const inspected = await api('/api/account/pairing/inspect', {requestId: choice.requestId, code: startedClient.code}, browser);
      assert.equal(inspected.status, 200);
      assert.equal(inspected.body.localVenueId, startedClient.localVenueId);
      assert.equal((await api('/api/account/pairing/approve', {...choice, code: startedClient.code}, browser)).status, 200);
      const checked = await control(id, 'check'); assert.equal(checked.organisationId, organisationId);
      const completed = await control(id, 'complete', choice); assert.equal(completed.state, 'complete');
      await control(id, 'refresh'); await control(id, 'refresh');
      const evidence = await control(id, 'evidence');
      if (plan === 'free') freeSnapshot = await control(id, 'snapshot-refusal');
      if (plan === 'free' && freeRemote) {
        const remotePhase = (phase, extra = {}) => docker(['exec', '-i', account, 'node', 'deploy/test-cloud/test-fixtures/integration-account.mjs'],
          JSON.stringify({phase, organisationId, installationId: evidence.registration.installationId, ...extra}), 'remote-' + phase);
        const prepared = parseIntegrationJson(await remotePhase('free-remote-prepare'));
        const {csr, ...refused} = await control(id, 'free-remote', prepared);
        assert.equal(refused.installationId, evidence.registration.installationId);
        const independent = parseIntegrationJson(await remotePhase('free-remote-inspect', {csr}));
        freeRemoteEvidence = {organisationId, ...refused, provision: prepared.provision, ...independent};
      }
      const persisted = JSON.parse(await docker(['exec', '-i', account, 'node', 'deploy/test-cloud/test-fixtures/integration-account.mjs'],
        JSON.stringify({organisationId, installationId: evidence.registration.installationId}), 'persisted-binding'));
      assert.equal(persisted.venueId, evidence.registration.venueId); assert.equal(persisted.localVenueId, evidence.localVenueId);
      if (captureSnapshot) {
        const accountPhase = (phase, extra = {}) => docker(['exec', '-i', account, 'node', 'deploy/test-cloud/test-fixtures/integration-account.mjs'],
          JSON.stringify({phase, organisationId, installationId: evidence.registration.installationId, ...extra}), 'snapshot-' + phase);
        await accountPhase('provision-snapshot');
        await control(id, 'refresh');
        const recoveryAuthority = paidAuthorisedRecovery ? await control(id, 'recovery-authority') : undefined;
        if (paidVerification || paidRecovery) assert.deepEqual(await control(id, 'verification-state'), {testCertificateInstalled: true});
        const captured = await control(id, 'snapshot-publish');
        for (const [name, extra] of [
          ['stored-digest', {sha256: '0'.repeat(64)}],
          ['organisation-binding', {organisationId: organisations[0].organisationId}],
          ['source-node-binding', {sourceNodeId: randomUUID()}],
        ]) await assert.rejects(accountPhase('inspect-snapshot', {...captured, ...extra}), undefined, 'integration.snapshot_control:' + name);
        const independent = parseIntegrationJson(await accountPhase('inspect-snapshot', captured));
        assert.equal(independent.independentStoredDigest, true);
        publishedSnapshot = {...captured, ...independent, organisationId, venueId: evidence.registration.venueId,
          installationId: evidence.registration.installationId, localVenueId: evidence.localVenueId, recovery: 'not-run'};
        if (paidVerification || paidRecovery) {
          journeyStage = 'verification';
          const verify = async () => {
          await accountPhase('configure-verification', {image: waitronImage});
          const [accountInfo] = parseIntegrationJson(await docker(['inspect', account]));
          const configVolume = accountInfo.Mounts.find(value => value.Destination === '/run/local-stack').Name;
          const stateVolume = await docker(['volume', 'create', '--label', 'com.docker.compose.project=' + project, project + '-verifier-state']);
          record('volume', stateVolume);
          verifierWorker = await docker(['create', '--label', 'com.docker.compose.project=' + project,
            '--label', 'cloud.integration.owner=' + runId, '--network', network, '--memory', '128m', '--memory-swap', '128m',
            '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '128',
            '--tmpfs', '/tmp:rw,nosuid,nodev,size=96m,mode=1777', '--env', 'CLOUD_TEST_SERVICE_PLANS=1', '--env', 'CLOUD_VERIFIER_IMAGE=' + waitronImage,
            '--env', 'CLOUD_INTEGRATION_POINT_ID=' + captured.pointId,
            '--mount', 'type=volume,src=' + configVolume + ',dst=/run/local-stack,readonly',
            '--mount', 'type=volume,src=' + stateVolume + ',dst=/run/backup-verifier',
            '--mount', 'type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock',
            '--entrypoint', 'node', image, 'deploy/test-cloud/test-fixtures/integration-verifier.mjs'], '', 'verifier-create');
          owned.push(verifierWorker); record('container', verifierWorker);
          verifierStarted = true; await docker(['start', verifierWorker]);
          let admission;
          for (let attempt = 0; attempt < 90; attempt++) {
            try {admission = parseIntegrationJson(await accountPhase('inspect-verification', {...captured, image: waitronImage})); break;}
            catch {
              assert.equal(await docker(['inspect', '--format', '{{.State.Running}}', verifierWorker]), 'true', 'integration.verifier_worker_exited');
              await delay(500);
            }
          }
          assert.ok(admission, 'integration.verification_not_admitted');
          await readVerifierScope(); assert.equal(admission.controllerScope, verifierScope);
          assert.deepEqual(await verifierChildren(), [], 'integration.verifier_child_remains');
          assert.equal(await docker(['ps', '-aq', '--no-trunc', '--filter', 'id=' + admission.childId]), '', 'integration.verifier_child_remains');
          record('container', admission.childId);
          removed.push(created.find(value => value.kind === 'container' && value.id === admission.childId));
          await docker(['stop', '--time', '15', verifierWorker], '', 'verifier-stop');
          assert.equal(await docker(['inspect', '--format', '{{.State.ExitCode}}', verifierWorker]), '0', 'integration.verifier_forced_shutdown');
          publishedSnapshot.verification = 'verified';
          publishedSnapshot.workerVerification = {...admission, childAbsent: true, workerStoppedNaturally: true};
          };
          if (measureCapacity) {
            const {measureCapacityWindow, observeCapacity} = await import('../deploy/test-cloud/test-fixtures/integration-capacity.mjs');
            const measured = await measureCapacityWindow({
              observe: async () => {
                if (verifierWorker && !verifierScope) {
                  const text = await docker(['logs', verifierWorker], '', 'capacity-controller-scope');
                  for (const line of text.split('\n')) {
                    let value; try {value = JSON.parse(line);} catch {continue;}
                    if (value.controllerScope) {assert.match(value.controllerScope, /^[a-f0-9-]{36}$/); verifierScope = value.controllerScope;}
                  }
                }
                return observeCapacity({docker, project, runId, verifierScope, waitronImage, workerId: verifierWorker, diskPath: hostCapacity.diskPath, measureVolumes,
                  protectedUnchanged: async () => checkProtectedContainers(before, await inventory(), protectedContainerIds)});
              },
              verify,
              stop: async () => {if (verifierStarted) await docker(['stop', '--time', '15', verifierWorker], '', 'capacity-refusal-stop');},
            });
            capacityEvidence = {measurement: 'linux-cgroup-v2-including-tmpfs', diskMeasurement: 'docker-data-filesystem',
              shippingQualification: false, baseline: hostCapacity.baseline, startup: {samples: startupCapacity.samples}, samples: measured.samples};
          } else await verify();
        }
        if (paidStream) {
          journeyStage = 'stream';
          const streamed = await control(id, 'stream-start');
          assert.equal(streamed.sourceNodeId, captured.sourceNodeId);
          assert.equal(streamed.localVenueId, evidence.localVenueId);
          assert.equal(streamed.nativeStreaming, true);
          const inspect = extra => accountPhase('inspect-stream', {...captured, ...streamed, attemptId: publishedSnapshot.workerVerification.attemptId, ...extra});
          for (const extra of [{sourceNodeId: randomUUID()}, {generation: 'another-generation'}, {recoverableAt: '2026-01-01T00:00:00.000Z'}]) await assert.rejects(inspect(extra));
          observedStream = parseIntegrationJson(await inspect({}));
        }
        if (paidRecovery) {
          await docker(['build', '--pull=false', '--build-arg', 'VERIFIER_IMAGE=' + (paidContinuousRecovery ? clientTag : baseTag),
            '--label', 'cloud.integration.owner=' + runId, '-f', 'deploy/test-cloud/test-fixtures/snapshot-recovery.Dockerfile',
            '-t', recoveryTag, 'deploy/test-cloud/test-fixtures'], '', 'recovery-build');
          recoveryBuilt = true;
          const recoveryImage = parseIntegrationJson(await docker(['image', 'inspect', recoveryTag]))[0].Id;
          record('image', recoveryImage);
          const target = await docker(['create', '--pull=never', '--label', 'cloud.integration.owner=' + runId,
            '--network', network, '--memory', '1024m', '--memory-swap', '1024m', '--read-only', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges', '--user', '1000:1000', '--pids-limit', '128',
            '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=256m,mode=1777',
            ...(paidContinuousRecovery ? ['--mount', 'type=bind,src=' + caFile + ',dst=/proof/ca.pem,readonly', '--env', 'NODE_EXTRA_CA_CERTS=/proof/ca.pem'] : []),
            ...(paidAuthorisedRecovery ? ['--tmpfs', '/waitron/apps/server/node_modules/.vite-temp:rw,nosuid,nodev,size=16m,mode=1777',
              '--tmpfs', '/waitron/apps/server/node_modules/.vite:rw,nosuid,nodev,size=32m,mode=1777'] : []),
            '--entrypoint', 'node', recoveryImage,
            '-e', 'setInterval(()=>{},1000)'], '', 'recovery-create');
          owned.push(target); record('container', target); await docker(['start', target]);
          const targetPhase = async (phase, extra = {}) => parseIntegrationJson(await docker(['exec', '-i', target,
            'node', '/waitron/apps/server/dist/cloud-joint-proof.js'], JSON.stringify({phase, ...extra}), 'recovery-' + phase));
          const fallbackInput = {...captured, attemptId: publishedSnapshot.workerVerification.attemptId};
          const checkFallback = async phase => {
            const value = parseIntegrationJson(await accountPhase('inspect-snapshot-fallback', fallbackInput));
            assert.deepEqual(value, {streamObjects: 0, pointerRows: 0, retainedSnapshotUnchanged: true});
            publishedSnapshot.snapshotFallback.observations.push(phase);
          };
          if (paidContinuousRecovery) {
            journeyStage = 'continuous-recovery';
            const streamPhase = async (phase, extra = {}) => parseIntegrationJson(await docker(['exec', '-i', target,
              'node', '/waitron/apps/server/dist/cloud-continuous-target.js'], JSON.stringify({phase, ...extra}), 'continuous-' + phase));
            const requested = await streamPhase('start', {ca});
            const owner = async (action, extra = {}) => {
              const reply = await api('/api/account/recovery/' + action, {requestId: requested.requestId, code: requested.code, ...extra}, browser);
              assert.equal(reply.status, 200, 'integration.continuous_owner_' + action); return reply.body;
            };
            assert.equal((await owner('inspect')).state, 'awaiting_owner');
            const approved = await owner('approve', {source: 'continuous', venueId: observedStream.venueId,
              oldServerUnavailable: 'true', acceptDataLoss: 'true'});
            assert.equal(approved.operation.source.kind, 'continuous');
            assert.equal(approved.operation.source.sourceNodeId, observedStream.sourceNodeId);
            await docker(['stop', '--time', '10', id], '', 'continuous-source-stop');
            assert.equal(await docker(['inspect', '--format', '{{.State.Running}}', id]), 'false');
            const delivery = await streamPhase('read', {selected: observedStream, authority: recoveryAuthority});
            assert.equal(delivery.ownerApprovedKit, true);
            const checked = parseIntegrationJson(await docker(['exec', '--workdir', '/waitron/apps/server', target,
              'node', '--input-type=module', '-e', `
                import {spawnSync} from 'node:child_process';import {readFileSync} from 'node:fs';
                const input=JSON.parse(readFileSync('/tmp/cloud-integration-stream-input.json','utf8'));
                const kit=JSON.parse(Buffer.from(input.kit.split(':')[1],'base64url').toString());
                const child=spawnSync('pnpm',['exec','vitest','run','src/cloud-paired-continuous-recovery.test.ts','--maxWorkers=1'],{encoding:'utf8',timeout:100000,maxBuffer:2*1024*1024});
                let output=(child.stdout??'')+'\\n'+(child.stderr??'');
                for(const secret of [input.kit,input.authority.secret,kit.recoveryKey,kit.bucket.secretAccessKey,kit.bucket.accessKeyId])output=output.replaceAll(secret,'[redacted]');
                const matches=[...output.matchAll(/CLOUD_PAIRED_CONTINUOUS_RECOVERY=(\\{[^\\n]+)$/gm)];
                const refused=[...output.matchAll(/CLOUD_CONTINUOUS_REFUSAL_STATE=(\\{[^\\n]+)$/gm)];
                console.log(JSON.stringify({exit:child.status,report:matches.length===1?JSON.parse(matches[0][1]):null,
                  diagnostic:child.status===0?null:output.slice(-5000)+'\\nREFUSAL_STATE='+(refused.length===1?refused[0][1]:'unavailable')}));
              `], '', 'continuous-ordinary-restore'));
            assert.equal(checked.exit, 0, 'integration.continuous_restore_failed:' + checked.diagnostic);
            assert.equal(await docker(['inspect', '--format', '{{.State.Running}}', id]), 'false');
            const inspect = desiredStatus => accountPhase('inspect-continuous-recovery', {...observedStream,
              requestId: requested.requestId, desiredStatus});
            const pending = parseIntegrationJson(await inspect('pending'));
            await owner('close');
            const closed = parseIntegrationJson(await inspect('closed'));
            continuousRecovery = inspectIntegrationContinuousRecovery({...checked.report, ownerApprovedKit: delivery.ownerApprovedKit,
              sourceStoppedDuringRead: true, noSupersession: pending.noSupersession, requestClosed: closed.cloudStatus === 'closed'}, observedStream);
            const fallback = parseIntegrationJson(await accountPhase('remove-test-stream', fallbackInput));
            assert.deepEqual(fallback, {streamObjects: 0, pointerRows: 0, retainedSnapshotUnchanged: true});
            publishedSnapshot.snapshotFallback = {...fallback, observations: ['before-snapshot-request']};
            // Start the snapshot fault matrix after the continuous client's 60-second IP window expires.
            await delay(61000);
          }
          journeyStage = 'snapshot-recovery';
          const request = await targetPhase('start', {ca});
          assert.equal(request.targetDigest, publishedSnapshot.workerVerification.targetDigest);
          // The unavailable source stays stopped during every recovery read and fiscal refusal.
          await docker(['stop', '--time', '10', id], '', 'recovery-source-stop');
          assert.equal(await docker(['inspect', '--format', '{{.State.Running}}', id]), 'false');
          const ownerPost = async (action, extra = {}) => {
            const response = await api('/api/account/recovery/' + action, {requestId: request.requestId, code: request.code, ...extra}, browser);
            assert.equal(response.status, 200, 'integration.owner_recovery_' + action);
            return response.body;
          };
          assert.equal((await ownerPost('inspect')).state, 'awaiting_owner');
          const choice = {source: 'snapshot', pointId: captured.pointId, oldServerUnavailable: 'true', acceptDataLoss: 'true'};
          const approved = await ownerPost('approve', choice);
          assert.equal(approved.state, 'approved'); assert.equal(approved.operation.pointId, captured.pointId);
          assert.deepEqual(await ownerPost('approve', choice), approved);
          const selected = {pointId: captured.pointId, digest: captured.sha256, bytes: captured.bytes};
          const delivered = await targetPhase('read-summary', selected);
          assert.equal(delivered.independentDigest, true); assert.equal(delivered.prePlacement, true);
          assert.equal(delivered.client, 'pinned-compiled-waitron'); assert.equal(delivered.targetDigest, request.targetDigest);
          assert.equal(delivered.sha256, captured.sha256); assert.equal(delivered.bytes, captured.bytes);
          if (paidContinuousRecovery) await checkFallback('after-snapshot-read');
          const refusals = await targetPhase('delivery-refusals', selected);
          assert.deepEqual(refusals, {alternateTargetRefused: true, damagedArchiveRefused: true, placementCalls: 0, restoredReports: 0, stateUnchanged: true});
          if (paidAuthorisedRecovery) {
            assert.equal(recoveryAuthority.sourceNodeId, captured.sourceNodeId);
            assert.equal(recoveryAuthority.localVenueId, evidence.localVenueId);
            // Archive bytes and both keys stay inside the disposable target; the host receives measurements only.
            const delivery = parseIntegrationJson(await docker(['exec', '-i', target, 'node', '--input-type=module', '-e', `
              import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {writeFileSync} from 'node:fs';
              let s='';for await(const b of process.stdin){s+=b;assert(s.length<16384);}const input=JSON.parse(s);
              const child=spawnSync(process.execPath,['/waitron/apps/server/dist/cloud-joint-proof.js'],{
                input:JSON.stringify({phase:'read',...input.selected}),encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
              assert.equal(child.status,0,'fixture.private_read_failed');const value=JSON.parse(child.stdout.trim());
              writeFileSync('/tmp/cloud-integration-authorised-input.json',JSON.stringify({delivery:value.privateDelivery,
                authority:input.authority,sha256:input.selected.digest,bytes:input.selected.bytes}),{mode:0o600});
              console.log(JSON.stringify({independentDigest:value.independentDigest,prePlacement:value.prePlacement}));
            `], JSON.stringify({selected, authority: recoveryAuthority}), 'authorised-private-delivery'));
            assert.equal(delivery.independentDigest, true); assert.equal(delivery.prePlacement, true);
          }
          const refusal = await targetPhase('restore-refusal', selected);
          assert.equal(refusal.ordinaryRestore, 'FISCAL_RESTORE'); assert.equal(refusal.activation, 'not_attempted');
          assert.equal(refusal.routeMoved, false); assert.equal(refusal.reportedRestored, false);
          assert.equal(await docker(['inspect', '--format', '{{.State.Running}}', id]), 'false');
          if (paidAuthorisedRecovery) {
            const checked = parseIntegrationJson(await docker(['exec', '--workdir', '/waitron/apps/server', target,
              'node', '--input-type=module', '-e', `
                import {spawnSync} from 'node:child_process';import {readFileSync} from 'node:fs';
                const input=JSON.parse(readFileSync('/tmp/cloud-integration-authorised-input.json','utf8'));
                const child=spawnSync('pnpm',['exec','vitest','run','src/cloud-paired-authorised-recovery.test.ts','--maxWorkers=1'],{encoding:'utf8',timeout:100000,maxBuffer:2*1024*1024});
                let output=(child.stdout??'')+'\\n'+(child.stderr??'');
                for(const secret of [input.authority.secret,input.delivery.recoveryKey,input.delivery.archive])output=output.replaceAll(secret,'[redacted]');
                const matches=[...output.matchAll(/CLOUD_PAIRED_AUTHORISED_RECOVERY=(\\{[^\\n]+)$/gm)];
                console.log(JSON.stringify({exit:child.status,report:matches.length===1?JSON.parse(matches[0][1]):null,
                  diagnostic:child.status===0?null:output.slice(-6000)}));
              `], '', 'authorised-ordinary-restore'));
            assert.equal(checked.exit, 0, 'integration.authorised_restore_failed:' + checked.diagnostic);
            publishedSnapshot.authorisedRecovery = inspectIntegrationAuthorisedRecovery(checked.report,
              {sha256: captured.sha256, bytes: captured.bytes, sourceNodeId: captured.sourceNodeId, localVenueId: evidence.localVenueId});
            assert.equal(await docker(['inspect', '--format', '{{.State.Running}}', id]), 'false');
          }
          const independent = extra => accountPhase('inspect-recovery', {...captured, requestId: request.requestId,
            attemptId: publishedSnapshot.workerVerification.attemptId, targetDigest: request.targetDigest, ...extra});
          for (const extra of [{pointId: randomUUID()}, {attemptId: randomUUID()}, {sha256: '0'.repeat(64)}]) await assert.rejects(independent({desiredStatus: 'pending', ...extra}));
          const persisted = parseIntegrationJson(await independent({desiredStatus: 'pending'}));
          await ownerPost('close');
          assert.equal(parseIntegrationJson(await independent({desiredStatus: 'closed'})).cloudStatus, 'closed');
          if (paidContinuousRecovery) await checkFallback('after-snapshot-restore-and-close');
          publishedSnapshot.recovery = 'fiscal-authority-required';
          publishedSnapshot.ownerRecovery = {...persisted, client: delivered.client, independentDigest: delivered.independentDigest,
            prePlacement: delivered.prePlacement, refusals, ordinaryRestore: refusal.ordinaryRestore, activation: refusal.activation,
            routeMoved: refusal.routeMoved, reportedRestored: refusal.reportedRestored, sourceStoppedDuringRead: true, requestClosed: true};
        }
      }
      const beforeRestart = await docker(['inspect', '--format', '{{.State.StartedAt}}', id]);
      await docker(['restart', '--time', '10', id]); await ready(); await control(id, 'refresh');
      const afterRestart = await docker(['inspect', '--format', '{{.State.StartedAt}}', id]);
      assert.ok(Date.parse(afterRestart) > Date.parse(beforeRestart), 'integration.restart_not_observed');
      const restarted = await control(id, 'evidence');
      assert.deepEqual(restarted.registration, evidence.registration); assert.equal(restarted.identitySha256, evidence.identitySha256);
      assert.equal(restarted.localVenueId, evidence.localVenueId);
      if (plan === 'paid' && paidRecovery) publishedSnapshot.ownerRecovery.sourceIdentityPreserved = true;
      restarts.push({installationId: evidence.registration.installationId, before: beforeRestart, after: afterRestart});
      organisations.push({plan, organisationId, venueId: evidence.registration.venueId, installationId: evidence.registration.installationId,
        localVenueId: evidence.localVenueId, stateSha256: restarted.stateSha256, installationState: restarted.installationState, planRevision: planResult.revision});
      remoteClients.push({id, stateVolume, venueRoot, ...organisations.at(-1)});
    }
    if (paidRemote) {
      journeyStage = 'remote-withdrawal';
      const {proveIntegrationPaidRemote} = await import('../deploy/test-cloud/test-fixtures/integration-paid-remote.mjs');
      paidRemoteEvidence = await proveIntegrationPaidRemote({docker, compose, control, account,
        paid: remoteClients.find(value => value.plan === 'paid'), free: remoteClients.find(value => value.plan === 'free'), image, runId, storageWithdrawal: paidStream,
        own: id => {owned.push(id); record('container', id);}});
    }
    let cloudRollbackEvidence, schemaRollbackEvidence;
    if (cloudRollback || schemaRollback) {
      journeyStage = 'rollback';
      const {proveIntegrationRollback, checkRollbackClient} = await import('../deploy/test-cloud/test-fixtures/integration-rollback.mjs');
      const exchanges = async client => parseIntegrationJson(await docker(['exec', client.id, 'node', '-e',
        "const fs=require('node:fs');const rows=fs.readFileSync(process.argv[1]+'/exchanges.jsonl','utf8').trim().split('\\n').map(JSON.parse);const count=path=>rows.filter(row=>row.path===path&&row.status===200).length;console.log(JSON.stringify({renewals:count('/api/installations/renew'),configurations:count('/api/installations/configuration')}));",
        client.venueRoot], '', 'rollback-client-exchanges'));
      const clients = [];
      const previous = await Promise.all(remoteClients.map(async client => ({client,
        evidence: await control(client.id, 'evidence'), exchanges: await exchanges(client)})));
      const proveRollback = schemaRollback ? (await import('../deploy/test-cloud/test-fixtures/integration-schema-rollback.mjs')).proveIntegrationSchemaRollback : proveIntegrationRollback;
      const evidence = await proveRollback({docker, compose, project, image, account,
        own: id => {owned.push(id); record('container', id);},
        readIdentity: async () => parseIntegrationJson(await docker(['exec', account, 'node', 'deploy/test-cloud/test-fixtures/integration-deployment-identity.mjs'], '', 'rollback-deployment-identity')),
        probe: async () => {
          // Docker assigns a new random loopback port when the stopped proxy starts again.
          port = Number((await compose(['port', 'proxy', '3000'])).split(':').at(-1));
          let ready = false;
          for (let attempt = 0; attempt < 100; attempt++) {
            try {if ((await api('/api/health/ready')).status === 200) {ready = true; break;}} catch {}
            await delay(100);
          }
          assert.equal(ready, true, 'integration.rollback_unavailable');
          for (const before of previous) {
            assert.deepEqual(await control(before.client.id, 'rollback-refresh'), {renewed: true});
            const after = await control(before.client.id, 'evidence');
            const counts = await exchanges(before.client);
            checkRollbackClient(before.evidence, after, before.exchanges, counts);
            clients.push({installationId: before.client.installationId, before: before.exchanges, after: counts, identityPreserved: true});
          }
        }});
      evidence.clients = clients;
      evidence.pairedClientsPreserved = clients.length;
      if (schemaRollback) schemaRollbackEvidence = evidence; else cloudRollbackEvidence = evidence;
    }
    for (const key of ['organisationId', 'venueId', 'installationId', 'localVenueId', 'stateSha256']) assert.equal(new Set(organisations.map(value => value[key])).size, 2, 'integration.distinct_' + key);
    result = {version: 1, kind: 'test-cloud-clients', runId, completeIntegration: false, origin, waitronHead: revision, image, waitronImage,
      ...(cloudSource ? {cloudSource} : {}),
      accountMail: {free: 'proved', paid: 'proved', transport: 'mailpit'}, clients: {status: 'proved', actions: ['pair', 'renew', 'configuration'], demoVenues: 2, restartIdentity: 'proved'},
      tls: {untrustedRefused: true, wrongHostnameRefused: true}, organisations, freeSnapshot, restarts,
      ...(capacityEvidence ? {capacity: capacityEvidence} : {}), ...(publishedSnapshot ? {paidSnapshot: publishedSnapshot} : {}), ...(observedStream ? {paidStream: observedStream} : {}),
      ...(continuousRecovery ? {paidContinuousRecovery: continuousRecovery} : {}), ...(freeRemoteEvidence ? {freeRemote: freeRemoteEvidence} : {}),
      ...(paidRemoteEvidence ? {paidRemote: paidRemoteEvidence} : {}), ...(paidRemoteEvidence?.directStorage ? {paidStorageWithdrawal: paidRemoteEvidence.directStorage} : {}), ...(cloudRollbackEvidence ? {cloudRollback: cloudRollbackEvidence} : {}),
      ...(paidRemoteEvidence?.snapshotExposure ? {paidSnapshotExposure: paidRemoteEvidence.snapshotExposure} : {}),
      ...(schemaRollbackEvidence ? {schemaRollback: schemaRollbackEvidence} : {})};
    };
    if (measureIntegration) {
      const {measureIntegrationCapacity, observeCapacity} = await import('../deploy/test-cloud/test-fixtures/integration-capacity.mjs');
      const measured = await measureIntegrationCapacity({run: journey,
        observe: async () => ({stage: journeyStage,
          ...await observeCapacity({docker, project, runId, verifierScope, waitronImage,
            workerId: verifierWorker, diskPath: hostCapacity.diskPath, measureVolumes,
            protectedUnchanged: async () => checkProtectedContainers(before, await inventory(), protectedContainerIds)})}),
        stop: () => compose(['stop', '--timeout', '10'])});
      capacityEvidence.integration = {samples: measured.samples};
    } else await journey();
  } finally {
    try {
      await completeCleanup([
        {phase: 'verifier', run: async () => {
          if (!verifierWorker) return;
          if (verifierStarted) await docker(['stop', '--time', '15', verifierWorker], '', 'verifier-cleanup-stop');
          await readVerifierScope();
          for (const id of await verifierChildren()) {owned.push(id); record('container', id);}
        }},
        {phase: 'discover-containers', run: async () => {
          if (started) for (const id of lines(await docker(['ps', '-aq', '--no-trunc', '--filter', 'label=com.docker.compose.project=' + project]))) {owned.push(id); record('container', id);}
        }},
        {phase: 'containers', run: () => completeCleanup([...new Set(owned)].map(id => ({phase: 'container', run: async () => {
          await docker(['rm', '-f', '-v', id], '', 'owned-container-cleanup'); removed.push(created.find(value => value.kind === 'container' && value.id === id));
        }})))},
        ...['network', 'volume'].map(kind => ({phase: kind, run: async () => {
          if (!started) return;
          // Keep durable ownership evidence if the trusted controller's scope could not be read.
          if (kind === 'volume' && verifierUncertain) throw Error('integration.verifier_state_retained');
          const ids = lines(await docker([kind, 'ls', '-q', '--filter', 'label=com.docker.compose.project=' + project]));
          await completeCleanup(ids.map(id => ({phase: kind, run: async () => {
            record(kind, id); await docker([kind, 'rm', id], '', 'owned-' + kind + '-cleanup'); removed.push(created.find(value => value.kind === kind && value.id === id));
          }})));
          assert.equal(await docker([kind, 'ls', '-q', '--filter', 'label=com.docker.compose.project=' + project]), '', 'integration.cleanup_' + kind);
        }})),
        {phase: 'image', run: async () => {
          if (!built) return;
          const [info] = JSON.parse(await docker(['image', 'inspect', clientTag])); assert.equal(info.Config.Labels['cloud.integration.owner'], runId);
          await docker(['image', 'rm', clientTag], '', 'owned-image-cleanup'); removed.push(created.find(value => value.kind === 'image' && value.id === info.Id));
        }},
        {phase: 'recovery-image', run: async () => {
          if (!recoveryBuilt) return;
          const [info] = parseIntegrationJson(await docker(['image', 'inspect', recoveryTag]));
          assert.equal(info.Config.Labels['cloud.integration.owner'], runId);
          await docker(['image', 'rm', recoveryTag], '', 'owned-recovery-image-cleanup');
          removed.push(created.find(value => value.kind === 'image' && value.id === info.Id));
        }},
        {phase: 'inventory', run: async () => {
          const after = await inventory();
          // Other lanes own their temporary lifetimes; only the caller's protected IDs are invariant.
          checkProtectedContainers(before, after, protectedContainerIds);
          for (const id of owned) assert.ok(!after.some(row => row.startsWith(id + ' ')), 'integration.owned_container_remains');
        }},
      ]);
      if (result) {
        const order = values => values.sort((a, b) => (a.kind + ':' + a.id).localeCompare(b.kind + ':' + b.id));
        assert.deepEqual(order(removed), order(created));
        result.cleanup = {created, removed, remaining: []}; result.protectedContainersUnchanged = true;
      }
    } finally {await rm(directory, {recursive: true, force: true});}
  }
  if (capacityEvidence) {
    const {readHostCapacity} = await import('../deploy/test-cloud/test-fixtures/integration-capacity.mjs');
    capacityEvidence.after = await readHostCapacity({diskPath: hostCapacity.diskPath});
  }
  if (source) await checkIntegrationSource(root, source);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert.equal(process.argv.length, 2);
    const value = await runTestCloudClients({image: process.env.TEST_CLOUD_INTEGRATION_IMAGE, waitronImage: process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
      protectedContainerIds: JSON.parse(process.env.TEST_CLOUD_PROTECTED_CONTAINER_IDS ?? '[]')});
    process.stdout.write(JSON.stringify(value) + '\n');
  } catch {process.stderr.write('Test Cloud client integration failed\n'); process.exitCode = 1;}
}
