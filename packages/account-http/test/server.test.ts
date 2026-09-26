import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { request, type ClientRequest } from 'node:http';
import { connect } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { generateKeyPairSync } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { startAccountServer } from '../src/server.ts';
import { database } from './fixtures.ts';
let db: Awaited<ReturnType<typeof database>>;
before(async () => {db = await database();});
after(async () => {await db.close();});
beforeEach(async () => {await db.pool.query('TRUNCATE account_rate_limits, email_outbox, signup_requests CASCADE');});
const config = () => ({portalOrigin: 'http://localhost', production: false, rateKey: db.rateKey, trustedProxyIps: [] as string[]});
async function host(trustedProxyIps: string[] = []) {
  const running = await startAccountServer({pool: db.pool, outbox: db.outbox, config: {...config(), trustedProxyIps}, port: 0});
  const address = running.server.address(); assert.ok(address && typeof address !== 'string');
  return {...running, port: address.port};
}
function send(port: number, path = '/session', body?: string, headers: Record<string, string> = {}, end = true) {
  let req: ClientRequest;
  const result = new Promise<{status: number; headers: import('node:http').IncomingHttpHeaders; body: string}>((resolve, reject) => {
    req = request({host: '127.0.0.1', port, path: `/api/account${path}`, method: body === undefined ? 'GET' : 'POST', headers: {host: 'localhost', origin: 'http://localhost', 'content-type': 'application/json', ...headers}}, res => {
      let text = ''; res.on('data', chunk => {text += chunk;});
      res.on('end', () => resolve({status: res.statusCode!, headers: res.headers, body: text})); res.on('error', reject);
    });
    req.on('error', reject); if (body !== undefined) req.write(body); if (end) req.end();
  });
  // Aborted clients are deliberate fixtures; consume their rejection even before awaiting it.
  void result.catch(() => {});
  return {result, abort() {req.destroy();}};
}
async function until(check: () => Promise<boolean>, ms = 5000) {
  const deadline = Date.now() + ms;
  while (!await check()) {if (Date.now() >= deadline) throw new Error('Condition timed out'); await delay(20);}
}
async function queued() {return Number((await db.pool.query('SELECT count(*) FROM email_outbox')).rows[0].count);}
test('real host bounds streamed bodies and recovers without queuing mail', async () => {
  const running = await host();
  try {
    const response = await send(running.port, '/signup/request', `{"email":"${'x'.repeat(17000)}"}`).result;
    assert.equal(response.status, 413); assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(await queued(), 0); assert.equal((await send(running.port).result).status, 401);
  } finally {await running.close();}
});
test('a declared oversized body is refused before the client finishes sending it', async () => {
  const running = await host();
  const pending = send(running.port, '/signup/request', '{', {'content-length': '16385'}, false);
  try {
    const started = performance.now();
    const response = await pending.result;
    assert.equal(response.status, 413);
    assert.ok(performance.now() - started < 2000, 'response waited for the incomplete request body');
    assert.equal(await queued(), 0);
    assert.equal((await send(running.port).result).status, 401);
  } finally {pending.abort(); await running.close();}
});
test('stalled bodies expire, aborted clients release slots, and admission is bounded', async () => {
  const running = await host(); const pending: ReturnType<typeof send>[] = [];
  try {
    for (let i = 0; i < 8; i++) pending.push(send(running.port, '/signup/request', '{', {}, false));
    await until(async () => Number((await db.pool.query('SELECT sum(attempts) AS n FROM account_rate_limits')).rows[0].n) >= 8);
    const busy = await send(running.port).result;
    assert.equal(busy.status, 503); assert.equal(busy.headers['retry-after'], '1');
    pending[0]!.abort();
    await until(async () => (await send(running.port).result).status === 401);
    assert.equal((await pending[1]!.result).status, 408);
    assert.equal(await queued(), 0); assert.equal((await send(running.port).result).status, 401);
  } finally {for (const item of pending) item.abort(); await running.close();}
});
test('header size and receive deadlines are enforced over raw TCP', async () => {
  const running = await host();
  async function raw(data: string) {
    const socket = connect(running.port, '127.0.0.1'); let response = '';
    socket.on('data', chunk => {response += chunk;}); socket.on('error', () => {});
    const deadline = setTimeout(() => socket.destroy(), 8000);
    const closed = once(socket, 'close'); socket.write(data); await closed; clearTimeout(deadline); return response;
  }
  try {
    const oversized = await raw(`GET /api/account/session HTTP/1.1\r\nHost: localhost\r\nX-Large: ${'x'.repeat(9000)}\r\n\r\n`);
    assert.match(oversized, /^HTTP\/1.1 431/); assert.match(oversized, /Cache-Control: no-store/i); assert.match(oversized, /Referrer-Policy: no-referrer/i);
    const started = Date.now();
    assert.match(await raw('GET /api/account/session HTTP/1.1\r\nHost: local'), /^HTTP\/1.1 408/);
    assert.ok(Date.now() - started < 7500);
    assert.equal((await send(running.port).result).status, 401);
  } finally {await running.close();}
});
test('real socket proxy configuration rejects ambiguous forwarding and duplicate cookies', async () => {
  const running = await host(['127.0.0.1']);
  try {
    for (const value of ['', '127.1', '1.2.3.4, 5.6.7.8']) assert.equal((await send(running.port, '/session', undefined, {'x-forwarded-for': value}).result).status, 400);
    assert.equal((await send(running.port, '/session', undefined, {'x-forwarded-for': '1.2.3.4'}).result).status, 401);
    assert.equal((await send(running.port, '/session', undefined, {'x-forwarded-for': '1.2.3.4', cookie: 'cloud_session=one; cloud_session=two'}).result).status, 400);
  } finally {await running.close();}
});
function cli(overrides: NodeJS.ProcessEnv = {}) {
  const url = new URL(process.env.TEST_DATABASE_URL!); url.searchParams.set('options', `-c search_path=${db.schema}`);
  const child = spawn(process.execPath, [new URL('../src/server-cli.ts', import.meta.url).pathname], {env: {...process.env,
    DATABASE_URL: url.href, CLOUD_EMAIL_ACTIVE_KEY_ID: 'test', CLOUD_EMAIL_KEYS: JSON.stringify(db.keys),
    CLOUD_HTTP_RATE_KEY: db.rateKey, CLOUD_PORTAL_ORIGIN: 'http://localhost', CLOUD_HTTP_PORT: '0', CLOUD_HTTP_HOST: '127.0.0.1',
    NODE_ENV: 'test', CLOUD_HTTP_TRUSTED_PROXY_IPS: '', ...overrides}, stdio: ['ignore', 'pipe', 'pipe']});
  let stdout = ''; let stderr = '';
  child.stdout.on('data', chunk => {stdout += chunk;}); child.stderr.on('data', chunk => {stderr += chunk;});
  const exited = once(child, 'exit').then(([code, signal]) => ({code, signal, stdout, stderr}));
  const deadline = setTimeout(() => child.kill('SIGKILL'), 20000);
  void exited.finally(() => clearTimeout(deadline));
  return {child, exited, async ready() {
    await until(async () => stdout.includes('\n') || child.exitCode !== null);
    assert.equal(child.exitCode, null, stderr); return JSON.parse(stdout.trim()).port as number;
  }, async stop() {child.kill('SIGTERM'); return exited;}};
}
test('CLI fails closed with fixed diagnostics for invalid settings and absent migration', async () => {
  for (const overrides of [{CLOUD_HTTP_RATE_KEY: ''}, {CLOUD_EMAIL_KEYS: 'private-secret'}, {CLOUD_HTTP_TRUSTED_PROXY_IPS: '*'},
    {NODE_ENV: 'production'}, {DATABASE_URL: ''}, {CLOUD_HTTP_PORT: '-1'}, {CLOUD_PORTAL_ASSETS_DIR: '/missing-cloud-portal-build'}]) {
    const outcome = await cli(overrides).exited;
    assert.equal(outcome.code, 1); assert.equal(outcome.stdout, '');
    assert.equal(outcome.stderr, 'Account server failed; check database, migrations and configuration\n');
  }
  for (const migration of ['007_account_http.sql','008_pairing.sql','009_installation_lifecycle.sql','010_remote_access.sql','011_managed_backups.sql','012_backup_jobs.sql','013_service_monitoring.sql','014_remote_hostname_changes.sql','015_backup_recovery_requests.sql','016_server_replacement.sql','017_remote_probe_observations.sql','018_managed_continuous_recovery.sql','019_passkeys.sql','020_account_security_controls.sql','021_history_cleanup.sql','022_security_audit.sql','023_remote_cell_moves.sql']) {
  const saved = await db.pool.query('DELETE FROM schema_migrations WHERE name = $1 RETURNING *', [migration]);
  try {assert.equal((await cli().exited).code, 1); assert.equal((await db.pool.query('SELECT count(*) FROM schema_migrations WHERE name = $1', [migration])).rows[0].count, '0');}
  finally {await db.pool.query('INSERT INTO schema_migrations(name, digest) VALUES ($1, $2)', [saved.rows[0].name, saved.rows[0].digest]);}
  }
});
test('CLI rejects malformed installation issuer trust without exposing its value',async()=>{
 const privateKey=generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url');
 for(const overrides of [{CLOUD_INSTALLATION_ISSUER_KEY:privateKey,CLOUD_INSTALLATION_TRUSTED_KEYS:'["private-trust-sentinel"]'},{CLOUD_INSTALLATION_ISSUER_KEY:'',CLOUD_INSTALLATION_TRUSTED_KEYS:'[]'}]){
  const outcome=await cli(overrides).exited;
  assert.equal(outcome.code,1);assert.equal(outcome.stdout,'');assert.equal(outcome.stderr,'Account server failed; check database, migrations and configuration\n');
 }
});
test('CLI shutdown and restart preserve committed work and shared request limits', async () => {
  let running = cli();
  try {
    let port = await running.ready();
    const interrupted = send(port, '/signup/request', JSON.stringify({email: 'restart@example.test'}));
    await until(async () => await queued() === 1); interrupted.abort();
    const exit = await running.stop(); assert.equal(exit.code, 0); assert.equal(exit.stderr, '');
    running = cli(); port = await running.ready();
    const draining = send(port, '/signup/request', JSON.stringify({email: 'drain@example.test'}));
    await until(async () => await queued() === 2);
    const shutdown = running.stop();
    assert.equal((await draining.result).status, 202); assert.equal((await shutdown).code, 0);
    running = cli(); port = await running.ready();
    for (let i = 0; i < 8; i++) assert.equal((await send(port, '/signup/request', JSON.stringify({email: 'restart@example.test'})).result).status, 202);
    assert.equal(await queued(), 2); assert.equal((await send(port, '/signup/request', JSON.stringify({email: 'restart@example.test'})).result).status, 429);
    assert.equal((await running.stop()).code, 0);
  } finally {if (running.child.exitCode === null) await running.stop();}
});

