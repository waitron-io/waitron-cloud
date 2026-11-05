import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync, rmSync, unlinkSync, symlinkSync, linkSync, renameSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {fixture, marker, recordPath} from './ci-input-audit-v2-fixture.mjs';

const cli = fileURLToPath(new URL('./ci-input-audit.mjs', import.meta.url));
const policy = 'scripts/ci-input-audit.json', records = 'scripts/ci-input-audit.d';
const run = (cwd, ...args) => spawnSync(process.execPath, [cli, ...args], {cwd, encoding: 'utf8'});
const ok = result => assert.equal(result.status, 0, result.stderr + result.stdout);
const bad = result => assert.notEqual(result.status, 0, result.stderr + result.stdout);
const snapshot = (root, git) => ({index: git('write-tree'), status: git('status', '--porcelain=v1', '-uall'),
  policy: readFileSync(join(root, policy), 'utf8')});

// Fails if default renewal updates peers or reads unstaged source.
test('v2 default and explicit docs renewal leave stale peers untouched', () => fixture(({root, git, put, commit, base}) => {
  const peer = recordPath('identity', 'package.json'), docs = recordPath('docs', 'package.json');
  const peerBytes = readFileSync(join(root, peer));
  put('package.json', '{"private":true,"description":"staged"}\n'); git('add', 'package.json');
  const index = git('write-tree');
  put('package.json', '{"private":true,"description":"unstaged"}\n');
  ok(run(root, '--write-staged'));
  assert.equal(git('write-tree'), index, 'Generation must never stage outputs');
  assert.deepEqual(readFileSync(join(root, peer)), peerBytes);
  const first = readFileSync(join(root, docs));
  ok(run(root, '--write-staged', '--mode', 'docs')); assert.deepEqual(readFileSync(join(root, docs)), first);
  git('add', docs); ok(run(root, '--write-staged')); assert.deepEqual(readFileSync(join(root, docs)), first);
  // Commit only staged bytes; the live source remains dirty and must not influence checking.
  git('commit', '-sm', 'Reviewed staged source'); const head = git('rev-parse', 'HEAD').trim();
  ok(run(root, '--check-mode', 'docs', head)); bad(run(root, '--check', head));
  assert.match(run(root, '--check', head).stdout + run(root, '--check', head).stderr, /identity|gateway|lock/);
  assert.equal(JSON.parse(first).objectId, git('rev-parse', `${head}:package.json`).trim());
  assert.notEqual(head, base);
}));

test('v2 generation is staged explicit and idempotent', () => fixture(({root, git, put}) => {
  git('checkout', '--orphan', 'historical-v1');
  rmSync(join(root, records), {recursive: true}); unlinkSync(join(root, marker));
  git('add', '-A'); git('commit', '-sm', 'V1 migration fixture');
  const before = snapshot(root, git);
  ok(run(root, '--init-v2-staged'));
  assert.equal(git('write-tree'), before.index); assert.equal(readFileSync(join(root, policy), 'utf8'), before.policy);
  const initial = git('status', '--porcelain=v1', '-uall');
  ok(run(root, '--init-v2-staged')); assert.equal(git('status', '--porcelain=v1', '-uall'), initial);
  git('add', marker, records); const tree = git('write-tree');
  bad(run(root, '--init-v2-staged'));
  ok(run(root, '--write-staged', '--mode', 'all')); assert.equal(git('write-tree'), tree);
  assert.equal(git('diff', '--', records, marker, policy), '');
  git('commit', '-sm', 'Reviewed v2 migration');
  ok(run(root, '--check', git('rev-parse', 'HEAD').trim()));
}));

