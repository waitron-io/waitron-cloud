import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, unlinkSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import test from 'node:test';
import {createPlan} from './ci-plan.mjs';
import {loadWorkspace} from './ci-scope.mjs';
import {assertSummary} from './ci-summary.mjs';

const workspace = loadWorkspace();
const helper = 'scripts/identity-upstream.mjs';
const checks = 'scripts/identity-upstream.test.mjs';
const policy = 'scripts/ci-scripts-audit.json';
const runner = resolve('scripts/ci-scripts.mjs');

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-root-script-'));
  const git = (...args) => execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  const put = (path, text) => {mkdirSync(join(root, path, '..'), {recursive: true}); writeFileSync(join(root, path), text);};
  const commit = () => {git('add', '-A'); git('commit', '-sm', 'Fixture'); return git('rev-parse', 'HEAD').trim();};
  try {
    git('init', '-b', 'main'); git('config', 'user.name', 'CI test'); git('config', 'user.email', 'ci@example.test');
    put(helper, 'export const result = 1;\n');
    put(checks, 'import assert from "node:assert/strict"; import {result} from "./identity-upstream.mjs"; assert.equal(result, 1);\n');
    put('scripts/consumer.mjs', 'console.log("unrelated");\n');
    put('docs/backlog.md', '# Backlog\n');
    const initial = commit();
    // Independent fixture certificate: exactly these two other files are pinned.
    const rows = git('ls-tree', '-rz', '--full-tree', initial).split('\0').filter(row =>
      ['docs/backlog.md', 'scripts/consumer.mjs'].includes(row.split('\t')[1]));
    put(policy, JSON.stringify({version: 1, inputSha256: createHash('sha256').update(rows.map(row => row + '\0').join('')).digest('hex')}) + '\n');
    const base = commit();
    const plan = (head, old = base, gitOverride = git) => createPlan({pull_request: {base: {sha: old}, head: {sha: head}}}, {sha: head}, workspace, gitOverride, () => {throw Error('no API');});
    const execute = selected => {
      const env = {...process.env, CI_PLAN: JSON.stringify(selected)};
      delete env.NODE_TEST_CONTEXT;
      return spawnSync(process.execPath, [runner], {cwd: root, env, encoding: 'utf8'});
    };
    run({root, git, put, commit, base, plan, execute});
  } finally {rmSync(root, {recursive: true, force: true});}
}

test('an audited root helper or its test selects syntax and the owning behavioral check only', () => {
  for (const path of [helper, checks]) fixture(({root, put, commit, plan, base, execute}) => {
    put(path, readFileSync(join(root, path), 'utf8') + '\n');
    const head = commit();
    const selected = plan(head);
    assert.deepEqual(selected.packages, []);
    assert.deepEqual(selected.receipts, []);
    assert.equal(selected.typecheck, false);
    assert.deepEqual(selected.scripts, {base, head, paths: [path]});
    assert.match(selected.reason, /Audited root script/);
    const result = execute(selected);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Passed root script checks/);
  });
});

test('changed consumers, installation, new readers and incomplete inventories retain full work in either revision', () => {
  for (const path of ['scripts/consumer.mjs', 'scripts/new-reader.mjs', 'package.json', 'docs/backlog.md']) fixture(({put, commit, plan, base}) => {
    put(path, path.endsWith('.json') ? '{}' : 'readFileSync("scripts/identity-upstream.mjs");\n');
    const changed = commit();
    put(helper, 'export const result = 1; // edited\n');
    const head = commit();
    for (const before of [base, changed]) assert.equal(plan(head, before).packages.length, 17, `${path} at ${before}`);
  });
  fixture(({put, commit, plan, git}) => {
    put(helper, 'export const result = 1; // edited\n');
    const head = commit();
    assert.equal(plan(head, undefined, (...args) => args[0] === 'ls-tree' ? git(...args).replace(/\0$/, '') : git(...args)).packages.length, 17);
  });
});

