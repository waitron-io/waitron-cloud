import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import test from 'node:test';

const checker = resolve('scripts/ci-docs.mjs');
function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-proof-inputs-'));
  const git = (...args) => execFileSync('git', ['-c', 'maintenance.auto=false', ...args],
    {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  const put = (path, text = 'export const changed = true;\n') => {
    mkdirSync(join(root, path, '..'), {recursive: true}); writeFileSync(join(root, path), text);
  };
  const commit = () => {git('add', '-A'); git('commit', '-sm', 'Proof input fixture'); return git('rev-parse', 'HEAD');};
  const plan = (kind, event, sha = git('rev-parse', 'HEAD')) => {
    const eventPath = join(root, '.git/event.json'), output = join(root, '.git/output');
    writeFileSync(eventPath, JSON.stringify(event)); writeFileSync(output, '');
    const result = spawnSync(process.execPath, [checker, '--plan'], {cwd: root, encoding: 'utf8',
      env: {...process.env, CI_PROOF_KIND: kind, GITHUB_SHA: sha,
        GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: output}});
    assert.equal(result.status, 0, result.stderr);
    const lines = readFileSync(output, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1, result.stdout);
    assert.match(lines[0], /^required=(true|false)$/);
    return {required: lines[0] === 'required=true', reason: result.stdout};
  };
  try {
    git('init', '-b', 'main'); git('config', 'user.name', 'Proof test'); git('config', 'user.email', 'proof@example.test');
    put('docs/backlog.md', '# Backlog\n'); const base = commit();
    const pr = (head, old = base) => ({pull_request: {base: {sha: old}, head: {sha: head}}});
    run({root, git, put, commit, plan, base, pr});
  } finally {rmSync(root, {recursive: true, force: true});}
}

// Portal UI changes do not alter the separate proof inputs.
test('portal code plus backlog omits both separate proof matrices', () => fixture(({put, commit, plan, pr}) => {
  put('apps/portal/src/account.ts'); put('docs/backlog.md', '# Updated\n');
  const event = pr(commit());
  for (const kind of ['cost', 'venue']) assert.equal(plan(kind, event).required, false, kind);
}));

// These literal inputs come from the rehearsal launcher, its fixtures and gateway Dockerfile.
for (const path of ['scripts/cloud-cost/conformance-prepare.mjs', 'scripts/cloud-cost/fixtures/new-conformance.test.mjs',
  'scripts/cloud-cost/fixtures/replay-font/invoice-noto-sans.ttf', 'packages/registration/src/email-outbox.ts',
  'packages/registration/migrations/099_mail.sql', 'packages/account-http/test/fixtures.ts',
  'packages/remote-access/src/manifest.ts', 'packages/identity/src/index.ts',
  'deploy/local-remote/Dockerfile', 'docs/cost-model/provider.json', 'docs/cloud-cost-model.md']) {
  test(`cost selects its consumed input ${path}`, () => fixture(({put, commit, plan, pr}) => {
    put(path); assert.equal(plan('cost', pr(commit())).required, true);
  }));
}

for (const path of ['scripts/venue-service-proof.test.ts', 'scripts/legacy-service-proof.test.ts',
  'scripts/fixtures/service-proof.ts', 'scripts/test-cloud-free-services.mjs', 'scripts/test-cloud-venue-services.test.mjs',
  'packages/registration/test/venue-service-rules.test.ts', 'deploy/test-cloud/free-services-mail.test.mjs']) {
  test(`venue selects its proof code ${path}`, () => fixture(({put, commit, plan, pr}) => {
    put(path); assert.equal(plan('venue', pr(commit())).required, true);
  }));
}

test('backend source selects cost without repeating the venue matrix', () => fixture(({put, commit, plan, pr}) => {
  put('packages/registration/src/signup.ts'); const event = pr(commit());
  assert.equal(plan('cost', event).required, true); assert.equal(plan('venue', event).required, false);
}));

test('ordinary package tests omit separate proofs', () => fixture(({put, commit, plan, pr}) => {
  put('packages/registration/test/signup.test.ts'); const event = pr(commit());
  for (const kind of ['cost', 'venue']) assert.equal(plan(kind, event).required, false, kind);
}));

for (const path of ['pnpm-lock.yaml', 'package.json', 'pnpm-workspace.yaml', '.npmrc', '.dockerignore',
  'packages/backups/package.json', 'packages/ui-smoke/package.json', 'scripts/test-postgres.mjs',
  'scripts/ci-setup-pnpm.mjs', 'scripts/ci-pnpm-diagnostics.cjs', 'scripts/ci-proof-inputs.mjs']) {
  test(`both proofs keep installation or execution input ${path}`, () => fixture(({put, commit, plan, pr}) => {
    put(path); const event = pr(commit());
    for (const kind of ['cost', 'venue']) assert.equal(plan(kind, event).required, true, kind);
  }));
}

test('each proof selects its own workflow without waking the other matrix', () => fixture(({put, commit, plan, pr}) => {
  put('.github/workflows/cloud-cost.yml'); const event = pr(commit());
  assert.equal(plan('cost', event).required, true); assert.equal(plan('venue', event).required, false);
}));

test('deletion and rename of a consumed input still select cost', () => fixture(({git, put, commit, plan, pr}) => {
  put('scripts/cloud-cost/mail.mjs'); const base = commit();
  git('mv', 'scripts/cloud-cost/mail.mjs', 'docs/not-a-cost-input.md');
  const head = commit(); assert.equal(plan('cost', pr(head, base)).required, true);
}));

test('an advanced target uses the common ancestor and ignores uncommitted files', () => fixture(({git, put, commit, plan, base, pr}) => {
  put('apps/portal/src/account.ts'); const head = commit();
  git('checkout', '--detach', base); put('scripts/cloud-cost/mail.mjs'); const target = commit();
  git('checkout', '--detach', head); put('scripts/cloud-cost/mail.mjs');
  assert.equal(plan('cost', pr(head, target)).required, false);
}));

test('manual and scheduled events run both complete matrices', () => fixture(({plan}) => {
  for (const kind of ['cost', 'venue']) for (const event of [{}, {schedule: '17 2 * * *'}, {before: 'a'.repeat(40)}]) {
    assert.equal(plan(kind, event).required, true);
  }
}));

test('missing revisions, malformed identities, wrong checkout and empty diffs keep work', () => fixture(({git, put, commit, plan, base, pr}) => {
  put('apps/portal/src/account.ts'); const head = commit();
  for (const event of [pr(head, 'a'.repeat(40)), pr('main'), pr(head, 'HEAD~1'), pr(head, head)]) {
    for (const kind of ['cost', 'venue']) assert.equal(plan(kind, event).required, true, JSON.stringify(event));
  }
  assert.equal(plan('unknown', pr(head)).required, true);
  git('checkout', '--detach', base);
  assert.equal(plan('cost', pr(head), head).required, true);
}));

test('unknown package inputs and unfamiliar top-level areas keep both proofs', () => fixture(({put, commit, plan, pr}) => {
  put('packages/new-service/src/index.ts'); const event = pr(commit());
  for (const kind of ['cost', 'venue']) assert.equal(plan(kind, event).required, true, kind);
}));

test('a cost consumer shared test helper keeps conformance', () => fixture(({put, commit, plan, pr}) => {
  put('packages/account-http/test/fixtures/mail-state.ts');
  assert.equal(plan('cost', pr(commit())).required, true);
}));

for (const [kind, name] of [['cost', 'cloud-cost.yml'], ['venue', 'venue-services-proof.yml']]) {
  test(`${kind} workflow's actual planner wiring omits portal work and keeps its own control`, () => fixture(({put, commit, plan, pr}) => {
    const workflow = readFileSync(resolve('.github/workflows', name), 'utf8');
    const configuredKind = /CI_PROOF_KIND: (\w+)/.exec(workflow)?.[1] ?? '';
    put('apps/portal/src/account.ts'); const unrelated = commit();
    assert.equal(plan(configuredKind, pr(unrelated)).required, false);
    put(`.github/workflows/${name}`); const own = commit();
    assert.equal(plan(configuredKind, pr(own, unrelated)).required, true);
  }));
}

// GitHub gives PR jobs a synthetic merge SHA even when checkout explicitly selects the head.
test('the PR merge environment does not widen a verified head checkout', () => fixture(({put, commit, plan, base, pr}) => {
  put('apps/portal/src/account.ts'); const head = commit();
  for (const kind of ['cost', 'venue']) assert.equal(plan(kind, pr(head), base).required, false, kind);
}));

for (const path of ['packages/translation/test/free-service-plans.test.ts',
  'packages/registration/test/relay-grants.test.ts', 'packages/registration/test/relay-worker.test.ts',
  'packages/registration/test/relay-control.test.ts', 'packages/registration/test/relay-operator-stop.test.ts',
  'packages/registration/test/content-translation-service.test.ts', 'packages/translation/test/machine.test.ts',
  'packages/translation/test/worker.test.ts', 'packages/translation/test/collect-page.test.ts',
  'packages/translation/test/consent.test.ts', 'packages/translation/test/worker-cli.test.ts',
  'packages/account-http/test/relay-disabled.test.ts', 'packages/account-http/test/translation.test.ts',
  'packages/account-http/test/translation-collect-pages.test.ts', 'packages/account-http/test/content-translation-readers.test.ts']) {
  test(`venue retains named package proof case ${path}`, () => fixture(({put, commit, plan, pr}) => {
    put(path); assert.equal(plan('venue', pr(commit())).required, true);
  }));
}

test('unfamiliar root areas and malformed filenames keep proof work', () => fixture(({put, commit, plan, pr}) => {
  put('future-runtime/config.json'); const unknown = commit();
  for (const kind of ['cost', 'venue']) assert.equal(plan(kind, pr(unknown)).required, true);
  put('apps/portal/src/ambiguous\ninput.ts'); const malformed = commit();
  for (const kind of ['cost', 'venue']) assert.equal(plan(kind, pr(malformed, unknown)).required, true);
}));

test('root prose does not wake either proof matrix', () => fixture(({put, commit, plan, pr}) => {
  put('README.md', '# Cloud documentation\n'); const event = pr(commit());
  for (const kind of ['cost', 'venue']) assert.equal(plan(kind, event).required, false);
}));

// A required audit renewal is evidence; it must not select otherwise unrelated proof work.
test('a real portal PR with all four renewed inventories still omits both matrices', () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-proof-audit-'));
  const repo = join(root, 'repo');
  try {
    execFileSync('git', ['clone', '--shared', '--quiet', resolve('.'), repo]);
    const git = (...args) => execFileSync('git', ['-c', 'maintenance.auto=false', ...args],
      {cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
    git('config', 'user.name', 'Proof test'); git('config', 'user.email', 'proof@example.test');
    const base = git('rev-parse', 'HEAD');
    writeFileSync(join(repo, 'apps/portal/src/proof-selection-control.ts'), 'export const selected = true;\n');
    writeFileSync(join(repo, 'docs/backlog.md'), readFileSync(join(repo, 'docs/backlog.md'), 'utf8') + '\nProof selection control.\n');
    git('add', '-A');
    const renew = spawnSync(process.execPath, [resolve('scripts/ci-input-audit.mjs'), '--write-staged'],
      {cwd: repo, encoding: 'utf8'});
    assert.equal(renew.status, 0, renew.stdout + renew.stderr);
    git('add', 'scripts/ci-input-audit.json'); git('commit', '-sm', 'Renew complete proof control');
    const head = git('rev-parse', 'HEAD');
    const output = join(root, 'output'), eventPath = join(root, 'event.json');
    const execute = (kind, old = base) => {
      writeFileSync(output, '');
      writeFileSync(eventPath, JSON.stringify({pull_request: {base: {sha: old}, head: {sha: git('rev-parse', 'HEAD')}}}));
      const result = spawnSync(process.execPath, [checker, '--plan'], {cwd: repo, encoding: 'utf8',
        env: {...process.env, CI_PROOF_KIND: kind, GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: output}});
      assert.equal(result.status, 0, result.stdout + result.stderr);
      return readFileSync(output, 'utf8');
    };
    for (const kind of ['cost', 'venue']) assert.equal(execute(kind), 'required=false\n', kind);
    const policyPath = join(repo, 'scripts/ci-input-audit.json');
    const reviewedPolicy = JSON.parse(readFileSync(policyPath, 'utf8'));
    for (const field of ['docsInputSha256', 'identityInputSha256', 'gatewayInputSha256', 'lockInputSha256']) {
      const policy = {...reviewedPolicy, [field]: '0'.repeat(64)};
      writeFileSync(policyPath, JSON.stringify(policy));
      git('add', '-A'); git('commit', '-sm', `Refuse stale ${field}`);
      for (const kind of ['cost', 'venue']) assert.equal(execute(kind, head), 'required=true\n', `${kind}: ${field}`);
    }
  } finally {rmSync(root, {recursive: true, force: true});}
});

for (const path of ['packages/registration/test/fixtures/venue-service.ts',
  'packages/registration/test/fixtures/relay-worker.ts', 'packages/registration/test/fixtures/relay-stop-barrier.ts',
  'packages/registration/test/fixtures/reset-schema.ts', 'packages/backups/test/fixtures/recovery-v2.ts',
  'packages/backups/test/fixtures/verification.ts', 'packages/translation/test/fixtures.ts',
  'packages/translation/test/fake-openai.ts', 'packages/account-http/test/fixtures.ts']) {
  test(`venue keeps its imported proof helper ${path}`, () => fixture(({put, commit, plan, pr}) => {
    put(path); assert.equal(plan('venue', pr(commit())).required, true);
  }));
}

for (const path of ['deploy/local-stack/runtime.mjs', 'deploy/local-stack/lease.mjs',
  'deploy/local-stack/bootstrap.mjs', 'deploy/backup-verifier/target.json']) {
  test(`venue keeps its imported deployment fixture ${path}`, () => fixture(({put, commit, plan, pr}) => {
    put(path); assert.equal(plan('venue', pr(commit())).required, true);
  }));
}


test('deleting a consumed backend source still selects cost', () => fixture(({git, put, commit, plan, pr}) => {
  put('packages/remote-access/src/gateway-cli.ts'); const base = commit();
  git('rm', 'packages/remote-access/src/gateway-cli.ts');
  assert.equal(plan('cost', pr(commit(), base)).required, true);
}));

test('unfamiliar apps keep both proofs while UI smoke source omits them', () => fixture(({put, commit, plan, pr}) => {
  put('apps/new-service/src/index.ts'); const unknown = commit();
  for (const kind of ['cost', 'venue']) assert.equal(plan(kind, pr(unknown)).required, true);
  put('packages/ui-smoke/src/proof-control.ts'); const ui = commit();
  for (const kind of ['cost', 'venue']) assert.equal(plan(kind, pr(ui, unknown)).required, false);
}));

test('calculator publication changes keep cost conformance', () => fixture(({put, commit, plan, pr}) => {
  put('docs/cloud-cost-calculator.html'); assert.equal(plan('cost', pr(commit())).required, true);
}));

// Evaluate the workflow's trigger and job condition with the actual planner output.
// No condition means Actions schedules the job; an unknown condition is not evidence to skip it.
function workflowSchedules(name, event, required) {
  const workflow = readFileSync(resolve('.github/workflows', name), 'utf8');
  const triggerBlock = /^on:\n([\s\S]*?)(?=^\S)/m.exec(workflow)?.[1] ?? '';
  const events = [...triggerBlock.matchAll(/^  ([a-z_]+):/gm)].map(match => match[1]);
  if (!events.includes(event)) return false;
  const [job, producer] = name === 'cloud-cost.yml' ? ['conformance', 'discover'] : ['service-receipts', 'changes'];
  const block = new RegExp(`^  ${job}:\\n([\\s\\S]*?)(?=^  [a-z-]+:|$(?![\\s\\S]))`, 'm').exec(workflow)?.[1];
  assert.ok(block, 'Missing proof job');
  const condition = /^    if: (.+)$/m.exec(block)?.[1];
  if (!condition) return true;
  const expression = /^needs\.([a-z-]+)\.outputs\.required == '(true|false)'$/.exec(condition);
  assert.ok(expression, `Unrecognised proof gate: ${condition}`);
  const outputs = {[producer]: String(required)};
  return outputs[expression[1]] === expression[2];
}

for (const [kind, name] of [['cost', 'cloud-cost.yml'], ['venue', 'venue-services-proof.yml']]) {
  test(`${kind} workflow schedules selected PRs and manual full runs, without main-push repetition`, () => fixture(({put, commit, plan, pr}) => {
    put('apps/portal/src/account.ts'); const unrelated = commit();
    assert.equal(workflowSchedules(name, 'pull_request', plan(kind, pr(unrelated)).required), false);
    put(`.github/workflows/${name}`); const own = commit();
    assert.equal(workflowSchedules(name, 'pull_request', plan(kind, pr(own, unrelated)).required), true);
    assert.equal(workflowSchedules(name, 'workflow_dispatch', plan(kind, {}).required), true);
    assert.equal(workflowSchedules(name, 'push', plan(kind, {}).required), false);
  }));
}
