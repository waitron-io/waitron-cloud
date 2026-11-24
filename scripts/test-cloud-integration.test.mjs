import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, mkdir, writeFile, rmdir, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const load = () => import('./test-cloud-integration.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url?.endsWith('/test-cloud-integration.mjs')) return {};
  throw error;
});

test('client proof refuses mutable image references before creating resources', async () => {
  const {runTestCloudClients} = await load();
  assert.equal(typeof runTestCloudClients, 'function', 'The genuine client proof is not implemented');
  for (const options of [{}, {image: 'cloud:latest', waitronImage: 'waitron:latest'}, {image: 'sha256:' + 'a'.repeat(64), waitronImage: 'waitron:latest'}]) {
    await assert.rejects(runTestCloudClients(options), /integration\.image_invalid/);
  }
});

test('protected inventory permits another lane to finish its temporary containers', async () => {
  const {checkProtectedContainers} = await load();
  assert.equal(typeof checkProtectedContainers, 'function', 'Protected inventory comparison is not implemented');
  const permanent = 'a'.repeat(64), temporary = 'b'.repeat(64);
  assert.equal(checkProtectedContainers([permanent + ' true 2026-10-20', temporary + ' true 2026-10-23'], [permanent + ' true 2026-10-20'], [permanent]), true);
  for (const after of [[], [permanent + ' false 2026-10-20'], [permanent + ' true 2026-10-23']]) assert.throws(() => checkProtectedContainers([permanent + ' true 2026-10-20'], after, [permanent]), /integration\.protected_container_changed/);
  assert.throws(() => checkProtectedContainers([], [], [permanent]), /integration\.protected_container_missing/);
});

test('malformed private replies fail without including their contents', async () => {
  const {parseIntegrationJson} = await load();
  assert.equal(typeof parseIntegrationJson, 'function', 'Private reply decoding is not implemented');
  assert.deepEqual(parseIntegrationJson('{"status":"ready"}'), {status: 'ready'});
  assert.throws(() => parseIntegrationJson('{"token":"PRIVATE_ACCOUNT_CANARY"}trailing'), error => {
    assert.equal(error.message, 'integration.invalid_json');
    assert.equal(String(error.stack).includes('PRIVATE_ACCOUNT_CANARY'), false);
    return true;
  });
});

test('one failed owned cleanup cannot leave other removable resources behind', async () => {
  const {completeCleanup} = await load();
  assert.equal(typeof completeCleanup, 'function', 'Independent cleanup is not implemented');
  const root = await mkdtemp(join(tmpdir(), 'cloud-client-cleanup-'));
  try {
    await mkdir(join(root, 'busy')); await writeFile(join(root, 'busy', 'data'), 'fixture'); await mkdir(join(root, 'removable'));
    await assert.rejects(completeCleanup([
      {phase: 'busy', run: () => rmdir(join(root, 'busy'))},
      {phase: 'removable', run: () => rmdir(join(root, 'removable'))},
    ]), {message: 'integration.cleanup_failed:busy'});
    await assert.rejects(stat(join(root, 'removable')), {code: 'ENOENT'});
    assert.equal((await stat(join(root, 'busy', 'data'))).isFile(), true);
  } finally {await rm(root, {recursive: true, force: true});}
});

