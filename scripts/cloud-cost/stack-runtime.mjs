// Loaded only inside the prepared local image; importing this file starts no services.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createMeter, createMeteringProxy, classifyStorageOperation } from './meter.mjs';

const fail = () => { throw Error('Invalid cloud cost stack runtime'); };
const config = () => JSON.parse(readFileSync('/state/replay-config.json', 'utf8'));
const request = (url, { method = 'GET', body, tls = false } = {}) => new Promise((resolve, reject) => {
  const bytes = body === undefined ? undefined : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const req = (tls ? https : http).request(url, { method, headers: bytes ? { 'content-length': bytes.length } : {},
    ...(tls ? { ca: readFileSync('/state/gateway-cert.pem') } : {}) }, res => {
    const parts = []; let length = 0;
    res.on('data', chunk => { length += chunk.length; if (length > 1048576) req.destroy(Error('response too large')); else parts.push(chunk); });
    res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(parts).toString() }));
    res.on('error', reject);
  });
  req.setTimeout(2000, () => req.destroy(Error('timeout'))); req.on('error', reject); req.end(bytes);
});
async function server(handler, { port = 8080, host = '0.0.0.0' } = {}) {
  const s = http.createServer(async (req, res) => {
    try { await handler(req, res); } catch { res.writeHead(400); res.end(); }
  });
  await new Promise((resolve, reject) => { s.once('error', reject); s.listen(port, host, resolve); });
  return s;
}
async function body(req) {
  const parts = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 1048576) fail(); parts.push(chunk); }
  return JSON.parse(Buffer.concat(parts));
}
function binary(command, args) {
  const child = spawn(command, args, { stdio: 'ignore' });
  let stopping = false;
  const stop = () => { stopping = true; child.kill('SIGTERM'); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  child.once('error', () => process.exit(1));
  child.once('exit', code => process.exit(stopping ? 0 : code ?? 1));
}
async function check() {
  const ready = async (url, tls = false) => { try { return (await request(url, { tls })).status === 200; } catch { return false; } };
  const pg = spawnSync('psql', [config().config.localEndpoints.postgres, '-Atc', 'SELECT 42'],
    { encoding: 'utf8', timeout: 2000, env: { PATH: process.env.PATH, PGCONNECT_TIMEOUT: '1' }, stdio: ['ignore', 'pipe', 'ignore'] });
  return { postgres: pg.status === 0 && pg.stdout.trim() === '42',
    s3: await ready('http://s3:8333/'), mailpit: await ready('http://mailpit:8025/api/v1/info'),
    fiscal: await ready('http://fiscal:8080/health'), waitron: await ready('http://waitron:8080/health'),
    gateway: await ready('https://gateway:8443/health', true) };
}
// Mutable service files stay on container scratch so their removal cannot race host ownership scans.
export async function runStackService(role) {
  if (role === 'check') { process.stdout.write(JSON.stringify(await check())); return; }
  if (role === 'postgres') {
    // PostgreSQL replaces initialization files; keep them off the scanned ownership tree.
    mkdirSync('/tmp/postgres', { mode: 0o700 });
    const endpoint = new URL(config().config.localEndpoints.postgres);
    writeFileSync('/state/postgres-password', endpoint.password, { mode: 0o600, flag: 'wx' });
    const init = spawnSync('initdb', ['-D', '/tmp/postgres', '-U', endpoint.username, '--auth-local=trust',
      '--auth-host=scram-sha-256', '--pwfile=/state/postgres-password'], { stdio: 'ignore' });
    if (init.status !== 0) fail();
    appendFileSync('/tmp/postgres/pg_hba.conf', '\nhost all all samenet scram-sha-256\n');
    binary('postgres', ['-D', '/tmp/postgres', '-h', '0.0.0.0', '-k', '/tmp']); return;
  }
  if (role === 's3') {
    mkdirSync('/tmp/storage', { mode: 0o700 });
    let phase = 'startup';
    const meter = createMeter({ phase, clock: () => performance.now() / 1000 });
    // Per-attempt IDs do not identify client retries; these unpaired observations cannot qualify an export.
    await createMeteringProxy({ target: 'http://127.0.0.1:8334', meter, listenHost: '0.0.0.0', listenPort: 8333,
      classify: input => ({ token: randomUUID(), phase, operation: classifyStorageOperation(input),
        retryOrdinal: 0, errorCode: null, sameAccount: null }) });
    // This control socket stays inside the storage container; it never forwards a provider request.
    await server(async (req, res) => {
      if (req.method === 'GET' && req.url === '/snapshot') res.end(JSON.stringify(meter.snapshot()));
      else if (req.method === 'POST' && req.url === '/phase') {
        const value = await body(req);
        if (Object.keys(value).join(',') !== 'phase' || !['setup', 'startup', 'workload', 'idle', 'verification', 'restore', 'observer', 'cleanup'].includes(value.phase)) fail();
        phase = value.phase; res.end();
      } else { res.writeHead(404); res.end(); }
    }, { port: 8335, host: '127.0.0.1' });
    binary('weed', ['mini', '-dir=/tmp/storage', '-ip=127.0.0.1', '-ip.bind=127.0.0.1', '-master.port=9333', '-master.port.grpc=19333',
      '-volume.port=8080', '-volume.port.grpc=18080', '-filer.port=8888', '-filer.port.grpc=18888', '-s3.port=8334',
      '-admin.ui=false', '-webdav=false', '-s3.port.iceberg=0', '-s3.port.lance=0']); return;
  }
  if (role === 'mailpit') { binary('mailpit', ['--smtp', '0.0.0.0:1025', '--listen', '0.0.0.0:8025', '--database', '/tmp/mail.db']); return; }
  if (role === 'gateway') {
    writeFileSync('/state/haproxy.cfg', 'global\n  maxconn 100\ndefaults\n  mode http\n  timeout connect 2s\n  timeout client 5s\n  timeout server 5s\nfrontend local\n  bind :8443 ssl crt /state/gateway.pem\n  default_backend venue\nbackend venue\n  server venue waitron:8080 check\n');
    binary('haproxy', ['-W', '-db', '-f', '/state/haproxy.cfg']); return;
  }
  let s, replay;
  if (role === 'fiscal') {
    let calls = 0;
    s = await server(async (req, res) => {
      if (req.method === 'POST' && req.url === '/submit') { await body(req); calls++; }
      else if (req.url !== '/health') { res.writeHead(404); res.end(); return; }
      res.end(JSON.stringify({ calls }));
    });
  } else if (role === 'waitron') {
    const { openReplay } = await import('/code/cost-waitron-adapter.mjs');
    const run = config(); mkdirSync('/tmp/replay', { mode: 0o700 });
    replay = await openReplay({ codeRoot: '/code', stateRoot: '/tmp/replay', config: run.config, initial: run.initial });
    s = await server(async (req, res) => {
      let result;
      if (req.method === 'GET' && req.url === '/health') result = { ready: true };
      else if (req.method === 'GET' && req.url === '/counts') result = replay.counts();
      else if (req.method === 'GET' && req.url === '/verify') result = await replay.verify();
      else if (req.method === 'POST' && req.url === '/sale') {
        const { instant, ...sale } = await body(req); const at = new Date(instant);
        if (!Number.isFinite(at.getTime())) fail();
        for (const tender of sale.settlement?.tenders ?? []) tender.settledAt = new Date(tender.settledAt);
        await replay.recordSale({ ...sale, clock: { now: () => ({ instant: at, offsetMinutes: 60,
          confident: true, confidence: 'anchored', anchorAgeSeconds: 0 }) } }); result = { accepted: true };
      } else { res.writeHead(404); res.end(); return; }
      res.end(JSON.stringify(result));
    });
  } else fail();
  const stop = async () => { s.close(); s.closeIdleConnections(); await new Promise(resolve => s.on('close', resolve)); await replay?.close(); };
  process.once('SIGTERM', () => { stop().then(() => process.exit(0), () => process.exit(1)); });
  process.once('SIGINT', () => { stop().then(() => process.exit(0), () => process.exit(1)); });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStackService(process.argv[2]).catch(() => { process.exitCode = 1; });
}
