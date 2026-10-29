import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

const launcher = new URL('./test-postgres.mjs', import.meta.url);
const postgres = 'postgres:18-alpine';
const mailpit = 'axllent/mailpit:v1.31.1';
const transient = 'net/http: request canceled (Client.Timeout exceeded while awaiting headers)';
const gatewayFailure = 'Error response from daemon: Head "https://registry-1.docker.io/v2/axllent/mailpit/manifests/v1.31.1": received unexpected HTTP status: 502 Bad Gateway';
const unreachableFailure = 'Error response from daemon: Get "https://registry-1.docker.io/v2/": dial tcp [2600:1f18:2148:bc00:6c71:bfe1:7acf:43cc]:443: connect: network is unreachable';

// Run the actual launcher; only external Docker and the requested package command are controlled.
async function launch(t, scenario = {}) {
  const root = await mkdtemp(join(tmpdir(), 'cloud-postgres-launcher-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const server = createServer((_request, response) => response.end('{}'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const state = join(root, 'state.json');
  await writeFile(state, JSON.stringify({cached: [postgres, mailpit], calls: [], failures: [], ...scenario}));
  await writeFile(join(root, 'docker'), `#!${process.execPath}
import {readFileSync, writeFileSync} from 'node:fs';
const state = process.env.LAUNCHER_STATE;
const data = JSON.parse(readFileSync(state));
const args = process.argv.slice(2);
const save = () => writeFileSync(state, JSON.stringify(data));
const fail = message => {save(); console.error(message); process.exit(1);};
const acquire = image => {
  if (image === (data.failureImage ?? '${postgres}') && data.failures.length) fail(data.failures.shift());
  data.cached.push(image);
};
const command = args[0];
if (command === 'image' && args[1] === 'inspect') {
  data.calls.push({command: 'inspect', image: args[2]});
  if (data.inspectFailure) fail(data.inspectFailure);
  if (!data.cached.includes(args[2])) fail('Error: No such image: ' + args[2]);
} else if (command === 'pull') {
  data.calls.push({command, image: args[1]});
  if (data.cancelSignal) process.kill(process.ppid, data.cancelSignal);
  if (data.cancelSignal && !data.failures.length) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  if (data.stubbornPull) {
    process.on('SIGTERM', () => {});
    save();
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 6000);
    data.calls.push({command: 'pull-survived'});
    fail('Pull survived its termination deadline');
  }
  if (data.hangPull) {save(); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);}
  acquire(args[1]);
} else if (command === 'run') {
  const image = args.at(-1);
  const name = args[args.indexOf('--name') + 1];
  data.calls.push({command, image, name, noPull: args.includes('--pull=never')});
  if (data.runFailure) fail(data.runFailure);
  if (!data.cached.includes(image)) {
    if (args.includes('--pull=never')) fail('Image missing with pulling disabled');
    acquire(image);
  }
  console.log('owned-container');
} else if (command === 'exec') {
  data.calls.push({command, name: args[1]});
} else if (command === 'port') {
  console.log('127.0.0.1:' + process.env.LAUNCHER_PORT);
} else if (command === 'rm') {
  data.calls.push({command, name: args.at(-1)});
} else fail('Unexpected Docker command');
save();
`, {mode: 0o700});
  await writeFile(join(root, 'pnpm'), `#!${process.execPath}
import {readFileSync, writeFileSync} from 'node:fs';
const data = JSON.parse(readFileSync(process.env.LAUNCHER_STATE));
data.calls.push({command: 'pnpm', args: process.argv.slice(2), database: !!process.env.TEST_DATABASE_URL,
  mail: !!process.env.MAILPIT_TEST_URL, recovery: !!process.env.CLOUD_RECOVERY_KEYS});
writeFileSync(process.env.LAUNCHER_STATE, JSON.stringify(data));
process.exit(data.childStatus ?? 0);
`, {mode: 0o700});
  const clock = join(root, 'clock.mjs');
  await writeFile(clock, `
const original = performance.now.bind(performance);
let reads = 0;
let started;
Object.defineProperty(performance, 'now', {value: () => {
  if (++reads <= 2) return 0;
  started ??= original();
  return 118000 + original() - started;
}});
`);
  const probe = join(root, 'probe.mjs');
  const invocations = join(root, 'invocations.jsonl');
  await writeFile(invocations, '');
  await writeFile(probe, `
import childProcess from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const execute = childProcess.execFileSync;
childProcess.execFileSync = (command, args, options) => {
  appendFileSync(process.env.LAUNCHER_INVOCATIONS, JSON.stringify({command, args}) + '\\n');
  try { return execute(command, args, options); }
  catch (error) {
    if (String(error.stderr).includes('CONTROLLED_EARLY_TIMEOUT')) {
      error.code = 'ETIMEDOUT';
      error.stderr = '';
    }
    throw error;
  }
};
syncBuiltinESMExports();
const phase = ${JSON.stringify(scenario.budgetPhase ?? null)};
if (phase) {
  let reads = 0;
  Object.defineProperty(performance, 'now', {value: () => {
    reads++;
    if (reads <= 3) return 0;
    if (reads === 4) return phase === 'before' ? 119000 : 118999;
    return 120000;
  }});
}
`);
  const clockArgs = scenario.shortBudget ? ['--import', clock] : [];
  if (scenario.budgetPhase || scenario.failures?.includes('CONTROLLED_EARLY_TIMEOUT')) clockArgs.push('--import', probe);
  const child = spawn(process.execPath, [...clockArgs, launcher.pathname, 'exec', 'node', 'controlled-test'], {
    env: {...process.env, PATH: `${root}:${process.env.PATH}`, LAUNCHER_STATE: state,
      LAUNCHER_INVOCATIONS: invocations, LAUNCHER_PORT: String(server.address().port)}, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => {output += bytes;});
  const status = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({code, signal}));
  });
  return {...status, output, ...JSON.parse(await readFile(state, 'utf8')),
    invocations: (await readFile(invocations, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line))};
}

