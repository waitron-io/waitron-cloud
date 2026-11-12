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
  for (const scenario of ['healthy', 'session lost', 'restarted']) {
    let reads = 0, observed = false;
    const evidence = {registration: {venueId: 'synthetic'}, identitySha256: 'a', stateSha256: 'b', localVenueId: 'venue'};
    const run = observeRetainedClients({paid: {id: 'original-client'}, browser: {cookie: 'original-session'},
      api: async (path, body, headers) => {
        assert.equal(headers.cookie, 'original-session');
        assert.equal(path, '/api/account/session'); return {status: scenario === 'session lost' ? 401 : 200};
      }, login: async () => ({status: 200}), signup: async () => ({status: 201}),
      backup: async () => ({restored: true}), remote: async () => {},
      docker: async args => {assert.equal(args.at(-1), 'original-client'); return scenario === 'restarted' && observed ? 'later' : 'initial';},
      control: async (id, action) => {assert.equal(id, 'original-client'); assert.equal(action, 'evidence'); reads++; return evidence;},
      observe: async probes => {await probes.session(); await probes.login(); await probes.signup(); await probes.backup(); await probes.remote(); observed = true; return {offMs: 900000};}});
    if (scenario === 'healthy') {assert.deepEqual(await run, {offMs: 900000}); assert.equal(reads, 2);}
    else await assert.rejects(run, scenario === 'session lost' ? /p1.session/ : /p1.venue_restarted/);
  }
});

test('observer password sign-in completes its real email challenge and retains it across a mail wait', async () => {
  const {createObserverLogin} = await load(); assert.equal(typeof createObserverLogin, 'function');
  const requests = []; let reads = 0;
  const login = createObserverLogin({email: 'owner@example.test', password: 'synthetic password', cookie: 'recognised',
    mailbox: async () => ({messages: [{ID: 'old'}]}),
    readMail: async (email, seen) => {assert.equal(email, 'owner@example.test'); assert.ok(seen.has('old')); if (++reads === 1) throw Error('mail delayed'); return {Text: 'Your Waitron Cloud verification code\n\n123456\n'};},
    api: async (path, body, headers) => {
      requests.push(path);
      if (path === '/api/account/login') {assert.equal(headers.cookie, 'recognised'); return {status: 202, body: {emailRequired: true, challengeToken: 'private-challenge'}};}
      assert.equal(path, '/api/account/login/email'); assert.deepEqual(body, {challengeToken: 'private-challenge', code: '123456'}); return {status: 200};
    }});
  await assert.rejects(login(), /mail delayed/);
  assert.deepEqual(await login(), {status: 200});
  assert.deepEqual(requests, ['/api/account/login', '/api/account/login/email']);
});
