import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:https';
import {test} from 'node:test';
import {mkdtemp, mkdir, readFile, writeFile, rmdir, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';

const load = () => import('./test-cloud-integration.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url?.endsWith('/test-cloud-integration.mjs')) return {};
  throw error;
});

test('the measured session failure survives in stderr after recovery', {concurrency: true}, async t => {
  const execute = promisify(execFile);
  const directory = await mkdtemp(join(tmpdir(), 'cloud-session-test-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const keyFile = join(directory, 'key.pem'), certFile = join(directory, 'cert.pem');
  await execute('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=localhost', '-keyout', keyFile, '-out', certFile], {timeout: 10_000});
  const [key, cert] = await Promise.all([readFile(keyFile), readFile(certFile)]);
  const child = `
    import {readFileSync} from 'node:fs';
    import {createMeasuredSessionProbe, requestIntegrationApi} from './scripts/test-cloud-integration.mjs';
    import {observeP1} from './scripts/p1-observer.mjs';
    const [port, certificate] = process.argv.slice(1);
    const options = {hostname: '127.0.0.1', servername: 'localhost', port: Number(port), ca: readFileSync(certificate)};
    const browser = {cookie: 'fixture-cookie-private'};
    const api = (path, body, headers, _trust, _servername, signal, _fresh, onHeaders) =>
      requestIntegrationApi({...options, path, signal, headers}, body, false, onHeaders);
    const session = createMeasuredSessionProbe(api, browser);
    try {
      const healthy = async () => true;
      await observeP1({probes: {session, remote: healthy, login: healthy, backup: healthy, signup: healthy},
        ready() {}, stopped() {}, replacement() {}});
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  `;
  const cases = [
    {name: 'HTML 503', status: 503, header: 'account.worker-2', node: 'account.worker-2', error: 'Error'},
    {name: 'invalid node', status: 503, header: 'fixture/header-private', node: 'unknown', error: 'Error'},
    {name: 'JSON 401', status: 401, node: 'unknown', error: 'AssertionError', publicCode: 'session_expired'},
    {name: 'unrecognized JSON error', status: 401, node: 'unknown', error: 'AssertionError'},
    {name: 'reset before headers', status: null, node: 'unknown', error: 'ECONNRESET'},
    {name: 'invalid TLS reply', status: null, node: 'unknown', error: 'EPROTO'},
    {name: 'silent connection', status: null, node: 'unknown', error: 'ETIMEDOUT'},
  ];
  await Promise.all(cases.map(failure => t.test(failure.name, async () => {
    const sockets = new Set();
    let calls = 0;
    const server = createServer({key, cert}, (req, res) => {
      assert.equal(req.url, '/api/account/session');
      assert.equal(req.headers.cookie, 'fixture-cookie-private');
      if (++calls <= 2) {
        if (failure.error === 'EPROTO') res.setHeader('connection', 'close');
        res.end('{"expiresAt":"2026-11-25T22:30:00.000Z"}');
      } else if (failure.header) {
        res.writeHead(503, {'x-waitron-test-account-node': failure.header});
        res.end('<p>fixture-body-private</p>');
      } else if (failure.status === 401) {
        res.writeHead(401).end(JSON.stringify({error: failure.publicCode ?? 'fixture-body-private'}));
      } else if (failure.error === 'ECONNRESET') res.destroy();
    });
    server.prependListener('connection', socket => {
      if (failure.error === 'EPROTO' && calls === 2) socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n');
    });
    server.on('connection', socket => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    await once(server.listen(0, '127.0.0.1'), 'listening');
    try {
      await assert.rejects(execute(process.execPath,
        ['--input-type=module', '-e', child, String(server.address().port), certFile],
        {cwd: new URL('../', import.meta.url), timeout: 20_000}), result => {
        assert.equal(result.code, 1, result.stderr);
        assert.match(result.stderr, /p1\.session_after_recovery/);
        const lines = result.stderr.split('\n').filter(line => line.startsWith('D621 session probe '));
        assert.equal(lines.length, 1, result.stderr);
        const {at, elapsedMs, status, node, error, expiresAt, code} = JSON.parse(lines[0].slice('D621 session probe '.length));
        assert.ok(Number.isFinite(at) && Math.abs(Date.now() - at) < 20_000);
        assert.ok(elapsedMs >= 0 && elapsedMs < 6500);
        if (failure.error === 'ETIMEDOUT') assert.ok(elapsedMs >= 4900);
        assert.deepEqual({status, node, error}, {status: failure.status, node: failure.node, error: failure.error});
        assert.equal(expiresAt, '2026-11-25T22:30:00.000Z');
        assert.equal(code, failure.publicCode ?? null);
        assert.doesNotMatch(result.stderr, /fixture-(?:cookie|body)-private|fixture\/header-private|integration\.invalid_json/);
        return true;
      });
      assert.equal(calls, failure.error === 'EPROTO' ? 2 : 3);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    }
  })));
});

test('measured activity renews the original session and leaves subsequent reads passive', async t => {
  const {createMeasuredSessionProbe} = await load();
  const browser = {cookie: 'original-cookie', 'x-csrf-token': 'original-csrf'};
  const requests = [], expiresAt = '2026-11-25T22:30:00.000Z';
  const stderr = t.mock.method(process.stderr, 'write', () => true);
  const session = createMeasuredSessionProbe(async (path, body, credentials) => {
    requests.push({path, body, credentials});
    return {status: 200, body: {expiresAt: requests.length < 3 ? expiresAt : 'fixture-deadline-private', accountId: 'fixture-account'}};
  }, browser);
  assert.equal(typeof session.activity, 'function');
  assert.deepEqual(await session.activity(), {status: 200, expiresAt});
  assert.deepEqual(await session(undefined, true), {status: 200, expiresAt});
  assert.deepEqual(requests, [
    {path: '/api/account/session/activity', body: {}, credentials: browser},
    {path: '/api/account/session', body: undefined, credentials: browser},
  ]);
  await assert.rejects(session.activity(), /p1.session_deadline/);
  const trace = stderr.mock.calls[0].arguments[0];
  assert.match(trace, /"expiresAt":"2026-11-25T22:30:00.000Z"/);
  assert.doesNotMatch(trace, /fixture-deadline-private/);
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

const observerExpiry = '2026-11-24T14:05:20.123Z';
const currentSignInMail = {Username: 'node-b', ID: 'inbox-current', MessageID: '11111111-1111-4111-8111-111111111111@example.test',
  Text: 'Your Waitron Cloud verification code\n\n123456\n\nThis single-use code expires at Nov 24, 2026, 2:05:20\u202fPM UTC.\n'};
const staleSignInMail = {ID: 'inbox-stale', MessageID: '22222222-2222-4222-8222-222222222222@example.test',
  Text: 'Your Waitron Cloud verification code\n\n654321\n\nThis single-use code expires at Nov 24, 2026, 2:05:05 PM UTC.\n'};

test('observer password sign-in completes its real email challenge and retains it across a mail wait', async () => {
  const {createObserverLogin} = await load(); assert.equal(typeof createObserverLogin, 'function');
  const requests = [], events = [];
  const olderMail = [staleSignInMail, {...staleSignInMail, ID: 'inbox-stale-copy'}];
  let currentDelivered = false;
  const login = createObserverLogin({email: 'owner@example.test', password: 'synthetic password', cookie: 'recognised', rememberBrowser: true,
    onStage: event => events.push(event),
    mailbox: async () => ({messages: [{ID: 'old'}]}),
    readMail: async (email, seen) => {
      assert.equal(email, 'owner@example.test');
      assert.ok(seen.has('old'));
      const stale = olderMail.find(message => !seen.has(message.ID));
      if (stale) return stale;
      if (!currentDelivered) throw Error('mail delayed');
      return currentSignInMail;
    },
    api: async (path, body, headers) => {
      requests.push(path);
      if (path === '/api/account/login') {assert.equal(headers.cookie, 'recognised'); return {status: 202, body: {emailRequired: true, challengeToken: 'private-challenge', expiresAt: observerExpiry}};}
      assert.equal(path, '/api/account/login/email'); assert.deepEqual(body, {challengeToken: 'private-challenge', code: '123456', rememberBrowser: true}); return {status: 200};
    }});
  await assert.rejects(login(), /mail delayed/);
  currentDelivered = true;
  assert.deepEqual(await login(), {status: 200});
  assert.deepEqual(requests, ['/api/account/login', '/api/account/login/email']);
  assert.deepEqual(events.filter(event => event.stage === 'mail-delivered' && event.outcome !== 'started'), [
    {stage: 'mail-delivered', outcome: 'Error', skipped: 2},
    {stage: 'mail-delivered', outcome: 'completed', skipped: 0},
  ]);
});

test('a lost email-code submission reply starts a fresh sign-in instead of replaying the used code', async () => {
  const {createObserverLogin} = await load(); let starts = 0, submissions = 0;
  const login = createObserverLogin({email: 'owner@example.test', password: 'synthetic', cookie: 'recognised',
    mailbox: async () => ({messages: []}), readMail: async () => currentSignInMail,
    api: async (path, body) => {
      if (path === '/api/account/login') return {status: 202, body: {emailRequired: true, challengeToken: 'challenge-' + ++starts, expiresAt: observerExpiry}};
      assert.equal(body.challengeToken, 'challenge-' + starts);
      if (++submissions === 1) throw Error('reply lost'); return {status: starts === 2 ? 200 : 400};
    }});
  await assert.rejects(login(), /reply lost/);
  assert.deepEqual(await login(), {status: 200}); assert.equal(starts, 2);
});

for (const {name, messages, status, malformedId = false} of [
  {name: 'stale mail arrives first', messages: [staleSignInMail, currentSignInMail], status: 200},
  {name: 'current mail arrives first', messages: [currentSignInMail, staleSignInMail], status: 200},
  {name: 'confirmation refuses the selected code', messages: [currentSignInMail, staleSignInMail], status: 401},
  {name: 'a malformed Message-ID stays private', messages: [{...currentSignInMail, MessageID: 'private 123456'}], status: 200, malformedId: true},
]) test('after a lost password reply, ' + name, async () => {
  const {createObserverLogin} = await load();
  const submissions = [], events = [];
  let starts = 0;
  const login = createObserverLogin({email: 'observer@example.test', password: 'synthetic',
    mailbox: async () => ({messages: []}),
    readMail: async (_email, seen) => messages.find(message => !seen.has(message.ID)),
    onStage: event => events.push(event),
    async api(path, body) {
      if (path === '/api/account/login') {
        if (++starts === 1) throw Object.assign(Error('reply lost with private text 654321'), {name: 'Private 123456'});
        return {status: 202, body: {emailRequired: true, challengeToken: 'current-challenge', expiresAt: observerExpiry}};
      }
      assert.equal(path, '/api/account/login/email');
      submissions.push(body);
      return {status: body.code === '123456' ? status : 401};
    }});
  await assert.rejects(login(), /reply lost/);
  assert.deepEqual(await login(), {status});
  assert.deepEqual(submissions, [{challengeToken: 'current-challenge', code: '123456'}]);
  const messageId = malformedId ? undefined : currentSignInMail.MessageID;
  assert.deepEqual(events, [
    {stage: 'mailbox-before-password', outcome: 'started'},
    {stage: 'mailbox-before-password', outcome: 'completed'},
    {stage: 'password', outcome: 'started'},
    {stage: 'password', outcome: 'Error'},
    {stage: 'mailbox-before-password', outcome: 'started'},
    {stage: 'mailbox-before-password', outcome: 'completed'},
    {stage: 'password', outcome: 'started'},
    {stage: 'password', outcome: 202},
    {stage: 'mail-delivered', outcome: 'started', skipped: 0},
    {stage: 'mail-delivered', outcome: 'completed', skipped: messages[0] === staleSignInMail ? 1 : 0},
    {stage: 'confirmation', outcome: 'started', messageId, username: 'node-b'},
    {stage: 'confirmation', outcome: status, messageId, username: 'node-b'},
  ]);
});

for (const status of [200, 401]) test('a stranded sign-in starts over after the mail worker lease expires: ' + status, async () => {
  const {createObserverLogin} = await load();
  let clock = 0, starts = 0;
  const submissions = [];
  const login = createObserverLogin({email: 'observer@example.test', password: 'synthetic',
    replaceStranded: true, now: () => clock, mailbox: async () => ({messages: starts ? [{ID: 'already-delivered'}] : []}),
    async readMail(_email, seen) {
      if (starts === 1) throw Error('mail stranded');
      assert.ok(seen.has('already-delivered'));
      if (!seen.has(staleSignInMail.ID)) return staleSignInMail;
      return currentSignInMail;
    },
    async api(path, body) {
      if (path === '/api/account/login') return {status: 202, body: {emailRequired: true,
        challengeToken: 'challenge-' + ++starts, expiresAt: starts === 1 ? '2026-11-24T14:04:20.123Z' : observerExpiry}};
      submissions.push(body);
      return {status: body.code === '123456' ? status : 400};
    }});
  await assert.rejects(login(), /mail stranded/);
  clock = 59_999;
  await assert.rejects(login(), /mail stranded/);
  assert.equal(starts, 1);
  clock = 60_000;
  assert.deepEqual(await login(), {status});
  assert.deepEqual(submissions, [{challengeToken: 'challenge-2', code: '123456'}]);
  assert.equal(starts, 2);
});

test('the outside observer can start email sign-in without a recognised browser', async () => {
  const {createObserverLogin} = await load();
  const login = createObserverLogin({email: 'observer@example.test', password: 'synthetic',
    mailbox: async () => ({messages: []}), readMail: async () => currentSignInMail,
    api: async (path, _body, headers) => {
      assert.deepEqual(headers, {});
      if (path === '/api/account/login') return {status: 202, body: {emailRequired: true, challengeToken: 'new-challenge', expiresAt: observerExpiry}};
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
    proxyIp: '172.30.250.9', port: 3000, mailPort: 38025, ca: 'synthetic', storeCa: 'synthetic',
    mailAuthorization: 'synthetic', exec: noIo, stockholmRemote: {gatewayIp: '172.30.250.9', peerTraffic: noIo},
    verifier: Object.fromEntries(['start', 'identity', 'docker', 'running', 'stop', 'exitCode'].map(name => [name, noIo]))};
  const run = kubernetes => runTestCloudClients({stockholmBaseline: true, kubernetes});
  await assert.rejects(run(target), /integration\.image_invalid/);
  for (const changed of [{proxyIp: '127.0.0.1'}, {proxyIp: '10.77.0.1'}, {proxyIp: '172.30.250.3'}, {port: 3443}, {network: 'other-network'}, {mailPort: undefined},
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

test('the inbox witness reads the saved message by ID even if the list has changed', async () => {
  const {captureInboxWitness} = await load();
  assert.equal(typeof captureInboxWitness, 'function');
  const paths = [];
  const witness = await captureInboxWitness(async path => {
    paths.push(path);
    if (paths.length === 1) return {messages: [{ID: 'saved+message'}]};
    if (paths.length === 2) return {ID: 'saved+message'};
    return {ID: 'different-message'};
  });
  assert.deepEqual(paths, ['messages']);
  assert.equal(await witness(), true);
  await assert.rejects(witness(), /integration\.inbox_witness_changed/);
  assert.deepEqual(paths, ['messages', 'message/saved%2Bmessage', 'message/saved%2Bmessage']);
  await assert.rejects(captureInboxWitness(async () => ({messages: []})), /integration\.inbox_witness_missing/);
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
    Text: 'https://cloud.example.test:3000/signup#token=' + token, Username: 'surviving-mail',
  }), 'venue@example.test', 'https://cloud.example.test:3000', AbortSignal.timeout(5000), true),
  {token, worker: 'surviving-mail'});
  await assert.rejects(readOutsideSignupMail(async () => ({
    Text: 'https://cloud.example.test:3000/signup#token=' + token, worker: 'untrusted-caller-field',
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