test('mixed paths, missing checks, symbolic links and executable modes cannot earn a script-only exemption', () => {
  for (const change of ['mixed', 'missing-test', 'missing-helper', 'link', 'executable']) fixture(({root, git, put, commit, plan}) => {
    put(helper, 'export const result = 1; // edited\n');
    if (change === 'mixed') put('apps/portal/src/changed.ts', 'export {};\n');
    if (change === 'missing-test') unlinkSync(join(root, checks));
    if (change === 'missing-helper') unlinkSync(join(root, helper));
    if (change === 'link') {unlinkSync(join(root, helper)); symlinkSync('consumer.mjs', join(root, helper));}
    if (change === 'executable') {git('add', '-A'); git('update-index', '--chmod=+x', helper); git('commit', '-sm', 'Executable input');}
    const head = change === 'executable' ? git('rev-parse', 'HEAD').trim() : commit();
    assert.equal(plan(head).packages.length, 17, change);
  });
});

test('missing, malformed and stale certificates fail closed with the changed path in the log', () => {
  for (const change of ['missing', 'malformed', 'stale', 'version']) fixture(({root, put, commit, plan}) => {
    if (change === 'missing') unlinkSync(join(root, policy));
    else put(policy, change === 'malformed' ? '{' : JSON.stringify({version: change === 'version' ? 2 : 1, inputSha256: '0'.repeat(64)}));
    const old = commit();
    put(helper, 'export const result = 1; // edited\n');
    const selected = plan(commit(), old);
    assert.equal(selected.packages.length, 17, change);
    assert.match(selected.reason, /identity-upstream.mjs/);
  });
});

test('the executed root job refuses syntax failures, behavioral failures, dirty or wrong checkouts and forged path lists', () => fixture(({put, commit, plan, execute}) => {
  put(helper, 'export const result = 2;\n');
  let head = commit();
  let selected = plan(head);
  assert.equal(selected.packages.length, 0);
  let result = execute(selected);
  assert.equal(result.status, 1, JSON.stringify(result));
  assert.match(result.stdout + result.stderr, /2 !== 1/);
  put(helper, 'export const result = ;\n');
  head = commit(); selected = plan(head); result = execute(selected);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SyntaxError/);
  put(helper, 'export const result = 1; // valid after failure\n');
  head = commit(); selected = plan(head);
  assert.deepEqual(selected.packages, []);
  assert.equal(execute(selected).status, 0);
  put(helper, 'export const result = 1; // uncommitted but behaviorally equal\n');
  assert.equal(execute(selected).status, 1, 'dirty helper');
  put(helper, 'export const result = 1; // valid after failure\n');
  for (const scripts of [{...selected.scripts, head: 'a'.repeat(40)}, {...selected.scripts, paths: [checks]}, {...selected.scripts, paths: []}, {...selected.scripts, paths: ['scripts/consumer.mjs']}]) {
    assert.equal(execute({...selected, scripts}).status, 1, JSON.stringify(scripts));
  }
  for (const extra of [{typecheck: true}, {packages: [{package: 'one', shard: 1}]}, {receipts: ['test:local-stack']},
    {reuse: {sha: head, runId: 42}}, {documentation: {base: selected.scripts.base, head, paths: ['README.md']}}]) {
    assert.equal(execute({...selected, ...extra}).status, 1, 'mixed execution: ' + JSON.stringify(extra));
  }
}));

test('a different commit with an identical tree still refuses the wrong checkout', () => fixture(({git, put, commit, plan, execute}) => {
  put(helper, 'export const result = 1; // edited\n');
  const selected = plan(commit());
  git('commit', '--allow-empty', '-sm', 'Different commit, same files');
  const result = execute(selected);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exact head checkout/);
}));

