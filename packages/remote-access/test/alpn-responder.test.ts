import assert from 'node:assert/strict';
import {X509Certificate} from 'node:crypto';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test, type TestContext} from 'node:test';
import {connect} from 'node:tls';
import acme from 'acme-client';
import {AlpnResponder} from '../src/alpn-responder.ts';
import {challengeCertificate, checkAuthorization} from './fixtures/challenge-certificate.ts';

const hostname = 'staff.example.test';

async function setup(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'cloud-check-listener-'));
  let now = 100_000;
  const routes = new Set([hostname]);
  const check = await challengeCertificate(hostname, now + 1);
  const filename = join(root, hostname + '.json');
  await writeFile(filename, JSON.stringify(check));
  t.after(() => rm(root, {recursive: true, force: true}));
  const responder = new AlpnResponder({folder: root, routeNames: () => routes, now: () => now});
  const port = await responder.listen(0);
  t.after(() => responder.close());
  return {root, filename, check, responder, port, routes, expire: () => {now++;}};
}

function handshake(port: number, servername: string | undefined, protocols?: string[]) {
  return new Promise<{fingerprint: string; pem: string; protocol: string; bytes: number}>((resolve, reject) => {
    const socket = connect({host: '127.0.0.1', port, servername, ALPNProtocols: protocols, rejectUnauthorized: false});
    let bytes = 0;
    socket.setTimeout(2000, () => socket.destroy(new Error('TLS attempt timed out')));
    socket.on('data', chunk => {bytes += chunk.length;});
    socket.once('error', reject);
    socket.once('secureConnect', () => {
      const peer = new X509Certificate(socket.getPeerCertificate().raw);
      const protocol = socket.alpnProtocol || '';
      socket.once('end', () => resolve({fingerprint: peer.fingerprint256, pem: peer.toString(), protocol, bytes}));
    });
  });
}

const refuses = (port: number, name: string | undefined, protocols?: string[]) =>
  assert.rejects(handshake(port, name, protocols), /alert|reset|before secure TLS connection/);

test('a current route gets the check certificate and no application data', async t => {
  const {responder, check, port} = await setup(t);
  await responder.refresh();
  assert.deepEqual(responder.answerable(), [hostname]);
  const result = await handshake(port, hostname, ['acme-tls/1']);
  assert.equal(result.protocol, 'acme-tls/1');
  assert.equal(result.fingerprint, new X509Certificate(check.certificate).fingerprint256);
  assert.ok(acme.crypto.isAlpnCertificateAuthorizationValid(result.pem, checkAuthorization));
  assert.equal(result.bytes, 0);
});

test('the listener refuses missing or wrong handshake inputs even when a check is loaded', async t => {
  const {responder, port} = await setup(t);
  await responder.refresh();
  await refuses(port, 'unknown.example.test', ['acme-tls/1']);
  await refuses(port, undefined, ['acme-tls/1']);
  await refuses(port, hostname, ['h2']);
  await refuses(port, hostname);
});

test('a new route needs a refresh but withdrawal and expiry take effect immediately', async t => {
  const {responder, port, routes, expire} = await setup(t);
  routes.clear();
  await responder.refresh();
  routes.add(hostname);
  await refuses(port, hostname, ['acme-tls/1']);
  await responder.refresh();
  assert.deepEqual(responder.answerable(), [hostname]);
  routes.clear();
  await refuses(port, hostname, ['acme-tls/1']);
  routes.add(hostname);
  expire();
  assert.deepEqual(responder.answerable(), []);
  await refuses(port, hostname, ['acme-tls/1']);
});

test('deletion and a failed folder read each withdraw a loaded check at refresh', async t => {
  const {responder, port, root, filename, check} = await setup(t);
  await responder.refresh();
  await rm(filename);
  await responder.refresh();
  assert.deepEqual(responder.answerable(), []);
  await refuses(port, hostname, ['acme-tls/1']);
  await writeFile(filename, JSON.stringify(check));
  await responder.refresh();
  assert.deepEqual(responder.answerable(), [hostname]);
  await rm(root, {recursive: true});
  await writeFile(root, 'the mounted directory is unavailable', {mode: 0o700});
  await assert.rejects(responder.refresh(), {code: 'ENOTDIR'});
  assert.deepEqual(responder.answerable(), []);
  await refuses(port, hostname, ['acme-tls/1']);
});
