import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, unlinkSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import test from 'node:test';
import {createPlan} from './ci-plan.mjs';
import {loadWorkspace} from './ci-scope.mjs';
import {assertSummary} from './ci-summary.mjs';

const workspace = loadWorkspace();
const checker = resolve('scripts/ci-docs.mjs');
const policy = 'scripts/ci-input-audit.json';
const completeAudit = values => ({
  version: 1,
  docsInputSha256: '1'.repeat(64), identityInputSha256: '2'.repeat(64),
  gatewayInputSha256: '3'.repeat(64), lockInputSha256: '4'.repeat(64),
  manifests: {}, ...values,
});
function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-docs-ci-'));
  const git = (...args) => execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  const put = (path, text) => { mkdirSync(join(root, path, '..'), {recursive: true}); writeFileSync(join(root, path), text); };
  const commit = () => { git('add', '-A'); git('commit', '-sm', 'Fixture'); return git('rev-parse', 'HEAD').trim(); };
  try {
    git('init', '-b', 'main'); git('config', 'user.name', 'CI test'); git('config', 'user.email', 'ci@example.test');
    put('scripts/reader.mjs', 'console.log("no document inputs");\n');
    put('docs/backlog.md', '# Backlog\n');
    put('README.md', '# Cloud\n');
    const initial = commit();
    // The fixture record has one input. Its digest does not use planner helpers.
    const entry = git('ls-tree', '-rz', '--full-tree', initial).split('\0').find(row => row.endsWith('\tscripts/reader.mjs'));
    const docsInputSha256 = createHash('sha256').update(`${entry}\0`).digest('hex');
    put(policy, JSON.stringify(completeAudit({docsInputSha256})) + '\n');
    const base = commit();
    const plan = (head, old = base) => createPlan({pull_request: {base: {sha: old}, head: {sha: head}}}, {sha: head}, workspace, git, () => {throw Error('no API');});
    run({root, git, put, commit, base, plan});
  } finally { rmSync(root, {recursive: true, force: true}); }
}

test('ordinary unread Markdown selects only the document check, including spaces and deletion', () => fixture(({root, put, commit, plan}) => {
  put('docs/a plan.md', '# Plan\n');
  unlinkSync(join(root, 'README.md'));
  const selected = plan(commit());
  assert.deepEqual(selected.packages, []);
  assert.deepEqual(selected.receipts, []);
  assert.equal(selected.typecheck, false);
  assert.deepEqual(selected.documentation.paths, ['README.md', 'docs/a plan.md']);
  assert.match(selected.reason, /Regular prose/);
}));

test('the generated cost explanation cannot bypass artifact verification through a docs-only audit', () => fixture(({put, commit, plan}) => {
  put('docs/cloud-cost-model.md', '# Edited generated output\n');
  const selected = plan(commit());
  assert.equal(selected.documentation, undefined);
  assert.ok(selected.receipts.includes('test:cloud-cost'));
  assert.equal(selected.typecheck, true);
}));

test('a changed reader keeps mixed work full while later prose uses ordinary review', () => fixture(({put, commit, plan, base}) => {
  put('scripts/new-reader.mjs', 'readFileSync("docs/backlog.md");\n');
  const reader = commit();
  put('docs/backlog.md', '# Updated\n');
  const head = commit();
  assert.equal(plan(head, reader).packages.length, 0);
  assert.equal(plan(head, base).packages.length, 29);
}));

test('earlier code and retired record states do not invalidate later prose', () => {
  for (const change of ['changed', 'removed', 'missing', 'malformed', 'stale']) fixture(({root, put, commit, plan}) => {
    if (change === 'changed') put('scripts/reader.mjs', 'readFileSync("docs/backlog.md");\n');
    if (change === 'removed') unlinkSync(join(root, 'scripts/reader.mjs'));
    if (change === 'missing') unlinkSync(join(root, policy));
    if (change === 'malformed') put(policy, '{');
    if (change === 'stale') put(policy, JSON.stringify(completeAudit({docsInputSha256: '0'.repeat(64)})) + '\n');
    const changed = commit();
    put('docs/backlog.md', '# Updated\n');
    assert.equal(plan(commit(), changed).packages.length, 0, change);
  });
});

