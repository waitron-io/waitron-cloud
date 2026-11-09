import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {parseLock} from './ci-lock.mjs';

const unknownPath = 'scripts/unknown.json';
const receipts = ['test:two-venue-milestone-receipt', 'test:backup-capacity', 'test:public-gateway-limits', 'test:local-stack', 'test:database-recovery-receipt', 'test:cloud-cost'];

function completeFixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-all-audits-'));
  const git = (...args) => execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {cwd: root, encoding: 'utf8', stdio: 'pipe'});
  const read = path => readFileSync(join(root, path), 'utf8');
  const write = (path, value) => writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
  const node = (path, args = [], env = {}) => spawnSync(process.execPath, [path, ...args],
    {cwd: root, env: {...process.env, GITHUB_EVENT_NAME: 'pull_request',
      CI_FULL: 'false', CI_CALLED: 'false', CI_FORCE_FULL: 'false', CI_WORKFLOW_INPUTS: '{}', CI_RECORD_EVIDENCE: 'false', ...env}, encoding: 'utf8', timeout: 60_000});
  const commit = () => {git('add', '-A'); git('commit', '--allow-empty', '-s', '-qm', 'Save complete audit control'); return git('rev-parse', 'HEAD').trim();};
  try {
    execFileSync('git', ['clone', '--shared', '--quiet', process.cwd(), root], {stdio: 'pipe'});
    cpSync('scripts', join(root, 'scripts'), {recursive: true});
    git('config', 'user.name', 'CI test'); git('config', 'user.email', 'ci@example.test');
    run({root, git, read, write, node, commit});
  } finally {rmSync(root, {recursive: true, force: true});}
}

test('one committed baseline admits isolated docs and scripts while unresolved lock readers stay full', () => completeFixture(({root, git, read, write, node, commit}) => {
  rmSync(join(root, 'docs/ci-lockfile-audit.md'), {force: true});
  write('docs/audit-control-prose.md', 'Independent fixture prose.\n');
  write('docs/audit-control-deleted-prose.md', 'Independent deletion fixture.\n');
  const base = commit();
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
    // The refusal control needs an unknown source reader independently of live declarations.
    write('packages/identity/src/audit-control-unknown-reader.mjs',
      "import {readdirSync} from 'node:fs';\nexport const discover = directory => readdirSync(directory);\n");
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
    assert.match(selected.reason, /full suite retained until root readers are covered/);
    assert.deepEqual([...new Set(selected.packages.flatMap(row => row.members ?? [row.package]))].sort(),
      ['@waitron-cloud/account-http', '@waitron-cloud/backups',  '@waitron-cloud/identity',
        '@waitron-cloud/operations', '@waitron-cloud/portal', '@waitron-cloud/registration', '@waitron-cloud/remote-access', '@waitron-cloud/translation', '@waitron-cloud/ui-smoke']);
    assert.equal(selected.typecheck, true); assert.deepEqual(selected.receipts, receipts);
  }
  for (const paths of [
    ['docs/audit-control-prose.md', 'scripts/identity-upstream.mjs'],
    ['scripts/identity-upstream.mjs', 'scripts/verify-gateway-reconnection-receipt.mjs'],
    ['docs/audit-control-prose.md', 'pnpm-lock.yaml'], ['unmapped-input'], ['scripts/new-reader.mjs'],
    ['scripts/ci-input-audit.mjs'], ['scripts/ci-plan.mjs'], [unknownPath],
  ]) {
    git('reset', '--hard', base);
    for (const path of paths) appendFileSync(join(root, path), path === unknownPath ? ' ' : '\n// Mixed input\n');
    const {selected} = plan(commit());
    assert.equal(selected.packages.length, 29, paths.join(','));
    assert.equal(selected.typecheck, true); assert.deepEqual(selected.receipts, receipts);
    assert.equal(selected.documentation, undefined); assert.equal(selected.scripts, undefined);
  }
}));

test('a changed published translation vector retains its real package check', () => completeFixture(({root, git, read, write, node, commit}) => {
  const contractPath = 'docs/waitron-integration-contract.md';
  const original = read(contractPath);
  const start = original.indexOf('```json\n', original.indexOf('### Shared test vectors')) + 8;
  const end = original.indexOf('\n```', start);
  const vectors = JSON.parse(original.slice(start, end));
  const env = {...process.env};
  delete env.NODE_TEST_CONTEXT;
  const installed = spawnSync(process.execPath, ['scripts/ci-audit-fixture-dependencies.mjs', process.cwd(), root], {cwd: root, env, encoding: 'utf8', timeout: 60_000});
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  const checkVector = () => spawnSync(process.execPath, ['--test', '--test-reporter=tap',
    '--test-name-pattern=the contract publishes exactly the committed vectors', 'packages/translation/test/submit-proof.test.ts'],
  {cwd: root, env, encoding: 'utf8', timeout: 30_000});
  const originalCheck = checkVector();
  assert.equal(originalCheck.status, 0, originalCheck.stdout + originalCheck.stderr);
  assert.match(originalCheck.stdout, /# pass 1\b/);
  const base = commit();
  vectors.issuerKeyId = 'controlled-mismatch';
  write(contractPath, original.slice(0, start) + JSON.stringify(vectors, null, 2) + original.slice(end));
  const head = commit();
  const scratch = mkdtempSync(join(tmpdir(), 'cloud-contract-plan-'));
  try {
    const event = join(scratch, 'event.json'), output = join(scratch, 'output');
    writeFileSync(event, JSON.stringify({pull_request: {base: {sha: base}, head: {sha: head}}}));
    writeFileSync(output, '');
    const result = node('scripts/ci-plan.mjs', [], {GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output,
      GITHUB_SHA: head, GITHUB_REPOSITORY: 'waitron-io/waitron-cloud', GITHUB_REF_NAME: 'feature'});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const planLine = readFileSync(output, 'utf8').split('\n').find(line => line.startsWith('plan='));
    assert.ok(planLine, 'the real planner must emit its plan');
    const selected = JSON.parse(planLine.slice(5));
    assert.equal(selected.documentation, undefined, 'the consumed contract cannot qualify as unread prose');
    assert.equal(selected.typecheck, true);
    assert.equal(selected.packages.length, 1);
    assert.ok(selected.packages.some(row => row.package === '@waitron-cloud/translation'), 'run the translation package');
    assert.deepEqual(selected.receipts, receipts);
    const manifest = JSON.parse(read('packages/translation/package.json'));
    assert.match(manifest.scripts.test, /node --test .*test\/\*\.test\.ts/);
    const changedCheck = checkVector();
    assert.equal(changedCheck.status, 1, changedCheck.stdout + changedCheck.stderr);
    assert.match(changedCheck.stdout, /controlled-mismatch/);
    assert.match(changedCheck.stdout, /# fail 1\b/);
    write(contractPath, original);
    const restoredCheck = checkVector();
    assert.equal(restoredCheck.status, 0, restoredCheck.stdout + restoredCheck.stderr);
    assert.match(restoredCheck.stdout, /# pass 1\b/);
  } finally {rmSync(scratch, {recursive: true, force: true});}
}));
