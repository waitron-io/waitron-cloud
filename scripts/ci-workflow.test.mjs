import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {loadWorkspace, scopeForPaths, workPlan, receiptSuites} from './ci-scope.mjs';

// This guard reads workflow text; real Actions must separately prove its wiring.
const workflow=readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');
const job=name=>workflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [\\w-]+:|$(?![\\s\\S]))`,'m'))?.[1]??'';
test('root fixtures can clone the reviewed main reference from an exact detached checkout', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cloud-ci-main-reference-'));
  const run = (cwd, command, args) => spawnSync(command, args, {cwd, encoding: 'utf8'});
  const git = (...args) => {
    const result = run(directory, 'git', args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Cloud fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    writeFileSync(join(directory, 'README.md'), 'fixture\n');
    git('add', 'README.md');
    git('commit', '-s', '-m', 'Create fixture');
    const head = git('rev-parse', 'HEAD');
    const tree = git('rev-parse', 'HEAD^{tree}');
    git('update-ref', 'refs/remotes/origin/main', head);
    git('checkout', '--detach', head);
    git('branch', '-D', 'main');
    const command = job('root').match(/- name: Expose main to nested test fixtures\n\s+run: (.+)/)?.[1] ?? ':';
    const setup = run(directory, 'sh', ['-c', command]);
    assert.equal(setup.status, 0, setup.stderr);
    git('clone', '--shared', directory, join(directory, 'child'));
    const reference = run(join(directory, 'child'), 'git', ['rev-parse', '--verify', 'origin/main']);
    assert.equal(reference.status, 0, 'Nested fixtures need the main reference that authenticates removed inputs');
    assert.equal(reference.stdout.trim(), head);
    assert.equal(git('rev-parse', 'HEAD'), head);
    assert.equal(git('rev-parse', 'HEAD^{tree}'), tree);
    assert.notEqual(run(directory, 'git', ['symbolic-ref', '-q', 'HEAD']).status, 0, 'The tested checkout stays detached');
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});
test('main merges keep independent runs while superseded pull request runs cancel',()=>{
  assert.match(workflow,/group: ci-\$\{\{ inputs.full && 'nightly-' \|\| '' \}\}\$\{\{ github.event_name == 'pull_request' && github.ref \|\| github.run_id \}\}/);
  assert.match(workflow,/cancel-in-progress: \$\{\{ !inputs.full && github.event_name == 'pull_request' \}\}/);
});
test('every discovered workspace test package runs through the planned database matrix',()=>{
  const members=loadWorkspace();
  const full=workPlan(scopeForPaths(['pnpm-lock.yaml'],members),members);
  assert.deepEqual([...new Set(full.packages.flatMap(row=>row.members ?? [row.package]))].sort(),members.map(pkg=>pkg.name).sort());
  assert.match(job('packages'),/fail-fast: false/);
  assert.match(job('root'),/fail-fast: false/);
  assert.match(job('packages'),/matrix: \$\{\{ fromJSON\(needs.changes.outputs.package_matrix\) \}\}/);
  assert.match(job('packages'),/node scripts\/test-postgres.mjs --filter \$\{\{ matrix.package \}\} test/);
  assert.match(job('typecheck'),/run: pnpm typecheck/);
});
test('all existing receipt suites and workflow guards remain available in CI',()=>{
  assert.deepEqual(receiptSuites,['test:two-venue-milestone-receipt','test:backup-capacity','test:public-gateway-limits','test:local-stack','test:database-recovery-receipt','test:cloud-cost']);
  assert.match(job('receipts'),/run: node scripts\/ci-run-receipts.mjs/);
  assert.match(job('receipts'),/CI_PLAN: \$\{\{ needs.changes.outputs.plan \}\}/);
  assert.match(job('root'),/run: node --test --test-reporter=tap --test-concurrency=2 --test-shard=\$\{\{ matrix.shard \}\}\/8 scripts\/ci-\*\.test.mjs scripts\/identity-upstream.test.mjs scripts\/verify-gateway-reconnection-receipt.test.mjs/);
});
test('slow packages run every file shard with their original test deadlines',()=>{
  const members=loadWorkspace();
  const full=workPlan(scopeForPaths([],members),members);
  for (const [name,count] of [['registration',6],['account-http',3],['backups',7],['portal',6]]) {
    const rows=full.packages.filter(row=>row.package===`@waitron-cloud/${name}`);
    assert.deepEqual(rows.map(row=>row.shard),Array.from({length:count},(_,i)=>i+1));
    assert.ok(rows.every(row=>row.shards===count));
  }
  const packages=job('packages');
  assert.match(packages,/if: \$\{\{ !matrix.shards && !matrix.members \}\}\n\s+run: node scripts\/test-postgres.mjs --filter/);
  assert.match(packages,/if: matrix.package == '@waitron-cloud\/portal'\n\s+run: pnpm --filter \$\{\{ matrix.package \}\} build/);
  assert.match(packages,/if: matrix.package == '@waitron-cloud\/registration'\n\s+run: node scripts\/test-postgres.mjs exec pnpm --filter \$\{\{ matrix.package \}\} exec node \.\.\/\.\.\/scripts\/ci-run-registration-shard.mjs \$\{\{ matrix.shard \}\}/);
  assert.match(packages,/if: matrix.package == '@waitron-cloud\/remote-access'\n\s+run: node scripts\/test-postgres.mjs exec pnpm --filter \$\{\{ matrix.package \}\} exec node \.\.\/\.\.\/scripts\/ci-run-remote-shard.mjs \$\{\{ matrix.shard \}\}/);
  assert.match(packages,/if: matrix.shards && matrix.package != '@waitron-cloud\/registration' && matrix.package != '@waitron-cloud\/remote-access'\n\s+run: node scripts\/test-postgres.mjs exec pnpm --filter \$\{\{ matrix.package \}\} exec node --test --test-reporter=tap --test-reporter-destination=stdout --test-reporter=\.\.\/\.\.\/scripts\/ci-required-cases\.mjs --test-reporter-destination=stdout --test-timeout=\$\{\{ matrix.package == '@waitron-cloud\/portal' && '120000' \|\| '30000' \}\} --test-shard=\$\{\{ matrix.shard \}\}\/\$\{\{ matrix.shards \}\} "test\/\*\.test\.ts"/);
});
test('work jobs stop within eight minutes and planner/summary within two',()=>{
  for (const name of ['root','typecheck','receipts','packages']) assert.match(job(name),/^    timeout-minutes: 8$/m);
  for (const name of ['changes','summary','documentation']) assert.match(job(name),/^    timeout-minutes: 2$/m);
});
test('browser setup is limited to browser packages and bounded across two attempts',()=>{
  const packages=job('packages');
  assert.match(packages,/if: matrix.package == '@waitron-cloud\/portal' \|\| matrix.package == '@waitron-cloud\/ui-smoke'/);
  assert.match(packages,/python3 scripts\/ci-download.py --timeout 120 --attempts 2/);
  assert.match(packages,/--grace 10 --lock-wait 30 --retry-delay 5/);
  assert.match(packages,/-- pnpm --filter @waitron-cloud\/ui-smoke exec playwright install chromium/);
});
test('strict summary always runs and receives the plan and every dependency result',()=>{
  assert.match(job('summary'),/if: \$\{\{ always\(\) \}\}/);
  assert.match(job('summary'),/needs: \[changes, root, typecheck, receipts, packages, documentation, scripts\]/);
  assert.match(job('summary'),/CI_PLAN: \$\{\{ needs.changes.outputs.plan \}\}/);
  assert.match(job('summary'),/CI_RESULTS: \$\{\{ toJSON\(needs\) \}\}/);
  assert.match(job('summary'),/CI_HEAD_SHA: \$\{\{ github.event.pull_request.head.sha \|\| github.sha \}\}/);
  assert.match(job('summary'),/run: node scripts\/ci-summary.mjs/);
  assert.match(job('summary'), /fetch-depth: 0/);
});

test('required dependency results cannot ignore a job failure after its steps finish', () => {
  for (const name of ['changes', 'root', 'typecheck', 'receipts', 'packages', 'documentation', 'scripts']) {
    assert.doesNotMatch(job(name), /^    continue-on-error:/m);
  }
});
test('all work gates follow the planner and every checkout tests the exact PR head',()=>{
  for (const name of ['root','typecheck','receipts','packages','documentation']) {
    assert.match(job(name),new RegExp(`if: needs.changes.outputs.${name === 'root' ? 'root_tests' : name} == 'true'`));
    assert.match(job(name),/needs: changes/);
  }
  for (const name of ['changes','root','typecheck','receipts','packages','summary','documentation']) {
    assert.match(job(name),/ref: \$\{\{ github.event.pull_request.head.sha \|\| github.sha \}\}/);
  }
  assert.match(job('changes'),/fetch-depth: 0/);
  assert.match(job('changes'),/run: node scripts\/ci-plan.mjs/);
});

test('root-only and receipt-only work execute their families without the compiler gate', () => {
  const enabled = (name, outputs) => {
    const gate = /if: needs.changes.outputs.([a-z_]+) == 'true'/.exec(job(name));
    assert.ok(gate, `Missing fixed planner gate: ${name}`);
    return outputs[gate[1]] === 'true';
  };
  for (const [outputs, expected] of [
    [{root_tests: 'true', typecheck: 'false', receipts: 'false', packages: 'false'}, ['root']],
    [{root_tests: 'false', typecheck: 'false', receipts: 'true', packages: 'false'}, ['receipts']],
    [{root_tests: 'true', typecheck: 'true', receipts: 'true', packages: 'true'}, ['root', 'typecheck', 'receipts', 'packages']],
  ]) assert.deepEqual(['root', 'typecheck', 'receipts', 'packages'].filter(name => enabled(name, outputs)), expected);
});

test('planner disables automatic caching because it creates no package store to save',()=>{
  assert.match(job('changes'),/package-manager-cache: false/);
});

test('audited document job checks immutable prose without installing workspace dependencies',()=>{
  assert.match(job('changes'), /documentation: \$\{\{ steps.plan.outputs.documentation \}\}/);
  assert.match(job('documentation'), /fetch-depth: 0/);
  assert.match(job('documentation'), /run: node scripts\/ci-docs.mjs/);
  assert.match(job('documentation'), /CI_PLAN: \$\{\{ needs.changes.outputs.plan \}\}/);
  assert.match(job('documentation'), /package-manager-cache: false/);
  assert.doesNotMatch(job('documentation'), /pnpm install|test-postgres/);
});

test('selected receipt suites share one setup and receive the exact plan', () => {
  assert.doesNotMatch(job('receipts'), /matrix:|strategy:/);
  assert.match(job('receipts'), /run: node scripts\/ci-run-receipts.mjs/);
  assert.match(job('receipts'), /CI_PLAN: \$\{\{ needs.changes.outputs.plan \}\}/);
});

test('short package groups share one database harness and receive the exact matrix row', () => {
  const packages = job('packages');
  assert.match(packages, /if: matrix.members\n\s+run: node scripts\/test-postgres.mjs exec node scripts\/ci-run-package-group.mjs/);
  assert.match(packages, /CI_PACKAGE_GROUP: \$\{\{ toJSON\(matrix\) \}\}/);
  assert.match(packages, /if: \$\{\{ !matrix.shards && !matrix.members \}\}/);
});

test('audited root scripts run their own immutable checks without package installation', () => {
  assert.match(job('changes'), /scripts: \$\{\{ steps.plan.outputs.scripts \}\}/);
  assert.match(job('scripts'), /needs: changes/);
  assert.match(job('scripts'), /if: needs.changes.outputs.scripts == 'true'/);
  assert.match(job('scripts'), /ref: \$\{\{ github.event.pull_request.head.sha \|\| github.sha \}\}/);
  assert.match(job('scripts'), /fetch-depth: 0/);
  assert.match(job('scripts'), /timeout-minutes: 2/);
  assert.match(job('scripts'), /package-manager-cache: false/);
  assert.match(job('scripts'), /run: node scripts\/ci-scripts.mjs/);
  assert.match(job('scripts'), /CI_PLAN: \$\{\{ needs.changes.outputs.plan \}\}/);
  assert.doesNotMatch(job('scripts'), /pnpm install|test-postgres/);
});

// These contract guards catch disconnected configuration. The PR rehearsal must
// separately establish GitHub's real expression, permission and job-name behavior.
const nightly = readFileSync(new URL('../.github/workflows/nightly.yml', import.meta.url), 'utf8');
const nightlyJob = name => nightly.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [\\w-]+:|$(?![\\s\\S]))`, 'm'))?.[1] ?? '';
test('nightly contract keeps a daily trigger and all four full reusable families', () => {
  const cron = /^    - cron: '(\d+) (\d+) \* \* \*'$/m.exec(nightly);
  assert.ok(cron, 'Nightly must execute every calendar day');
  assert.ok(Number(cron[1]) > 0 && Number(cron[1]) < 60 && Number(cron[2]) < 24, 'Use a valid time away from the hour');
  assert.match(nightly, /^  workflow_dispatch:$/m);
  for (const [name, path] of [['standard', 'ci'], ['cost', 'cloud-cost'], ['venue', 'venue-services-proof'], ['aws', 'aws-infrastructure']]) {
    assert.match(nightlyJob(name), new RegExp(String.raw`uses: \./\.github/workflows/${path}\.yml`));
    assert.match(nightlyJob(name), /full: true/);
    const called = readFileSync(new URL(`../.github/workflows/${path}.yml`, import.meta.url), 'utf8');
    assert.match(called, /^  workflow_call:$/m);
    assert.match(called, /CI_FORCE_FULL: \$\{\{ inputs.full \}\}/);
    assert.match(called, /group: (?:ci|cost-conformance|venue-services|aws-infrastructure)-\$\{\{ inputs.full && 'nightly-' \|\| '' \}\}\$\{\{ github.event_name == 'pull_request' && github.ref \|\| github.run_id \}\}/);
    assert.match(called, /cancel-in-progress: \$\{\{ !inputs.full && github.event_name == 'pull_request' \}\}/);
  }
});
test('nightly final gate always receives every workflow and mutation result', () => {
  const final = nightlyJob('summary');
  assert.match(final, /if: \$\{\{ always\(\) \}\}/);
  assert.match(final, /needs: \[standard, cost, venue, aws, mutations\]/);
  assert.match(final, /CI_NIGHTLY_RESULTS: \$\{\{ toJSON\(needs\) \}\}/);
  assert.match(final, /run: node scripts\/ci-nightly-summary\.mjs/);
  assert.match(nightlyJob('standard'), /job-prefix: 'standard \/ '/);
  assert.match(job('summary'), /CI_JOB_PREFIX: \$\{\{ inputs.job-prefix \}\}/);
});

