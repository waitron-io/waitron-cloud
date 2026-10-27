import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {Pool, type PoolClient} from 'pg';
import type {TestContext} from 'node:test';
import {SMTPServer, type SMTPServerOptions} from 'smtp-server';
import {fixture} from './relay-worker.ts';

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(r => {resolve = r;});
  return {promise, resolve};
}
export async function waitLock(observer: Pool | PoolClient, name: string, query: string, blocker: number) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    await observer.query('SELECT pg_stat_clear_snapshot()');
    const row = (await observer.query(`SELECT pid,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
      WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE $2`, [name, '%' + query + '%'])).rows[0];
    if (row?.blockers.includes(blocker)) return row.pid as number;
    await delay(10);
  }
  assert.fail(`expected ${name} to wait at ${query} on backend ${blocker}`);
}
export async function setup(t: TestContext) {
  const f = await fixture();
  t.after(() => f.close());
  function labelled(suffix: string) {
    const name = f.schema + '_' + suffix;
    const pool = new Pool({connectionString: process.env.TEST_DATABASE_URL, max: 1, application_name: name,
      options: `-c search_path=${f.schema} -c statement_timeout=5000`});
    t.after(() => pool.end());
    return {pool, name};
  }
  return {...f, labelled};
}
export async function smtp(t: TestContext, options: SMTPServerOptions = {}) {
  const captured: string[] = [];
  const server = new SMTPServer({disabledCommands: ['AUTH', 'STARTTLS'], logger: false,
    onData(stream, _session, done) {
      let raw = ''; stream.on('data', part => {raw += part;});
      stream.on('end', () => {captured.push(raw); done();});
    }, ...options});
  server.on('error', () => {});
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  t.after(() => new Promise<void>(r => server.close(r)));
  const address = server.server.address(); assert.ok(address && typeof address !== 'string');
  return {port: address.port, captured, server};
}
export async function processWorker(t: TestContext, f: Awaited<ReturnType<typeof setup>>, port: number, suffix = randomUUID().slice(0, 8)) {
  const name = f.schema + '_' + suffix;
  const child = spawn(process.execPath, ['test/fixtures/relay-stop-process.ts'], {
    env: {...process.env, RELAY_TEST_SCHEMA: f.schema}, stdio: ['ignore', 'pipe', 'pipe', 'ipc']});
  let error = '', closed = false, sequence = 0;
  child.stderr!.on('data', part => {error += part;});
  const exit = new Promise<void>(r => child.once('exit', () => {closed = true; r();}));
  const pending = new Map<number, {resolve: (result: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>}>();
  const claimed = deferred();
  const sending = deferred();
  child.on('message', (message: any) => {
    if (message.event === 'claimed') {claimed.resolve(); return;}
    if (message.event === 'sending') {sending.resolve(); return;}
    const waiter = pending.get(message.id); if (!waiter) return;
    clearTimeout(waiter.timer); pending.delete(message.id);
    if (message.error) waiter.reject(Object.assign(new Error(message.error), {code: message.error}));
    else waiter.resolve(message.result);
  });
  child.on('exit', () => {
    for (const waiter of pending.values()) {clearTimeout(waiter.timer); waiter.reject(new Error(`worker exited: ${error}`));}
    pending.clear();
  });
  function command(action: string, extra: object = {}): Promise<any> {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {pending.delete(id); reject(new Error(`worker command timed out: ${action} ${error}`));}, 15000);
      pending.set(id, {resolve, reject, timer}); child.send({id, action, ...extra});
    });
  }
  async function close() {
    if (closed) return;
    child.send({action: 'release'}); child.send({action: 'close'});
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    await exit; clearTimeout(timer);
  }
  t.after(close);
  await command('init', {config: {...f.config, smtpPort: port}, name});
  return {name, child, command, claimed: claimed.promise, sending: sending.promise, release() {child.send({action: 'release'});}, close,
    async kill() {child.kill('SIGKILL'); await exit;}};
}
export async function spend(pool: Pool) {
  const tables = ['relay_reservations', 'relay_bounds_windows', 'relay_bounds_counters', 'relay_queue_bytes'];
  const rows: Record<string, unknown> = {};
  for (const table of tables) rows[table] = (await pool.query(`SELECT * FROM ${table} ORDER BY 1,2`)).rows;
  return rows;
}