// Removing the acquisition retry must prevent the requested package command from running.
test('launcher recovers from a transient image-pull timeout before starting PostgreSQL', async t => {
  const result = await launch(t, {cached: [mailpit], failures: [transient]});
  assert.equal(result.failures.length, 0);
  assert.equal(result.code, 0);
  assert.equal(result.calls.filter(call => call.command === 'pull').length, 2);
  const run = result.calls.findIndex(call => call.command === 'run');
  assert.ok(run > result.calls.findLastIndex(call => call.command === 'pull'));
  assert.equal(result.calls.find(call => call.command === 'pnpm')?.database, true);
});


test('cached images run without registry pulls and preserve command arguments, status and owned cleanup', async t => {
  const result = await launch(t, {childStatus: 7});
  assert.equal(result.code, 7);
  assert.equal(result.calls.filter(call => call.command === 'pull').length, 0);
  const runs = result.calls.filter(call => call.command === 'run');
  assert.deepEqual(runs.map(call => [call.image, call.noPull]), [[postgres, true], [mailpit, true]]);
  assert.deepEqual(result.calls.find(call => call.command === 'pnpm'), {
    command: 'pnpm', args: ['exec', 'node', 'controlled-test'], database: true, mail: true, recovery: true,
  });
  assert.deepEqual(result.calls.filter(call => call.command === 'rm').map(call => call.name),
    [runs[1].name, runs[0].name]);
});

for (const image of [postgres, mailpit]) {
  test(`terminal pull refusal for ${image} stops before any container or package command starts`, async t => {
    const result = await launch(t, {cached: [], failureImage: image, failures: ['denied: requested access to the resource is denied']});
    assert.equal(result.code, 1);
    assert.equal(result.calls.filter(call => call.command === 'pull' && call.image === image).length, 1);
    assert.equal(result.calls.some(call => ['run', 'pnpm', 'rm'].includes(call.command)), false);
    assert.match(result.output, /requested access to the resource is denied/);
  });
}

test('three transient pull failures stop without creating containers or running package tests', async t => {
  const result = await launch(t, {cached: [mailpit], failures: [transient, transient, transient, transient]});
  assert.equal(result.code, 1);
  assert.equal(result.calls.filter(call => call.command === 'pull').length, 3);
  assert.equal(result.failures.length, 1);
  assert.equal(result.calls.some(call => ['run', 'pnpm', 'rm'].includes(call.command)), false);
});

