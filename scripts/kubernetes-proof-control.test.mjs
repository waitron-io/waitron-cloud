import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const target = new URL('./kubernetes-proof-control.mjs', import.meta.url);
const control = await import(target.href).catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === target.href) return {};
  throw error;
});
const now = '2026-11-06T12:00:00Z';
const period = { Start: '2026-11-01', End: '2026-11-07' };
const identity = { Account: '462991287391', Arn: 'arn:aws:sts::462991287391:assumed-role/OwnerSetup/session', UserId: 'AROAEXAMPLE:session' };
const bill = () => ({ GroupDefinitions: [], ResultsByTime: [{ TimePeriod: { ...period }, Estimated: true, Groups: [],
  Total: { UnblendedCost: { Amount: '1.23456701', Unit: 'USD' } } }] });
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'd570-control-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--initial-branch=main');
  git('config', 'user.email', 'd570-fixture@example.invalid');
  git('config', 'user.name', 'D570 fixture');
  writeFileSync(join(root, 'controller.txt'), 'reviewed fixture\n');
  git('add', 'controller.txt'); git('-c', 'commit.gpgsign=false', 'commit', '-s', '-m', 'Create isolated controller fixture');
  const head = git('rev-parse', 'HEAD'), tree = git('rev-parse', 'HEAD^{tree}');
  git('config', `url.${root}.insteadOf`, 'https://github.com/waitron-io/waitron-cloud.git');
  git('remote', 'add', 'origin', 'https://github.com/waitron-io/waitron-cloud.git');
  git('update-ref', 'refs/remotes/origin/main', head);
  const calls = [];
  const aws = { async call(service, operation, input) {
    calls.push({ service, operation, input });
    if (service === 'sts' && operation === 'get-caller-identity') return structuredClone(identity);
    if (service === 'ce' && operation === 'get-cost-and-usage') return bill();
    assert.fail(`unexpected provider action ${service}/${operation}`);
  } };
  return { root, git, head, tree, calls, aws };
}
async function inspect(f, changes = {}) {
  assert.equal(typeof control.inspectManualControl, 'function', 'missing manual controller preflight');
  return control.inspectManualControl({ checkout: f.root, region: 'eu-north-1', now, aws: f.aws, environment: {},
    clock: () => Date.parse(changes.now ?? now), ...changes });
}

