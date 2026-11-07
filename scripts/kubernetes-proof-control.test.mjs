import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, statSync, mkdirSync, symlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('setup booking includes the actual opening in the strict ten-dollar cap', async t => {
  const f = setupBookingFixture(t);
  f.options.cost.components.compute.upperMicroUsd = 8665432;
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
