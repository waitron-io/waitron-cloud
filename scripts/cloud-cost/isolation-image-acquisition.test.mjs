import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const imageId = 'sha256:' + 'a'.repeat(64);
const unavailable = 'Error response from daemon: received unexpected HTTP status: 502 Bad Gateway';

// Only Docker is replaced; acquisition runs in a real child with its real deadline.
async function acquire(t, scenario = {}) {
  const root = await mkdtemp(join(tmpdir(), 'cloud-isolation-image-'));
  const state = join(root, 'state.json');
  await writeFile(state, JSON.stringify({calls: [], failures: [], ...scenario}));
  await writeFile(join(root, 'docker'), `#!${process.execPath}
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
const path = ${JSON.stringify(state)}, data = JSON.parse(readFileSync(path)), args = process.argv.slice(2);
if (!existsSync(path + '.warm')) {
  if (data.coldStartMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, data.coldStartMs);
  writeFileSync(path + '.warm', 'ready');
}
if (args[0] === '--warm-up') process.exit(0);
data.calls.push(args); writeFileSync(path, JSON.stringify(data));
const fail = message => { console.error(message); process.exit(1); };
if (args[0] === 'image' && args[1] === 'inspect') {
  if (data.inspectFailure) fail(data.inspectFailure);
  if (!data.cached) fail('Error: No such image: node:26-slim');
  if (data.hangInspect) { data.pid = process.pid; writeFileSync(path, JSON.stringify(data)); setInterval(() => {}, 1000); }
  else console.log(${JSON.stringify(imageId)});
} else if (args[0] === 'pull') {
  if (data.hang) { data.pid = process.pid; writeFileSync(path, JSON.stringify(data)); setInterval(() => {}, 1000); }
  else if (data.failures.length) { const message = data.failures.shift(); writeFileSync(path, JSON.stringify(data)); fail(message); }
  else { data.cached = true; writeFileSync(path, JSON.stringify(data)); }
} else fail('Unexpected operation: ' + args.join(' '));
`, {mode: 0o700});
  const script = `import assert from 'node:assert/strict';
${scenario.expireDuringBackoff || scenario.insufficientBackoff ? `import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const timers = await import('node:timers/promises'), realDelay = timers.default.setTimeout;
let paused = false;
timers.default.setTimeout = async (...args) => {await realDelay(...args); paused = true;};
syncBuiltinESMExports();
const started = performance.now();
// Clock progress follows the real pause, independently of clock-read count.
Object.defineProperty(performance, 'now', {value: () => {
  if (!JSON.parse(fs.readFileSync(${JSON.stringify(state)})).calls.some(args => args[0] === 'pull')) return started;
  return started + (paused ? 120000 : ${scenario.insufficientBackoff ? 119500 : 118000});
}});` : ''}
const module = await import(${JSON.stringify(new URL('./fixtures/isolation-image.mjs', import.meta.url).href)}).catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error;
});
assert.equal(typeof module.isolationTestImage, 'function', 'isolation tests need bounded image preparation');
console.log('IMAGE=' + await module.isolationTestImage(${JSON.stringify({budgetMs: scenario.budgetMs ?? 120000})}));`;
  // Fresh executable startup is fixture setup, outside the short acquisition probe.
  try {execFileSync(join(root, 'docker'), ['--warm-up'], {timeout: 5000, killSignal: 'SIGKILL', stdio: 'ignore'});}
  catch (error) {await rm(root, {recursive: true, force: true}); throw error;}
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    env: {PATH: root + ':' + process.env.PATH}, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => {output += bytes;});
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL'); await new Promise(resolve => child.once('close', resolve));
    }
    const data = JSON.parse(await readFile(state, 'utf8'));
    if (data.pid) {try {process.kill(data.pid, 'SIGKILL');} catch (error) {if (error.code !== 'ESRCH') throw error;}}
    await rm(root, {recursive: true, force: true});
  });
  const code = await new Promise((resolve, reject) => {child.once('error', reject); child.once('close', resolve);});
  return {code, output, ...JSON.parse(await readFile(state, 'utf8'))};
}

