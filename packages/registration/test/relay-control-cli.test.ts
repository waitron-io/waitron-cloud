import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer, type Socket} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {after, before, beforeEach, test} from 'node:test';
import {Pool} from 'pg';
import {fixture} from './fixtures/relay-worker.ts';

const diagnostic = 'Relay control failed; check configuration, database and migrations\n';
const privateValue = 'private-cli-customer-password-sentinel';
const root = fileURLToPath(new URL('../../..', import.meta.url));
let f: Awaited<ReturnType<typeof fixture>>;
let admin: Pool;
let connection: string;
const children = new Set<ReturnType<typeof command>>();
before(async () => {
  f = await fixture(); admin = new Pool({connectionString: process.env.TEST_DATABASE_URL});
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.searchParams.set('options', `-c search_path=${f.schema} -c transaction_timeout=0`);
  connection = url.href;
});
after(async () => {
  for (const child of children) {child.process.kill('SIGKILL'); await child.done;}
  await f?.close(); await admin?.end();
});
beforeEach(async () => {await f.pool.query('UPDATE relay_control SET stopped=false');});

function command(args = ['--status'], env: Record<string, string | undefined> = {}, via: 'node' | 'root' | 'package' = 'node', deadline = 16000) {
  const child = spawn(via === 'node' ? process.execPath : 'pnpm',
    via === 'node' ? ['src/relay-control-cli.ts', ...args] : ['--silent', 'relay:control', ...args], {
      cwd: via === 'root' ? root : fileURLToPath(new URL('..', import.meta.url)),
      env: {...process.env, DATABASE_URL: connection, PGAPPNAME: f.schema + '_cli', ...env},
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => {stdout += data;}); child.stderr.on('data', data => {stderr += data;});
  const started = Date.now(), timer = setTimeout(() => child.kill('SIGKILL'), deadline);
  const done = new Promise<{code: number | null; signal: string | null}>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {clearTimeout(timer); resolve({code, signal});});
  });
  const result = {process: child, done, output: () => stdout, error: () => stderr, elapsed: () => Date.now() - started};
  children.add(result); void done.finally(() => children.delete(result)); return result;
}
async function success(child: ReturnType<typeof command>, stopped: boolean) {
  assert.deepEqual(await child.done, {code: 0, signal: null}, child.error());
  assert.ok(child.elapsed() < 5000, 'successful command closes its database pool promptly');
  assert.equal(child.output(), stopped ? '{"stopped":true}\n' : '{"stopped":false}\n');
  assert.equal(child.error(), '');
}
async function failure(child: ReturnType<typeof command>) {
  assert.deepEqual(await child.done, {code: 1, signal: null}, child.error());
  assert.equal(child.output(), '', 'failed commands cannot acknowledge state');
  assert.equal(child.error(), diagnostic);
  assert.ok(!child.output().includes(privateValue) && !child.error().includes(privateValue));
  assert.doesNotMatch(child.error(), /postgres:\/\/|SELECT|UPDATE|Error:/);
  assert.equal((await admin.query('SELECT count(*) FROM pg_stat_activity WHERE application_name=$1', [f.schema + '_cli'])).rows[0].count, '0');
}
async function flag(stopped: boolean) {
  assert.deepEqual((await f.pool.query('SELECT * FROM relay_control')).rows, [{singleton: true, stopped}]);
}
async function waiting(query: string, event: string, blocker?: number) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const row = (await admin.query(`SELECT pid,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
      WHERE application_name=$1 AND query LIKE $2 AND wait_event=$3`, [f.schema + '_cli', '%' + query + '%', event])).rows[0];
    if (row && (blocker === undefined || row.blockers.includes(blocker))) return row.pid as number;
    await delay(10);
  }
  assert.fail(`CLI did not wait at ${query} (${event}) on ${blocker ?? 'fixture'}`);
}
async function locked(table = 'relay_control') {
  const client = await f.pool.connect(); await client.query('BEGIN');
  const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
  await client.query(table === 'relay_control' ? 'SELECT * FROM relay_control FOR SHARE' : 'LOCK TABLE schema_migrations IN ACCESS EXCLUSIVE MODE');
  return {client, pid, async close() {await client.query('ROLLBACK'); client.release();}};
}

// Missing commits, wrong modes or hidden forwarding output break this contract.
test('control commands acknowledge committed state across fresh processes and silent forwarding', async () => {
  const venue = await f.venue(); await venue.submit({recipient: 'private-cli-customer-password-sentinel@example.test'});
  const tables = ['cloud_accounts', 'cloud_credentials', 'relay_messages', 'relay_reservations', 'relay_bounds_windows', 'relay_queue_bytes'];
  async function snapshot() {return Promise.all(tables.map(async table => (await f.pool.query(`SELECT * FROM ${table}`)).rows));}
  const before = await snapshot();
  const inbox = await (await fetch(process.env.MAILPIT_TEST_URL! + '/api/v1/messages')).json();
  await success(command(), false);
  await success(command(['--stop']), true); await flag(true);
  await success(command(['--stop']), true); await success(command(), true);
  await success(command(['--resume'], {}, 'root'), false); await flag(false);
  await success(command(['--stop'], {}, 'package'), true); await flag(true);
  await success(command(['--status'], {}, 'root'), true);
  await success(command(['--resume']), false); await success(command(['--resume']), false);
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await (await fetch(process.env.MAILPIT_TEST_URL! + '/api/v1/messages')).json(), inbox);
});

