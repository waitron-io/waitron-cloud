import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import { PassThrough, Writable } from 'node:stream';
import { test, type TestContext } from 'node:test';
import { control, receipt } from './fixtures/fiscal-setup-controls.ts';

const fixtureUrl = new URL('./fixtures/fiscal-waitron.ts', import.meta.url).href;
const replacement = new URL('./fixtures/fiscal-setup-controls.ts', import.meta.url).href;
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === fixtureUrl && ['../../src/server.ts', '../../../fiscal-allocation/test/store-fixture.ts'].includes(specifier))
      return { url: replacement, shortCircuit: true };
    return next(specifier, context);
  },
});
const { jointFixture, waitronCandidate } = await import('./fixtures/fiscal-waitron.ts');
hook.deregister();

function prepare(t: TestContext, at = '', deadlineAt = '') {
  control.at = at; control.closed = [];
  let notifyDeadline: (() => void) | undefined, setupTimer: unknown, timerCleared = false;
  control.onStage = stage => { if (stage === deadlineAt) notifyDeadline?.(); };
  const setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback: () => void, ms?: number, ...args: unknown[]) => {
    const timer = setTimer(callback, ms, ...args);
    if (ms === 120000) { notifyDeadline = callback; setupTimer = timer; }
    return timer;
  });
  t.mock.method(globalThis, 'clearTimeout', (timer: Parameters<typeof clearTimer>[0]) => {
    if (timer === setupTimer) timerCleared = true;
    return clearTimer(timer);
  });
  const reports: string[] = [], reportClosed: string[][] = [], roots: string[] = [], commands: { command: string; args: string[]; timeout?: number }[] = [];
  const previous = process.env.WAITRON_FISCAL_TEST_CANDIDATE;
  delete process.env.WAITRON_FISCAL_TEST_CANDIDATE;
  t.after(async () => {
    if (previous === undefined) delete process.env.WAITRON_FISCAL_TEST_CANDIDATE; else process.env.WAITRON_FISCAL_TEST_CANDIDATE = previous;
    t.mock.restoreAll(); syncBuiltinESMExports();
    for (const root of roots) await fs.rm(root, { recursive: true, force: true });
  });
  const createServer = net.createServer;
  t.mock.method(net, 'createServer', (...args: Parameters<typeof createServer>) => { control.enter('port'); return createServer(...args); });
  const mkdtemp = fs.mkdtemp, writeFile = fs.writeFile, generate = crypto.generateKeyPairSync;
  t.mock.method(fs, 'mkdtemp', async (...args: Parameters<typeof mkdtemp>) => {
    const root = await mkdtemp(...args); roots.push(root); return root;
  });
  t.mock.method(fs, 'writeFile', async (...args: Parameters<typeof writeFile>) => {
    control.enter('configuration'); return writeFile(...args);
  });
  t.mock.method(crypto, 'generateKeyPairSync', (...args: Parameters<typeof generate>) => {
    control.enter('machine-key'); return generate(...args);
  });
  t.mock.method(console, 'error', (line: string) => { reports.push(line); reportClosed.push([...control.closed]); });
  t.mock.method(childProcess, 'execFileSync', (command: string, args: string[], options?: { timeout?: number }) => {
    const stage = command === 'pnpm' ? 'source-install' : args[0] === 'init' ? 'source-init' :
      args.includes('fetch') ? 'source-fetch' : args.includes('checkout') ? 'source-checkout' :
      args.includes('rev-parse') ? 'candidate-head' : 'candidate-tree';
    commands.push({ command, args, timeout: options?.timeout }); control.enter(stage);
    return stage === 'candidate-head' ? waitronCandidate + '\n' : '';
  });
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    control.enter(url.endsWith('/reserve') ? 'reserve' : 'consume');
    return new Response(JSON.stringify(receipt), { status: 200 });
  });
  let bridgeStopped = false;
  t.mock.method(childProcess, 'spawn', () => {
    control.enter('bridge-start');
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(),
      stdin: new Writable({
        write(chunk, _encoding, done) {
          const request = JSON.parse(chunk.toString());
          try { control.enter('bridge-ready'); }
          catch { setImmediate(() => child.emit('error', control.error)); done(); return; }
          setImmediate(() => child.stdout.write('JOINT:' + JSON.stringify({ id: request.id, result: { ready: true } }) + '\n'));
          done();
        },
        final(done) { bridgeStopped = true; setImmediate(() => { child.stdout.end(); child.stderr.end(); child.emit('exit', 0); }); done(); },
      }),
      kill() { bridgeStopped = true; child.emit('exit', null, 'SIGTERM'); return true; },
    });
    return child;
  });
  syncBuiltinESMExports();
  return { reports, reportClosed, roots, commands, get timerCleared() { return timerCleared; }, get timerHasRef() { return (setupTimer as NodeJS.Timeout).hasRef(); }, get bridgeStopped() { return bridgeStopped; } };
}

