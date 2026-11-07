import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {appendFileSync, copyFileSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {rootInputPlan, assertRootInputWork} from './ci-root-inputs.mjs';
import {readGitBlobs} from './ci-package-revisions.mjs';
import {createPlan} from './ci-plan.mjs';

test('a complete candidate preserves full work, inherited events and exact root ownership', {timeout: 120_000}, () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-root-complete-review-'));
  const git = (...args) => {
    const binary = typeof args.at(-1) === 'object' && args.pop().binary;
    return execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {cwd: root,
      encoding: binary ? undefined : 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: 'pipe'});
  };
  git.readBlobs = ids => readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'],
    {cwd: root, input, maxBuffer: 64 * 1024 * 1024, stdio: 'pipe'}));
  const commit = () => {git('commit', '--allow-empty', '-s', '-qm', 'Save complete synthetic root review'); return git('rev-parse', 'HEAD').trim();};
  const rootPath = 'scripts/ci-root-shards.test.mjs';
  try {
    execFileSync('git', ['clone', '--shared', '--quiet', process.cwd(), root], {stdio: 'pipe'});
    const patch = execFileSync('git', ['diff', '--binary', 'HEAD'], {maxBuffer: 64 * 1024 * 1024});
    if (patch.length) execFileSync('git', ['apply', '--index', '--binary'], {cwd: root, input: patch, stdio: 'pipe'});
    copyFileSync(new URL(import.meta.url), join(root, 'scripts/ci-root-complete-review.test.mjs'));
    git('config', 'user.name', 'CI test'); git('config', 'user.email', 'ci@example.test');
    const base = commit();
    writeFileSync(join(root, 'scripts/unknown.json'), '{}\n'); git('add', '--', 'scripts/unknown.json');
    const fullHead = commit();
    const changedPaths = (base, head) => git('diff', '--name-only', '--no-renames', '-z', base, head).split('\0').filter(Boolean);
    assert.ok(changedPaths(base, fullHead).length > 0, 'Use a real changed range for complete-tree full work');
    const unowned = rootInputPlan(changedPaths(base, fullHead), base, fullHead, git);
    assert.equal(unowned, null, 'An unknown input cannot grant root ownership');
    const entries = git('ls-tree', '-rz', '--full-tree', fullHead).split('\0').filter(Boolean).map(raw => ({path: raw.split('\t')[1]}));
    assert.ok(entries.length >= 2000, 'Use the complete repository input volume');
    const workspace = entries.filter(row => /^(apps|packages)\/[^/]+\/package\.json$/.test(row.path))
      .map(row => ({...JSON.parse(git('show', `${fullHead}:${row.path}`)), directory: row.path.slice(0, -'/package.json'.length)}));
    const full = createPlan({pull_request: {base: {sha: base}, head: {sha: fullHead}}}, {}, workspace, git);
    assert.equal(full.packages.length, 29);
    assert.equal(full.receipts.length, 6);
    assert.equal(full.rootInputs, undefined);
    assert.doesNotThrow(() => assertRootInputWork(full, {base: base, head: fullHead, git}));

    const eventPath = join(root, '.git', 'root-full-event.json');
    writeFileSync(eventPath, JSON.stringify({pull_request: {base: {sha: base}, head: {sha: fullHead}}}));
    const fixtureEnv = {...process.env, GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: eventPath,
      GITHUB_SHA: fullHead, CI_HEAD_SHA: fullHead};
    delete fixtureEnv.NODE_TEST_CONTEXT;
    const summaryFixture = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern=^(executed summary|actual nested summary|executed planner emits)',
      'scripts/ci-cli.test.mjs', 'scripts/ci-summary.test.mjs', 'scripts/ci-scripts.test.mjs'], {cwd: root, encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 * 1024,
      env: fixtureEnv});
    assert.equal(summaryFixture.status, 0,
      `The job-contract fixture must remain independent of its caller's full PR event: ${summaryFixture.stdout}${summaryFixture.stderr}`);
    assert.match(summaryFixture.stdout, /# pass 5\b/, summaryFixture.stdout + summaryFixture.stderr);

    appendFileSync(join(root, rootPath), '\n// Complete-candidate owner control.\n');
    git('add', '--', rootPath); const head = commit();
    const narrowed = rootInputPlan(changedPaths(fullHead, head), fullHead, head, git);
    assert.equal(narrowed.full, undefined);
    assert.equal(narrowed.rootTests, true);
    assert.deepEqual(narrowed.receipts, []);
    assert.deepEqual(narrowed.rootInputs.entryIds, ['root-partition-contract']);
    appendFileSync(join(root, rootPath), '\n// Unreviewed complete-candidate input.\n');
    git('add', '--', rootPath); const stale = commit();
    assert.doesNotThrow(() => assertRootInputWork(full, {head: stale, git}));
  } finally {rmSync(root, {recursive: true, force: true});}
});
