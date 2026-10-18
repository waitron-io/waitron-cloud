import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

function runFixture(file, name, env, timeout = 30_000) {
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', `--test-name-pattern=^${name}$`, file],
    {env, encoding: 'utf8', timeout, detached: true});
  // A fresh process group contains only this check and its descendants.
  if (result.pid > 0) {
    try {process.kill(-result.pid, 'SIGKILL');}
    catch (error) {if (error.code !== 'ESRCH') throw error;}
  }
  return result;
}

const cases = [
  ['ci-capacity-receipt.test.mjs', 'unrelated package changes omit capacity while retaining packages, types and other receipts'],
  ['ci-database-receipt.test.mjs', 'unrelated package changes omit database recovery while retaining packages, types and other receipts'],
  ['ci-gateway-receipt.test.mjs', 'unrelated package changes omit public gateway while retaining packages, types and other receipts'],
  ['ci-local-stack-receipt.test.mjs', 'unrelated package changes omit all audited receipts and retain actual package and type checks'],
  ['ci-cli.test.mjs', 'real squash merges run full on main for equal trees and advanced main without API access'],
  ['ci-docs.test.mjs', 'audited unread Markdown selects only the document check, including spaces and deletion'],
  ['ci-gateway-scripts.test.mjs', 'an audited gateway validator or its test runs only its syntax, caller syntax and behavioral checks'],
  ['ci-dependency-fixtures.test.mjs', 'receipt selector fixtures retain their assertions after dependency inputs change'],
  ['ci-lock-revisions.test.mjs', 'lock diagnostics name indirect consumers from saved trees without narrowing unaudited root work'],
  ['ci-receipts.test.mjs', 'backend-only changes omit the unchanged pure milestone receipt and preserve all other work'],
  ['ci-package-revisions.test.mjs', 'a removed sibling import keeps its former transitive consumers selected'],
  ['ci-scripts.test.mjs', 'an audited root helper or its test selects syntax and the owning behavioral check only'],
  ['ci-lock-selection.test.mjs', 'audited lock-only changes select resolved importers and saved helper consumers despite a dirty worktree'],
  ['ci-manifest-lock.test.mjs', 'manifest and resolved dependency additions select the importer and saved helper readers for every dependency kind'],
];
for (const [file, name] of cases) {
  test(`${file} starts no automatic Git maintenance process`, () => {
    const root = mkdtempSync(join(tmpdir(), 'cloud-receipt-maintenance-'));
    const trace = join(root, 'git-trace.json');
    const env = {...process.env, GIT_TRACE2_EVENT: trace};
    delete env.NODE_TEST_CONTEXT;
    try {
      // The dependency check gives four sequential workers 60 seconds; its
      // enclosing check must also allow repository setup and cleanup to finish.
      const timeout = file === 'ci-dependency-fixtures.test.mjs' ? 90_000 : 30_000;
      const result = runFixture(`scripts/${file}`, name, env, timeout);
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.deepEqual([...result.stdout.matchAll(/^ok \d+ - (.+)$/gm)].map(match => match[1]), [name], 'The exact fixture test must execute');
      const events = readFileSync(trace, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      assert.ok(events.some(event => event.event === 'start' && event.argv?.includes('commit')), 'The real fixture commit must execute and be traced');
      const maintenance = events.filter(event => event.event === 'child_start' && event.argv?.some(arg => arg === 'maintenance' || arg === 'gc'));
      assert.deepEqual(maintenance, [], 'Disposable test repositories must not start automatic background Git processes');
      if (['ci-local-stack-receipt.test.mjs', 'ci-dependency-fixtures.test.mjs'].includes(file)) {
        const starts = events.filter(event => event.event === 'start');
        const sourceReads = starts.filter(event => event.argv.includes('show') && /^[a-f0-9]{40}:.*\.[cm]?[jt]sx?$/.test(event.argv.at(-1)));
        assert.equal(sourceReads.length, 0, 'Fixture package discovery must not launch Git once per source file');
        const batches = starts.filter(event => event.argv.includes('cat-file') && event.argv.includes('--batch'));
        assert.equal(batches.length, file === 'ci-local-stack-receipt.test.mjs' ? 2 : 8, 'Fixture package discovery must read both saved revisions for every checked plan in batches');
      }
    } finally {rmSync(root, {recursive: true, force: true});}
  });
}

test('a timed-out fixture check stops its test worker', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-fixture-timeout-'));
  const pidFile = join(root, 'worker.pid');
  const file = join(root, 'hanging.test.mjs');
  let pid;
  try {
    writeFileSync(file, `import test from 'node:test'; import {writeFileSync} from 'node:fs'; test('stalled fixture', async () => { writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); await new Promise(() => {setInterval(() => {}, 1000);}); });\n`);
    const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
    const result = runFixture(file, 'stalled fixture', env, 5_000);
    pid = Number(readFileSync(pidFile, 'utf8'));
    assert.ok(pid > 0);
    assert.equal(result.error?.code, 'ETIMEDOUT');
    let alive = true;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {process.kill(pid, 0);} catch (error) {assert.equal(error.code, 'ESRCH'); alive = false; break;}
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(alive, false, 'The timed-out check must not leave its test worker alive');
  } finally {
    if (pid) {try {process.kill(pid, 'SIGKILL');} catch (error) {if (error.code !== 'ESRCH') throw error;}}
    rmSync(root, {recursive: true, force: true});
  }
});