test('v2 writer refuses unsafe outputs without changing index', () => {
  for (const fault of ['file-link', 'directory-link', 'hard-link', 'new-output-link', 'unknown-file']) fixture(({root, git, put}) => {
    const target = recordPath('docs', 'package.json');
    put('package.json', '{"private":true,"description":"changed"}\n'); git('add', 'package.json');
    const index = git('write-tree'); const outside = join(root, 'outside-original');
    writeFileSync(outside, 'untouched\n');
    if (fault === 'file-link') {unlinkSync(join(root, target)); symlinkSync(outside, join(root, target));}
    if (fault === 'hard-link') {unlinkSync(join(root, target)); linkSync(outside, join(root, target));}
    if (fault === 'directory-link') {renameSync(join(root, records), join(root, 'saved-records')); symlinkSync(join(root, 'saved-records'), join(root, records));}
    if (fault === 'new-output-link') {
      put('scripts/new-reader.mjs', 'export const value = 1;\n'); git('add', 'scripts/new-reader.mjs');
      symlinkSync(outside, join(root, recordPath('docs', 'scripts/new-reader.mjs')));
    }
    if (fault === 'unknown-file') put(`${records}/surprise.json`, '{}\n');
    const before = git('write-tree'); bad(run(root, '--write-staged'));
    assert.equal(readFileSync(outside, 'utf8'), 'untouched\n'); assert.equal(git('write-tree'), before);
    if (fault !== 'new-output-link') assert.equal(before, index);
  });
});

test('v2 CLI rejects invalid mode forms and checks without writing', () => fixture(({root, git, base}) => {
  for (const args of [[], ['--write-staged', '--mode', 'unknown'], ['--check-mode', 'all', base],
    ['--check-mode', 'docs', 'HEAD'], ['--init-v2-staged', '--mode', 'docs'], ['--check', base, '--mode', 'docs']]) bad(run(root, ...args));
  const before = snapshot(root, git); ok(run(root, '--check-mode', 'docs', base));
  assert.deepEqual(snapshot(root, git), before);
  bad(run(join(root, 'scripts'), '--write-staged')); bad(run(join(root, '.git'), '--write-staged'));
  assert.deepEqual(snapshot(root, git), before);
}));

test('v2 initialization refuses partial live output instead of silently completing it', () => fixture(({root, git}) => {
  git('checkout', '--orphan', 'historical-v1');
  rmSync(join(root, records), {recursive: true}); unlinkSync(join(root, marker)); git('add', '-A');
  git('commit', '-sm', 'V1 fixture for partial initialization');
  ok(run(root, '--init-v2-staged'));
  unlinkSync(join(root, recordPath('docs', 'package.json')));
  const before = snapshot(root, git); bad(run(root, '--init-v2-staged'));
  assert.deepEqual(snapshot(root, git), before);
}));

test('v2 writer records reviewed removals using a matching ancestor after a stale deletion', () => fixture(({root, git, commit, base}) => {
  unlinkSync(join(root, 'packages/stock/src/index.mjs')); commit();
  ok(run(root, '--write-staged'));
  const record = JSON.parse(readFileSync(join(root, recordPath('docs', 'packages/stock/src/index.mjs')), 'utf8'));
  assert.deepEqual(record, {version: 2, mode: 'docs', path: 'packages/stock/src/index.mjs', state: 'absent', previousRevision: base});
  const head = commit(); ok(run(root, '--check-mode', 'docs', head)); bad(run(root, '--check', head));
}));

test('v2 explicit peer renewal changes only its chosen mode and all-mode renewal is current', () => fixture(({root, git, put, commit}) => {
  put('package.json', '{"private":true,"description":"reviewed"}\n'); git('add', 'package.json');
  const docs = readFileSync(join(root, recordPath('docs', 'package.json')));
  ok(run(root, '--write-staged', '--mode', 'identity'));
  assert.deepEqual(readFileSync(join(root, recordPath('docs', 'package.json'))), docs);
  const head = commit(); ok(run(root, '--check-mode', 'identity', head)); bad(run(root, '--check-mode', 'docs', head));
  ok(run(root, '--write-staged', '--mode', 'all')); const current = commit(); ok(run(root, '--check', current));
}));
