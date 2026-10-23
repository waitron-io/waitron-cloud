import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {request} from 'node:https';
import {setTimeout as delay} from 'node:timers/promises';

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

// Child output may contain account links or local credentials; only fixed phases escape failures.
function command(args, input = '', phase = args[0], env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, {cwd: root, env: {...process.env, ...env}, stdio: ['pipe', 'pipe', 'pipe']});
    let output = '', size = 0, invalid = false;
    const timer = setTimeout(() => {invalid = true; child.kill('SIGKILL');}, 120000);
    const stop = () => {invalid = true; child.kill('SIGTERM');};
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    child.stdout.on('data', part => {size += part.length; if (size > 2 * 1024 * 1024) stop(); else output += part;});
    child.stderr.on('data', part => {size += part.length; if (size > 2 * 1024 * 1024) stop(); else if (phase === 'client-diagnostics') output += part;});
    child.stdin.on('error', () => {});
    child.once('error', () => {invalid = true;});
    child.once('close', code => {
      clearTimeout(timer); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
      if (invalid || code !== 0) reject(new Error('integration.command_failed:' + phase));
      else resolve(output.trim());
    });
    child.stdin.end(input);
  });
}
const lines = text => text.split(/\s+/).filter(Boolean);

export function checkProtectedContainers(before, after, ids) {
  for (const id of ids) {
    const row = before.find(value => value.startsWith(id + ' '));
    assert.ok(row, 'integration.protected_container_missing');
    assert.ok(after.includes(row), 'integration.protected_container_changed');
  }
  return true;
}