test('package Markdown, document data and unknown paths preserve their existing checks', () => {
  for (const path of ['packages/identity/SOURCE.md', 'docs/receipts/receipt.json', 'docs/receipts/receipt.md', 'docs/unknown.bin', '.github/action.yml']) {
    fixture(({put, commit, plan}) => {
      put(path, '{}\n');
      const selected = plan(commit());
      assert.equal(selected.packages.length, 29, path);
    });
  }
});

test('mixed documents and portal code retain the full fallback', () => fixture(({put, commit, plan}) => {
  put('docs/backlog.md', '# Updated\n');
  put('apps/portal/src/change.ts', 'export const changed = true;\n');
  const selected = plan(commit());
  assert.equal(selected.packages.length, 29);
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
  assert.equal(linked.packages.length, 29, 'linked Markdown cannot earn the exemption');
}));

test('document command accepts deletions and prose after a reader change', () => fixture(({root, put, commit, plan}) => {
  const run = value => spawnSync(process.execPath, [checker], {cwd: root, env: {...process.env, CI_PLAN: JSON.stringify(value)}, encoding: 'utf8'});
  unlinkSync(join(root, 'README.md'));
  assert.equal(run(plan(commit())).status, 0);
  put('scripts/reader.mjs', 'readFileSync("docs/backlog.md");\n');
  const base = commit();
  put('docs/backlog.md', '# Updated\n');
  const head = commit();
  const forged = run({documentation: {base, head, paths: ['docs/backlog.md']}});
  assert.equal(forged.status, 0, forged.stderr);
}));

test('real planner command emits document output and reports unknown-input fallbacks without fatal stderr', () => fixture(({root, git, put, commit}) => {
  put('package.json', JSON.stringify({name: 'fixture', private: true}));
  put('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");
  for (const name of ['one', 'two']) put(`packages/${name}/package.json`, JSON.stringify({name, scripts: {test: 'node --test'}}));
  const inputs = ['package.json', 'pnpm-workspace.yaml', 'packages/one/package.json', 'packages/two/package.json', 'scripts/reader.mjs'];
  const tree = commit();
  const rows = git('ls-tree', '-rz', '--full-tree', tree).split('\0').filter(row => inputs.includes(row.split('\t')[1]));
  put(policy, JSON.stringify(completeAudit({docsInputSha256: createHash('sha256').update(rows.map(row => row + '\0').join('')).digest('hex')})) + '\n');
  let base = commit();
  const run = (head, old = base) => {
    put('event.json', JSON.stringify({pull_request: {base: {sha: old}, head: {sha: head}}}));
    const output = join(tmpdir(), `cloud-doc-output-${head}`);
    try {
      writeFileSync(output, '');
      const result = spawnSync(process.execPath, [resolve('scripts/ci-plan.mjs')], {cwd: root, env: {...process.env, GITHUB_EVENT_NAME: 'pull_request', CI_FULL: 'false', CI_CALLED: 'false',
      CI_FORCE_FULL: 'false', CI_WORKFLOW_INPUTS: '{}', CI_RECORD_EVIDENCE: 'false', GITHUB_EVENT_PATH: join(root, 'event.json'), GITHUB_OUTPUT: output, GITHUB_SHA: head}, encoding: 'utf8'});
      return {...result, output: readFileSync(output, 'utf8')};
    } finally { rmSync(output, {force: true}); rmSync(join(root, 'event.json'), {force: true}); }
  };
  put('docs/backlog.md', '# Updated\n');
  let result = run(commit());
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout, /::warning/);
  assert.match(result.output, /\ndocumentation=true\n/);
  assert.match(result.output, /\npackages=false\n/);
  unlinkSync(join(root, policy)); base = commit();
  put('docs/backlog.md', '# Another change\n');
  result = run(commit());
  assert.equal(result.status, 0);
  assert.match(result.output, /\npackages=false\n/);
  assert.match(result.output, /\ndocumentation=true\n/);
  assert.equal(result.stderr, '');
}));