// Removing the clean/main/remote checks would expose the provider to candidate code.
test('clean exact remote main reads staging identity before its actual current-month bill', async t => {
  const f = fixture(t), result = await inspect(f);
  assert.deepEqual(result, { account: '462991287391', region: 'eu-north-1', head: f.head, tree: f.tree,
    billing: { observedAt: now, period, microUsd: 1234568, estimated: true } });
  assert.deepEqual(f.calls, [
    { service: 'sts', operation: 'get-caller-identity', input: {} },
    { service: 'ce', operation: 'get-cost-and-usage', input: { TimePeriod: period, Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'], Filter: { Dimensions: { Key: 'LINKED_ACCOUNT', Values: ['462991287391'] } } } },
  ]);
});

for (const [label, mutate] of [
  ['tracked change', f => writeFileSync(join(f.root, 'controller.txt'), 'candidate\n')],
  ['untracked file', f => writeFileSync(join(f.root, 'candidate.mjs'), 'throw 1;\n')],
  ['branch', f => f.git('switch', '-c', 'candidate')],
  ['detached head', f => f.git('switch', '--detach')],
  ['missing recorded main', f => f.git('update-ref', '-d', 'refs/remotes/origin/main')],
  ['stale recorded main', f => { writeFileSync(join(f.root, 'controller.txt'), 'new main\n'); f.git('add', '.');
    f.git('-c', 'commit.gpgsign=false', 'commit', '-s', '-m', 'Move isolated main'); }],
  ['missing origin', f => f.git('remote', 'remove', 'origin')],
  ['foreign repository', f => f.git('remote', 'set-url', 'origin', f.root)],
]) test(`${label} refuses before the first provider read`, async t => {
  const f = fixture(t); mutate(f);
  await assert.rejects(inspect(f), /D570 controller refused/);
  assert.deepEqual(f.calls, []);
});

for (const [label, changes] of [
  ['foreign region', { region: 'eu-south-2' }],
  ['GitHub job', { environment: { GITHUB_ACTIONS: 'true' } }],
  ['untrusted event', { environment: { GITHUB_EVENT_NAME: 'pull_request' } }],
  ['expired authority', { now: '2027-03-01T00:00:00Z' }],
  ['invalid time', { now: '2026-02-30T12:00:00Z' }],
]) test(`${label} refuses without a provider call`, async t => {
  const f = fixture(t);
  await assert.rejects(inspect(f, changes), /D570 controller refused/);
  assert.deepEqual(f.calls, []);
});

for (const [label, response] of [
  ['production account', { ...identity, Account: '949687825720' }],
  ['contradictory principal', { ...identity, Arn: 'arn:aws:sts::949687825720:assumed-role/OwnerSetup/session' }],
  ['root principal', { ...identity, Arn: 'arn:aws:iam::462991287391:root' }],
  ['long-lived user', { ...identity, Arn: 'arn:aws:iam::462991287391:user/owner' }],
]) test(`${label} refuses before accessing billing`, async t => {
  const f = fixture(t);
  f.aws.call = async (service, operation) => { f.calls.push({ service, operation }); return response; };
  await assert.rejects(inspect(f), /D570 controller refused/);
  assert.deepEqual(f.calls, [{ service: 'sts', operation: 'get-caller-identity' }]);
});

// An estimate is retained as an estimate; none of these observations releases a reservation.
for (const [label, change] of [
  ['missing period', b => delete b.ResultsByTime[0].TimePeriod],
  ['wrong period', b => b.ResultsByTime[0].TimePeriod.End = '2026-11-06'],
  ['partial pagination', b => b.NextPageToken = 'more'],
  ['missing total', b => delete b.ResultsByTime[0].Total],
  ['foreign currency', b => b.ResultsByTime[0].Total.UnblendedCost.Unit = 'EUR'],
  ['negative credit', b => b.ResultsByTime[0].Total.UnblendedCost.Amount = '-1'],
  ['nondecimal amount', b => b.ResultsByTime[0].Total.UnblendedCost.Amount = '1e-6'],
  ['over cap', b => b.ResultsByTime[0].Total.UnblendedCost.Amount = '10'],
  ['duplicate period', b => b.ResultsByTime.push(structuredClone(b.ResultsByTime[0]))],
  ['grouped amount', b => b.ResultsByTime[0].Groups = [{ Keys: ['other'], Metrics: {} }]],
  ['unknown estimate flag', b => delete b.ResultsByTime[0].Estimated],
]) test(`${label} cannot become a usable billing observation`, async t => {
  const f = fixture(t), response = bill(); change(response);
  f.aws.call = async service => service === 'sts' ? identity : response;
  await assert.rejects(inspect(f), /D570 controller refused/);
});

test('month end includes today with an exclusive next-month billing end', async t => {
  const f = fixture(t);
  f.aws.call = async (service, operation, input) => {
    if (service === 'sts') return identity;
    assert.deepEqual(input.TimePeriod, { Start: '2026-11-01', End: '2026-12-01' });
    const response = bill(); response.ResultsByTime[0].TimePeriod = input.TimePeriod;
    response.ResultsByTime[0].Total.UnblendedCost.Amount = '0'; return response;
  };
  const result = await inspect(f, { now: '2026-11-30T23:59:59Z' });
  assert.equal(result.billing.microUsd, 0);
});

test('provider errors remain errors rather than a zero baseline', async t => {
  const f = fixture(t);
  f.aws.call = async service => { if (service === 'sts') return identity; throw new Error('billing denied'); };
  await assert.rejects(inspect(f), /billing denied/);
});

test('remote main moving independently refuses before any provider call', async t => {
  const f = fixture(t), remote = f.root + '-remote';
  t.after(() => rmSync(remote, { recursive: true, force: true }));
  f.git('clone', '--bare', '--shared', f.root, remote);
  f.git('-c', 'commit.gpgsign=false', 'commit', '-s', '--allow-empty', '-m', 'Move only remote fixture');
  const moved = f.git('rev-parse', 'HEAD');
  f.git('reset', '--hard', f.head);
  execFileSync('git', ['--git-dir', remote, 'update-ref', 'refs/heads/main', moved]);
  f.git('config', '--unset-all', `url.${f.root}.insteadOf`);
  f.git('config', `url.${remote}.insteadOf`, 'https://github.com/waitron-io/waitron-cloud.git');
  await assert.rejects(inspect(f), /D570 controller refused/);
  assert.deepEqual(f.calls, []);
});

test('a checkout changed during the identity read cannot reach billing', async t => {
  const f = fixture(t);
  f.aws.call = async (service, operation) => {
    f.calls.push({ service, operation });
    writeFileSync(join(f.root, 'controller.txt'), 'changed while reading identity\n');
    return identity;
  };
  await assert.rejects(inspect(f), /D570 controller refused/);
  assert.deepEqual(f.calls, [{ service: 'sts', operation: 'get-caller-identity' }]);
});

test('crossing the UTC day during billing refuses stale observations', async t => {
  const f = fixture(t); let at = Date.parse('2026-11-06T23:59:59Z');
  f.aws.call = async service => {
    if (service === 'sts') return identity;
    at += 1000; return bill();
  };
  await assert.rejects(inspect(f, { now: '2026-11-06T23:59:59Z', clock: () => at }), /D570 controller refused/);
});

test('authority expiring during identity read refuses before billing', async t => {
  const f = fixture(t); let at = Date.parse('2027-02-28T23:58:59Z');
  f.aws.call = async (service, operation) => {
    f.calls.push({ service, operation }); at += 1000; return identity;
  };
  await assert.rejects(inspect(f, { now: '2027-02-28T23:58:59Z', clock: () => at }), /D570 controller refused/);
  assert.deepEqual(f.calls, [{ service: 'sts', operation: 'get-caller-identity' }]);
});

test('CLI boundary fixes AWS endpoints, finite waits and retries and does not interpret argument strings', async t => {
  const f = fixture(t), executable = join(f.root, 'aws-fixture'), capture = join(f.root, 'capture.json');
  writeFileSync(executable, `#!${process.execPath}\nimport('node:fs').then(fs => {
    fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({ args: process.argv.slice(2),
      attempts: process.env.AWS_MAX_ATTEMPTS, endpoints: process.env.AWS_IGNORE_CONFIGURED_ENDPOINT_URLS,
      metadata: process.env.AWS_EC2_METADATA_DISABLED, pager: process.env.AWS_PAGER }));
    process.stdout.write(JSON.stringify({ Account: '462991287391' }));
  });\n`, { mode: 0o700 });
  assert.equal(typeof control.createManualAwsCli, 'function', 'missing bounded AWS CLI adapter');
  const aws = control.createManualAwsCli({ executable });
  assert.deepEqual(await aws.call('sts', 'get-caller-identity', {}), { Account: '462991287391' });
  let saved = JSON.parse(readFileSync(capture));
  assert.deepEqual(saved, { args: ['sts', 'get-caller-identity', '--cli-input-json', '{}', '--region', 'eu-north-1',
    '--output', 'json', '--no-paginate', '--no-cli-pager', '--cli-connect-timeout', '5', '--cli-read-timeout', '15'],
  attempts: '3', endpoints: 'true', metadata: 'true', pager: '' });
  await aws.call('ce', 'get-cost-and-usage', { marker: '$(touch forbidden);`false`' });
  saved = JSON.parse(readFileSync(capture));
  assert.equal(saved.args[5], 'us-east-1');
  assert.equal(saved.args[3], '{"marker":"$(touch forbidden);`false`"}');
  await assert.rejects(aws.call('ec2', 'run-instances', {}), /D570 controller refused/);
});

test('CLI failure does not expose provider diagnostic contents', async t => {
  const f = fixture(t), executable = join(f.root, 'aws-refusal');
  writeFileSync(executable, `#!${process.execPath}\nprocess.stderr.write('private provider text'); process.exit(1);\n`, { mode: 0o700 });
  assert.equal(typeof control.createManualAwsCli, 'function', 'missing bounded AWS CLI adapter');
  await assert.rejects(control.createManualAwsCli({ executable }).call('sts', 'get-caller-identity', {}),
    error => error.message === 'D570 AWS sts/get-caller-identity failed');
});

for (const command of ['up', 'drill', 'reconcile', 'down']) test(`unfinished ${command} entry refuses rather than reporting a successful lifecycle`, () => {
  const result = spawnSync(process.execPath, [target.pathname, command], { encoding: 'utf8', timeout: 5000 });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /D570 manual lifecycle is not implemented/);
});
