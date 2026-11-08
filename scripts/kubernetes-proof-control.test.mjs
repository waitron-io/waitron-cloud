import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, statSync, mkdirSync, symlinkSync, chmodSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { open } from 'node:fs/promises';

const target = new URL('./kubernetes-proof-control.mjs', import.meta.url);
const control = await import(target.href).catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === target.href) return {};
  throw error;
});
const now = '2026-11-06T12:00:00Z';
const period = { Start: '2026-11-01', End: '2026-11-07' };
const identity = { Account: '462991287391', Arn: 'arn:aws:sts::462991287391:assumed-role/OwnerSetup/session', UserId: 'AROAEXAMPLE:session' };
const bill = () => ({ ResultsByTime: [{ TimePeriod: { ...period }, Estimated: true, Groups: [],
  Total: { UnblendedCost: { Amount: '1.23456701', Unit: 'USD' } } }] });

test('GroupDefinitions may be absent in the ungrouped AWS billing response', async t => {
  const f = fixture(t), response = bill();
  delete response.GroupDefinitions;
  f.aws.call = async service => service === 'sts' ? identity : response;
  const result = await inspect(f);
  assert.deepEqual(result.billing, { observedAt: now, period, microUsd: 1234568, estimated: true });
});

test('GroupDefinitions also accepts an explicit empty ungrouped array', async t => {
  const f = fixture(t), response = bill(); response.GroupDefinitions = [];
  f.aws.call = async service => service === 'sts' ? identity : response;
  assert.deepEqual((await inspect(f)).billing, { observedAt: now, period, microUsd: 1234568, estimated: true });
});

test('the owner estimated rounding residue is a zero opening at tenth-cent precision', async t => {
  const f = fixture(t), observedAt = '2026-11-08T09:48:10Z';
  const ownerPeriod = { Start: '2026-11-01', End: '2026-11-09' };
  for (const amount of ['-0.0000000003', '-0.0000000001', '-0.0004999999']) {
    const response = { ResultsByTime: [{ TimePeriod: ownerPeriod, Estimated: true, Groups: [],
      Total: { UnblendedCost: { Amount: amount, Unit: 'USD' } } }] };
    f.aws.call = async service => service === 'sts' ? identity : response;
    const result = await control.inspectManualOpening({ checkout: f.root, region: 'eu-north-1',
      now: observedAt, clock: () => Date.parse(observedAt), aws: f.aws, environment: {} });
    assert.deepEqual(result.billing, { observedAt, period: ownerPeriod, microUsd: 0, estimated: true });
    assert.deepEqual(result.openingExplanations, []);
  }
});

test('credits that round to a tenth of a cent refuse with their original amount', async t => {
  const f = fixture(t);
  for (const amount of ['-0.0005', '-0.001', '-0.01']) {
    const response = bill(); response.ResultsByTime[0].Total.UnblendedCost.Amount = amount;
    f.aws.call = async service => service === 'sts' ? identity : response;
    await assert.rejects(inspect(f), error => {
      assert.match(error.message, /D570 controller refused.*credit/);
      assert.equal(error.opening.billing.rawUsd, amount);
      assert.equal(Object.hasOwn(error.opening.billing, 'microUsd'), false);
      return true;
    });
  }
});

test('the owner estimated negative-zero bill is a zero opening without charge explanations', async t => {
  const f = fixture(t), observedAt = '2026-11-07T21:42:36Z';
  const ownerPeriod = { Start: '2026-11-01', End: '2026-11-08' };
  for (const amount of ['-0', '-0.00', '-0.0000000000', '0']) {
    const response = { ResultsByTime: [{ TimePeriod: ownerPeriod, Estimated: true, Groups: [],
      Total: { UnblendedCost: { Amount: amount, Unit: 'USD' } } }] };
    f.aws.call = async service => service === 'sts' ? identity : response;
    const result = await control.inspectManualOpening({ checkout: f.root, region: 'eu-north-1',
      now: observedAt, clock: () => Date.parse(observedAt), aws: f.aws, environment: {} });
    assert.deepEqual(result.billing, { observedAt, period: ownerPeriod, microUsd: 0, estimated: true });
    assert.deepEqual(result.openingExplanations, []);
  }
  for (const amount of ['-0.01', '-0.001']) {
    const response = bill(); response.ResultsByTime[0].Total.UnblendedCost.Amount = amount;
    f.aws.call = async service => service === 'sts' ? identity : response;
    await assert.rejects(inspect(f), error => {
      assert.match(error.message, /D570 controller refused.*credit/);
      assert.equal(error.opening.billing.rawUsd, amount);
      assert.equal(Object.hasOwn(error.opening.billing, 'microUsd'), false);
      return true;
    });
  }
});

for (const value of [null, {}, '', [{ Type: 'DIMENSION', Key: 'SERVICE' }]]) {
  test(`GroupDefinitions refuses a present invalid value ${JSON.stringify(value)}`, async t => {
    const f = fixture(t), response = bill(); response.GroupDefinitions = value;
    f.aws.call = async service => service === 'sts' ? identity : response;
    await assert.rejects(inspect(f), /D570 controller refused: ce billing shape/);
  });
}

test('AWS response accepts an omitted default event bus under its exact default-rule ARN', async t => {
  const f = protectionFixture(t);
  delete f.responses['events/describe-rule'].EventBusName;
  assert.equal((await f.observe()).bucket, 'd570-first-bucket');
});

test('AWS response accepts the documented nested attachment without an InstanceId', async t => {
  const f = await readyGuestFixture(t), before = structuredClone([...f.objects]);
  delete f.instance.NetworkInterfaces[0].Attachment.InstanceId;
  assert.equal((await f.observe()).instanceId, f.instanceId);
  assert.deepEqual(structuredClone([...f.objects]), before);
});

test('AWS response rejects an explicitly conflicting attachment instance', async t => {
  const f = await readyGuestFixture(t);
  f.instance.NetworkInterfaces[0].Attachment.InstanceId = 'i-11111111111111111';
  await assert.rejects(f.observe(), { message: 'D570 controller refused: ec2 observation' });
});

test('safe refusal identifies a missing AWS client as control input', async t => {
  const f = fixture(t);
  await assert.rejects(inspect(f, { aws: {} }), { message: 'D570 controller refused: control input' });
  assert.deepEqual(f.calls, []);
});

const identityReads = ['sts/get-caller-identity'];
const billingReads = [...identityReads, 'ce/get-cost-and-usage'];
const parameterReads = [...billingReads, 'ssm/get-parameter'];
const imageReads = [...parameterReads, 'ec2/describe-images'];
const capacityReads = [...imageReads, 'ec2/describe-instance-types'];
for (const [label, prepare, run, reason, expectedReads] of [
  ['billing', t => { const f = fixture(t); f.aws.call = async service => service === 'sts' ? identity : {}; return f; }, inspect, 'ce billing shape', billingReads],
  ['identity', t => { const f = fixture(t); f.aws.call = async () => ({}); return f; }, inspect, 'sts identity', identityReads],
  ['checkout', t => { const f = fixture(t); writeFileSync(join(f.root, 'controller.txt'), 'changed\n'); return f; }, inspect, 'checkout', []],
  ['parameter', t => { const f = setupFixture(t); delete f.responses['ssm/get-parameter'].Parameter; return f; }, discover, 'ssm parameter', parameterReads],
  ['image', t => { const f = setupFixture(t); f.responses['ec2/describe-images'].Images[0].Architecture = 'x86_64'; return f; }, discover, 'ec2 image', imageReads],
  ['prefix', t => { const f = setupFixture(t); f.responses['ec2/describe-managed-prefix-lists'].PrefixLists[0].PrefixListId = 'invalid'; return f; }, discover, 'ec2 prefix', [...capacityReads, 'ec2/describe-managed-prefix-lists']],
  ['event rule', t => { const f = protectionFixture(t); f.responses['events/describe-rule'].EventBusName = null; return f; }, f => f.observe(), 'events rule', [...billingReads, 'cloudformation/describe-stacks', 'cloudformation/describe-stack-resources', 'events/describe-rule']],
]) test(`safe refusal names the ${label} validator before further provider work`, async t => {
  const f = prepare(t), prior = f.aws.call, reads = [];
  f.aws.call = async (service, operation, input) => {
    reads.push(`${service}/${operation}`);
    return prior(service, operation, input);
  };
  await assert.rejects(run(f), { message: `D570 controller refused: ${reason}` });
  assert.deepEqual(reads, expectedReads);
  assert.equal(f.calls.some(row => ['create-stack', 'run-instances', 'put-object'].includes(row.operation)), false);
});
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
  ['over cap', b => b.ResultsByTime[0].Total.UnblendedCost.Amount = '20'],
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

for (const command of ['up', 'drill', 'reconcile', 'down']) test(`incomplete ${command} entry refuses rather than reporting a successful lifecycle`, () => {
  const result = spawnSync(process.execPath, [target.pathname, command], { encoding: 'utf8', timeout: 5000 });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /D570 controller refused/);
});

// Dropping regional discovery would allow a pasted image or foreign network prefix into setup.
function setupFixture(t) {
  const f = fixture(t);
  const input = JSON.parse(readFileSync(new URL('../deploy/kubernetes/proof/test-fixtures/setup-input.json', import.meta.url)));
  const parameterName = '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64';
  const responses = {
    'ssm/get-parameter': { Parameter: { Name: parameterName, Type: 'String', Value: input.image.ImageId, Version: 1,
      LastModifiedDate: '2026-11-01T00:00:00Z', ARN: 'arn:aws:ssm:eu-north-1::parameter' + parameterName, DataType: 'text' } },
    'ec2/describe-images': { Images: [input.image] },
    'ec2/describe-instance-types': { InstanceTypes: [{ InstanceType: 'm7g.2xlarge',
      ProcessorInfo: { SupportedArchitectures: ['arm64'] }, VCpuInfo: { DefaultVCpus: 8 }, MemoryInfo: { SizeInMiB: 32768 },
      SupportedUsageClasses: ['on-demand', 'spot'] }] },
    'ec2/describe-managed-prefix-lists': { PrefixLists: [{ PrefixListId: input.s3PrefixListId, AddressFamily: 'IPv4',
      PrefixListName: 'com.amazonaws.eu-north-1.s3', OwnerId: 'AWS', State: 'create-complete', Version: 1,
      PrefixListArn: 'arn:aws:ec2:eu-north-1:aws:prefix-list/' + input.s3PrefixListId, MaxEntries: 1, Tags: [] }] },
  };
  const existing = f.aws.call;
  f.aws.call = async (service, operation, request) => {
    const key = service + '/' + operation;
    if (!Object.hasOwn(responses, key)) return existing(service, operation, request);
    f.calls.push({ service, operation, input: request }); return structuredClone(responses[key]);
  };
  return { ...f, input, responses, parameterName };
}
async function discover(f, changes = {}) {
  assert.equal(typeof control.inspectManualSetup, 'function', 'missing provider-checked manual renderer');
  return control.inspectManualSetup({ checkout: f.root, region: 'eu-north-1', now, aws: f.aws,
    environment: {}, clock: () => Date.parse(now), ...changes });
}
test('setup discovers the official regional image, machine and AWS S3 prefix before rendering privately', async t => {
  const f = setupFixture(t), result = await discover(f);
  assert.equal(result.head, f.head); assert.equal(result.tree, f.tree);
  assert.equal(result.billing.microUsd, 1234568);
  assert.equal(result.template.Parameters.ImageId.Default, 'ami-0123456789abcdef0');
  assert.equal(result.template.Resources.LauncherRole, undefined);
  assert.equal(result.template.Resources.OidcProvider, undefined);
  const launch = result.template.Resources.LaunchTemplate.Properties.LaunchTemplateData;
  assert.equal(launch.InstanceType, 'm7g.2xlarge');
  assert.equal(launch.NetworkInterfaces[0].AssociatePublicIpAddress, false);
  assert.equal(launch.InstanceInitiatedShutdownBehavior, 'terminate');
  assert.deepEqual(result.template.Resources.SecurityGroup.Properties.SecurityGroupIngress, []);
  assert.deepEqual(result.template.Resources.SecurityGroup.Properties.SecurityGroupEgress, [{ IpProtocol: 'tcp',
    FromPort: 443, ToPort: 443, DestinationPrefixListId: 'pl-0123456789abcdef0' }]);
  assert.deepEqual(f.calls.slice(2), [
    { service: 'ssm', operation: 'get-parameter', input: { Name: f.parameterName, WithDecryption: false } },
    { service: 'ec2', operation: 'describe-images', input: { ImageIds: ['ami-0123456789abcdef0'], Owners: ['137112412989'] } },
    { service: 'ec2', operation: 'describe-instance-types', input: { InstanceTypes: ['m7g.2xlarge'] } },
    { service: 'ec2', operation: 'describe-managed-prefix-lists', input: { Filters: [
      { Name: 'prefix-list-name', Values: ['com.amazonaws.eu-north-1.s3'] }, { Name: 'owner-id', Values: ['AWS'] }] } },
  ]);
});
for (const [label, key, mutate] of [
  ['foreign parameter', 'ssm/get-parameter', r => r.Parameter.Name = '/other'],
  ['secret parameter', 'ssm/get-parameter', r => r.Parameter.Type = 'SecureString'],
  ['malformed image id', 'ssm/get-parameter', r => r.Parameter.Value = 'ami-invalid'],
  ['mismatched image', 'ec2/describe-images', r => r.Images[0].ImageId = 'ami-fffffffffffffffff'],
  ['foreign image owner', 'ec2/describe-images', r => r.Images[0].OwnerId = '949687825720'],
  ['wrong image architecture', 'ec2/describe-images', r => r.Images[0].Architecture = 'x86_64'],
  ['wrong image root', 'ec2/describe-images', r => r.Images[0].RootDeviceName = '/dev/sda1'],
  ['duplicate image', 'ec2/describe-images', r => r.Images.push(r.Images[0])],
  ['partial images', 'ec2/describe-images', r => r.NextToken = 'more'],
  ['wrong machine', 'ec2/describe-instance-types', r => r.InstanceTypes[0].InstanceType = 'm7g.xlarge'],
  ['insufficient memory', 'ec2/describe-instance-types', r => r.InstanceTypes[0].MemoryInfo.SizeInMiB = 16384],
  ['insufficient CPUs', 'ec2/describe-instance-types', r => r.InstanceTypes[0].VCpuInfo.DefaultVCpus = 4],
  ['wrong machine architecture', 'ec2/describe-instance-types', r => r.InstanceTypes[0].ProcessorInfo.SupportedArchitectures = ['x86_64']],
  ['spot only', 'ec2/describe-instance-types', r => r.InstanceTypes[0].SupportedUsageClasses = ['spot']],
  ['missing machine', 'ec2/describe-instance-types', r => r.InstanceTypes = []],
  ['partial machine inventory', 'ec2/describe-instance-types', r => r.NextToken = 'more'],
  ['foreign prefix owner', 'ec2/describe-managed-prefix-lists', r => r.PrefixLists[0].OwnerId = '462991287391'],
  ['foreign prefix region', 'ec2/describe-managed-prefix-lists', r => r.PrefixLists[0].PrefixListName = 'com.amazonaws.eu-south-2.s3'],
  ['wrong prefix family', 'ec2/describe-managed-prefix-lists', r => r.PrefixLists[0].AddressFamily = 'IPv6'],
  ['malformed prefix', 'ec2/describe-managed-prefix-lists', r => r.PrefixLists[0].PrefixListId = 'pl-invalid'],
  ['duplicate prefix', 'ec2/describe-managed-prefix-lists', r => r.PrefixLists.push(r.PrefixLists[0])],
  ['partial prefix inventory', 'ec2/describe-managed-prefix-lists', r => r.NextToken = 'more'],
]) test(`${label} cannot produce a manual setup template`, async t => {
  const f = setupFixture(t); mutate(f.responses[key]);
  await assert.rejects(discover(f), /D570 controller refused|Unverified official ARM image|Invalid S3 prefix identity/);
  assert.equal(f.calls.at(-1).service + '/' + f.calls.at(-1).operation, key);
});
for (const operation of ['get-parameter', 'describe-images', 'describe-instance-types', 'describe-managed-prefix-lists']) {
  test(`checkout changes during ${operation} refuse before the next setup read`, async t => {
    const f = setupFixture(t), call = f.aws.call;
    f.aws.call = async (service, name, input) => {
      const response = await call(service, name, input);
      if (name === operation) writeFileSync(join(f.root, 'controller.txt'), 'changed during discovery\n');
      return response;
    };
    await assert.rejects(discover(f), /D570 controller refused/);
    assert.equal(f.calls.at(-1).operation, operation);
  });
}

for (const [service, operation] of [['ssm', 'get-parameter'], ['ec2', 'describe-images'],
  ['ec2', 'describe-instance-types'], ['ec2', 'describe-managed-prefix-lists']]) {
  test(`CLI permits only the regional read ${service}/${operation} for setup discovery`, async t => {
    const f = fixture(t), executable = join(f.root, 'aws-read'), capture = join(f.root, 'read.json');
    writeFileSync(executable, `#!${process.execPath}\nimport('node:fs').then(fs => { fs.writeFileSync(${JSON.stringify(capture)},
      JSON.stringify(process.argv.slice(2))); process.stdout.write('{}'); });\n`, { mode: 0o700 });
    assert.deepEqual(await control.createManualAwsCli({ executable }).call(service, operation, {}), {});
    const args = JSON.parse(readFileSync(capture));
    assert.deepEqual(args.slice(0, 6), [service, operation, '--cli-input-json', '{}', '--region', 'eu-north-1']);
  });
}
for (const operation of ['get-parameter', 'describe-images', 'describe-instance-types', 'describe-managed-prefix-lists']) {
  test(`midnight during ${operation} cannot yield a setup based on yesterday's bill`, async t => {
    const f = setupFixture(t), call = f.aws.call; let at = Date.parse(now);
    f.aws.call = async (service, name, input) => {
      const response = await call(service, name, input);
      if (name === operation) at = Date.parse('2026-11-07T00:00:00Z');
      return response;
    };
    await assert.rejects(discover(f, { clock: () => at }), /D570 controller refused/);
    assert.equal(f.calls.at(-1).operation, operation);
  });
}


// Accepting a stale or foreign heartbeat would initialize spending without this stack's expiry protection.
function protectionFixture(t) {
  const f = fixture(t);
  const stackId = 'arn:aws:cloudformation:eu-north-1:462991287391:stack/d570-first/00000000-0000-4000-8000-000000000000';
  const resources = [
    ['Bucket', 'd570-first-bucket', 'AWS::S3::Bucket'],
    ['ExpiryRule', 'd570-first-rule', 'AWS::Events::Rule'],
    ['ExpiryFunction', 'd570-first-function', 'AWS::Lambda::Function'],
  ].map(([LogicalResourceId, PhysicalResourceId, ResourceType]) => ({ StackId: stackId, StackName: 'd570-first',
    LogicalResourceId, PhysicalResourceId, ResourceType, ResourceStatus: 'CREATE_COMPLETE', Timestamp: now }));
  const functionArn = 'arn:aws:lambda:eu-north-1:462991287391:function:d570-first-function';
  const health = { schema: 'd570-sweep-v1', account: '462991287391', region: 'eu-north-1', stackId,
    startedAt: '2026-11-06T11:59:00.000Z', completedAt: '2026-11-06T11:59:01.000Z',
    terminationRequested: [], volumeDeletionRequested: [] };
  const responses = {
    'cloudformation/describe-stacks': { Stacks: [{ StackId: stackId, StackName: 'd570-first', StackStatus: 'CREATE_COMPLETE' }] },
    'cloudformation/describe-stack-resources': { StackResources: resources },
    'events/describe-rule': { Name: 'd570-first-rule', Arn: 'arn:aws:events:eu-north-1:462991287391:rule/d570-first-rule',
      State: 'ENABLED', ScheduleExpression: 'rate(1 minute)' },
    'events/list-targets-by-rule': { Targets: [{ Id: 'D570Expiry', Arn: functionArn,
      RetryPolicy: { MaximumEventAgeInSeconds: 60, MaximumRetryAttempts: 0 } }] },
    's3api/get-object': { Body: Buffer.from(JSON.stringify(health)), ServerSideEncryption: 'AES256',
      ContentType: 'application/json', LastModified: '2026-11-06T11:59:01.000Z' },
  };
  const prior = f.aws.call;
  f.aws.call = async (service, operation, input) => {
    const key = service + '/' + operation;
    if (Object.hasOwn(responses, key)) { f.calls.push({ service, operation, input }); return responses[key]; }
    return prior(service, operation, input);
  };
  const observe = (changes = {}) => {
    assert.equal(typeof control.inspectManualProtection, 'function', 'missing independent protection observation');
    return control.inspectManualProtection({ checkout: f.root, region: 'eu-north-1', now, aws: f.aws,
      environment: {}, clock: () => Date.parse(now), stackId, ...changes });
  };
  return { ...f, responses, health, stackId, observe, resource: resources };
}

test('armed stack sweep is read from its actual bucket and retained without claiming completed cleanup', async t => {
  const f = protectionFixture(t), result = await f.observe();
  assert.deepEqual(result, { account: '462991287391', region: 'eu-north-1', head: f.head, tree: f.tree,
    billing: { observedAt: now, period, microUsd: 1234568, estimated: true }, stackId: f.stackId,
    bucket: 'd570-first-bucket', heartbeat: f.health });
  assert.deepEqual(f.calls.slice(2), [
    { service: 'cloudformation', operation: 'describe-stacks', input: { StackName: f.stackId } },
    { service: 'cloudformation', operation: 'describe-stack-resources', input: { StackName: f.stackId } },
    { service: 'events', operation: 'describe-rule', input: { Name: 'd570-first-rule', EventBusName: 'default' } },
    { service: 'events', operation: 'list-targets-by-rule', input: { Rule: 'd570-first-rule', EventBusName: 'default', Limit: 100 } },
    { service: 's3api', operation: 'get-object', input: { Bucket: 'd570-first-bucket', Key: 'd570/health/reaper.json',
      ExpectedBucketOwner: '462991287391', Range: 'bytes=0-1048576' } },
  ]);
  assert.equal(Object.hasOwn(result, 'terminated'), false);
});

for (const [label, mutate] of [
  ['missing stack', f => f.responses['cloudformation/describe-stacks'].Stacks = []],
  ['duplicate stack', f => f.responses['cloudformation/describe-stacks'].Stacks.push(f.responses['cloudformation/describe-stacks'].Stacks[0])],
  ['foreign stack response', f => f.responses['cloudformation/describe-stacks'].Stacks[0].StackId += '-foreign'],
  ['changing stack', f => f.responses['cloudformation/describe-stacks'].Stacks[0].StackStatus = 'UPDATE_IN_PROGRESS'],
  ['missing resource', f => f.resource.pop()],
  ['duplicate resource', f => f.resource.push(f.resource[0])],
  ['foreign stack', f => f.resource[0].StackId = f.stackId.replace('462991287391', '949687825720')],
  ['wrong resource type', f => f.resource[0].ResourceType = 'AWS::EC2::Instance'],
  ['partial setup', f => f.resource[0].ResourceStatus = 'CREATE_IN_PROGRESS'],
  ['rollback', f => f.resource[0].ResourceStatus = 'UPDATE_ROLLBACK_COMPLETE'],
  ['invalid bucket', f => f.resource[0].PhysicalResourceId = '../foreign'],
  ['invalid rule', f => f.resource[1].PhysicalResourceId = 'foreign/rule'],
  ['invalid function', f => f.resource[2].PhysicalResourceId = 'foreign:function'],
  ['partial resource inventory', f => f.responses['cloudformation/describe-stack-resources'].NextToken = 'more'],
  ['disabled rule', f => f.responses['events/describe-rule'].State = 'DISABLED'],
  ['foreign rule', f => f.responses['events/describe-rule'].Arn = 'arn:aws:events:eu-north-1:949687825720:rule/d570-first-rule'],
  ['wrong rule name', f => f.responses['events/describe-rule'].Name = 'another-rule'],
  ['slow schedule', f => f.responses['events/describe-rule'].ScheduleExpression = 'rate(5 minutes)'],
  ['foreign event bus', f => f.responses['events/describe-rule'].EventBusName = 'other'],
  ['event-pattern rule', f => f.responses['events/describe-rule'].EventPattern = '{}'],
  ['missing target', f => f.responses['events/list-targets-by-rule'].Targets = []],
  ['extra target', f => f.responses['events/list-targets-by-rule'].Targets.push(f.responses['events/list-targets-by-rule'].Targets[0])],
  ['foreign function', f => f.responses['events/list-targets-by-rule'].Targets[0].Arn += '-foreign'],
  ['wrong target identity', f => f.responses['events/list-targets-by-rule'].Targets[0].Id = 'Other'],
  ['changed target payload', f => f.responses['events/list-targets-by-rule'].Targets[0].Input = '{}'],
  ['delayed target', f => f.responses['events/list-targets-by-rule'].Targets[0].RetryPolicy.MaximumEventAgeInSeconds = 3600],
  ['retrying target', f => f.responses['events/list-targets-by-rule'].Targets[0].RetryPolicy.MaximumRetryAttempts = 10],
  ['partial target inventory', f => f.responses['events/list-targets-by-rule'].NextToken = 'more'],
]) test(`${label} cannot establish this stack's armed protection`, async t => {
  const f = protectionFixture(t); mutate(f);
  await assert.rejects(f.observe(), /D570 controller refused/);
  assert.equal(f.calls.some(call => call.service === 's3api'), false);
});

for (const [label, mutate] of [
  ['wrong health schema', h => h.schema = 'another'],
  ['foreign health account', h => h.account = '949687825720'],
  ['foreign health region', h => h.region = 'eu-south-2'],
  ['foreign health stack', h => h.stackId += '-foreign'],
  ['missing start', h => delete h.startedAt],
  ['invalid time', h => h.startedAt = '2026-02-30T11:59:00.000Z'],
  ['stale start', h => h.startedAt = '2026-11-06T11:58:00.000Z'],
  ['future completion', h => h.completedAt = '2026-11-06T12:00:00.001Z'],
  ['backwards sweep', h => h.completedAt = '2026-11-06T11:58:59.999Z'],
  ['missing termination observations', h => delete h.terminationRequested],
  ['unknown disk observations', h => h.volumeDeletionRequested = null],
  ['invalid termination identity', h => h.terminationRequested = ['i-foreign']],
  ['duplicate termination identity', h => h.terminationRequested = ['i-11111111111111111', 'i-11111111111111111']],
  ['invalid disk identity', h => h.volumeDeletionRequested = ['vol-foreign']],
]) test(`${label} cannot establish a fresh successful sweep`, async t => {
  const f = protectionFixture(t); mutate(f.health);
  if (label === 'future completion') f.responses['s3api/get-object'].LastModified = now;
  f.responses['s3api/get-object'].Body = Buffer.from(JSON.stringify(f.health));
  await assert.rejects(f.observe(), /D570 controller refused/);
});

for (const [label, change] of [
  ['missing heartbeat body', r => delete r.Body],
  ['malformed heartbeat', r => r.Body = Buffer.from('{')],
  ['oversized heartbeat', r => r.Body = Buffer.alloc(1048577)],
  ['unencrypted heartbeat', r => delete r.ServerSideEncryption],
  ['wrong content type', r => r.ContentType = 'text/plain'],
  ['future object', r => r.LastModified = '2026-11-06T12:00:00.001Z'],
  ['stale object', r => r.LastModified = '2026-11-06T11:58:00.000Z'],
]) test(`${label} refuses protection rather than inventing health`, async t => {
  const f = protectionFixture(t); change(f.responses['s3api/get-object']);
  await assert.rejects(f.observe(), /D570 controller refused/);
});

test('observed sweep requests stay requests and do not establish that the resources disappeared', async t => {
  const f = protectionFixture(t);
  f.health.terminationRequested = ['i-11111111111111111'];
  f.health.volumeDeletionRequested = ['vol-11111111111111111'];
  f.responses['s3api/get-object'].Body = Buffer.from(JSON.stringify(f.health));
  const result = await f.observe();
  assert.deepEqual(result.heartbeat, f.health);
  assert.equal(Object.hasOwn(result, 'volumesAbsent'), false);
});

test('heartbeat ageing across a provider wait cannot initialize protected spending', async t => {
  const f = protectionFixture(t); let at = Date.parse(now);
  const prior = f.aws.call;
  f.aws.call = async (...args) => { const result = await prior(...args); if (args[0] === 's3api') at += 61000; return result; };
  await assert.rejects(f.observe({ clock: () => at }), /D570 controller refused/);
});

test('a checkout changed while reading the heartbeat cannot establish health', async t => {
  const f = protectionFixture(t), prior = f.aws.call;
  f.aws.call = async (...args) => { const result = await prior(...args);
    if (args[0] === 's3api') writeFileSync(join(f.root, 'controller.txt'), 'changed heartbeat reader\n'); return result; };
  await assert.rejects(f.observe(), /D570 controller refused/);
  assert.equal(f.calls.at(-1).operation, 'get-object');
});

for (const stackId of ['d570-first', 'arn:aws:cloudformation:eu-north-1:949687825720:stack/d570/00000000-0000-4000-8000-000000000000']) {
  test(`unbound stack identity refuses before provider access: ${stackId}`, async t => {
    const f = protectionFixture(t);
    await assert.rejects(f.observe({ stackId }), /D570 controller refused/);
    assert.deepEqual(f.calls, []);
  });
}


