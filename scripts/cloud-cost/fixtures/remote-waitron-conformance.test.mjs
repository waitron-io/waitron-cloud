// Explicit local integration: pinned Waitron routes, generated venue and real gateway.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, randomBytes, randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import * as journey from '../local.mjs';
import { signManifest } from '../../../packages/remote-access/src/manifest.ts';

const environment = { PATH: process.env.PATH, LANG: 'C', TZ: 'UTC' };
const run = (command, args) => {
  try { return execFileSync(command, args, { env: environment, encoding: 'utf8', timeout: 30000,
    maxBuffer: 1048576, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch (error) {
    const failure = Error('Generated local gateway fixture failed');
    failure.journeyRefused = error.status === 1 && error.stdout?.length === 0
      && /Error: Invalid cloud cost remote journey/.test(error.stderr?.toString() ?? '');
    throw failure;
  }
};
const docker = (...args) => run('docker', args);
const keyPair = () => {
  const key = generateKeyPairSync('x25519');
  return { privateKey: key.privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('base64'),
    publicKey: key.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64') };
};
async function wait(check) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { try { if (await check()) return; } catch {} await delay(100); }
  throw Error('Generated local gateway readiness failed');
}
const wire = id => {
  const fields = docker('exec', id, 'wg', 'show', 'wg-cloud', 'transfer').split(/\s+/);
  assert.equal(fields.length, 3);
  const received = Number(fields[1]), sent = Number(fields[2]);
  assert.ok(Number.isSafeInteger(received) && Number.isSafeInteger(sent)); return { received, sent };
};
const difference = (before, after) => ({ received: after.received - before.received, sent: after.sent - before.sent });

for (const fault of ['none', 'missing-person', 'invalid-canvases', 'false-availability', 'missing-cookie', 'anonymous-status', 'extra-config'])
test('pinnedWaitronOwnerReadsReconnectAndLogoutThroughTheGateway_' + fault, { timeout: 120000 }, async t => {
  assert.equal(typeof journey.measureRemoteJourneys, 'function', 'measure genuine owner and public routes');
  const fixture = JSON.parse(readFileSync(process.env.COST_OWNER_FIXTURE, 'utf8'));
  assert.equal(fixture.revision, 'fbadd15785464e59747e697c11048bfbc6e4938f');
  assert.equal(createHash('sha256').update(readFileSync(fixture.runtime)).digest('hex'), fixture.runtimeSha256);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cloud-cost-owner-'))), owner = randomUUID();
  const label = 'io.waitron.cloud-cost.remote-owner=' + owner, network = 'cost-remote-' + owner;
  const containers = []; let networkId;
  const secret = (path, value) => writeFileSync(join(root, path), value, { mode: 0o600 });
  const journal = entries => secret('ownership.json', JSON.stringify({ owner, containers, networkId, entries }));
  const start = args => {
    journal({ state: 'container-intent', sequence: containers.length });
    const id = docker('create', '--pull=never', '--label', label, '--network', network,
      '--cap-drop=ALL', '--cap-add=NET_ADMIN', '--cap-add=NET_BIND_SERVICE', '--read-only',
      '--security-opt=no-new-privileges:true', '--dns=127.0.0.1', '--log-driver=none',
      '--tmpfs=/tmp:rw,nosuid,size=16m', ...args);
    containers.push(id); journal({ state: 'container-created' }); docker('start', id); return id;
  };
  try {
    mkdirSync(join(root, 'src'), { mode: 0o700 }); mkdirSync(join(root, 'public-certs'), { mode: 0o700 });
    mkdirSync(join(root, 'state'), { mode: 0o700 }); mkdirSync(join(root, 'measure'), { mode: 0o700 });
    cpSync(new URL('../remote.mjs', import.meta.url), join(root, 'measure/remote.mjs'));
    cpSync(new URL('./remote-waitron-smoke.mjs', import.meta.url), join(root, 'measure/remote-waitron-smoke.mjs'));
    cpSync(new URL('../remote-journey.mjs', import.meta.url), join(root, 'measure/remote-journey.mjs'));
    mkdirSync(join(root, 'peer'), { mode: 0o700 });
    cpSync(new URL('../../../packages/remote-access/src/', import.meta.url), join(root, 'src'), { recursive: true });
    const gatewayKey = keyPair(), peerKey = keyPair(), cell = randomUUID(), issuer = generateKeyPairSync('ed25519');
    const staffHost = 'staff.generated.example.test', publicHost = 'generated.example.test';
    for (const [name, host] of [['staff', staffHost], ['public', publicHost]])
      run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(root, name + '.key'),
        '-out', join(root, name + '.pem'), '-days', '1', '-subj', '/CN=' + host, '-addext', 'subjectAltName=DNS:' + host]);
    const staffCa = readFileSync(join(root, 'staff.pem')), publicCa = readFileSync(join(root, 'public.pem'));
    secret('public-certs/venue.pem', Buffer.concat([readFileSync(join(root, 'public.key')), publicCa]));
    secret('issuer.pem', issuer.publicKey.export({ type: 'spki', format: 'pem' }));
    secret('wireguard.key', gatewayKey.privateKey); secret('bot.key', randomBytes(32));
    const now = Date.now(); secret('manifest.json', JSON.stringify(signManifest({ version: 1, audience: 'waitron-cloud-gateway',
      cellId: cell, sequence: 1, issuedAt: now, expiresAt: now + 600000, routes: [{ installationId: randomUUID(),
        venueId: randomUUID(), staffHostname: staffHost, publicHostname: publicHost, address: '10.77.17.2', port: 443,
        peerPublicKey: peerKey.publicKey }] }, issuer.privateKey)));
    const image = docker('image', 'inspect', 'waitron-cloud-local-remote:dev', '--format', '{{.Id}}');
    assert.match(image, /^sha256:[a-f0-9]{64}$/);
    journal({ state: 'network-intent' }); networkId = docker('network', 'create', '--internal', '--label', label, network);
    journal({ state: 'network-created' });
    const gateway = start(['-v', join(root, 'src') + ':/app/src:ro',
      '-v', join(root, 'measure') + ':/measure:ro', '-v', join(root, 'public.pem') + ':/input/public-ca.pem:ro',
      '-v', join(root, 'state') + ':/state', '-v', join(root, 'public-certs') + ':/input/public-certs:ro',
      ...['issuer.pem', 'wireguard.key', 'bot.key', 'manifest.json'].flatMap(file => ['-v', join(root, file) + ':/input/' + file + ':ro']),
      '-v', join(root, 'staff.pem') + ':/input/venue-ca.pem:ro', '-e', 'GATEWAY_CELL_ID=' + cell,
      '-e', 'GATEWAY_SUBNET=17', '-e', 'GATEWAY_UPSTREAM_CA=/input/venue-ca.pem', image]);
    const gatewayIp = docker('inspect', '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', gateway);
    secret('peer/peer.json', JSON.stringify({ address: '10.77.17.2', privateKey: peerKey.privateKey,
      gatewayPublicKey: gatewayKey.publicKey, gatewayEndpoint: gatewayIp + ':51820', upstreamHost: '127.0.0.1', upstreamPort: 8443 }));
    secret('peer/staff.key', readFileSync(join(root, 'staff.key'))); secret('peer/staff.pem', staffCa);
    let backend = readFileSync(new URL('./remote-waitron-backend.mjs', import.meta.url), 'utf8');
    const corruption = {
      'anonymous-status': "if (c.req.path === '/management-api/staff' && !c.req.header('cookie')) c.res = new Response(c.res.body, {status:200, headers:c.res.headers});",
      'missing-person': "if (c.req.path === '/management-api/session' && c.res.status === 200) c.res = new Response(JSON.stringify({offerPasskey:false}), {status:200, headers:c.res.headers});",
      'invalid-canvases': "if (c.req.path === '/management-api/canvases') c.res = new Response(JSON.stringify({canvases:null}), {status:200, headers:c.res.headers});",
      'false-availability': "if (c.req.path === '/public/availability') c.res = new Response(JSON.stringify({available:false}), {status:200, headers:c.res.headers});",
      'missing-cookie': "if (c.req.path === '/management-api/session') c.res.headers.delete('set-cookie');",
    };
    if (fault in corruption) {
      // Corrupt the outgoing response after the real route runs; provisioning and
      // authentication still use the pinned runtime and generated SQLite state.
      backend = backend.replace('const app = new r.Hono();',
        'const app = new r.Hono(); app.use(\"*\", async (c,next) => { await next(); ' + corruption[fault] + ' });');
    }
    secret('peer/backend.mjs', backend);
    cpSync(fixture.runtime, join(root, 'peer/runtime.mjs'));
    cpSync(fixture.migrations, join(root, 'peer/migrations'), { recursive: true });
    const peer = start(['-v', join(root, 'src') + ':/app/src:ro', '-v', join(root, 'peer') + ':/input:ro', image, 'node', '/input/backend.mjs']);
    await wait(() => JSON.parse(docker('exec', gateway, 'node', '/measure/remote-waitron-smoke.mjs', 'ready')).ready);
    assert.equal(docker('network', 'inspect', networkId, '--format', '{{.Internal}}'), 'true');
    // Effective mounts contain no source database or staff private key on the gateway.
    for (const id of containers) {
      const info = JSON.parse(docker('inspect', id))[0];
      assert.equal(info.HostConfig.ReadonlyRootfs, true); assert.deepEqual(info.HostConfig.Dns, ['127.0.0.1']);
      assert.ok(info.Mounts.every(m => m.Type === 'tmpfs' && m.Destination === '/tmp'
        || m.Type === 'bind' && m.Source.startsWith(root + '/')), 'only this generated scratch is mounted');
    }
    assert.equal(JSON.parse(docker('inspect', gateway))[0].Mounts.some(m => m.Source.endsWith('staff.key') || m.Source.endsWith('/peer')), false);
    const nodeVersion = docker('exec', peer, 'node', '-p', 'process.version');
    const gatewayBefore = wire(gateway), peerBefore = wire(peer);
    if (fault !== 'none') {
      assert.throws(() => docker('exec', gateway, 'node', '/measure/remote-waitron-smoke.mjs', fault === 'extra-config' ? 'extra-config' : 'measure'),
        error => error.journeyRefused === true, 'bad evidence must refuse without publishing a partial sample');
      return;
    }
    const result = JSON.parse(docker('exec', gateway, 'node', '/measure/remote-waitron-smoke.mjs'));
    const gatewayDelta = difference(gatewayBefore, wire(gateway)), peerDelta = difference(peerBefore, wire(peer));
    assert.deepEqual(gatewayDelta, { received: peerDelta.sent, sent: peerDelta.received });
    assert.equal(result.kind, 'pinned-waitron-api-gateway'); assert.equal(result.costMeasured, false);
    assert.deepEqual(result.evidence.map(e => [e.audience, e.requests]), [['staff', 9], ['public', 6]]);
    assert.deepEqual(result.evidence[0].actions.map(a => [a.action, a.status]), [
      ['anonymous-read-refused',401], ['invalid-sign-in-refused',401], ['sign-in',200], ['staff-read',200],
      ['dashboard-canvases-read',200], ['dashboard-theme-read',200], ['staff-reconnect-read',200],
      ['sign-out',204], ['signed-out-read-refused',401]]);
    for (const entry of result.evidence) {
      assert.equal(entry.actions.reduce((n,a) => n + a.requestBodyBytes, 0), entry.requestBodyBytes);
      assert.equal(entry.actions.reduce((n,a) => n + a.responseBodyBytes, 0), entry.responseBodyBytes);
      assert.equal(entry.actions.length, entry.requests);
      assert.deepEqual(entry.snapshot.producer, entry.snapshot.observer);
      assert.equal(entry.snapshot.producer.connections, entry.requests);
    }
    for (const value of ['owner@example.test', 'Generated local password', 'Generated owner', staffHost, publicHost])
      assert.equal(JSON.stringify(result).includes(value), false);
    assert.equal(Object.keys(JSON.parse(docker('inspect', gateway))[0].HostConfig.PortBindings ?? {}).length, 0);
    t.diagnostic(JSON.stringify({ ...result, waitronRevision: fixture.revision, runtimeSha256: fixture.runtimeSha256, nodeVersion, image, tunnelTotals: gatewayDelta }));
  } finally {
    const ownedContainers = new Set([...containers,
      ...docker('ps', '-aq', '--no-trunc', '--filter', 'label=' + label).split('\n').filter(Boolean)]);
    for (const id of [...ownedContainers].reverse()) {
      assert.equal(docker('inspect', '--format', '{{index .Config.Labels "io.waitron.cloud-cost.remote-owner"}}', id), owner);
      docker('rm', '-f', id);
    }
    const ownedNetworks = new Set([...(networkId ? [networkId] : []),
      ...docker('network', 'ls', '-q', '--no-trunc', '--filter', 'label=' + label).split('\n').filter(Boolean)]);
    for (const id of ownedNetworks) {
      assert.equal(docker('network', 'inspect', id, '--format', '{{index .Labels "io.waitron.cloud-cost.remote-owner"}}'), owner);
      docker('network', 'rm', id);
    }
    assert.equal(docker('ps', '-aq', '--filter', 'label=' + label), '');
    assert.equal(docker('network', 'ls', '-q', '--filter', 'label=' + label), '');
    rmSync(root, { recursive: true });
  }
});
