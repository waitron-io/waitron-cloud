import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync, chmodSync, unlinkSync, symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {fixture, recordPath} from './ci-input-audit-v2-fixture.mjs';
import {documentationPlan, checkDocumentation} from './ci-docs.mjs';
import {createPlan} from './ci-plan.mjs';

const cli = fileURLToPath(new URL('./ci-input-audit.mjs', import.meta.url));
const renew = (root, ...args) => {
  const result = spawnSync(process.execPath, [cli, '--write-staged', ...args], {cwd: root, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stdout + result.stderr);
};
const workspace = [{name: 'stock', directory: 'packages/stock', scripts: {test: 'node --test'}}];
const plan = (base, head, git) => createPlan({pull_request: {base: {sha: base}, head: {sha: head}}}, {sha: head}, workspace, git, () => {throw Error('No network');});

// The bug this catches is a shared aggregate or a prose-pinning peer renewal
// reintroducing audit conflicts between independently reviewed source paths.
test('two disjoint code and backlog PRs merge in both orders without audit renewal', () => fixture(({root, git, put, commit, audit}) => {
  const lines = Array.from({length: 40}, (_, index) => `Backlog paragraph ${index}.`);
  put('docs/backlog.md', lines.join('\n') + '\n'); git('add', '-A'); renew(root, '--mode', 'all'); const base = commit();
  const branches = [];
  for (const [label, target, line] of [['a', 'scripts/identity-upstream.mjs', 4], ['b', 'scripts/verify-gateway-reconnection-receipt.mjs', 34]]) {
    git('checkout', '-b', label, base);
    put(target, `export const value = 1;\n// Independent ${label} reader revision.\n`);
    const revised = [...lines]; revised[line] += ` Reviewed ${label}.`; put('docs/backlog.md', revised.join('\n') + '\n');
    git('add', '-A'); renew(root); const head = commit();
    const evidence = git('diff', '--name-only', base, head, '--', 'scripts/ci-input-audit.d').trim().split('\n');
    assert.deepEqual(evidence, [recordPath('docs', target)]);
    assert.doesNotThrow(() => audit('docs', head)); assert.throws(() => audit('identity', head));
    assert.equal(plan(base, head, git).typecheck, true);
    branches.push({label, head, evidence});
  }
  assert.ok(!branches[0].evidence.some(path => branches[1].evidence.includes(path)));
  for (const order of [branches, [...branches].reverse()]) {
    git('checkout', '-b', `sequential-${order[0].label}`, base);
    for (const branch of order) git('merge', '--no-ff', '--no-edit', '--signoff', branch.head);
    const combined = git('rev-parse', 'HEAD').trim();
    assert.equal(git('ls-files', '-u'), ''); assert.equal(git('status', '--porcelain=v1'), '');
    assert.doesNotThrow(() => audit('docs', combined));
    for (const mode of ['identity', 'gateway', 'lock']) assert.throws(() => audit(mode, combined));
    put('README.md', '# Prose-only child on combined main\n'); const child = commit();
    const documentation = documentationPlan(['README.md'], combined, child, git);
    assert.equal(checkDocumentation({documentation}, git), 1);
    const selected = plan(combined, child, git); assert.ok(selected.documentation); assert.equal(selected.typecheck, false);
    assert.equal(createPlan({}, {sha: child}, workspace, git).typecheck, true);
  }
  for (const branch of branches) assert.equal(git('rev-parse', branch.label).trim(), branch.head, 'No PR head change or regeneration');
}));

test('a shared-source merge needs review of its actual combined state', () => fixture(({root, git, put, commit, audit}) => {
  const source = 'packages/stock/src/index.mjs';
  const lines = ['export const first = 1;', ...Array.from({length: 15}, () => ''), 'export const second = 1;'];
  put(source, lines.join('\n') + '\n'); git('add', '-A'); renew(root, '--mode', 'all'); const base = commit();
  const heads = [];
  for (const [label, index, value] of [['first-change', 0, 'export const first = 2;'], ['second-change', 16, 'export const second = 3;']]) {
    git('checkout', '-b', label, base); const changed = [...lines]; changed[index] = value; put(source, changed.join('\n') + '\n');
    git('add', '-A'); renew(root); heads.push(commit());
  }
  git('checkout', '-b', 'combined-source', heads[0]);
  assert.throws(() => git('merge', '--no-ff', '--no-edit', '--signoff', heads[1]), /failed|Command/);
  assert.match(readFileSync(join(root, source), 'utf8'), /first = 2/); assert.match(readFileSync(join(root, source), 'utf8'), /second = 3/);
  // Choosing either old record does not authorize the new source bytes.
  put(recordPath('docs', source), git('show', `${heads[0]}:${recordPath('docs', source)}`));
  const combined = commit(); assert.equal(git('ls-files', '-u'), ''); assert.throws(() => audit('docs', combined), /Unreviewed/);
  renew(root); const reviewed = commit(); assert.doesNotThrow(() => audit('docs', reviewed));
}));

test('reviewed deletion and independent addition merge with retained tombstones', () => fixture(({root, git, put, commit, audit}) => {
  const base = git('rev-parse', 'HEAD').trim();
  git('checkout', '-b', 'rename', base); git('mv', 'packages/stock/src/index.mjs', 'packages/stock/src/renamed.mjs');
  git('add', '-A'); renew(root); const renamed = commit();
  git('checkout', '-b', 'addition', base); put('scripts/additional-reader.mjs', 'export const extra = true;\n');
  git('add', '-A'); renew(root); const added = commit();
  git('checkout', '-b', 'combined-rename', base); git('merge', '--no-ff', '--no-edit', '--signoff', renamed); git('merge', '--no-ff', '--no-edit', '--signoff', added);
  const combined = git('rev-parse', 'HEAD').trim(); assert.equal(git('ls-files', '-u'), ''); assert.doesNotThrow(() => audit('docs', combined));
  assert.equal(JSON.parse(readFileSync(join(root, recordPath('docs', 'packages/stock/src/index.mjs')), 'utf8')).state, 'absent');
}));


for (const transition of ['executable', 'link']) test(`reviewed ${transition} prose transition composes with a separate reader`, () => fixture(({root, git, put, commit, audit}) => {
  const base = git('rev-parse', 'HEAD').trim();
  git('checkout', '-b', 'transition', base);
  if (transition === 'executable') chmodSync(join(root, 'README.md'), 0o755);
  else {unlinkSync(join(root, 'README.md')); symlinkSync('docs/backlog.md', join(root, 'README.md'));}
  git('add', '-A'); renew(root); const changed = commit();
  git('checkout', '-b', 'separate', base); put('scripts/separate.mjs', 'export const value = 1;\n');
  git('add', '-A'); renew(root); const separate = commit();
  git('checkout', '-b', 'combined-transition', base); git('merge', '--no-ff', '--no-edit', '--signoff', changed); git('merge', '--no-ff', '--no-edit', '--signoff', separate);
  assert.equal(git('ls-files', '-u'), ''); assert.doesNotThrow(() => audit('docs'));
}));