for (const [service, operation] of [['cloudformation', 'describe-stacks'], ['cloudformation', 'describe-stack-resources'], ['events', 'describe-rule'], ['events', 'list-targets-by-rule']]) {
  test(`CLI admits only the required protection read ${service}/${operation}`, async t => {
    const f = fixture(t), executable = join(f.root, 'aws-read'), capture = join(f.root, 'read.json');
    writeFileSync(executable, `#!${process.execPath}\nimport('node:fs').then(fs => {
      fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify(process.argv.slice(2)));
      process.stdout.write('{"observed":true}'); });\n`, { mode: 0o700 });
    assert.deepEqual(await control.createManualAwsCli({ executable }).call(service, operation, {}), { observed: true });
    const args = JSON.parse(readFileSync(capture));
    assert.deepEqual(args.slice(0, 6), [service, operation, '--cli-input-json', '{}', '--region', 'eu-north-1']);
    for (const mutation of ['create-stack', 'enable-rule', 'put-targets']) await assert.rejects(
      control.createManualAwsCli({ executable }).call(service, mutation, {}), /D570 controller refused/);
  });
}

function heartbeatCliFixture(t, { length = 11, contentLength = length, contentRange = `bytes 0-${length - 1}/${length}`, fail = false, missing = false } = {}) {
  const f = fixture(t), executable = join(f.root, 'aws-object'), capture = join(f.root, 'object.json');
  writeFileSync(executable, `#!${process.execPath}\nimport('node:fs').then(fs => {
    const args = process.argv.slice(2), path = args.at(-1);
    fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({ args, path, directoryMode: fs.statSync(path.slice(0, path.lastIndexOf('/'))).mode & 511,
      fileMode: fs.statSync(path).mode & 511 }));
    if (${fail}) { process.stderr.write('private heartbeat diagnostic'); process.exit(1); }
    if (!${missing}) fs.writeFileSync(path, Buffer.alloc(${length}, 97));
    process.stdout.write(JSON.stringify({ ContentLength: ${contentLength}, ContentRange: ${JSON.stringify(contentRange)},
      ServerSideEncryption: 'AES256', ContentType: 'application/json', LastModified: '2026-11-06T11:59:01+00:00' }));
  });\n`, { mode: 0o700 });
  return { ...f, executable, capture, input: { Bucket: 'd570-first-bucket', Key: 'd570/health/reaper.json',
    ExpectedBucketOwner: '462991287391', Range: 'bytes=0-1048576' } };
}

test('CLI downloads the bounded heartbeat privately and removes its own files before returning', async t => {
  const f = heartbeatCliFixture(t), result = await control.createManualAwsCli({ executable: f.executable }).call('s3api', 'get-object', f.input);
  assert.deepEqual(result.Body, Buffer.from('aaaaaaaaaaa'));
  assert.equal(result.LastModified, '2026-11-06T11:59:01Z');
  const saved = JSON.parse(readFileSync(f.capture));
  assert.equal(saved.directoryMode, 0o700); assert.equal(saved.fileMode, 0o600);
  assert.deepEqual(saved.args.slice(0, 12), ['s3api', 'get-object', '--bucket', 'd570-first-bucket',
    '--key', 'd570/health/reaper.json', '--expected-bucket-owner', '462991287391',
    '--range', 'bytes=0-1048576', '--region', 'eu-north-1']);
  assert.equal(saved.args.at(-2), '15');
  assert.equal(existsSync(saved.path), false);
  assert.equal(existsSync(saved.path.slice(0, saved.path.lastIndexOf('/'))), false);
});

for (const [label, options] of [
  ['partial heartbeat range', { contentRange: 'bytes 0-10/2000000' }],
  ['missing range', { contentRange: null }],
  ['contradictory length', { contentLength: 12 }],
  ['oversized body', { length: 1048577 }],
  ['missing body', { missing: true }],
  ['provider failure', { fail: true }],
]) test(`CLI ${label} refuses and removes only its own download`, async t => {
  const f = heartbeatCliFixture(t, options);
  await assert.rejects(control.createManualAwsCli({ executable: f.executable }).call('s3api', 'get-object', f.input),
    error => error.message === 'D570 AWS s3api/get-object failed');
  const saved = JSON.parse(readFileSync(f.capture));
  assert.equal(existsSync(saved.path.slice(0, saved.path.lastIndexOf('/'))), false);
});

for (const [label, changes] of [
  ['foreign owner', { ExpectedBucketOwner: '949687825720' }], ['foreign key', { Key: 'other/key' }],
  ['unbounded body', { Range: undefined }], ['extra S3 option', { VersionId: 'other-version' }],
]) test(`CLI refuses ${label} before any object command`, async t => {
  const f = heartbeatCliFixture(t);
  await assert.rejects(control.createManualAwsCli({ executable: f.executable }).call('s3api', 'get-object', { ...f.input, ...changes }), /D570 controller refused/);
  assert.equal(existsSync(f.capture), false);
});


async function historyFixture(t) {
  const f = protectionFixture(t), objects = new Map(), writes = [];
  const budget = await import('./kubernetes-proof-budget.mjs');
  const scope = { account: '462991287391', region: 'eu-north-1', stackId: f.stackId };
  const store = {
    async list() { return [...objects.keys()]; },
    async get(key) { const row = objects.get(key); return row && { body: Buffer.from(row.body), etag: row.etag }; },
    async put(key, body, condition) {
      const row = objects.get(key);
      assert.ok(condition.ifNoneMatch === '*' ? !row : row?.etag === condition.ifMatch);
      const etag = '"' + (writes.length + 1) + '"';
      objects.set(key, { body: Buffer.from(body), etag }); writes.push(key); return { etag };
    },
  };
  const components = Object.fromEntries(['compute', 'disk', 'storage', 'requests', 'transfer', 'events',
    'lambda', 'logs', 'network', 'tax', 'contingency'].map(key => [key, { upperMicroUsd: 10000,
      source: 'https://aws.amazon.com/pricing/', digest: 'c'.repeat(64) }]));
  await budget.initializeLedger({ scope, now, store, evidence: { observedAt: now, account: scope.account, region: scope.region, currency: 'USD', pricesReconciled: true, billingReconciled: true,
    protectionHealthy: true, components, openings: { '2026-11': { baselineMicroUsd: 1234568,
      overheadMicroUsd: 200000, digest: 'd'.repeat(64) } } } });
  function inspect(changes = {}) {
    assert.equal(typeof control.inspectManualBudget, 'function', 'missing manual retained-history check');
    return control.inspectManualBudget({ checkout: f.root, region: 'eu-north-1', now, aws: f.aws,
      environment: {}, clock: () => Date.parse(now), stackId: f.stackId, store, ...changes });
  }
  return { ...f, store, objects, writes, inspect };
}

test('manual budget keeps the estimated bill and original opening without settling or writing history', async t => {
  const f = await historyFixture(t), before = structuredClone([...f.objects]), writes = f.writes.length;
  const result = await f.inspect();
  assert.equal(result.billing.estimated, true);
  assert.deepEqual(result.budget, { month: '2026-11', baselineMicroUsd: 1234568, overheadMicroUsd: 200000,
    bookedMicroUsd: 0, completedMicroUsd: 0, billingMicroUsd: 1234568, activeUuid: null });
  assert.equal(result.stackId, f.stackId); assert.equal(result.bucket, 'd570-first-bucket');
  assert.equal(f.writes.length, writes); assert.deepEqual(structuredClone([...f.objects]), before);
});

for (const [label, mutate] of [
  ['lost history', f => f.objects.clear()],
  ['foreign history', f => { const key = 'd570/ledger/2026-11.json', row = f.objects.get(key);
    const value = JSON.parse(row.body); value.scope.stackId += '-foreign'; row.body = Buffer.from(JSON.stringify(value)); }],
  ['unexplained billing', f => { const call = f.aws.call; f.aws.call = async (...args) => {
    const response = await call(...args); if (args[0] === 'ce') response.ResultsByTime[0].Total.UnblendedCost.Amount = '1.434569';
    return response; }; }],
]) test(`manual budget refuses ${label} without initializing replacement history`, async t => {
  const f = await historyFixture(t); mutate(f); const before = structuredClone([...f.objects]);
  await assert.rejects(f.inspect(), /budget|controller/i);
  assert.deepEqual(structuredClone([...f.objects]), before);
});

test('manual budget does not read retained billing history before protection is healthy', async t => {
  const f = await historyFixture(t); f.responses['events/describe-rule'].State = 'DISABLED';
  let reads = 0; f.store.get = async () => { reads++; assert.fail('unprotected ledger read'); };
  await assert.rejects(f.inspect(), /controller/i); assert.equal(reads, 0);
});

test('manual budget refuses a source change while waiting for the retained history', async t => {
  const f = await historyFixture(t), prior = f.store.get;
  f.store.get = async key => { const row = await prior(key);
    writeFileSync(join(f.root, 'controller.txt'), 'changed during history read\n'); return row; };
  await assert.rejects(f.inspect(), /controller/i);
});

test('manual budget refuses a heartbeat which aged out during its history reads', async t => {
  const f = await historyFixture(t); let at = Date.parse(now); const prior = f.store.get;
  f.store.get = async key => { const row = await prior(key); at = Date.parse(now) + 61000; return row; };
  await assert.rejects(f.inspect({ clock: () => at }), /controller/i);
});


test('manual budget refuses clean main advancing while retained history is read', async t => {
  const f = await historyFixture(t), prior = f.store.get; let changed = false;
  f.store.get = async key => {
    const row = await prior(key);
    if (!changed) {
      changed = true; writeFileSync(join(f.root, 'controller.txt'), 'new reviewed main\n');
      f.git('add', 'controller.txt'); f.git('-c', 'commit.gpgsign=false', 'commit', '-s', '-m', 'Advance isolated remote main');
      f.git('update-ref', 'refs/remotes/origin/main', f.git('rev-parse', 'HEAD'));
    }
    return row;
  };
  await assert.rejects(f.inspect(), /controller/i);
});

function ledgerCliFixture(t, errorCode = '', errorPrefix = '') {
  const f = fixture(t), executable = join(f.root, 'aws-ledger'), capture = join(f.root, 'ledger-call.json');
  writeFileSync(executable, `#!${process.execPath}
    const fs = require('node:fs'), args = process.argv.slice(2);
    const input = args.includes('--cli-input-json') ? JSON.parse(args[3]) : Object.fromEntries([
      ['Bucket', '--bucket'], ['Key', '--key'], ['ExpectedBucketOwner', '--expected-bucket-owner'], ['Range', '--range']
    ].map(([name, flag]) => [name, args[args.indexOf(flag) + 1]])), path = args.at(-1);
    const saved = { args, input };
    if (args[1] === 'put-object') {
      const body = args[args.indexOf('--body') + 1];
      saved.body = fs.readFileSync(body, 'utf8'); saved.path = body;
      saved.mode = fs.statSync(body).mode & 511;
      saved.directoryMode = fs.statSync(require('node:path').dirname(body)).mode & 511;
    } else if (args[1] === 'get-object') saved.path = path;
    fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify(saved));
    if (${JSON.stringify(errorCode)}) {
      process.stderr.write(${JSON.stringify(errorPrefix)} + 'An error occurred (' + ${JSON.stringify(errorCode)} + ') when calling the ' +
        (args[1] === 'get-object' ? 'GetObject' : 'PutObject') + ' operation: private diagnostic'); process.exit(254);
    }
    if (args[1] === 'get-object') {
      fs.writeFileSync(path, '{"saved":true}');
      process.stdout.write(JSON.stringify({ ETag: '"original"', ContentLength: 14, ContentRange: 'bytes 0-13/14',
        ServerSideEncryption: 'AES256', ContentType: 'application/json', LastModified: '2026-11-06T11:59:01Z' }));
    } else if (args[1] === 'put-object') process.stdout.write(JSON.stringify({ ETag: '"updated"' }));
    else process.stdout.write('{"Contents":[{"Key":"d570/ledger/active.json"}],"IsTruncated":false}');
  `, { mode: 0o700 });
  const cli = control.createManualAwsCli({ executable });
  const input = { Bucket: 'd570-first-bucket', ExpectedBucketOwner: '462991287391' };
  return { ...f, executable, capture, cli, input };
}

test('CLI reads the complete retained ledger privately with its original entity tag', async t => {
  const f = ledgerCliFixture(t), result = await f.cli.call('s3api', 'get-object', {
    ...f.input, Key: 'd570/ledger/active.json', Range: 'bytes=0-1048576' });
  assert.deepEqual(result.Body, Buffer.from('{"saved":true}')); assert.equal(result.ETag, '"original"');
  const saved = JSON.parse(readFileSync(f.capture));
  assert.equal(existsSync(saved.path), false);
});

for (const condition of [{ IfNoneMatch: '*' }, { IfMatch: '"original"' }]) {
  test(`CLI retains encrypted conditional ledger writes ${JSON.stringify(condition)} privately`, async t => {
    const f = ledgerCliFixture(t), result = await f.cli.call('s3api', 'put-object', {
      ...f.input, Key: 'd570/ledger/2026-11.json', Body: Buffer.from('{"booked":true}'),
      ContentType: 'application/json', ServerSideEncryption: 'AES256', ...condition });
    assert.equal(result.ETag, '"updated"');
    const saved = JSON.parse(readFileSync(f.capture));
    assert.equal(saved.body, '{"booked":true}'); assert.equal(saved.mode, 0o600); assert.equal(saved.directoryMode, 0o700);
    assert.equal(saved.input.ExpectedBucketOwner, '462991287391');
    assert.equal(saved.input.ContentType, 'application/json'); assert.equal(saved.input.ServerSideEncryption, 'AES256');
    assert.equal(saved.input[Object.keys(condition)[0]], Object.values(condition)[0]);
    assert.equal(Object.hasOwn(saved.input, 'Body'), false, 'streaming upload must use the CLI body argument');
    assert.equal(saved.args[saved.args.indexOf('--body') + 1], saved.path);
    assert.equal(existsSync(saved.path), false);
    assert.equal(existsSync(join(saved.path, '..')), false);
  });
}

test('CLI lists only the retained ledger prefix and preserves the pagination token', async t => {
  const f = ledgerCliFixture(t), input = { ...f.input, Prefix: 'd570/ledger/', MaxKeys: 100, ContinuationToken: 'next-page' };
  assert.deepEqual(await f.cli.call('s3api', 'list-objects-v2', input), {
    Contents: [{ Key: 'd570/ledger/active.json' }], IsTruncated: false });
  assert.deepEqual(JSON.parse(readFileSync(f.capture)).input, input);
});

test('CLI distinguishes a missing ledger key from denied or uncertain reads', async t => {
  const missing = ledgerCliFixture(t, 'NoSuchKey');
  await assert.rejects(missing.cli.call('s3api', 'get-object', { ...missing.input, Key: 'd570/ledger/active.json', Range: 'bytes=0-1048576' }),
    error => error.name === 'NoSuchKey' && error.$metadata?.httpStatusCode === 404);
  assert.equal(existsSync(JSON.parse(readFileSync(missing.capture)).path), false);
  const denied = ledgerCliFixture(t, 'AccessDenied');
  await assert.rejects(denied.cli.call('s3api', 'get-object', { ...denied.input, Key: 'd570/ledger/active.json', Range: 'bytes=0-1048576' }),
    error => error.name !== 'NoSuchKey' && !error.message.includes('private diagnostic'));
  assert.equal(existsSync(JSON.parse(readFileSync(denied.capture)).path), false);
});

test('CLI retains a rejected conditional write and removes the private upload', async t => {
  const f = ledgerCliFixture(t, 'PreconditionFailed');
  await assert.rejects(f.cli.call('s3api', 'put-object', { ...f.input, Key: 'd570/ledger/active.json', Body: Buffer.from('{}'),
    ContentType: 'application/json', ServerSideEncryption: 'AES256', IfNoneMatch: '*' }),
    error => error.message === 'D570 AWS s3api/put-object failed');
  assert.equal(existsSync(JSON.parse(readFileSync(f.capture)).path), false);
});

test('manual budget reads the stack-discovered live ledger when no test store is supplied', async t => {
  const f = await historyFixture(t), prior = f.aws.call;
  f.aws.call = async (service, operation, input) => {
    if (service === 's3api' && operation === 'list-objects-v2') {
      assert.equal(input.Bucket, 'd570-first-bucket'); assert.equal(input.ExpectedBucketOwner, '462991287391');
      assert.equal(input.Prefix, 'd570/ledger/'); assert.equal(input.MaxKeys, 100);
      return { Contents: (await f.store.list()).map(Key => ({ Key })), IsTruncated: false };
    }
    if (service !== 's3api' || operation !== 'get-object' || input.Key === 'd570/health/reaper.json') return prior(service, operation, input);
    assert.equal(input.Bucket, 'd570-first-bucket'); assert.equal(input.ExpectedBucketOwner, '462991287391');
    assert.equal(input.Range, 'bytes=0-1048576');
    const row = await f.store.get(input.Key);
    return { Body: row.body, ETag: row.etag, ContentLength: row.body.length };
  };
  const result = await f.inspect({ store: undefined });
  assert.equal(result.budget.baselineMicroUsd, 1234568); assert.equal(result.budget.activeUuid, null);
});

for (const [label, change] of [
  ['foreign owner', { ExpectedBucketOwner: '949687825720' }],
  ['foreign key', { Key: 'd570/health/reaper.json' }],
  ['invalid month', { Key: 'd570/ledger/2026-13.json' }],
  ['missing condition', { IfNoneMatch: undefined }],
  ['wildcard update', { IfNoneMatch: undefined, IfMatch: '*' }],
  ['contradictory conditions', { IfMatch: '"old"' }],
  ['public ACL', { ACL: 'public-read' }],
  ['unencrypted write', { ServerSideEncryption: undefined }],
  ['foreign encryption', { ServerSideEncryption: 'aws:kms' }],
  ['wrong content type', { ContentType: 'text/plain' }],
  ['oversized upload', { Body: Buffer.alloc(1048577) }],
  ['empty upload', { Body: Buffer.alloc(0) }],
  ['file path upload', { Body: '/private/file' }],
]) test(`CLI ledger ${label} refuses before starting a provider command`, async t => {
  const f = ledgerCliFixture(t);
  const input = { ...f.input, Key: 'd570/ledger/active.json', Body: Buffer.from('{}'),
    IfNoneMatch: '*', ContentType: 'application/json', ServerSideEncryption: 'AES256', ...change };
  for (const key of Object.keys(input)) if (input[key] === undefined) delete input[key];
  await assert.rejects(f.cli.call('s3api', 'put-object', input), /D570 controller refused/);
  assert.equal(existsSync(f.capture), false);
});

for (const change of [{ Prefix: '' }, { MaxKeys: 1000 }, { ContinuationToken: '' }, { Delimiter: '/' }]) {
  test(`CLI ledger listing refuses a wider or partial inventory ${JSON.stringify(change)}`, async t => {
    const f = ledgerCliFixture(t);
    await assert.rejects(f.cli.call('s3api', 'list-objects-v2', {
      ...f.input, Prefix: 'd570/ledger/', MaxKeys: 100, ...change }), /D570 controller refused/);
    assert.equal(existsSync(f.capture), false);
  });
}

