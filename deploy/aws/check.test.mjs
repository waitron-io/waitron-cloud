import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSources } from './check.mjs';

const main = `terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "6.42.0" }
  }
}
data "aws_region" "current" {}
`;
const safe = `mock_provider "aws" {}
run "offline_region" {
  command = plan
  assert {
    condition = data.aws_region.current.name == "eu-south-2"
    error_message = "Region changed"
  }
}
`;
async function fixture(t, { config = main, checks = safe, extra = {} } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'cloud-aws-sources-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'canary/tests'), { recursive: true });
  await writeFile(join(dir, 'canary/main.tf'), config);
  await writeFile(join(dir, 'canary/tests/canary.tftest.hcl'), checks);
  for (const [name, contents] of Object.entries(extra)) await writeFile(join(dir, name), contents);
  return dir;
}

// Removing the explicit-plan guard must admit both unsafe inputs and fail these refusals.
for (const [label, command] of [['apply', 'apply'], ['missing', null]]) {
  test(`rejects_apply_or_missing_command: ${label}`, async (t) => {
    const checks = safe.replace('command = plan', command ? `command = ${command}` : '');
    await assert.rejects(checkSources(await fixture(t, { checks })), /offline_region.*explicit.*plan/);
  });
}
test('rejects_unmocked_alias', async (t) => {
  const config = `${main}\nprovider "aws" { alias = "backup" }\ndata "aws_region" "backup" { provider = aws.backup }`;
  await assert.rejects(checkSources(await fixture(t, { config })), /aws.backup.*mock/);
});
test('rejects_external_execution: provisioner', async (t) => {
  const config = `${main}\nresource "aws_instance" "host" { provisioner "local-exec" { command = "echo forbidden" } }`;
  await assert.rejects(checkSources(await fixture(t, { config })), /provisioner/);
});
test('rejects_external_execution: undeclared external provider', async (t) => {
  const config = `${main}\ndata "external" "program" { program = ["sh", "-c", "echo forbidden"] }`;
  await assert.rejects(checkSources(await fixture(t, { config })), /external|undeclared/);
});
test('ignores_deceptive_comments and quoted syntax', async (t) => {
  const config = `${main}\n# provisioner "local-exec" {}\nlocals { text = "run \\\"fake\\\" { command = apply }"\n note = <<-NOTE\nprovider \\"external\\" { }\ncommand = apply\nNOTE\n}`;
  const checks = `${safe}\n// run "fake" { command = apply }\n`;
  await checkSources(await fixture(t, { config, checks }));
});
test('quoted plan is refused because it is not the command keyword', async (t) => {
  await assert.rejects(checkSources(await fixture(t, { checks: safe.replace('command = plan', 'command = "plan"') })), /explicit.*plan/);
});
test('test provider blocks cannot replace mocks', async (t) => {
  await assert.rejects(checkSources(await fixture(t, { checks: `${safe}\nprovider "aws" { region = "eu-south-2" }` })), /provider.*block/);
});
for (const name of ['canary/main.tofu', 'canary/main.tf.json', 'canary/override.tf', 'canary/host.auto.tfvars', 'canary/tests/canary.tofutest.hcl']) {
  test(`rejects alternative input ${name}`, async (t) => {
    await assert.rejects(checkSources(await fixture(t, { extra: { [name]: name.endsWith('.json') ? '{}' : 'locals { alternative = true }' } })), /unsupported.*file|alternative.*file/);
  });
}
test('rejects symlinks rather than following ambient files', async (t) => {
  const dir = await fixture(t);
  await symlink('/etc/passwd', join(dir, 'canary/escape.tf'));
  await assert.rejects(checkSources(dir), /symlink/);
});

