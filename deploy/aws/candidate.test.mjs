import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, readdir, access, writeFile, rm, symlink, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSources } from './check.mjs';

const run = promisify(execFile);
async function fixture(t) {
  const repo = await mkdtemp(join(tmpdir(), 'cloud-aws-candidate-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  await run('git', ['init', '--quiet', repo]);
  const aws = join(repo, 'deploy/aws');
  await mkdir(join(aws, 'canary/tests'), { recursive: true });
  await writeFile(join(repo, '.gitignore'), '.aws/\n.terraform/\n*.ignored.tf\n');
  await writeFile(join(aws, 'canary/main.tf'), 'locals { candidate = "staged" }\n');
  await writeFile(join(aws, 'canary/tests/canary.tftest.hcl'), 'run "candidate" { command = plan }\n');
  await run('git', ['-C', repo, 'add', '.gitignore', 'deploy/aws']);
  return { repo, aws };
}
async function inspectCopy(aws, inspect) {
  let copy;
  await checkSources(aws, { trackedOnly: true, execute: async (_, args) => {
    if (args[0] !== 'run') throw Object.assign(new Error('absent'), { stderr: `Error: No such container: ${args[2]}` });
    copy = args[args.indexOf('--mount') + 1].match(/source=([^,]+),/)[1];
    await inspect(join(copy, 'source'));
    return { stdout: '{}', stderr: '' };
  } });
  await assert.rejects(access(copy), { code: 'ENOENT' }, 'candidate copy must be removed');
}

// Copying ambient source files would feed unreviewed or ignored configuration into the offline suite.
test('tracked candidate excludes untracked and ignored HCL while retaining staged additions', async (t) => {
  const { aws } = await fixture(t);
  await writeFile(join(aws, 'canary/ambient.tf'), 'locals { ambient = true }');
  await writeFile(join(aws, 'canary/secret.ignored.tf'), 'locals { ambient = true }');
  for (const dir of ['.aws', '.terraform']) {
    await mkdir(join(aws, dir));
    await writeFile(join(aws, dir, 'ambient.tf'), 'locals { ambient = true }');
  }
  await inspectCopy(aws, async (copy) => {
    assert.deepEqual((await readdir(join(copy, 'canary'))).sort(), ['main.tf', 'tests']);
    assert.deepEqual(await readdir(copy), ['canary']);
    assert.equal(await readFile(join(copy, 'canary/main.tf'), 'utf8'), 'locals { candidate = "staged" }\n');
  });
});
test('tracked candidate includes tracked edits and respects staged deletion', async (t) => {
  const { repo, aws } = await fixture(t);
  await writeFile(join(aws, 'canary/main.tf'), 'locals { candidate = "edited" }\n');
  await run('git', ['-C', repo, 'rm', '--cached', 'deploy/aws/canary/tests/canary.tftest.hcl']);
  await inspectCopy(aws, async (copy) => {
    assert.equal(await readFile(join(copy, 'canary/main.tf'), 'utf8'), 'locals { candidate = "edited" }\n');
    await assert.rejects(access(join(copy, 'canary/tests/canary.tftest.hcl')), { code: 'ENOENT' });
  });
});
test('a tracked candidate ignores untracked symlinks without inspecting their targets', async (t) => {
  const { aws } = await fixture(t);
  await symlink('/etc/passwd', join(aws, 'canary/ambient.tf'));
  await inspectCopy(aws, async (copy) => {
    await assert.rejects(access(join(copy, 'canary/ambient.tf')), { code: 'ENOENT' });
  });
});
test('tracked candidate refuses indexed source symlinks before any container starts', async (t) => {
  const { repo, aws } = await fixture(t);
  await symlink('/etc/passwd', join(aws, 'canary/escape.tf'));
  await run('git', ['-C', repo, 'add', 'deploy/aws/canary/escape.tf']);
  let invoked = false;
  await assert.rejects(checkSources(aws, { trackedOnly: true, execute: async () => { invoked = true; } }), /symlink|source mode/);
  assert.equal(invoked, false);
});
test('tracked candidate refuses a symlink replacing an indexed directory', async (t) => {
  const { aws } = await fixture(t);
  await rename(join(aws, 'canary'), join(aws, 'outside'));
  await symlink('outside', join(aws, 'canary'));
  let invoked = false;
  await assert.rejects(checkSources(aws, { trackedOnly: true, execute: async () => { invoked = true; } }), /symlink/);
  assert.equal(invoked, false);
});
test('tracked candidate refuses an arbitrary non-Git source directory before container start', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'cloud-aws-non-git-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let invoked = false;
  await assert.rejects(checkSources(dir, { trackedOnly: true, execute: async (_, args) => {
    invoked = true;
    if (args[0] !== 'run') throw Object.assign(new Error('absent'), { stderr: `Error: No such container: ${args[2]}` });
    return { stdout: '{}' };
  } }), /Git|repository/);
  assert.equal(invoked, false);
});
test('tracked candidate refuses another directory in the same repository', async (t) => {
  const { repo } = await fixture(t);
  await assert.rejects(checkSources(repo, { trackedOnly: true }), /repository deploy\/aws/);
});
test('tracked candidate refuses an unsupported indexed filename', async (t) => {
  const { repo, aws } = await fixture(t);
  await writeFile(join(aws, 'canary/ambiguous name.tf'), 'locals { value = true }');
  await run('git', ['-C', repo, 'add', 'deploy/aws/canary/ambiguous name.tf']);
  await assert.rejects(checkSources(aws, { trackedOnly: true }), /indexed source path/);
});
test('tracked candidate bounds source file size before a container starts', async (t) => {
  const { aws } = await fixture(t);
  await writeFile(join(aws, 'canary/main.tf'), '#'.repeat(1024 * 1024 + 1));
  let invoked = false;
  await assert.rejects(checkSources(aws, { trackedOnly: true, execute: async () => { invoked = true; } }), /indexed source file/);
  assert.equal(invoked, false);
});
test('tracked alternative inputs remain visible for the parser to refuse', async (t) => {
  const { repo, aws } = await fixture(t);
  await writeFile(join(aws, 'canary/config.auto.tfvars'), 'region = "eu-south-2"');
  await run('git', ['-C', repo, 'add', 'deploy/aws/canary/config.auto.tfvars']);
  await inspectCopy(aws, async (copy) => {
    assert.equal(await readFile(join(copy, 'canary/config.auto.tfvars'), 'utf8'), 'region = "eu-south-2"');
  });
});
test('tracked candidate refuses unresolved index conflicts', async (t) => {
  const { repo, aws } = await fixture(t);
  const path = 'deploy/aws/canary/main.tf';
  const { stdout } = await run('git', ['-C', repo, 'rev-parse', `:${path}`]);
  const blob = stdout.trim();
  await new Promise((resolve, reject) => {
    const child = execFile('git', ['-C', repo, 'update-index', '--index-info'], (error) => error ? reject(error) : resolve());
    child.stdin.end(`0 ${'0'.repeat(40)}\t${path}\n100644 ${blob} 1\t${path}\n100644 ${blob} 2\t${path}\n`);
  });
  let invoked = false;
  await assert.rejects(checkSources(aws, { trackedOnly: true, execute: async () => { invoked = true; } }), /Git source conflict/);
  assert.equal(invoked, false);
});
test('indexed symlink metadata is refused even when its working file became regular', async (t) => {
  const { repo, aws } = await fixture(t);
  const path = join(aws, 'canary/indexed.tf');
  await symlink('/etc/passwd', path);
  await run('git', ['-C', repo, 'add', 'deploy/aws/canary/indexed.tf']);
  await rm(path);
  await writeFile(path, 'locals { indexed = true }');
  let invoked = false;
  await assert.rejects(checkSources(aws, { trackedOnly: true, execute: async (_, args) => {
    invoked = true;
    if (args[0] !== 'run') throw Object.assign(new Error('absent'), { stderr: `Error: No such container: ${args[2]}` });
    return { stdout: '{}' };
  } }), /Indexed source mode/);
  assert.equal(invoked, false);
});
test('real parser checks the Git candidate while an ambient apply test stays outside it', async (t) => {
  const { aws } = await fixture(t);
  await writeFile(join(aws, 'canary/main.tf'), `terraform { required_providers { aws = { source = "hashicorp/aws", version = "6.70.0" } } }
data "aws_region" "current" {}`);
  await writeFile(join(aws, 'canary/tests/canary.tftest.hcl'), 'mock_provider "aws" {}\nrun "candidate" { command = plan }');
  await writeFile(join(aws, 'canary/tests/ambient.tftest.hcl'), 'run "ambient" { command = apply }');
  await checkSources(aws, { trackedOnly: true });
  await assert.rejects(checkSources(aws), /ambient.*explicit.*plan/);
});