test('strict summary requires the selected document job and refuses malformed empty work', () => {
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
  for (const invalid of [{...documentation, paths: []}, {...documentation, paths: ['scripts/a.mjs']}, {...documentation, head: 'bad'},
    {...documentation, paths: ['docs/backlog.md', 'docs/backlog.md']},
    ...['docs/../backlog.md', 'docs/./backlog.md', 'docs/a\\b.md'].map(path => ({...documentation, paths: [path]}))]) {
    assert.throws(() => assertSummary({...plan, documentation: invalid}, results, jobs));
  }
  assert.throws(() => assertSummary({...plan, reuse: {sha: 'c'.repeat(40), runId: 42}}, results, jobs));
  assert.throws(() => assertSummary({...plan, typecheck: true}, {...results, typecheck: 'success'}, [...jobs, {name: 'typecheck', status: 'completed', conclusion: 'success'}]));
  assert.throws(() => assertSummary({...plan, packages: [{package: 'one', shard: 1}]}, {...results, packages: 'success'}, [...jobs, {name: 'package (one)', status: 'completed', conclusion: 'success'}]));
});

test('planner command selects actual inputs without demanding record renewal', () => {
  for (const path of ['docs/backlog.md', 'packages/one/change.txt', 'scripts/new-reader.mjs']) fixture(({root, git, put, commit}) => {
    put('package.json', JSON.stringify({name: 'fixture', private: true}));
    put('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");
    for (const name of ['one', 'two']) put(`packages/${name}/package.json`, JSON.stringify({name, scripts: {test: 'node --test'}}));
    const base = commit();
    put(path, 'Changed input\n');
    const head = commit();
    put('event.json', JSON.stringify({pull_request: {base: {sha: base}, head: {sha: head}}}));
    const output = join(root, 'output.txt');
    writeFileSync(output, '');
    const result = spawnSync(process.execPath, [resolve('scripts/ci-plan.mjs')], {cwd: root,
      env: {...process.env, GITHUB_EVENT_NAME: 'pull_request', CI_FULL: 'false', CI_CALLED: 'false',
      CI_FORCE_FULL: 'false', CI_WORKFLOW_INPUTS: '{}', CI_RECORD_EVIDENCE: 'false', GITHUB_EVENT_PATH: join(root, 'event.json'), GITHUB_OUTPUT: output, GITHUB_SHA: head}, encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /::warning.*Documentation-only CI unavailable/);
    const selected = JSON.parse(readFileSync(output, 'utf8').split('\n').find(line => line.startsWith('plan=')).slice(5));
    if (path.startsWith('docs/')) {
      assert.deepEqual(selected.packages, []); assert.equal(selected.typecheck, false);
      assert.deepEqual(selected.documentation.paths, [path]);
    } else {
      assert.ok(selected.packages.length > 0); assert.equal(selected.typecheck, true);
      assert.equal(selected.documentation, undefined);
    }
  });
});


test('the retired audit command refuses instead of claiming renewal is needed', () => fixture(({root, base}) => {
  for (const revision of [base, 'main']) {
    const result = spawnSync(process.execPath, [checker, '--audit', revision], {cwd: root, encoding: 'utf8'});
    assert.equal(result.status, 1); assert.match(result.stderr, /Usage: ci-docs.mjs/);
  }
}));

test('proof planner skips only ordinary prose and keeps code, pinned documents, main and unavailable evidence', () => fixture(({root, git, put, commit, base}) => {
  const run = (event, expected) => {
    const scratch = mkdtempSync(join(tmpdir(), 'cloud-proof-plan-'));
    try {
      const eventPath = join(scratch, 'event.json'), output = join(scratch, 'output');
      writeFileSync(eventPath, JSON.stringify(event)); writeFileSync(output, '');
      const result = spawnSync(process.execPath, [checker, '--plan'], {cwd: root, encoding: 'utf8',
        env: {...process.env, CI_PROOF_KIND: '', CI_FORCE_FULL: 'false', GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: output}});
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(output, 'utf8'), `required=${expected}\n`);
    } finally {rmSync(scratch, {recursive: true, force: true});}
  };
  const pr = (head, old = base) => ({pull_request: {base: {sha: old}, head: {sha: head}}});
  put('docs/backlog.md', '# Changed\n');
  const docs = commit();
  run(pr(docs), false);
  run({}, true);
  run(pr(docs, 'a'.repeat(40)), true);
  run(pr('main'), true);
  run(pr(docs, 'HEAD~1'), true);
  git('checkout', '--detach', base);
  put('scripts/reader.mjs', 'console.log("main advanced");\n');
  const advanced = commit();
  run(pr(docs, advanced), false);
  git('checkout', '--detach', docs);
  git('mv', 'README.md', 'docs/renamed.md');
  run(pr(commit()), false);
  git('reset', '--hard', base);
  const pinned = 'docs/waitron-integration-contract.md';
  put(pinned, '# Published contract input\n');
  const tree = commit();
  const inputs = git('ls-tree', '-rz', '--full-tree', tree).split('\0')
    .filter(row => ['scripts/reader.mjs', pinned].includes(row.split('\t')[1]));
  put(policy, JSON.stringify(completeAudit({docsInputSha256: createHash('sha256')
    .update(inputs.map(row => row + '\0').join('')).digest('hex')})) + '\n');
  const pinnedBase = commit();
  assert.equal(spawnSync(process.execPath, [checker, '--audit', pinnedBase], {cwd: root, stdio: 'pipe'}).status, 1);
  git('mv', pinned, 'docs/moved-contract.md');
  run(pr(commit(), pinnedBase), true);

  for (const path of ['scripts/reader.mjs', 'docs/waitron-integration-contract.md', 'docs/cloud-cost-model.md', 'docs/receipts/proof.md', 'packages/one/README.md']) {
    git('reset', '--hard', base);
    put(path, 'changed\n');
    run(pr(commit()), true);
  }
  git('reset', '--hard', base);
  put('scripts/reader.mjs', 'changed\n'); const stale = commit();
  put('docs/backlog.md', '# Later prose\n');
  run(pr(commit(), stale), false);
}));

// A reusable full run must ignore a narrow PR event inherited from its caller.
test('explicit full execution overrides a real ordinary prose PR without changing ordinary selection', () => fixture(({put, commit, base, git, plan}) => {
  put('docs/backlog.md', '# Nightly prose control\n');
  const head = commit();
  assert.equal(plan(head).documentation.paths[0], 'docs/backlog.md');
  const full = createPlan({pull_request: {base: {sha: base}, head: {sha: head}}}, {sha: head, full: true}, workspace, git);
  assert.match(full.reason, /Explicit full run/);
  assert.equal(full.typecheck, true);
  assert.equal(full.packages.length, 29);
  assert.equal(full.documentation, undefined);
  assert.equal(full.reuse, null);
  assert.deepEqual(full.receipts, ['test:two-venue-milestone-receipt', 'test:backup-capacity', 'test:public-gateway-limits', 'test:local-stack', 'test:database-recovery-receipt', 'test:cloud-cost']);
}));

test('full proof command overrides a real ordinary prose PR while ordinary proof stays unselected', () => fixture(({root, put, commit, base}) => {
  put('docs/backlog.md', '# Full proof control\n');
  const head = commit();
  const event = join(root, 'event.json'), output = join(root, 'output');
  writeFileSync(event, JSON.stringify({pull_request: {base: {sha: base}, head: {sha: head}}}));
  for (const [flag, required] of [['false', 'false'], ['true', 'true']]) {
    writeFileSync(output, '');
    const result = spawnSync(process.execPath, [checker, '--plan'], {cwd: root, encoding: 'utf8', env: {...process.env, CI_PROOF_KIND: '', CI_FORCE_FULL: flag, GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output}});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(readFileSync(output, 'utf8'), `required=${required}\n`);
  }
}));