test('rejects alternative JSON OpenTofu precedence', async (t) => {
  await assert.rejects(checkSources(await fixture(t, { extra: { 'canary/main.tofu.json': '{}' } })), /unsupported.*file|alternative.*file/);
});
test('rejects missing provider mock', async (t) => {
  await assert.rejects(checkSources(await fixture(t, { checks: safe.replace('mock_provider "aws" {}', '') })), /aws.*mock/);
});
test('a setup run must also explicitly plan', async (t) => {
  await assert.rejects(checkSources(await fixture(t, { checks: `${safe}\nrun "setup" {}` })), /setup.*explicit.*plan/);
});
test('undeclared provider sources are refused even without resources', async (t) => {
  const config = main.replace('hashicorp/aws', 'example.invalid/untrusted/aws');
  await assert.rejects(checkSources(await fixture(t, { config })), /provider source/);
});
test('literal provider mapping may bind a mocked alias', async (t) => {
  const checks = safe.replace('mock_provider "aws" {}', 'mock_provider "aws" { alias = "backup" }')
    .replace('command = plan', 'command = plan\n providers = { aws = aws.backup }');
  await checkSources(await fixture(t, { checks }));
});
test('dynamic provider binding is refused', async (t) => {
  const checks = safe.replace('command = plan', 'command = plan\n providers = { aws = var.provider }');
  await assert.rejects(checkSources(await fixture(t, { checks })), /provider binding/);
});
test('provider declaration aliases require mocks even if no resource selects them', async (t) => {
  const config = main.replace('version = "6.42.0"', 'version = "6.42.0", configuration_aliases = [aws.backup]');
  await assert.rejects(checkSources(await fixture(t, { config })), /aws.backup.*mock/);
});
test('isolated_invocation uses only a disposable read-only source copy', async (t) => {
  const calls = [];
  const dir = await fixture(t);
  await mkdir(join(dir, '.aws'));
  await writeFile(join(dir, '.aws/credentials'), 'SYNTHETIC_MUST_NOT_COPY');
  await checkSources(dir, { execute: async (file, args, options) => {
    calls.push({ file, args, options });
    if (args[0] !== 'run') throw Object.assign(new Error('absent'), { stderr: `Error: No such container: ${args[2]}` });
    const mount = args[args.indexOf('--mount') + 1];
    const copy = mount.match(/source=([^,]+),/)[1];
    assert.notEqual(copy, dir);
    const { access, readFile } = await import('node:fs/promises');
    await assert.rejects(access(join(copy, 'source/.aws')));
    assert.match(await readFile(join(copy, 'source/canary/main.tf'), 'utf8'), /aws_region/);
    return { stdout: '{"status":"inspected","files":2,"tests":1}\n', stderr: '' };
  } });
  assert.equal(calls.filter(({ args }) => args[0] === 'run').length, 1, 'only the parser container may start');
  assert.deepEqual(calls[1].args.slice(0, 2), ['container', 'inspect']);
  assert.equal(calls.length, 2, 'one parser run and its ownership cleanup check');
  const [{ file, args, options }] = calls;
  assert.equal(file, 'docker');
  for (const [flag, value] of [['--network', 'none'], ['--cap-drop', 'ALL'], ['--pull', 'never'], ['--security-opt', 'no-new-privileges']]) {
    assert.equal(args[args.indexOf(flag) + 1], value, flag);
  }
  assert.ok(args.includes('--read-only'));
  assert.match(args[args.indexOf('--tmpfs') + 1], /^\/tmp:rw,noexec,nosuid,size=64m$/);
  assert.match(args[args.indexOf('--mount') + 1], /target=\/candidate,readonly$/);
  assert.equal(args.filter((arg) => arg === '--mount').length, 1);
  assert.deepEqual(args.slice(-4), ['python', '-I', '/candidate/inspect.py', '/candidate/source']);
  assert.ok(!args.includes('-e') && !args.includes('--env') && !args.includes('--env-file'));
  assert.ok(!args.some((arg) => arg.includes('docker.sock')));
  assert.deepEqual(Object.keys(options.env).sort(), ['HOME', 'PATH']);
  assert.ok(options.timeout > 0 && options.timeout <= 30_000);
});

test('a parser timeout removes only the owned container by its recorded ID', async (t) => {
  const calls = [];
  let ownedName;
  const id = 'a'.repeat(64);
  await assert.rejects(checkSources(await fixture(t), { execute: async (file, args) => {
    calls.push(args);
    if (args[0] === 'run') {
      ownedName = args[args.indexOf('--name') + 1];
      throw new Error('synthetic parser deadline');
    }
    if (args[1] === 'inspect') return { stdout: JSON.stringify([{ Id: id, Config: { Labels: { 'io.waitron.aws-inspection': ownedName } } }]) };
    if (args[1] === 'rm') return { stdout: id };
    throw new Error('unexpected Docker operation');
  } }), /synthetic parser deadline/);
  assert.match(ownedName, /^cloud-aws-inspection-[a-f0-9-]{36}$/);
  assert.deepEqual(calls.at(-1), ['container', 'rm', '--force', id]);
  assert.equal(calls.filter((args) => args[0] === 'run').length, 1);
});
test('cleanup refuses an ownership mismatch', async (t) => {
  const calls = [];
  await assert.rejects(checkSources(await fixture(t), { execute: async (_, args) => {
    calls.push(args);
    if (args[0] === 'run') throw new Error('synthetic parser deadline');
    return { stdout: JSON.stringify([{ Id: 'b'.repeat(64), Config: { Labels: { 'io.waitron.aws-inspection': 'foreign' } } }]) };
  } }), /ownership/);
  assert.ok(!calls.some((args) => args[1] === 'rm'));
});

test('rejects a symlink used as the source root', async (t) => {
  const dir = await fixture(t);
  const link = `${dir}-link`;
  t.after(() => rm(link, { force: true }));
  await symlink(dir, link);
  await assert.rejects(checkSources(link), /symlink/);
});
test('an empty partial backend is allowed and live settings are refused', async (t) => {
  await checkSources(await fixture(t, { config: `${main}\nterraform { backend "s3" {} }` }));
  await assert.rejects(checkSources(await fixture(t, { config: `${main}\nterraform { backend "s3" { bucket = "synthetic-live-state" } }` })), /backend settings/);
});
test('local module execution stays refused until provider maps are qualified', async (t) => {
  await assert.rejects(checkSources(await fixture(t, { config: `${main}\nmodule "network" { source = "../network" }` })), /module execution.*not qualified/);
});

test('invalid entry points refuse combined preparation and suite operations', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  for (const args of [[], ['--prepare-tools', '--suite', 'canary']]) {
    await assert.rejects(promisify(execFile)(process.execPath, [new URL('./check.mjs', import.meta.url).pathname, ...args]),
      (error) => error.code === 1 && /Usage:/.test(error.stderr));
  }
});
