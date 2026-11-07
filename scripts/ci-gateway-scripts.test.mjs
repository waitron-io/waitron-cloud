import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import test from 'node:test';
import {createPlan} from './ci-plan.mjs';
import {loadWorkspace} from './ci-scope.mjs';
import {assertSummary} from './ci-summary.mjs';

const helper = 'scripts/verify-gateway-reconnection-receipt.mjs';
const checks = 'scripts/verify-gateway-reconnection-receipt.test.mjs';
const caller = 'scripts/gateway-reconnection-receipt.mjs';

const identity = ['scripts/identity-upstream.mjs', 'scripts/identity-upstream.test.mjs'];
const workspace = loadWorkspace();
const runner = resolve('scripts/ci-scripts.mjs');

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-gateway-script-'));
  const git = (...args) => execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  const put = (path, text) => {mkdirSync(join(root, path, '..'), {recursive: true}); writeFileSync(join(root, path), text);};
  const commit = () => {git('add', '-A'); git('commit', '-sm', 'Fixture'); return git('rev-parse', 'HEAD').trim();};
  try {
    git('init', '-b', 'main'); git('config', 'user.name', 'CI test'); git('config', 'user.email', 'ci@example.test');
    put(helper, 'export const result = 1;\n');
    put(checks, 'import assert from "node:assert/strict"; import {result} from "./verify-gateway-reconnection-receipt.mjs"; assert.equal(result, 1);\n');
    put(caller, 'import {result} from "./verify-gateway-reconnection-receipt.mjs";\n');
    put(identity[0], 'export const identity = 1;\n'); put(identity[1], 'import "./identity-upstream.mjs";\n');
    put('docs/receipts/gateway.json', '{}\n');
    const base = commit();
    const plan = (head, old = base, read = git) => createPlan({pull_request: {base: {sha: old}, head: {sha: head}}}, {sha: head}, workspace, read, () => {throw Error('No API');});
    const execute = selected => {
      const env = {...process.env, CI_PLAN: JSON.stringify(selected)}; delete env.NODE_TEST_CONTEXT;
      return spawnSync(process.execPath, [runner], {cwd: root, env, encoding: 'utf8'});
    };
    run({root, git, put, commit, base, plan, execute});
  } finally {rmSync(root, {recursive: true, force: true});}
}

test('an owned gateway validator or its test runs only its syntax, caller syntax and behavioral checks', () => {
  for (const path of [helper, checks]) fixture(({root, put, commit, plan, base, execute}) => {
    put(path, readFileSync(join(root, path), 'utf8') + '\n');
    const head = commit(), selected = plan(head);
    assert.deepEqual(selected.packages, []); assert.deepEqual(selected.receipts, []); assert.equal(selected.typecheck, false);
    assert.deepEqual(selected.scripts, {base, head, paths: [path]});
    const result = execute(selected); assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Passed root script checks/);
    const jobs = ['changes', 'scripts'].map(name => ({name, status: 'completed', conclusion: 'success'}));
    const results = {changes: 'success', scripts: 'success', packages: 'skipped', receipts: 'skipped', typecheck: 'skipped'};
    assert.doesNotThrow(() => assertSummary(selected, results, jobs));
    assert.throws(() => assertSummary(selected, {...results, scripts: 'failure'}, jobs));
  });
});

test('gateway caller, published evidence, new readers and installation changes retain the complete package inventory', () => {
  for (const path of [caller, 'docs/receipts/gateway.json', 'scripts/new-reader.mjs', 'package.json', '.gitattributes', identity[0]]) fixture(({root, put, commit, plan}) => {
    put(path, path.endsWith('.json') ? '{"changed":true}\n' : '// changed input\n');
    const changed = commit();
    put(helper, 'export const result = 1; // changed validator\n');
    const head = commit();
    for (const base of [undefined, changed]) {
      assert.equal(plan(head, base).packages.length, base === changed ? 0 : 29, path);
      assert.match(plan(head, base).reason, path === '.gitattributes' && !base ? /Root ownership refused/ : /verify-gateway-reconnection-receipt.mjs/);
    }
  });
});

test('gateway work checks real targets and complete inventories', () => fixture(({git, put, commit, plan, base}) => {
  put(helper, 'export const result = 1; // edited\n'); const head = commit();
  assert.deepEqual(plan(head).packages, []);
  for (const sha of [base, head]) for (const kind of ['truncated', 'omitted-reader']) {
    const read = (...args) => {
      if (args[0] === 'ls-tree' && args.at(-1) === sha) {
        if (kind === 'truncated') return git(...args).slice(0, -1);
        if (kind === 'omitted-reader') return git(...args).split('\0').filter(row => row.split('\t')[1] !== caller).join('\0');
      }
      return git(...args);
    };
    assert.equal(plan(head, base, read).packages.length, ['truncated', 'omitted-reader'].includes(kind) ? 29 : 0, `${sha}: ${kind}`);
  }
}));

test('missing or nonregular gateway targets in either revision retain full checks', () => {
  for (const path of [helper, checks]) for (const side of ['base', 'head']) for (const kind of ['missing', 'linked', 'executable']) fixture(({root, put, commit, plan, base}) => {
    if (kind === 'executable') chmodSync(join(root, path), 0o755);
    else {unlinkSync(join(root, path)); if (kind === 'linked') symlinkSync('gateway-reconnection-receipt.mjs', join(root, path));}
    const changed = commit();
    if (side === 'head') assert.equal(plan(changed).packages.length, 29, `${path}: ${kind}`);
    else {
      if (kind === 'linked') unlinkSync(join(root, path));
      put(path, path === helper ? 'export const result = 1;\n' : 'import "./verify-gateway-reconnection-receipt.mjs";\n');
      chmodSync(join(root, path), 0o644);
      const head = commit();
      assert.equal(plan(head, changed).packages.length, 29, `${path}: ${kind}`);
    }
  });
});

test('the gateway job runs real child checks and fails syntax, behavior and caller syntax errors', () => {
  for (const kind of ['behavior', 'syntax', 'caller-syntax']) fixture(({put, commit, plan, execute}) => {
    const base = kind === 'caller-syntax' ? (put(caller, 'const broken = ;\n'), commit()) : undefined;
    put(helper, kind === 'syntax' ? 'export const result = ;\n' : `export const result = ${kind === 'behavior' ? 2 : 1}; // edited\n`);
    const selected = plan(commit(), base); assert.deepEqual(selected.packages, []);
    const result = execute(selected); assert.equal(result.status, 1);
    assert.match(result.stdout + result.stderr, kind === 'behavior' ? /2 !== 1/ : /SyntaxError/);
  });
});

test('the gateway job rechecks the diff and exact checkout', () => fixture(({git, put, commit, plan, execute, base}) => {
  put(helper, 'export const result = 1; // edited\n'); const head = commit(), selected = plan(head);
  assert.deepEqual(selected.packages, []); assert.equal(execute(selected).status, 0);
  assert.equal(execute({...selected, scripts: {...selected.scripts, paths: [checks]}}).status, 1);
  put(helper, 'export const result = 1; // uncommitted\n'); assert.equal(execute(selected).status, 1);
  git('restore', helper); git('commit', '--allow-empty', '-sm', 'Identical tree, different commit');
  assert.equal(execute(selected).status, 1);
  put(caller, '// changed reader\n'); const stale = commit();
  put(helper, 'export const result = 1; // edited again\n'); const next = commit();
  const forged = {...selected, scripts: {base: stale, head: next, paths: [helper]}};
  assert.equal(execute(forged).status, 0);
}));
