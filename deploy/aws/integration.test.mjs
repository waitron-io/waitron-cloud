import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir, mkdtemp, mkdir, writeFile, chmod, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse } from 'yaml';

const execute = promisify(execFile);
const path = new URL('../../.github/workflows/aws-infrastructure.yml', import.meta.url);
const cells = [
  { cell: 'guards-1', shard: 1 },
  { cell: 'guards-2', shard: 2 },
  { cell: 'guards-3', shard: 3 },
  { cell: 'suites', shard: 0 },
];
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
  assert.deepEqual(value.on, { workflow_call: {inputs: {full: {type: 'boolean', default: true}, 'job-prefix': {type: 'string', default: ''}}}, push: { branches: ['main'] }, pull_request: null });
  assert.equal(value.concurrency.group, "aws-infrastructure-${{ inputs.full && 'nightly-' || '' }}${{ github.event_name == 'pull_request' && github.ref || github.run_id }}");
  assert.equal(value.concurrency['cancel-in-progress'], "${{ !inputs.full && github.event_name == 'pull_request' }}");
});

// The checkout action receives the PR candidate, never GitHub's synthetic merge.
test('AWS checks use the exact candidate with read-only repository permission', async () => {
  const value = await workflow();
  assert.deepEqual(value.permissions, { contents: 'read', actions: 'read', 'pull-requests': 'read' });
  assert.equal(value.defaults, undefined);
  assert.deepEqual(Object.keys(value.jobs), ['changes', 'verify', 'summary']);
  const job = value.jobs.verify;
  assert.equal(job.permissions, undefined);
  assert.equal(job.env, undefined);
  assert.equal(job.if, "needs.changes.outputs.required == 'true'");
  assert.equal(job.needs, 'changes');
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

test('AWS verification partitions guards and plans without cancelling other cells', async () => {
  const value = await workflow();
  assert.deepEqual(value.jobs.verify.strategy, { 'fail-fast': false, matrix: { include: cells } });
  assert.equal(value.jobs.verify.name, 'verify (${{ matrix.cell }})');
});

test('AWS cells refuse ignored job or step failures', async () => {
  const { jobs: { verify: job } } = await workflow();
  assert.equal(job['continue-on-error'], undefined);
  for (const step of job.steps) assert.equal(step['continue-on-error'], undefined);
});

async function runCommands(t, fail = '', cell = cells[0], realGuards = false) {
  const value = await workflow();
  assert.ok(value.jobs?.verify, 'AWS verification job must exist');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cloud-aws-workflow-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'bin'));
  await mkdir(join(root, 'deploy/aws'), { recursive: true });
  const files = realGuards ? (await readdir(new URL('.', import.meta.url))).filter(name => name.endsWith('.test.mjs')).sort() : ['fixture.test.mjs'];
  for (const name of files) await writeFile(join(root, 'deploy/aws', name), `import { test } from 'node:test';\ntest(${JSON.stringify(name)}, () => console.log('AWS_FILE ' + ${JSON.stringify(name)}));\n`);
  const probe = `#!${process.execPath}
import { appendFileSync } from 'node:fs';
import { basename } from 'node:path';
import { execFileSync } from 'node:child_process';
const args = process.argv.slice(2);
const command = basename(process.argv[1]);
appendFileSync(process.env.TRACE, JSON.stringify([command, ...args]) + '\\n');
const stage = args[0] === 'scripts/ci-setup-pnpm.mjs' ? 'setup' : command === 'pnpm' ? 'install' : command === 'docker' ? 'format'
  : args.includes('--prepare-tools') ? 'prepare' : args.includes('--all') ? 'suites' : 'guards';
if (${realGuards} && stage === 'guards') {
  execFileSync(${JSON.stringify(process.execPath)}, args, { stdio: 'inherit' });
  process.exit(0);
}
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
      const script = step.run.replaceAll('${{ matrix.shard }}', String(cell.shard));
      await execute('/bin/bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script], {
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
  for (const cell of cells) {
    const baseline = await runCommands(t, '', cell);
    assert.equal(baseline.status, 0);
    assert.deepEqual(baseline.allCalls, [['node', 'scripts/ci-setup-pnpm.mjs'], ...baseline.calls]);
    const refused = await runCommands(t, 'setup', cell);
    assert.equal(refused.status, 7);
    assert.deepEqual(refused.allCalls, [['node', 'scripts/ci-setup-pnpm.mjs']]);
    assert.deepEqual(refused.calls, []);
  }
});

// Execute the workflow's actual shell; replace only the external tool boundary.
test('AWS shell prepares and installs each cell, shards all guards and runs every plan and format once', async t => {
  for (const cell of cells) {
    const { root, status, calls } = await runCommands(t, '', cell);
    assert.equal(status, 0);
    assert.deepEqual(calls, [
      ['node', 'deploy/aws/check.mjs', '--prepare-tools'],
      ['pnpm', '--dir', 'deploy/aws', 'install', '--ignore-workspace', '--frozen-lockfile'],
      ...(cell.shard ? [['node', '--test', '--test-concurrency=1', `--test-shard=${cell.shard}/3`, 'deploy/aws/fixture.test.mjs']] : [
      ['node', 'deploy/aws/check.mjs', '--all'],
      ['docker', 'run', '--rm', '--pull', 'never', '--network', 'none', '--user', '65532:65532',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only',
        '--memory', '256m', '--cpus', '1', '--pids-limit', '32',
        '--mount', `type=bind,source=${root}/deploy/aws,target=/source,readonly`,
        'waitron-cloud-aws-tools:1.13.2-aws6.70.0', 'tofu', 'fmt', '-check', '-recursive', '/source'],
      ]),
    ]);
    if (cell.shard) {
      assert.match(await readFile(join(root, '.aws-check-logs/guards.log'), 'utf8'), /# tests 3\n# pass 3\n# fail 0/);
      await assert.rejects(readFile(join(root, '.aws-check-logs/suites.log')), { code: 'ENOENT' });
      await assert.rejects(readFile(join(root, '.aws-check-logs/format.log')), { code: 'ENOENT' });
    } else {
      assert.match(await readFile(join(root, '.aws-check-logs/suites.log'), 'utf8'), /Success! 2 passed, 0 failed/);
      await assert.rejects(readFile(join(root, '.aws-check-logs/guards.log')), { code: 'ENOENT' });
      assert.equal(await readFile(join(root, '.aws-check-logs/format.log'), 'utf8'), 'format\n');
    }
    for (const stage of ['prepare', 'install']) {
      assert.equal(await readFile(join(root, `.aws-check-logs/${stage}.log`), 'utf8'), `${stage}\n`);
    }
  }
});

test('AWS guard matrix executes every discovered test file exactly once with the real Node runner', async t => {
  const value = await workflow();
  const scheduled = [];
  const expected = (await readdir(new URL('.', import.meta.url))).filter(name => name.endsWith('.test.mjs')).sort();
  for (const cell of value.jobs.verify.strategy.matrix.include) {
    const result = await runCommands(t, '', cell, true);
    assert.equal(result.status, 0);
    if (!cell.shard) continue;
    const log = await readFile(join(result.root, '.aws-check-logs/guards.log'), 'utf8');
    scheduled.push(...[...log.matchAll(/^(?:# )?AWS_FILE (.+)$/gm)].map(match => match[1]));
  }
  assert.deepEqual(scheduled.sort(), expected);
});

for (const [index, stage] of ['prepare', 'install', 'guards', 'suites', 'format'].entries()) {
  test(`AWS shell propagates ${stage} failure through tee and stops later tools`, async t => {
    for (const cell of cells.filter(cell => ['prepare', 'install'].includes(stage) || (cell.shard ? stage === 'guards' : ['suites', 'format'].includes(stage)))) {
      const { root, status, calls } = await runCommands(t, stage, cell);
      assert.equal(status, 7);
      assert.equal(calls.length, index + 1 - (index >= 3 ? 1 : 0));
      assert.ok((await readFile(join(root, `.aws-check-logs/${stage}.log`), 'utf8')).length > 0);
    }
  });
}

test('AWS assertion counts and diagnostics are retained after failure', async () => {
  const value = await workflow();
  assert.ok(value.jobs?.verify, 'AWS verification job must exist');
  const upload = value.jobs.verify.steps.filter(step => step.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(upload.length, 1);
  assert.equal(upload[0].if, '${{ always() }}');
  assert.equal(upload[0].with.name, 'aws-infrastructure-${{ github.event.pull_request.head.sha || github.sha }}-${{ github.run_attempt }}-${{ matrix.cell }}');
  assert.equal(upload[0].with.path, '.aws-check-logs/');
  assert.equal(upload[0].with['include-hidden-files'], true);
  assert.ok(upload[0].with['retention-days'] > 0 && upload[0].with['retention-days'] <= 30);
  assert.equal(upload[0].with['if-no-files-found'], 'error');
  const names = cells.map(cell => upload[0].with.name.replaceAll('${{ matrix.cell }}', cell.cell));
  assert.equal(new Set(names).size, 4);
});
