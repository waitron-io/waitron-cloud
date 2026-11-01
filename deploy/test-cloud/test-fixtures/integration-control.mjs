// Private stdin/stdout between this disposable venue and its owning proof process.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {request} from 'node:http';
import {rollbackRefusalDiagnostic} from './integration-renewal.mjs';
const root = process.env.CLOUD_TEST_ROOT;
let input = '';
for await (const part of process.stdin) {input += part; assert.ok(input.length < 16384);}
const {phase, choice} = JSON.parse(input);
const ready = JSON.parse(await readFile(root + '/ready.json', 'utf8'));
if (phase === 'ready') {
  const response = await fetch(ready.origin + '/public/availability', {signal: AbortSignal.timeout(2000)});
  assert.equal(response.status, 200);
  assert.equal(typeof (await response.json()).available, 'boolean');
  console.log(JSON.stringify({ready: true}));
  process.exit(0);
}
const post = (path, body, cookie = '') => fetch(ready.origin + path, {method: 'POST', headers: {origin: ready.origin, 'content-type': 'application/json', cookie}, body: JSON.stringify(body), signal: AbortSignal.timeout(15000)});
const login = await post('/management-api/session', {email: 'owner@example.test', password: 'Local integration password'});
assert.equal(login.status, 200, 'integration.local_login');
const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
if (phase === 'storage-withdrawal' || phase === 'snapshot-refusal' || phase === 'snapshot-publish' || phase === 'verification-state' || phase === 'recovery-authority' || phase === 'stream-start' || phase === 'free-remote' || phase === 'paid-remote' || phase === 'rollback-refresh') {
  const result = await new Promise((resolve, reject) => {
    const req = request({socketPath: root + '/proof.sock', path: '/' + phase, method: 'POST'}, res => {
      let text = ''; res.on('data', part => text += part);
      res.once('end', () => {try {
        assert.equal(res.statusCode, 200, 'integration.fixture_refused' + (phase === 'rollback-refresh' ? rollbackRefusalDiagnostic(text) : ''));
        resolve(JSON.parse(text));
      } catch (error) {reject(error);}});
    });
    req.setTimeout(phase === 'stream-start' ? 90000 : phase === 'snapshot-publish' || phase === 'paid-remote' || phase === 'storage-withdrawal' ? 45000 : 15000, () => req.destroy(Error('integration.refusal_timeout'))); req.once('error', reject); req.end(phase === 'free-remote' || phase === 'paid-remote' || phase === 'storage-withdrawal' ? JSON.stringify(choice) : undefined);
  });
  console.log(JSON.stringify(result));
} else if (phase === 'start' || phase === 'check' || phase === 'complete' || phase === 'refresh') {
  const response = await post('/management-api/cloud/' + phase, phase === 'complete' ? choice : {}, cookie);
  assert.equal(response.status, 200, 'integration.local_' + phase);
  console.log(JSON.stringify(await response.json()));
} else {
  assert.equal(phase, 'evidence');
  const response = await fetch(ready.origin + '/management-api/cloud/status', {headers: {cookie}, signal: AbortSignal.timeout(5000)});
  assert.equal(response.status, 200);
  const status = await response.json();
  const bytes = await readFile(root + '/cloud-connection.json');
  const saved = JSON.parse(bytes);
  assert.equal(saved.origin, 'https://waitron.local:3000');
  assert.equal(saved.environment, 'test');
  assert.equal(status.installation.state, 'active');
  assert.ok(saved.lifecycle.lease);
  const exchanges = (await readFile(root + '/exchanges.jsonl', 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  for (const path of ['/api/pairing/complete', '/api/installations/renew', '/api/installations/configuration']) assert.ok(exchanges.some(value => value.path === path && value.status === 200), 'integration.exchange_missing:' + path);
  console.log(JSON.stringify({registration: status.registration, localVenueId: ready.localVenueId, installationState: status.installation.state,
    stateSha256: createHash('sha256').update(bytes).digest('hex'), identitySha256: createHash('sha256').update(saved.publicKey).digest('hex')}));
}
