import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

// Lost stage assignments, raw exception forwarding and cleanup masking must fail these journeys.
function run(fault, cleanupFailure = false) {
  return spawnSync(process.execPath, [new URL('./fixtures/stack-startup-diagnostic-probe.mjs', import.meta.url).pathname, fault, String(cleanupFailure)], {
    encoding: 'utf8', timeout: 15000,
  });
}
for (const [fault, stage, reason] of [
  ['ownership', 'ownership', 'validation'],
  ['plan', 'plan', 'validation'],
  ['config', 'configuration', 'invalid-json'],
  ['runtime', 'runtime-files', 'EEXIST'],
  ['certificate', 'certificate', 'command-exit'],
  ['discovery', 'preexisting-resources', 'command-exit'],
  ['compose', 'compose-up', 'command-exit'],
  ['resources', 'created-resources', 'validation'],
  ['policy', 'container-policy', 'validation'],
  ['isolation', 'isolation', 'validation'],
  ['readiness', 'readiness', 'invalid-json'],
  ['handoff', 'cancellation-handoff', 'validation'],
  ['timeout', 'compose-up', 'ETIMEDOUT'],
  ['missing-docker', 'compose-up', 'ENOENT'],
  ['unclassified', 'compose-up', 'unclassified'],
]) test(`startup retains a safe reason before cleanup: ${fault}`, () => {
  const result = run(fault);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.match(output.message, /Invalid cloud cost local run/);
  assert.ok(output.diagnostic, 'startup must retain its bounded failure diagnostic');
  assert.equal(output.diagnostic.stage, stage);
  assert.equal(output.diagnostic.reason, reason);
  assert.ok(output.diagnostic.elapsedMs >= 0 && output.diagnostic.elapsedMs < 15000);
  assert.ok(JSON.stringify(output.diagnostic).length < 512);
  if (fault === 'certificate') assert.equal(output.diagnostic.exitCode, 7);
  if (['compose', 'discovery'].includes(fault)) assert.equal(output.diagnostic.exitCode, 1);
  assert.ok(result.stderr.includes('stack_startup='), 'report before cleanup even if the caller replaces the error');
  const records = result.stderr.split('\n').filter(l => l.startsWith('stack_startup=')).map(l => JSON.parse(l.slice(14)));
  assert.equal(records[0].stage, stage);
  assert.equal(records[0].reason, reason);
  if (['compose','resources','policy','isolation','readiness','handoff','timeout','missing-docker','unclassified'].includes(fault)) {
    assert.equal(output.removed, true);
    assert.ok(output.events.indexOf('report') < output.events.indexOf('remove'), 'retain failure before cleanup');
  }
  assert.equal((result.stdout + result.stderr).includes('PRIVATE_CANARY'), false);
});
test('cleanup failure cannot replace the original startup failure', () => {
  const result = run('compose', true);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.ok(output.diagnostic, 'startup must retain its bounded failure diagnostic');
  assert.equal(output.diagnostic.stage, 'compose-up');
  assert.equal(output.diagnostic.reason, 'command-exit');
  const records = result.stderr.split('\n').filter(l => l.startsWith('stack_startup=')).map(l => JSON.parse(l.slice(14)));
  assert.deepEqual(records.map(r => r.stage), ['compose-up', 'cleanup']);
  assert.equal(output.diagnostic.cleanupFailed, true);
  assert.equal((result.stdout + result.stderr).includes('PRIVATE_CANARY'), false);
});
test('the successful boundary control still starts and cleans its resources', () => {
  const result = run('success');
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ready, true); assert.equal(output.removed, true);
  assert.equal(result.stderr.includes('stack_startup='), false);
});

test('a reporting exception cannot hide failure or stop cleanup', () => {
  const result = run('reporting');
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.diagnostic.stage, 'compose-up');
  assert.equal(output.removed, true);
  assert.equal((result.stdout + result.stderr).includes('PRIVATE_CANARY'), false);
});