// Removing signup, either real client, lease/configuration exchange or exact cleanup breaks this journey.
test('two demo Waitron venues pair free and paid signup accounts through trusted HTTPS', {
  skip: !process.env.TEST_CLOUD_INTEGRATION_IMAGE || !process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
  timeout: 300000,
}, async () => {
  const {runTestCloudClients} = await load();
  assert.equal(typeof runTestCloudClients, 'function', 'The genuine client proof is not implemented');
  const receipt = await runTestCloudClients({image: process.env.TEST_CLOUD_INTEGRATION_IMAGE, waitronImage: process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE, protectedContainerIds: JSON.parse(process.env.TEST_CLOUD_PROTECTED_CONTAINER_IDS ?? '[]')});
  assert.equal(receipt.kind, 'test-cloud-clients');
  assert.equal(receipt.completeIntegration, false);
  assert.equal(receipt.origin, 'https://waitron.local:3000');
  assert.equal(receipt.waitronHead, '8eed667ab0586a3144ed7911b57cf50fcb3b0766');
  assert.deepEqual(receipt.accountMail, {free: 'proved', paid: 'proved', transport: 'mailpit'});
  assert.deepEqual(receipt.clients, {status: 'proved', actions: ['pair', 'renew', 'configuration'], demoVenues: 2, restartIdentity: 'proved'});
  assert.deepEqual(receipt.tls, {untrustedRefused: true, wrongHostnameRefused: true});
  assert.deepEqual(receipt.freeSnapshot, {status: 'proved', httpStatus: 403, error: 'permission_denied', grantIssued: false});
  assert.deepEqual(receipt.organisations.map(value => value.plan), ['free', 'paid']);
  for (const key of ['organisationId', 'venueId', 'installationId', 'streamId', 'stateSha256']) assert.equal(new Set(receipt.organisations.map(value => value[key])).size, 2, key);
  for (const value of receipt.organisations) {
    assert.match(value.stateSha256, /^[a-f0-9]{64}$/);
    assert.equal(value.installationState, 'active');
    assert.equal(value.planRevision, value.plan === 'paid' ? 1 : 0);
  }
  assert.ok(Array.isArray(receipt.restarts), 'The proof must observe each actual container restart');
  assert.equal(receipt.restarts.length, 2);
  for (let i = 0; i < 2; i++) {
    assert.equal(receipt.restarts[i].installationId, receipt.organisations[i].installationId);
    assert.ok(Date.parse(receipt.restarts[i].after) > Date.parse(receipt.restarts[i].before));
  }
  assert.equal(receipt.cleanup.created.length > 0, true);
  assert.deepEqual(receipt.cleanup.removed, receipt.cleanup.created);
  assert.deepEqual(receipt.cleanup.remaining, []);
  assert.equal(receipt.protectedContainersUnchanged, true);
  const text = JSON.stringify(receipt);
  for (const forbidden of ['BEGIN PRIVATE', 'token=', 'password', 'privateKey', 'payload', 'signature', 'lease', 'csrf', 'code', 'cookie']) assert.equal(text.includes(forbidden), false, forbidden);
});

// Observation must preserve the original cookie and process through the final probe.
test('retained-client adapter checks sign-in responses, identity and process without replacing the client', async () => {
  const {observeRetainedClients} = await load(); assert.equal(typeof observeRetainedClients, 'function');
  for (const scenario of ['healthy', 'cache refreshed', 'session lost', 'restarted', 'identity changed', 'stream changed']) {
    let reads = 0, observed = false;
    const evidence = {registration: {venueId: 'synthetic'}, identitySha256: 'a', stateSha256: 'b', streamId: 'stream'};
    const run = observeRetainedClients({paid: {id: 'original-client'}, browser: {cookie: 'original-session'},
      api: async (path, body, headers) => {
        assert.equal(headers.cookie, 'original-session');
        assert.equal(path, '/api/account/session'); return {status: scenario === 'session lost' ? 401 : 200};
      }, login: async () => ({status: 200}), signup: async () => ({status: 201}),
      backup: async () => ({restored: true}), remote: async () => {},
      docker: async args => {assert.equal(args.at(-1), 'original-client'); return scenario === 'restarted' && observed ? 'later' : 'initial';},
      control: async (id, action) => {assert.equal(id, 'original-client'); assert.equal(action, 'evidence'); reads++; return {...evidence, ...(observed && scenario === 'cache refreshed' ? {stateSha256: 'later-cache'} : {}), ...(observed && scenario === 'identity changed' ? {identitySha256: 'changed'} : {}), ...(observed && scenario === 'stream changed' ? {streamId: 'changed'} : {})};},
      observe: async probes => {await probes.session(); await probes.login(); await probes.signup(); await probes.backup(); await probes.remote(); observed = true; return {offMs: 900000};}});
    if (scenario === 'healthy' || scenario === 'cache refreshed') {assert.deepEqual(await run, {offMs: 900000}); assert.equal(reads, 2);}
    else await assert.rejects(run, scenario === 'session lost' ? /p1.session/ : scenario === 'restarted' ? /p1.venue_restarted/ : scenario === 'stream changed' ? /p1.venue_state:streamId/ : /p1.venue_state:identitySha256/);
  }
});