test('Mailpit image acquisition also recovers before either container starts', async t => {
  const result = await launch(t, {cached: [postgres], failureImage: mailpit, failures: ['TLS handshake timeout']});
  assert.equal(result.code, 0);
  assert.equal(result.calls.filter(call => call.command === 'pull' && call.image === mailpit).length, 2);
  assert.ok(result.calls.findIndex(call => call.command === 'run') > result.calls.findLastIndex(call => call.command === 'pull'));
  assert.equal(result.calls.filter(call => call.command === 'rm').length, 2);
});

for (const image of [postgres, mailpit]) {
  test(`launcher recovers from a registry 502 for ${image} before creating containers`, async t => {
    const result = await launch(t, {cached: [], failureImage: image, failures: [gatewayFailure]});
    assert.equal(result.code, 0);
    assert.equal(result.calls.filter(call => call.command === 'pull' && call.image === image).length, 2);
    assert.ok(result.calls.findIndex(call => call.command === 'run') > result.calls.findLastIndex(call => call.command === 'pull'));
    assert.equal(result.calls.find(call => call.command === 'pnpm')?.database, true);
    const created = result.calls.filter(call => call.command === 'run').map(call => call.name);
    assert.deepEqual(result.calls.filter(call => call.command === 'rm').map(call => call.name), created.toReversed());
  });
}

test('three registry 502 responses exhaust acquisition before any container starts', async t => {
  const result = await launch(t, {cached: [postgres], failureImage: mailpit,
    failures: [gatewayFailure, gatewayFailure, gatewayFailure, gatewayFailure]});
  assert.equal(result.code, 1);
  assert.equal(result.calls.filter(call => call.command === 'pull').length, 3);
  assert.equal(result.failures.length, 1);
  assert.equal(result.calls.some(call => ['run', 'pnpm', 'rm'].includes(call.command)), false);
});

for (const status of ['401 Unauthorized', '403 Forbidden', '404 Not Found', '429 Too Many Requests']) {
  test(`launcher does not retry a registry ${status} response`, async t => {
    const result = await launch(t, {cached: [postgres], failureImage: mailpit,
      failures: ['received unexpected HTTP status: ' + status]});
    assert.equal(result.code, 1);
    assert.equal(result.calls.filter(call => call.command === 'pull').length, 1);
    assert.equal(result.calls.some(call => ['run', 'pnpm', 'rm'].includes(call.command)), false);
  });
}

// Restricting retries to 502 must lose recovery from the other server responses.
for (const status of ['500 Internal Server Error', '501 Not Implemented', '503 Service Unavailable', '504 Gateway Timeout', '599 Unknown']) {
  for (const image of [postgres, mailpit]) {
    test(`launcher recovers from registry ${status} for ${image} within acquisition`, async t => {
      const result = await launch(t, {cached: [], failureImage: image,
        failures: ['received unexpected HTTP status: ' + status]});
      assert.equal(result.code, 0, result.output);
      assert.equal(result.calls.filter(call => call.command === 'pull' && call.image === image).length, 2);
      assert.ok(result.calls.findIndex(call => call.command === 'run') > result.calls.findLastIndex(call => call.command === 'pull'));
      assert.equal(result.calls.find(call => call.command === 'pnpm')?.database, true);
      const created = result.calls.filter(call => call.command === 'run').map(call => call.name);
      assert.deepEqual(result.calls.filter(call => call.command === 'rm').map(call => call.name), created.toReversed());
      assert.match(result.output, new RegExp(`HTTP ${status.slice(0, 3)} \\(1/3\\)`));
    });
  }
}

// Losing the attempt bound must reach success and start containers after these failures.
for (const image of [postgres, mailpit]) {
  test(`registry 500 exhaustion for ${image} stops after three logged attempts`, async t => {
    const result = await launch(t, {cached: [], failureImage: image,
      failures: Array(3).fill('received unexpected HTTP status: 500 Internal Server Error')});
    assert.equal(result.code, 1, result.output);
    assert.equal(result.calls.filter(call => call.command === 'pull' && call.image === image).length, 3);
    assert.equal(result.calls.some(call => ['run', 'pnpm', 'rm'].includes(call.command)), false);
    assert.deepEqual([...result.output.matchAll(/HTTP 500 \((\d)\/3\)/g)].map(match => match[1]), ['1', '2', '3']);
  });
}

