import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as httpServer} from 'node:http';
import {createServer as httpsServer} from 'node:https';
import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const load = () => import('./test-fixtures/integration-venue-request.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url?.endsWith('/integration-venue-request.mjs')) return {};
  throw error;
});
async function exchange(request, origin, path, options = {}, body) {
  return new Promise((resolve, reject) => {
    const req = request(origin, path, options, response => {
      let text = ''; response.on('data', part => text += part);
      response.once('error', reject);
      response.once('end', () => resolve({status: response.statusCode, headers: response.headers, text}));
    });
    req.once('error', reject); req.end(body);
  });
}
async function certificate(directory, name) {
  const keyPath = join(directory, name + '.key'), certPath = join(directory, name + '.crt');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost', '-keyout', keyPath, '-out', certPath], {stdio: 'ignore'});
  return {key: await readFile(keyPath), cert: await readFile(certPath)};
}

// Using HTTP for the backup-state venue, dropping the body, or trusting an unrelated CA breaks these exchanges.
test('remote requests preserve the actual venue response over HTTP and trusted HTTPS', {timeout: 10000}, async () => {
  const {requestIntegrationVenue} = await load();
  assert.equal(typeof requestIntegrationVenue, 'function', 'Protocol-aware venue forwarding is missing');
  const directory = await mkdtemp(join(tmpdir(), 'cloud-venue-request-'));
  try {
    const tls = await certificate(directory, 'venue');
    for (const secure of [false, true]) {
      const server = (secure ? httpsServer.bind(null, tls) : httpServer)((req, res) => {
        let text = ''; req.on('data', part => text += part);
        req.once('end', () => {res.writeHead(207, {'x-venue-proof': 'native'}); res.end(JSON.stringify({method: req.method, path: req.url, host: req.headers.host, text}));});
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const origin = (secure ? 'https' : 'http') + '://127.0.0.1:' + server.address().port;
      try {
        const response = await exchange(requestIntegrationVenue, origin, '/public/availability?view=staff',
          {ca: tls.cert, method: 'POST', headers: {host: 'staff.venue.test', 'content-type': 'text/plain'}}, 'table 7');
        assert.equal(response.status, 207); assert.equal(response.headers['x-venue-proof'], 'native');
        assert.deepEqual(JSON.parse(response.text), {method: 'POST', path: '/public/availability?view=staff', host: '127.0.0.1:' + server.address().port, text: 'table 7'});
      } finally {await new Promise(resolve => server.close(resolve));}
    }
  } finally {await rm(directory, {recursive: true, force: true});}
});

test('HTTPS venue requests refuse missing or unrelated trust and the wrong hostname', {timeout: 10000}, async () => {
  const {requestIntegrationVenue} = await load();
  assert.equal(typeof requestIntegrationVenue, 'function', 'Protocol-aware venue forwarding is missing');
  const directory = await mkdtemp(join(tmpdir(), 'cloud-venue-trust-'));
  let server;
  try {
    const tls = await certificate(directory, 'venue'), other = await certificate(directory, 'other');
    let calls = 0;
    server = httpsServer(tls, (_req, res) => {calls++; res.end('native');});
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'https://127.0.0.1:' + server.address().port;
    for (const options of [{}, {ca: other.cert}, {ca: tls.cert, servername: 'wrong.venue.test'}]) {
      await assert.rejects(exchange(requestIntegrationVenue, origin, '/public/availability', options), /certificate|self-signed|Hostname/i);
    }
    assert.equal(calls, 0);
    assert.equal((await exchange(requestIntegrationVenue, origin, '/public/availability', {ca: tls.cert})).text, 'native');
    assert.equal(calls, 1);
  } finally {if (server) await new Promise(resolve => server.close(resolve)); await rm(directory, {recursive: true, force: true});}
});