test('shutdown stops admission and bounds the socket drain while database work remains pending', async () => {
  const running = await host(); const locker = await db.secondPool.connect();
  let closing: Promise<void> | undefined;
  try {
    await locker.query('BEGIN'); await locker.query('LOCK TABLE account_rate_limits IN ACCESS EXCLUSIVE MODE');
    const blocked = send(running.port);
    await until(async () => (await db.secondPool.query("SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock' AND query LIKE 'INSERT INTO account_rate_limits%'", [db.schema])).rowCount! > 0);
    const started = Date.now(); closing = running.close();
    assert.equal(running.close(), closing);
    await closing; assert.ok(Date.now() - started >= 9500); assert.ok(Date.now() - started < 12000);
    await assert.rejects(blocked.result);
  } finally {await locker.query('ROLLBACK'); locker.release(); await (closing ?? running.close());}
});
test('connection resets during parser rejection do not crash the CLI or leak diagnostics', async () => {
  const running = cli();
  try {
    const port = await running.ready();
    await Promise.all(Array.from({length: 50}, () => new Promise<void>(resolve => {
      const socket = connect(port, '127.0.0.1');
      const deadline = setTimeout(() => socket.destroy(), 2000);
      socket.on('error', () => {}); socket.on('close', () => {clearTimeout(deadline); resolve();});
      socket.on('connect', () => socket.write(`GET /api/account/session HTTP/1.1\r\nHost: localhost\r\nX-Sentinel: private-header-${'x'.repeat(9000)}\r\n\r\n`, () => {
        if (!socket.destroyed) socket.resetAndDestroy();
      }));
    })));
    assert.equal((await send(port).result).status, 401);
    const outcome = await running.stop(); assert.equal(outcome.code, 0); assert.equal(outcome.stderr, '');
  } finally {if (running.child.exitCode === null) await running.stop();}
});
test('CLI identifies the missing installation issuer without logging backup secrets',async()=>{
 const {generateKeyPairSync,randomBytes}=await import('node:crypto');
 const outcome=await cli({CLOUD_INSTALLATION_ISSUER_KEY:'',CLOUD_BACKUP_MASTER_KEY:randomBytes(32).toString('hex'),CLOUD_BACKUP_ENDPOINT:'https://store.test',CLOUD_BACKUP_REGION:'local',CLOUD_BACKUP_ACCESS_KEY:'operator-secret',CLOUD_BACKUP_SECRET_KEY:'private-secret',CLOUD_BACKUP_AUTHORITY:JSON.stringify({issuer:'https://issuer.test',audience:'backup',keyId:'test',privateKey:generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}).toString(),roles:{capture:'capture',stream:'stream',restore:'restore'}})}).exited;
 assert.equal(outcome.code,1);assert.equal(outcome.stdout,'');assert.equal(outcome.stderr,'Account server requires CLOUD_INSTALLATION_ISSUER_KEY when backup capture is configured\n');
});
