import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {loadWorkspace, scopeForPaths, workPlan} from './ci-scope.mjs';
import {assertSummary} from './ci-summary.mjs';

const members = ['identity', 'operations', 'remote-access'].map(name => `@waitron-cloud/${name}`);
const row = selected => ({package: selected.join(' + '), members: selected, shard: 1});

test('full plan packs all short packages exactly once while preserving every other shard', () => {
  const workspace = loadWorkspace();
  const plan = workPlan(scopeForPaths([], workspace), workspace);
  assert.equal(plan.packages.length, 19);
  assert.deepEqual(plan.packages.find(item => item.members), row(members));
  const logical = plan.packages.flatMap(item => item.members ?? [item.package]);
  for (const name of members) assert.equal(logical.filter(value => value === name).length, 1);
  assert.deepEqual([...new Set(logical)].sort(), workspace.map(pkg => pkg.name).sort());
  for (const [name, count] of [['registration', 5], ['account-http', 3], ['backups', 2], ['portal', 6]]) {
    assert.deepEqual(plan.packages.filter(item => item.package === `@waitron-cloud/${name}`),
      Array.from({length: count}, (_, i) => ({package: `@waitron-cloud/${name}`, shard: i + 1, shards: count})));
  }
});

test('grouping packs only selected packages and keeps a singleton in its original job', () => {
  const workspace = loadWorkspace();
  for (const selected of [members.slice(0, 2), members.slice(1), [members[0], members[2]], members]) {
    assert.deepEqual(workPlan({full: false, packages: selected}, workspace).packages, [row(selected)]);
  }
  for (const name of members) assert.deepEqual(workPlan({full: false, packages: [name]}, workspace).packages, [{package: name, shard: 1}]);
});

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-short-packages-'));
  const log = join(root, 'calls');
  try {
    writeFileSync(join(root, 'pnpm'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$PACKAGE_CALLS"\nprintf "package-output:%s\\n" "$2"\nprintf "# tests 1\\n# pass 1\\n# fail 0\\n# cancelled 0\\n# skipped 0\\n# todo 0\\n"\n[ "$2" != "$FAIL_PACKAGE" ]\n', {mode: 0o700});
    const execute = (group = row(members), extra = {}) => spawnSync(process.execPath, ['scripts/ci-run-package-group.mjs'], {
      encoding: 'utf8', env: {...process.env, PATH: `${root}:${process.env.PATH}`, PACKAGE_CALLS: log, CI_PACKAGE_GROUP: JSON.stringify(group), ...extra},
    });
    run({execute, pnpm: join(root, 'pnpm'), calls: () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []});
  } finally {rmSync(root, {recursive: true, force: true});}
}

test('group runner executes each unchanged package test command once and retains all output', () => {
  fixture(({execute, calls}) => {
    const result = execute();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(calls(), members.map(name => `--filter ${name} test`));
    for (const name of members) assert.ok(result.stdout.includes(`package-output:${name}`));
  });
});

test('a failed package fails the group while later selected packages still run', () => {
  fixture(({execute, calls}) => {
    const result = execute(row(members), {FAIL_PACKAGE: members[0]});
    assert.equal(result.status, 1);
    assert.deepEqual(calls(), members.map(name => `--filter ${name} test`));
    assert.match(result.stderr, /identity failed/);
    assert.ok(result.stdout.includes(`package-output:${members[2]}`));
  });
});

const invalid = [null, {}, {package: members[0], shard: 1}, {package: members.join(' + '), shard: 1}, row([]), row([members[0]]), row([...members, members[0]]), row([members[1], members[0]]),
  row([members[0], '@waitron-cloud/portal']), {...row(members), package: 'forged'}, {...row(members), shard: 2},
  {...row(members), shards: 3}, {...row(members), command: 'proof:local-stack'}];
test('group runner rejects empty, duplicate, unknown, reordered, partial and forged rows before executing', () => {
  for (const group of invalid) fixture(({execute, calls}) => {
    const result = execute(group);
    assert.equal(result.status, 1);
    assert.deepEqual(calls(), []);
    assert.match(result.stderr, /package group/i);
  });
});

test('missing and signalled package executables fail the job', () => {
  fixture(({execute, pnpm, calls}) => {
    writeFileSync(pnpm, '#!/bin/sh\nkill -TERM $$\n', {mode: 0o700});
    const signal = execute();
    assert.equal(signal.status, 1); assert.match(signal.stderr, /failed: SIGTERM/);
    rmSync(pnpm);
    const missing = execute(row(members), {PATH: pnpm});
    assert.equal(missing.status, 1); assert.match(missing.stderr, /failed:.*ENOENT/);
    assert.deepEqual(calls(), []);
  });
});

test('summary validates grouped members and requires the successful exact group job', () => {
  const group = row(members);
  const plan = {packages: [group], receipts: [], typecheck: true};
  const results = {changes: 'success', typecheck: 'success', root: 'success', packages: 'success', receipts: 'skipped'};
  const jobs = ['changes', 'typecheck', 'root (1/4)', 'root (2/4)', 'root (3/4)', 'root (4/4)', `package (${group.package})`].map(name => ({name, status: 'completed', conclusion: 'success'}));
  assert.doesNotThrow(() => assertSummary(plan, results, jobs));
  for (const forged of invalid.filter(value => value !== null && value.package !== members[0])) {
    const altered = jobs.map(item => item.name.startsWith('package (') ? {...item, name: `package (${forged.package})`} : item);
    assert.throws(() => assertSummary({...plan, packages: [forged]}, results, altered));
  }
  assert.throws(() => assertSummary({...plan, packages: [group, {package: members[0], shard: 1}]}, results,
    [...jobs, {name: `package (${members[0]})`, status: 'completed', conclusion: 'success'}]), /Duplicate package/);
  assert.throws(() => assertSummary({...plan, packages: [group, {package: members[0], shard: 2, shards: 2}]}, results,
    [...jobs, {name: `package (${members[0]}, shard 2/2)`, status: 'completed', conclusion: 'success'}]), /Duplicate package/);
  for (const conclusion of ['failure', 'cancelled', 'skipped', null]) assert.throws(() => assertSummary(plan, results, [...jobs.slice(0, -1), {...jobs.at(-1), conclusion}]));
  assert.throws(() => assertSummary(plan, results, jobs.slice(0, -1)));
});

test('summary rejects a package scheduled both whole and in a shard', () => {
  const plan = {packages: [{package: '@waitron-cloud/portal', shard: 1}, {package: '@waitron-cloud/portal', shard: 1, shards: 6}], receipts: [], typecheck: true};
  const results = {changes: 'success', typecheck: 'success', root: 'success', packages: 'success', receipts: 'skipped'};
  const jobs = ['changes', 'typecheck', 'root (1/4)', 'root (2/4)', 'root (3/4)', 'root (4/4)', 'package (@waitron-cloud/portal)', 'package (@waitron-cloud/portal, shard 1/6)'].map(name => ({name, status: 'completed', conclusion: 'success'}));
  assert.throws(() => assertSummary(plan, results, jobs), /Duplicate package execution/);
});