test('storage advisory runs after failed cost work and stays outside the nightly gate', () => {
  const advisory = nightlyJob('storage-advisory');
  assert.match(advisory, /needs: cost/);
  assert.match(advisory, /if: \$\{\{ always\(\) \}\}/);
  assert.match(advisory, /^    continue-on-error: true$/m);
  assert.match(advisory, /node scripts\/ci-nightly-storage\.mjs/);
  assert.match(advisory, /GH_TOKEN: \$\{\{ secrets.GITHUB_TOKEN \}\}/);
  assert.doesNotMatch(nightlyJob('summary'), /storage-advisory/);
});
for (const present of [false, true]) test(`storage advisory handles ${present ? 'a current' : 'an older'} head without a missing-file failure`, () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-storage-advisory-head-'));
  try {
    if (present) {
      mkdirSync(join(root, 'scripts'));
      writeFileSync(join(root, 'scripts/ci-nightly-storage.mjs'), readFileSync(new URL('./ci-nightly-storage.mjs', import.meta.url)));
    }
    const command = nightlyJob('storage-advisory').match(/- name: Report generated storage changes\n\s+run: \|\n([\s\S]*?)(?=\n\s+env:)/)?.[1];
    assert.ok(command, 'The advisory must handle a head that predates its script');
    const summary = join(root, 'summary.md');
    const result = spawnSync('sh', ['-c', command.split('\n').map(line => line.replace(/^ {10}/, '')).join('\n')],
      {cwd: root, encoding: 'utf8', env: {...process.env, GITHUB_REPOSITORY: '', GITHUB_RUN_ID: '', GITHUB_RUN_ATTEMPT: '', GITHUB_STEP_SUMMARY: summary}});
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(summary, 'utf8'), /# Cloud cost advisory/);
    assert.match(result.stdout, present ? /advisory evidence unavailable/ : /unavailable for this head/);
  } finally {rmSync(root, {recursive: true, force: true});}
});
test('only the full nightly paced cell exports a successful measurement with attempt-specific optional upload', () => {
  const cost = readFileSync(new URL('../.github/workflows/cloud-cost.yml', import.meta.url), 'utf8');
  const upload = cost.match(/- name: Retain generated storage observation\n([\s\S]*?)(?=\n  [a-z]|$)/)?.[1] ?? '';
  assert.match(cost, /CLOUD_NIGHTLY_STORAGE_OUTPUT:.*inputs.full.*matrix.file == 'paced-replay-conformance.test.mjs'/);
  assert.match(upload, /inputs.full && matrix.file == 'paced-replay-conformance.test.mjs'.*steps.conformance.outcome == 'success'/);
  assert.match(upload, /continue-on-error: true/);
  assert.match(upload, /name: nightly-storage-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}/);
  assert.match(upload, /if-no-files-found: warn/);
  assert.match(upload, /retention-days: 14/);
});