// Omitting a stage mark must identify the wrong operation and fail these controls.
for (const stage of ['source-init', 'source-fetch', 'source-checkout', 'source-install', 'candidate-head', 'candidate-tree',
  'database', 'venue', 'port', 'account-server', 'reserve', 'consume', 'machine-key', 'machine-registration', 'lease', 'configuration', 'bridge-start', 'bridge-ready']) {
  test(`joint fixture reports ${stage} before cleanup without exposing the thrown value`, async t => {
    const f = prepare(t, stage);
    await assert.rejects(jointFixture(), error => error === control.error);
    assert.equal(f.reports.length, 1); assert.deepEqual(f.reportClosed, [[]]);
    const report = JSON.parse(f.reports[0]!);
    assert.deepEqual(Object.keys(report).sort(), ['elapsedMs', 'event', 'reason', 'stage', 'stageElapsedMs']);
    assert.equal(report.event, 'cloud-fiscal-joint-setup-failed');
    assert.equal(report.reason, 'failure'); assert.equal(report.stage, stage);
    assert.ok(report.elapsedMs >= report.stageElapsedMs && report.stageElapsedMs >= 0);
    for (const root of f.roots) await assert.rejects(fs.access(root), { code: 'ENOENT' });
    assert.deepEqual(control.closed, ['source-init', 'source-fetch', 'source-checkout', 'source-install', 'candidate-head', 'candidate-tree', 'database'].includes(stage)
      ? [] : ['venue', 'port', 'account-server'].includes(stage) ? ['database'] : ['server', 'database']);
    if (stage === 'bridge-ready') assert.equal(f.bridgeStopped, true);
    assert.equal(f.timerCleared, true);
  });
}

test('successful setup is silent, keeps command budgets and releases resources', async t => {
  const f = prepare(t);
  const fixture = await jointFixture();
  assert.deepEqual(f.reports, []); assert.equal(f.timerHasRef, false);
  assert.deepEqual(f.commands.map(c => [c.command, c.timeout]), [
    ['git', undefined], ['git', 60000], ['git', undefined], ['pnpm', 120000], ['git', undefined], ['git', undefined],
  ]);
  assert.ok(f.commands[1]!.args.includes('2293a60a311e20b227029782ba75048ee1fff241'));
  assert.equal(f.timerCleared, true);
  await fixture.close(); assert.deepEqual(control.closed, ['server', 'database']); assert.equal(f.bridgeStopped, true);
  for (const root of f.roots) await assert.rejects(fs.access(root), { code: 'ENOENT' });
});

test('an installed checkout bypasses fetch and install but retains both identity checks', async t => {
  const f = prepare(t);
  process.env.WAITRON_FISCAL_TEST_CANDIDATE = '/controlled/installed-checkout';
  const fixture = await jointFixture(); await fixture.close();
  assert.equal(f.commands.length, 2);
  assert.deepEqual(f.commands.map(c => c.args), [
    ['-C', '/controlled/installed-checkout', 'rev-parse', 'HEAD'],
    ['-C', '/controlled/installed-checkout', 'status', '--porcelain', '--untracked-files=no'],
  ]);
  assert.deepEqual(f.reports, []);
});

test('the reporting timer names the active setup operation once without altering its failure', async t => {
  const f = prepare(t, 'consume', 'reserve');
  await assert.rejects(jointFixture(), error => error === control.error);
  assert.equal(f.reports.length, 1);
  const report = JSON.parse(f.reports[0]!);
  assert.equal(report.reason, 'deadline'); assert.equal(report.stage, 'reserve');
  assert.equal(f.timerCleared, true);
  assert.deepEqual(control.closed, ['server', 'database']);
});

test('a broken reporter cannot replace the original setup failure or prevent cleanup', async t => {
  const f = prepare(t, 'consume');
  t.mock.method(console, 'error', () => { throw new Error('reporter refused'); });
  await assert.rejects(jointFixture(), error => error === control.error);
  assert.deepEqual(control.closed, ['server', 'database']);
  assert.equal(f.timerCleared, true);
});

