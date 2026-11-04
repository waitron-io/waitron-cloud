import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, mkdir, writeFile, chmod, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse } from 'yaml';

const execute = promisify(execFile);
const path = new URL('../../.github/workflows/aws-infrastructure.yml', import.meta.url);
async function workflow() {
  try { return parse(await readFile(path, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

// Omitting either event or filtering paths would leave some merge SHAs unchecked.
test('AWS checks cover every main push and pull request', async () => {
  const value = await workflow();
  assert.deepEqual(value.on, { push: { branches: ['main'] }, pull_request: null });
  assert.equal(value.concurrency.group, "aws-infrastructure-${{ github.event_name == 'pull_request' && github.ref || github.run_id }}");
  assert.equal(value.concurrency['cancel-in-progress'], "${{ github.event_name == 'pull_request' }}");
});

// The checkout action receives the PR candidate, never GitHub's synthetic merge.
test('AWS checks use the exact candidate with read-only repository permission', async () => {
  const value = await workflow();
  assert.deepEqual(value.permissions, { contents: 'read' });
  assert.equal(value.defaults, undefined);
  assert.deepEqual(Object.keys(value.jobs), ['verify']);
  const job = value.jobs.verify;
  assert.equal(job.permissions, undefined);
  assert.equal(job.env, undefined);
  assert.equal(job.if, undefined);
  assert.equal(job.defaults, undefined);
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.ok(job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 30);
  const checkout = job.steps.find(step => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with.ref, '${{ github.event.pull_request.head.sha || github.sha }}');
  assert.equal(checkout.with['persist-credentials'], false);
  assert.equal(job.steps.find(step => step.uses?.startsWith('actions/setup-node@')).with['node-version'], '26');
  const setup = job.steps.find(step => step.run === 'node scripts/ci-setup-pnpm.mjs');
  assert.ok(setup, 'The repository package-manager supervisor must run');
  assert.deepEqual(Object.keys(setup).sort(), ['env', 'run', 'shell']);
  assert.ok(job.steps.indexOf(job.steps.find(step => step.uses?.startsWith('actions/setup-node@'))) < job.steps.indexOf(setup));
  assert.deepEqual(setup.env, {
    NODE_OPTIONS: '--require=${{ github.workspace }}/scripts/ci-pnpm-diagnostics.cjs',
    npm_config_fetch_timeout: '15000',
    npm_config_fetch_retries: '1',
    npm_config_fetch_retry_mintimeout: '1000',
  });
  assert.equal(value.env, undefined);
  for (const step of job.steps) {
    if (step !== setup) assert.equal(step.env, undefined);
    assert.equal(step['working-directory'], undefined);
    assert.equal(step.if, step.uses?.startsWith('actions/upload-artifact@') ? '${{ always() }}' : undefined);
  }
});

async function runCommands(t, fail = '') {
  const value = await workflow();
  assert.ok(value.jobs?.verify, 'AWS verification job must exist');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cloud-aws-workflow-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'bin'));
  await mkdir(join(root, 'deploy/aws'), { recursive: true });
  await writeFile(join(root, 'deploy/aws/fixture.test.mjs'), '');
  const probe = `#!${process.execPath}
import { appendFileSync } from 'node:fs';
import { basename } from 'node:path';
const args = process.argv.slice(2);
const command = basename(process.argv[1]);
appendFileSync(process.env.TRACE, JSON.stringify([command, ...args]) + '\\n');
const stage = args[0] === 'scripts/ci-setup-pnpm.mjs' ? 'setup' : command === 'pnpm' ? 'install' : command === 'docker' ? 'format'
  : args.includes('--prepare-tools') ? 'prepare' : args.includes('--all') ? 'suites' : 'guards';
console.log(stage === 'guards' ? '# tests 3\\n# pass 3\\n# fail 0' : stage === 'suites' ? 'Success! 2 passed, 0 failed.' : stage);
process.exit(process.env.FAIL_STAGE === stage ? 7 : 0);
`;
  for (const name of ['node', 'pnpm', 'docker']) {
    await writeFile(join(root, 'bin', name), probe);
    await chmod(join(root, 'bin', name), 0o755);
  }
  const steps = value.jobs.verify.steps.filter(step => step.run);
  assert.ok(steps.length > 0, 'AWS command steps must exist');
  let status = 0;
  for (const step of steps) {
    assert.equal(step.shell, 'bash');
    try {
      await execute('/bin/bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', step.run], {
        cwd: root, timeout: 10_000, maxBuffer: 1024 * 1024,
        env: { PATH: `${join(root, 'bin')}:/usr/bin:/bin`, TRACE: join(root, 'trace'), FAIL_STAGE: fail },
      });
    } catch (error) { status = error.code; break; }
  }
  let allCalls = [];
  try { allCalls = (await readFile(join(root, 'trace'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const isSetup = call => call[0] === 'node' && call[1] === 'scripts/ci-setup-pnpm.mjs';
  return { root, status, calls: allCalls.filter(call => !isSetup(call)), allCalls };
}

test('AWS shell verifies the package manager before infrastructure work and stops on setup failure', async t => {
  const baseline = await runCommands(t);
  assert.equal(baseline.status, 0);
  assert.deepEqual(baseline.allCalls, [['node', 'scripts/ci-setup-pnpm.mjs'], ...baseline.calls]);
  const refused = await runCommands(t, 'setup');
  assert.equal(refused.status, 7);
  assert.deepEqual(refused.allCalls, [['node', 'scripts/ci-setup-pnpm.mjs']]);
  assert.deepEqual(refused.calls, []);
});

// Execute the workflow's actual shell; replace only the external tool boundary.
test('AWS shell prepares tools, installs locked dependencies, checks guards and all plans, then formats offline', async t => {
  const { root, status, calls } = await runCommands(t);
  assert.equal(status, 0);
  assert.deepEqual(calls, [
    ['node', 'deploy/aws/check.mjs', '--prepare-tools'],
    ['pnpm', '--dir', 'deploy/aws', 'install', '--ignore-workspace', '--frozen-lockfile'],
    ['node', '--test', '--test-concurrency=1', 'deploy/aws/fixture.test.mjs'],
    ['node', 'deploy/aws/check.mjs', '--all'],
    ['docker', 'run', '--rm', '--pull', 'never', '--network', 'none', '--user', '65532:65532',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only',
      '--memory', '256m', '--cpus', '1', '--pids-limit', '32',
      '--mount', `type=bind,source=${root}/deploy/aws,target=/source,readonly`,
      'waitron-cloud-aws-tools:1.13.2-aws6.70.0', 'tofu', 'fmt', '-check', '-recursive', '/source'],
  ]);
  assert.match(await readFile(join(root, '.aws-check-logs/guards.log'), 'utf8'), /# tests 3\n# pass 3\n# fail 0/);
  assert.match(await readFile(join(root, '.aws-check-logs/suites.log'), 'utf8'), /Success! 2 passed, 0 failed/);
  for (const stage of ['prepare', 'install', 'format']) {
    assert.equal(await readFile(join(root, `.aws-check-logs/${stage}.log`), 'utf8'), `${stage}\n`);
  }
});

for (const [index, stage] of ['prepare', 'install', 'guards', 'suites', 'format'].entries()) {
  test(`AWS shell propagates ${stage} failure through tee and stops later tools`, async t => {
    const { root, status, calls } = await runCommands(t, stage);
    assert.equal(status, 7);
    assert.equal(calls.length, index + 1);
    assert.ok((await readFile(join(root, `.aws-check-logs/${stage}.log`), 'utf8')).length > 0);
  });
}

test('AWS assertion counts and diagnostics are retained after failure', async () => {
  const value = await workflow();
  assert.ok(value.jobs?.verify, 'AWS verification job must exist');
  const upload = value.jobs.verify.steps.filter(step => step.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(upload.length, 1);
  assert.equal(upload[0].if, '${{ always() }}');
  assert.equal(upload[0].with.name, 'aws-infrastructure-${{ github.event.pull_request.head.sha || github.sha }}-${{ github.run_attempt }}');
  assert.equal(upload[0].with.path, '.aws-check-logs/');
  assert.equal(upload[0].with['include-hidden-files'], true);
  assert.ok(upload[0].with['retention-days'] > 0 && upload[0].with['retention-days'] <= 30);
  assert.equal(upload[0].with['if-no-files-found'], 'error');
});
