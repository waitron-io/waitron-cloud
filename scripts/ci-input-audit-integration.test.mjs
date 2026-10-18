import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync, spawnSync} from 'node:child_process';
import {appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {parseLock} from './ci-lock.mjs';

const policyPath = 'scripts/ci-input-audit.json';
const manifestPaths = ['apps/portal/package.json', ...['account-http', 'backups', 'fiscal-allocation', 'identity',
  'operations', 'registration', 'remote-access', 'translation', 'ui-smoke'].map(name => `packages/${name}/package.json`)];
const receipts = ['test:two-venue-milestone-receipt', 'test:backup-capacity', 'test:public-gateway-limits', 'test:local-stack', 'test:database-recovery-receipt'];
const hash = value => createHash('sha256').update(value).digest('hex');

function completeFixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-all-audits-'));
  const git = (...args) => execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {cwd: root, encoding: 'utf8', stdio: 'pipe'});
  const read = path => readFileSync(join(root, path), 'utf8');
  const write = (path, value) => writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
  const node = (path, args = [], env = {}) => spawnSync(process.execPath, [path, ...args],
    {cwd: root, env: {...process.env, ...env}, encoding: 'utf8', timeout: 60_000});
  const commit = () => {git('add', '-A'); git('commit', '--allow-empty', '-s', '-qm', 'Save complete audit control'); return git('rev-parse', 'HEAD').trim();};
  const renew = () => {
    git('add', '-A');
    const result = node('scripts/ci-input-audit.mjs', ['--write-staged']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const content = read(policyPath);
    git('add', '--', policyPath);
    assert.equal(node('scripts/ci-input-audit.mjs', ['--write-staged']).status, 0);
    assert.equal(read(policyPath), content);
    assert.equal(git('diff', '--', policyPath), '');
    const head = commit();
    const check = node('scripts/ci-input-audit.mjs', ['--check', head]);
    assert.equal(check.status, 0, check.stdout + check.stderr);
    return head;
  };
  try {
    execFileSync('git', ['clone', '--shared', '--quiet', process.cwd(), root], {stdio: 'pipe'});
    cpSync('scripts', join(root, 'scripts'), {recursive: true});
    git('config', 'user.name', 'CI test'); git('config', 'user.email', 'ci@example.test');
    run({root, git, read, write, node, commit, renew});
  } finally {rmSync(root, {recursive: true, force: true});}
}

test('complete candidate audits independently pin all ten current manifests and preserve historical evidence', () => completeFixture(({git, read, write, node, commit, renew}) => {
  const historical = read('scripts/fixtures/ci-historical-manifests.json');
  const saved = ['dependency', 'execution', 'schema', 'deployment'].map(name => [`scripts/fixtures/ci-${name}-inputs.json`, read(`scripts/fixtures/ci-${name}-inputs.json`)]);
  const base = renew();
  let alreadyCurrent;
  assert.doesNotThrow(() => {alreadyCurrent = renew();}, 'An already current clean audit must still qualify a real committed control');
  assert.notEqual(alreadyCurrent, base);
  assert.equal(git('rev-parse', `${base}^{tree}`), git('rev-parse', `${alreadyCurrent}^{tree}`));
  const policy = JSON.parse(read(policyPath));
  assert.deepEqual(Object.keys(policy.manifests).sort(), [...manifestPaths].sort());
  const expected = {};
  for (const path of manifestPaths) {
    const manifest = JSON.parse(git('show', `${base}:${path}`));
    assert.equal(manifest.license, 'SEE LICENSE IN LICENSE');
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) delete manifest[field];
    expected[path] = hash(JSON.stringify(Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b, 'en')))));
  }
  assert.deepEqual(policy.manifests, expected);
  const old = JSON.parse(historical).manifests;
  const missing = {...policy.manifests}; delete missing['packages/translation/package.json'];
  for (const manifests of [missing, {...policy.manifests, 'packages/absent/package.json': 'a'.repeat(64)}, old,
    {...policy.manifests, 'packages/identity/package.json': old['packages/identity/package.json']}]) {
    git('reset', '--hard', base);
    write(policyPath, {...policy, manifests});
    const invalid = commit();
    const checked = node('scripts/ci-input-audit.mjs', ['--check', invalid]);
    assert.notEqual(checked.status, 0);
    assert.match(checked.stdout, /docs: current\nidentity: current\ngateway: current/);
    assert.match(checked.stderr, /Manifest readers changed since audit/);
  }
  for (const change of [{license: 'Changed licence'}, {scripts: {test: 'node --test different.test.mjs'}}, {description: 'Changed nondependency metadata'}]) {
    git('reset', '--hard', base);
    const path = 'packages/translation/package.json';
    write(path, {...JSON.parse(read(path)), ...change});
    assert.notEqual(node('scripts/ci-input-audit.mjs', ['--check', commit()]).status, 0);
    const changed = renew();
    assert.notEqual(JSON.parse(read(policyPath)).manifests[path], policy.manifests[path]);
    assert.equal(node('scripts/ci-input-audit.mjs', ['--check', changed]).status, 0);
  }
  assert.equal(read('scripts/fixtures/ci-historical-manifests.json'), historical);
  for (const [path, content] of saved) assert.equal(read(path), content);
}));

