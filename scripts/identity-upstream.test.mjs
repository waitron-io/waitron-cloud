import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {test} from 'node:test';

const script = resolve(import.meta.dirname, 'identity-upstream.mjs');

test('the upstream report lists only mapped source and behavioural-test commits after the reviewed revision', () => {
  const folder = mkdtempSync(join(tmpdir(), 'cloud-identity-upstream-'));
  const repository = join(folder, 'waitron with spaces');
  const sourceMap = join(folder, 'SOURCE.md');
  mkdirSync(repository);
  const git = (...args) => execFileSync('git', ['-C', repository, ...args], {encoding: 'utf8'}).trim();
  const commit = (file, message) => {
    writeFileSync(join(repository, file), message);
    git('add', file);
    git('commit', '-s', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Identity test');
    git('config', 'user.email', 'identity@example.test');
    mkdirSync(join(repository, 'packages/identity/src'), {recursive: true});
    const original = commit('packages/identity/src/secret-hash.ts', 'Original copy');
    const reviewed = commit('packages/identity/src/secret-hash.ts', 'Previously reviewed fix');
    const unrelated = commit('unrelated.txt', 'Unrelated change');
    const source = commit('packages/identity/src/secret-hash.ts', 'Later password fix');
    const tests = commit('packages/identity/src/secret-hash.test.ts', 'Later behavioural regression');
    writeFileSync(sourceMap, `Original copy: commit \`${original}\`.\nLast reviewed Waitron revision: \`${reviewed}\`.\n` +
      `[source](https://github.com/clintongormley/waitron/blob/${original}/packages/identity/src/secret-hash.ts)\n` +
      `[tests](https://github.com/clintongormley/waitron/blob/${original}/packages/identity/src/secret-hash.test.ts)\n`);
    const result = spawnSync(process.execPath, [script, repository, 'main', sourceMap], {encoding: 'utf8', cwd: folder});
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.reviewedRevision, reviewed);
    assert.equal(report.targetRevision, tests);
    assert.deepEqual(report.commits.map(commit => commit.sha), [source, tests]);
    assert.deepEqual(report.commits.map(commit => commit.subject), ['Later password fix', 'Later behavioural regression']);
    assert.ok(!report.commits.some(commit => [original, reviewed, unrelated].includes(commit.sha)));
    const empty = spawnSync(process.execPath, [script, repository, reviewed, sourceMap], {encoding: 'utf8'});
    assert.equal(empty.status, 0, empty.stderr);
    assert.deepEqual(JSON.parse(empty.stdout).commits, []);
    const diverged = spawnSync(process.execPath, [script, repository, original, sourceMap], {encoding: 'utf8'});
    assert.notEqual(diverged.status, 0);
    assert.match(diverged.stderr, /not an ancestor/);
    writeFileSync(sourceMap, 'No source revision or paths');
    const invalid = spawnSync(process.execPath, [script, repository, 'main', sourceMap], {encoding: 'utf8'});
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /source map/i);
  } finally {
    rmSync(folder, {recursive: true, force: true});
  }
});
