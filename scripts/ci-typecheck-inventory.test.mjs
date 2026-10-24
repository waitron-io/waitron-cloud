import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const repository = fileURLToPath(new URL('../', import.meta.url));
const inventoryTest = 'all declared package compiler configurations are included in the consolidated check';
const members = ['packages/account-http', 'packages/backups', 'packages/fiscal-allocation',
  'packages/identity', 'packages/operations', 'packages/registration', 'packages/remote-access',
  'packages/translation', 'packages/ui-smoke', 'apps/portal'];

function workspace(run) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-compiler-inventory-'));
  try {
    for (const path of ['package.json', 'pnpm-workspace.yaml', 'scripts/ci-typecheck.test.mjs',
      ...members.map(member => `${member}/package.json`)]) {
      mkdirSync(dirname(join(root, path)), {recursive: true});
      cpSync(join(repository, path), join(root, path));
    }
    const check = () => {
      const env = {...process.env};
      delete env.NODE_TEST_CONTEXT;
      const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap',
        `--test-name-pattern=^${inventoryTest}$`, 'scripts/ci-typecheck.test.mjs'],
      {cwd: root, env, encoding: 'utf8', timeout: 10_000});
      assert.ifError(result.error);
      return {...result, output: result.stdout + result.stderr};
    };
    run({root, check});
  } finally {rmSync(root, {recursive: true, force: true});}
}

function rejectsWithPackage(check, name) {
  const result = check();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /not ok \d+ - all declared package compiler configurations/);
  assert.ok(result.output.includes(`Unmapped typecheck command in ${name}`), result.output);
  assert.doesNotMatch(result.output, /TypeError/);
}

test('compiler inventory names every package whose typecheck script is missing', () => workspace(({root, check}) => {
  const control = check();
  assert.equal(control.status, 0, control.output);
  assert.match(control.output, /ok \d+ - all declared package compiler configurations/);
  for (const member of members) {
    const path = join(root, member, 'package.json');
    const original = readFileSync(path, 'utf8');
    const manifest = JSON.parse(original);
    delete manifest.scripts.typecheck;
    writeFileSync(path, JSON.stringify(manifest));
    rejectsWithPackage(check, manifest.name);
    writeFileSync(path, original);
  }
  const restored = check();
  assert.equal(restored.status, 0, restored.output);
}));

test('compiler inventory names a package with no scripts object', () => workspace(({root, check}) => {
  const path = join(root, 'packages/account-http/package.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  delete manifest.scripts;
  writeFileSync(path, JSON.stringify(manifest));
  rejectsWithPackage(check, manifest.name);
}));

test('compiler inventory names a package with a non-string typecheck script', () => workspace(({root, check}) => {
  const path = join(root, 'packages/account-http/package.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  manifest.scripts.typecheck = 7;
  writeFileSync(path, JSON.stringify(manifest));
  rejectsWithPackage(check, manifest.name);
}));

test('compiler inventory accepts equivalent --project arguments in every package', () => workspace(({root, check}) => {
  for (const member of members) {
    const path = join(root, member, 'package.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    manifest.scripts.typecheck = manifest.scripts.typecheck.replace('tsc -p ', 'tsc --project ');
    writeFileSync(path, JSON.stringify(manifest));
    const result = check();
    assert.equal(result.status, 0, `${member}: ${result.output}`);
    assert.match(result.output, /ok \d+ - all declared package compiler configurations/);
  }
}));

test('compiler inventory still refuses unknown commands and configurations', () => workspace(({root, check}) => {
  const path = join(root, 'packages/account-http/package.json');
  const original = readFileSync(path, 'utf8');
  const manifest = JSON.parse(original);
  for (const command of ['tsc --build ../../tsconfig.json', 'tsc --project ../../unknown-config.json']) {
    manifest.scripts.typecheck = command;
    writeFileSync(path, JSON.stringify(manifest));
    const result = check();
    assert.equal(result.status, 1, `${command}: ${result.output}`);
    assert.match(result.output, /not ok \d+ - all declared package compiler configurations/);
    assert.ok(result.output.includes(command.includes('--build') ?
      `Unmapped typecheck command in ${manifest.name}` : 'unknown-config.json'), result.output);
  }
  writeFileSync(path, original);
  const restored = check();
  assert.equal(restored.status, 0, restored.output);
}));