test('one audited committed baseline admits isolated docs scripts and locks while mixed and new readers stay full', () => completeFixture(({root, git, read, write, node, commit, renew}) => {
  rmSync(join(root, 'docs/ci-lockfile-audit.md'), {force: true});
  write('docs/audit-control-prose.md', 'Independent fixture prose.\n');
  write('docs/audit-control-deleted-prose.md', 'Independent deletion fixture.\n');
  const base = renew();
  const plan = head => {
    const scratch = mkdtempSync(join(tmpdir(), 'cloud-audit-plan-'));
    try {
      const event = join(scratch, 'event.json'), output = join(scratch, 'output');
      writeFileSync(event, JSON.stringify({pull_request: {base: {sha: base}, head: {sha: head}}}));
      writeFileSync(output, '');
      const result = node('scripts/ci-plan.mjs', [], {GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output,
        GITHUB_SHA: head, GITHUB_REPOSITORY: 'waitron-io/waitron-cloud', GITHUB_REF_NAME: 'feature'});
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const outputs = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
      return {selected: JSON.parse(outputs.plan), stdout: result.stdout};
    } finally {rmSync(scratch, {recursive: true, force: true});}
  };
  for (const change of [
    () => appendFileSync(join(root, 'docs/audit-control-prose.md'), '\nProse control.\n'),
    () => rmSync(join(root, 'docs/audit-control-deleted-prose.md')),
    () => appendFileSync(join(root, 'scripts/identity-upstream.mjs'), '\n// Isolated control\n'),
    () => appendFileSync(join(root, 'scripts/identity-upstream.test.mjs'), '\n// Isolated control\n'),
    () => appendFileSync(join(root, 'scripts/verify-gateway-reconnection-receipt.mjs'), '\n// Isolated control\n'),
    () => appendFileSync(join(root, 'scripts/verify-gateway-reconnection-receipt.test.mjs'), '\n// Isolated control\n'),
  ]) {
    git('reset', '--hard', base); change();
    const head = commit();
    const {selected, stdout} = plan(head);
    assert.deepEqual(selected.packages, []); assert.deepEqual(selected.receipts, []); assert.equal(selected.typecheck, false);
    const paths = git('diff', '--name-only', base, head).trim().split('\n');
    const docs = paths[0].startsWith('docs/');
    assert.deepEqual((docs ? selected.documentation : selected.scripts), {base, head, paths});
    if (docs) assert.doesNotMatch(stdout, /::warning/);
    const checked = node(docs ? 'scripts/ci-docs.mjs' : 'scripts/ci-scripts.mjs', [], {CI_PLAN: JSON.stringify(selected)});
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
    const forged = structuredClone(selected);
    (docs ? forged.documentation : forged.scripts).paths = [];
    assert.notEqual(node(docs ? 'scripts/ci-docs.mjs' : 'scripts/ci-scripts.mjs', [], {CI_PLAN: JSON.stringify(forged)}).status, 0);
  }
  for (const withManifest of [false, true]) {
    git('reset', '--hard', base);
    const {path: lockPath, closures, ...lock} = structuredClone(parseLock(read('pnpm-lock.yaml')));
    lock.importers['packages/ui-smoke'].devDependencies = {...lock.importers['packages/ui-smoke'].devDependencies,
      'audit-control': {specifier: '^1.0.0', version: '1.0.0'}};
    lock.packages['audit-control@1.0.0'] = {resolution: {integrity: 'sha512-YQ=='}};
    lock.snapshots['audit-control@1.0.0'] = {};
    write('pnpm-lock.yaml', Object.entries(lock).map(([key, value]) => `${key}: ${JSON.stringify(value)}\n`).join(''));
    if (withManifest) {
      const path = 'packages/ui-smoke/package.json';
      const manifest = JSON.parse(read(path));
      write(path, {...manifest, devDependencies: {...manifest.devDependencies, 'audit-control': '^1.0.0'}});
    }
    const {selected} = plan(commit());
    assert.match(selected.reason, /audited package selection/);
    assert.deepEqual(selected.packages, [{package: '@waitron-cloud/ui-smoke', shard: 1}]);
    assert.equal(selected.typecheck, true); assert.deepEqual(selected.receipts, receipts);
  }
  for (const paths of [
    ['docs/audit-control-prose.md', 'scripts/identity-upstream.mjs'],
    ['scripts/identity-upstream.mjs', 'scripts/verify-gateway-reconnection-receipt.mjs'],
    ['docs/audit-control-prose.md', 'pnpm-lock.yaml'], ['unmapped-input'], ['scripts/new-reader.mjs'],
    ['scripts/ci-input-audit.mjs'], ['scripts/ci-plan.mjs'], [policyPath],
  ]) {
    git('reset', '--hard', base);
    for (const path of paths) appendFileSync(join(root, path), path === policyPath ? ' ' : '\n// Mixed input\n');
    const {selected} = plan(commit());
    assert.equal(selected.packages.length, 17, paths.join(','));
    assert.equal(selected.typecheck, true); assert.deepEqual(selected.receipts, receipts);
    assert.equal(selected.documentation, undefined); assert.equal(selected.scripts, undefined);
  }
}));