test('observer password sign-in completes its real email challenge and retains it across a mail wait', async () => {
  const {createObserverLogin} = await load(); assert.equal(typeof createObserverLogin, 'function');
  const requests = []; let reads = 0;
  const login = createObserverLogin({email: 'owner@example.test', password: 'synthetic password', cookie: 'recognised', rememberBrowser: true,
    mailbox: async () => ({messages: [{ID: 'old'}]}),
    readMail: async (email, seen) => {assert.equal(email, 'owner@example.test'); assert.ok(seen.has('old')); if (++reads === 1) throw Error('mail delayed'); return {Text: 'Your Waitron Cloud verification code\n\n123456\n'};},
    api: async (path, body, headers) => {
      requests.push(path);
      if (path === '/api/account/login') {assert.equal(headers.cookie, 'recognised'); return {status: 202, body: {emailRequired: true, challengeToken: 'private-challenge'}};}
      assert.equal(path, '/api/account/login/email'); assert.deepEqual(body, {challengeToken: 'private-challenge', code: '123456', rememberBrowser: true}); return {status: 200};
    }});
  await assert.rejects(login(), /mail delayed/);
  assert.deepEqual(await login(), {status: 200});
  assert.deepEqual(requests, ['/api/account/login', '/api/account/login/email']);
});

test('a lost email-code submission reply starts a fresh sign-in instead of replaying the used code', async () => {
  const {createObserverLogin} = await load(); let starts = 0, submissions = 0;
  const login = createObserverLogin({email: 'owner@example.test', password: 'synthetic', cookie: 'recognised',
    mailbox: async () => ({messages: []}), readMail: async () => ({Text: '\n123456\n'}),
    api: async (path, body) => {
      if (path === '/api/account/login') return {status: 202, body: {emailRequired: true, challengeToken: 'challenge-' + ++starts}};
      assert.equal(body.challengeToken, 'challenge-' + starts);
      if (++submissions === 1) throw Error('reply lost'); return {status: starts === 2 ? 200 : 400};
    }});
  await assert.rejects(login(), /reply lost/);
  assert.deepEqual(await login(), {status: 200}); assert.equal(starts, 2);
});

for (const replacementStatus of [200, 401, undefined]) test(
  'a replaced sign-in handles late mail with replacement status ' + replacementStatus, async () => {
  const {createObserverLogin} = await load();
  let clock = 0, starts = 0, completions = 0;
  const messages = [{ID: 'stranded', Text: '\n100001\n'}];
  if (replacementStatus) messages.push({ID: 'replacement', Text: '\n100002\n'}, {ID: 'surplus', Text: '\n100003\n'});
  const login = createObserverLogin({email: 'observer@example.test', password: 'synthetic',
    replaceStranded: true, now: () => clock, mailbox: async () => ({messages: starts ? [{ID: 'already-delivered'}] : []}),
    async readMail(_email, seen) {
      if (starts === 1) throw Error('mail stranded');
      assert.ok(seen.has('already-delivered'));
      const message = messages.find(message => !seen.has(message.ID));
      if (!message) throw Error('integration.mail_missing');
      return message;
    },
    async api(path, body) {
      if (path === '/api/account/login') return {status: 202, body: {emailRequired: true, challengeToken: 'challenge-' + ++starts}};
      assert.equal(body.challengeToken, 'challenge-2');
      completions++;
      return {status: body.code === '100002' ? replacementStatus : 401};
    }});
  await assert.rejects(login(), /mail stranded/);
  clock = 59_999;
  await assert.rejects(login(), /mail stranded/);
  assert.equal(starts, 1);
  clock = 60_000;
  assert.deepEqual(await login(), {status: replacementStatus ?? 401});
  assert.equal(completions, replacementStatus ? 2 : 1);
  assert.equal(starts, 2);
});

test('the outside observer can start email sign-in without a recognised browser', async () => {
  const {createObserverLogin} = await load();
  const login = createObserverLogin({email: 'observer@example.test', password: 'synthetic',
    mailbox: async () => ({messages: []}), readMail: async () => ({Text: '\n123456\n'}),
    api: async (path, _body, headers) => {
      assert.deepEqual(headers, {});
      if (path === '/api/account/login') return {status: 202, body: {emailRequired: true, challengeToken: 'new-challenge'}};
      return {status: 200};
    }});
  assert.deepEqual(await login(), {status: 200});
});

