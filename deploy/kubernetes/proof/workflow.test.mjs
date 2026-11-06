import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const workflow = readFileSync(new URL('../../../.github/workflows/kubernetes-proof.yml', import.meta.url), 'utf8');
const block = workflow.split('          set -euo pipefail\n')[1].split('      - name:')[0];
const script = 'set -euo pipefail\n' + block.split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');
const files = ['deploy/kubernetes/proof/setup.test.mjs', 'deploy/kubernetes/proof/expiry.test.mjs',
  'scripts/kubernetes-proof-budget.mjs', 'scripts/kubernetes-proof-budget.test.mjs', 'deploy/kubernetes/proof/workflow.test.mjs'];

for (const [label, missing, expectedTests] of [
  ['current complete head', [], 4],
  ['older unrelated head', files.slice(2), 2],
  ['missing budget test', [files[3]], null],
  ['missing budget module', [files[2]], null],
  ['missing workflow test', [files[4]], null],
  ['workflow test without budget', [files[2], files[3]], null],
  ['missing setup test', [files[0]], null],
  ['missing expiry test', [files[1]], null],
]) test(`prerequisite workflow ${label} ${expectedTests ? 'executes its required files' : 'refuses before accepting results'}`, () => {
  const root = mkdtempSync(join(tmpdir(), 'd570-workflow-files-'));
  try {
    for (const file of files.filter(file => !missing.includes(file))) {
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
});