test('the shared UI deadline is required before test selection', () => {
  const changes = job('changes');
  const steps = changes.split(/^      - /m).slice(1);
  const lag = steps.findIndex(step => /^name: Check shared UI version lag$/m.test(step));
  const plan = steps.findIndex(step => /^id: plan$/m.test(step));
  assert(lag >= 0 && plan > lag, 'UI deadline must run before the planner');
  assert.doesNotMatch(steps[lag], /(?:^|\n)\s*(?:if|continue-on-error|working-directory|shell):/);
  assert.match(steps[lag], /node scripts\/ci-ui-lag\.mjs/);
  assert.match(steps[lag], /NODE_AUTH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
});

for (const [scenario, script, status, output] of [
  ['an older head without the script', null, 0, /Skipping shared UI version lag/],
  ['a current head within the update window', 'console.log("lag check executed");', 0, /lag check executed/],
  ['a current head with an overdue version', 'console.error("overdue version"); process.exitCode = 1;', 1, /overdue version/],
]) test(`the shared UI workflow handles ${scenario}`, () => {
  const step = job('changes').split(/^      - /m).find(part => /^name: Check shared UI version lag$/m.test(part));
  const run = /^        run: \|\n((?:          .*\n|\n)+)/m.exec(step);
  assert.ok(run, 'the lag step must have a multiline shell command');
  const command = run[1].replace(/^          /gm, '');
  const directory = mkdtempSync(join(tmpdir(), 'cloud-ui-workflow-'));
  try {
    if (script !== null) {
      mkdirSync(join(directory, 'scripts'));
      writeFileSync(join(directory, 'scripts/ci-ui-lag.mjs'), script);
    }
    const result = spawnSync('bash', ['-e', '-c', command], {cwd: directory, encoding: 'utf8'});
    assert.equal(result.status, status, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, output);
    if (script !== null) assert.doesNotMatch(result.stdout, /Skipping shared UI version lag/);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});

// Each wrapper carries its entire approved set; the allowance wrapper includes its helper.
test('nightly mutation job runs all four approved wrappers and the allowance helper', () => {
  const mutations = nightlyJob('mutations');
  const command = mutations.match(/run: (node scripts\/test-postgres\.mjs exec node --test[^\n]+)/)?.[1];
  assert.ok(command, 'Nightly must execute the mutation wrappers through PostgreSQL');
  assert.deepEqual(command.split(' ').filter(argument => argument.endsWith('.nightly.ts')), [
    'packages/account-http/test/venue-service-direct-wait-guards.nightly.ts',
    'packages/account-http/test/venue-service-external-wait-guards.nightly.ts',
    'packages/registration/test/billing-allowance-guards.nightly.ts',
    'packages/registration/test/billing-guard-qualification.nightly.ts',
  ]);
  assert.match(command, /--test-concurrency=1/);
  const allowance = readFileSync(new URL('../packages/registration/test/billing-allowance-guards.nightly.ts', import.meta.url), 'utf8');
  assert.match(allowance, /scripts\/allowance-traffic-guard-probes\.nightly\.mjs/);
  assert.match(allowance, /scripts\/allowance-traffic-guard-probes\.mjs/);
});


test('nightly wires three diagnostic steps and always uploads their logs', () => {
  const mutations = nightlyJob('mutations');
  const checkout = mutations.match(/      - uses: actions\/checkout@v5\n([\s\S]*?)(?=      - )/)?.[1];
  assert.match(checkout ?? '', /^\s+fetch-depth: 0$/m, 'Relay migration fixtures require historical commits');
  for (const name of ['Exercise stale ownership under bounded CPU contention',
    'Check password snapshot ordering and deliberate faults', 'Prove counter rollback, retry and deleted-guard refusal']) {
    assert.ok(mutations.includes(`      - name: ${name}\n        run: |\n`), `Missing executable nightly step: ${name}`);
  }
  assert.equal([...mutations.matchAll(/node scripts\/test-postgres\.mjs exec python3 -u - <<'PYTHON'/g)].length, 2);
  const upload = mutations.match(/      - name: Retain diagnostic logs\n([\s\S]*)$/)?.[1];
  assert.ok(upload, 'Nightly must retain diagnostic logs even after failure');
  assert.match(upload, /if: always\(\)/);
  assert.match(upload, /uses: actions\/upload-artifact@v4/);
  assert.match(upload, /name: nightly-diagnostics-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}/);
  assert.match(upload, /path: diagnostics\//);
});