const inspect = ['image', 'inspect', 'node:26-slim', '--format', '{{.Id}}'];
const pull = ['pull', 'node:26-slim'];

// Omitting acquisition or its transient retry loses the image after the recorded HTTP 502.
test('isolation image preparation recovers from the recorded registry HTTP 502', {timeout: 10000}, async t => {
  const result = await acquire(t, {failures: [unavailable]});
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, new RegExp('IMAGE=' + imageId));
  assert.deepEqual(result.calls, [inspect, pull, pull, inspect]);
});

test('a cached isolation image returns its immutable ID without a pull', async t => {
  const result = await acquire(t, {cached: true});
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, new RegExp('IMAGE=' + imageId));
  assert.deepEqual(result.calls, [inspect]);
});

for (const refusal of ['unauthorized: authentication required; ' + unavailable,
  'denied: requested access to the resource is denied; unexpected EOF',
  'manifest unknown; ' + unavailable, 'toomanyrequests: rate limit exceeded; ' + unavailable,
  'invalid reference format', 'received unexpected HTTP status: 404 Not Found']) {
  test('terminal isolation image refusal stops after one pull: ' + refusal, async t => {
    const result = await acquire(t, {failures: [refusal]});
    assert.equal(result.code, 1, result.output);
    assert.deepEqual(result.calls, [inspect, pull]);
    assert.doesNotMatch(result.output, /IMAGE=|retrying/);
  });
}

test('an unavailable Docker daemon stops at inspection', async t => {
  const result = await acquire(t, {inspectFailure: 'Cannot connect to the Docker daemon'});
  assert.equal(result.code, 1, result.output);
  assert.deepEqual(result.calls, [inspect]);
});

test('an unrecognised isolation image pull failure stops without retrying', async t => {
  const result = await acquire(t, {failures: ['unrecognised synthetic Docker refusal']});
  assert.equal(result.code, 1, result.output);
  assert.deepEqual(result.calls, [inspect, pull]);
  assert.doesNotMatch(result.output, /IMAGE=|retrying/);
});

test('persistent isolation image HTTP 502 stops after three pulls', {timeout: 10000}, async t => {
  const result = await acquire(t, {failures: [unavailable, unavailable, unavailable, unavailable]});
  assert.equal(result.code, 1, result.output);
  assert.deepEqual(result.calls, [inspect, pull, pull, pull]);
  assert.equal(result.failures.length, 1);
  assert.doesNotMatch(result.output, /IMAGE=/);
});

for (const stage of ['hang', 'hangInspect']) {
  test('the shared isolation image deadline kills a stalled ' + stage, {timeout: 5000}, async t => {
    const result = await acquire(t, {[stage]: true, cached: stage === 'hangInspect', budgetMs: 500, coldStartMs: 600});
    assert.equal(result.code, 1, result.output);
    assert.deepEqual(result.calls, stage === 'hang' ? [inspect, pull] : [inspect]);
    assert.throws(() => process.kill(result.pid, 0), {code: 'ESRCH'});
  });
}

test('an expired acquisition budget does not start another pull after backoff', {timeout: 5000}, async t => {
  const result = await acquire(t, {failures: [unavailable], expireDuringBackoff: true});
  assert.equal(result.code, 1, result.output);
  assert.deepEqual(result.calls, [inspect, pull]);
  assert.match(result.output, /retrying/);
  assert.doesNotMatch(result.output, /IMAGE=/);
});

test('a retry pause that cannot fit the acquisition budget never starts', {timeout: 5000}, async t => {
  const result = await acquire(t, {failures: [unavailable], insufficientBackoff: true});
  assert.equal(result.code, 1, result.output);
  assert.deepEqual(result.calls, [inspect, pull]);
  assert.doesNotMatch(result.output, /IMAGE=|retrying/);
});