for (const status of ['499 Client Closed Request', '600 Invalid', '5000 Invalid']) {
  test(`launcher refuses non-5xx registry status ${status} without retrying`, async t => {
    const result = await launch(t, {cached: [postgres], failureImage: mailpit,
      failures: ['received unexpected HTTP status: ' + status]});
    assert.equal(result.code, 1);
    assert.equal(result.calls.filter(call => call.command === 'pull').length, 1);
    assert.equal(result.calls.some(call => ['run', 'pnpm', 'rm'].includes(call.command)), false);
    assert.doesNotMatch(result.output, /retrying/);
  });
}

for (const budgetPhase of ['before', 'after']) {
  test(`registry 500 retains the image deadline ${budgetPhase} the retry wait`, async t => {
    const result = await launch(t, {cached: [mailpit], budgetPhase,
      failures: ['received unexpected HTTP status: 500 Internal Server Error']});
    assert.equal(result.code, 1);
    assert.equal(result.invocations.filter(call => call.args[0] === 'pull').length, 1);
    assert.equal(result.calls.some(call => ['run', 'pnpm', 'rm'].includes(call.command)), false);
    if (budgetPhase === 'before') assert.doesNotMatch(result.output, /retrying/);
    else assert.match(result.output, /retrying/);
    assert.match(result.output, /HTTP 500 \(1\/3\)/);
  });
}

for (const image of [postgres, mailpit]) {
  test(`launcher recovers from the recorded network-unreachable response for ${image} before creating containers`, async t => {
    const result = await launch(t, {cached: [], failureImage: image, failures: [unreachableFailure]});
    assert.equal(result.code, 0, result.output);
    assert.equal(result.calls.filter(call => call.command === 'pull' && call.image === image).length, 2);
    assert.ok(result.calls.findIndex(call => call.command === 'run') > result.calls.findLastIndex(call => call.command === 'pull'));
    assert.equal(result.calls.find(call => call.command === 'pnpm')?.database, true);
    const created = result.calls.filter(call => call.command === 'run').map(call => call.name);
    assert.deepEqual(result.calls.filter(call => call.command === 'rm').map(call => call.name), created.toReversed());
  });
}

test('three network-unreachable responses exhaust acquisition before any container starts', async t => {
  const result = await launch(t, {cached: [postgres], failureImage: mailpit,
    failures: [unreachableFailure, unreachableFailure, unreachableFailure, unreachableFailure]});
  assert.equal(result.code, 1);
  assert.equal(result.calls.filter(call => call.command === 'pull').length, 3);
  assert.equal(result.failures.length, 1);
  assert.equal(result.calls.some(call => ['run', 'pnpm', 'rm'].includes(call.command)), false);
  assert.match(result.output, /connect: network is unreachable/);
});

test('an unavailable Docker daemon during inspection is not treated as a missing image', async t => {
  const result = await launch(t, {inspectFailure: 'Cannot connect to the Docker daemon'});
  assert.equal(result.code, 1);
  assert.equal(result.calls.filter(call => call.command === 'inspect').length, 1);
  assert.equal(result.calls.some(call => ['pull', 'run', 'pnpm', 'rm'].includes(call.command)), false);
});

test('a failed container start is never retried as an image-pull failure', async t => {
  const result = await launch(t, {runFailure: transient});
  assert.equal(result.code, 1);
  assert.equal(result.calls.filter(call => call.command === 'run').length, 1);
  assert.equal(result.calls.some(call => ['pull', 'pnpm'].includes(call.command)), false);
});

test('a hanging pull is killed within the remaining shared image-acquisition budget', {timeout: 20000}, async t => {
  const result = await launch(t, {cached: [mailpit], hangPull: true, shortBudget: true});
  assert.equal(result.code, 1);
  assert.match(result.output, /ETIMEDOUT/);
  assert.equal(result.calls.filter(call => call.command === 'pull').length, 1);
  assert.equal(result.calls.some(call => ['run', 'pnpm', 'rm'].includes(call.command)), false);
});

