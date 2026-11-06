import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
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
      State: 'ENABLED', ScheduleExpression: 'rate(1 minute)', EventBusName: 'default' },
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
  assert.deepEqual(saved.args.slice(0, 6), ['s3api', 'get-object', '--cli-input-json', JSON.stringify(f.input), '--region', 'eu-north-1']);
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
