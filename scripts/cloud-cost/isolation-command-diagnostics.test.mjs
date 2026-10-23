import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Dropping the failed canary's result hides whether isolation or its execution refused.
for (const fault of ['outbound-result', 'outbound-runtime']) test(`failed outbound command retains only safe context: ${fault}`, () => {
  const result = spawnSync(process.execPath, [new URL('./fixtures/stack-startup-diagnostic-probe.mjs', import.meta.url).pathname, fault, 'false'], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.removed, true);
  assert.equal(output.diagnostic.stage, 'isolation');
  assert.equal(output.diagnostic.reason, 'command-exit');
  assert.equal(output.diagnostic.command, 'outbound-canary');
  assert.deepEqual(output.diagnostic.argv, ['exec', '<container>', 'node', '-e', '<outbound-canary>']);
  assert.equal(output.diagnostic.stderr, fault === 'outbound-runtime' ? 'node-runtime' : 'unclassified');
  if (fault === 'outbound-result') assert.deepEqual(output.diagnostic.canary, { blockedConnections: 3, blockedDns: 1, localControl: true });
  else assert.equal(output.diagnostic.canary, undefined);
  assert.equal((result.stdout + result.stderr).includes('PRIVATE_CANARY'), false);
  const report = result.stderr.split('\n').find(line => line.startsWith('stack_startup='));
  assert.deepEqual(JSON.parse(report.slice(14)), output.diagnostic);
  assert.ok(JSON.stringify(output.diagnostic).length < 512);
});

test('a readiness command refusal cannot be reported as a container inspection or outbound canary', () => {
  const result = spawnSync(process.execPath, [new URL('./fixtures/stack-startup-diagnostic-probe.mjs', import.meta.url).pathname, 'readiness-command', 'false'], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.removed, true);
  assert.equal(output.diagnostic.stage, 'readiness');
  assert.equal(output.diagnostic.command, 'readiness-check');
  assert.deepEqual(output.diagnostic.argv, ['exec', '<container>', 'node', '<script>', 'check']);
  assert.equal(output.diagnostic.canary, undefined);
  assert.equal((result.stdout + result.stderr).includes('PRIVATE_CANARY'), false);
});

for (const field of ['connections', 'dns', 'control']) test(`an invalid canary ${field} result stays private and cannot admit the stack`, () => {
  const result = spawnSync(process.execPath, [new URL('./fixtures/stack-startup-diagnostic-probe.mjs', import.meta.url).pathname, 'outbound-invalid-' + field, 'false'], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.removed, true);
  assert.equal(output.diagnostic.reason, 'command-exit');
  assert.equal(output.diagnostic.command, 'outbound-canary');
  assert.equal(output.diagnostic.canary, undefined);
  assert.equal((result.stdout + result.stderr).includes('PRIVATE_CANARY'), false);
});

// Without the fresh read, a cleaned-up stopped container cannot be distinguished from a missing one.
for (const [fault, expected] of [
  ['state-exited', {role:'s3',status:'exited',running:false,exitCode:7,oomKilled:true,dead:false,restarting:false}],
  ['state-missing', {role:'s3',inspection:'missing'}],
  ['state-timeout', {role:'s3',inspection:'timeout'}],
  ['state-throws', {role:'s3',inspection:'unavailable'}],
  ['state-malformed', {role:'s3',inspection:'unavailable'}],
  ['state-private', {role:'s3',inspection:'unavailable'}],
]) test(`failed isolation retains fresh bounded container state before cleanup: ${fault}`, () => {
  const result = spawnSync(process.execPath, [new URL('./fixtures/stack-startup-diagnostic-probe.mjs', import.meta.url).pathname, fault, 'false'], {encoding:'utf8',timeout:15000});
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.diagnostic.stage, 'isolation');
  assert.equal(output.diagnostic.command, 'outbound-canary');
  assert.equal(output.diagnostic.reason, 'command-exit');
  assert.equal(output.diagnostic.exitCode, 1, 'the inspection must preserve the original command failure');
  assert.deepEqual(output.diagnostic.container, expected);
  assert.equal(output.removed, true, 'a diagnostic failure must not prevent owned cleanup');
  assert.ok(output.events.indexOf('state') >= 0);
  assert.ok(output.events.indexOf('state') < output.events.indexOf('report'));
  assert.ok(output.events.indexOf('report') < output.events.indexOf('remove'));
  assert.equal((result.stdout + result.stderr).includes('PRIVATE_CANARY'), false);
  assert.ok(JSON.stringify(output.diagnostic).length < 512);
});