export async function runTestCloudClients({image, waitronImage, protectedContainerIds = []} = {}) {
  if (!digest.test(image) || !digest.test(waitronImage)) throw Error('integration.image_invalid');
  const runId = randomUUID(), project = 'waitron-cloud-test-integration-' + runId.slice(0, 8);
  const directory = await mkdtemp(join(tmpdir(), 'cloud-integration-run-'));
  const override = join(directory, 'proof.yaml'), clientTag = project + '-venue:local';
  const owned = [], created = [], removed = [];
  let built = false, started = false, result;
  const docker = (args, input = '', phase) => command(args, input, phase, {TEST_CLOUD_IMAGE: image});
  const prefix = ['compose', '--project-name', project, '--env-file', 'deploy/test-cloud/test.env', '-f', 'compose.yaml', '-f', 'deploy/test-cloud/compose.yaml', '-f', override];
  const compose = args => docker([...prefix, ...args], '', 'compose-' + args[0]);
  const inventory = async () => {
    const ids = lines(await docker(['ps', '-aq', '--no-trunc']));
    if (!ids.length) return [];
    // Inspect only IDs, running states and start times, never environments or mount contents.
    return (await docker(['inspect', '--format', '{{.Id}} {{.State.Running}} {{.State.StartedAt}}', ...ids])).split('\n').sort();
  };
  const before = await inventory();
  checkProtectedContainers(before, before, protectedContainerIds);
  const record = (kind, id) => {if (!created.some(value => value.kind === kind && value.id === id)) created.push({kind, id, owner: runId});};
  const control = async (id, phase, choice) => parseIntegrationJson(await docker(['exec', '-i', id, 'node', '/proof/integration-control.mjs'], JSON.stringify({phase, choice}), 'client-' + phase));
  try {
    const [base] = JSON.parse(await docker(['image', 'inspect', waitronImage]));
    assert.equal(base.Config.Labels?.['cloud.waitron-revision'], revision, 'integration.waitron_revision');
    const baseTag = base.RepoTags?.[0]; assert.ok(baseTag, 'integration.waitron_tag');
    assert.equal(JSON.parse(await docker(['image', 'inspect', baseTag]))[0].Id, waitronImage);
    await docker(['build', '--pull=false', '--build-arg', 'WAITRON_IMAGE=' + baseTag, '--label', 'cloud.integration.owner=' + runId,
      '-f', 'deploy/test-cloud/test-fixtures/integration-venue.Dockerfile', '-t', clientTag, 'deploy/test-cloud/test-fixtures'], '', 'client-build');
    built = true;
    const clientImage = JSON.parse(await docker(['image', 'inspect', clientTag]))[0].Id;
    record('image', clientImage);
    await writeFile(override, `name: ${project}\nservices:\n  account:\n    environment:\n      CLOUD_TEST_SERVICE_PLANS: "1"\n  storage:\n    environment:\n      CLOUD_TEST_SERVICE_PLANS: "1"\n    ports: !override ["127.0.0.1::8333"]\n  postgres:\n    ports: !override ["127.0.0.1::5432"]\n  mailpit:\n    ports: !override ["127.0.0.1::1025", "127.0.0.1::8025"]\n  proxy:\n    ports: !override ["127.0.0.1::3000"]\n  gateway:\n    ports: !override ["127.0.0.1::443", "127.0.0.1::51820/udp"]\n`, {mode: 0o600});
    started = true;
    await compose(['up', '--no-build', '--pull', 'never', '--detach', '--wait', '--wait-timeout', '90']);
    const account = await compose(['ps', '-q', 'account']), proxy = await compose(['ps', '-q', 'proxy']);
    const network = project + '_default';
    const ca = await docker(['exec', proxy, 'cat', '/run/local-stack/lan/ca.pem']);
    assert.match(ca, /BEGIN CERTIFICATE/); assert.doesNotMatch(ca, /PRIVATE/);
    const port = Number((await compose(['port', 'proxy', '3000'])).split(':').at(-1));
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
    const organisations = [], restarts = []; let freeSnapshot;
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
      const id = await docker(['create', '--pull=never', '--label', 'cloud.integration.owner=' + runId, '--network', network,
        '--add-host', 'waitron.local:10.79.0.2', '--memory', '1024m', '--memory-swap', '1024m', '--read-only', '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges', '--pids-limit', '128', '--user', '1000:1000', '--tmpfs', '/tmp:rw,nosuid,nodev,size=256m,mode=1777',
        '--mount', 'type=bind,src=' + caFile + ',dst=/proof/ca.pem,readonly', '--mount', 'type=volume,src=' + stateVolume + ',dst=/tmp/cloud-integration-state',
        '--env', 'CLOUD_TEST_ROOT=/tmp/cloud-integration-state/' + plan, '--env', 'CLOUD_TEST_ORIGIN=' + origin,
        '--env', 'NODE_EXTRA_CA_CERTS=/proof/ca.pem', clientImage], '', 'client-create');
      owned.push(id); record('container', id);
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
      const persisted = JSON.parse(await docker(['exec', '-i', account, 'node', 'deploy/test-cloud/test-fixtures/integration-account.mjs'],
        JSON.stringify({organisationId, installationId: evidence.registration.installationId}), 'persisted-binding'));
      assert.equal(persisted.venueId, evidence.registration.venueId); assert.equal(persisted.localVenueId, evidence.localVenueId);
      const beforeRestart = await docker(['inspect', '--format', '{{.State.StartedAt}}', id]);
      await docker(['restart', '--time', '10', id]); await ready(); await control(id, 'refresh');
      const afterRestart = await docker(['inspect', '--format', '{{.State.StartedAt}}', id]);
      assert.ok(Date.parse(afterRestart) > Date.parse(beforeRestart), 'integration.restart_not_observed');
      const restarted = await control(id, 'evidence');
      assert.deepEqual(restarted.registration, evidence.registration); assert.equal(restarted.identitySha256, evidence.identitySha256);
      assert.equal(restarted.localVenueId, evidence.localVenueId);
      restarts.push({installationId: evidence.registration.installationId, before: beforeRestart, after: afterRestart});
      organisations.push({plan, organisationId, venueId: evidence.registration.venueId, installationId: evidence.registration.installationId,
        localVenueId: evidence.localVenueId, stateSha256: restarted.stateSha256, installationState: restarted.installationState, planRevision: planResult.revision});
    }
    for (const key of ['organisationId', 'venueId', 'installationId', 'localVenueId', 'stateSha256']) assert.equal(new Set(organisations.map(value => value[key])).size, 2, 'integration.distinct_' + key);
    result = {version: 1, kind: 'test-cloud-clients', runId, completeIntegration: false, origin, waitronHead: revision, image, waitronImage,
      accountMail: {free: 'proved', paid: 'proved', transport: 'mailpit'}, clients: {status: 'proved', actions: ['pair', 'renew', 'configuration'], demoVenues: 2, restartIdentity: 'proved'},
      tls: {untrustedRefused: true, wrongHostnameRefused: true}, organisations, freeSnapshot, restarts};
  } finally {
    try {
      await completeCleanup([
        {phase: 'discover-containers', run: async () => {
          if (started) for (const id of lines(await docker(['ps', '-aq', '--no-trunc', '--filter', 'label=com.docker.compose.project=' + project]))) {owned.push(id); record('container', id);}
        }},
        {phase: 'containers', run: () => completeCleanup([...new Set(owned)].map(id => ({phase: 'container', run: async () => {
          await docker(['rm', '-f', '-v', id], '', 'owned-container-cleanup'); removed.push(created.find(value => value.kind === 'container' && value.id === id));
        }})))},
        ...['network', 'volume'].map(kind => ({phase: kind, run: async () => {
          if (!started) return;
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
