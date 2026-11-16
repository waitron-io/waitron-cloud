import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {promisify} from 'node:util';
import test from 'node:test';
import * as diagnostics from './docker-stall-diagnostics.mjs';

function capture(t, failedProbes = false) {
  const lines = [];
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', {value: 'linux'});
  t.after(() => {Object.defineProperty(process, 'platform', platform); t.mock.restoreAll(); syncBuiltinESMExports();});
  const environment = {...process.env};
  t.after(() => {process.env = environment;});
  process.env.GITHUB_ACTIONS = 'true'; process.env.RUNNER_ENVIRONMENT = 'github-hosted';
  t.mock.method(console, 'error', line => lines.push(line));
  t.mock.method(cp, 'execFileSync', (command, args, options) => {
    assert(lines[0]?.startsWith('docker_build_failure='), 'original failure must precede probes');
    assert.equal(options.timeout, 1000); assert.equal(options.killSignal, 'SIGKILL');
    assert.equal(options.maxBuffer, command === 'docker' ? 2048 : 4096);
    if (failedProbes) throw Object.assign(Error('PRIVATE_PROBE_ERROR'), {status: 9});
    return command === 'docker' ? '29.9.3' : command === 'curl' ? 'OK'
      : 'Id=docker.service\nActiveState=active\nMainPID=123\nPrivate=PRIVATE_PROBE_OUTPUT';
  });
  syncBuiltinESMExports();
  return lines;
}

test('synchronous build timeout retains bounded progress before bounded service samples', t => {
  let error;
  try {cp.execFileSync(process.execPath, ['-e', "process.stderr.write('discarded-head'+'é'.repeat(10000)+'\\n#7 registry-tail');setInterval(()=>{},1000)"], {encoding: 'utf8', timeout: 1000, stdio: ['pipe', 'pipe', 'pipe']});}
  catch (failure) {error = failure;}
  assert.equal(error.code, 'ETIMEDOUT');
  const lines = capture(t);
  assert.equal(typeof diagnostics.reportDockerBuildFailure, 'function');
  diagnostics.reportDockerBuildFailure({command: ['docker', 'build', '--progress=plain', '.'], elapsedMs: 120001, error});
  const report = JSON.parse(lines[0].slice('docker_build_failure='.length)), sample = JSON.parse(lines[1].slice('docker_stall='.length));
  assert.deepEqual(report.command, ['docker', 'build', '--progress=plain', '.']);
  assert.equal(report.elapsedMs, 120001); assert.equal(report.code, 'ETIMEDOUT');
  assert.equal(report.status, error.status); assert.equal(report.signal, 'SIGTERM');
  assert.match(report.stderrTail, /#7 registry-tail/); assert(!report.stderrTail.includes('discarded-head')); assert(Buffer.byteLength(report.stderrTail) <= 8192);
  assert.equal(sample.operation, 'build'); assert.equal(sample.daemon.status, 'responsive');
  assert.equal(sample.service.units['docker.service'].MainPID, 123); assert.equal(sample.socket.status, 'responsive');
  assert(sample.host.totalMemoryBytes > 0); assert.doesNotMatch(lines.join('\n'), /PRIVATE_PROBE/);
});

test('promisified build exit 255 keeps its actual error fields when every service probe fails', async t => {
  let error;
  try {await promisify(cp.execFile)(process.execPath, ['-e', "process.stderr.write('#9 worker-refused');process.exit(255)"], {timeout: 120000});}
  catch (failure) {error = failure;}
  assert.equal(error.code, 255);
  const lines = capture(t, true);
  assert.equal(typeof diagnostics.reportDockerBuildFailure, 'function');
  assert.doesNotThrow(() => diagnostics.reportDockerBuildFailure({command: ['docker', 'build', '.'], elapsedMs: 121027, error}));
  const report = JSON.parse(lines[0].slice('docker_build_failure='.length)), sample = JSON.parse(lines[1].slice('docker_stall='.length));
  assert.equal(report.code, 255); assert.equal(report.killed, false); assert.equal(report.signal, null);
  assert.equal(report.stderrTail, '#9 worker-refused'); assert.equal(sample.operation, 'build');
  for (const probe of [sample.daemon, sample.service, sample.socket]) assert.equal(probe.status, 'exit-error');
  assert.doesNotMatch(lines.join('\n'), /PRIVATE_PROBE|ETIMEDOUT/);
});
