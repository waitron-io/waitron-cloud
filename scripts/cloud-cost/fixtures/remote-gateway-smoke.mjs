// Runs inside the owned gateway on its internal Docker network. Generated data only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { request } from 'node:https';
import { openRemoteMeasurement } from './remote.mjs';

const staffHost = 'staff.generated.example.test', publicHost = 'generated.example.test';
function call(port, host, ca, path, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = request({ host: '127.0.0.1', port, servername: host, ca, agent: false, path,
      method: bytes ? 'POST' : 'GET', headers: { host, ...(cookie ? { cookie } : {}),
        ...(bytes ? { 'content-type': 'application/json', 'content-length': bytes.length } : {}) } }, res => {
      const chunks = []; let size = 0;
      res.on('data', bytes => { size += bytes.length; if (size > 1048576) req.destroy(); else chunks.push(bytes); });
      res.on('error', reject); res.once('end', () => resolve({ status: res.statusCode, headers: res.headers,
        body: Buffer.concat(chunks), bodyBytes: size }));
    });
    req.setTimeout(3000, () => req.destroy(Error('Generated HTTPS deadline'))); req.on('error', reject); req.end(bytes);
  });
}
function wire() {
  const fields = execFileSync('wg', ['show', 'wg-cloud', 'transfer'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\s+/);
  assert.equal(fields.length, 3);
  const received = Number(fields[1]), sent = Number(fields[2]);
  assert.ok(Number.isSafeInteger(received) && Number.isSafeInteger(sent)); return { received, sent };
}
const staffCa = readFileSync('/input/venue-ca.pem'), publicCa = readFileSync('/input/public-ca.pem');
if (process.argv[2] === 'ready') {
  assert.equal((await call(443, staffHost, staffCa, '/generated')).status, 200);
  process.stdout.write('{"ready":true}');
} else {
  const measurements = [], evidence = [];
  try {
    for (const audience of ['staff', 'public']) {
      const meter = await openRemoteMeasurement({ target: 'tcp://127.0.0.1:443', audience }); measurements.push(meter);
      const host = audience === 'staff' ? staffHost : publicHost, ca = audience === 'staff' ? staffCa : publicCa;
      const before = wire(); let bodies = 0, requests = 0;
      const counted = async (path, options) => { const reply = await call(meter.port, host, ca, path, options); bodies += reply.bodyBytes; requests++; return reply; };
      if (audience === 'staff') {
        for (let n = 0; n < 4; n++) {
          const reply = await counted('/generated'); assert.equal(reply.status, 200);
          assert.deepEqual(JSON.parse(reply.body), { synthetic: true, available: true });
        }
      } else {
        assert.equal((await counted('/public/availability')).status, 403);
        const challengeReply = await counted('/_cloud/challenge'); assert.equal(challengeReply.status, 200);
        const challenge = JSON.parse(challengeReply.body); let nonce = 0;
        while (createHash('sha256').update(challenge.challenge + ':' + nonce).digest().readUInt32BE(0) >= 2 ** (32 - challenge.difficulty)) nonce++;
        assert.equal((await counted('/_cloud/worker.js')).status, 200);
        const solved = await counted('/_cloud/solve', { body: { challenge: challenge.challenge, nonce } }); assert.equal(solved.status, 204);
        const cookie = solved.headers['set-cookie'][0].split(';')[0];
        const reply = await counted('/public/availability', { cookie }); assert.equal(reply.status, 200);
        assert.deepEqual(JSON.parse(reply.body), { synthetic: true, available: true });
        assert.equal((await counted('/management-api/cloud/status', { cookie })).status, 404);
      }
      await meter.close();
      const snapshot = meter.snapshot(), after = wire();
      assert.equal(snapshot.producer.connections, requests);
      assert.ok(snapshot.producer.bytesFromGateway > bodies, 'TLS records, handshake and response headers exceed body bytes');
      assert.deepEqual(snapshot.producer, snapshot.observer);
      const delta = { received: after.received - before.received, sent: after.sent - before.sent };
      assert.ok(delta.received > 0 && delta.sent > 0);
      assert.equal(JSON.stringify(snapshot).includes('generated.example.test'), false);
      evidence.push({ audience, scenario: 'generated-gateway-transport', requests, responseBodyBytes: bodies,
        snapshot, wireguardCounters: delta });
    }
    process.stdout.write(JSON.stringify({ kind: 'synthetic-local-gateway', costMeasured: false, evidence }));
  } finally { for (const meter of measurements) await meter.close().catch(() => {}); }
}
