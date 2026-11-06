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