test('production rehearsal refuses a remote target even with a valid local Kind binding', async () => {
  const {runTestCloudClients} = await load();
  const cluster = 'd621-' + 'a'.repeat(32);
  const local = {
    cluster, namespace: 'd621-data', network: cluster, account: 'kube-account',
    ca: 'test certificate', storeCa: 'test store certificate', mailAuthorization: 'synthetic',
    proxyIp: '172.30.250.2', port: 3000, mailPort: 8025, exec: () => assert.fail('command must not start'),
    verifier: Object.fromEntries(['start', 'identity', 'docker', 'running', 'stop', 'exitCode']
      .map(name => [name, () => assert.fail('verifier must not start')])),
  };
  await assert.rejects(runTestCloudClients({services: true, kubernetes: local}), /integration\.image_invalid/);
  for (const remote of [
    {remote: {worker: () => assert.fail('remote command must not start')}},
    {stockholmRemote: {handover: () => assert.fail('gateway command must not start')}},
    {amazon: {phase: 'before'}},
  ]) {
    await assert.rejects(runTestCloudClients({services: true, kubernetes: {...local, ...remote}}), /integration\.services_binding/);
  }
});

test('outside baseline requires the owned private route, inbox, peer and verifier', async () => {
  const {runTestCloudClients} = await load();
  const cluster = 'd618-85e61869-0ce9-4cf5-ab51-b2335fb89bc6';
  const noIo = () => assert.fail('must validate before using the target');
  const amazon = {type: 'amazon', cluster, context: cluster, address: '10.77.0.1', phase: 'baseline',
    instances: ['1', '2', '3'].map(n => 'i-' + n.repeat(17)),
    nodes: ['-control-plane', '-worker', '-worker2'].map(suffix => cluster + suffix)};
  const target = {amazon, cluster, namespace: 'd621-data', network: cluster, account: 'kube-account',
    proxyIp: '172.30.250.9', port: 3000, readInbox: noIo, ca: 'synthetic', storeCa: 'synthetic',
    mailAuthorization: 'synthetic', exec: noIo, stockholmRemote: {gatewayIp: '172.30.250.9', peerTraffic: noIo},
    verifier: Object.fromEntries(['start', 'identity', 'docker', 'running', 'stop', 'exitCode'].map(name => [name, noIo]))};
  const run = kubernetes => runTestCloudClients({stockholmBaseline: true, kubernetes});
  await assert.rejects(run(target), /integration\.image_invalid/);
  for (const changed of [{proxyIp: '127.0.0.1'}, {proxyIp: '10.77.0.1'}, {proxyIp: '172.30.250.3'}, {port: 3443}, {network: 'other-network'}, {readInbox: undefined},
    {verifier: undefined}, {stockholmRemote: {}}, {stopServices: noIo}, {amazon: {...amazon, phase: 'before'}}]) {
    await assert.rejects(run({...target, ...changed}), /(?:integration\.stockholm_baseline_binding|kubernetes\.amazon_binding)/);
  }
  await assert.rejects(run({...target, amazon: undefined}), /integration\.stockholm_baseline_binding/);
  const localCluster = 'd621-' + 'a'.repeat(32);
  const local = {...target, amazon: undefined, cluster: localCluster, network: localCluster, stopServices: noIo};
  await assert.rejects(run(local), /integration\.image_invalid/);
  await assert.rejects(run({...local, stopServices: true}), /integration\.stockholm_baseline_binding/);
  for (const option of ['services', 'paidVerification', 'stockholmRemote']) {
    await assert.rejects(runTestCloudClients({stockholmBaseline: true, kubernetes: target, [option]: true}),
      /integration\.stockholm_baseline_scope/);
  }
});

test('the outside signup check retries a failed inbox read', async () => {
  const {readOutsideSignupMail} = await load();
  assert.equal(typeof readOutsideSignupMail, 'function');
  let reads = 0;
  const token = 'a'.repeat(43);
  assert.equal(await readOutsideSignupMail(async (_email, seen, signal) => {
    assert.equal(seen.size, 0);
    assert.ok(!signal.aborted);
    if (++reads === 1) throw new DOMException('mailbox read timed out', 'TimeoutError');
    return {Text: 'https://cloud.example.test:3000/signup#token=' + token};
  }, 'venue@example.test', 'https://cloud.example.test:3000', AbortSignal.timeout(5000)), token);
  assert.equal(reads, 2);
  assert.deepEqual(await readOutsideSignupMail(async () => ({
    Text: 'https://cloud.example.test:3000/signup#token=' + token, worker: 'surviving-mail',
  }), 'venue@example.test', 'https://cloud.example.test:3000', AbortSignal.timeout(5000), true),
  {token, worker: 'surviving-mail'});
  await assert.rejects(readOutsideSignupMail(async () => ({
    Text: 'https://cloud.example.test:3000/signup#token=' + token,
  }), 'venue@example.test', 'https://cloud.example.test:3000', AbortSignal.timeout(5000), true),
  /integration\.outside_mail_worker/);
});

