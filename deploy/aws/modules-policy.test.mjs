import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkSources } from './check.mjs';

const versions = 'terraform { required_providers { aws = { source = "hashicorp/aws", version = "6.70.0" } } }';
const child = `${versions}\ndata "aws_region" "current" {}`;
const parent = `${versions}
provider "aws" { alias = "primary" }
provider "aws" { alias = "backup" }
module "child" { source = "../child"
 providers = { aws = aws.primary, aws.backup = aws.backup }
}`;
const aliasedChild = child.replace('version = "6.70.0"', 'version = "6.70.0", configuration_aliases = [aws.backup]')
  + '\ndata "aws_region" "copy" { provider = aws.backup }';
const checks = `mock_provider "aws" { alias = "primary" }
mock_provider "aws" { alias = "backup" }
run "offline" { command = plan }`;
async function fixture(t, files) {
  const dir = await mkdtemp(join(tmpdir(), 'cloud-aws-modules-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, name)), { recursive: true });
    await writeFile(join(dir, name), text);
  }
  return dir;
}
function tree(config = parent, leaf = aliasedChild, tests = checks) {
  return { 'roots/main.tf': config, 'roots/tests/main.tftest.hcl': tests, 'child/main.tf': leaf };
}

// Failing to traverse child provider maps would either refuse this plan or admit the negative cases below.
test('local module maps resolve default and aliased providers to root mocks', async (t) => {
  await checkSources(await fixture(t, tree()));
});
test('provider maps compose through a nested local module', async (t) => {
  await checkSources(await fixture(t, {
    ...tree(),
    'child/main.tf': aliasedChild + '\nmodule "leaf" { source = "../leaf"\n providers = { aws = aws.backup } }',
    'leaf/main.tf': child,
  }));
});
test('a run can plan a different local module using its own complete mock map', async (t) => {
  const tests = checks.replace('command = plan', 'command = plan\n module { source = "../child" }\n providers = { aws = aws.primary, aws.backup = aws.backup }');
  await checkSources(await fixture(t, tree(parent, aliasedChild, tests)));
});

for (const [name, config, leaf, tests, diagnostic] of [
  ['omitted child alias', parent.replace(', aws.backup = aws.backup', ''), aliasedChild, checks, /aws.backup.*(map|binding)/],
  ['omitted provider map', parent.replace('providers = { aws = aws.primary, aws.backup = aws.backup }', ''), aliasedChild, checks, /aws.*(map|binding)/],
  ['unknown parent alias', parent.replace('aws = aws.primary', 'aws = aws.unknown'), aliasedChild, checks, /aws.unknown.*(parent|declared)/],
  ['unknown child map key', parent.replace('aws.backup = aws.backup', 'aws.backup = aws.backup, aws.typo = aws.primary'), aliasedChild, checks, /aws.typo.*(child|declared)/],
  ['dynamic module map', parent.replace('aws = aws.primary', 'aws = var.binding'), aliasedChild, checks, /provider binding/],
  ['unmocked root alias', parent, aliasedChild, checks.replace('mock_provider "aws" { alias = "backup" }', ''), /aws.backup.*mock/],
  ['child provider source', parent, aliasedChild.replace('hashicorp/aws', 'example.invalid/live/aws'), checks, /provider source/],
  ['child missing source declaration', parent, 'data "aws_region" "current" {}', checks, /undeclared AWS provider source/],
  ['unused run map key', parent, aliasedChild, checks.replace('command = plan', 'command = plan\n providers = { aws.typo = aws.primary }'), /aws.typo.*(run|declared)/],
]) {
  test(`local modules refuse ${name}`, async (t) => {
    await assert.rejects(checkSources(await fixture(t, tree(config, leaf, tests))), diagnostic);
  });
}
for (const [source, diagnostic] of [
  ['../../outside', /module.*source has no configuration/],
  ['git::https://example.invalid/module', /relative local path/],
  ['/tmp/live', /relative local path/],
  ['${var.module}', /dynamic string/],
]) {
  test(`local modules refuse source ${source}`, async (t) => {
    await assert.rejects(checkSources(await fixture(t, tree(parent.replace('../child', source)))), diagnostic);
  });
}
test('local module cycles are refused before execution', async (t) => {
  const leaf = aliasedChild + '\nmodule "parent" { source = "../roots"\n providers = { aws.primary = aws, aws.backup = aws.backup } }';
  await assert.rejects(checkSources(await fixture(t, tree(parent, leaf))), /module.*cycle/);
});
test('a module provider map must be a literal object', async (t) => {
  const config = parent.replace('providers = { aws = aws.primary, aws.backup = aws.backup }', 'providers = var.bindings');
  await assert.rejects(checkSources(await fixture(t, tree(config))), /unsupported provider map/);
});
test('test module selection cannot escape the inspected source tree', async (t) => {
  const tests = checks.replace('command = plan', 'command = plan\n module { source = "../../outside" }');
  await assert.rejects(checkSources(await fixture(t, tree(parent, aliasedChild, tests))), /module.*(source|path)/);
});
test('a child may explicitly bind the parent implicit default to a mock', async (t) => {
  const config = `${versions}\nmodule "child" { source = "../child"\n providers = { aws = aws } }`;
  await checkSources(await fixture(t, tree(config, child, 'mock_provider "aws" {}\nrun "offline" { command = plan }')));
});
test('a resource alias requires a declaration even when a matching mock exists', async (t) => {
  const config = `${versions}\ndata "aws_region" "current" { provider = aws.unknown }`;
  const tests = 'mock_provider "aws" { alias = "unknown" }\nrun "offline" { command = plan }';
  await assert.rejects(checkSources(await fixture(t, { 'canary/main.tf': config, 'canary/tests/main.tftest.hcl': tests })), /aws.unknown.*declared/);
});
test('a run must select exactly one local test module', async (t) => {
  const tests = checks.replace('command = plan', 'command = plan\n module { source = "../child" }\n module { source = "../child" }');
  await assert.rejects(checkSources(await fixture(t, tree(parent, aliasedChild, tests))), /unsupported test module selection/);
});
