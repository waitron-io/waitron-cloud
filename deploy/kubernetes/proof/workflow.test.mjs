import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, matchesGlob } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const workflow = readFileSync(new URL('../../../.github/workflows/kubernetes-proof.yml', import.meta.url), 'utf8');
const block = workflow.split('          set -euo pipefail\n')[1].split('      - name:')[0];
const script = 'set -euo pipefail\n' + block.split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');
const files = ['deploy/kubernetes/proof/setup.test.mjs', 'deploy/kubernetes/proof/expiry.test.mjs',
  'scripts/kubernetes-proof-budget.mjs', 'scripts/kubernetes-proof-budget.test.mjs', 'deploy/kubernetes/proof/workflow.test.mjs',
  'deploy/kubernetes/proof/bootstrap.mjs', 'deploy/kubernetes/proof/bootstrap.sh', 'deploy/kubernetes/proof/bootstrap.test.mjs'];

for (const [label, missing, expectedTests] of [
  ['current complete head', [], 5],
  ['older unrelated head', files.slice(2), 2],
  ['missing budget test', [files[3]], null],
  ['missing budget module', [files[2]], null],
  ['missing workflow test', [files[4]], null],
  ['workflow test without budget', [files[2], files[3]], null],
  ['missing setup test', [files[0]], null],
  ['missing expiry test', [files[1]], null],
  ['missing bootstrap module', [files[5]], null],
  ['missing bootstrap shell', [files[6]], null],
  ['missing bootstrap test', [files[7]], null],
  ['older budget-only head', files.slice(5), 4],
]) test(`prerequisite workflow ${label} ${expectedTests ? 'executes its required files' : 'refuses before accepting results'}`, () => {
  checkFiles(missing, expectedTests);
});

const priceFiles = ['deploy/kubernetes/proof/prices.mjs', 'deploy/kubernetes/proof/prices.test.mjs', 'deploy/kubernetes/proof/test-fixtures/prices.json'];
for (const [label, missing, expectedTests] of [
  ['complete price inputs', [], 6],
  ['missing price module', [priceFiles[0]], null],
  ['missing price test', [priceFiles[1]], null],
  ['missing price fixture', [priceFiles[2]], null],
]) test(`prerequisite workflow ${label}`, () => checkFiles(missing, expectedTests, priceFiles));

const controlFiles = ['scripts/kubernetes-proof-control.mjs', 'scripts/kubernetes-proof-control.test.mjs'];
for (const [label, missing, expectedTests] of [
  ['complete manual controller', [], 6],
  ['missing controller module', [controlFiles[0]], null],
  ['missing controller test', [controlFiles[1]], null],
]) test(`prerequisite workflow ${label}`, () => checkFiles(missing, expectedTests, controlFiles));

function checkFiles(missing, expectedTests, extra = []) {
  const root = mkdtempSync(join(tmpdir(), 'd570-workflow-files-'));
  try {
    for (const file of [...files, ...extra].filter(file => !missing.includes(file))) {
      mkdirSync(join(root, file, '..'), { recursive: true });
      writeFileSync(join(root, file), file.endsWith('.test.mjs') ? `import { test } from 'node:test'; test(${JSON.stringify(file)}, () => {});\n` : 'export const synthetic = true;\n');
    }
    const env = { ...process.env, RUNNER_TEMP: root }; delete env.NODE_TEST_CONTEXT;
    const result = spawnSync('bash', ['-c', script], { cwd: root, encoding: 'utf8', timeout: 10000,
      env });
    assert.ifError(result.error);
    if (expectedTests) { assert.equal(result.status, 0, result.stdout + result.stderr); assert.match(result.stdout, new RegExp(`^# tests ${expectedTests}$`, 'm')); }
    else assert.notEqual(result.status, 0, 'a missing explicitly required file must fail the workflow');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// Evaluate the declared path filters for both event types, independently of the unit-test shell.
test('prerequisite pushes and PRs select only their proof inputs', () => {
  const triggers = /^on:\n([\s\S]*?)(?=^\S)/m.exec(workflow)[1];
  for (const event of ['push', 'pull_request']) {
    const eventBlock = new RegExp(`^  ${event}:\\n([\\s\\S]*?)(?=^  [a-z_]+:|$(?![\\s\\S]))`, 'm').exec(triggers)[1];
    const paths = [...eventBlock.matchAll(/^      - '([^']+)'$/gm)].map(match => match[1]);
    for (const [file, expected] of [
      ['deploy/kubernetes/proof/setup.yaml', true], ['deploy/kubernetes/proof/test-fixtures/prices.json', true],
      ['scripts/kubernetes-proof-budget.mjs', true], ['scripts/kubernetes-proof-budget.test.mjs', true],
      ['scripts/kubernetes-proof-control.mjs', true], ['scripts/kubernetes-proof-control.test.mjs', true],
      ['.github/workflows/kubernetes-proof.yml', true], ['docs/backlog.md', false],
      ['packages/registration/src/signup.ts', false], ['deploy/aws/main.tf', false], ['package.json', false],
    ]) assert.equal(paths.length === 0 || paths.some(pattern => matchesGlob(file, pattern)), expected, `${event}: ${file}`);
  }
});
