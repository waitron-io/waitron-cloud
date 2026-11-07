import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {appendFileSync, copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {checkRootReview, rootReviewProjection} from './ci-root-review.mjs';
import {rootInputPlan, assertRootInputWork} from './ci-root-inputs.mjs';
import {readGitBlobs} from './ci-package-revisions.mjs';
import {createPlan} from './ci-plan.mjs';

test('a complete legacy candidate keeps its record APIs separate from live selection', {timeout: 120_000}, t => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-root-complete-review-'));
  const git = (...args) => {
    const binary = typeof args.at(-1) === 'object' && args.pop().binary;
    return execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {cwd: root,
      encoding: binary ? undefined : 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: 'pipe'});
  };
  git.readBlobs = ids => readGitBlobs(ids, input => execFileSync('git', ['cat-file', '--batch'],
    {cwd: root, input, maxBuffer: 64 * 1024 * 1024, stdio: 'pipe'}));
  const run = (file, args) => {
    const result = spawnSync(process.execPath, [file, ...args], {cwd: root, encoding: 'utf8', timeout: 90_000,
      maxBuffer: 64 * 1024 * 1024});
    assert.equal(result.status, 0, result.stdout + result.stderr);
  };
  const commit = () => {git('commit', '--allow-empty', '-s', '-qm', 'Save complete synthetic root review'); return git('rev-parse', 'HEAD').trim();};
  const review = paths => {
    const before = git('write-tree').trim();
    run('scripts/ci-root-review.mjs', ['--write-staged', ...paths.flatMap(path => ['--input', path]),
      '--reviewer', 'Synthetic acceptance fixture', '--reference', 'test/complete-candidate']);
    assert.equal(git('write-tree').trim(), before, 'The review writer must not stage its outputs');
  };
  const docs = () => {
    git('add', '--', 'scripts/ci-root-review.d');
    run('scripts/ci-input-audit.mjs', ['--write-staged', '--mode', 'docs']);
    git('add', '--', 'scripts/ci-input-audit.d/docs');
  };
  const rootPath = 'scripts/ci-root-shards.test.mjs';
  try {
    execFileSync('git', ['clone', '--shared', '--quiet', process.cwd(), root], {stdio: 'pipe'});
    const patch = execFileSync('git', ['diff', '--binary', 'HEAD'], {maxBuffer: 64 * 1024 * 1024});
    if (patch.length) execFileSync('git', ['apply', '--index', '--binary'], {cwd: root, input: patch, stdio: 'pipe'});
    copyFileSync(new URL(import.meta.url), join(root, 'scripts/ci-root-complete-review.test.mjs'));
    git('config', 'user.name', 'CI test'); git('config', 'user.email', 'ci@example.test');
    // This fixture tests synthetic records, independent of the caller's retired
    // records and feature-only history, while retaining the complete source tree.
    git('checkout', '--orphan', 'synthetic-root-review');
    for (const directory of ['scripts/ci-root-review.d', 'scripts/ci-input-audit.d']) {
      rmSync(join(root, directory), {recursive: true, force: true});
    }
    git('add', '-A');
    const initial = commit();
    git('update-ref', 'refs/remotes/origin/main', initial);
    const beforeActivation = git('rev-parse', 'HEAD').trim();
    git('update-ref', 'refs/remotes/origin/main', beforeActivation);
    // These deliberately synthetic attestations test complete-tree validation.
    // They confer no reviewed ownership on the product checkout.
    writeFileSync(join(root, 'scripts/ci-root-inputs.json'), JSON.stringify({version: 1, entries: [{
      id: 'root-partition-contract', paths: [rootPath], owners: {rootTests: true, receipts: []},
      sites: [{reader: '.github/workflows/ci.yml', site: 'root.run', kind: 'command',
        boundary: 'scripts/ci-*.test.mjs; immediate directory only', role: 'execution'}],
    }]}) + '\n');
    git('add', '-A');
    const projection = rootReviewProjection(git('write-tree').trim(), git);
    assert.ok(projection.inputs.length >= 2000, 'Use the complete repository input volume');
    // Replacing the synthetic registry also requires renewed retained absences.
    const reviewDirectory = join(root, 'scripts/ci-root-review.d');
    const absences = existsSync(reviewDirectory) ? readdirSync(reviewDirectory).flatMap(name => {
      const record = JSON.parse(readFileSync(join(reviewDirectory, name), 'utf8'));
      return record.state === 'absent' || !projection.inputs.some(input => input.path === record.path) ? [record.path] : [];
    }) : [];
    const paths = [...projection.inputs.map(row => row.path), ...absences];
    const frozen = git('show', 'HEAD:scripts/ci-input-audit.json');
    review(paths);
    const records = () => readdirSync(join(root, 'scripts/ci-root-review.d')).sort()
      .map(name => [name, readFileSync(join(root, 'scripts/ci-root-review.d', name), 'utf8')]);
    const first = records();
    assert.equal(first.length, paths.length);
    t.diagnostic(`Explicitly reviewed ${paths.length} inputs in the complete synthetic candidate`);
    review(paths); assert.deepEqual(records(), first, 'Repeated explicit review is byte-identical');
    docs(); const activated = commit();
    run('scripts/ci-root-review.mjs', ['--check', activated]);
    assert.doesNotThrow(() => checkRootReview(activated, git));
    const changedPaths = (base, head) => git('diff', '--name-only', '--no-renames', '-z', base, head).split('\0').filter(Boolean);
    const bootstrap = rootInputPlan(changedPaths(beforeActivation, activated), beforeActivation, activated, git);
    assert.equal(bootstrap, null, 'Retired activation cannot grant root ownership');
    const workspace = projection.inputs.filter(row => /^(apps|packages)\/[^/]+\/package\.json$/.test(row.path))
      .map(row => ({...JSON.parse(git('show', `${activated}:${row.path}`)), directory: row.path.slice(0, -'/package.json'.length)}));
    const full = createPlan({pull_request: {base: {sha: beforeActivation}, head: {sha: activated}}}, {}, workspace, git);
    assert.equal(full.packages.length, 29);
    assert.equal(full.receipts.length, 6);
    assert.equal(full.rootInputs, undefined);
    assert.doesNotThrow(() => assertRootInputWork(full, {base: beforeActivation, head: activated, git}));

    const eventPath = join(root, '.git', 'root-activation-event.json');
    writeFileSync(eventPath, JSON.stringify({pull_request: {base: {sha: beforeActivation}, head: {sha: activated}}}));
    const fixtureEnv = {...process.env, GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: eventPath,
      GITHUB_SHA: activated, CI_HEAD_SHA: activated};
    delete fixtureEnv.NODE_TEST_CONTEXT;
    const summaryFixture = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern=^(executed summary|actual nested summary|executed planner emits)',
      'scripts/ci-cli.test.mjs', 'scripts/ci-summary.test.mjs', 'scripts/ci-scripts.test.mjs'], {cwd: root, encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 * 1024,
      env: fixtureEnv});
    assert.equal(summaryFixture.status, 0,
      `The legacy job-contract fixture must remain independent of its caller's activated PR event: ${summaryFixture.stdout}${summaryFixture.stderr}`);
    assert.match(summaryFixture.stdout, /# pass 5\b/, summaryFixture.stdout + summaryFixture.stderr);

    appendFileSync(join(root, rootPath), '\n// Complete-candidate owner control.\n');
    git('add', '--', rootPath); review([rootPath]); docs(); const head = commit();
    const narrowed = rootInputPlan(changedPaths(activated, head), activated, head, git);
    assert.equal(narrowed.full, undefined);
    assert.equal(narrowed.rootTests, true);
    assert.deepEqual(narrowed.receipts, []);
    assert.deepEqual(narrowed.rootInputs.entryIds, ['root-partition-contract']);
    assert.equal(git('show', `${head}:scripts/ci-input-audit.json`), frozen);
    assert.equal(git('diff', '--name-only', activated, head, '--', 'scripts/ci-root-review.d').trim().split('\n').length, 1);
    run('scripts/ci-root-review.mjs', ['--check', head]);

    appendFileSync(join(root, rootPath), '\n// Unreviewed complete-candidate input.\n');
    git('add', '--', rootPath); docs(); const stale = commit();
    assert.doesNotThrow(() => assertRootInputWork(full, {head: stale, git}));
  } finally {rmSync(root, {recursive: true, force: true});}
});
