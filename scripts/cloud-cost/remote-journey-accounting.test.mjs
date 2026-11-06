import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { measureRemoteJourneys } from './remote-journey.mjs';
import { assessAccounting } from './accounting-policy.mjs';

// TLS, relay sockets, request parsing and action validation stay real. Only the
// final socket observation is removed after the full HTTP exchange has occurred.
for (const mode of ['clean', 'missing', 'missing-producer', 'wrong-status'])
test('remoteApiAccountingNeverReplacesActualActionChecks_' + mode, { timeout: 10000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-remote-accounting-'));
  t.after(() => rmSync(root, { recursive: true }));
  const key = join(root, 'key.pem'), cert = join(root, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key,
    '-out', cert, '-days', '1', '-subj', '/CN=staff.generated.example.test',
    '-addext', 'subjectAltName=DNS:staff.generated.example.test,DNS:generated.example.test'], { stdio: 'ignore' });
  const actions = [], sockets = new Set();
  let signedOut = false;
  const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString(); actions.push([req.method, req.url]);
    let status = 200, value = {};
    if (req.url === '/management-api/session') {
      if (req.method === 'DELETE') { signedOut = true; status = 204; }
      else if (body.includes('invalid-')) status = 401;
      else { value = { personId: 'generated' }; res.setHeader('set-cookie', 'session=generated'); }
    } else if (req.url === '/management-api/staff') {
      if (req.headers.host === 'generated.example.test') status = 404;
      else if (!req.headers.cookie || signedOut) status = 401;
      else value = [{ name: 'Generated' }];
    } else if (req.url === '/management-api/device-profiles') value = { deviceProfiles: [{ id: 'generated' }] };
    else if (req.url === '/management-api/themes') value = { themes: [], inUse: null };
    else if (req.url === '/public/availability') {
      if (!req.headers.cookie) status = 403;
      else value = { available: mode !== 'wrong-status' };
    } else if (req.url === '/_cloud/challenge') value = { challenge: 'generated', difficulty: 1 };
    else if (req.url === '/_cloud/solve') { status = 204; res.setHeader('set-cookie', 'proof=generated'); }
    res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value));
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  // Completed connections must be collected by the client, without a server idle expiry.
  server.keepAliveTimeout = 0;
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  const original = net.connect, originalServer = net.createServer;
  if (mode === 'missing-producer') net.createServer = (options, handle) => originalServer(options, socket => {
    Object.defineProperty(socket, 'bytesWritten', { value: undefined }); handle(socket);
  });
  net.connect = (...args) => {
    if (args[0]?.port !== 443) return original(...args);
    const socket = original({ ...args[0], port: server.address().port });
    if (mode !== 'clean') Object.defineProperty(socket, 'bytesWritten', { value: undefined });
    return socket;
  };
  syncBuiltinESMExports();
  t.after(() => { net.connect = original; net.createServer = originalServer; syncBuiltinESMExports(); });
  const options = { staffHostname: 'staff.generated.example.test', publicHostname: 'generated.example.test',
    staffCa: readFileSync(cert), publicCa: readFileSync(cert), email: 'generated@example.test', password: 'generated' };
  if (mode === 'wrong-status') {
    await assert.rejects(measureRemoteJourneys(options), { message: 'Invalid cloud cost remote journey' });
    assert.equal(actions.length, 14, 'the actual public availability assertion refuses before the final action');
    return;
  }
  let result;
  await assert.doesNotReject(async () => { result = await measureRemoteJourneys(options); },
    'completed API actions remain successful when socket accounting is missing');
  assert.equal(actions.length, 15);
  assert.deepEqual(result.evidence.map(row => [row.audience, row.requests]), [['staff', 9], ['public', 6]]);
  assert.deepEqual(result.evidence[0].actions.map(row => row.action), [
    'anonymous-read-refused', 'invalid-sign-in-refused', 'sign-in', 'staff-read',
    'dashboard-device-profiles-read', 'dashboard-themes-read', 'staff-reconnect-read', 'sign-out', 'signed-out-read-refused']);
  for (const row of result.evidence) {
    assert.equal(row.snapshot.status, mode === 'clean' ? 'measured' : 'unknown');
    assert.equal(row.snapshot.producer.connections, row.requests);
    assert.equal(assessAccounting({ producer: 'remote', sources: [{ scope: 'remote', record: row.snapshot }] }).publicationEligible,
      mode === 'clean');
    assert.ok(row.responseBodyBytes > 0);
  }
  assert.equal(result.costMeasured, false);
  assert.doesNotMatch(JSON.stringify(result), /generated@example|session=|proof=|127\.0\.0\.1/);
});