test('the outside backup inspection retries one storage deadline and stops', async () => {
  const {readOutsideRetainedBackup} = await load();
  assert.equal(typeof readOutsideRetainedBackup, 'function');
  const timeout = Error('kubectl exec failed\n  Error: backup.cancelled\ncommand terminated with exit code 1');
  const signal = AbortSignal.timeout(5000);
  let calls = 0;
  assert.equal(await readOutsideRetainedBackup(async () => {
    if (++calls === 1) throw timeout;
    return 'retained evidence';
  }, signal), 'retained evidence');
  calls = 0;
  await assert.rejects(readOutsideRetainedBackup(async () => {calls++; throw timeout;}, signal), error => error === timeout);
  assert.equal(calls, 2);
});

test('the outside backup inspection can retry a fresh database connection timeout', async () => {
  const {readOutsideRetainedBackup} = await load();
  const timeout = Error('kubectl exec failed\n  Error: Connection terminated due to connection timeout\ncommand terminated with exit code 1');
  let calls = 0;
  assert.equal(await readOutsideRetainedBackup(async () => {
    if (++calls === 1) throw timeout;
    return 'retained evidence';
  }, AbortSignal.timeout(5000)), 'retained evidence');
  assert.equal(calls, 2);
});

test('the outside backup inspection immediately reports an integrity failure', async () => {
  const {readOutsideRetainedBackup} = await load();
  assert.equal(typeof readOutsideRetainedBackup, 'function');
  const mismatch = Error('kubectl exec failed\nAssertionError: original digest changed');
  let calls = 0;
  await assert.rejects(readOutsideRetainedBackup(async () => {calls++; throw mismatch;}, AbortSignal.timeout(5000)),
    error => error === mismatch);
  assert.equal(calls, 1);
});

test('a fresh outside backup keeps the original verification bound to its original capture', async () => {
  const {measureOutsideBackup} = await load();
  const original = {pointId: 'original', workerVerification: {attemptId: 'first'}};
  const newPoint = {pointId: 'fresh'};
  const run = (capture, stopped) => (measureOutsideBackup ?? (() => ({})))({
    original, capture,
    verify: async point => {assert.deepEqual(point, newPoint); return {attemptId: 'second'};},
    inspect: async point => {
      assert.deepEqual(point, {pointId: 'original', workerVerification: {attemptId: 'first'}});
      return {retainedSnapshotUnchanged: true};
    },
  }, AbortSignal.timeout(5000), stopped);
  assert.deepEqual(await run(async () => newPoint, true), {attemptId: 'second', retained: true});
  assert.deepEqual(await run(() => assert.fail('pre-stop read must use the existing capture'), false),
    {attemptId: 'first', retained: true});
  await assert.rejects(async () => run(async () => original, true), /integration\.fault_backup_not_new/);
});

test('the signed upload rehearsal checks the first fresh reply and any later reserve failures', async () => {
  const {checkSignedBackupReservations} = await load();
  const signed = {status: 200, uploadMethod: 'signed-put'};
  const legacy = {status: 200, uploadMethod: 'storage-session'};
  assert.deepEqual(checkSignedBackupReservations([signed]), {uploadMethod: 'signed-put', reserves: 1, reserve503s: 0});
  for (const replies of [[], [{status: 0}, signed], [{status: 400}, signed], [legacy, signed], [signed, legacy], [signed, {status: 503}]]) {
    assert.throws(() => checkSignedBackupReservations(replies), /integration\.signed_backup_/);
  }
});