// Removing any one recognised response must stop recovery before the package command.
for (const failure of ['i/o timeout', 'context deadline exceeded', 'connection reset by peer', 'unexpected EOF']) {
  test(`launcher retries a Docker connection failure: ${failure}`, async t => {
    const result = await launch(t, {cached: [mailpit], failures: [failure]});
    assert.equal(result.code, 0);
    assert.equal(result.calls.filter(call => call.command === 'pull').length, 2);
    assert.equal(result.calls.find(call => call.command === 'pnpm')?.database, true);
  });
}

// This early injected error isolates classification; a real launcher timeout spends the whole budget.
test('an early ETIMEDOUT is retryable while the image still has time left', async t => {
  const result = await launch(t, {cached: [mailpit], failures: ['CONTROLLED_EARLY_TIMEOUT']});
  assert.equal(result.code, 0);
  assert.equal(result.calls.filter(call => call.command === 'pull').length, 2);
  assert.equal(result.calls.find(call => call.command === 'pnpm')?.database, true);
});

// Deleting the first guard must announce a wait that the remaining budget cannot afford.
test('launcher refuses a retry wait that would spend the remaining image budget', async t => {
  const result = await launch(t, {cached: [mailpit], failures: [transient], budgetPhase: 'before'});
  assert.equal(result.code, 1);
  assert.doesNotMatch(result.output, /retrying/);
  assert.equal(result.invocations.filter(call => call.args[0] === 'pull').length, 1);
  assert.equal(result.calls.some(call => ['run', 'pnpm', 'rm'].includes(call.command)), false);
});

// Deleting the second guard must attempt another Docker command after an overdue wait.
test('launcher rechecks the image deadline after a retry wait', async t => {
  const result = await launch(t, {cached: [mailpit], failures: [transient], budgetPhase: 'after'});
  assert.equal(result.code, 1);
  assert.match(result.output, /retrying/);
  assert.equal(result.invocations.filter(call => call.args[0] === 'pull').length, 1);
  assert.equal(result.calls.some(call => ['run', 'pnpm', 'rm'].includes(call.command)), false);
});

// Replacing SIGKILL with SIGTERM must allow this resistant client to reach its failure marker.
test('launcher forcibly ends a pull client that ignores graceful termination', {timeout: 20000}, async t => {
  const result = await launch(t, {cached: [mailpit], stubbornPull: true, shortBudget: true});
  assert.equal(result.code, 1);
  assert.match(result.output, /ETIMEDOUT/);
  assert.equal(result.calls.some(call => call.command === 'pull-survived'), false);
  assert.equal(result.calls.filter(call => call.command === 'pull').length, 1);
  assert.equal(result.calls.some(call => ['run', 'pnpm', 'rm'].includes(call.command)), false);
});

for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  // Losing the signal handler must lose the exit status or leave owned containers unremoved.
  test(`${signal} during a successful synchronous pull cleans up every container before exit`, async t => {
    const result = await launch(t, {cached: [mailpit], cancelSignal: signal});
    assert.equal(result.code, code);
    assert.equal(result.signal, null);
    const created = result.calls.filter(call => call.command === 'run').map(call => call.name);
    assert.ok(created.length > 0);
    assert.deepEqual(result.calls.filter(call => call.command === 'rm').map(call => call.name), created.toReversed());
    assert.equal(result.calls.some(call => call.command === 'pnpm'), false);
  });

  test(`${signal} during acquisition stops at the retry wait without starting containers`, async t => {
    const result = await launch(t, {cached: [mailpit], failures: [transient], cancelSignal: signal});
    assert.equal(result.code, code);
    assert.equal(result.signal, null);
    assert.equal(result.calls.filter(call => call.command === 'pull').length, 1);
    assert.equal(result.calls.some(call => ['run', 'pnpm', 'rm'].includes(call.command)), false);
  });

  test(`${signal} during a hanging pull stops at the acquisition deadline without containers`, {timeout: 20000}, async t => {
    const result = await launch(t, {cached: [mailpit], cancelSignal: signal, hangPull: true, shortBudget: true});
    assert.equal(result.code, 1);
    assert.equal(result.signal, null);
    assert.match(result.output, /ETIMEDOUT/);
    assert.equal(result.calls.filter(call => call.command === 'pull').length, 1);
    assert.equal(result.calls.some(call => ['run', 'pnpm', 'rm'].includes(call.command)), false);
  });
}
