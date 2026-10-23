// Observe successful native exchanges without replacing transport, signatures or responses.
import assert from 'node:assert/strict';
import {appendFile, readFile, rm, chmod} from 'node:fs/promises';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createCloudConnection} from '/waitron/apps/server/src/cloud-client.ts';
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const response = await nativeFetch(url, options);
  const target = new URL(url);
  if (target.origin === 'https://waitron.local:3000' && /^\/api\/(pairing|installations)\/[a-z-]+$/.test(target.pathname)) {
    const observed = {path: target.pathname, status: response.status};
    if (target.pathname === '/api/installations/backup-reserve' && response.status === 403) {
      const body = await response.clone().json();
      observed.error = body.error === 'permission_denied' ? 'permission_denied' : 'unexpected';
      observed.grantIssued = Object.keys(body).some(key => key !== 'error');
    }
    await appendFile(process.env.CLOUD_TEST_ROOT + '/exchanges.jsonl', JSON.stringify(observed) + '\n', {mode: 0o600});
  }
  return response;
};
await import('/waitron/apps/server/scripts/cloud-integration-fixture.ts');
const root = process.env.CLOUD_TEST_ROOT;
const ready = JSON.parse(await readFile(root + '/ready.json', 'utf8'));
const cloud = createCloudConnection({stateDir: root, origin: 'https://waitron.local:3000', localVenueId: ready.localVenueId, environment: 'test'});
// The private socket calls the same module in the owning server process, preserving its state lock.
const socket = root + '/proof.sock'; await rm(socket, {force: true});
const control = createServer(async (req, res) => {
  try {
    assert.equal(req.method, 'POST'); assert.equal(req.url, '/snapshot-refusal');
    let refused = false;
    try {await cloud.reserveCapture(randomUUID());} catch {refused = true;}
    assert.equal(refused, true);
    const lines = (await readFile(root + '/exchanges.jsonl', 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const observed = lines.filter(value => value.path === '/api/installations/backup-reserve').at(-1);
    assert.deepEqual(observed, {path: '/api/installations/backup-reserve', status: 403, error: 'permission_denied', grantIssued: false});
    res.end(JSON.stringify({status: 'proved', httpStatus: observed.status, error: observed.error, grantIssued: observed.grantIssued}));
  } catch {res.statusCode = 500; res.end(JSON.stringify({error: 'fixture_refused'}));}
});
await new Promise(resolve => control.listen(socket, resolve)); await chmod(socket, 0o600);
