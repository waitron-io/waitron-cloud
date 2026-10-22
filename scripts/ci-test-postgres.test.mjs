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
  const clockArgs = scenario.shortBudget ? ['--import', clock] : [];
  const child = spawn(process.execPath, [...clockArgs, launcher.pathname, 'exec', 'node', 'controlled-test'], {
    env: {...process.env, PATH: `${root}:${process.env.PATH}`, LAUNCHER_STATE: state,
      LAUNCHER_PORT: String(server.address().port)}, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => {output += bytes;});
  const status = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({code, signal}));
  });
  return {...status, output, ...JSON.parse(await readFile(state, 'utf8'))};
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