test('summary requires the root script job and rejects missing, duplicate, unfinished, failed or mixed work', () => {
  const scripts = {base: 'a'.repeat(40), head: 'b'.repeat(40), paths: [helper]};
  const plan = {packages: [], receipts: [], typecheck: false, reuse: null, scripts};
  const results = {changes: 'success', scripts: 'success', packages: 'skipped', receipts: 'skipped', typecheck: 'skipped'};
  const jobs = ['changes', 'scripts'].map(name => ({name, status: 'completed', conclusion: 'success'}));
  assert.doesNotThrow(() => assertSummary(plan, results, jobs));
  for (const result of ['skipped', 'failure', 'cancelled', 'in_progress']) assert.throws(() => assertSummary(plan, {...results, scripts: result}, jobs));
  assert.throws(() => assertSummary(plan, results, jobs.slice(0, 1)));
  assert.throws(() => assertSummary(plan, results, [...jobs, jobs[1]]));
  for (const conclusion of ['failure', 'cancelled', 'skipped']) assert.throws(() => assertSummary(plan, results, [jobs[0], {...jobs[1], conclusion}]));
  assert.throws(() => assertSummary(plan, results, [jobs[0], {...jobs[1], status: 'in_progress'}]));
  for (const paths of [[], [helper, helper], ['../scripts/identity-upstream.mjs'], ['scripts/consumer.mjs']]) assert.throws(() => assertSummary({...plan, scripts: {...scripts, paths}}, results, jobs));
  for (const revisions of [{base: 'bad'}, {head: 'HEAD'}, {base: null}, {head: 42}]) assert.throws(() => assertSummary({...plan, scripts: {...scripts, ...revisions}}, results, jobs));
  for (const extra of [{documentation: {base: scripts.base, head: scripts.head, paths: ['README.md']}}, {reuse: {sha: scripts.head, runId: 42}}, {typecheck: true}, {packages: [{package: 'one', shard: 1}]}]) {
    assert.throws(() => assertSummary({...plan, ...extra}, results, jobs));
  }
});

test('old-only stale evidence and forged incomplete inventories cannot omit consumers', () => fixture(({git, put, commit, plan, base}) => {
  put('scripts/consumer.mjs', 'readFileSync("scripts/identity-upstream.mjs");\n');
  const stale = commit();
  const rows = git('ls-tree', '-rz', '--full-tree', stale).split('\0').filter(row => ['docs/backlog.md', 'scripts/consumer.mjs'].includes(row.split('\t')[1]));
  put(policy, JSON.stringify({version: 1, inputSha256: createHash('sha256').update(rows.map(row => row + '\0').join('')).digest('hex')}) + '\n');
  const certified = commit();
  put(helper, 'export const result = 1; // change\n');
  const head = commit();
  assert.equal(plan(head, certified).packages.length, 0, 'new audit is valid');
  assert.equal(plan(head, stale).packages.length, 17, 'old audit is stale');
  for (const transform of [text => text.replace(/[^\0]*\tscripts\/consumer.mjs\0/, ''), text => text + 'malformed\0']) {
    assert.equal(plan(head, certified, (...args) => args[0] === 'ls-tree' ? transform(git(...args)) : git(...args)).packages.length, 17);
  }
  assert.equal(plan(head, base).packages.length, 17, 'mixed diff');
}));

test('unreadable or corrupted audit evidence from either immutable revision retains full work', () => fixture(({git, put, commit, plan, base}) => {
  put(helper, 'export const result = 1; // edited\n');
  const head = commit();
  for (const sha of [base, head]) {
    for (const failure of ['missing', 'version', 'digest']) {
      const read = (...args) => {
        if (args[0] === 'show' && args[1] === `${sha}:${policy}`) {
          if (failure === 'missing') throw Error('Object unavailable');
          const audit = JSON.parse(git(...args));
          if (failure === 'version') audit.version = 2;
          else audit.inputSha256 = '0'.repeat(64);
          return JSON.stringify(audit);
        }
        return git(...args);
      };
      assert.equal(plan(head, base, read).packages.length, 17, `${sha}: ${failure}`);
    }
  }
}));