test('the venue records a dropped reserve and keeps reply bodies private', async () => {
  const {observeBackupReservation} = await import('../deploy/test-cloud/test-fixtures/integration-snapshot-client.mjs');
  const replies = [], record = async reply => replies.push(reply);
  const error = new Error('connection dropped');
  await assert.rejects(observeBackupReservation(async () => {throw error;}, record), cause => cause === error);
  for (const body of ['upstream error', JSON.stringify({uploadUrl: 'https://store.example.test/backup?synthetic-signature',
    recoveryKey: 'synthetic-key'})]) {
    const response = new Response(body);
    assert.equal(await observeBackupReservation(async () => response, record), response);
    assert.equal(await response.text(), body);
  }
  const refused = new Response('upstream denied', {status: 403});
  assert.equal(await observeBackupReservation(async () => refused, record), refused);
  assert.equal(await refused.text(), 'upstream denied');
  assert.deepEqual(replies, [{status: 0}, {status: 200}, {status: 200, uploadMethod: 'signed-put'}, {status: 403}]);
});

test('after a full restart the last acknowledged backup is read before restoring a different capture', async () => {
  const {measureOutsideColdBackup} = await load();
  const original = {pointId: 'last-acknowledged', workerVerification: {attemptId: 'verified-before'}};
  for (const scenario of ['complete', 'same capture', 'same restore', 'missing old bytes']) {
    const calls = [];
    const run = measureOutsideColdBackup({
      original,
      inspect: async point => {
        assert.equal(point, original);
        calls.push('old backup');
        return {retainedSnapshotUnchanged: scenario !== 'missing old bytes'};
      },
      capture: async () => {
        calls.push('capture');
        return {pointId: scenario === 'same capture' ? original.pointId : 'new-capture'};
      },
      verify: async point => {
        calls.push('restore');
        assert.equal(point.pointId, 'new-capture');
        return {status: 'passed', attemptId: scenario === 'same restore' ? 'verified-before' : 'new-attempt', childAbsent: true};
      },
    }, new AbortController().signal);
    if (scenario === 'complete') {
      const result = await run;
      assert.deepEqual(calls, ['old backup', 'capture', 'restore']);
      assert.deepEqual([result.retainedPointId, result.pointId, result.attemptId], ['last-acknowledged', 'new-capture', 'new-attempt']);
    } else {
      await assert.rejects(run, /integration.cold_backup/);
      assert.equal(calls.includes('restore'), scenario === 'same restore');
    }
  }
});

test('the signup reader accepts the mailed language parameter and refuses another origin', async () => {
  const {readSignupToken} = await load();
  assert.equal(typeof readSignupToken, 'function', 'the authenticated rehearsal needs to read the signup link');
  const token = 'a'.repeat(43);
  const text = 'Verify\n\nhttps://cloud.example.test:3000/signup#token=' + token + '&lang=en\n\nExpires';
  assert.equal(readSignupToken(text, 'https://cloud.example.test:3000'), token);
  assert.throws(() => readSignupToken(text, 'https://other.example.test:3000'), /integration\.signup_mail/);
});

test('the private remote rehearsal cannot run with the paid plan or a foreign namespace', async () => {
  const {runTestCloudClients} = await load();
  await assert.rejects(runTestCloudClients({stockholmRemote: true, services: true}), /integration\.stockholm_remote_scope/);
  await assert.rejects(runTestCloudClients({stockholmRemote: true, paidVerification: true}), /integration\.stockholm_remote_scope/);
  await assert.rejects(runTestCloudClients({stockholmRemote: true, paidRemote: true}), /integration\.stockholm_remote_scope/);
  await assert.rejects(runTestCloudClients({stockholmRemote: true, kubernetes: {namespace: 'default'}}),
    /integration\.stockholm_remote_binding/);
});


test('the gateway-machine fault requires the private Kind remote rehearsal', async () => {
  const {runTestCloudClients} = await load();
  await assert.rejects(runTestCloudClients({stockholmGatewayMachineLoss: true, services: true}),
    /integration\.stockholm_machine_loss_scope/);
  await assert.rejects(runTestCloudClients({stockholmGatewayMachineLoss: true}), /integration\.stockholm_machine_loss_scope/);
});


test('the Waitron tunnel image is accepted only by the private gateway-machine fault', async () => {
  const {runTestCloudClients} = await load();
  const waitronTunnelImage = 'sha256:' + 'b'.repeat(64);
  for (const options of [{}, {stockholmRemote: true}, {services: true}]) {
    await assert.rejects(runTestCloudClients({...options, waitronTunnelImage}), /integration\.waitron_tunnel_scope/);
  }
  await assert.rejects(runTestCloudClients({stockholmRemote: true, stockholmGatewayMachineLoss: true,
    waitronTunnelImage: 'waitron-tunnel:latest'}), /integration\.waitron_tunnel_image/);
});