test('missing live ledger remains missing and cannot initialize replacement history', async t => {
  const f = protectionFixture(t), prior = f.aws.call;
  f.aws.call = async (service, operation, input) => {
    if (service === 's3api' && input.Key === 'd570/ledger/active.json') {
      throw Object.assign(new Error('missing'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
    }
    return prior(service, operation, input);
  };
  await assert.rejects(control.inspectManualBudget({ checkout: f.root, region: 'eu-north-1', now, aws: f.aws,
    environment: {}, clock: () => Date.parse(now), stackId: f.stackId }), /D570 budget refused/);
  assert.equal(f.calls.some(call => call.operation === 'put-object'), false);
});

test('manual ledger storage connects the reservation core to conditional CLI writes', async t => {
  const f = ledgerCliFixture(t);
  assert.equal(typeof control.createManualLedgerStore, 'function', 'missing live manual ledger storage');
  const store = control.createManualLedgerStore({ bucket: f.input.Bucket, aws: f.cli });
  assert.deepEqual(await store.get('d570/ledger/active.json'), { body: Buffer.from('{"saved":true}'), etag: '"original"' });
  assert.deepEqual(await store.put('d570/ledger/active.json', Buffer.from('{"reserved":true}'), { ifMatch: '"original"' }), { etag: '"updated"' });
  const saved = JSON.parse(readFileSync(f.capture));
  assert.equal(saved.body, '{"reserved":true}'); assert.equal(saved.input.IfMatch, '"original"');
  assert.equal(saved.input.ExpectedBucketOwner, '462991287391'); assert.equal(saved.input.Bucket, 'd570-first-bucket');
});

test('CLI recognizes the AWS 2 error envelope without treating access denial as absence', async t => {
  const f = ledgerCliFixture(t, 'NoSuchKey', '\naws: [ERROR]: ');
  const store = control.createManualLedgerStore({ bucket: f.input.Bucket, aws: f.cli });
  assert.equal(await store.get('d570/ledger/active.json'), null);
  const denied = ledgerCliFixture(t, 'AccessDenied', '\naws: [ERROR]: ');
  await assert.rejects(control.createManualLedgerStore({ bucket: denied.input.Bucket, aws: denied.cli }).get('d570/ledger/active.json'),
    error => error.message === 'D570 AWS s3api/get-object failed');
});

// Overwriting or losing the pre-creation booking would allow setup costs to be forgotten.
function setupBookingFixture(t) {
  const f = setupFixture(t), parent = mkdtempSync(join(tmpdir(), 'd570-booking-'));
  chmodSync(parent, 0o700);
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const components = Object.fromEntries(['compute', 'disk', 'storage', 'requests', 'transfer', 'events',
    'lambda', 'logs', 'network', 'tax', 'contingency'].map(name => [name, {
    upperMicroUsd: 10000, source: 'https://aws.amazon.com/pricing/', digest: 'c'.repeat(64),
  }]));
  const options = { checkout: f.root, region: 'eu-north-1', now, aws: f.aws, environment: {},
    clock: () => Date.parse(now), directory: join(parent, 'setup'), cost: { observedAt: now, components } };
  async function book(changes = {}) {
    assert.equal(typeof control.bookManualSetup, 'function', 'missing durable pre-creation setup booking');
    return control.bookManualSetup({ ...options, ...changes });
  }
  return { ...f, parent, options, book };
}

test('setup booking retains the full bound and actual estimated opening privately before creation', async t => {
  const f = setupBookingFixture(t), result = await f.book();
  const saved = JSON.parse(readFileSync(join(f.options.directory, 'setup.json')));
  assert.equal(statSync(f.options.directory).mode & 0o777, 0o700);
  assert.equal(statSync(join(f.options.directory, 'setup.json')).mode & 0o777, 0o600);
  assert.equal(saved.account, '462991287391'); assert.equal(saved.region, 'eu-north-1');
  assert.equal(saved.head, f.head); assert.equal(saved.tree, f.tree);
  assert.equal(saved.billing.microUsd, 1234568); assert.equal(saved.billing.estimated, true);
  assert.equal(saved.upperMicroUsd, 110000);
  assert.deepEqual(saved.cost, f.options.cost);
  assert.deepEqual(saved.template, result.template);
  assert.equal(result.directory, f.options.directory);
  assert.deepEqual(f.calls.map(row => row.operation), ['get-caller-identity', 'get-cost-and-usage', 'get-parameter',
    'describe-images', 'describe-instance-types', 'describe-managed-prefix-lists']);
});

for (const [label, change] of [
  ['missing category', c => delete c.components.tax],
  ['unexpected category', c => c.components.credits = c.components.tax],
  ['negative category', c => c.components.tax.upperMicroUsd = -1],
  ['fractional category', c => c.components.tax.upperMicroUsd = 0.1],
  ['unsafe category', c => c.components.tax.upperMicroUsd = Number.MAX_SAFE_INTEGER + 1],
  ['unexplained zero', c => c.components.tax.upperMicroUsd = 0],
  ['missing source', c => delete c.components.tax.source],
  ['foreign source', c => c.components.tax.source = 'https://example.invalid/pricing/'],
  ['source credentials', c => c.components.tax.source = 'https://private@aws.amazon.com/pricing/'],
  ['missing source digest', c => delete c.components.tax.digest],
  ['malformed source digest', c => c.components.tax.digest = 'not-a-sha256'],
  ['stale cost', c => c.observedAt = '2026-11-05T12:00:00Z'],
  ['future cost', c => c.observedAt = '2026-11-06T12:00:01Z'],
]) test(`setup booking refuses ${label} without provider reads or local booking`, async t => {
  const f = setupBookingFixture(t), cost = structuredClone(f.options.cost); change(cost);
  await assert.rejects(f.book({ cost }), /D570 controller refused/);
  assert.deepEqual(f.calls, []); assert.equal(existsSync(f.options.directory), false);
});

test('setup booking includes the actual opening in the strict twenty-dollar cap', async t => {
  const f = setupBookingFixture(t);
  f.options.cost.components.compute.upperMicroUsd = 18665432;
  await assert.rejects(f.book(), /D570 controller refused/);
  assert.equal(existsSync(f.options.directory), false);
});

test('repeated setup booking never replaces or refunds a retained booking', async t => {
  const f = setupBookingFixture(t); await f.book();
  const path = join(f.options.directory, 'setup.json'), before = readFileSync(path);
  f.options.cost.components.compute.upperMicroUsd = 1;
  await assert.rejects(f.book());
  assert.deepEqual(readFileSync(path), before);
});

for (const kind of ['empty directory', 'foreign file', 'symlink']) test(`setup booking refuses an existing ${kind}`, async t => {
  const f = setupBookingFixture(t);
  if (kind === 'symlink') symlinkSync(f.parent, f.options.directory);
  else if (kind === 'foreign file') writeFileSync(f.options.directory, 'preserve');
  else mkdirSync(f.options.directory, { mode: 0o700 });
  await assert.rejects(f.book());
  if (kind === 'foreign file') assert.equal(readFileSync(f.options.directory, 'utf8'), 'preserve');
});

test('setup booking refuses a parent readable by other users', async t => {
  const f = setupBookingFixture(t); chmodSync(f.parent, 0o755);
  await assert.rejects(f.book(), /D570 controller refused/);
  assert.equal(existsSync(f.options.directory), false);
});

test('setup booking refuses source changes before its durable write', async t => {
  const f = setupBookingFixture(t), original = f.aws.call;
  f.aws.call = async (...args) => {
    const result = await original(...args);
    if (args[1] === 'describe-managed-prefix-lists') writeFileSync(join(f.root, 'controller.txt'), 'changed');
    return result;
  };
  await assert.rejects(f.book(), /D570 controller refused/);
  assert.equal(existsSync(f.options.directory), false);
});

test('concurrent setup bookings retain one original bound without replacement', async t => {
  const f = setupBookingFixture(t);
  const results = await Promise.allSettled([f.book(), f.book()]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(results.filter(row => row.status === 'rejected').length, 1);
  assert.equal(JSON.parse(readFileSync(join(f.options.directory, 'setup.json'))).upperMicroUsd, 110000);
});

for (const stage of ['file', 'directory', 'parent']) test(`setup booking retains its cost when ${stage} synchronization fails`, async t => {
  const f = setupBookingFixture(t), sample = await open(join(f.parent, 'sample'), 'wx', 0o600);
  const prototype = Object.getPrototypeOf(sample); await sample.close();
  const original = prototype.sync; let calls = 0;
  const failAt = { file: 1, directory: 2, parent: 3 }[stage];
  const mocked = t.mock.method(prototype, 'sync', async function () {
    if (++calls === failAt) throw new Error('synthetic synchronization refusal');
    return original.call(this);
  });
  await assert.rejects(f.book(), /synthetic synchronization refusal/);
  mocked.mock.restore();
  const path = join(f.options.directory, 'setup.json'), retained = readFileSync(path);
  assert.equal(JSON.parse(retained).upperMicroUsd, 110000);
  await assert.rejects(f.book());
  assert.deepEqual(readFileSync(path), retained);
});

test('setup booking retains the original bound when the UTC day changes during persistence', async t => {
  const f = setupBookingFixture(t), sample = await open(join(f.parent, 'sample'), 'wx', 0o600);
  const prototype = Object.getPrototypeOf(sample); await sample.close();
  const original = prototype.sync; let current = Date.parse(now);
  t.mock.method(prototype, 'sync', async function () {
    await original.call(this); current = Date.parse('2026-11-07T00:00:00Z');
  });
  await assert.rejects(f.book({ clock: () => current }), /D570 controller refused/);
  assert.equal(JSON.parse(readFileSync(join(f.options.directory, 'setup.json'))).upperMicroUsd, 110000);
});

test('setup booking preserves incomplete bytes when writing fails', async t => {
  const f = setupBookingFixture(t), sample = await open(join(f.parent, 'sample'), 'wx', 0o600);
  const prototype = Object.getPrototypeOf(sample); await sample.close();
  const original = prototype.writeFile;
  const mocked = t.mock.method(prototype, 'writeFile', async function () {
    await original.call(this, '{"partial":'); throw new Error('synthetic write refusal');
  });
  await assert.rejects(f.book(), /synthetic write refusal/); mocked.mock.restore();
  const path = join(f.options.directory, 'setup.json');
  assert.equal(readFileSync(path, 'utf8'), '{"partial":');
  await assert.rejects(f.book());
  assert.equal(readFileSync(path, 'utf8'), '{"partial":');
});

test('setup booking preserves cost and refuses a checkout changed while synchronizing', async t => {
  const f = setupBookingFixture(t), sample = await open(join(f.parent, 'sample'), 'wx', 0o600);
  const prototype = Object.getPrototypeOf(sample); await sample.close();
  const original = prototype.sync;
  t.mock.method(prototype, 'sync', async function () {
    await original.call(this); writeFileSync(join(f.root, 'controller.txt'), 'changed while syncing');
  });
  await assert.rejects(f.book(), /D570 controller refused/);
  assert.equal(JSON.parse(readFileSync(join(f.options.directory, 'setup.json'))).upperMicroUsd, 110000);
});

// Supplied quantities and fixed allowances still need review; catalogue rates must be calculated rather than pasted.
test('setup booking calculates paid cost from retained acquisitions before saving the original reservation', async t => {
  const f = setupBookingFixture(t), { acquirePriceCatalogue } = await import('../deploy/kubernetes/proof/prices.mjs');
  const docs = JSON.parse(readFileSync(new URL('../deploy/kubernetes/proof/test-fixtures/prices.json', import.meta.url)));
  const catalogues = {};
  for (const [service, doc] of Object.entries(docs)) catalogues[service] = await acquirePriceCatalogue(service, {
    fetch: async () => new Response(JSON.stringify(doc), { headers: { 'content-type': 'application/json' } }),
    clock: () => Date.parse(now), retain: async () => {},
  });
  const priceInputs = { catalogues, quantities: { computeSeconds: 3600, diskGiBSeconds: 2419200,
    storageByteSeconds: 2597596220620800, putRequests: 1000, getRequests: 10000,
    lambdaMiBSeconds: 102400, lambdaRequests: 10000, logIngestBytes: 1073741824,
    logStoredByteSeconds: 2597596220620800 },
    fixed: Object.fromEntries(['transfer', 'events', 'network', 'tax', 'contingency'].map(name => [name,
      { upperMicroUsd: 10000, source: 'https://aws.amazon.com/pricing/', digest: 'c'.repeat(64) }])) };
  const call = f.aws.call;
  f.aws.call = async (...args) => {
    priceInputs.quantities.computeSeconds = 1;
    return call(...args);
  };
  const result = await f.book({ cost: undefined, priceInputs });
  assert.equal(result.upperMicroUsd, 1083734);
  const saved = JSON.parse(readFileSync(join(f.options.directory, 'setup.json')));
  assert.equal(saved.cost.components.lambda.upperMicroUsd, 3334);
  assert.ok(saved.priceInputs, "reservation must retain its original price and quantity inputs");
  assert.equal(saved.priceInputs.quantities.computeSeconds, 3600);
  assert.deepEqual(saved.priceInputs.catalogues.AmazonEC2, catalogues.AmazonEC2);
  assert.equal(saved.cost.components.compute.source, catalogues.AmazonEC2.source);
  assert.equal(saved.cost.components.compute.digest, catalogues.AmazonEC2.digest);
});

test('setup booking refuses ambiguous pasted and acquired cost inputs before a provider call', async t => {
  const f = setupBookingFixture(t);
  await assert.rejects(f.book({ priceInputs: {} }), /D570 controller refused/);
  assert.deepEqual(f.calls, []);
  assert.equal(existsSync(f.options.directory), false);
});

async function firstSetupFixture(t) {
  const f = setupBookingFixture(t), { acquirePriceCatalogue } = await import('../deploy/kubernetes/proof/prices.mjs');
  const docs = JSON.parse(readFileSync(new URL('../deploy/kubernetes/proof/test-fixtures/prices.json', import.meta.url)));
  const catalogues = {};
  for (const [service, doc] of Object.entries(docs)) catalogues[service] = await acquirePriceCatalogue(service, {
    fetch: async () => new Response(JSON.stringify(doc), { headers: { 'content-type': 'application/json' } }),
    clock: () => Date.parse(now), retain: async () => {},
  });
  const prior = f.aws.call;
  f.aws.call = async (...args) => {
    const response = await prior(...args);
    if (args[0] === 'ce') response.ResultsByTime[0].Total.UnblendedCost.Amount = '0.50';
    return response;
  };
  async function book(changes = {}) {
    assert.equal(typeof control.bookManualFirstSetup, 'function', 'missing fixed first-machine cost booking');
    return control.bookManualFirstSetup({ ...f.options, cost: undefined, catalogues, ...changes });
  }
  return { ...f, catalogues, bookFirst: book };
}

// A caller-selected quantity could reserve pennies while leaving the sweep running for a month.
test('first setup books the fixed machine and full month of protection instead of caller-selected quantities', async t => {
  const f = await firstSetupFixture(t), result = await f.bookFirst();
  assert.equal(result.upperMicroUsd, 9313491);
  const saved = JSON.parse(readFileSync(join(f.options.directory, 'setup.json')));
  assert.equal(saved.billing.microUsd, 500000);
  assert.deepEqual(Object.fromEntries(Object.entries(saved.cost.components).map(([name, row]) => [name, row.upperMicroUsd])), {
    compute: 115600, disk: 191086, storage: 398, requests: 671600, lambda: 4490807, logs: 544000,
    transfer: 100000, events: 100000, network: 100000, tax: 2000000, contingency: 1000000,
  });
  assert.deepEqual(saved.priceInputs.quantities, {
    computeSeconds: 1200, diskGiBSeconds: 5529600, storageByteSeconds: 44936095334400,
    putRequests: 133920, getRequests: 5000, lambdaMiBSeconds: 342835200, lambdaRequests: 133920,
    logIngestBytes: 1073741824, logStoredByteSeconds: 371085174374400,
  });
  assert.deepEqual(saved.priceInputs.catalogues, f.catalogues);
  assert.equal(f.calls.some(row => ['create-stack', 'run-instances', 'put-object'].includes(row.operation)), false);
});

for (const override of [{ cost: {} }, { priceInputs: {} }, { quantities: { computeSeconds: 1 } }, { fixed: {} }]) {
  test(`first setup refuses a caller cost override ${Object.keys(override)[0]} before any provider access`, async t => {
    const f = await firstSetupFixture(t);
    await assert.rejects(f.bookFirst(override), /D570 controller refused/);
    assert.deepEqual(f.calls, []); assert.equal(existsSync(f.options.directory), false);
  });
}

test('first setup refuses when the actual opening plus fixed protection bound reaches twenty dollars', async t => {
  const f = await firstSetupFixture(t), prior = f.aws.call;
  f.aws.call = async (...args) => {
    const response = await prior(...args);
    if (args[0] === 'ce') response.ResultsByTime[0].Total.UnblendedCost.Amount = '10.686509';
    return response;
  };
  await assert.rejects(f.bookFirst(), /D570 controller refused/);
  assert.equal(existsSync(f.options.directory), false);
});

for (const kind of ['stale', 'decoded only', 'higher price']) test(`first setup refuses ${kind} catalogues before provider access`, async t => {
  const f = await firstSetupFixture(t);
  if (kind === 'stale') f.catalogues.AmazonEC2.observedAt = '2026-11-05T12:00:00Z';
  if (kind === 'decoded only') f.catalogues.AmazonEC2.kind = 'd570-price-decoded-v1';
  if (kind === 'higher price') f.catalogues.AWSLambda.rates.lambdaDuration.usdNumerator = '1000000';
  await assert.rejects(f.bookFirst(), /D570 price evidence refused/);
  assert.deepEqual(f.calls, []); assert.equal(existsSync(f.options.directory), false);
});

test('first setup snapshots catalogues before waiting for provider discovery', async t => {
  const f = await firstSetupFixture(t), prior = f.aws.call;
  f.aws.call = async (...args) => {
    f.catalogues.AmazonEC2.rates.compute.usdNumerator = '1';
    return prior(...args);
  };
  await f.bookFirst();
  const saved = JSON.parse(readFileSync(join(f.options.directory, 'setup.json')));
  assert.equal(saved.cost.components.compute.upperMicroUsd, 115600);
  assert.equal(saved.priceInputs.catalogues.AmazonEC2.rates.compute.usdNumerator, '3468000000');
});

// Creating before the durable cost booking, or accepting a requested sweep as health, must fail.
async function creationFixture(t) {
  const f = await firstSetupFixture(t), p = protectionFixture(t);
  const previous = f.aws.call;
  let creates = 0, enables = 0, pending = 1, missingHealth = 1;
  const sleeps = [];
  f.aws.call = async (service, operation, input) => {
    if (service === 'ce') {
      const response = await previous(service, operation, input);
      response.ResultsByTime[0].Total.UnblendedCost.Amount = '0'; return response;
    }
    if (operation === 'create-stack') {
      creates++;
      const saved = JSON.parse(readFileSync(join(f.options.directory, 'setup.json')));
      assert.equal(saved.upperMicroUsd, 9313491);
      assert.equal(saved.billing.microUsd, 0);
      assert.deepEqual(JSON.parse(input.TemplateBody), saved.template);
      assert.equal(input.StackName, 'd570-first');
      assert.deepEqual(input.Capabilities, ['CAPABILITY_IAM']);
      assert.deepEqual(input.Tags, [{ Key: 'Proof', Value: 'D570' }]);
      assert.equal(input.OnFailure, 'ROLLBACK'); assert.equal(input.TimeoutInMinutes, 10);
      assert.match(input.ClientRequestToken, /^d570-[a-f0-9]{64}$/);
      f.calls.push({ service, operation, input }); return { StackId: p.stackId };
    }
    if (operation === 'enable-rule') {
      enables++;
      assert.equal(p.responses['cloudformation/describe-stacks'].Stacks[0].StackStatus, 'CREATE_COMPLETE');
      assert.deepEqual(input, { Name: 'd570-first-rule', EventBusName: 'default' });
      f.calls.push({ service, operation, input }); return {};
    }
    const key = service + '/' + operation;
    if (Object.hasOwn(p.responses, key)) {
      f.calls.push({ service, operation, input });
      if (operation === 'describe-stacks' && pending-- > 0) return { Stacks: [{ StackId: p.stackId, StackName: 'd570-first', StackStatus: 'CREATE_IN_PROGRESS' }] };
      if (operation === 'get-object' && missingHealth-- > 0) throw Object.assign(new Error('not published'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
      return structuredClone(p.responses[key]);
    }
    return previous(service, operation, input);
  };
  const options = { ...f.options, cost: undefined, catalogues: f.catalogues, sleep: async ms => { sleeps.push(ms); } };
  const create = changes => {
    assert.equal(typeof control.createManualFirstSetup, 'function', 'missing booked stack creation and observed expiry');
    return control.createManualFirstSetup({ ...options, ...changes });
  };
  return { ...f, p, options, create, sleeps, counts: () => ({ creates, enables }) };
}

test('manual creation books once, waits for its completed stack, enables expiry and reads a real-shaped heartbeat', async t => {
  const f = await creationFixture(t); let result;
  await assert.doesNotReject(async () => { result = await f.create(); });
  assert.equal(result.stackId, f.p.stackId); assert.equal(result.bucket, 'd570-first-bucket');
  assert.equal(result.directory, f.options.directory); assert.equal(result.upperMicroUsd, 9313491);
  assert.deepEqual(result.heartbeat, f.p.health);
  assert.deepEqual(f.counts(), { creates: 1, enables: 1 }); assert.deepEqual(f.sleeps, [15000, 15000]);
  assert.equal(f.calls.some(row => ['run-instances', 'put-object', 'delete-stack'].includes(row.operation)), false);
  await assert.rejects(f.create()); assert.deepEqual(f.counts(), { creates: 1, enables: 1 });
});

for (const [label, mutate, expectedCreates, expectedEnables] of [
  ['unknown opening', (f, response, operation) => { if (operation === 'get-cost-and-usage') response.ResultsByTime[0].Total.UnblendedCost.Amount = '0.01'; }, 0, 0],
  ['foreign created stack', (f, response, operation) => { if (operation === 'create-stack') response.StackId = f.p.stackId.replace('462991287391', '949687825720'); }, 1, 0],
  ['wrong created name', (f, response, operation) => { if (operation === 'create-stack') response.StackId = f.p.stackId.replace('/d570-first/', '/d570-other/'); }, 1, 0],
  ['ambiguous created stack', (f, response, operation) => { if (operation === 'describe-stacks') response.Stacks.push(response.Stacks[0]); }, 1, 0],
  ['rollback', (f, response, operation) => { if (operation === 'describe-stacks') response.Stacks[0].StackStatus = 'ROLLBACK_COMPLETE'; }, 1, 0],
  ['foreign expiry resource', (f, response, operation) => { if (operation === 'describe-stack-resources') response.StackResources[1].StackId = f.p.stackId.replace('462991287391', '949687825720'); }, 1, 0],
  ['duplicate expiry resource', (f, response, operation) => { if (operation === 'describe-stack-resources') response.StackResources.push(response.StackResources[1]); }, 1, 0],
  ['incomplete expiry resource', (f, response, operation) => { if (operation === 'describe-stack-resources') response.StackResources[1].ResourceStatus = 'CREATE_IN_PROGRESS'; }, 1, 0],
  ['disabled protection', (f, response, operation) => { if (operation === 'describe-rule') response.State = 'DISABLED'; }, 1, 1],
  ['foreign heartbeat', (f, response, operation) => { if (operation === 'get-object') { const body = JSON.parse(Buffer.from(response.Body)); body.stackId += '-foreign'; response.Body = Buffer.from(JSON.stringify(body)); } }, 1, 1],
]) test(`manual creation refuses ${label} and preserves its booked cost without launching`, async t => {
  const f = await creationFixture(t), previous = f.aws.call;
  f.aws.call = async (service, operation, input) => {
    const response = await previous(service, operation, input); mutate(f, response, operation); return response;
  };
  await assert.rejects(f.create(), /D570 controller refused/);
  assert.deepEqual(f.counts(), { creates: expectedCreates, enables: expectedEnables });
  assert.equal(f.calls.some(row => ['run-instances', 'put-object', 'delete-stack'].includes(row.operation)), false);
  if (expectedCreates) assert.equal(JSON.parse(readFileSync(join(f.options.directory, 'setup.json'))).upperMicroUsd, 9313491);
});

for (const operation of ['create-stack', 'describe-stacks', 'describe-stack-resources', 'enable-rule']) {
  test(`manual creation retains the booking and stops after a source change during ${operation}`, async t => {
    const f = await creationFixture(t), previous = f.aws.call;
    f.aws.call = async (...args) => {
      const response = await previous(...args);
      if (args[1] === operation) writeFileSync(join(f.root, 'controller.txt'), 'changed\n');
      return response;
    };
    await assert.rejects(f.create(), /D570 controller refused/);
    assert.equal(f.calls.at(-1).operation, operation);
    assert.equal(existsSync(join(f.options.directory, 'setup.json')), true);
  });
}

for (const stage of ['stack', 'heartbeat']) test(`manual creation bounds a never-ready ${stage} without creating again`, async t => {
  const f = await creationFixture(t), previous = f.aws.call;
  f.aws.call = async (...args) => {
    if (stage === 'heartbeat' && args[1] === 'get-object') throw Object.assign(new Error('not published'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
    const response = await previous(...args);
    if (stage === 'stack' && args[1] === 'describe-stacks') response.Stacks[0].StackStatus = 'CREATE_IN_PROGRESS';
    return response;
  };
  await assert.rejects(f.create(), /D570 controller refused/);
  assert.deepEqual(f.counts(), { creates: 1, enables: stage === 'stack' ? 0 : 1 });
  assert.equal(f.sleeps.length, stage === 'stack' ? 39 : 8);
});

test('manual creation refuses a source change across the creation wait', async t => {
  const f = await creationFixture(t);
  await assert.rejects(f.create({ sleep: async () => writeFileSync(join(f.root, 'controller.txt'), 'changed while waiting\n') }), /D570 controller refused/);
  assert.equal(f.calls.at(-1).operation, 'describe-stacks');
  assert.deepEqual(f.counts(), { creates: 1, enables: 0 });
});

for (const operation of ['create-stack', 'enable-rule']) test(`creation CLI supports the actual ${operation} request and empty successful output`, async t => {
  const f = fixture(t), executable = join(f.root, 'aws-create'), capture = join(f.root, 'create.json');
  writeFileSync(executable, `#!${process.execPath}\nimport('node:fs').then(fs => {
    fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify(process.argv.slice(2)));
    if (${JSON.stringify(operation)} === 'create-stack') process.stdout.write('{"StackId":"arn:aws:cloudformation:eu-north-1:462991287391:stack/d570-first/00000000-0000-4000-8000-000000000000"}');
  });\n`, { mode: 0o700 });
  const input = operation === 'create-stack' ? { StackName: 'd570-first', TemplateBody: '{"Resources":{}}',
    Capabilities: ['CAPABILITY_IAM'], Tags: [{ Key: 'Proof', Value: 'D570' }], TimeoutInMinutes: 10,
    OnFailure: 'ROLLBACK', ClientRequestToken: 'd570-' + 'a'.repeat(64) } : { Name: 'd570-first-rule', EventBusName: 'default' };
  const result = await control.createManualAwsCli({ executable }).call(operation === 'create-stack' ? 'cloudformation' : 'events', operation, input);
  assert.deepEqual(result, operation === 'create-stack' ? {
    StackId: 'arn:aws:cloudformation:eu-north-1:462991287391:stack/d570-first/00000000-0000-4000-8000-000000000000',
  } : {});
  const args = JSON.parse(readFileSync(capture));
  assert.deepEqual(args.slice(0, 6), [operation === 'create-stack' ? 'cloudformation' : 'events', operation,
    '--cli-input-json', JSON.stringify(input), '--region', 'eu-north-1']);
});

test('creation CLI recognizes only a missing heartbeat and never confuses denial with waiting', async t => {
  const missing = ledgerCliFixture(t, 'NoSuchKey', '\naws: [ERROR]: ');
  await assert.rejects(missing.cli.call('s3api', 'get-object', { ...missing.input, Key: 'd570/health/reaper.json', Range: 'bytes=0-1048576' }),
    error => error.name === 'NoSuchKey' && error.$metadata?.httpStatusCode === 404);
  const denied = ledgerCliFixture(t, 'AccessDenied', '\naws: [ERROR]: ');
  await assert.rejects(denied.cli.call('s3api', 'get-object', { ...denied.input, Key: 'd570/health/reaper.json', Range: 'bytes=0-1048576' }),
    error => error.message === 'D570 AWS s3api/get-object failed' && error.name !== 'NoSuchKey');
});


async function initializationFixture(t) {
  const f = await creationFixture(t), previous = f.aws.call;
  const objects = new Map(), writes = [];
  f.aws.call = async (service, operation, input) => {
    if (service !== 's3api' || input.Key === 'd570/health/reaper.json') return previous(service, operation, input);
    f.calls.push({ service, operation, input });
    assert.equal(input.Bucket, 'd570-first-bucket');
    assert.equal(input.ExpectedBucketOwner, '462991287391');
    if (operation === 'list-objects-v2') return { IsTruncated: false, Contents: [...objects.keys()].map(Key => ({ Key })) };
    if (operation === 'get-object') {
      const row = objects.get(input.Key);
      if (!row) throw Object.assign(new Error('absent'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
      return { Body: row.body, ETag: row.etag, ContentLength: row.body.length };
    }
    assert.equal(operation, 'put-object');
    assert.equal(f.calls.some(row => row.operation === 'get-object' && row.input.Key === 'd570/health/reaper.json'), true);
    assert.equal(input.IfNoneMatch, '*'); assert.equal(objects.has(input.Key), false);
    const etag = '"' + (writes.length + 1) + '"';
    objects.set(input.Key, { body: Buffer.from(input.Body), etag }); writes.push(input.Key); return { ETag: etag };
  };
  const initialize = changes => {
    assert.equal(typeof control.initializeManualFirstSetup, 'function', 'missing first setup ledger initialization');
    return control.initializeManualFirstSetup({ ...f.options, ...changes });
  };
  return { ...f, objects, writes, initialize };
}

test('first ledger keeps the original opening when the bill rises during stack creation', async t => {
  const f = await initializationFixture(t), previous = f.aws.call;
  f.aws.call = async (...args) => {
    const response = await previous(...args);
    if (args[0] === 'ce' && f.counts().creates > 0) response.ResultsByTime[0].Total.UnblendedCost.Amount = '0.01';
    return response;
  };
  const result = await f.initialize();
  const current = JSON.parse(f.objects.get('d570/ledger/2026-11.json').body);
  assert.equal(current.opening.baselineMicroUsd, 0);
  assert.equal(current.opening.overheadMicroUsd, 9006805);
  assert.equal(result.billing.microUsd, 10000); assert.equal(result.billing.estimated, true);
  assert.equal(result.openingBilling.microUsd, 0); assert.equal(result.openingBilling.estimated, true);
  assert.equal(result.runEvidence.components.compute.upperMicroUsd, 115600);
  assert.equal(result.runEvidence.components.disk.upperMicroUsd, 191086);
  assert.equal(Object.values(result.runEvidence.components).reduce((sum, row) => sum + row.upperMicroUsd, 0), 306686);
  assert.deepEqual(f.writes, ['d570/ledger/2026-11.json', 'd570/ledger/2026-12.json', 'd570/ledger/active.json']);
  assert.deepEqual(current.entries, []);
  assert.equal(result.budget.bookedMicroUsd, 0); assert.equal(result.budget.activeUuid, null);
  const active = JSON.parse(f.objects.get('d570/ledger/active.json').body);
  assert.equal(active.active, null); assert.deepEqual(active.completed, []);
  assert.equal(f.calls.some(row => ['run-instances', 'delete-stack'].includes(row.operation)), false);
  const saved = JSON.parse(readFileSync(join(f.options.directory, 'setup.json')));
  assert.equal(saved.billing.microUsd, 0); assert.equal(saved.upperMicroUsd, 9313491);
  await assert.rejects(f.initialize()); assert.deepEqual(f.counts(), { creates: 1, enables: 1 });
});

test('first drill reservation fits the original bound without counting setup protection twice', async t => {
  const f = await initializationFixture(t), result = await f.initialize();
  const budget = await import('./kubernetes-proof-budget.mjs');
  const store = control.createManualLedgerStore({ bucket: result.bucket, aws: f.aws });
  // The conditional overwrite below exercises the real reservation core after setup's create-only writes.
  const setupCall = f.aws.call;
  f.aws.call = async (service, operation, input) => {
    if (operation !== 'put-object') return setupCall(service, operation, input);
    const prior = f.objects.get(input.Key); assert.ok(prior); assert.equal(input.IfMatch, prior.etag);
    const etag = '"updated-' + f.writes.length + '"';
    f.objects.set(input.Key, { body: Buffer.from(input.Body), etag }); f.writes.push(input.Key); return { ETag: etag };
  };
  const identity = { uuid: '00000000-0000-4000-8000-000000000001', head: result.head, tree: result.tree,
    startedAt: now, expiry: '2026-11-06T12:05:00Z', liabilityUntil: '2026-12-07T12:05:00Z' };
  const reserved = await budget.reserveRun({ scope: { account: result.account, region: result.region, stackId: result.stackId },
    now, clock: () => Date.parse(now), identity, evidence: result.runEvidence, store });
  assert.equal(reserved.upperMicroUsd, 306686);
  for (const month of ['2026-11', '2026-12']) {
    const row = JSON.parse(f.objects.get('d570/ledger/' + month + '.json').body);
    assert.equal(row.opening.baselineMicroUsd + row.opening.overheadMicroUsd + row.entries[0].upperMicroUsd, 9313491);
    assert.equal(row.entries.length, 1);
  }
});

for (const stage of ['unhealthy protection', 'existing history', 'partial write', 'changed source', 'stale heartbeat']) {
  test(`first ledger refuses ${stage} and never replaces retained cost or launches`, async t => {
    const f = await initializationFixture(t), previous = f.aws.call;
    if (stage === 'existing history') f.objects.set('d570/ledger/2026-11.json', { body: Buffer.from('preserve'), etag: '"old"' });
    f.aws.call = async (...args) => {
      if (stage === 'partial write' && args[1] === 'put-object' && args[2].Key.endsWith('active.json')) throw new Error('synthetic storage refusal');
      const response = await previous(...args);
      if (stage === 'unhealthy protection' && args[1] === 'describe-rule') response.State = 'DISABLED';
      if (args[1] === 'list-objects-v2') {
        if (stage === 'changed source') {
          writeFileSync(join(f.root, 'controller.txt'), 'new clean main during initialization');
          f.git('add', 'controller.txt'); f.git('commit', '-s', '-m', 'Advance isolated main during storage wait');
          f.git('update-ref', 'refs/remotes/origin/main', f.git('rev-parse', 'HEAD'));
        }
        if (stage === 'stale heartbeat') f.options.clock = () => Date.parse(now) + 120000;
      }
      return response;
    };
    // Clock changes are observed through the closure after the storage wait.
    const clock = () => f.options.clock();
    await assert.rejects(f.initialize({ clock }), /controller refused|budget refused|synthetic storage refusal/);
    assert.equal(f.calls.some(row => row.operation === 'run-instances'), false);
    const saved = JSON.parse(readFileSync(join(f.options.directory, 'setup.json')));
    assert.equal(saved.upperMicroUsd, 9313491);
    if (stage === 'existing history') assert.equal(f.objects.get('d570/ledger/2026-11.json').body.toString(), 'preserve');
    if (stage === 'changed source' || stage === 'stale heartbeat' || stage === 'unhealthy protection') assert.equal(f.writes.length, 0);
    if (stage === 'partial write') assert.deepEqual(f.writes, ['d570/ledger/2026-11.json', 'd570/ledger/2026-12.json']);
    await assert.rejects(f.initialize({ clock })); assert.deepEqual(f.counts(), { creates: 1, enables: 1 });
  });
}

async function drillFixture(t) {
  const f = await initializationFixture(t), setup = await f.initialize();
  const ids = { LaunchTemplate: 'lt-0123456789abcdef0', Subnet: 'subnet-0123456789abcdef0', SecurityGroup: 'sg-0123456789abcdef0' };
  for (const [LogicalResourceId, PhysicalResourceId] of Object.entries(ids)) f.p.resource.push({
    LogicalResourceId, PhysicalResourceId, StackId: setup.stackId, ResourceStatus: 'CREATE_COMPLETE',
    ResourceType: 'AWS::EC2::' + LogicalResourceId,
  });
  const data = { ImageId: 'ami-0123456789abcdef0', InstanceType: 'm7g.2xlarge', InstanceInitiatedShutdownBehavior: 'terminate',
    MetadataOptions: { HttpEndpoint: 'enabled', HttpTokens: 'required', HttpPutResponseHopLimit: 1, InstanceMetadataTags: 'disabled' },
    NetworkInterfaces: [{ DeviceIndex: 0, AssociatePublicIpAddress: false, DeleteOnTermination: true,
      SubnetId: ids.Subnet, Groups: [ids.SecurityGroup] }],
    BlockDeviceMappings: [{ DeviceName: '/dev/xvda', Ebs: { Encrypted: true, DeleteOnTermination: true,
      VolumeSize: 64, VolumeType: 'gp3', Iops: 3000, Throughput: 125 } }],
  };
  const version = { LaunchTemplateId: ids.LaunchTemplate, VersionNumber: 1, LaunchTemplateData: data };
  const uuid = '00000000-0000-4000-8000-000000000001', instanceId = 'i-0123456789abcdef0';
  const launchResponse = { OwnerId: '462991287391', Instances: [{ InstanceId: instanceId, ClientToken: uuid,
    ImageId: 'ami-0123456789abcdef0', InstanceType: 'm7g.2xlarge', SubnetId: ids.Subnet, State: { Name: 'pending', Code: 0 } }] };
  const previous = f.aws.call;
  f.aws.call = async (service, operation, input) => {
    if (operation === 'put-object') {
      const prior = f.objects.get(input.Key); assert.ok(prior); assert.equal(input.IfMatch, prior.etag);
      const etag = '"drill-' + f.writes.length + '"';
      f.objects.set(input.Key, { body: Buffer.from(input.Body), etag }); f.writes.push(input.Key);
      f.calls.push({ service, operation, input }); return { ETag: etag };
    }
    if (operation === 'describe-launch-template-versions') {
      f.calls.push({ service, operation, input });
      assert.deepEqual(input, { LaunchTemplateId: ids.LaunchTemplate, Versions: ['1'] });
      return { LaunchTemplateVersions: [structuredClone(version)] };
    }
    if (operation === 'run-instances') {
      // Launching before both monthly writes and their active readback would spend unbooked money.
      const active = JSON.parse(f.objects.get('d570/ledger/active.json').body).active;
      assert.ok(active, 'launch requires a retained cost reservation');
      assert.equal(active.state, 'reserved'); assert.equal(active.identity.uuid, uuid);
      for (const month of ['2026-11', '2026-12']) assert.equal(JSON.parse(f.objects.get('d570/ledger/' + month + '.json').body).entries.length, 1);
      f.calls.push({ service, operation, input });
      return structuredClone(launchResponse);
    }
    return previous(service, operation, input);
  };
  const launch = changes => {
    assert.equal(typeof control.launchManualFirstDrill, 'function', 'missing booked fixed-deadline guest launch');
    return control.launchManualFirstDrill({ ...f.options, setup, uuid, ...changes });
  };
  return { ...f, setup, ids, version, uuid, instanceId, launch, launchResponse };
}

test('guest launch reserves once before one exact template launch with earlier credential-free shutdown', async t => {
  const f = await drillFixture(t), result = await f.launch();
  assert.equal(result.instanceId, f.instanceId);
  assert.equal(result.reservation.expiry, '2026-11-06T12:05:00Z');
  assert.equal(result.reservation.liabilityUntil, '2026-12-07T12:05:00Z');
  assert.equal(result.guestExpiry, '2026-11-06T12:03:00Z');
  assert.equal(result.reservation.upperMicroUsd, 306686);
  const request = f.calls.find(row => row.operation === 'run-instances').input;
  assert.deepEqual(Object.keys(request).sort(), ['ClientToken', 'LaunchTemplate', 'MaxCount', 'MinCount', 'TagSpecifications', 'UserData']);
  assert.deepEqual(request.LaunchTemplate, { LaunchTemplateId: f.ids.LaunchTemplate, Version: '1' });
  assert.equal(request.MinCount, 1); assert.equal(request.MaxCount, 1); assert.equal(request.ClientToken, f.uuid);
  const tags = [{ Key: 'Proof', Value: 'D570' }, { Key: 'Stack', Value: f.setup.stackId },
    { Key: 'Run', Value: f.uuid }, { Key: 'ExpiresAt', Value: '2026-11-06T12:05:00Z' }];
  assert.deepEqual(request.TagSpecifications, ['instance', 'volume'].map(ResourceType => ({ ResourceType, Tags: tags })));
  const { renderDeadlineBootstrap } = await import('../deploy/kubernetes/proof/bootstrap.mjs');
  assert.equal(Buffer.from(request.UserData, 'base64').toString(), renderDeadlineBootstrap({
    scope: { account: f.setup.account, region: f.setup.region, stackId: f.setup.stackId },
    reservation: { ...result.reservation, expiry: '2026-11-06T12:03:00Z' },
  }));
  assert.equal(f.calls.filter(row => row.operation === 'run-instances').length, 1);
  await assert.rejects(f.launch());
  assert.equal(f.calls.filter(row => row.operation === 'run-instances').length, 1);
});

for (const [label, mutate] of [
  ['public network', f => { f.version.LaunchTemplateData.NetworkInterfaces[0].AssociatePublicIpAddress = true; }],
  ['credentials', f => { f.version.LaunchTemplateData.IamInstanceProfile = { Name: 'foreign' }; }],
  ['missing shutdown', f => { f.version.LaunchTemplateData.InstanceInitiatedShutdownBehavior = 'stop'; }],
  ['changed disk', f => { f.version.LaunchTemplateData.BlockDeviceMappings[0].Ebs.DeleteOnTermination = false; }],
  ['mutable template', f => { f.version.VersionNumber = '$Latest'; }],
  ['foreign template', f => { f.version.LaunchTemplateId = 'lt-00000000000000000'; }],
  ['unhealthy sweep', f => { f.p.responses['events/describe-rule'].State = 'DISABLED'; }],
  ['foreign setup', f => { f.setup.stackId = f.setup.stackId.replace('462991287391', '949687825720'); }],
  ['another source', f => { f.setup.head = 'a'.repeat(40); }],
  ['dirty source', f => { writeFileSync(join(f.root, 'controller.txt'), 'dirty'); }],
]) test(`guest launch refuses ${label} without launching or spending`, async t => {
  const f = await drillFixture(t); mutate(f); await assert.rejects(f.launch());
  assert.equal(f.calls.some(row => row.operation === 'run-instances'), false);
});

test('guest launch keeps its reservation and never retries an uncertain launch', async t => {
  const f = await drillFixture(t), previous = f.aws.call; let launches = 0;
  f.aws.call = async (...args) => {
    if (args[1] === 'run-instances') { launches++; throw new Error('synthetic lost launch reply'); }
    return previous(...args);
  };
  await assert.rejects(f.launch(), /lost launch reply/);
  assert.equal(launches, 1);
  assert.equal(JSON.parse(f.objects.get('d570/ledger/active.json').body).active.identity.expiry, '2026-11-06T12:05:00Z');
  await assert.rejects(f.launch()); assert.equal(launches, 1);
});

test('guest launch verifies the returned instance identity without relying on an unreturned template field', async t => {
  const f = await drillFixture(t), previous = f.aws.call;
  f.aws.call = async (...args) => {
    const response = await previous(...args);
    if (args[1] === 'run-instances') assert.equal(Object.hasOwn(response.Instances[0], 'LaunchTemplate'), false);
    return response;
  };
  assert.equal((await f.launch()).instanceId, f.instanceId);
});

for (const [label, change] of [
  ['foreign owner', x => { x.OwnerId = '949687825720'; }],
  ['changed image', x => { x.Instances[0].ImageId = 'ami-00000000000000000'; }],
  ['changed subnet', x => { x.Instances[0].SubnetId = 'subnet-00000000000000000'; }],
  ['changed machine', x => { x.Instances[0].InstanceType = 'm7g.4xlarge'; }],
  ['changed token', x => { x.Instances[0].ClientToken = '00000000-0000-4000-8000-000000000002'; }],
  ['multiple machines', x => { x.Instances.push(structuredClone(x.Instances[0])); }],
]) test(`guest launch refuses ${label} in the provider reply and retains its cost`, async t => {
  const f = await drillFixture(t); change(f.launchResponse);
  await assert.rejects(f.launch(), /D570 controller refused/);
  assert.equal(f.calls.filter(row => row.operation === 'run-instances').length, 1);
  assert.ok(JSON.parse(f.objects.get('d570/ledger/active.json').body).active);
});

for (const stage of ['changed source', 'stale heartbeat', 'expired guest']) test(`guest launch refuses ${stage} after reserving without clearing cost`, async t => {
  const f = await drillFixture(t), previous = f.aws.call; let current = Date.parse(now), writes = 0;
  f.aws.call = async (...args) => {
    const result = await previous(...args);
    if (args[1] === 'put-object' && ++writes === 4) {
      if (stage === 'changed source') {
        writeFileSync(join(f.root, 'controller.txt'), 'advance clean main');
        f.git('add', 'controller.txt'); f.git('commit', '-s', '-m', 'Advance isolated main');
        f.git('update-ref', 'refs/remotes/origin/main', f.git('rev-parse', 'HEAD'));
      } else current += stage === 'expired guest' ? 180000 : 120000;
    }
    return result;
  };
  await assert.rejects(f.launch({ clock: () => current }));
  assert.equal(f.calls.some(row => row.operation === 'run-instances'), false);
  assert.ok(JSON.parse(f.objects.get('d570/ledger/active.json').body).active);
});

function drillCliFixture(t) {
  const f = fixture(t), capture = join(f.root, 'drill-cli.json'), executable = join(f.root, 'aws-drill');
  writeFileSync(executable, `#!${process.execPath}\nimport('node:fs').then(fs => {
    fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify(process.argv.slice(2))); process.stdout.write('{"accepted":true}'); });\n`, { mode: 0o700 });
  const stackId = 'arn:aws:cloudformation:eu-north-1:462991287391:stack/d570-first/00000000-0000-4000-8000-000000000000';
  const tags = [{ Key: 'Proof', Value: 'D570' }, { Key: 'Stack', Value: stackId },
    { Key: 'Run', Value: '00000000-0000-4000-8000-000000000001' }, { Key: 'ExpiresAt', Value: '2026-11-06T12:05:00Z' }];
  const input = { ClientToken: tags[2].Value, MinCount: 1, MaxCount: 1,
    LaunchTemplate: { LaunchTemplateId: 'lt-0123456789abcdef0', Version: '1' },
    UserData: Buffer.from('#!/bin/bash\nexit 0\n').toString('base64'),
    TagSpecifications: ['instance', 'volume'].map(ResourceType => ({ ResourceType, Tags: structuredClone(tags) })) };
  return { ...f, capture, executable, input };
}

test('guest CLI gives the installed CLI plain user data so its encoder runs exactly once', async t => {
  const f = drillCliFixture(t);
  assert.deepEqual(await control.createManualAwsCli({ executable: f.executable }).call('ec2', 'run-instances', f.input), { accepted: true });
  const args = JSON.parse(readFileSync(f.capture));
  assert.deepEqual(args.slice(0, 6), ['ec2', 'run-instances', '--cli-input-json',
    JSON.stringify({ ...f.input, UserData: '#!/bin/bash\nexit 0\n' }), '--region', 'eu-north-1']);
  assert.equal(args.includes('--user-data'), false);
});

test('guest CLI reads version one explicitly rather than the mutable default', async t => {
  const f = drillCliFixture(t), input = { LaunchTemplateId: 'lt-0123456789abcdef0', Versions: ['1'] };
  assert.deepEqual(await control.createManualAwsCli({ executable: f.executable }).call('ec2', 'describe-launch-template-versions', input), { accepted: true });
  assert.deepEqual(JSON.parse(readFileSync(f.capture)).slice(0, 4), ['ec2', 'describe-launch-template-versions', '--cli-input-json', JSON.stringify(input)]);
});

for (const [label, change] of [
  ['two machines', x => { x.MaxCount = 2; }],
  ['mutable version', x => { x.LaunchTemplate.Version = '$Latest'; }],
  ['public override', x => { x.SubnetId = 'subnet-0123456789abcdef0'; }],
  ['credential override', x => { x.IamInstanceProfile = { Name: 'other' }; }],
  ['missing disk tags', x => { x.TagSpecifications.pop(); }],
  ['foreign ownership', x => { x.TagSpecifications[0].Tags[1].Value = x.TagSpecifications[0].Tags[1].Value.replace('462991287391', '949687825720'); }],
  ['mismatched run tags', x => { x.TagSpecifications[1].Tags[2].Value = '00000000-0000-4000-8000-000000000002'; }],
]) test(`guest CLI refuses ${label} before invoking its executable`, async t => {
  const f = drillCliFixture(t); change(f.input);
  await assert.rejects(control.createManualAwsCli({ executable: f.executable }).call('ec2', 'run-instances', f.input), /D570 controller refused/);
  assert.equal(existsSync(f.capture), false);
});


async function readyGuestFixture(t) {
  const f = await drillFixture(t), launch = await f.launch();
  const volumeId = 'vol-0123456789abcdef0', interfaceId = 'eni-0123456789abcdef0';
  const instance = { InstanceId: f.instanceId, ClientToken: f.uuid, ImageId: 'ami-0123456789abcdef0',
    InstanceType: 'm7g.2xlarge', SubnetId: f.ids.Subnet, State: { Name: 'running', Code: 16 },
    LaunchTime: now, RootDeviceName: '/dev/xvda', RootDeviceType: 'ebs',
    Tags: [{ Key: 'Proof', Value: 'D570' }, { Key: 'Stack', Value: f.setup.stackId },
      { Key: 'Run', Value: f.uuid }, { Key: 'ExpiresAt', Value: '2026-11-06T12:05:00Z' }],
    BlockDeviceMappings: [{ DeviceName: '/dev/xvda', Ebs: { VolumeId: volumeId, DeleteOnTermination: true, Status: 'attached' } }],
    NetworkInterfaces: [{ NetworkInterfaceId: interfaceId, OwnerId: '462991287391', SubnetId: f.ids.Subnet,
      Status: 'in-use', Groups: [{ GroupId: f.ids.SecurityGroup }],
      Attachment: { DeviceIndex: 0, Status: 'attached', DeleteOnTermination: true } }],
  };
  const instances = { Reservations: [{ OwnerId: '462991287391', Instances: [instance] }] };
  const shutdown = { InstanceId: f.instanceId, InstanceInitiatedShutdownBehavior: { Value: 'terminate' } };
  const consoleOutput = { InstanceId: f.instanceId, Timestamp: '2026-11-06T12:00:30+00:00',
    Output: 'Booting synthetic guest\r\nD570_DEADLINE_READY ' + f.uuid + ' 1793966580 11111111-1111-4111-8111-111111111111\r\n' };
  const previous = f.aws.call;
  f.aws.call = async (service, operation, input) => {
    if (['describe-instances', 'describe-instance-attribute', 'get-console-output'].includes(operation)) {
      f.calls.push({ service, operation, input });
      assert.equal(service, 'ec2');
      assert.deepEqual(input, operation === 'describe-instances' ? { InstanceIds: [f.instanceId] }
        : operation === 'get-console-output' ? { InstanceId: f.instanceId, Latest: true }
          : { InstanceId: f.instanceId, Attribute: 'instanceInitiatedShutdownBehavior' });
      return structuredClone(operation === 'describe-instances' ? instances : operation === 'get-console-output' ? consoleOutput : shutdown);
    }
    return previous(service, operation, input);
  };
  const options = { ...f.options, launch, now: '2026-11-06T12:00:45Z', clock: () => Date.parse('2026-11-06T12:00:45Z') };
  const observe = changes => {
    assert.equal(typeof control.inspectManualFirstGuest, 'function', 'missing live guest readiness observation');
    return control.inspectManualFirstGuest({ ...options, ...changes });
  };
  return { ...f, launch, instance, instances, shutdown, consoleOutput, options, observe, volumeId, interfaceId };
}

// Missing ownership, readiness or deletion checks must never turn a running machine into a shutdown proof.
test('ready guest captures console and deletable resources between two live instance reads without changing bookings', async t => {
  const f = await readyGuestFixture(t), before = structuredClone([...f.objects]), writes = f.writes.length;
  const result = await f.observe();
  assert.equal(result.instanceId, f.instanceId);
  assert.deepEqual(result.volumeIds, ['vol-0123456789abcdef0']);
  assert.deepEqual(result.interfaceIds, ['eni-0123456789abcdef0']);
  assert.equal(result.bootId, '11111111-1111-4111-8111-111111111111');
  assert.equal(result.observedAt, '2026-11-06T12:00:45Z');
  assert.deepEqual(result.consoleOutput, f.consoleOutput);
  assert.deepEqual(f.calls.filter(row => row.service === 'ec2' && ['describe-instances', 'describe-instance-attribute', 'get-console-output'].includes(row.operation)).map(row => row.operation),
    ['describe-instances', 'describe-instance-attribute', 'get-console-output', 'describe-instances']);
  assert.equal(Object.hasOwn(result, 'terminated'), false);
  assert.equal(f.writes.length, writes); assert.deepEqual(structuredClone([...f.objects]), before);
});

test('ready guest accepts the cloud-init timestamp and process prefix without changing its exact identity',async t=>{
 const f=await readyGuestFixture(t),before=structuredClone([...f.objects]);
 f.consoleOutput.Output=`[    6.388599] cloud-init[2735]: D570_DEADLINE_READY ${f.uuid} 1793966580 11111111-1111-4111-8111-111111111111\n`;
 const result=await f.observe();
 assert.equal(result.bootId,'11111111-1111-4111-8111-111111111111');
 assert.deepEqual(result.consoleOutput,f.consoleOutput);assert.deepEqual(structuredClone([...f.objects]),before);
});

for(const [label,edit] of [
 ['foreign run',line=>line.replace('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002')],
 ['wrong expiry',line=>line.replace('1793966580','1793966700')],
 ['trailing token',line=>line+' extra'],
 ['invalid boot',line=>line.replace('11111111-1111-4111-8111-111111111111','not-a-boot')],
 ['two boot identities',line=>line+'\n'+line.replace('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222')],
 ['mixed foreign run',line=>line+'\n'+line.replace('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002')],
])test(`ready guest refuses a cloud-init line with ${label} and retains every booking`,async t=>{
 const f=await readyGuestFixture(t),before=structuredClone([...f.objects]);
 const line=`[    6.388599] cloud-init[2735]: D570_DEADLINE_READY ${f.uuid} 1793966580 11111111-1111-4111-8111-111111111111`;
 f.consoleOutput.Output=edit(line)+'\n';await assert.rejects(f.observe(),/D570 controller refused/);
 assert.deepEqual(structuredClone([...f.objects]),before);
});

for (const [label, mutate] of [
  ['foreign owner', f => { f.instances.Reservations[0].OwnerId = '949687825720'; }],
  ['other run', f => { f.instance.Tags[2].Value = '00000000-0000-4000-8000-000000000002'; }],
  ['other source', f => { f.launch.head = 'a'.repeat(40); }],
  ['no active booking', f => {
    const unbooked = '00000000-0000-4000-8000-000000000002';
    f.launch.reservation.uuid = unbooked; f.instance.ClientToken = unbooked; f.instance.Tags[2].Value = unbooked;
    f.consoleOutput.Output = f.consoleOutput.Output.replace(f.uuid, unbooked);
  }],
  ['later outer expiry', f => { f.instance.Tags[3].Value = '2026-11-06T12:06:00Z'; }],
  ['early shutdown', f => { f.instance.State = { Name: 'terminated', Code: 48 }; }],
  ['public address', f => { f.instance.PublicIpAddress = '192.0.2.1'; }],
  ['machine credentials', f => { f.instance.IamInstanceProfile = { Arn: 'arn:aws:iam::462991287391:instance-profile/foreign' }; }],
  ['disk kept after termination', f => { f.instance.BlockDeviceMappings[0].Ebs.DeleteOnTermination = false; }],
  ['interface kept after termination', f => { f.instance.NetworkInterfaces[0].Attachment.DeleteOnTermination = false; }],
  ['foreign interface subnet', f => { f.instance.NetworkInterfaces[0].SubnetId = 'subnet-00000000000000000'; }],
  ['public interface', f => { f.instance.NetworkInterfaces[0].Association = { PublicIp: '192.0.2.1' }; }],
  ['shutdown stops the machine', f => { f.shutdown.InstanceInitiatedShutdownBehavior.Value = 'stop'; }],
  ['foreign shutdown setting', f => { f.shutdown.InstanceId = 'i-00000000000000000'; }],
  ['missing ready line', f => { f.consoleOutput.Output = 'Still booting'; }],
  ['wrong ready deadline', f => { f.consoleOutput.Output = f.consoleOutput.Output.replace('1793966580', '1793966700'); }],
  ['foreign console', f => { f.consoleOutput.InstanceId = 'i-00000000000000000'; }],
  ['future console', f => { f.consoleOutput.Timestamp = '2026-11-06T12:00:46Z'; }],
  ['invalid boot identity', f => { f.consoleOutput.Output = f.consoleOutput.Output.replace('11111111-1111-4111-8111-111111111111', 'unknown'); }],
  ['conflicting boots', f => { f.consoleOutput.Output += f.consoleOutput.Output.replace('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'); }],
  ['partial inventory', f => { f.instances.NextToken = 'more'; }],
]) test(`ready guest refuses ${label} and retains the full booking`, async t => {
  const f = await readyGuestFixture(t); mutate(f); const before = structuredClone([...f.objects]);
  await assert.rejects(f.observe(), /D570 controller refused/);
  assert.deepEqual(structuredClone([...f.objects]), before);
});

for (const stage of ['terminated', 'changed disk', 'changed main', 'deadline passed', 'stale heartbeat']) test(`ready guest refuses ${stage} during the console read`, async t => {
  const f = await readyGuestFixture(t), previous = f.aws.call;
  if (stage === 'deadline passed') {
    f.options.now = '2026-11-06T12:02:30Z';
    f.p.health.startedAt = '2026-11-06T12:02:00.000Z';
    f.p.health.completedAt = '2026-11-06T12:02:01.000Z';
    f.p.responses['s3api/get-object'].Body = Buffer.from(JSON.stringify(f.p.health));
    f.p.responses['s3api/get-object'].LastModified = '2026-11-06T12:02:01Z';
    f.consoleOutput.Timestamp = '2026-11-06T12:02:30Z';
  }
  let at = Date.parse(f.options.now);
  f.aws.call = async (...args) => {
    const result = await previous(...args);
    if (args[1] === 'get-console-output') {
      if (stage === 'terminated') f.instance.State = { Name: 'terminated', Code: 48 };
      if (stage === 'changed disk') f.instance.BlockDeviceMappings[0].Ebs.VolumeId = 'vol-00000000000000000';
      if (stage === 'changed main') {
        writeFileSync(join(f.root, 'controller.txt'), 'advance clean main during console read');
        f.git('add', 'controller.txt'); f.git('commit', '-s', '-m', 'Advance isolated main');
        f.git('update-ref', 'refs/remotes/origin/main', f.git('rev-parse', 'HEAD'));
      }
      if (stage === 'deadline passed') at = Date.parse('2026-11-06T12:03:00Z');
      if (stage === 'stale heartbeat') at = Date.parse('2026-11-06T12:01:00Z');
    }
    return result;
  };
  await assert.rejects(f.observe({ clock: () => at }), /D570 controller refused/);
});

for (const [operation, input] of [
  ['describe-instances', { InstanceIds: ['i-0123456789abcdef0'] }],
  ['describe-instance-attribute', { InstanceId: 'i-0123456789abcdef0', Attribute: 'instanceInitiatedShutdownBehavior' }],
  ['get-console-output', { InstanceId: 'i-0123456789abcdef0', Latest: true }],
]) test(`ready guest CLI sends the explicit ${operation} read`, async t => {
  const f = drillCliFixture(t);
  assert.deepEqual(await control.createManualAwsCli({ executable: f.executable }).call('ec2', operation, input), { accepted: true });
  assert.deepEqual(JSON.parse(readFileSync(f.capture)).slice(0, 6), ['ec2', operation, '--cli-input-json', JSON.stringify(input), '--region', 'eu-north-1']);
});

async function guestCleanupFixture(t) {
  const f = await readyGuestFixture(t), ready = await f.observe();
  f.instance.State = { Name: 'terminated', Code: 48 };
  f.instance.StateReason = { Code: 'Client.InstanceInitiatedShutdown', Message: 'Client.InstanceInitiatedShutdown: Instance initiated shutdown' };
  f.instance.StateTransitionReason = '';
  f.instance.BlockDeviceMappings = []; f.instance.NetworkInterfaces = [];
  f.p.health.startedAt = '2026-11-06T12:03:00.000Z'; f.p.health.completedAt = '2026-11-06T12:03:01.000Z';
  f.p.responses['s3api/get-object'].Body = Buffer.from(JSON.stringify(f.p.health));
  f.p.responses['s3api/get-object'].LastModified = '2026-11-06T12:03:01Z';
  const volumes = { Volumes: [] }, interfaces = { NetworkInterfaces: [] }, previous = f.aws.call;
  f.aws.call = async (service, operation, input) => {
    if (operation === 'describe-volumes' || operation === 'describe-network-interfaces') {
      f.calls.push({ service, operation, input }); assert.equal(service, 'ec2');
      assert.deepEqual(input, operation === 'describe-volumes'
        ? { Filters: [{ Name: 'volume-id', Values: ['vol-0123456789abcdef0'] }], MaxResults: 100 }
        : { Filters: [{ Name: 'subnet-id', Values: ['subnet-0123456789abcdef0'] }], MaxResults: 100 });
      return structuredClone(operation === 'describe-volumes' ? volumes : interfaces);
    }
    return previous(service, operation, input);
  };
  f.calls.length = 0;
  const options = { ...f.options, ready, now: '2026-11-06T12:03:30Z', clock: () => Date.parse('2026-11-06T12:03:30Z') };
  const cleanup = changes => {
    assert.equal(typeof control.inspectManualFirstGuestCleanup, 'function', 'missing guest actor and resource-absence observation');
    return control.inspectManualFirstGuestCleanup({ ...options, ...changes });
  };
  return { ...f, ready, volumes, interfaces, options, cleanup };
}

test('guest cleanup reads OS termination and absence of captured disk and all subnet interfaces without releasing costs', async t => {
  const f = await guestCleanupFixture(t), before = structuredClone([...f.objects]), writes = f.writes.length;
  const result = await f.cleanup();
  assert.equal(result.instanceId, 'i-0123456789abcdef0');
  assert.equal(result.terminated, true); assert.equal(result.volumesAbsent, true); assert.equal(result.interfacesAbsent, true);
  assert.deepEqual(result.stateReason, { Code: 'Client.InstanceInitiatedShutdown', Message: 'Client.InstanceInitiatedShutdown: Instance initiated shutdown' });
  assert.equal(result.observedAt, '2026-11-06T12:03:30Z');
  assert.deepEqual(f.calls.filter(row => row.service === 'ec2').map(row => row.operation),
    ['describe-instances', 'describe-volumes', 'describe-network-interfaces']);
  assert.equal(Object.hasOwn(result, 'shutdownAt'), false);
  assert.equal(Object.hasOwn(result, 'billingReconciled'), false);
  assert.equal(f.writes.length, writes); assert.deepEqual(structuredClone([...f.objects]), before);
});

for (const [label, mutate] of [
  ['still running', f => { f.instance.State = { Name: 'running', Code: 16 }; }],
  ['API termination', f => { f.instance.StateReason.Code = 'Client.UserInitiatedShutdown'; }],
  ['missing actor', f => { delete f.instance.StateReason; }],
  ['foreign account', f => { f.instances.Reservations[0].OwnerId = '949687825720'; }],
  ['other instance', f => { f.instance.InstanceId = 'i-00000000000000000'; }],
  ['other run', f => { f.instance.ClientToken = '00000000-0000-4000-8000-000000000002'; }],
  ['changed tags', f => { f.instance.Tags[3].Value = '2026-11-06T12:06:00Z'; }],
  ['changed source', f => { f.ready.head = 'a'.repeat(40); }],
  ['unbooked run', f => {
    f.ready.reservation.uuid = '00000000-0000-4000-8000-000000000002';
    f.instance.ClientToken = f.ready.reservation.uuid; f.instance.Tags[2].Value = f.ready.reservation.uuid;
  }],
  ['no captured disk', f => { f.ready.volumeIds = []; }],
  ['invalid captured interface', f => { f.ready.interfaceIds = ['foreign']; }],
  ['no live ready observation', f => { f.ready.observedAt = '2026-11-06T12:03:00Z'; }],
  ['partial instance inventory', f => { f.instances.NextToken = 'more'; }],
  ['retained disk', f => { f.volumes.Volumes = [{ VolumeId: f.volumeId, State: 'available' }]; }],
  ['incomplete disk inventory', f => { f.volumes.NextToken = 'more'; }],
  ['missing disk inventory', f => { delete f.volumes.Volumes; }],
  ['retained interface', f => { f.interfaces.NetworkInterfaces = [{ NetworkInterfaceId: f.interfaceId }]; }],
  ['foreign subnet interface', f => { f.interfaces.NetworkInterfaces = [{ NetworkInterfaceId: 'eni-00000000000000000' }]; }],
  ['incomplete interface inventory', f => { f.interfaces.NextToken = 'more'; }],
  ['missing interface inventory', f => { delete f.interfaces.NetworkInterfaces; }],
  ['stale protection', f => { f.p.responses['s3api/get-object'].LastModified = '2026-11-06T12:00:00Z'; }],
]) test(`guest cleanup refuses ${label} without releasing the booking`, async t => {
  const f = await guestCleanupFixture(t); mutate(f); const before = structuredClone([...f.objects]);
  await assert.rejects(f.cleanup(), /D570 controller refused/);
  assert.deepEqual(structuredClone([...f.objects]), before);
});

for (const stage of ['source changes', 'protection ages', 'read fails']) test(`guest cleanup refuses when ${stage} during the final inventory`, async t => {
  const f = await guestCleanupFixture(t), previous = f.aws.call; let at = Date.parse(f.options.now);
  f.aws.call = async (...args) => {
    if (args[1] !== 'describe-network-interfaces') return previous(...args);
    if (stage === 'read fails') throw new Error('synthetic unavailable inventory');
    const result = await previous(...args);
    if (stage === 'source changes') {
      writeFileSync(join(f.root, 'controller.txt'), 'new clean main');
      f.git('add', 'controller.txt'); f.git('commit', '-s', '-m', 'Advance isolated main');
      f.git('update-ref', 'refs/remotes/origin/main', f.git('rev-parse', 'HEAD'));
    } else at = Date.parse('2026-11-06T12:05:00Z');
    return result;
  };
  const before = structuredClone([...f.objects]);
  await assert.rejects(f.cleanup({ clock: () => at }), stage === 'read fails' ? /synthetic unavailable inventory/ : /D570 controller refused/);
  assert.deepEqual(structuredClone([...f.objects]), before);
});

for (const [operation, input] of [
  ['describe-volumes', { Filters: [{ Name: 'volume-id', Values: ['vol-0123456789abcdef0'] }], MaxResults: 100 }],
  ['describe-network-interfaces', { Filters: [{ Name: 'subnet-id', Values: ['subnet-0123456789abcdef0'] }], MaxResults: 100 }],
]) test(`guest cleanup CLI sends the bounded ${operation} read`, async t => {
  const f = drillCliFixture(t);
  assert.deepEqual(await control.createManualAwsCli({ executable: f.executable }).call('ec2', operation, input), { accepted: true });
  assert.deepEqual(JSON.parse(readFileSync(f.capture)).slice(0, 6), ['ec2', operation, '--cli-input-json', JSON.stringify(input), '--region', 'eu-north-1']);
});

async function shutdownTimingFixture(t) {
  const f = await guestCleanupFixture(t), states = ['running', 'shutting-down', 'terminated'];
  let current = Date.parse('2026-11-06T12:02:50Z'), reads = 0;
  const previous = f.aws.call, sleeps = [];
  f.p.health.startedAt = '2026-11-06T12:02:00.000Z'; f.p.health.completedAt = '2026-11-06T12:02:01.000Z';
  f.p.responses['s3api/get-object'].Body = Buffer.from(JSON.stringify(f.p.health));
  f.p.responses['s3api/get-object'].LastModified = '2026-11-06T12:02:01Z';
  f.aws.call = async (...args) => {
    if (args[1] === 'describe-instances') {
      const name = states[Math.min(reads++, states.length - 1)];
      f.instance.State = { Name: name, Code: { running: 16, 'shutting-down': 32, terminated: 48 }[name] };
    }
    return previous(...args);
  };
  const options = { ...f.options, ready: f.ready, now: '2026-11-06T12:02:50Z', clock: () => current,
    sleep: async milliseconds => { sleeps.push(milliseconds); current += milliseconds; } };
  const observe = changes => {
    assert.equal(typeof control.observeManualFirstShutdown, 'function', 'missing bounded guest shutdown timing');
    return control.observeManualFirstShutdown({ ...options, ...changes });
  };
  return { ...f, options, states, sleeps, observe, setTime: value => { current = Date.parse(value); } };
}

test('shutdown timing retains a running request at 170 seconds and an OS termination reply before outer expiry', async t => {
  const f = await shutdownTimingFixture(t), before = structuredClone([...f.objects]);
  const result = await f.observe();
  assert.deepEqual(result.shutdownObservation, { runningRequestedAt: '2026-11-06T12:02:50Z',
    runningReceivedAt: '2026-11-06T12:02:50Z', terminatedReceivedAt: '2026-11-06T12:03:00Z',
    stateReason: { Code: 'Client.InstanceInitiatedShutdown', Message: 'Client.InstanceInitiatedShutdown: Instance initiated shutdown' } });
  assert.equal(result.observedAt, '2026-11-06T12:00:45Z');
  assert.equal(Object.hasOwn(result, 'volumesAbsent'), false);
  assert.equal(Object.hasOwn(result, 'billingReconciled'), false);
  assert.deepEqual(f.sleeps, [5000, 5000]);
  assert.deepEqual(structuredClone([...f.objects]), before);
  assert.equal(f.calls.some(row => ['describe-volumes', 'describe-network-interfaces', 'put-object', 'run-instances'].includes(row.operation)), false);
});

for (const [label, mutate] of [
  ['already terminated', f => { f.states.splice(0, 3, 'terminated'); }],
  ['already shutting down', f => { f.states.splice(0, 3, 'shutting-down', 'terminated'); }],
  ['API rescue', f => { f.instance.StateReason.Code = 'Client.UserInitiatedShutdown'; }],
  ['missing actor', f => { delete f.instance.StateReason; }],
  ['other run', f => { f.instance.ClientToken = '00000000-0000-4000-8000-000000000002'; }],
  ['partial inventory', f => { f.instances.NextToken = 'more'; }],
  ['changed reviewed source', f => { f.ready.head = 'a'.repeat(40); }],
  ['never terminates', f => { f.states.splice(0, 3, 'running'); }],
]) test(`shutdown timing refuses ${label} without clearing cost`, async t => {
  const f = await shutdownTimingFixture(t); mutate(f); const before = structuredClone([...f.objects]);
  await assert.rejects(f.observe(), /D570 controller refused/);
  assert.deepEqual(structuredClone([...f.objects]), before);
});

test('shutdown timing waits for the running window rather than relabeling an earlier read', async t => {
  const f = await shutdownTimingFixture(t); f.setTime('2026-11-06T12:02:49Z');
  const result = await f.observe({ now: '2026-11-06T12:02:49Z' });
  assert.equal(result.shutdownObservation.runningRequestedAt, '2026-11-06T12:02:50Z');
  assert.equal(f.sleeps[0], 1000);
});

test('shutdown timing refuses a termination reply at the original outer expiry', async t => {
  const f = await shutdownTimingFixture(t), previous = f.aws.call;
  f.aws.call = async (...args) => {
    const result = await previous(...args);
    if (args[1] === 'describe-instances' && result.Reservations[0].Instances[0].State.Name === 'terminated') f.setTime('2026-11-06T12:05:00Z');
    return result;
  };
  await assert.rejects(f.observe(), /D570 controller refused/);
});

for (const state of ['running', 'terminated']) test(`shutdown timing refuses clean main advancing during a ${state} read`, async t => {
  const f = await shutdownTimingFixture(t), previous = f.aws.call;
  f.aws.call = async (...args) => {
    const result = await previous(...args);
    if (args[1] === 'describe-instances' && result.Reservations[0].Instances[0].State.Name === state) {
      writeFileSync(join(f.root, 'controller.txt'), 'advance main during timing');
      f.git('add', 'controller.txt'); f.git('commit', '-s', '-m', 'Advance isolated main');
      f.git('update-ref', 'refs/remotes/origin/main', f.git('rev-parse', 'HEAD'));
    }
    return result;
  };
  await assert.rejects(f.observe(), /D570 controller refused/);
});

async function billingFixture(t) {
  const f = await guestCleanupFixture(t), previous = f.aws.call;
  const groups = [
    { Keys: ['Amazon Elastic Compute Cloud - Compute', 'EUN1-BoxUsage:m7g.2xlarge'], Metrics: {
      UnblendedCost: { Amount: '0.01', Unit: 'USD' }, UsageQuantity: { Amount: '0.03', Unit: 'N/A' } } },
    { Keys: ['EC2 - Other', 'EUN1-EBS:VolumeUsage.gp3'], Metrics: {
      UnblendedCost: { Amount: '0.0023456789', Unit: 'USD' }, UsageQuantity: { Amount: '0.04', Unit: 'N/A' } } },
  ];
  const response = { GroupDefinitions: [{ Type: 'DIMENSION', Key: 'SERVICE' }, { Type: 'DIMENSION', Key: 'USAGE_TYPE' }],
    ResultsByTime: [{ TimePeriod: { ...period }, Estimated: true, Total: {}, Groups: groups }] };
  f.aws.call = async (service, operation, input) => {
    if (service === 'ce') {
      f.calls.push({ service, operation, input });
      if (input.GroupBy) return structuredClone(response);
      return { ResultsByTime: [{ TimePeriod: input.TimePeriod, Estimated: response.ResultsByTime.at(-1)?.Estimated ?? true, Groups: [],
        Total: { UnblendedCost: { Amount: '0.0123456789', Unit: 'USD' } } }] };
    }
    return previous(service, operation, input);
  };
  f.calls.length = 0;
  const options = { ...f.options, setup: f.setup, launch: f.ready };
  const inspect = changes => {
    assert.equal(typeof control.inspectManualFirstBilling, 'function', 'missing itemized first-drill billing');
    return control.inspectManualFirstBilling({ ...options, ...changes });
  };
  return { ...f, options, response, groups, inspect };
}

// Dropping itemization, confusing usage units or treating an estimate as a final bill would hide cost.
test('first billing reports rounded account costs and separate usage rows without releasing the booking', async t => {
  const f = await billingFixture(t), before = structuredClone([...f.objects]), writes = f.writes.length;
  const result = await f.inspect();
  assert.deepEqual(result.costReport, { estimateMicroUsd: 9313491, accountCostMicroUsd: 12346, billedAccountMicroUsd: null,
    months: [{ period, estimated: true, accountCostMicroUsd: 12346, baselineMicroUsd: 0,
      components: [
        { service: 'Amazon Elastic Compute Cloud - Compute', usageType: 'EUN1-BoxUsage:m7g.2xlarge', microUsd: 10000,
          usage: { amount: '0.03', unit: 'N/A' } },
        { service: 'EC2 - Other', usageType: 'EUN1-EBS:VolumeUsage.gp3', microUsd: 2346,
          usage: { amount: '0.04', unit: 'N/A' } },
      ] }] });
  assert.deepEqual(f.calls.filter(row => row.service === 'ce').at(-1).input, {
    TimePeriod: period, Granularity: 'MONTHLY', Metrics: ['UnblendedCost', 'UsageQuantity'],
    GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }, { Type: 'DIMENSION', Key: 'USAGE_TYPE' }],
    Filter: { Dimensions: { Key: 'LINKED_ACCOUNT', Values: ['462991287391'] } },
  });
  assert.equal(Object.hasOwn(result, 'actualMicroUsd'), false);
  assert.equal(Object.hasOwn(result, 'billingReconciled'), false);
  assert.equal(result.budget.activeUuid, f.uuid);
  assert.equal(f.writes.length, writes); assert.deepEqual(structuredClone([...f.objects]), before);
});

test('first billing distinguishes a non-estimated account bill from the retained setup estimate', async t => {
  const f = await billingFixture(t); f.response.ResultsByTime[0].Estimated = false;
  const result = await f.inspect();
  assert.equal(result.costReport.billedAccountMicroUsd, 12346);
  assert.equal(result.costReport.estimateMicroUsd, 9313491);
  assert.equal(result.budget.activeUuid, f.uuid);
});

for (const [label, mutate] of [
  ['missing month', f => { f.response.ResultsByTime = []; }],
  ['duplicate month', f => { f.response.ResultsByTime.push(structuredClone(f.response.ResultsByTime[0])); }],
  ['wrong period', f => { f.response.ResultsByTime[0].TimePeriod.End = '2026-11-06'; }],
  ['partial page', f => { f.response.NextPageToken = 'more'; }],
  ['wrong grouping', f => { f.response.GroupDefinitions[1].Key = 'REGION'; }],
  ['unknown estimate', f => { delete f.response.ResultsByTime[0].Estimated; }],
  ['duplicate component', f => { const duplicate = structuredClone(f.groups[0]);
    duplicate.Metrics.UnblendedCost.Amount = '0'; duplicate.Metrics.UsageQuantity.Amount = '0'; f.groups.push(duplicate); }],
  ['foreign currency', f => { f.groups[0].Metrics.UnblendedCost.Unit = 'EUR'; }],
  ['negative credit', f => { f.groups[0].Metrics.UnblendedCost.Amount = '-0.01'; }],
  ['nondecimal cost', f => { f.groups[0].Metrics.UnblendedCost.Amount = '1e-2'; }],
  ['missing usage', f => { delete f.groups[0].Metrics.UsageQuantity; }],
  ['incomplete keys', f => { f.groups[0].Keys.pop(); }],
  ['over budget', f => { f.groups[0].Metrics.UnblendedCost.Amount = '9.99'; }],
  ['other run', f => { f.options.launch.reservation.uuid = '00000000-0000-4000-8000-000000000002'; }],
  ['other setup', f => { f.options.setup.bucket = 'other-bucket'; }],
]) test(`first billing refuses ${label} without rewriting history`, async t => {
  const f = await billingFixture(t); mutate(f); const before = structuredClone([...f.objects]);
  await assert.rejects(f.inspect(), /D570 controller refused|D570 budget refused/);
  assert.deepEqual(structuredClone([...f.objects]), before);
});

test('first billing refuses main advancing during the itemized request', async t => {
  const f = await billingFixture(t), previous = f.aws.call;
  f.aws.call = async (...args) => {
    const response = await previous(...args);
    if (args[0] === 'ce' && args[2].GroupBy) {
      writeFileSync(join(f.root, 'controller.txt'), 'advance main during billing');
      f.git('add', 'controller.txt'); f.git('commit', '-s', '-m', 'Advance isolated main');
      f.git('update-ref', 'refs/remotes/origin/main', f.git('rev-parse', 'HEAD'));
    }
    return response;
  };
  await assert.rejects(f.inspect(), /D570 controller refused/);
});

test('first billing keeps a later estimated month separate from a completed earlier bill', async t => {
  const f = await billingFixture(t), later = '2026-12-02T12:00:00Z';
  f.response.ResultsByTime[0].TimePeriod.End = '2026-12-01';
  f.response.ResultsByTime[0].Estimated = false;
  f.response.ResultsByTime.push({ TimePeriod: { Start: '2026-12-01', End: '2026-12-03' }, Estimated: true,
    Total: {}, Groups: structuredClone(f.groups) });
  f.p.health.startedAt = '2026-12-02T11:59:00.000Z'; f.p.health.completedAt = '2026-12-02T11:59:01.000Z';
  f.p.responses['s3api/get-object'].Body = Buffer.from(JSON.stringify(f.p.health));
  f.p.responses['s3api/get-object'].LastModified = '2026-12-02T11:59:01Z';
  const result = await f.inspect({ now: later, clock: () => Date.parse(later) });
  assert.equal(result.costReport.accountCostMicroUsd, 24692);
  assert.equal(result.costReport.billedAccountMicroUsd, null);
  assert.deepEqual(result.costReport.months.map(row => [row.period, row.estimated, row.accountCostMicroUsd]), [
    [{ Start: '2026-11-01', End: '2026-12-01' }, false, 12346],
    [{ Start: '2026-12-01', End: '2026-12-03' }, true, 12346],
  ]);
  assert.deepEqual(f.calls.filter(row => row.service === 'ce').at(-1).input.TimePeriod,
    { Start: '2026-11-01', End: '2026-12-03' });
});

for (const changed of ['estimate', 'amount']) test(`first billing refuses a contradictory current-month ${changed}`, async t => {
  const f = await billingFixture(t), previous = f.aws.call;
  f.aws.call = async (...args) => {
    const response = await previous(...args);
    if (args[0] === 'ce' && !args[2].GroupBy) {
      if (changed === 'estimate') response.ResultsByTime[0].Estimated = false;
      else response.ResultsByTime[0].Total.UnblendedCost.Amount = '0.02';
    }
    return response;
  };
  await assert.rejects(f.inspect(), /D570 controller refused/);
});

test('first billing refuses protection aging during the itemized read', async t => {
  const f = await billingFixture(t), previous = f.aws.call; let at = Date.parse(f.options.now);
  f.aws.call = async (...args) => {
    const response = await previous(...args);
    if (args[0] === 'ce' && args[2].GroupBy) at += 90000;
    return response;
  };
  await assert.rejects(f.inspect({ clock: () => at }), /D570 controller refused/);
});

test('first billing refuses a past month above its retained booking even when the current bill fits', async t => {
  const f = await billingFixture(t), later = '2026-12-02T12:00:00Z';
  const current = structuredClone(f.response.ResultsByTime[0]);
  current.TimePeriod = { Start: '2026-12-01', End: '2026-12-03' };
  f.response.ResultsByTime[0].TimePeriod.End = '2026-12-01';
  f.response.ResultsByTime[0].Estimated = false;
  f.groups[0].Metrics.UnblendedCost.Amount = '9.99';
  f.response.ResultsByTime.push(current);
  f.p.health.startedAt = '2026-12-02T11:59:00.000Z'; f.p.health.completedAt = '2026-12-02T11:59:01.000Z';
  f.p.responses['s3api/get-object'].Body = Buffer.from(JSON.stringify(f.p.health));
  f.p.responses['s3api/get-object'].LastModified = '2026-12-02T11:59:01Z';
  const before = structuredClone([...f.objects]);
  await assert.rejects(f.inspect({ now: later, clock: () => Date.parse(later) }), /D570 budget refused/);
  assert.deepEqual(structuredClone([...f.objects]), before);
});

async function historyExportFixture(t) {
  const f = await guestCleanupFixture(t), parent = mkdtempSync(join(tmpdir(), 'd570-private-export-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const directory = join(parent, 'history');
  const options = { ...f.options, stackId: f.setup.stackId, directory };
  const retain = changes => {
    assert.equal(typeof control.retainManualHistory, 'function', 'missing private retained history export');
    return control.retainManualHistory({ ...options, ...changes });
  };
  return { ...f, parent, directory, options, retain };
}

// Losing bytes, exporting inconsistent history or overwriting a previous export would erase cost ownership.
test('history export retains exact private ledger bytes and leaves the active booking and provider records intact', async t => {
  const f = await historyExportFixture(t), before = structuredClone([...f.objects]), writes = f.writes.length;
  const result = await f.retain();
  assert.equal(result.directory, f.directory);
  assert.equal(result.budget.activeUuid, f.uuid);
  assert.deepEqual(result.files.sort(), ['2026-11.json', '2026-12.json', 'active.json']);
  assert.equal(statSync(f.directory).mode & 0o777, 0o700);
  for (const [key, object] of f.objects) {
    const path = join(f.directory, key.slice('d570/ledger/'.length));
    assert.deepEqual(readFileSync(path), object.body);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(statSync(path).uid, process.getuid());
  }
  assert.equal(f.writes.length, writes);
  assert.deepEqual(structuredClone([...f.objects]), before);
  assert.equal(f.calls.some(row => ['put-object', 'delete-object', 'delete-stack', 'disable-rule', 'terminate-instances'].includes(row.operation)), false);
});

for (const stage of ['public parent', 'symbolic parent', 'relative path', 'checkout destination', 'existing directory', 'symbolic destination']) {
  test(`history export refuses ${stage} without overwriting local or provider records`, async t => {
    const f = await historyExportFixture(t), before = structuredClone([...f.objects]);
    let directory = f.directory;
    if (stage === 'public parent') chmodSync(f.parent, 0o755);
    if (stage === 'symbolic parent') { symlinkSync(f.parent, f.parent + '-link');
      t.after(() => rmSync(f.parent + '-link')); directory = join(f.parent + '-link', 'history'); }
    if (stage === 'relative path') directory = 'private-history';
    if (stage === 'checkout destination') { chmodSync(f.root, 0o700); directory = join(f.root, 'history'); }
    if (stage === 'existing directory') { mkdirSync(f.directory, { mode: 0o700 }); writeFileSync(join(f.directory, 'active.json'), 'keep'); }
    if (stage === 'symbolic destination') { symlinkSync(f.parent, f.directory); writeFileSync(join(f.parent, 'active.json'), 'keep'); }
    await assert.rejects(f.retain({ directory }), /D570 controller refused|EEXIST/);
    assert.deepEqual(structuredClone([...f.objects]), before);
    if (stage === 'existing directory') assert.equal(readFileSync(join(f.directory, 'active.json'), 'utf8'), 'keep');
    if (stage === 'symbolic destination') assert.equal(readFileSync(join(f.parent, 'active.json'), 'utf8'), 'keep');
    if (stage === 'public parent' || stage === 'checkout destination') assert.equal(existsSync(directory), false);
  });
}

for (const stage of ['missing month', 'changed month', 'unknown key', 'corrupt active']) test(`history export refuses ${stage} before creating a destination`, async t => {
  const f = await historyExportFixture(t);
  if (stage === 'missing month') f.objects.delete('d570/ledger/2026-11.json');
  if (stage === 'changed month') f.objects.get('d570/ledger/2026-11.json').body = Buffer.from('{}');
  if (stage === 'unknown key') f.objects.set('d570/ledger/foreign.json', { body: Buffer.from('{}'), etag: '"foreign"' });
  if (stage === 'corrupt active') f.objects.get('d570/ledger/active.json').body = Buffer.from('{}');
  const before = structuredClone([...f.objects]);
  await assert.rejects(f.retain(), /D570 controller refused|D570 budget refused/);
  assert.equal(existsSync(f.directory), false);
  assert.deepEqual(structuredClone([...f.objects]), before);
});

for (const stage of ['changed source', 'stale protection', 'changed active', 'changed month bytes', 'changed month etag', 'read failure']) {
  test(`history export refuses ${stage} during its final provider readback`, async t => {
    const f = await historyExportFixture(t), previous = f.aws.call; let lists = 0, at = Date.parse(f.options.now);
    f.aws.call = async (...args) => {
      if (args[1] === 'list-objects-v2') lists++;
      // Initial budget validation lists once; the export snapshots, validates locally, then re-reads all keys.
      if (lists >= 3 && args[1] === 'get-object' && args[2].Key === 'd570/ledger/2026-11.json') {
        if (stage === 'read failure') throw new Error('synthetic history read failure');
        if (stage === 'changed source') {
          writeFileSync(join(f.root, 'controller.txt'), 'new reviewed main during export');
          f.git('add', 'controller.txt'); f.git('commit', '-s', '-m', 'Advance isolated main during export');
          f.git('update-ref', 'refs/remotes/origin/main', f.git('rev-parse', 'HEAD'));
        }
        if (stage === 'stale protection') at += 120000;
        const row = f.objects.get(stage === 'changed active' ? 'd570/ledger/active.json' : args[2].Key);
        if (stage === 'changed active') row.etag = '"new-active"';
        if (stage === 'changed month etag') row.etag = '"new-month"';
        if (stage === 'changed month bytes') row.body = Buffer.concat([row.body, Buffer.from('\n')]);
      }
      return previous(...args);
    };
    await assert.rejects(f.retain({ clock: () => at }), /D570 controller refused|D570 budget refused|synthetic history read failure/);
    assert.equal(existsSync(f.directory), false);
  });
}

test('history export refuses a parent made public during provider reads', async t => {
  const f = await historyExportFixture(t), previous = f.aws.call; let lists = 0;
  f.aws.call = async (...args) => {
    if (args[1] === 'list-objects-v2') lists++;
    const result = await previous(...args);
    if (lists >= 3 && args[1] === 'get-object' && args[2].Key === 'd570/ledger/active.json') chmodSync(f.parent, 0o755);
    return result;
  };
  await assert.rejects(f.retain(), /D570 controller refused/);
  assert.equal(existsSync(f.directory), false);
});

for (const key of ['d570/ledger/active.json', 'd570/ledger/2026-11.json']) {
  test(`history export validates its captured ${key} after the initial live budget check`, async t => {
    const f = await historyExportFixture(t), previous = f.aws.call; let lists = 0;
    f.aws.call = async (...args) => {
      if (args[1] === 'list-objects-v2' && ++lists === 2) f.objects.get(key).body = Buffer.from('{}');
      return previous(...args);
    };
    await assert.rejects(f.retain(), /D570 budget refused/);
    assert.equal(existsSync(f.directory), false);
  });
}

// An explained opening is admissible before booking; unknown rows cannot consume the only setup directory.
async function explainedOpeningFixture(t) {
  const f = await creationFixture(t), prior = f.aws.call;
  const groups = [{ Keys: ['Amazon Simple Storage Service', 'EUN1-TimedStorage-ByteHrs'],
    Metrics: { UnblendedCost: { Amount: '0.01', Unit: 'USD' }, UsageQuantity: { Amount: '0.1', Unit: 'N/A' } } }];
  const explanations = [{ service: 'Amazon Simple Storage Service', usageType: 'EUN1-TimedStorage-ByteHrs',
    maxMicroUsd: 10000, reason: 'Existing synthetic staging backup' }];
  f.aws.call = async (service, operation, input) => {
    if (service === 'ce') {
      f.calls.push({ service, operation, input });
      if (input.GroupBy) return { GroupDefinitions: input.GroupBy, ResultsByTime: [{ TimePeriod: input.TimePeriod,
        Estimated: true, Groups: structuredClone(groups), Total: {} }] };
      return { ResultsByTime: [{ TimePeriod: input.TimePeriod, Estimated: true, Groups: [],
        Total: { UnblendedCost: { Amount: '0.01', Unit: 'USD' } } }] };
    }
    if (operation === 'create-stack') {
      const saved = JSON.parse(readFileSync(join(f.options.directory, 'setup.json')));
      assert.equal(saved.billing.microUsd, 10000);
      assert.equal(saved.upperMicroUsd, 9313491);
      assert.equal(saved.openingExplanations[0].microUsd, 10000);
      assert.equal(saved.openingExplanations[0].reason, 'Existing synthetic staging backup');
      f.calls.push({ service, operation, input }); return { StackId: f.p.stackId };
    }
    return prior(service, operation, input);
  };
  return { ...f, groups, explanations };
}

test('explained opening starts the first setup and retains the actual list before creating', async t => {
  const f = await explainedOpeningFixture(t);
  const result = await f.create({ explanations: f.explanations });
  assert.equal(result.openingBilling.microUsd, 10000);
  assert.equal(result.upperMicroUsd, 9313491);
  assert.deepEqual(result.openingExplanations, [{ service: 'Amazon Simple Storage Service',
    usageType: 'EUN1-TimedStorage-ByteHrs', microUsd: 10000, maxMicroUsd: 10000,
    reason: 'Existing synthetic staging backup' }]);
  assert.equal(f.calls.filter(row => row.operation === 'create-stack').length, 1);
});

for (const [label, definitions] of [
  ['missing', undefined], ['null', null], ['empty', []],
  ['wrong dimension', [{ Type: 'DIMENSION', Key: 'SERVICE' }, { Type: 'DIMENSION', Key: 'REGION' }]],
  ['reversed dimensions', [{ Type: 'DIMENSION', Key: 'USAGE_TYPE' }, { Type: 'DIMENSION', Key: 'SERVICE' }]],
]) test(`explained opening refuses ${label} grouping before booking`, async t => {
  const f = await explainedOpeningFixture(t), prior = f.aws.call;
  f.aws.call = async (service, operation, input) => {
    const response = await prior(service, operation, input);
    if (service === 'ce' && input.GroupBy) {
      if (definitions === undefined) delete response.GroupDefinitions;
      else response.GroupDefinitions = structuredClone(definitions);
    }
    return response;
  };
  await assert.rejects(f.create({ explanations: f.explanations }), /D570 controller refused: ce grouped shape/);
  assert.equal(existsSync(join(f.options.directory, 'setup.json')), false);
  assert.equal(f.calls.some(row => ['create-stack', 'put-object', 'run-instances'].includes(row.operation)), false);
});

for (const [label, change] of [
  ['missing', f => []],
  ['lower ceiling', f => [{ ...f.explanations[0], maxMicroUsd: 9999 }]],
  ['duplicate', f => [...f.explanations, ...f.explanations]],
  ['unused', f => [...f.explanations, { ...f.explanations[0], usageType: 'another' }]],
  ['empty reason', f => [{ ...f.explanations[0], reason: ' ' }]],
]) test(`explained opening refuses ${label} before writing the booking and reports the observed spend`, async t => {
  const f = await explainedOpeningFixture(t);
  await assert.rejects(f.create({ explanations: change(f) }), error => {
    assert.equal(error.message, 'D570 opening spend needs explanations');
    assert.equal(error.opening?.billing.microUsd, 10000);
    assert.equal(error.opening?.items[0].service, 'Amazon Simple Storage Service');
    assert.equal(error.opening?.items[0].microUsd, 10000);
    return true;
  });
  assert.equal(existsSync(f.options.directory), false);
  assert.equal(f.calls.some(row => row.operation === 'create-stack'), false);
});

test('explained opening refuses a changed total before booking', async t => {
  const f = await explainedOpeningFixture(t);
  f.groups[0].Metrics.UnblendedCost.Amount = '0.02';
  await assert.rejects(f.create({ explanations: f.explanations }));
  assert.equal(existsSync(f.options.directory), false);
});

// Omitting the opening from a later comparison must not reject an otherwise fully booked setup.
test('explained opening remains part of the post-create account limit', async t => {
  const f = await explainedOpeningFixture(t), prior = f.aws.call; let created = false;
  f.aws.call = async (...args) => {
    const response = await prior(...args);
    if (args[1] === 'create-stack') created = true;
    if (args[0] === 'ce' && !args[2].GroupBy && created) response.ResultsByTime[0].Total.UnblendedCost.Amount = '9.32';
    return response;
  };
  const result = await f.create({ explanations: f.explanations });
  assert.equal(result.openingBilling.microUsd, 10000);
  assert.equal(result.billing.microUsd, 9320000);
});

test('explained opening books only the current month baseline and binds reasons in its existing digest', async t => {
  const f = await initializationFixture(t), opening = await explainedOpeningFixture(t), prior = f.aws.call;
  f.aws.call = async (service, operation, input) => {
    if (service === 'ce') return opening.aws.call(service, operation, input);
    if (operation === 'create-stack') {
      f.calls.push({ service, operation, input });
      return { StackId: f.p.stackId };
    }
    return prior(service, operation, input);
  };
  const result = await f.initialize({ explanations: opening.explanations });
  assert.equal(result.runEvidence.openings['2026-11'].baselineMicroUsd, 10000);
  assert.equal(result.runEvidence.openings['2026-12'].baselineMicroUsd, 0);
  assert.notEqual(result.runEvidence.openings['2026-11'].digest, result.runEvidence.openings['2026-12'].digest);
  const { createHash } = await import('node:crypto');
  const expected = createHash('sha256').update(JSON.stringify({ month: '2026-11', baselineMicroUsd: 10000,
    billing: result.openingBilling, cost: result.cost, openingExplanations: result.openingExplanations })).digest('hex');
  assert.equal(result.runEvidence.openings['2026-11'].digest, expected);
});

// A new reviewed main must not invalidate the retained run or release its cost reservation.
test('later billing reads current clean main while matching the original run to its ledger', async t => {
  const f = await billingFixture(t), oldHead = f.setup.head;
  writeFileSync(join(f.root, 'controller.txt'), 'later reviewed main\n'); f.git('add', 'controller.txt');
  f.git('-c', 'commit.gpgsign=false', 'commit', '-s', '-m', 'Move isolated reviewed main between sittings');
  f.git('update-ref', 'refs/remotes/origin/main', f.git('rev-parse', 'HEAD'));
  const before = structuredClone([...f.objects]);
  const result = await f.inspect();
  assert.equal(result.head, f.git('rev-parse', 'HEAD'));
  assert.notEqual(result.head, oldHead);
  assert.equal(result.costReport.accountCostMicroUsd, 12346);
  assert.deepEqual(structuredClone([...f.objects]), before);
});

test('later billing refuses a jointly altered saved head and tree rather than trusting local files', async t => {
  const f = await billingFixture(t), before = structuredClone([...f.objects]);
  for (const row of [f.options.setup, f.options.launch, f.options.launch.reservation]) { row.head = 'a'.repeat(40); row.tree = 'b'.repeat(40); }
  await assert.rejects(f.inspect(), /D570 controller refused/);
  assert.deepEqual(structuredClone([...f.objects]), before);
});

test('later billing refuses changed opening explanations without rewriting its retained ledger', async t => {
  const f = await billingFixture(t), before = structuredClone([...f.objects]);
  f.options.setup.openingExplanations = [{ service: 'invented', usageType: 'invented', microUsd: 0,
    maxMicroUsd: 0, reason: 'Edited after booking' }];
  await assert.rejects(f.inspect(), /D570 controller refused/);
  assert.deepEqual(structuredClone([...f.objects]), before);
});

// Removing protection or provider history before independent absence and a durable export must fail.
async function removalFixture(t, { partial = false, deletionAttempts = 1 } = {}) {
  const f = await historyExportFixture(t), prior = f.aws.call;
  let current = Date.parse(f.options.now), deleted = false, healthPresent = true;
  const sleeps = [];
  f.p.responses['cloudformation/describe-stacks'].Stacks[0].Tags = [{ Key: 'Proof', Value: 'D570' }];
  f.p.responses['cloudformation/describe-stacks'].Stacks[0].CreationTime = '2026-11-06T12:00:01Z';
  f.aws.call = async (service, operation, input) => {
    if (operation === 'describe-instances' && input.Filters) {
      assert.deepEqual(input.Filters, [{ Name: 'subnet-id', Values: [f.ids.Subnet] }]);
      f.calls.push({ service, operation, input }); return structuredClone(f.instances);
    }
    if (operation === 'describe-volumes' && input.Filters?.[0].Name === 'tag:Proof') {
      f.calls.push({ service, operation, input }); return structuredClone(f.volumes);
    }
    if (operation === 'list-objects-v2' && input.Prefix === 'd570/') {
      f.calls.push({ service, operation, input });
      return { IsTruncated: false, Contents: [...f.objects.keys(), ...(healthPresent ? ['d570/health/reaper.json'] : [])].map(Key => ({ Key })) };
    }
    if (operation === 'disable-rule') {
      assert.equal(existsSync(join(f.directory, partial ? '2026-11.json' : 'active.json')), true);
      f.calls.push({ service, operation, input });
      f.p.responses['events/describe-rule'].State = 'DISABLED'; return {};
    }
    if (operation === 'delete-objects') {
      assert.deepEqual(sleeps, Array(deletionAttempts).fill(120000));
      if (!partial) assert.equal(readFileSync(join(f.directory, 'active.json')).equals(f.objects.get('d570/ledger/active.json')?.body
        ?? readFileSync(join(f.directory, 'active.json'))), true);
      f.calls.push({ service, operation, input });
      for (const row of input.Delete.Objects) { f.objects.delete(row.Key); if (row.Key === 'd570/health/reaper.json') healthPresent = false; }
      return { Deleted: structuredClone(input.Delete.Objects) };
    }
    if (operation === 'delete-stack') {
      assert.equal(f.objects.size, 0); assert.equal(healthPresent, false);
      f.calls.push({ service, operation, input }); deleted = true; return {};
    }
    if (operation === 'describe-stacks' && deleted) {
      f.calls.push({ service, operation, input }); return { Stacks: [{ StackId: f.setup.stackId, StackStatus: 'DELETE_COMPLETE' }] };
    }
    return prior(service, operation, input);
  };
  const options = { ...f.options, setup: f.setup, clock: () => current,
    sleep: async ms => { sleeps.push(ms); current += ms; } };
  const remove = changes => {
    assert.equal(typeof control.removeManualFirstSetup, 'function', 'missing owned first-setup removal');
    return control.removeManualFirstSetup({ ...options, ...changes });
  };
  f.calls.length = 0;
  return { ...f, options, sleeps, remove };
}

test('first removal exports the full booked ledger before disabling expiry and deleting only its empty stack', async t => {
  const f = await removalFixture(t), original = new Map([...f.objects].map(([key, value]) => [key, Buffer.from(value.body)]));
  const result = await f.remove();
  assert.equal(result.deleted, true); assert.equal(result.stackId, f.setup.stackId);
  assert.equal(JSON.parse(readFileSync(join(f.directory, 'active.json'))).active.identity.uuid, f.uuid);
  for (const [key, body] of original) assert.equal(readFileSync(join(f.directory, key.split('/').at(-1))).equals(body), true);
  assert.equal(existsSync(join(f.setup.directory, 'setup.json')), true);
  assert.equal(f.calls.some(row => ['terminate-instances', 'delete-volume', 'put-object', 'run-instances'].includes(row.operation)), false);
  assert.equal(f.calls.filter(row => row.operation === 'delete-stack').length, 1);
});

for (const [label, mutate] of [
  ['live machine', f => { f.instance.State.Name = 'running'; }],
  ['remaining disk', f => { f.volumes.Volumes.push({ VolumeId: f.volumeId }); }],
  ['remaining interface', f => { f.interfaces.NetworkInterfaces.push({ NetworkInterfaceId: f.interfaceId }); }],
  ['foreign stack tag', f => { f.p.responses['cloudformation/describe-stacks'].Stacks[0].Tags[0].Value = 'other'; }],
]) test(`first removal keeps protection and all booking bytes for ${label}`, async t => {
  const f = await removalFixture(t), before = structuredClone([...f.objects]); mutate(f);
  await assert.rejects(f.remove(), /D570 controller refused/);
  assert.deepEqual(structuredClone([...f.objects]), before);
  assert.equal(f.calls.some(row => ['disable-rule', 'delete-objects', 'delete-stack'].includes(row.operation)), false);
});

test('first removal does not require a new account bill or opening explanation to stop retained costs', async t => {
  const f = await removalFixture(t), prior = f.aws.call;
  f.aws.call = async (...args) => { if (args[0] === 'ce') assert.fail('cleanup must not require billing'); return prior(...args); };
  assert.equal((await f.remove()).deleted, true);
  assert.equal(f.calls.some(row => row.service === 'ce'), false);
});

test('first removal retains a partial initialization without inventing its missing active record', async t => {
  const f = await removalFixture(t, { partial: true });
  f.objects.delete('d570/ledger/active.json');
  assert.equal((await f.remove()).deleted, true);
  assert.equal(existsSync(join(f.directory, 'setup.json')), true);
  assert.equal(existsSync(join(f.directory, 'active.json')), false);
});

test('first removal can retry partial object deletion using the original private export', async t => {
  const f = await removalFixture(t, { deletionAttempts: 2 }), prior = f.aws.call; let first = true;
  f.aws.call = async (service, operation, input) => {
    if (operation === 'delete-objects' && first) {
      first = false; f.objects.delete('d570/ledger/2026-11.json');
      return { Errors: [{ Key: 'd570/ledger/active.json', Code: 'InternalError' }], Deleted: [{ Key: 'd570/ledger/2026-11.json' }] };
    }
    return prior(service, operation, input);
  };
  await assert.rejects(f.remove(), /D570 controller refused/);
  const retained = readFileSync(join(f.directory, '2026-11.json'));
  assert.equal(f.calls.some(row => row.operation === 'delete-stack'), false);
  assert.equal((await f.remove()).deleted, true);
  assert.equal(readFileSync(join(f.directory, '2026-11.json')).equals(retained), true);
});

// The real command adapter must reject broad deletion requests before starting its subprocess.
for (const [service, operation, input, response] of [
  ['cloudformation', 'delete-stack', { StackName: 'arn:aws:cloudformation:eu-north-1:462991287391:stack/d570-first/00000000-0000-4000-8000-000000000000' }, {}],
  ['events', 'disable-rule', { Name: 'd570-first-rule', EventBusName: 'default' }, {}],
  ['s3api', 'list-objects-v2', { Bucket: 'd570-first-bucket', ExpectedBucketOwner: '462991287391', Prefix: 'd570/', MaxKeys: 1000 }, { IsTruncated: false, Contents: [] }],
  ['s3api', 'delete-objects', { Bucket: 'd570-first-bucket', ExpectedBucketOwner: '462991287391',
    Delete: { Objects: [{ Key: 'd570/ledger/active.json' }, { Key: 'd570/health/reaper.json' }], Quiet: false } },
    { Deleted: [{ Key: 'd570/ledger/active.json' }, { Key: 'd570/health/reaper.json' }] }],
]) test(`removal CLI validates and sends the exact ${operation} boundary`, async t => {
  const f = fixture(t), executable = join(f.root, 'aws-removal.cjs'), capture = join(f.root, 'request.json');
  writeFileSync(executable, `#!${process.execPath}\nconst fs=require('node:fs');fs.writeFileSync(${JSON.stringify(capture)},JSON.stringify(process.argv.slice(2)));process.stdout.write(${JSON.stringify(Object.keys(response).length ? JSON.stringify(response) : '')});\n`, { mode: 0o700 });
  assert.deepEqual(await control.createManualAwsCli({ executable }).call(service, operation, input), response);
  const args = JSON.parse(readFileSync(capture));
  assert.deepEqual(args.slice(0, 6), [service, operation, '--cli-input-json', JSON.stringify(input), '--region', 'eu-north-1']);
});

async function ownerCommand(f, args, changes = {}) {
  assert.equal(typeof control.runManualCommand, 'function', 'missing owner command lifecycle');
  const docs = JSON.parse(readFileSync(new URL('../deploy/kubernetes/proof/test-fixtures/prices.json', import.meta.url)));
  const fetch = async url => {
    const service = Object.keys(docs).find(name => new URL(url).pathname.includes('/' + name + '/'));
    assert.ok(service, 'only the four fixed public price files are requested');
    return new Response(JSON.stringify(docs[service]), { headers: { 'content-type': 'application/json' } });
  };
  return control.runManualCommand({ ...f.options, args, fetch, ...changes });
}

test('owner command up reports unexplained opening before price acquisition or a booking', async t => {
  const f = await explainedOpeningFixture(t);
  await assert.rejects(ownerCommand(f, ['up', f.parent], { fetch: () => assert.fail('prices before explained opening') }),
    error => error.message === 'D570 opening spend needs explanations' && error.opening.billing.microUsd === 10000);
  assert.equal(existsSync(join(f.parent, 'setup')), false);
  assert.equal(existsSync(join(f.parent, 'initialized.json')), false);
});

test('owner command up acquires retained paid prices and saves one initialized setup without launching', async t => {
  const f = await initializationFixture(t);
  const result = await ownerCommand(f, ['up', f.parent]);
  assert.equal(result.upperMicroUsd, 9313491);
  assert.equal(result.openingBilling.microUsd, 0);
  const saved = JSON.parse(readFileSync(join(f.parent, 'initialized.json')));
  assert.equal(saved.stackId, f.p.stackId); assert.equal(saved.budget.activeUuid, null);
  assert.equal(statSync(join(f.parent, 'initialized.json')).mode & 0o777, 0o600);
  assert.equal(f.calls.some(row => row.operation === 'run-instances'), false);
  await assert.rejects(ownerCommand(f, ['up', f.parent]));
  assert.deepEqual(f.counts(), { creates: 1, enables: 1 });
});

test('owner command reconcile reports account billing and leaves the full reservation active', async t => {
  const f = await billingFixture(t), base = f.parent;
  writeFileSync(join(base, 'initialized.json'), JSON.stringify(f.setup), { mode: 0o600 });
  writeFileSync(join(base, 'launch.json'), JSON.stringify(f.ready), { mode: 0o600 });
  const before = structuredClone([...f.objects]);
  const result = await ownerCommand(f, ['reconcile', base]);
  assert.equal(result.costReport.accountCostMicroUsd, 12346);
  assert.equal(result.costReport.billedAccountMicroUsd, null);
  assert.equal(result.budget.activeUuid, f.uuid);
  assert.deepEqual(structuredClone([...f.objects]), before);
});

test('owner command down consumes the saved setup and retains history before removal', async t => {
  const f = await removalFixture(t);
  writeFileSync(join(f.parent, 'initialized.json'), JSON.stringify(f.setup), { mode: 0o600 });
  assert.equal((await ownerCommand(f, ['down', f.parent])).deleted, true);
  assert.equal(existsSync(join(f.directory, 'active.json')), true);
});

// Only a known transient observation may be retried; it never becomes a successful readiness or absence proof.
for (const pending of ['instance', 'console']) test(`owner readiness distinguishes a pending ${pending} from a safety refusal`, async t => {
  const f = await readyGuestFixture(t);
  if (pending === 'instance') f.instance.State.Name = 'pending'; else f.consoleOutput.Output = '';
  await assert.rejects(f.observe(), error => error.message === 'D570 controller refused: readiness pending' && error.code === 'D570_NOT_READY');
});

for (const pending of ['volume', 'interface']) test(`owner cleanup distinguishes a remaining captured ${pending} without releasing its booking`, async t => {
  const f = await guestCleanupFixture(t), before = structuredClone([...f.objects]);
  if (pending === 'volume') f.volumes.Volumes.push({ VolumeId: f.volumeId });
  else f.interfaces.NetworkInterfaces.push({ NetworkInterfaceId: f.interfaceId, SubnetId: f.ids.Subnet, OwnerId: '462991287391' });
  await assert.rejects(f.cleanup(), error => error.message === 'D570 controller refused: cleanup pending' && error.code === 'D570_CLEANUP_PENDING');
  assert.deepEqual(structuredClone([...f.objects]), before);
});

for (const [latency, delayedConsole, pendingUntil = 0, consoleLatency = 0] of [[0, false], [1000, false], [0, true], [0, true, 165000, 20000]]) test(`owner command drill records the original shutdown window with ${latency}ms provider latency${delayedConsole ? ' and console at T449' : ''}${pendingUntil ? ' with pending until T165 and slow console' : ''}`, async t => {
  const f = await drillFixture(t), prior = f.aws.call, base = f.parent;
  writeFileSync(join(base, 'initialized.json'), JSON.stringify(f.setup), { mode: 0o600 });
  let current = Date.parse(now), launchedAt, reservedAt, instanceReads = 0, consoleReads = 0, providerCalls = 0;
  const instance = { InstanceId: f.instanceId, ClientToken: f.uuid, InstanceType: 'm7g.2xlarge',
    SubnetId: f.ids.Subnet, RootDeviceName: '/dev/xvda', RootDeviceType: 'ebs',
    Tags: [{ Key: 'Proof', Value: 'D570' }, { Key: 'Stack', Value: f.setup.stackId }, { Key: 'Run', Value: f.uuid },
      { Key: 'ExpiresAt', Value: '2026-11-06T12:05:00Z' }],
    BlockDeviceMappings: [{ DeviceName: '/dev/xvda', Ebs: { VolumeId: 'vol-0123456789abcdef0', DeleteOnTermination: true, Status: 'attached' } }],
    NetworkInterfaces: [{ NetworkInterfaceId: 'eni-0123456789abcdef0', OwnerId: '462991287391', SubnetId: f.ids.Subnet,
      Status: 'in-use', Groups: [{ GroupId: f.ids.SecurityGroup }],
      Attachment: { DeviceIndex: 0, Status: 'attached', DeleteOnTermination: true } }],
  };
  f.aws.call = async (service, operation, input) => {
    providerCalls++;
    if (latency) { await new Promise(resolve => setTimeout(resolve, 25)); current += latency; }
    if (operation === 'run-instances') {
      launchedAt = current; reservedAt = Date.parse(JSON.parse(f.objects.get('d570/ledger/active.json').body).active.identity.startedAt);
      instance.Tags = structuredClone(input.TagSpecifications[0].Tags);
    }
    if (operation === 'get-object' && input.Key === 'd570/health/reaper.json') {
      f.p.health.startedAt = new Date(current - 1000).toISOString(); f.p.health.completedAt = f.p.health.startedAt;
      f.p.responses['s3api/get-object'].Body = Buffer.from(JSON.stringify(f.p.health));
      f.p.responses['s3api/get-object'].LastModified = f.p.health.startedAt;
    }
    if (['describe-instances', 'describe-instance-attribute', 'get-console-output', 'describe-volumes', 'describe-network-interfaces'].includes(operation)) {
      f.calls.push({ service, operation, input });
      if (operation === 'describe-instances') {
        const state = instanceReads++ === 0 || current < reservedAt + pendingUntil ? 'pending' : current >= reservedAt + 180000 ? 'terminated' : 'running';
        return { Reservations: [{ OwnerId: '462991287391', Instances: [{ ...instance, State: { Name: state },
          ...(state === 'terminated' ? { StateReason: { Code: 'Client.InstanceInitiatedShutdown' } } : {}) }] }] };
      }
      if (operation === 'describe-instance-attribute') return { InstanceId: f.instanceId, InstanceInitiatedShutdownBehavior: { Value: 'terminate' } };
      if (operation === 'get-console-output') { current += consoleLatency; return { InstanceId: f.instanceId, Timestamp: new Date(current).toISOString(),
        Output: consoleReads++ === 0 || delayedConsole && current < reservedAt + 449000 ? '' : 'D570_DEADLINE_READY ' + f.uuid + ' ' + (reservedAt + 180000) / 1000 + ' 11111111-1111-4111-8111-111111111111\n' }; }
      return operation === 'describe-volumes' ? { Volumes: [] } : { NetworkInterfaces: [] };
    }
    return prior(service, operation, input);
  };
  const run = () => ownerCommand(f, ['drill', base], { uuid: f.uuid, clock: () => current, sleep: async ms => {
    current += ms;
    if (pendingUntil && reservedAt !== undefined && current < reservedAt + pendingUntil) current = reservedAt + pendingUntil;
    // The buffered wait can pass between wake-ups without changing the earlier shutdown observations.
    if (delayedConsole && consoleReads >= 2 && current >= reservedAt + 180000) current = Math.max(current, reservedAt + 450000);
  } });
  let remoteLog;
  const beforeCalls = f.calls.length;
  if (latency) {
    const bin = join(base, 'git-bin'); mkdirSync(bin, { mode: 0o700 });
    remoteLog = join(base, 'remote-lookups'); writeFileSync(remoteLog, '');
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
    writeFileSync(join(bin, 'git'), '#!/bin/sh\nif [ "$1" = ls-remote ]; then printf x >> ' + quote(remoteLog) + '; fi\nexec ' + quote(realGit) + ' "$@"\n', { mode: 0o700 });
    const previousPath = process.env.PATH; process.env.PATH = bin + ':' + previousPath;
    t.after(() => { process.env.PATH = previousPath; });
  }
  const started = performance.now(), result = await run();
  const remoteLookups = remoteLog ? readFileSync(remoteLog, 'utf8').length : null;
  t.diagnostic(JSON.stringify({ providerLatencyMs: latency, realBoundaryDelayMs: latency ? 25 : 0, providerCalls, remoteLookups, commandWallMs: performance.now() - started }));
  if (remoteLog) {
    const mutations = f.calls.slice(beforeCalls).filter(row => ['create-stack', 'run-instances', 'put-object', 'enable-rule', 'disable-rule', 'delete-objects', 'delete-stack'].includes(row.operation)).length;
    assert.equal(remoteLookups, mutations + 1, 'one remote check at command entry and before each state-changing provider call');
  }
  assert.equal(result.terminated, true); assert.equal(result.volumesAbsent, true); assert.equal(result.interfacesAbsent, true);
  if (latency === 0) {
    assert.equal(result.shutdownObservation.runningRequestedAt, '2026-11-06T12:02:50Z');
    assert.equal(result.shutdownObservation.terminatedReceivedAt, '2026-11-06T12:03:00Z');
    assert.deepEqual(result.runtimeObservation, { runningObservedAfterSeconds: 170, terminatedObservedAfterSeconds: 180,
      shutdownObservedWithinSeconds: 10, exactPoweroff: false });
  } else {
    assert.ok(result.runtimeObservation.runningObservedAfterSeconds >= 170);
    assert.ok(result.runtimeObservation.runningObservedAfterSeconds < 180);
    assert.ok(result.runtimeObservation.terminatedObservedAfterSeconds >= 180);
    assert.ok(result.runtimeObservation.terminatedObservedAfterSeconds < 300);
    assert.equal(result.runtimeObservation.exactPoweroff, false);
  }
  for (const name of ['launch.json', 'ready.json', 'shutdown.json', 'cleanup.json']) {
    assert.equal(statSync(join(base, name)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(readFileSync(join(base, name))).reservation.uuid, f.uuid);
  }
  assert.ok(instanceReads >= 5);
  if (delayedConsole) { assert.ok(consoleReads > 2); assert.ok(current >= reservedAt + 449000); }
  else assert.equal(consoleReads, 2);
  await assert.rejects(run());
  assert.equal(f.calls.filter(row => row.operation === 'run-instances').length, 1);
  assert.equal(JSON.parse(f.objects.get('d570/ledger/active.json').body).active.identity.uuid, f.uuid);
  if (latency === 0) {
    const originalCleanup = readFileSync(join(base, 'cleanup.json')), afterDrill = f.aws.call;
    let deleted = false, healthPresent = true;
    f.p.responses['cloudformation/describe-stacks'].Stacks[0].Tags = [{ Key: 'Proof', Value: 'D570' }];
    f.p.responses['cloudformation/describe-stacks'].Stacks[0].CreationTime = now;
    f.aws.call = async (service, operation, input) => {
      if (service === 'ce' && input.GroupBy) return { GroupDefinitions: input.GroupBy,
        ResultsByTime: [{ TimePeriod: input.TimePeriod, Estimated: true, Groups: [], Total: {} }] };
      if (operation === 'disable-rule') { f.p.responses['events/describe-rule'].State = 'DISABLED'; return {}; }
      if (operation === 'list-objects-v2' && input.Prefix === 'd570/') return { IsTruncated: false,
        Contents: [...f.objects.keys(), ...(healthPresent ? ['d570/health/reaper.json'] : [])].map(Key => ({ Key })) };
      if (operation === 'delete-objects') {
        for (const row of input.Delete.Objects) { f.objects.delete(row.Key); if (row.Key === 'd570/health/reaper.json') healthPresent = false; }
        return { Deleted: structuredClone(input.Delete.Objects) };
      }
      if (operation === 'delete-stack') { assert.equal(f.objects.size, 0); assert.equal(healthPresent, false); deleted = true; return {}; }
      if (operation === 'describe-stacks' && deleted) return { Stacks: [{ StackId: f.setup.stackId, StackStatus: 'DELETE_COMPLETE' }] };
      return afterDrill(service, operation, input);
    };
    const command = name => ownerCommand(f, [name, base], { clock: () => current, sleep: async ms => { current += ms; } });
    await assert.rejects(command('drill'), { message: 'D570 controller refused: ec2 launch' });
    assert.equal((await command('reconcile')).costReport.accountCostMicroUsd, 0);
    assert.equal((await command('down')).deleted, true);
    assert.equal(readFileSync(join(base, 'cleanup.json')).equals(originalCleanup), true);
    assert.equal(existsSync(join(base, 'retry')), false);
    assert.equal(f.calls.filter(row => row.operation === 'run-instances').length, 1);
  }
});

test('owner command shows the actual opening and fixed reservation headroom before a cap refusal', async t => {
  const f = await explainedOpeningFixture(t), prior = f.aws.call;
  f.groups[0].Metrics.UnblendedCost.Amount = '11';
  f.aws.call = async (...args) => {
    const response = await prior(...args);
    if (args[0] === 'ce' && !args[2].GroupBy) response.ResultsByTime[0].Total.UnblendedCost.Amount = '11';
    return response;
  };
  await assert.rejects(ownerCommand(f, ['up', f.parent, '--explain', 'Amazon Simple Storage Service',
    'EUN1-TimedStorage-ByteHrs', '11000000', 'Existing synthetic staging backup']), error => {
    assert.equal(error.message, 'D570 opening and reservation reach the monthly cap');
    assert.equal(error.opening.billing.microUsd, 11000000);
    assert.equal(error.opening.estimateMicroUsd, 9313491);
    assert.equal(error.opening.headroomMicroUsd, -313491);
    return true;
  });
  assert.equal(existsSync(f.options.directory), false);
  assert.equal(f.calls.some(row => row.operation === 'create-stack'), false);
});

test('owner command help prints the runnable command shape without credentials or provider calls', () => {
  const result = spawnSync(process.execPath, [target.pathname, '--help'], { encoding: 'utf8', timeout: 5000,
    env: { ...process.env, AWS_PROFILE: 'd570-nonexistent-synthetic-profile', AWS_EC2_METADATA_DISABLED: 'true' } });
  assert.ifError(result.error); assert.equal(result.status, 0); assert.equal(result.stderr, '');
  assert.match(result.stdout, /up\|drill\|reconcile\|down/);
  assert.match(result.stdout, /--explain SERVICE USAGE_TYPE MAX_MICRO_USD REASON/);
  assert.match(result.stdout, /private directory/);
});

for (const [label, service, operation, input] of [
  ['foreign account stack', 'cloudformation', 'delete-stack', { StackName: 'arn:aws:cloudformation:eu-north-1:111111111111:stack/d570-first/00000000-0000-4000-8000-000000000000' }],
  ['unqualified stack name', 'cloudformation', 'delete-stack', { StackName: 'd570-first' }],
  ['retained resources', 'cloudformation', 'delete-stack', { StackName: 'arn:aws:cloudformation:eu-north-1:462991287391:stack/d570-first/00000000-0000-4000-8000-000000000000', RetainResources: ['Bucket'] }],
  ['foreign event bus', 'events', 'disable-rule', { Name: 'd570-first-rule', EventBusName: 'other' }],
  ['foreign bucket owner', 's3api', 'delete-objects', { Bucket: 'd570-first-bucket', ExpectedBucketOwner: '111111111111', Delete: { Objects: [{ Key: 'd570/ledger/active.json' }], Quiet: false } }],
  ['unknown object', 's3api', 'delete-objects', { Bucket: 'd570-first-bucket', ExpectedBucketOwner: '462991287391', Delete: { Objects: [{ Key: 'unrelated-data' }], Quiet: false } }],
  ['duplicate objects', 's3api', 'delete-objects', { Bucket: 'd570-first-bucket', ExpectedBucketOwner: '462991287391', Delete: { Objects: [{ Key: 'd570/ledger/active.json' }, { Key: 'd570/ledger/active.json' }], Quiet: false } }],
  ['unconfirmed deletion', 's3api', 'delete-objects', { Bucket: 'd570-first-bucket', ExpectedBucketOwner: '462991287391', Delete: { Objects: [{ Key: 'd570/ledger/active.json' }], Quiet: true } }],
  ['version deletion', 's3api', 'delete-objects', { Bucket: 'd570-first-bucket', ExpectedBucketOwner: '462991287391', Delete: { Objects: [{ Key: 'd570/ledger/active.json', VersionId: 'another' }], Quiet: false } }],
  ['unbounded listing', 's3api', 'list-objects-v2', { Bucket: 'd570-first-bucket', ExpectedBucketOwner: '462991287391', Prefix: '', MaxKeys: 1000 }],
]) test(`removal CLI refuses ${label} before starting the executable`, async t => {
  const f = fixture(t), executable = join(f.root, 'aws-invalid.cjs'), marker = join(f.root, 'called');
  writeFileSync(executable, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)},'called');process.stdout.write('{}');\n`, { mode: 0o700 });
  await assert.rejects(control.createManualAwsCli({ executable }).call(service, operation, input), /D570 controller refused/);
  assert.equal(existsSync(marker), false);
});

test('explained opening refuses duplicate explanations even when their count matches two observed rows', async t => {
  const f = await explainedOpeningFixture(t);
  f.groups[0].Metrics.UnblendedCost.Amount = '0.005';
  const second = structuredClone(f.groups[0]); second.Keys[1] = 'EUN1-AnotherUsage'; f.groups.push(second);
  await assert.rejects(control.inspectManualOpening({ ...f.options, explanations: [...f.explanations, ...f.explanations] }),
    error => error.message === 'D570 opening spend needs explanations');
  assert.equal(existsSync(f.options.directory), false);
});

test('first removal refuses a clock that did not observe the full sweep drain before deleting objects', async t => {
  const f = await removalFixture(t), before = structuredClone([...f.objects]);
  await assert.rejects(f.remove({ sleep: async () => {} }), /D570 controller refused/);
  assert.deepEqual(structuredClone([...f.objects]), before);
  assert.equal(f.calls.some(row => row.operation === 'delete-objects' || row.operation === 'delete-stack'), false);
  assert.equal(existsSync(join(f.directory, 'active.json')), true);
});

test('owner entry cannot execute a different checkout script while standing in clean main', t => {
  const f = fixture(t), bin = mkdtempSync(join(tmpdir(), 'd570-entry-bin-')), marker = join(bin, 'called');
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  writeFileSync(join(bin, 'aws'), `#!${process.execPath}\nimport('node:fs').then(fs => { fs.writeFileSync(${JSON.stringify(marker)},'called');process.stdout.write(${JSON.stringify(JSON.stringify(identity))}); });\n`, { mode: 0o700 });
  const result = spawnSync(process.execPath, [target.pathname, 'up', bin], { cwd: f.root, encoding: 'utf8', timeout: 5000,
    env: { ...process.env, PATH: bin + ':' + process.env.PATH, AWS_EC2_METADATA_DISABLED: 'true' } });
  assert.ifError(result.error); assert.equal(result.status, 1); assert.equal(result.stdout, '');
  assert.equal(existsSync(marker), false);
});

test('first removal preserves provider history when its private parent becomes public during the export read', async t => {
  const f = await removalFixture(t), prior = f.aws.call, before = structuredClone([...f.objects]);
  f.aws.call = async (...args) => {
    const response = await prior(...args);
    if (args[1] === 'get-object' && args[2].Key === 'd570/ledger/active.json') chmodSync(f.parent, 0o755);
    return response;
  };
  await assert.rejects(f.remove(), /D570 controller refused/);
  assert.deepEqual(structuredClone([...f.objects]), before);
  assert.equal(f.calls.some(row => ['disable-rule', 'delete-objects', 'delete-stack'].includes(row.operation)), false);
});

test('first removal remains available after the last booked month without adding or refunding bookings', async t => {
  const f = await removalFixture(t); let current = Date.parse('2027-01-10T12:00:00Z');
  const result = await f.remove({ now: '2027-01-10T12:00:00Z', clock: () => current,
    sleep: async ms => { f.sleeps.push(ms); current += ms; } });
  assert.equal(result.deleted, true);
  assert.equal(JSON.parse(readFileSync(join(f.directory, 'active.json'))).active.identity.uuid, f.uuid);
  assert.equal(existsSync(join(f.directory, '2027-01.json')), false);
  assert.equal(f.calls.some(row => row.operation === 'put-object'), false);
});

for (const contents of ['', '{"scope":']) test(`first removal repairs an interrupted ${contents ? 'truncated' : 'empty'} export from the still-retained provider bytes`, async t => {
  const f = await removalFixture(t), expected = Buffer.from(f.objects.get('d570/ledger/active.json').body);
  mkdirSync(f.directory, { mode: 0o700 }); writeFileSync(join(f.directory, 'active.json'), contents, { mode: 0o600 });
  assert.equal((await f.remove()).deleted, true);
  assert.equal(readFileSync(join(f.directory, 'active.json')).equals(expected), true);
});

test('first removal never repairs a well-formed foreign export as if it were its own', async t => {
  const f = await removalFixture(t), body = JSON.stringify({ scope: { account: '111111111111', region: 'eu-north-1', stackId: f.setup.stackId } });
  mkdirSync(f.directory, { mode: 0o700 }); writeFileSync(join(f.directory, 'active.json'), body, { mode: 0o600 });
  await assert.rejects(f.remove(), /D570 controller refused/);
  assert.equal(readFileSync(join(f.directory, 'active.json'), 'utf8'), body);
  assert.equal(f.calls.some(row => ['disable-rule', 'delete-objects', 'delete-stack'].includes(row.operation)), false);
});

test('CLI boundary fixtures stay executable beneath an ES module workspace', t => {
  const root = mkdtempSync(join(tmpdir(), 'd570-module-parent-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  const environment = { ...process.env, TMPDIR: root }; delete environment.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', '--test-name-pattern=^removal CLI validates', new URL('./kubernetes-proof-control.test.mjs', import.meta.url).pathname], {
    encoding: 'utf8', timeout: 15000, env: environment });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /(?:#|ℹ) tests 4/);
  assert.match(result.stdout, /(?:#|ℹ) pass 4/);
});

test('first removal repairs an interrupted setup copy from the original private booking', async t => {
  const f = await removalFixture(t), expected = readFileSync(join(f.setup.directory, 'setup.json'));
  mkdirSync(f.directory, { mode: 0o700 }); writeFileSync(join(f.directory, 'setup.json'), '', { mode: 0o600 });
  assert.equal((await f.remove()).deleted, true);
  assert.equal(readFileSync(join(f.directory, 'setup.json')).equals(expected), true);
});

test('first removal never repairs a damaged export when the provider no longer retains that key', async t => {
  const f = await removalFixture(t), before = structuredClone([...f.objects]);
  f.objects.delete('d570/ledger/active.json');
  mkdirSync(f.directory, { mode: 0o700 }); writeFileSync(join(f.directory, 'active.json'), '', { mode: 0o600 });
  await assert.rejects(f.remove(), /D570 controller refused/);
  assert.equal(f.calls.some(row => ['disable-rule', 'delete-objects', 'delete-stack'].includes(row.operation)), false);
  assert.equal(readFileSync(join(f.directory, 'active.json'), 'utf8'), '');
});

function independentRemote(t, f) {
  const remote = mkdtempSync(join(tmpdir(), 'd570-remote-main-'));
  t.after(() => rmSync(remote, { recursive: true, force: true }));
  execFileSync('git', ['clone', '--shared', f.root, remote], { stdio: 'pipe' });
  const git = (...args) => execFileSync('git', ['-C', remote, ...args], { encoding: 'utf8', stdio: 'pipe' });
  git('config', 'user.email', 'd570-remote@example.invalid'); git('config', 'user.name', 'D570 remote fixture');
  f.git('config', '--unset-all', 'url.' + f.root + '.insteadOf');
  f.git('config', 'url.' + remote + '.insteadOf', 'https://github.com/waitron-io/waitron-cloud.git');
  return () => git('-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-s', '-m', 'Advance synthetic remote only');
}

test('owner command rechecks remote main before creation even when only the remote advanced during prices', async t => {
  const f = await initializationFixture(t), advance = independentRemote(t, f);
  const docs = JSON.parse(readFileSync(new URL('../deploy/kubernetes/proof/test-fixtures/prices.json', import.meta.url)));
  let moved = false;
  await assert.rejects(ownerCommand(f, ['up', f.parent], { fetch: async url => {
    if (!moved) { moved = true; advance(); }
    const service = Object.keys(docs).find(name => new URL(url).pathname.includes('/' + name + '/'));
    return new Response(JSON.stringify(docs[service]), { headers: { 'content-type': 'application/json' } });
  } }), /D570 controller refused/);
  assert.deepEqual(f.counts(), { creates: 0, enables: 0 });
  assert.equal(f.git('rev-parse', 'HEAD'), f.head);
});

test('owner command rechecks remote main before launch after the retained reservation writes', async t => {
  const f = await drillFixture(t), advance = independentRemote(t, f), prior = f.aws.call;
  writeFileSync(join(f.parent, 'initialized.json'), JSON.stringify(f.setup), { mode: 0o600 });
  f.calls.length = 0; let moved = false;
  f.aws.call = async (...args) => {
    const result = await prior(...args);
    if (!moved && args[1] === 'put-object' && args[2].Key === 'd570/ledger/active.json'
      && JSON.parse(args[2].Body).active?.state === 'reserved') { moved = true; advance(); }
    return result;
  };
  await assert.rejects(ownerCommand(f, ['drill', f.parent], { uuid: f.uuid }), /D570 controller refused/);
  assert.equal(moved, true);
  assert.equal(f.calls.some(row => row.operation === 'run-instances'), false);
  assert.equal(JSON.parse(f.objects.get('d570/ledger/active.json').body).active.identity.uuid, f.uuid);
});

test('a credit bill stays unusable and reports its observed aggregate instead of inventing a zero opening', async t => {
  const f = fixture(t), response = bill(); response.ResultsByTime[0].Total.UnblendedCost.Amount = '-1.25';
  f.aws.call = async service => service === 'sts' ? identity : response;
  await assert.rejects(inspect(f), error => {
    assert.match(error.message, /D570 controller refused.*credit/);
    assert.equal(error.opening.billing.rawUsd, '-1.25');
    assert.equal(error.opening.billing.estimated, true);
    assert.equal(Object.hasOwn(error.opening.billing, 'microUsd'), false);
    return true;
  });
});

for (const reason of ['setup time', 'setup template', 'stack id', 'stack status']) test(`setup refusal identifies ${reason} without another mutation`, async t => {
  const f = await creationFixture(t), previous = f.aws.call; let at = Date.parse(now);
  f.aws.call = async (...args) => {
    const response = await previous(...args);
    if (args[1] === 'create-stack' && reason === 'setup time') at += 86400_000;
    if (args[1] === 'create-stack' && reason === 'stack id') response.StackId = 'invalid';
    if (args[1] === 'describe-stacks' && reason === 'stack status') response.Stacks = [];
    return response;
  };
  if (reason === 'setup template') {
    const stringify = JSON.stringify;
    t.mock.method(JSON, 'stringify', (value, ...args) => value?.Resources ? 'x'.repeat(51201) : stringify(value, ...args));
  }
  await assert.rejects(f.create({ clock: () => at }), { message: `D570 controller refused: ${reason}` });
  assert.deepEqual(f.counts(), { creates: reason === 'setup template' ? 0 : 1, enables: 0 });
  assert.equal(existsSync(join(f.options.directory, 'setup.json')), true);
});

for (const kind of ['known concurrency', 'private reason', 'unavailable events']) {
  test(`failed stack exposes its status and ${kind} without leaking provider text`, async t => {
    const f = await creationFixture(t), previous = f.aws.call;
    const secret = 'synthetic-private-token-should-never-be-printed';
    const providerReason = kind === 'known concurrency'
      ? 'Resource handler returned message: "Specified ReservedConcurrentExecutions for function decreases account UnreservedConcurrentExecution below its minimum value of [10]."'
      : secret + '\n' + 'x'.repeat(5000);
    f.aws.call = async (...args) => {
      if (args[1] === 'describe-stack-events') {
        assert.deepEqual(args[2], { StackName: f.p.stackId });
        if (kind === 'unavailable events') throw new Error(secret);
        return { StackEvents: [
          { StackId: f.p.stackId, LogicalResourceId: 'Bucket', ResourceStatus: 'CREATE_FAILED', ResourceStatusReason: 'Resource creation cancelled' },
          { StackId: f.p.stackId, LogicalResourceId: 'ExpiryFunction', ResourceStatus: 'CREATE_FAILED', ResourceStatusReason: providerReason },
        ] };
      }
      const response = await previous(...args);
      if (args[1] === 'describe-stacks') response.Stacks[0].StackStatus = 'ROLLBACK_COMPLETE';
      return response;
    };
    let failure;
    await assert.rejects(f.create(), error => { failure = error; return /stack status ROLLBACK_COMPLETE/.test(error.message); });
    assert.equal(failure.message.includes(secret), false);
    assert.deepEqual(f.counts(), { creates: 1, enables: 0 });
    if (kind === 'known concurrency') assert.match(failure.message, /ExpiryFunction: Lambda reserved concurrency exceeds account allowance/);
    if (kind === 'private reason') {
      const file = join(f.parent, 'setup-failure.json');
      assert.ok(failure.message.includes(file));
      assert.equal(statSync(file).mode & 0o777, 0o600);
      const saved = JSON.parse(readFileSync(file));
      assert.equal(saved.stackId, f.p.stackId); assert.equal(saved.logicalResourceId, 'ExpiryFunction');
      assert.ok(saved.reason.startsWith(secret)); assert.ok(saved.reason.length <= 1024);
    }
  });
}

test('stack event CLI reads only the validated exact owned stack', async t => {
  const f = fixture(t), executable = join(f.root, 'aws-events.cjs'), capture = join(f.root, 'events-request.json');
  const stackId = 'arn:aws:cloudformation:eu-north-1:462991287391:stack/d570-first/00000000-0000-4000-8000-000000000000';
  writeFileSync(executable, `#!${process.execPath}\nconst fs=require('node:fs');fs.writeFileSync(${JSON.stringify(capture)},JSON.stringify(process.argv.slice(2)));process.stdout.write('{"StackEvents":[]}');\n`, { mode: 0o700 });
  const aws = control.createManualAwsCli({ executable });
  assert.deepEqual(await aws.call('cloudformation', 'describe-stack-events', { StackName: stackId }), { StackEvents: [] });
  assert.deepEqual(JSON.parse(readFileSync(capture)).slice(0, 4), ['cloudformation', 'describe-stack-events', '--cli-input-json', JSON.stringify({ StackName: stackId })]);
  const before = readFileSync(capture);
  for (const input of [{ StackName: 'd570-first' }, { StackName: stackId, NextToken: 'more' }, { StackName: stackId.replace('462991287391', '949687825720') }]) {
    await assert.rejects(aws.call('cloudformation', 'describe-stack-events', input), /D570 controller refused/);
    assert.equal(readFileSync(capture).equals(before), true);
  }
});

async function failedOwnerSetupFixture(t) {
  const f = await initializationFixture(t), previous = f.aws.call, originalId = f.p.stackId;
  let state = 'failed', deletions = 0;
  const createTime = now;
  f.aws.call = async (service, operation, input) => {
    if (operation === 'describe-stacks' && state === 'deleted') {
      if (input.StackName !== originalId) throw new Error('synthetic deleted stack cannot be found by name');
      f.calls.push({ service, operation, input });
      return { Stacks: [{ StackId: originalId, StackStatus: 'DELETE_COMPLETE', Tags: [{ Key: 'Proof', Value: 'D570' }], CreationTime: createTime }] };
    }
    if (operation === 'describe-stack-events') return { StackEvents: [] };
    if (operation === 'describe-stack-resources' && state !== 'creating') {
      f.calls.push({ service, operation, input }); return { StackResources: [] };
    }
    if (operation === 'describe-volumes' && input.Filters?.[0].Name === 'tag:Proof') {
      f.calls.push({ service, operation, input }); return { Volumes: [] };
    }
    if (operation === 'delete-stack') {
      f.calls.push({ service, operation, input }); state = 'deleted'; deletions++; return {};
    }
    const response = await previous(service, operation, input);
    if (operation === 'create-stack' && state === 'deleted') {
      state = 'creating'; f.p.stackId = originalId.slice(0, -1) + '1'; response.StackId = f.p.stackId;
      f.p.responses['cloudformation/describe-stacks'].Stacks[0].StackId = f.p.stackId;
      for (const row of f.p.resource) row.StackId = f.p.stackId;
      f.p.health.stackId = f.p.stackId;
      f.p.responses['s3api/get-object'].Body = Buffer.from(JSON.stringify(f.p.health));
    }
    if (operation === 'describe-stacks' && state === 'failed') {
      response.Stacks[0].StackStatus = 'ROLLBACK_COMPLETE'; response.Stacks[0].Tags = [{ Key: 'Proof', Value: 'D570' }];
      response.Stacks[0].CreationTime = createTime;
    }
    return response;
  };
  await assert.rejects(ownerCommand(f, ['up', f.parent]), /stack status ROLLBACK_COMPLETE/);
  const original = readFileSync(join(f.parent, 'setup', 'setup.json'));
  assert.equal(existsSync(join(f.parent, 'initialized.json')), false);
  return { ...f, original, originalId, state: () => state, deletions: () => deletions };
}

async function incompleteCreatedSetupFixture(t) {
  const f = await failedOwnerSetupFixture(t), prior = f.aws.call;
  f.p.resource.push({ StackId: f.originalId, LogicalResourceId: 'Subnet', ResourceType: 'AWS::EC2::Subnet',
    PhysicalResourceId: 'subnet-0123456789abcdef0', ResourceStatus: 'CREATE_COMPLETE' });
  let current = Date.parse(now);
  f.aws.call = async (service, operation, input) => {
    if (operation === 'describe-stack-resources' && f.state() === 'failed') {
      f.calls.push({ service, operation, input });
      return { StackResources: structuredClone(f.p.resource) };
    }
    if (operation === 'describe-instances' && input.Filters) return { Reservations: [] };
    if (operation === 'describe-network-interfaces') return { NetworkInterfaces: [] };
    if (operation === 'disable-rule') {
      f.p.responses['events/describe-rule'].State = 'DISABLED'; return {};
    }
    const result = await prior(service, operation, input);
    if (operation === 'describe-stacks' && f.state() === 'failed') result.Stacks[0].StackStatus = 'CREATE_COMPLETE';
    if (operation === 'create-stack') {
      f.p.responses['events/describe-rule'].State = 'ENABLED';
      const stamp = new Date(current).toISOString().replace('.000Z', 'Z');
      f.p.health.startedAt = stamp; f.p.health.completedAt = stamp;
      f.p.responses['s3api/get-object'].Body = Buffer.from(JSON.stringify(f.p.health));
      f.p.responses['s3api/get-object'].LastModified = stamp;
    }
    return result;
  };
  const command = name => ownerCommand(f, [name, f.parent], {
    clock: () => current, sleep: async ms => { current += ms; },
  });
  return { ...f, command, stamp: () => new Date(current).toISOString().replace('.000Z', 'Z') };
}

test('created but uninitialized setup releases only after deletion and can retry in the same folder', async t => {
  const f = await incompleteCreatedSetupFixture(t);
  assert.equal((await f.command('down')).deleted, true);
  const cleanup = JSON.parse(readFileSync(join(f.parent, 'setup-removal.json')));
  assert.equal(cleanup.eligible, true); assert.equal(cleanup.releasedAt, f.stamp());
  const retry = await f.command('up');
  assert.equal(retry.directory, join(realpathSync(f.parent), 'retry', 'setup'));
  assert.equal(retry.priorBookedMicroUsd, 0);
  assert.equal(readFileSync(join(f.parent, 'setup', 'setup.json')).equals(f.original), true);
});

test('already-deleted uninitialized setup requalifies a retained false eligibility without rewriting its history', async t => {
  const f = await failedOwnerSetupFixture(t);
  await ownerCommand(f, ['down', f.parent]);
  const path = join(f.parent, 'setup-removal.json'), cleanup = JSON.parse(readFileSync(path));
  const legacy = { ...cleanup, eligible: false, releasedAt: null, reason: 'setup removed; booking retained' };
  writeFileSync(path, JSON.stringify(legacy));
  const later = Date.parse(now) + 1000;
  await ownerCommand(f, ['down', f.parent], { clock: () => later });
  const qualified = JSON.parse(readFileSync(path));
  assert.equal(qualified.eligible, true); assert.equal(qualified.releasedAt, '2026-11-06T12:00:01Z');
  assert.equal(qualified.deletedAt, legacy.deletedAt); assert.equal(qualified.reason, legacy.reason);
  assert.equal(f.deletions(), 1);
  const retry = await ownerCommand(f, ['up', f.parent]);
  assert.equal(retry.directory, join(realpathSync(f.parent), 'retry', 'setup'));
  assert.equal(readFileSync(join(f.parent, 'history', 'setup.json')).equals(f.original), true);
});

test('created uninitialized setup cannot release during interrupted deletion', async t => {
  const f = await incompleteCreatedSetupFixture(t), prior = f.aws.call;
  f.aws.call = async (...args) => {
    const result = await prior(...args);
    if (args[1] === 'delete-stack') throw new Error('synthetic interrupted deletion');
    return result;
  };
  await assert.rejects(f.command('down'), /synthetic interrupted deletion/);
  const cleanup = JSON.parse(readFileSync(join(f.parent, 'setup-removal.json')));
  assert.equal(cleanup.eligible, false); assert.equal(cleanup.releasedAt, null);
  await assert.rejects(f.command('up'), /D570 controller refused: booking/);
  assert.equal(existsSync(join(f.parent, 'retry')), false);
});

for (const name of ['initialized.json', 'launch.json']) test(`created setup retains its booking when ${name} exists without a monthly ledger`, async t => {
  const f = await incompleteCreatedSetupFixture(t);
  const setup = { ...JSON.parse(f.original), directory: join(f.parent, 'setup'), stackId: f.originalId };
  writeFileSync(join(f.parent, name), JSON.stringify(name === 'initialized.json' ? setup : {}), { mode: 0o600 });
  await f.command('down');
  const cleanup = JSON.parse(readFileSync(join(f.parent, 'setup-removal.json')));
  assert.equal(cleanup.eligible, false); assert.equal(cleanup.releasedAt, null);
  await assert.rejects(f.command('up'), /D570 controller refused: booking/);
  assert.equal(existsSync(join(f.parent, 'retry')), false);
});

test('failed owner setup can clean down and retry up in the same folder without erasing its booking', async t => {
  const f = await failedOwnerSetupFixture(t);
  assert.equal((await ownerCommand(f, ['down', f.parent])).deleted, true);
  const retry = await ownerCommand(f, ['up', f.parent]);
  assert.equal(retry.stackId, f.p.stackId); assert.notEqual(retry.stackId, f.originalId);
  assert.equal(readFileSync(join(f.parent, 'setup', 'setup.json')).equals(f.original), true);
  assert.equal(readFileSync(join(f.parent, 'history', 'setup.json')).equals(f.original), true);
  const released = JSON.parse(readFileSync(join(f.parent, 'setup-removal.json')));
  assert.equal(released.stackId, f.originalId); assert.equal(released.releasedAt, now);
  assert.equal(released.reason, 'failed setup removed without a run');
  assert.equal(statSync(join(f.parent, 'setup-removal.json')).mode & 0o777, 0o600);
  assert.equal(retry.directory, join(realpathSync(f.parent), 'retry', 'setup'));
  assert.equal(existsSync(join(f.parent, 'retry', 'initialized.json')), true);
  assert.equal(f.calls.some(c => c.operation === 'run-instances'), false);
  assert.equal(f.deletions(), 1);
  await assert.rejects(ownerCommand(f, ['up', f.parent]), /D570 controller refused: booking/);
  assert.deepEqual(f.counts(), { creates: 2, enables: 1 });
});

for (const loss of ['lost delete reply', 'deletion timeout', 'release write failure']) {
  test(`failed setup removal resumes after ${loss} using its retained exact stack id`, async t => {
    const f = await failedOwnerSetupFixture(t), prior = f.aws.call; let interrupted = true;
    let writeMock;
    if (loss === 'release write failure') {
      const sample = await open(join(f.parent, 'write-probe'), 'wx', 0o600), prototype = Object.getPrototypeOf(sample);
      await sample.close(); const write = prototype.writeFile;
      writeMock = t.mock.method(prototype, 'writeFile', async function (body, ...args) {
        if (typeof body === 'string' && body.includes('"deletedAt"')) throw new Error('synthetic release write failure');
        return write.call(this, body, ...args);
      });
    }
    f.aws.call = async (...args) => {
      const result = await prior(...args);
      if (interrupted && loss === 'lost delete reply' && args[1] === 'delete-stack') throw new Error('synthetic lost delete reply');
      if (interrupted && loss === 'deletion timeout' && f.state() === 'deleted' && args[1] === 'describe-stacks') result.Stacks[0].StackStatus = 'DELETE_IN_PROGRESS';
      return result;
    };
    await assert.rejects(ownerCommand(f, ['down', f.parent]), /synthetic|stack deletion pending/);
    const pending = JSON.parse(readFileSync(join(f.parent, 'setup-removal.json')));
    assert.equal(pending.stackId, f.originalId); assert.equal(pending.releasedAt, null);
    await assert.rejects(ownerCommand(f, ['up', f.parent]), /D570 controller refused: booking/);
    assert.equal(existsSync(join(f.parent, 'retry')), false);
    interrupted = false; writeMock?.mock.restore();
    assert.equal((await ownerCommand(f, ['down', f.parent])).deleted, true);
    const released = JSON.parse(readFileSync(join(f.parent, 'setup-removal.json')));
    assert.equal(released.stackId, f.originalId); assert.equal(released.releasedAt, now);
    assert.equal(f.deletions(), 1);
    assert.equal(readFileSync(join(f.parent, 'setup', 'setup.json')).equals(f.original), true);
  });
}

test('failed setup retry verifies owner identity before creating its retry folder', async t => {
  const f = await failedOwnerSetupFixture(t);
  await ownerCommand(f, ['down', f.parent]);
  const prior = f.aws.call;
  f.aws.call = async (...args) => args[0] === 'sts' ? { ...identity, Account: '949687825720' } : prior(...args);
  await assert.rejects(ownerCommand(f, ['up', f.parent]), /D570 controller refused: sts identity/);
  assert.equal(existsSync(join(f.parent, 'retry')), false);
});

test('failed setup down names an unfinished rollback without deleting or releasing it', async t => {
  const f = await failedOwnerSetupFixture(t), prior = f.aws.call;
  f.aws.call = async (...args) => {
    const result = await prior(...args);
    if (args[1] === 'describe-stacks') result.Stacks[0].StackStatus = 'ROLLBACK_IN_PROGRESS';
    return result;
  };
  await assert.rejects(ownerCommand(f, ['down', f.parent]), {
    message: 'D570 controller refused: stack cleanup status ROLLBACK_IN_PROGRESS; wait for rollback to finish',
  });
  assert.equal(f.deletions(), 0); assert.equal(existsSync(join(f.parent, 'setup-removal.json')), false);
});

test('failed setup with any retained monthly ledger never releases its booking for retry', async t => {
  const f = await removalFixture(t, { partial: true });
  f.p.responses['cloudformation/describe-stacks'].Stacks[0].StackStatus = 'ROLLBACK_COMPLETE';
  const original = readFileSync(join(f.setup.directory, 'setup.json'));
  mkdirSync(join(f.parent, 'setup'), { mode: 0o700 });
  writeFileSync(join(f.parent, 'setup', 'setup.json'), original, { mode: 0o600 });
  assert.equal((await ownerCommand(f, ['down', f.parent])).deleted, true);
  assert.equal(JSON.parse(readFileSync(join(f.parent, 'setup-removal.json'))).releasedAt, null);
  await assert.rejects(ownerCommand(f, ['up', f.parent]), /D570 controller refused: booking/);
  assert.equal(existsSync(join(f.parent, 'retry')), false);
  assert.equal(readFileSync(join(f.setup.directory, 'setup.json')).equals(original), true);
  const path = join(f.parent, 'setup-removal.json'), altered = JSON.parse(readFileSync(path));
  altered.eligible = true; altered.releasedAt = now; altered.reason = 'failed setup removed without a run';
  writeFileSync(path, JSON.stringify(altered));
  await assert.rejects(ownerCommand(f, ['up', f.parent]), /D570 controller refused: private history/);
  assert.equal(existsSync(join(f.parent, 'retry')), false);
});

test('created setup with a retained monthly ledger cannot release despite missing initialized and launch files', async t => {
  const f = await removalFixture(t, { partial: true });
  assert.equal(f.p.responses['cloudformation/describe-stacks'].Stacks[0].StackStatus, 'CREATE_COMPLETE');
  await f.remove();
  const cleanup = JSON.parse(readFileSync(join(dirname(f.setup.directory), 'setup-removal.json')));
  assert.equal(cleanup.eligible, false); assert.equal(cleanup.releasedAt, null);
  assert.equal(existsSync(join(f.directory, '2026-11.json')), true);
});

for (const change of ['changed booking', 'public cleanup']) test(`failed setup retry refuses ${change}`, async t => {
  const f = await failedOwnerSetupFixture(t);
  await ownerCommand(f, ['down', f.parent]);
  if (change === 'changed booking') {
    const path = join(f.parent, 'setup', 'setup.json'), booking = JSON.parse(readFileSync(path));
    booking.head = 'b'.repeat(40); writeFileSync(path, JSON.stringify(booking));
  } else chmodSync(join(f.parent, 'setup-removal.json'), 0o644);
  await assert.rejects(ownerCommand(f, ['up', f.parent]), /D570 controller refused: private history/);
  assert.equal(existsSync(join(f.parent, 'retry')), false);
  assert.deepEqual(f.counts(), { creates: 1, enables: 0 });
});

test('cleanup refuses an incomplete saved setup before reading or writing cleanup metadata', async t => {
  const f = await removalFixture(t); f.calls.length = 0;
  await assert.rejects(f.remove({ setup: {} }), /D570 controller refused: ec2 cleanup/);
  assert.equal(f.calls.some(c => c.service === 'cloudformation'), false);
  assert.equal(existsSync(join(f.parent, 'setup-removal.json')), false);
});

test('failed setup release remains readable when the real clock includes milliseconds', async t => {
  const f = await failedOwnerSetupFixture(t);
  await ownerCommand(f, ['down', f.parent], { clock: () => Date.parse(now) + 123 });
  assert.equal(JSON.parse(readFileSync(join(f.parent, 'setup-removal.json'))).releasedAt, now);
  assert.equal((await ownerCommand(f, ['up', f.parent])).directory, join(realpathSync(f.parent), 'retry', 'setup'));
});

for (const amount of ['10.686509', '10.686510']) test(`failed setup retry refuses a fresh opening of ${amount} at or above the monthly cap`, async t => {
  const f = await failedOwnerSetupFixture(t); await ownerCommand(f, ['down', f.parent]);
  const prior = f.aws.call, serviceName = 'Amazon Simple Storage Service', usageType = 'EUN1-TimedStorage-ByteHrs';
  f.aws.call = async (service, operation, input) => {
    if (service !== 'ce') return prior(service, operation, input);
    f.calls.push({ service, operation, input });
    return input.GroupBy ? { GroupDefinitions: input.GroupBy, ResultsByTime: [{ TimePeriod: input.TimePeriod,
      Estimated: true, Total: {}, Groups: [{ Keys: [serviceName, usageType], Metrics: {
        UnblendedCost: { Amount: amount, Unit: 'USD' }, UsageQuantity: { Amount: '0.1', Unit: 'N/A' },
      } }] }] } : { ResultsByTime: [{ TimePeriod: input.TimePeriod, Estimated: true, Groups: [],
        Total: { UnblendedCost: { Amount: amount, Unit: 'USD' } } }] };
  };
  await assert.rejects(ownerCommand(f, ['up', f.parent, '--explain', serviceName, usageType,
    String(Math.round(Number(amount) * 1000000)), 'Existing synthetic staging storage']), /D570 opening and reservation reach the monthly cap/);
  assert.deepEqual(f.counts(), { creates: 1, enables: 0 });
  assert.equal(existsSync(join(f.parent, 'retry', 'setup')), false);
  assert.equal(readFileSync(join(f.parent, 'setup', 'setup.json')).equals(f.original), true);
});

test('resumed removal refuses a different valid stack returned for its retained exact id', async t => {
  const f = await failedOwnerSetupFixture(t), prior = f.aws.call;
  f.aws.call = async (...args) => {
    const response = await prior(...args);
    if (args[1] === 'delete-stack') throw new Error('synthetic lost deletion reply');
    return response;
  };
  await assert.rejects(ownerCommand(f, ['down', f.parent]), /synthetic lost deletion reply/);
  f.aws.call = async (...args) => {
    const response = await prior(...args);
    if (args[1] === 'describe-stacks') response.Stacks[0].StackId = f.originalId.slice(0, -1) + '2';
    return response;
  };
  await assert.rejects(ownerCommand(f, ['down', f.parent]), /D570 controller refused: ec2 cleanup/);
  assert.equal(JSON.parse(readFileSync(join(f.parent, 'setup-removal.json'))).releasedAt, null);
  assert.equal(f.deletions(), 1);
});

test('released retry refuses a changed retained history even when booking fields still match', async t => {
  const f = await failedOwnerSetupFixture(t); await ownerCommand(f, ['down', f.parent]);
  const path = join(f.parent, 'history', 'setup.json'), value = JSON.parse(readFileSync(path));
  value.syntheticMarker = 'changed export'; writeFileSync(path, JSON.stringify(value));
  await assert.rejects(ownerCommand(f, ['up', f.parent]), /D570 controller refused: private history/);
  assert.equal(existsSync(join(f.parent, 'retry')), false);
  assert.deepEqual(f.counts(), { creates: 1, enables: 0 });
});

for (const kind of ['foreign event', 'earliest event', 'truncated events']) test(`failed stack diagnoses ${kind} without borrowing another failure`, async t => {
  const f = await creationFixture(t), prior = f.aws.call;
  f.aws.call = async (...args) => {
    if (args[1] === 'describe-stack-events') {
      const known = { StackId: kind === 'foreign event' ? f.p.stackId.slice(0, -1) + '2' : f.p.stackId,
        LogicalResourceId: 'ExpiryFunction', ResourceStatus: 'CREATE_FAILED',
        ResourceStatusReason: 'Specified ReservedConcurrentExecutions decreases UnreservedConcurrentExecution below its minimum value' };
      return kind === 'truncated events' ? { StackEvents: [], NextToken: 'synthetic-private-next-token' }
        : { StackEvents: [...(kind === 'earliest event' ? [{ ...known, LogicalResourceId: 'Bucket', ResourceStatusReason: 'synthetic later failure' }] : []), known] };
    }
    const response = await prior(...args);
    if (args[1] === 'describe-stacks') response.Stacks[0].StackStatus = 'ROLLBACK_COMPLETE';
    return response;
  };
  let failure;
  await assert.rejects(f.create(), error => { failure = error; return /stack status ROLLBACK_COMPLETE/.test(error.message); });
  if (kind === 'foreign event') assert.equal(failure.message.includes('ExpiryFunction'), false);
  if (kind === 'earliest event') {
    assert.ok(failure.message.includes('ExpiryFunction: Lambda reserved concurrency exceeds account allowance'));
    assert.equal(failure.message.includes('Bucket'), false);
  }
  if (kind === 'truncated events') {
    assert.match(failure.message, /failure events truncated/);
    assert.equal(failure.message.includes('synthetic-private-next-token'), false);
  }
  assert.equal(existsSync(join(f.parent, 'setup-failure.json')), false);
});

test('pending failed removal refuses new initialization evidence before requesting stack deletion', async t => {
  const f = await failedOwnerSetupFixture(t), prior = f.aws.call;
  f.aws.call = async (...args) => {
    if (args[1] === 'delete-stack') throw new Error('synthetic deletion not sent');
    return prior(...args);
  };
  await assert.rejects(ownerCommand(f, ['down', f.parent]), /synthetic deletion not sent/);
  writeFileSync(join(f.parent, 'initialized.json'), JSON.stringify({ ...JSON.parse(f.original),
    directory: join(realpathSync(f.parent), 'setup') }), { mode: 0o600 });
  f.aws.call = prior;
  await assert.rejects(ownerCommand(f, ['down', f.parent]), /D570 controller refused: booking/);
  assert.equal(f.deletions(), 0);
  assert.equal(JSON.parse(readFileSync(join(f.parent, 'setup-removal.json'))).releasedAt, null);
});

for (const noRun of [null, 'true', 0, [], {}]) test(`removal refuses a malformed no-run marker: ${JSON.stringify(noRun)}`, async t => {
  const f = await failedOwnerSetupFixture(t);
  await ownerCommand(f, ['down', f.parent]);
  const path = join(f.parent, 'setup-removal.json'), record = JSON.parse(readFileSync(path));
  writeFileSync(path, JSON.stringify({ ...record, noRun }));
  const before = f.calls.length;
  await assert.rejects(ownerCommand(f, ['down', f.parent]), /D570 controller refused: private history/);
  assert.equal(f.calls.slice(before).some(call => ['delete-stack', 'delete-objects', 'disable-rule', 'remove-permission'].includes(call.operation)), false);
  assert.equal(f.deletions(), 1);
});

test('removal accepts a legacy cleanup record without a no-run marker', async t => {
  const f = await failedOwnerSetupFixture(t);
  await ownerCommand(f, ['down', f.parent]);
  const path = join(f.parent, 'setup-removal.json'), record = JSON.parse(readFileSync(path));
  delete record.noRun;
  writeFileSync(path, JSON.stringify(record));
  assert.equal((await ownerCommand(f, ['down', f.parent])).deleted, true);
  assert.equal(f.deletions(), 1);
  assert.equal((await ownerCommand(f, ['up', f.parent])).directory, join(realpathSync(f.parent), 'retry', 'setup'));
});

test('removal resumes an unreleased legacy record without inventing run evidence', async t => {
  const f = await failedOwnerSetupFixture(t), prior = f.aws.call;
  f.aws.call = async (...args) => {
    if (args[1] === 'delete-stack') throw new Error('synthetic legacy interrupted deletion');
    return prior(...args);
  };
  await assert.rejects(ownerCommand(f, ['down', f.parent]), /synthetic legacy interrupted deletion/);
  const path = join(f.parent, 'setup-removal.json'), record = JSON.parse(readFileSync(path));
  delete record.noRun; writeFileSync(path, JSON.stringify(record)); f.aws.call = prior;
  assert.equal((await ownerCommand(f, ['down', f.parent])).deleted, true);
  const released = JSON.parse(readFileSync(path));
  assert.equal(released.eligible, true); assert.equal(released.releasedAt, now);
  assert.equal(f.deletions(), 1);
  assert.equal((await ownerCommand(f, ['up', f.parent])).directory, join(realpathSync(f.parent), 'retry', 'setup'));
});

for (const name of ['initialized.json', 'launch.json']) test(`removal refuses ${name} appearing during stack deletion without releasing its booking`, async t => {
  const f = await failedOwnerSetupFixture(t), prior = f.aws.call;
  f.aws.call = async (...args) => {
    const result = await prior(...args);
    if (args[1] === 'delete-stack') writeFileSync(join(f.parent, name), JSON.stringify(name === 'initialized.json'
      ? { ...JSON.parse(f.original), directory: join(realpathSync(f.parent), 'setup') } : {}), { mode: 0o600 });
    return result;
  };
  await assert.rejects(ownerCommand(f, ['down', f.parent]), /D570 controller refused: booking/);
  const record = JSON.parse(readFileSync(join(f.parent, 'setup-removal.json')));
  assert.equal(record.noRun, true); assert.equal(record.eligible, false); assert.equal(record.releasedAt, null);
  assert.equal(f.deletions(), 1);
  await assert.rejects(ownerCommand(f, ['up', f.parent]), /D570 controller refused: booking/);
  assert.equal(existsSync(join(f.parent, 'retry')), false);
});

async function lateConsoleFixture(t){
 const f=await guestCleanupFixture(t);
 const stamp=seconds=>new Date(Date.parse(now)+seconds*1000).toISOString().replace('.000Z','Z');
 f.p.health.startedAt=stamp(420);f.p.health.completedAt=stamp(421);
 f.p.responses['s3api/get-object'].Body=Buffer.from(JSON.stringify(f.p.health));
 f.p.responses['s3api/get-object'].LastModified=stamp(421);
 f.consoleOutput.Timestamp=stamp(449);
 f.consoleOutput.Output=`[    6.388599] cloud-init[2735]: D570_DEADLINE_READY ${f.uuid} 1793966580 11111111-1111-4111-8111-111111111111\n`;
 const shutdownObservation={runningRequestedAt:stamp(170),runningReceivedAt:stamp(170),terminatedReceivedAt:stamp(180),stateReason:{Code:'Client.InstanceInitiatedShutdown'}};
 const options={...f.options,launch:f.launch,capture:f.ready,shutdownObservation,now:stamp(450),clock:()=>Date.parse(stamp(450))};
 return {...f,stamp,lateOptions:options,late:changes=>control.inspectManualFirstGuest({...options,...changes})};
}
test('late console accepts the observed T449 record at T450 after independently bounded OS shutdown',async t=>{
 const f=await lateConsoleFixture(t),before=structuredClone([...f.objects]);
 const ready=await f.late();assert.equal(ready.bootId,'11111111-1111-4111-8111-111111111111');
 assert.equal(ready.observedAt,f.stamp(450));assert.deepEqual(ready.shutdownObservation,f.lateOptions.shutdownObservation);
 const cleaned=await f.cleanup({...f.lateOptions,ready});
 assert.equal(cleaned.terminated,true);assert.equal(cleaned.volumesAbsent,true);assert.equal(cleaned.interfacesAbsent,true);
 assert.deepEqual(structuredClone([...f.objects]),before);
});
for(const [label,change] of [
 ['missing shutdown',f=>({shutdownObservation:undefined})],
 ['no T170 running',f=>({shutdownObservation:{...f.lateOptions.shutdownObservation,runningRequestedAt:f.stamp(169)}})],
 ['OS receipt at T300',f=>({shutdownObservation:{...f.lateOptions.shutdownObservation,terminatedReceivedAt:f.stamp(300)}})],
 ['read at collection end',f=>({now:f.stamp(480),clock:()=>Date.parse(f.stamp(480))})],
 ['API shutdown',f=>({shutdownObservation:{...f.lateOptions.shutdownObservation,stateReason:{Code:'Client.UserInitiatedShutdown'}}})],
 ['missing captured disk',f=>({capture:{...f.ready,volumeIds:[]}})],
])test(`late console refuses ${label} without changing the booking`,async t=>{
 const f=await lateConsoleFixture(t),before=structuredClone([...f.objects]);
 await assert.rejects(f.late(change(f)),/D570 controller refused/);assert.deepEqual(structuredClone([...f.objects]),before);
});
test('late console capture retains live deletion identities without requiring a console reply',async t=>{
 const f=await readyGuestFixture(t);f.consoleOutput.Output='';
 assert.equal(typeof control.captureManualFirstResources,'function');
 const capture=await control.captureManualFirstResources(f.options);
 assert.deepEqual(capture.volumeIds,['vol-0123456789abcdef0']);assert.deepEqual(capture.interfaceIds,['eni-0123456789abcdef0']);
 assert.equal(Object.hasOwn(capture,'bootId'),false);assert.equal(f.calls.some(r=>r.operation==='get-console-output'),false);
});

async function launchedRetryFixture(t){
 const f=await removalFixture(t),base=realpathSync(dirname(f.setup.directory)),oldStack=f.setup.stackId;
 await f.remove();
 mkdirSync(join(base,'history'),{mode:0o700});
 for(const name of (await import('node:fs')).readdirSync(f.directory))writeFileSync(join(base,'history',name),readFileSync(join(f.directory,name)),{mode:0o600});
 writeFileSync(join(base,'initialized.json'),JSON.stringify(f.setup),{mode:0o600});
 writeFileSync(join(base,'launch.json'),JSON.stringify(f.launch),{mode:0o600});
 const original=new Map(['initialized.json','launch.json','setup/setup.json',...['setup.json','active.json','2026-11.json','2026-12.json'].map(n=>'history/'+n)].map(n=>[n,readFileSync(join(base,n))]));
 let current=f.options.clock()+60000,newStack=false;const prior=f.aws.call;
 const stamp=()=>new Date(current).toISOString().replace('.000Z','Z');
 const files={instance:join(base,'retained-instance.json'),console:join(base,'retained-console.json')};
 writeFileSync(files.instance,JSON.stringify(f.instances),{mode:0o600});writeFileSync(files.console,JSON.stringify(f.consoleOutput),{mode:0o600});
 const flags=()=>['--retained-evidence',files.instance,createHash('sha256').update(readFileSync(files.instance)).digest('hex'),files.console,createHash('sha256').update(readFileSync(files.console)).digest('hex')];
 f.aws.call=async(service,operation,input)=>{
  if(operation==='describe-stacks'&&input.StackName===oldStack)return {Stacks:[{StackId:oldStack,StackStatus:'DELETE_COMPLETE',Tags:[{Key:'Proof',Value:'D570'}],CreationTime:now}]};
  if(operation==='describe-stack-resources'&&input.StackName===oldStack)return {StackResources:f.p.resource.map(row=>({...row,ResourceStatus:'DELETE_COMPLETE'}))};
  if(operation==='create-stack'){
   newStack=true;f.p.stackId=oldStack.slice(0,-1)+'1';
   f.p.responses['events/describe-rule'].State='ENABLED';
   f.p.responses['cloudformation/describe-stacks'].Stacks[0].StackId=f.p.stackId;
   f.p.responses['cloudformation/describe-stacks'].Stacks[0].StackStatus='CREATE_COMPLETE';
   f.p.responses['cloudformation/describe-stacks'].Stacks[0].CreationTime=stamp();
   for(const row of f.p.resource)row.StackId=f.p.stackId;
   f.p.health.stackId=f.p.stackId;f.p.health.startedAt=stamp();f.p.health.completedAt=stamp();
   f.p.responses['s3api/get-object'].Body=Buffer.from(JSON.stringify(f.p.health));f.p.responses['s3api/get-object'].LastModified=stamp();
  }
  if(newStack&&operation==='put-object'){
   const old=f.objects.get(input.Key);if(old)assert.equal(input.IfMatch,old.etag);else assert.equal(input.IfNoneMatch,'*');
   const etag='"retry-'+f.writes.length+'"';f.objects.set(input.Key,{body:Buffer.from(input.Body),etag});f.writes.push(input.Key);f.calls.push({service,operation,input});return {ETag:etag};
  }
  if(newStack&&operation==='describe-stacks'&&input.StackName===f.p.stackId)return structuredClone(f.p.responses['cloudformation/describe-stacks']);
  return prior(service,operation,input);
 };
 const command=(name,extra=[])=>ownerCommand(f,[name,base,...extra],{clock:()=>current,sleep:async ms=>{current+=ms;}});
 return {...f,base,oldStack,files,flags,original,stamp,command,advance:ms=>{current+=ms;}};
}
test('launched retry qualifies the already-deleted attempt from hash-bound reads and retains its full prior booking',async t=>{
 const f=await launchedRetryFixture(t),recordPath=join(f.base,'setup-removal.json'),before=JSON.parse(readFileSync(recordPath));
 await f.command('down',f.flags());const qualified=JSON.parse(readFileSync(recordPath));
 assert.equal(qualified.eligible,false);assert.equal(qualified.releasedAt,null);assert.equal(qualified.deletedAt,before.deletedAt);assert.equal(qualified.reason,before.reason);
 assert.equal(qualified.retryAt,f.stamp());
 for(const [name,bytes]of f.original)assert.equal(readFileSync(join(f.base,name)).equals(bytes),true,name);
 f.advance(1000);await f.command('down',f.flags());assert.equal(JSON.parse(readFileSync(recordPath)).retryAt,qualified.retryAt);
 const child=await f.command('up');assert.equal(child.directory,join(f.base,'retry','setup'));assert.notEqual(child.stackId,f.oldStack);
 const active=JSON.parse(f.objects.get('d570/ledger/active.json').body);
 assert.equal(active.monthHeads['2026-11']!==undefined,true);
 assert.equal(child.runEvidence.openings['2026-11'].overheadMicroUsd,18320296);
 assert.equal(child.runEvidence.openings['2026-12'].overheadMicroUsd,18320296);
 assert.equal(f.calls.filter(row=>row.operation==='run-instances').length,0);
 for(const [name,bytes]of f.original)assert.equal(readFileSync(join(f.base,name)).equals(bytes),true,name);
});

test('nested retry releases only its incomplete child and counts the launched ancestor in the next setup', async t => {
 const f = await launchedRetryFixture(t);
 await f.command('down', f.flags());
 const parentBytes = readFileSync(join(f.base, 'setup-removal.json')), prior = f.aws.call;
 let failBilling = true, childCreated = false, childDeleted = false, creations = 0;
 f.aws.call = async (service, operation, input) => {
  if (service === 'ce' && childCreated && failBilling) throw new Error('synthetic interrupted post-create billing');
  if (childCreated && !childDeleted && operation === 'describe-stacks' && input.StackName === 'd570-first')
   return structuredClone(f.p.responses['cloudformation/describe-stacks']);
  if (childCreated && operation === 'delete-stack') { childDeleted = true; return {}; }
  if (childDeleted && operation === 'describe-stacks' && input.StackName === f.p.stackId)
   return { Stacks: [{ StackId: f.p.stackId, StackStatus: 'DELETE_COMPLETE', Tags: [{ Key: 'Proof', Value: 'D570' }], CreationTime: f.p.responses['cloudformation/describe-stacks'].Stacks[0].CreationTime }] };
  if (childDeleted && operation === 'describe-stack-resources' && input.StackName === f.p.stackId)
   return { StackResources: f.p.resource.map(row => ({ ...row, ResourceStatus: 'DELETE_COMPLETE' })) };
  const result = await prior(service, operation, input);
  if (operation === 'create-stack') {
   childCreated = true; childDeleted = false; creations++;
   if (creations === 2) {
    f.p.stackId = f.oldStack.slice(0, -1) + '2'; result.StackId = f.p.stackId;
    f.p.responses['cloudformation/describe-stacks'].Stacks[0].StackId = f.p.stackId;
    for (const row of f.p.resource) row.StackId = f.p.stackId;
    f.p.health.stackId = f.p.stackId; f.p.responses['s3api/get-object'].Body = Buffer.from(JSON.stringify(f.p.health));
   }
  }
  return result;
 };
 await assert.rejects(f.command('up'), /synthetic interrupted post-create billing/);
 const child = join(f.base, 'retry'), original = readFileSync(join(child, 'setup', 'setup.json'));
 assert.equal(existsSync(join(child, 'initialized.json')), false);
 assert.equal(existsSync(join(child, 'launch.json')), false);
 assert.equal(f.objects.size, 0);
 failBilling = false;
 await f.command('down');
 const cleanup = JSON.parse(readFileSync(join(child, 'setup-removal.json')));
 assert.equal(cleanup.eligible, true); assert.equal(cleanup.releasedAt, f.stamp());
 const replacement = await f.command('up');
 assert.equal(replacement.directory, join(child, 'retry', 'setup'));
 assert.equal(replacement.priorBookedMicroUsd, 9313491);
 assert.equal(replacement.runEvidence.openings['2026-11'].overheadMicroUsd, 18320296);
 assert.equal(replacement.runEvidence.openings['2026-12'].overheadMicroUsd, 18320296);
 assert.equal(readFileSync(join(f.base, 'setup-removal.json')).equals(parentBytes), true);
 assert.equal(readFileSync(join(child, 'setup', 'setup.json')).equals(original), true);
 for (const [name, bytes] of f.original) assert.equal(readFileSync(join(f.base, name)).equals(bytes), true, name);
});
for(const [label,edit]of [
 ['wrong hash',(f,flags)=>{flags[2]='0'.repeat(64);}],
 ['public file',(f)=>chmodSync(f.files.instance,0o644)],
 ['foreign token',(f)=>{const body=JSON.parse(readFileSync(f.files.instance));body.Reservations[0].Instances[0].ClientToken='00000000-0000-4000-8000-000000000002';writeFileSync(f.files.instance,JSON.stringify(body));}],
 ['API termination',(f)=>{const body=JSON.parse(readFileSync(f.files.instance));body.Reservations[0].Instances[0].StateReason.Code='Client.UserInitiatedShutdown';writeFileSync(f.files.instance,JSON.stringify(body));}],
 ['wrong console instance',(f)=>{const body=JSON.parse(readFileSync(f.files.console));body.InstanceId='i-00000000000000000';writeFileSync(f.files.console,JSON.stringify(body));}],
 ['changed history',(f)=>{const path=join(f.base,'history','2026-11.json'),body=JSON.parse(readFileSync(path));body.entries[0].upperMicroUsd++;writeFileSync(path,JSON.stringify(body));}],
 ['missing history',(f)=>rmSync(join(f.base,'history','active.json'))],
])test(`launched retry refuses ${label} before qualifying or creating another stack`,async t=>{
 const f=await launchedRetryFixture(t);let flags=f.flags();edit(f,flags);if(label!=='wrong hash')flags=f.flags();
 await assert.rejects(f.command('down',flags),/D570 controller refused|D570 budget refused/);
 assert.equal(existsSync(join(f.base,'retry')),false);assert.equal(JSON.parse(readFileSync(join(f.base,'setup-removal.json'))).retryAt,undefined);
 assert.equal(f.calls.filter(row=>row.operation==='run-instances').length,0);
});

test('late console needs no terminated-instance attribute read after the live capture',async t=>{
 const f=await lateConsoleFixture(t),prior=f.aws.call;
 f.aws.call=async(...args)=>{if(args[1]==='describe-instance-attribute')throw new Error('synthetic terminated attribute unavailable');return prior(...args);};
 assert.equal((await f.late()).bootId,'11111111-1111-4111-8111-111111111111');
});
for(const command of ['up','drill','reconcile'])test(`retained evidence flags refuse on ${command} before any provider call`,async t=>{
 const f=fixture(t),base=mkdtempSync(join(tmpdir(),'d570-flags-'));chmodSync(base,0o700);t.after(()=>rmSync(base,{recursive:true,force:true}));
 await assert.rejects(control.runManualCommand({checkout:f.root,aws:f.aws,args:[command,base,'--retained-evidence','/private/a','a'.repeat(64),'/private/b','b'.repeat(64)]}),/D570 controller refused/);
 assert.deepEqual(f.calls,[]);
});

for(const month of ['2026-11','2026-12'])test(`setup booking includes launched ancestors in the strict ${month} cap`,async t=>{
 const f=setupBookingFixture(t);
 await assert.rejects(f.book({priorBookings:{[month]:20000000}}),/D570 controller refused: booking/);
 assert.equal(existsSync(f.options.directory),false);
 assert.equal(f.calls.some(row=>row.operation==='create-stack'),false);
});
test('first removal refuses a captured untagged disk before deleting the stack',async t=>{
 const f=await removalFixture(t),base=dirname(f.setup.directory),prior=f.aws.call;
 writeFileSync(join(base,'launch.json'),JSON.stringify({...f.launch,capture:{volumeIds:f.ready.volumeIds,interfaceIds:f.ready.interfaceIds,observedAt:f.ready.observedAt}}),{mode:0o600});
 f.aws.call=async(...args)=>args[1]==='describe-volumes'&&args[2].Filters?.[0].Name==='volume-id'?{Volumes:[{VolumeId:f.ready.volumeIds[0]}]}:prior(...args);
 await assert.rejects(f.remove(),/D570 controller refused/);
 assert.equal(f.calls.some(row=>row.operation==='delete-stack'),false);
});

test('launched retry reuses the checked cleanup instance after EC2 forgets it',async t=>{
 const f=await launchedRetryFixture(t),prior=f.aws.call;
 writeFileSync(join(f.base,'cleanup.json'),JSON.stringify({...f.ready,instanceObservation:f.instances,terminated:true,volumesAbsent:true,interfacesAbsent:true,stateReason:{Code:'Client.InstanceInitiatedShutdown'}}),{mode:0o600});
 f.aws.call=async(...args)=>{if(args[1]==='describe-instances'&&args[2].InstanceIds)throw new Error('synthetic terminated instance expired');return prior(...args);};
 await f.command('down');assert.equal(JSON.parse(readFileSync(join(f.base,'setup-removal.json'))).retryAt,f.stamp());
 assert.equal(f.calls.some(row=>row.operation==='run-instances'),false);
});

function omitTerminatedSubnet(response){const row=response.Reservations[0].Instances[0];delete row.SubnetId;row.NetworkInterfaces=[];row.BlockDeviceMappings=[];}
test('launched retry accepts absent subnet only with matching saved removal and fresh deleted inventory',async t=>{
 const f=await launchedRetryFixture(t),body=JSON.parse(readFileSync(f.files.instance));omitTerminatedSubnet(body);writeFileSync(f.files.instance,JSON.stringify(body));
 await f.command('down',f.flags());const record=JSON.parse(readFileSync(join(f.base,'setup-removal.json')));assert.equal(record.retryAt,f.stamp());assert.equal(record.subnet,f.launch.subnetId);
 assert.equal(Object.hasOwn(record,'boundSubnet'),false);
 const child=await f.command('up');assert.equal(child.runEvidence.openings['2026-11'].overheadMicroUsd,18320296);
});
for(const [label,edit]of [
 ['mismatched saved subnet',f=>{const p=join(f.base,'setup-removal.json'),r=JSON.parse(readFileSync(p));r.subnet='subnet-00000000000000000';writeFileSync(p,JSON.stringify(r));}],
 ['null saved subnet',f=>{const p=join(f.base,'setup-removal.json'),r=JSON.parse(readFileSync(p));r.subnet=null;writeFileSync(p,JSON.stringify(r));}],
 ['missing inventory subnet',f=>{f.p.resource.splice(f.p.resource.findIndex(x=>x.LogicalResourceId==='Subnet'),1);}],
 ['different inventory subnet',f=>{f.p.resource.find(x=>x.LogicalResourceId==='Subnet').PhysicalResourceId='subnet-00000000000000000';}],
 ['present different subnet',(_f,b)=>{b.Reservations[0].Instances[0].SubnetId='subnet-00000000000000000';}],
 ['nonempty network list',(_f,b)=>{b.Reservations[0].Instances[0].NetworkInterfaces=[{}];}],
])test(`missing-subnet retry refuses ${label} without a child`,async t=>{
 const f=await launchedRetryFixture(t),body=JSON.parse(readFileSync(f.files.instance));omitTerminatedSubnet(body);edit(f,body);writeFileSync(f.files.instance,JSON.stringify(body));
 await assert.rejects(f.command('down',f.flags()),/D570 controller refused/);assert.equal(existsSync(join(f.base,'retry')),false);
 assert.equal(JSON.parse(readFileSync(join(f.base,'setup-removal.json'))).retryAt,undefined);
});
test('late console and cleanup accept omitted terminated subnet after their validated live capture',async t=>{
 const f=await lateConsoleFixture(t);omitTerminatedSubnet(f.instances);
 const ready=await f.late();const cleanup=await f.cleanup({...f.lateOptions,ready});assert.equal(cleanup.terminated,true);assert.equal(cleanup.volumesAbsent,true);
});

test('shutdown timing accepts omitted subnet only on the terminated reply after live capture',async t=>{
 const f=await shutdownTimingFixture(t),prior=f.aws.call;
 f.aws.call=async(...args)=>{const response=await prior(...args);if(args[1]==='describe-instances'&&response.Reservations[0].Instances[0].State.Name==='terminated')omitTerminatedSubnet(response);return response;};
 assert.equal((await f.observe()).shutdownObservation.terminatedReceivedAt,'2026-11-06T12:03:00Z');
});
test('new-run retry keeps eligibility with an omitted subnet in captured cleanup evidence',async t=>{
 const f=await launchedRetryFixture(t),prior=f.aws.call,response=structuredClone(f.instances);omitTerminatedSubnet(response);
 writeFileSync(join(f.base,'launch.json'),JSON.stringify({...f.launch,capture:{volumeIds:f.ready.volumeIds,interfaceIds:f.ready.interfaceIds,observedAt:f.ready.observedAt}}));
 writeFileSync(join(f.base,'cleanup.json'),JSON.stringify({...f.ready,instanceObservation:response,terminated:true,volumesAbsent:true,interfacesAbsent:true,stateReason:{Code:'Client.InstanceInitiatedShutdown'}}),{mode:0o600});
 f.aws.call=async(...args)=>{
  if(args[1]==='describe-instances'&&args[2].InstanceIds)throw new Error('synthetic EC2 no longer retains it');
  if(args[1]==='describe-network-interfaces'&&args[2].Filters?.[0].Name==='network-interface-id')return {NetworkInterfaces:[]};
  return prior(...args);
 };
 await f.command('down');assert.equal(JSON.parse(readFileSync(join(f.base,'setup-removal.json'))).retryAt,f.stamp());
});

test('a third full setup cannot fit after two launched reservations even with a zero account bill',async t=>{
 const f=await creationFixture(t);
 await assert.rejects(f.create({priorBookings:{'2026-11':18626982,'2026-12':18626982}}),/D570 controller refused: booking/);
 assert.deepEqual(f.counts(),{creates:0,enables:0});assert.equal(existsSync(f.options.directory),false);
});

test('owner-reviewed commit opt-in permits the exact detached remote PR head',async t=>{
 const f=fixture(t),previous=process.env.D570_REVIEWED_COMMIT;
 t.after(()=>{if(previous===undefined)delete process.env.D570_REVIEWED_COMMIT;else process.env.D570_REVIEWED_COMMIT=previous;});
 f.git('switch','-c','reviewed-fixture');f.git('-c','commit.gpgsign=false','commit','--allow-empty','-s','-m','Reviewed synthetic branch commit');const reviewed=f.git('rev-parse','HEAD');
 f.git('update-ref','refs/heads/fix/kubernetes-console-readiness',reviewed);f.git('switch','--detach');process.env.D570_REVIEWED_COMMIT=reviewed;
 const result=await inspect(f);assert.equal(result.head,reviewed);assert.deepEqual(f.calls.map(x=>x.service),['sts','ce']);
});
test('owner-reviewed commit opt-in refuses a different local or remote PR commit before AWS',async t=>{
 const f=fixture(t),previous=process.env.D570_REVIEWED_COMMIT;
 t.after(()=>{if(previous===undefined)delete process.env.D570_REVIEWED_COMMIT;else process.env.D570_REVIEWED_COMMIT=previous;});
 f.git('update-ref','refs/heads/fix/kubernetes-console-readiness',f.head);f.git('switch','--detach');
 f.git('-c','commit.gpgsign=false','commit','--allow-empty','-s','-m','Different synthetic reviewed commit');const other=f.git('rev-parse','HEAD');
 process.env.D570_REVIEWED_COMMIT=other;f.git('switch','--detach',f.head);
 await assert.rejects(inspect(f),/D570 controller refused: checkout/);assert.deepEqual(f.calls,[]);
 f.git('switch','--detach',other);await assert.rejects(inspect(f),/D570 controller refused: checkout/);assert.deepEqual(f.calls,[]);
});