test('missing or nonregular base helpers cannot hide behind a restored regular head', () => {
  for (const kind of ['missing', 'executable', 'linked']) fixture(({root, put, commit, plan}) => {
    if (kind === 'executable') chmodSync(join(root, helper), 0o755);
    else {
      unlinkSync(join(root, helper));
      if (kind === 'linked') symlinkSync('consumer.mjs', join(root, helper));
    }
    const base = commit();
    if (kind === 'linked') unlinkSync(join(root, helper));
    put(helper, 'export const result = 1; // restored regular helper\n');
    chmodSync(join(root, helper), 0o644);
    const head = commit();
    assert.equal(plan(head, base).packages.length, 17, kind);
  });
});

test('the executed runner rechecks stale certificates even when a forged plan names the exact diff and checkout', () => fixture(({put, commit, plan, execute}) => {
  put('scripts/consumer.mjs', 'readFileSync("scripts/identity-upstream.mjs");\n');
  const base = commit();
  put(helper, 'export const result = 1; // edited\n');
  const head = commit();
  assert.equal(plan(head, base).packages.length, 17);
  const forged = {packages: [], receipts: [], typecheck: false, reuse: null, scripts: {base, head, paths: [helper]}};
  const result = execute(forged);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /root-script consumer audit/);
}));

test('executed planner emits the script-only job and summary consumes its needs results', () => fixture(({root, git, put, commit}) => {
  put('package.json', JSON.stringify({name: 'fixture', private: true}));
  put('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
  for (const name of ['one', 'two']) put(`packages/${name}/package.json`, JSON.stringify({name, scripts: {test: 'node --test'}}));
  const initial = commit();
  const rows = git('ls-tree', '-rz', '--full-tree', initial).split('\0').filter(row => row && ![helper, checks, policy].includes(row.split('\t')[1]));
  put(policy, JSON.stringify({version: 1, inputSha256: createHash('sha256').update(rows.map(row => row + '\0').join('')).digest('hex')}) + '\n');
  const base = commit();
  put(helper, 'export const result = 1; // edited\n');
  const head = commit();
  put('event.json', JSON.stringify({pull_request: {base: {sha: base}, head: {sha: head}}}));
  put('output', '');
  const result = spawnSync(process.execPath, [resolve('scripts/ci-plan.mjs')], {cwd: root, env: {...process.env, GITHUB_EVENT_PATH: join(root, 'event.json'), GITHUB_OUTPUT: join(root, 'output')}, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const output = Object.fromEntries(readFileSync(join(root, 'output'), 'utf8').trim().split('\n').map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  assert.equal(output.scripts, 'true');
  for (const family of ['packages', 'receipts', 'typecheck', 'documentation']) assert.equal(output[family], 'false');
  assert.deepEqual(JSON.parse(output.plan).scripts, {base, head, paths: [helper]});
  const gh = '#!/bin/sh\nprintf \'%s\\n\' \'[{"jobs":[{"name":"changes","status":"completed","conclusion":"success"},{"name":"scripts","status":"completed","conclusion":"success"}]}]\'\n';
  put('gh', gh); git('update-index', '--refresh');
  execFileSync('chmod', ['+x', join(root, 'gh')]);
  const summary = spawnSync(process.execPath, [resolve('scripts/ci-summary.mjs')], {cwd: root, env: {...process.env, PATH: `${root}:${process.env.PATH}`, CI_PLAN: output.plan, CI_RESULTS: JSON.stringify({changes: {result: 'success'}, scripts: {result: 'success'}, packages: {result: 'skipped'}, receipts: {result: 'skipped'}, typecheck: {result: 'skipped'}, documentation: {result: 'skipped'}})}, encoding: 'utf8'});
  assert.equal(summary.status, 0, summary.stderr);
  assert.match(summary.stdout, /Passed root script checks/);
}));
