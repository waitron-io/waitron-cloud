import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import test from 'node:test';
import {createPlan} from './ci-plan.mjs';
import {loadWorkspace} from './ci-scope.mjs';
import {assertSummary} from './ci-summary.mjs';

const workspace = loadWorkspace();
const checker = resolve('scripts/ci-docs.mjs');
const policy = 'scripts/ci-docs-audit.json';
function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-docs-ci-'));
  const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  const put = (path, text) => { mkdirSync(join(root, path, '..'), {recursive: true}); writeFileSync(join(root, path), text); };
  const commit = () => { git('add', '-A'); git('commit', '-sm', 'Fixture'); return git('rev-parse', 'HEAD').trim(); };
  try {
    git('init', '-b', 'main'); git('config', 'user.name', 'CI test'); git('config', 'user.email', 'ci@example.test');
    put('scripts/reader.mjs', 'console.log("no document inputs");\n');
    put('docs/backlog.md', '# Backlog\n');
    put('README.md', '# Cloud\n');
    const initial = commit();
    // The fixture has exactly one audited input. Its digest does not use planner helpers.
    const entry = git('ls-tree', '-rz', '--full-tree', initial).split('\0').find(row => row.endsWith('\tscripts/reader.mjs'));
    const inputSha256 = createHash('sha256').update(`${entry}\0`).digest('hex');
    put(policy, JSON.stringify({version: 1, inputSha256}) + '\n');
    const base = commit();
    const plan = (head, old = base) => createPlan({pull_request: {base: {sha: old}, head: {sha: head}}}, {sha: head}, workspace, git, () => {throw Error('no API');});
    run({root, git, put, commit, base, plan});
  } finally { rmSync(root, {recursive: true, force: true}); }
}

test('audited unread Markdown selects only the document check, including spaces and deletion', () => fixture(({root, put, commit, plan}) => {
  put('docs/a plan.md', '# Plan\n');
  unlinkSync(join(root, 'README.md'));
  const selected = plan(commit());
  assert.deepEqual(selected.packages, []);
  assert.deepEqual(selected.receipts, []);
  assert.equal(selected.typecheck, false);
  assert.deepEqual(selected.documentation.paths, ['README.md', 'docs/a plan.md']);
  assert.match(selected.reason, /Audited unread Markdown/);
}));

test('a new reader invalidates later docs-only exemptions in both trees', () => fixture(({put, commit, plan, base}) => {
  put('scripts/new-reader.mjs', 'readFileSync("docs/backlog.md");\n');
  const reader = commit();
  put('docs/backlog.md', '# Updated\n');
  const head = commit();
  assert.equal(plan(head, reader).packages.length, 20);
  assert.equal(plan(head, base).packages.length, 20);
}));

test('changed or removed audited inputs and missing, malformed or stale audit evidence keep full work', () => {
  for (const change of ['changed', 'removed', 'missing', 'malformed', 'stale']) fixture(({root, put, commit, plan}) => {
    if (change === 'changed') put('scripts/reader.mjs', 'readFileSync("docs/backlog.md");\n');
    if (change === 'removed') unlinkSync(join(root, 'scripts/reader.mjs'));
    if (change === 'missing') unlinkSync(join(root, policy));
    if (change === 'malformed') put(policy, '{');
    if (change === 'stale') put(policy, JSON.stringify({version: 1, inputSha256: '0'.repeat(64)}) + '\n');
    const changed = commit();
    put('docs/backlog.md', '# Updated\n');
    assert.equal(plan(commit(), changed).packages.length, 20, change);
  });
});

test('package Markdown, document data and unknown paths preserve their existing checks', () => fixture(({put, commit, plan}) => {
  for (const path of ['packages/identity/SOURCE.md', 'docs/receipts/receipt.json', 'docs/unknown.bin', '.github/action.yml']) {
    put(path, '{}\n');
    const selected = plan(commit());
    assert.equal(selected.packages.length, 20, path);
  }
}));

test('mixed documents and portal code retain the full fallback', () => fixture(({put, commit, plan}) => {
  put('docs/backlog.md', '# Updated\n');
  put('apps/portal/src/change.ts', 'export const changed = true;\n');
  const selected = plan(commit());
  assert.equal(selected.packages.length, 20);
  assert.equal(selected.typecheck, true);
}));

test('document command reads exact immutable blobs and rejects invalid UTF-8, NUL, missing newline and symlinks', () => fixture(({root, git, put, commit, plan}) => {
  put('docs/backlog.md', '# Valid\n');
  put('docs/second.md', '# Second\n');
  const selected = plan(commit());
  const run = value => spawnSync(process.execPath, [checker], {cwd: root, env: {...process.env, CI_PLAN: JSON.stringify(value)}, encoding: 'utf8'});
  assert.equal(run(selected).status, 0);
  const omitted = run({...selected, documentation: {...selected.documentation, paths: ['docs/backlog.md']}});
  assert.equal(omitted.status, 1);
  assert.match(omitted.stderr, /omits changed inputs/);
  put('docs/backlog.md', 'uncommitted invalid content');
  assert.equal(run(selected).status, 0, 'working tree cannot replace the selected immutable blob');
  for (const content of ['missing newline', 'NUL\0\n', Buffer.from([0xff, 0x0a])]) {
    put('docs/backlog.md', content);
    const bad = run(plan(commit()));
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /UTF-8|NUL|newline/);
  }
  unlinkSync(join(root, 'docs/backlog.md'));
  symlinkSync('../README.md', join(root, 'docs/backlog.md'));
  const linked = plan(commit());
  assert.equal(linked.packages.length, 20, 'linked Markdown cannot earn the exemption');
}));

test('strict summary requires the audited document job and refuses malformed empty work', () => {
  const documentation = {base: 'a'.repeat(40), head: 'b'.repeat(40), paths: ['docs/backlog.md']};
  const plan = {packages: [], receipts: [], typecheck: false, reuse: null, documentation};
  const results = {changes: 'success', documentation: 'success', packages: 'skipped', receipts: 'skipped', typecheck: 'skipped'};
  const jobs = ['changes', 'documentation'].map(name => ({name, status: 'completed', conclusion: 'success'}));
  assert.doesNotThrow(() => assertSummary(plan, results, jobs));
  for (const result of ['skipped', 'failure', 'cancelled', 'in_progress']) assert.throws(() => assertSummary(plan, {...results, documentation: result}, jobs));
  assert.throws(() => assertSummary(plan, results, jobs.slice(0, 1)));
  assert.throws(() => assertSummary(plan, results, [...jobs, jobs[1]]));
  for (const conclusion of ['failure', 'cancelled', 'skipped']) {
    assert.throws(() => assertSummary(plan, results, [jobs[0], {...jobs[1], conclusion}]));
  }
  assert.throws(() => assertSummary(plan, results, [jobs[0], {...jobs[1], status: 'in_progress'}]));
  for (const invalid of [{...documentation, paths: []}, {...documentation, paths: ['scripts/a.mjs']}, {...documentation, head: 'bad'}]) {
    assert.throws(() => assertSummary({...plan, documentation: invalid}, results, jobs));
  }
});
