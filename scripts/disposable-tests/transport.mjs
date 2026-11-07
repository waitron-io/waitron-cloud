import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {createReadStream, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';


const observedSinks = new WeakSet();
const failedSinks = new WeakSet();
export function protectOutputStreams() {
  for (const sink of [process.stdout, process.stderr]) if (!observedSinks.has(sink)) {
    observedSinks.add(sink);
    sink.on('error', () => failedSinks.add(sink));
  }
}
function writeOutput(sink, data) {
  if (failedSinks.has(sink) || sink.destroyed) return;
  try { sink.write(data); } catch { failedSinks.add(sink); }
}

const sshWrapper = new URL('../../deploy/disposable-tests/ssh.sh', import.meta.url).pathname;
const bundleScript = new URL('./bundle.py', import.meta.url).pathname;

export class SSHTransport {
  constructor({host, recipe, source, privatePackage}) {
    assert.ok(typeof host === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9.:-]*$/.test(host), 'Invalid trusted host');
    assert.ok(typeof recipe === 'string' && /^\/opt\/waitron-disposable-[a-zA-Z0-9_-]+$/.test(recipe), 'Invalid trusted recipe path');
    Object.assign(this, {host, recipe, source, privatePackage});
  }
  async remote(mode, lease, options = {}) {
    assert.ok(['health', 'transfer', 'prepare', 'execute-v2', 'result', 'destroy', 'inspect'].includes(mode), 'Invalid transport operation');
    const resource = lease?.resourceId;
    if (mode !== 'health') assert.ok(/^dt-[A-Za-z0-9][A-Za-z0-9_-]{0,63}-0-[1-9][0-9]{0,14}$/.test(resource), 'Invalid transport resource');
    return runProcess('bash', [sshWrapper, this.host,
      `python3 -B ${this.recipe}/session.py ${mode}${resource ? ' '+resource : ''}`], options);
  }
  async healthy({signal}) {
    const result = await this.remote('health', null, {signal, capture: true});
    return result.code === 0 && JSON.parse(result.stdout).healthy === true;
  }
  async transfer(lease, {signal}) {
    const directory = mkdtempSync(join(tmpdir(), 'disposable-transfer-'));
    try {
      const bundle = join(directory, 'bundle.tar');
      const {resourceId, snapshot, argv, deadline} = lease;
      const result = await runProcess('python3', ['-I', '-B', bundleScript, this.source, this.privatePackage, bundle],
        {input: JSON.stringify({resourceId, snapshot, argv, deadline}), signal, capture: true});
      assert.equal(result.code, 0, 'Failed to construct the exact turn bundle');
      const sent = await this.remote('transfer', lease, {signal, inputPath: bundle, capture: true});
      assert.equal(sent.code, 0, 'Host refused the turn transfer');
    } finally { rmSync(directory, {recursive: true, force: true}); }
  }
  async prepare(lease, {signal}) {
    const result = await this.remote('prepare', lease, {signal});
    assert.equal(result.code, 0, 'Guest preparation failed');
  }
  async execute(lease, {signal}) {
    const executed = await this.remote('execute-v2', lease, {signal});
    assert.equal(executed.code, 0, 'Remote execution channel did not confirm completion');
    const result = await this.remote('result', lease, {signal, capture: true});
    assert.equal(result.code, 0, 'Command completion readback failed');
    const receipt = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(receipt).sort(), ['code', 'resourceId'], 'Invalid completion fields');
    assert.ok(receipt.resourceId === lease.resourceId && Number.isInteger(receipt.code) && receipt.code >= 0 && receipt.code <= 255, 'Missing or foreign command completion');
    return receipt.code;
  }
  async destroy(lease, {signal}) {
    signal ??= AbortSignal.timeout(120000);
    while (true) {
      signal.throwIfAborted();
      const result = await this.remote('destroy', lease, {signal, capture: true});
      // A lost SSH channel cannot establish absence. Leave the lease closed
      // for the next controller attempt instead of opening fresh connections.
      assert.notEqual(result.code, 255, 'SSH cleanup channel is unavailable');
      if (result.code === 0) {
        const receipt = JSON.parse(result.stdout);
        assert.ok(receipt.resourceId === lease.resourceId && receipt.absent === true, 'Owned guest absence was not proved');
        return;
      }
      // A host deadline cleanup can own the same lock. Re-observe before
      // retrying; only verified absence can finish within this caller budget.
      try {
        const observed = await this.inspect(lease, {signal});
        if (observed.resourceId === lease.resourceId && observed.absent === true) return;
      } catch { signal.throwIfAborted(); }
      await delay(250, undefined, {signal});
    }
  }
  async inspect(lease, {signal}) {
    const result = await this.remote('inspect', lease, {signal, capture: true});
    assert.equal(result.code, 0, 'Owned guest readback failed');
    return JSON.parse(result.stdout);
  }
}

export async function runProcess(command, argv, {input, inputPath, signal, capture = false, onOutput} = {}) {
  signal?.throwIfAborted();
  protectOutputStreams();
  return new Promise((resolve, reject) => {
    const directory = mkdtempSync(join(tmpdir(), 'disposable-command-'));
    let child;
    try { child = spawn(command, argv, {cwd: directory, detached: true, stdio: ['pipe', 'pipe', 'pipe']}); }
    catch (error) { rmSync(directory, {recursive: true, force: true}); reject(error); return; }
    let failure, timer, stdout = '', bytes = 0, outputBytes = 0, source;
    const kill = sig => {
      if (child.pid) try { process.kill(-child.pid, sig); } catch (error) { if (error.code !== 'ESRCH') failure ??= error; }
    };
    const closePipes = () => {
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
    };
    const stop = error => {
      failure ??= error;
      if (child.exitCode !== null || child.signalCode !== null) {
        closePipes();
        return;
      }
      if (!timer) {
        kill('SIGTERM');
        timer = setTimeout(() => kill('SIGKILL'), 2000);
      }
    };
    const abort = () => stop(new Error('Transport aborted'));
    signal?.addEventListener('abort', abort, {once: true});
    // Subscribe before rechecking: cancellation may arrive just after spawn.
    if (signal?.aborted) abort();
    child.on('error', error => { failure ??= error; });
    child.on('exit', () => {
      kill('SIGKILL');
      // A shared SSH master may retain the channel's pipe descriptors after
      // this client exits. Cancellation must return so a fresh channel can
      // stop the remote operation; successful output still drains normally.
      if (failure) {
        closePipes();
      }
    });
    const acceptOutput = data => {
      if (failure) return false;
      outputBytes += data.length;
      if (outputBytes > 64*1024*1024) {
        stop(new Error('Transport output byte limit exceeded'));
        return false;
      }
      return true;
    };
    child.stdout.on('data', data => {
      if (!acceptOutput(data)) return;
      if (capture) {
        bytes += data.length;
        if (bytes > 65536) stop(new Error('Transport output byte limit exceeded'));
        else stdout += data.toString();
      } else if (onOutput) onOutput(data);
      else writeOutput(process.stdout, data);
    });
    child.stderr.on('data', data => { if (acceptOutput(data)) writeOutput(process.stderr, data); });
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') stop(error); });
    if (inputPath) {
      source = createReadStream(inputPath);
      source.on('error', stop);
      source.pipe(child.stdin);
    } else child.stdin.end(input);
    child.on('close', (code, termination) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      source?.destroy();
      try { rmSync(directory, {recursive: true, force: true}); } catch (error) { failure ??= error; }
      if (failure) reject(failure);
      else resolve({code: code ?? (termination === 'SIGINT' ? 130 : 143), stdout});
    });
  });
}