for (const [name, args] of [['missing', []], ['unknown', ['--unknown']], ['extra', ['--stop', '--status']]] as const) {
  test(`control command refuses ${name} arguments without changing state`, async () => {
    await failure(command([...args])); await flag(false);
  });
}
for (const [name, value] of [['missing', undefined], ['empty', ''], ['malformed', privateValue], ['wrong protocol', 'WRONG_PROTOCOL'], ['unreachable', 'postgres://user:' + privateValue + '@127.0.0.1:1/db']] as const) {
  test(`control command refuses ${name} database configuration without leaks`, async () => {
    const wrongProtocol = new URL(connection.replace(/^postgres(?:ql)?:/, 'https:'));
    await failure(command(['--stop'], {DATABASE_URL: value === 'WRONG_PROTOCOL' ? wrongProtocol.href : value})); await flag(false);
  });
}
for (const [name, sql] of [
  ['missing', "DELETE FROM schema_migrations WHERE name='036_relay_operator_stop.sql'"],
  ['extra', "INSERT INTO schema_migrations(name,digest) VALUES('037_private.sql','private-cli-customer-password-sentinel')"],
  ['changed name', "UPDATE schema_migrations SET name='036_private.sql' WHERE name='036_relay_operator_stop.sql'"],
  ['changed digest', "UPDATE schema_migrations SET digest='private-cli-customer-password-sentinel' WHERE name='036_relay_operator_stop.sql'"],
] as const) {
  test(`control command refuses ${name} release ledger before stop or resume`, async () => {
    const ledger = (await f.pool.query('SELECT * FROM schema_migrations')).rows;
    try {
      await f.pool.query(sql); await failure(command(['--stop'])); await flag(false);
      await f.pool.query('UPDATE relay_control SET stopped=true'); await failure(command(['--resume'])); await flag(true);
    } finally {
      await f.pool.query('TRUNCATE schema_migrations');
      for (const row of ledger) await f.pool.query('INSERT INTO schema_migrations(name,digest,applied_at) VALUES($1,$2,$3)', [row.name, row.digest, row.applied_at]);
    }
  });
}
test('missing control state is refused in every mode and never repaired', async () => {
  try {
    await f.pool.query('DELETE FROM relay_control');
    for (const mode of ['--status', '--stop', '--resume']) await failure(command([mode]));
    assert.equal((await f.pool.query('SELECT count(*) FROM relay_control')).rows[0].count, '0');
  } finally {await f.pool.query('INSERT INTO relay_control DEFAULT VALUES');}
});
test('stop produces no acknowledgement while waiting for a shared reader', async () => {
  const held = await locked(); const child = command(['--stop']);
  try {
    await waiting('FOR UPDATE', 'transactionid', held.pid);
    assert.equal(child.output(), ''); assert.equal(child.process.exitCode, null); await flag(false);
    await held.client.query('COMMIT'); await success(child, true); await flag(true);
  } finally {await held.close(); await child.done;}
});
test('cancelled stop releases its transaction without an acknowledgement or state change', async () => {
  const held = await locked(); const child = command(['--stop']);
  try {
    const pid = await waiting('FOR UPDATE', 'transactionid', held.pid);
    assert.equal((await admin.query('SELECT pg_cancel_backend($1) AS cancelled', [pid])).rows[0].cancelled, true);
    await failure(child); await flag(false);
    await held.client.query('COMMIT'); await success(command(['--stop']), true);
  } finally {await held.close(); await child.done;}
});
for (const mode of ['--stop', '--resume']) {
  test(`failed ${mode.slice(2)} commit cannot acknowledge or alter durable state`, async () => {
    await f.pool.query('UPDATE relay_control SET stopped=$1', [mode === '--resume']);
    await f.pool.query(`CREATE FUNCTION relay_cli_commit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '${privateValue}'; END $$`);
    await f.pool.query('CREATE CONSTRAINT TRIGGER relay_cli_commit_fail AFTER UPDATE ON relay_control DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION relay_cli_commit_fail()');
    try {await failure(command([mode])); await flag(mode === '--resume');}
    finally {await f.pool.query('DROP TRIGGER relay_cli_commit_fail ON relay_control'); await f.pool.query('DROP FUNCTION relay_cli_commit_fail()');}
  });
}
test('connection deadline bounds a peer that never completes database startup', async () => {
  const sockets = new Set<Socket>();
  const server = createServer(socket => {sockets.add(socket); socket.once('close', () => sockets.delete(socket));});
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const child = command(['--stop'], {DATABASE_URL: `postgres://user:${privateValue}@127.0.0.1:${address.port}/db`}, 'node', 8000);
    await failure(child); assert.ok(child.elapsed() < 7000); await flag(false);
  } finally {for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve()));}
});
test('statement deadline bounds ledger reads outside a transaction', async () => {
  const held = await locked('schema_migrations'); const child = command(['--stop']);
  try {
    await waiting('schema_migrations', 'relation', held.pid);
    await failure(child); assert.ok(child.elapsed() < 12000); await flag(false);
  } finally {await held.close(); await child.done;}
});
test('whole transaction deadline covers two waits shorter than the statement limit', async () => {
  await f.pool.query('UPDATE relay_control SET stopped=true');
  await f.pool.query('CREATE FUNCTION relay_cli_slow() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(6); RETURN NEW; END $$');
  await f.pool.query('CREATE TRIGGER relay_cli_slow BEFORE UPDATE ON relay_control FOR EACH ROW EXECUTE FUNCTION relay_cli_slow()');
  const held = await locked(); const child = command(['--resume']);
  try {
    await waiting('FOR UPDATE', 'transactionid', held.pid);
    await delay(6000); await held.client.query('COMMIT');
    await waiting('UPDATE relay_control', 'PgSleep');
    await failure(child); assert.ok(child.elapsed() < 12000); await flag(true);
  } finally {
    await held.close(); await child.done;
    await f.pool.query('DROP TRIGGER relay_cli_slow ON relay_control'); await f.pool.query('DROP FUNCTION relay_cli_slow()');
  }
});
