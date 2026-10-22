import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, stat, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as aws from './check.mjs';

const run = promisify(execFile);
const image = `sha256:${'a'.repeat(64)}`;
const config = `terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "6.42.0" }
  }
}
locals { candidate = "reviewed" }
data "aws_region" "current" {}
`;
async function fixture(t, suite = 'canary') {
  const repo = await mkdtemp(join(tmpdir(), 'cloud-aws-runner-test-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  await run('git', ['init', '--quiet', repo]);
  const directory = join(repo, 'deploy/aws');
  const paths = suite === 'canary' ? ['canary'] : ['modules/custody', 'modules/workload-permissions', 'fixtures/custody'];
  for (const path of paths) {
    await mkdir(join(directory, path, 'tests'), { recursive: true });
    await writeFile(join(directory, path, 'main.tf'), config);
    await writeFile(join(directory, path, 'tests', `${suite}.tftest.hcl`), 'mock_provider "aws" {}\nrun "reviewed" { command = plan }');
  }
  await run('git', ['-C', repo, 'add', 'deploy/aws']);
  return { repo, directory };
}
function executor(calls, onRun = async () => {}) {
  return async (file, args, options) => {
    calls.push({ file, args, options });
    if (args[0] === 'image') return { stdout: JSON.stringify([{ Id: image }]) };
    if (args[0] === 'container') throw Object.assign(new Error('absent'), { stderr: `Error: No such container: ${args[2]}` });
    assert.equal(args[0], 'run');
    await onRun(args, options);
    return { stdout: 'inspected / suite passed', stderr: '' };
  };
}
const snapshot = (args) => args[args.indexOf('--mount') + 1].match(/source=([^,]+),/)[1];

// Admitting a path as a suite would allow a caller to choose what OpenTofu executes.
test('suite names are closed before any external operation', async () => {
  for (const name of ['../canary', 'apply', 'canary;echo', '', '__proto__']) {
    const calls = [];
    await assert.rejects(aws.runSuite(name, { execute: executor(calls) }), /Unknown infrastructure suite/);
    assert.equal(calls.length, 0);
  }
});
test('missing local tools refuse without a build or download', async (t) => {
  const { directory } = await fixture(t);
  const calls = [];
  await assert.rejects(aws.runSuite('canary', { directory, execute: async (_, args) => {
    calls.push(args);
    throw new Error('No such image');
  } }), /--prepare-tools/);
  assert.deepEqual(calls, [['image', 'inspect', 'waitron-cloud-aws-tools:1.11.0-aws6.42.0']]);
});
test('suite inspects and executes one immutable tracked candidate with no ambient files', async (t) => {
  const { directory } = await fixture(t);
  await writeFile(join(directory, 'canary/ambient.tf'), 'locals { ambient = true }');
  const calls = [];
  const copies = [];
  await aws.runSuite('canary', { directory, execute: executor(calls, async (args) => {
    const copy = snapshot(args);
    copies.push(copy);
    assert.notEqual(copy, directory);
    assert.equal(await readFile(join(copy, 'source/canary/main.tf'), 'utf8'), config);
    await assert.rejects(access(join(copy, 'source/canary/ambient.tf')), { code: 'ENOENT' });
    if (copies.length === 1) await writeFile(join(directory, 'canary/main.tf'), 'locals { candidate = "later edit" }');
    else {
      assert.deepEqual(JSON.parse(await readFile(join(copy, 'suite.json'), 'utf8')), [{ directory: 'canary', filter: 'tests/canary.tftest.hcl' }]);
      assert.ok((await stat(copy)).mode & 0o004, 'unprivileged Linux container can read its source');
    }
  }) });
  assert.equal(copies.length, 2);
  assert.equal(copies[0], copies[1], 'inspection and execution must consume the same snapshot');
  await assert.rejects(access(copies[0]), { code: 'ENOENT' });
  for (const { file, args, options } of calls.filter(({ args }) => args[0] === 'run')) {
    assert.equal(file, 'docker');
    for (const [flag, value] of [['--network', 'none'], ['--pull', 'never'], ['--cap-drop', 'ALL'], ['--security-opt', 'no-new-privileges'], ['--user', '65532:65532']]) {
      assert.equal(args[args.indexOf(flag) + 1], value, flag);
    }
    assert.ok(args.includes('--read-only'));
    const driver = args.at(-1) === '/candidate/run.py';
    for (const [flag, value] of [['--memory', driver ? '1g' : '256m'], ['--cpus', driver ? '2' : '1'], ['--pids-limit', driver ? '128' : '64']]) {
      assert.equal(args[args.indexOf(flag) + 1], value, flag);
    }
    assert.match(args[args.indexOf('--mount') + 1], /target=\/candidate,readonly$/);
    assert.equal(args.filter((arg) => arg === '--mount').length, 1);
    assert.ok(!args.includes('--env') && !args.includes('-e') && !args.includes('--env-file'));
    assert.ok(!args.some((arg) => arg.includes('docker.sock')));
    assert.deepEqual(Object.keys(options.env).sort(), ['HOME', 'PATH']);
    assert.ok(options.timeout > 0 && options.timeout <= 300_000);
    assert.equal(args[args.indexOf('python') - 1], image, 'use the inspected local image ID');
  }
  const suite = calls.filter(({ args }) => args[0] === 'run')[1].args;
  assert.deepEqual(suite.slice(-3), ['python', '-I', '/candidate/run.py']);
  assert.match(suite[suite.indexOf('--tmpfs') + 1], /^\/tmp:rw,noexec,nosuid,size=512m,mode=1777$/);
});

test('invalid local image identity refuses before any container starts', async (t) => {
  const { directory } = await fixture(t);
  for (const records of [[], [{ Id: 'a-tag' }], [{ Id: image }, { Id: image }]]) {
    const calls = [];
    await assert.rejects(aws.runSuite('canary', { directory, execute: async (_, args) => {
      calls.push(args);
      return { stdout: JSON.stringify(records) };
    } }), /--prepare-tools/);
    assert.equal(calls.length, 1);
  }
});

test('real offline driver executes a mocked plan and propagates a failed assertion', async (t) => {
  const { directory } = await fixture(t);
  await writeFile(join(directory, 'canary/main.tf'), `terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "6.42.0" }
  }
}
data "aws_region" "current" {}
`);
  const checks = `mock_provider "aws" {
  mock_data "aws_region" { defaults = { region = "eu-south-2" } }
}
run "offline_region" {
  command = plan
  assert {
    condition = data.aws_region.current.region == "eu-south-2"
    error_message = "Expected the mocked Madrid region"
  }
}
`;
  await writeFile(join(directory, 'canary/tests/canary.tftest.hcl'), checks);
  const output = await aws.runSuite('canary', { directory });
  assert.match(output, /Success! 1 passed, 0 failed/);
  assert.match(output, /init -backend=false -input=false/);
  assert.match(output, /validate -no-color/);
  await writeFile(join(directory, 'canary/tests/canary.tftest.hcl'), checks.replace('== "eu-south-2"', '== "eu-west-3"'));
  await assert.rejects(aws.runSuite('canary', { directory }), /Expected the mocked Madrid region/);
});
test('a refused source snapshot never starts the OpenTofu driver', async (t) => {
  const { directory } = await fixture(t);
  const calls = [];
  await assert.rejects(aws.runSuite('canary', { directory, execute: executor(calls, async () => {
    throw Object.assign(new Error('refusal'), { stderr: 'reviewed requires explicit plan' });
  }) }), /explicit plan/);
  assert.equal(calls.filter(({ args }) => args[0] === 'run').length, 1);
  assert.ok(!calls.some(({ args }) => args.at(-1) === '/candidate/run.py'));
});
test('missing named suite input refuses before parser or OpenTofu runs', async (t) => {
  const { directory } = await fixture(t);
  const calls = [];
  await assert.rejects(aws.runSuite('network', { directory, execute: executor(calls) }), /suite source.*modules\/network/);
  assert.ok(!calls.some(({ args }) => args[0] === 'run'));
});

test('runner retains a staged provider lockfile in the inspected snapshot', async (t) => {
  const { repo, directory } = await fixture(t);
  const lock = `provider "registry.opentofu.org/hashicorp/aws" {
  version = "6.42.0"
  constraints = "6.42.0"
  hashes = [
    "zh:5bcc36226fa5d8a3c37e41ac8cfd2b1eb73e7ae96f8418f6776dcaa16a987198",
    "zh:99564c99a0672b2a8b666ab2040f36a7c6f372fa79ac43a6657a54734e46fff8",
  ]
}
`;
  await writeFile(join(directory, 'canary/.terraform.lock.hcl'), lock);
  await run('git', ['-C', repo, 'add', 'deploy/aws/canary/.terraform.lock.hcl']);
  await aws.checkSources(directory, { trackedOnly: true });
  await aws.runSuite('canary', { directory, execute: executor([], async (args) => {
    assert.equal(await readFile(join(snapshot(args), 'source/canary/.terraform.lock.hcl'), 'utf8'), lock);
  }) });
});

test('canary CLI runs the checked-in mocked region assertion', async () => {
  const { stdout } = await run(process.execPath, [new URL('./check.mjs', import.meta.url).pathname, '--suite', 'canary'], { timeout: 30_000 });
  assert.match(stdout, /Success! 1 passed, 0 failed/);
  assert.match(stdout, /offline_region/);
});

for (const [label, declaration] of [
  ['wrong provider', 'provider "example.invalid/untrusted/aws" { version = "6.42.0"\n hashes = ["zh:' + 'a'.repeat(64) + '"] }'],
  ['wrong version', 'provider "registry.opentofu.org/hashicorp/aws" { version = "6.41.0"\n hashes = ["zh:' + 'a'.repeat(64) + '"] }'],
  ['empty checksums', 'provider "registry.opentofu.org/hashicorp/aws" { version = "6.42.0"\n hashes = [] }'],
  ['wrong constraints', 'provider "registry.opentofu.org/hashicorp/aws" { version = "6.42.0"\n constraints = ">= 6.42.0"\n hashes = ["zh:' + 'a'.repeat(64) + '"] }'],
  ['unsupported fields', 'provider "registry.opentofu.org/hashicorp/aws" { version = "6.42.0"\n alias = "hidden"\n hashes = ["zh:' + 'a'.repeat(64) + '"] }'],
  ['malformed checksum', 'provider "registry.opentofu.org/hashicorp/aws" { version = "6.42.0"\n hashes = ["unchecked"] }'],
  ['multiple providers', 'provider "registry.opentofu.org/hashicorp/aws" { version = "6.42.0"\n hashes = ["zh:' + 'a'.repeat(64) + '"] }\nprovider "registry.opentofu.org/hashicorp/other" { version = "1.0.0" }'],
  ['unexpected block', 'run "hidden" { command = apply }'],
]) {
  test(`provider lock refuses ${label} before OpenTofu`, async (t) => {
    const { repo, directory } = await fixture(t);
    await writeFile(join(directory, 'canary/.terraform.lock.hcl'), declaration);
    await run('git', ['-C', repo, 'add', 'deploy/aws/canary/.terraform.lock.hcl']);
    const commands = [];
    await assert.rejects(aws.runSuite('canary', { directory, execute: async (file, args, options) => {
      commands.push(args);
      return run(file, args, options);
    } }), /provider lock/);
    assert.equal(commands.filter((args) => args.at(-1) === '/candidate/run.py').length, 0);
  });
}
test('custody suite includes the module, attachments and composed fixture', async (t) => {
  const { directory } = await fixture(t, 'custody');
  await aws.runSuite('custody', { directory, execute: executor([], async (args) => {
    if (args.at(-1) !== '/candidate/run.py') return;
    assert.deepEqual(JSON.parse(await readFile(join(snapshot(args), 'suite.json'), 'utf8')), [
      { directory: 'modules/custody', filter: 'tests/custody.tftest.hcl' },
      { directory: 'modules/workload-permissions', filter: 'tests/custody.tftest.hcl' },
      { directory: 'fixtures/custody', filter: 'tests/custody.tftest.hcl' },
    ]);
  }) });
});

test('a driver timeout collects only its owned container and removes its source copy', async (t) => {
  const { directory } = await fixture(t);
  const calls = [];
  let name, copy;
  const id = 'd'.repeat(64);
  await assert.rejects(aws.runSuite('canary', { directory, execute: async (_, args) => {
    calls.push(args);
    if (args[0] === 'image') return { stdout: JSON.stringify([{ Id: image }]) };
    if (args[0] === 'run') {
      if (args.at(-1) === '/candidate/run.py') {
        name = args[args.indexOf('--name') + 1];
        copy = snapshot(args);
        throw new Error('synthetic driver timeout');
      }
      return { stdout: '{}' };
    }
    if (args[1] === 'inspect' && args[2] === name) return { stdout: JSON.stringify([{ Id: id, Config: { Labels: { 'io.waitron.aws-inspection': name } } }]) };
    if (args[1] === 'rm') return { stdout: id };
    throw Object.assign(new Error('absent'), { stderr: `Error: No such container: ${args[2]}` });
  } }), /synthetic driver timeout/);
  assert.match(name, /^cloud-aws-suite-[a-f0-9-]{36}$/);
  assert.deepEqual(calls.at(-1), ['container', 'rm', '--force', id]);
  await assert.rejects(access(copy), { code: 'ENOENT' });
});

test('all CLI refuses an incomplete suite set after reporting only completed tests', async (t) => {
  const { directory } = await fixture(t);
  for (const name of ['check.mjs', 'tools.mjs', 'run.py', 'inspect.py']) {
    await writeFile(join(directory, name), await readFile(new URL(name, import.meta.url)));
  }
  await assert.rejects(run(process.execPath, [join(directory, 'check.mjs'), '--all'], { timeout: 30_000 }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Missing infrastructure suite source: modules\/accounts/);
    assert.match(error.stdout, /Success! 1 passed, 0 failed/);
    return true;
  });
});

for (const [label, checks] of [
  ['apply', 'mock_provider "aws" {}\nrun "unsafe" { command = apply }'],
  ['missing command', 'mock_provider "aws" {}\nrun "unsafe" {}'],
  ['missing mock', 'run "unsafe" { command = plan }'],
]) {
  test(`real suite refuses ${label} before starting OpenTofu`, async (t) => {
    const { directory } = await fixture(t);
    await writeFile(join(directory, 'canary/tests/canary.tftest.hcl'), checks);
    const commands = [];
    await assert.rejects(aws.runSuite('canary', { directory, execute: async (file, args, options) => {
      commands.push(args);
      return run(file, args, options);
    } }), /explicit keyword plan|missing mock/);
    assert.ok(!commands.some((args) => args.at(-1) === '/candidate/run.py'));
  });
}

test('suite container has no raw route to an external non-AWS HTTPS address', async (t) => {
  const { directory } = await fixture(t);
  let proof;
  const output = await aws.runSuite('canary', { directory, execute: async (file, args, options) => {
    if (args[0] === 'run' && args.at(-1) === '/candidate/run.py') {
      const code = `import socket,os,json
try:
 socket.create_connection(('1.1.1.1',443),1)
 raise RuntimeError('unexpected external route')
except OSError as e:
 print(json.dumps({'uid':os.getuid(),'errno':e.errno}))
`;
      const probe = await run(file, [...args.slice(0, -3), 'python', '-I', '-c', code], options);
      proof = JSON.parse(probe.stdout);
    }
    return run(file, args, options);
  } });
  assert.deepEqual(proof, { uid: 65532, errno: 101 });
  assert.match(output, /Success! 1 passed, 0 failed/);
});

test('driver command boundary clears ambient settings, disables backends and stops on failure', async (t) => {
  const { repo, directory } = await fixture(t);
  await chmod(repo, 0o755);
  const tool = join(repo, 'record-tofu');
  const stub = (fail) => `#!/usr/local/bin/python
import json, os, sys
print("TOOL_CALL " + json.dumps({"args":sys.argv[1:], "env":dict(os.environ)}), flush=True)
sys.exit(7 if ${fail ? 'True' : 'False'} and sys.argv[1] == "validate" else 0)
`;
  await writeFile(tool, stub(false), { mode: 0o755 });
  const outputs = [];
  const execute = async (file, args, options) => {
    if (args[0] === 'run' && args.at(-1) === '/candidate/run.py') {
      const index = args.indexOf('python') - 1;
      const observe = `import subprocess,runpy,json
original = subprocess.run
def observe(*args,**kwargs):
 print('COMMAND_DEADLINE '+json.dumps(kwargs.get('timeout')),flush=True)
 return original(*args,**kwargs)
subprocess.run = observe
runpy.run_path('/candidate/run.py',run_name='__main__')
`;
      args = [...args.slice(0, index), '--env', 'TF_CLI_ARGS=ambient-must-not-enter', '--mount', `type=bind,source=${tool},target=/opt/software/bin/tofu,readonly`, args[index], 'python', '-I', '-c', observe];
    }
    try {
      const result = await run(file, args, options);
      outputs.push(result.stdout);
      return result;
    } catch (error) {
      outputs.push(error.stdout ?? '');
      throw error;
    }
  };
  const output = await aws.runSuite('canary', { directory, execute });
  assert.deepEqual(output.split('\n').filter((line) => line.startsWith('COMMAND_DEADLINE ')).map((line) => JSON.parse(line.slice(17))), [90, 90, 90]);
  const calls = output.split('\n').filter((line) => line.startsWith('TOOL_CALL ')).map((line) => JSON.parse(line.slice(10)));
  assert.deepEqual(calls.map(({ args }) => args), [
    ['init', '-backend=false', '-input=false', '-no-color'],
    ['validate', '-no-color'],
    ['test', '-filter=tests/canary.tftest.hcl', '-no-color'],
  ]);
  for (const { env } of calls) {
    assert.match(env.HOME, /^\/tmp\/cloud-aws-/);
    assert.deepEqual(env, {
      PATH: '/opt/software/bin:/usr/local/bin:/usr/bin:/bin', HOME: env.HOME,
      TF_CLI_CONFIG_FILE: '/opt/test-cli.tfrc', TF_IN_AUTOMATION: '1', CHECKPOINT_DISABLE: '1',
      AWS_EC2_METADATA_DISABLED: 'true', AWS_SHARED_CREDENTIALS_FILE: '/dev/null', AWS_CONFIG_FILE: '/dev/null',
      LC_CTYPE: 'C.UTF-8',
    });
  }
  await writeFile(tool, stub(true));
  outputs.length = 0;
  await assert.rejects(aws.runSuite('canary', { directory, execute }), /exit status 7/);
  const failedCalls = outputs.join('\n').split('\n').filter((line) => line.startsWith('TOOL_CALL ')).map((line) => JSON.parse(line.slice(10)));
  assert.deepEqual(failedCalls.map(({ args }) => args[0]), ['init', 'validate']);
});
