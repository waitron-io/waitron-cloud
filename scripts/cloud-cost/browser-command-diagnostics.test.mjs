import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runBrowserFixture} from './fixtures/browser-diagnostics.mjs';

function command(t, script) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-browser-command-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  // Replace only Docker; the command wrapper and native child failure stay real.
  writeFileSync(join(root, 'docker'), '#!' + process.execPath + '\n' + script, {mode: 0o700});
  return {PATH: root};
}

function refusal(run) {
  let caught;
  assert.throws(run, error => {
    caught = error;
    assert.equal(error.message, 'Generated local gateway fixture failed');
    assert.equal(error.journeyRefused, false);
    assert.equal(error.browserPhase, undefined);
    assert.doesNotMatch(error.stack + JSON.stringify(error), /PRIVATE_CANARY/);
    return true;
  });
  return caught;
}

// Dropping command metadata hides whether startup exited, timed out or was signalled.
test('browser fixture retains a failed gateway start without exposing command arguments or output', t => {
  const env = command(t, "process.stdout.write('éPRIVATE_CANARY'); process.stderr.write('PRIVATE_CANARY'); process.exit(7);");
  const error = refusal(() => runBrowserFixture('docker', ['start', 'PRIVATE_CANARY'], env));
  assert.deepEqual(error.commandFailure, {command: 'docker-start', reason: 'command-exit',
    exitCode: 7, signal: null, stdoutBytes: 16, stderrBytes: 14});
});

test('browser fixture separates another Docker command from container startup', t => {
  const env = command(t, 'process.exit(9);');
  const error = refusal(() => runBrowserFixture('docker', ['inspect', 'PRIVATE_CANARY'], env));
  assert.deepEqual(error.commandFailure, {command: 'docker-other', reason: 'command-exit',
    exitCode: 9, signal: null, stdoutBytes: 0, stderrBytes: 0});
});

test('browser fixture retains native command launch failure without its private path', () => {
  const error = refusal(() => runBrowserFixture('/PRIVATE_CANARY/no-command', [], {}));
  assert.deepEqual(error.commandFailure, {command: 'other', reason: 'ENOENT',
    exitCode: null, signal: null, stdoutBytes: 0, stderrBytes: 0});
});

test('browser fixture distinguishes a signalled gateway start from an ordinary exit', t => {
  const env = command(t, "process.kill(process.pid, 'SIGTERM');");
  const error = refusal(() => runBrowserFixture('docker', ['start', 'PRIVATE_CANARY'], env));
  assert.deepEqual(error.commandFailure, {command: 'docker-start', reason: 'command-exit',
    exitCode: null, signal: 'SIGTERM', stdoutBytes: 0, stderrBytes: 0});
});

test('browser fixture retains the existing thirty-second startup timeout', {timeout: 45000}, t => {
  const env = command(t, "process.stderr.write('PRIVATE_CANARY'); setInterval(() => {}, 1000);");
  const started = performance.now();
  const error = refusal(() => runBrowserFixture('docker', ['start', 'PRIVATE_CANARY'], env));
  assert.ok(performance.now() - started >= 29500, 'the original command budget is retained');
  assert.deepEqual(error.commandFailure, {command: 'docker-start', reason: 'ETIMEDOUT',
    exitCode: null, signal: 'SIGTERM', stdoutBytes: 0, stderrBytes: 14});
});

test('browser fixture reports an output-limit failure with bounded byte counts', t => {
  const env = command(t, "process.stderr.write('PRIVATE_CANARY'); process.stdout.write('x'.repeat(2 * 1048576));");
  const error = refusal(() => runBrowserFixture('docker', ['start', 'PRIVATE_CANARY'], env));
  assert.equal(error.commandFailure?.reason, 'ENOBUFS');
  assert.equal(error.commandFailure.command, 'docker-start');
  assert.equal(error.commandFailure.stdoutBytes, 1048576);
  assert.ok(error.commandFailure.stderrBytes <= 1048576);
  assert.ok(JSON.stringify(error.commandFailure).length < 200);
});

test('browser fixture bounds oversized standard error without exposing its contents', t => {
  const env = command(t, "process.stderr.write('PRIVATE_CANARY'.repeat(150000));");
  const error = refusal(() => runBrowserFixture('docker', ['start', 'PRIVATE_CANARY'], env));
  assert.equal(error.commandFailure?.reason, 'ENOBUFS');
  assert.equal(error.commandFailure.stderrBytes, 1048576);
  assert.equal(error.commandFailure.stdoutBytes, 0);
});

test('browser fixture contains signals outside its fixed diagnostic vocabulary', t => {
  const env = command(t, "process.kill(process.pid, 'SIGUSR2');");
  const error = refusal(() => runBrowserFixture('docker', ['start', 'PRIVATE_CANARY'], env));
  assert.equal(error.commandFailure?.signal, null);
  assert.equal(error.commandFailure.exitCode, null);
});

test('browser fixture keeps genuine journey refusal and child diagnostics alongside command evidence', () => {
  const script = "process.stderr.write('cost_browser_phase=reconnect\\ncost_browser_step=requests\\nError: Invalid cloud cost browser journey\\n'); process.exit(1);";
  assert.throws(() => runBrowserFixture(process.execPath, ['-e', script], {}), error => {
    assert.equal(error.journeyRefused, true);
    assert.equal(error.browserPhase, 'reconnect');
    assert.equal(error.browserStep, 'requests');
    assert.equal(error.commandFailure?.command, 'other');
    assert.equal(error.commandFailure.reason, 'command-exit');
    assert.equal(error.commandFailure.exitCode, 1);
    return true;
  });
});