test('the real before hook reports its active database stage when its own deadline aborts', () => {
  const client = new URL('./fiscal-waitron-client.test.ts', import.meta.url).href;
  const fixture = new URL('./fixtures/fiscal-waitron.ts', import.meta.url).href;
  const store = new URL('../../fiscal-allocation/test/store-fixture.ts', import.meta.url).href;
  const server = new URL('../src/server.ts', import.meta.url).href;
  const source = `
    import { registerHooks, syncBuiltinESMExports } from 'node:module';
    import { readFileSync } from 'node:fs';
    import childProcess from 'node:child_process';
    process.env.WAITRON_FISCAL_TEST_CANDIDATE = '/controlled/installed-checkout';
    childProcess.execFileSync = (_command, args) => args.includes('rev-parse') ? '${waitronCandidate}\\n' : '';
    syncBuiltinESMExports();
    registerHooks({ load(url, context, next) {
      if (url === ${JSON.stringify(client)}) return { format: 'module-typescript', shortCircuit: true,
        source: readFileSync(new URL(url), 'utf8').replace('timeout: 120000', 'timeout: 50') };
      if (url === ${JSON.stringify(fixture)}) return { format: 'module-typescript', shortCircuit: true,
        source: readFileSync(new URL(url), 'utf8').replace('const setupDeadline = 120000;', 'const setupDeadline = 50;') };
      if (url === ${JSON.stringify(store)}) return { format: 'module', shortCircuit: true,
        source: "export async function storeFixture() { await new Promise(r => setTimeout(r, 150)); throw new Error('controlled database refusal'); }" };
      if (url === ${JSON.stringify(server)}) return { format: 'module', shortCircuit: true,
        source: 'export async function startAccountServer() { throw new Error("unexpected server start"); }' };
      return next(url, context);
    }});
    await import(${JSON.stringify(client)});
  `;
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = childProcess.spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 5000, env });
  assert.equal(result.error, undefined); assert.equal(result.status, 1);
  assert.match(result.stdout, /test timed out after 50ms/, result.stderr);
  const reports = result.stderr.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  assert.equal(reports.length, 1);
  assert.equal(reports[0].event, 'cloud-fiscal-joint-setup-failed');
  assert.equal(reports[0].reason, 'deadline'); assert.equal(reports[0].stage, 'database');
  assert.ok(reports[0].stageElapsedMs >= 0);
});

test('reporting never reads a hostile thrown object', async t => {
  const f = prepare(t, 'consume');
  const original = control.error;
  const hostile = new Proxy({}, { get() { assert.fail('read the private thrown object'); }, ownKeys() { assert.fail('enumerated the private thrown object'); } });
  control.error = hostile as Error;
  try {
    let caught: unknown;
    try { await jointFixture(); } catch (error) { caught = error; }
    assert.equal(caught, hostile);
  } finally { control.error = original; }
  assert.equal(JSON.parse(f.reports[0]!).stage, 'consume');
  assert.deepEqual(control.closed, ['server', 'database']); assert.equal(f.timerCleared, true);
});


test('a source overrun is reported before later synchronous stages even when setup succeeds', async t => {
  const f = prepare(t);
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  control.onStage = stage => { if (stage === 'source-install') now = 120001; };
  const fixture = await jointFixture();
  await fixture.close();
  assert.equal(f.reports.length, 1);
  assert.deepEqual(JSON.parse(f.reports[0]!), {
    event: 'cloud-fiscal-joint-setup-failed', reason: 'deadline', stage: 'source-install',
    elapsedMs: 120001, stageElapsedMs: 120001,
  });
  assert.equal(f.timerCleared, true);
  assert.deepEqual(control.closed, ['server', 'database']);
});

test('initial directory failure keeps its original error and clears its reporting timer', async t => {
  const f = prepare(t);
  t.mock.method(fs, 'mkdtemp', async () => { throw control.error; });
  syncBuiltinESMExports();
  await assert.rejects(jointFixture(), error => error === control.error);
  assert.equal(f.reports.length, 1);
  assert.equal(JSON.parse(f.reports[0]!).stage, 'temporary-directory');
  assert.equal(JSON.parse(f.reports[0]!).reason, 'failure');
  assert.equal(f.timerCleared, true);
  assert.deepEqual(control.closed, []);
});
