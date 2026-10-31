import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const client = new URL('./fiscal-waitron-client.test.ts', import.meta.url).href;
const fixture = new URL('./fixtures/fiscal-waitron.ts', import.meta.url).href;
const store = new URL('../../fiscal-allocation/test/store-fixture.ts', import.meta.url).href;
const server = new URL('../src/server.ts', import.meta.url).href;

function run(blocking: boolean) {
  const source = `
    import { registerHooks, syncBuiltinESMExports } from 'node:module';
    import { readFileSync } from 'node:fs';
    import childProcess from 'node:child_process';
    delete process.env.WAITRON_FISCAL_TEST_CANDIDATE;
    childProcess.execFileSync = (command, args) => {
      if (command === 'pnpm' && ${blocking}) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
      return args.includes('rev-parse') ? '2293a60a311e20b227029782ba75048ee1fff241\\n' : '';
    };
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
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  if (!blocking) env.TMPDIR = new URL('./fixtures/missing-tmpdir-parent', import.meta.url).pathname;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 5000, env });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  return { result, reports: result.stderr.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line)) };
}

test('a completed blocking setup operation retains responsibility for its overrun', () => {
  const { result, reports } = run(true);
  assert.match(result.stdout, /test timed out after 50ms/);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].reason, 'deadline');
  assert.equal(reports[0].stage, 'source-install', JSON.stringify(reports));
});

test('temporary-directory refusal emits a bounded setup report', () => {
  const { result, reports } = run(false);
  assert.match(result.stdout + result.stderr, /ENOENT/);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].stage, 'temporary-directory');
  assert.equal(reports[0].reason, 'failure');
});
