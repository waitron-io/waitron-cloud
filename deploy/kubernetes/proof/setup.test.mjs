import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import vm from 'node:vm';

const module = await import('./setup.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const inputs = () => JSON.parse(readFileSync(new URL('./test-fixtures/setup-input.json', import.meta.url)));
function render(input = inputs()) {
  assert.equal(typeof module.renderSetup, 'function', 'reviewable setup template compiler is missing');
  return module.renderSetup(input);
}
const resource = (t, name) => t.Resources[name].Properties;
const statements = (t, name) => resource(t, name).Policies.flatMap(p => p.PolicyDocument.Statement);

function withRootMappings(client, result) {
  client.rootDisks = new Map();
  for (const row of result.Reservations.flatMap(r => r.Instances)) {
    row.RootDeviceName = '/dev/xvda';
    const id = `vol-${'89abcdef01234567'[parseInt(row.InstanceId[2], 16)]}${row.InstanceId.slice(3)}`;
    row.BlockDeviceMappings = [{ DeviceName: '/dev/xvda', Ebs: { VolumeId: id, DeleteOnTermination: true } }];
    client.rootDisks.set(id, { VolumeId: id, State: 'in-use', Tags: structuredClone(row.Tags), Attachments: [{ InstanceId: row.InstanceId, Device: '/dev/xvda', State: 'attached' }] });
  }
  return result;
}


test('one template generates private network, storage, two roles and disabled independent expiry', () => {
  const t = render();
  assert.deepEqual(Object.values(t.Resources).map(r => r.Type).sort(), [
    'AWS::EC2::LaunchTemplate', 'AWS::EC2::RouteTable', 'AWS::EC2::SecurityGroup', 'AWS::EC2::Subnet',
    'AWS::EC2::SubnetRouteTableAssociation', 'AWS::EC2::VPC', 'AWS::EC2::VPCEndpoint',
    'AWS::Events::Rule', 'AWS::IAM::OIDCProvider', 'AWS::IAM::Role', 'AWS::IAM::Role',
    'AWS::Lambda::Function', 'AWS::Lambda::Permission', 'AWS::Logs::LogGroup', 'AWS::S3::Bucket', 'AWS::S3::BucketPolicy',
  ].sort());
  assert.equal(resource(t, 'ExpiryRule').State, 'DISABLED');
  assert.equal(resource(t, 'ExpiryRule').ScheduleExpression, 'rate(1 minute)');
  assert.equal(resource(t, 'ExpiryLog').RetentionInDays, 1);
  assert.equal(resource(t, 'ExpiryFunction').Timeout, 120);
  assert.equal(resource(t, 'ExpiryPermission').SourceAccount, '462991287391');
  assert.deepEqual(resource(t, 'ExpiryPermission').SourceArn, { 'Fn::GetAtt': ['ExpiryRule', 'Arn'] });
  assert.equal(resource(t, 'Subnet').MapPublicIpOnLaunch, false);
  assert.deepEqual(resource(t, 'SecurityGroup').SecurityGroupIngress, []);
  assert.deepEqual(resource(t, 'SecurityGroup').SecurityGroupEgress, [{ IpProtocol: 'tcp', FromPort: 443, ToPort: 443, DestinationPrefixListId: 'pl-0123456789abcdef0' }]);
  assert.equal(resource(t, 'S3Endpoint').VpcEndpointType, 'Gateway');
  assert.deepEqual(resource(t, 'S3Endpoint').ServiceName, 'com.amazonaws.eu-south-2.s3');
});

test('outputs supply runtime identities and numeric launch version without pasted owner resource IDs', () => {
  const t = render();
  for (const key of ['StackId', 'Bucket', 'VpcId', 'SubnetId', 'SecurityGroupId', 'LaunchTemplateId', 'LaunchTemplateVersion', 'ImageId', 'LauncherRoleArn', 'ExpiryRoleArn', 'ExpiryRuleArn', 'RepositoryId', 'RepositoryOwnerId', 'Subject', 'AccessExpiry', 'MonthlyCapUsd']) assert.ok(t.Outputs[key]?.Value, key);
  assert.deepEqual(t.Outputs.LaunchTemplateVersion.Value, { 'Fn::GetAtt': ['LaunchTemplate', 'LatestVersionNumber'] });
  assert.equal(t.Outputs.RepositoryId.Value, '1381507078');
  assert.equal(t.Outputs.RepositoryOwnerId.Value, '332029685');
  assert.equal(t.Outputs.Subject.Value, 'repo:waitron-io/waitron-cloud:environment:kubernetes-proof-staging');
  assert.equal(t.Outputs.MonthlyCapUsd.Value, '10');
  assert.equal(t.Outputs.AccessExpiry.Value, '2027-02-28T23:59:00Z');
});

test('shared OIDC provider is referenced and only an absent provider gets a conditional owned resource', () => {
  const t = render();
  assert.deepEqual(t.Conditions.D570Scope, { 'Fn::And': [{ 'Fn::Equals': [{ Ref: 'AWS::AccountId' }, '462991287391'] }, { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'eu-south-2'] }] });
  assert.deepEqual(t.Conditions.CreateOidc, { 'Fn::And': [{ Condition: 'D570Scope' }, { 'Fn::Equals': [{ Ref: 'ExistingOidcProviderArn' }, ''] }] });
  for (const [name, definition] of Object.entries(t.Resources)) assert.equal(definition.Condition, name === 'OidcProvider' ? 'CreateOidc' : 'D570Scope');
  assert.equal(t.Resources.OidcProvider.Condition, 'CreateOidc');
  const trust = resource(t, 'LauncherRole').AssumeRolePolicyDocument.Statement[0];
  assert.deepEqual(trust.Principal.Federated, { 'Fn::If': ['CreateOidc', { Ref: 'OidcProvider' }, { Ref: 'ExistingOidcProviderArn' }] });
  assert.equal(t.Parameters.ExistingOidcProviderArn.Default, inputs().oidcProviderArn);
  const absent = render({ ...inputs(), oidcProviderArn: null });
  assert.equal(absent.Parameters.ExistingOidcProviderArn.Default, '');
  assert.equal(resource(absent, 'OidcProvider').Url, 'https://token.actions.githubusercontent.com');
});

test('wrong account, region, repository, image, provider and expired authority refuse render', () => {
  for (const change of [
    { account: '949687825720' }, { region: 'eu-west-1' },
    { repository: { ...inputs().repository, fullName: 'attacker/fork' } },
    { repository: { ...inputs().repository, id: 0 } },
    { repository: { ...inputs().repository, id: 1381507079 } },
    { repository: { ...inputs().repository, ownerId: 332029686 } },
    { repository: { ...inputs().repository, ownerId: '332029685' } },
    { oidcProviderArn: 'arn:aws:iam::949687825720:oidc-provider/token.actions.githubusercontent.com' },
    { oidcProviderArn: '' },
    { image: { ...inputs().image, ImageId: 'latest' } },
    { image: { ...inputs().image, OwnerId: 'attacker' } },
    { image: { ...inputs().image, Architecture: 'x86_64' } },
    { image: { ...inputs().image, State: 'pending' } },
    { image: { ...inputs().image, RootDeviceType: 'instance-store' } },
    { image: { ...inputs().image, Public: false } },
    { image: { ...inputs().image, VirtualizationType: 'paravirtual' } },
    { s3PrefixListId: '0.0.0.0/0' },
    { now: '2027-02-28T23:59:00Z' }, { now: '2026-02-30T20:00:00Z' },
  ]) assert.throws(() => render({ ...inputs(), ...change }), /scope|identity|image|authority|prefix|OIDC/i, JSON.stringify(change));
});

test('launch template fixes private ARM shape, bounded root disk and shutdown-to-terminate', () => {
  const t = render();
  const launch = resource(t, 'LaunchTemplate').LaunchTemplateData;
  assert.deepEqual(launch.ImageId, { Ref: 'ImageId' });
  assert.equal(t.Parameters.ImageId.Default, 'ami-0123456789abcdef0');
  assert.deepEqual(t.Parameters.ImageId.AllowedValues, ['ami-0123456789abcdef0']);
  assert.equal(launch.InstanceType, 'm7g.2xlarge');
  assert.equal(launch.InstanceInitiatedShutdownBehavior, 'terminate');
  assert.equal(launch.IamInstanceProfile, undefined);
  assert.equal(launch.InstanceMarketOptions, undefined);
  assert.deepEqual(launch.MetadataOptions, { HttpEndpoint: 'enabled', HttpTokens: 'required', HttpPutResponseHopLimit: 1, InstanceMetadataTags: 'disabled' });
  assert.deepEqual(launch.NetworkInterfaces, [{ DeviceIndex: 0, AssociatePublicIpAddress: false, DeleteOnTermination: true, SubnetId: { Ref: 'Subnet' }, Groups: [{ Ref: 'SecurityGroup' }] }]);
  assert.deepEqual(launch.BlockDeviceMappings, [{ DeviceName: '/dev/xvda', Ebs: { Encrypted: true, DeleteOnTermination: true, VolumeSize: 64, VolumeType: 'gp3', Iops: 3000, Throughput: 125 } }]);
});

test('launcher trust requires exact subject and audience with fixed access expiry', () => {
  const role = resource(render(), 'LauncherRole');
  assert.equal(role.MaxSessionDuration, 8100);
  const trust = role.AssumeRolePolicyDocument.Statement;
  assert.equal(trust.length, 1);
  assert.equal(trust[0].Action, 'sts:AssumeRoleWithWebIdentity');
  assert.deepEqual(trust[0].Condition, { StringEquals: {
    'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
    'token.actions.githubusercontent.com:sub': 'repo:waitron-io/waitron-cloud:environment:kubernetes-proof-staging',
  }, DateLessThan: { 'aws:CurrentTime': '2027-02-28T23:59:00Z' } });
});

test('runtime has explicit regional operations with no administration or mutable health access', () => {
  const t = render();
  const launcherStatements = statements(t, 'LauncherRole');
  assert.deepEqual(launcherStatements.find(s => s.Sid === 'UnqualifiedLaunch'), { Sid: 'UnqualifiedLaunch', Effect: 'Deny', Action: 'ec2:RunInstances', Resource: '*' });
  const launcher = launcherStatements.filter(s => s.Effect === 'Allow');
  const actions = launcher.flatMap(s => [s.Action].flat()).sort();
  assert.deepEqual(actions, [
    'ec2:RunInstances', 'ec2:RunInstances', 'ec2:CreateTags', 'ec2:DescribeInstances', 'ec2:DescribeVolumes', 'ec2:DescribeNetworkInterfaces',
    'ec2:DescribeLaunchTemplateVersions', 'ec2:DescribeImages', 'ec2:DescribeSubnets', 'ec2:DescribeSecurityGroups', 'ec2:DescribeRouteTables', 'ec2:DescribeVpcEndpoints',
    'ec2:DescribeInstanceAttribute', 'ec2:TerminateInstances', 'ec2:DeleteVolume', 's3:GetObject', 's3:PutObject', 's3:ListBucket',
    's3:AbortMultipartUpload', 's3:ListMultipartUploadParts', 'cloudtrail:LookupEvents',
  ].sort());
  for (const s of launcher.filter(s => [s.Action].flat().some(a => a.startsWith('ec2:') || a.startsWith('cloudtrail:')))) assert.equal(s.Condition.StringEquals['aws:RequestedRegion'], 'eu-south-2');
  const put = launcher.find(s => s.Action === 's3:PutObject');
  assert.deepEqual(put.Resource, [{ 'Fn::Sub': '${Bucket.Arn}/d570/ledger/*' }, { 'Fn::Sub': '${Bucket.Arn}/d570/payload/*' }, { 'Fn::Sub': '${Bucket.Arn}/d570/receipt/*' }]);
  const sweep = statements(t, 'ExpiryRole');
  assert.deepEqual(sweep.flatMap(s => [s.Action].flat()).sort(), ['ec2:DescribeInstances', 'ec2:DescribeVolumes', 'ec2:TerminateInstances', 'ec2:DeleteVolume', 's3:PutObject', 'logs:CreateLogStream', 'logs:PutLogEvents'].sort());
  assert.deepEqual(sweep.find(s => s.Sid === 'ExpiryLogs').Resource, { 'Fn::GetAtt': ['ExpiryLog', 'Arn'] });
  assert.deepEqual(sweep.find(s => s.Action === 's3:PutObject').Resource, { 'Fn::Sub': '${Bucket.Arn}/d570/health/reaper.json' });
  for (const role of ['LauncherRole', 'ExpiryRole']) {
    for (const s of statements(t, role).filter(s => [s.Action].flat().includes('ec2:TerminateInstances'))) {
      assert.equal(s.Condition.StringEquals['ec2:ResourceTag/Proof'], 'D570');
      assert.deepEqual(s.Condition.StringEquals['ec2:ResourceTag/Stack'], { Ref: 'AWS::StackId' });
    }
    assert.equal(resource(t, role).ManagedPolicyArns, undefined);
  }
});

test('bucket is private and rejects cleartext and unconditional ledger writes', () => {
  const t = render(), bucket = resource(t, 'Bucket');
  assert.deepEqual(bucket.PublicAccessBlockConfiguration, { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true });
  assert.deepEqual(bucket.OwnershipControls, { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] });
  assert.equal(bucket.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.SSEAlgorithm, 'AES256');
  const p = resource(t, 'BucketPolicy').PolicyDocument.Statement;
  assert.deepEqual(p.find(s => s.Sid === 'TlsOnly').Condition, { Bool: { 'aws:SecureTransport': 'false' } });
  assert.deepEqual(p.find(s => s.Sid === 'ConditionalLedger').Condition, { Null: { 's3:if-match': 'true', 's3:if-none-match': 'true' }, Bool: { 's3:ObjectCreationOperation': 'true' } });
  assert.equal(bucket.VersioningConfiguration, undefined);
  assert.ok(bucket.LifecycleConfiguration.Rules.some(r => r.Prefix === 'd570/payload/' && r.ExpirationInDays === 1 && r.AbortIncompleteMultipartUpload.DaysAfterInitiation === 1));
  assert.ok(bucket.LifecycleConfiguration.Rules.some(r => r.Prefix === 'd570/receipt/' && r.ExpirationInDays === 30));
  assert.equal(bucket.LifecycleConfiguration.Rules.some(r => r.Prefix === 'd570/ledger/'), false, 'unknown ledger ownership cannot expire automatically');
});

test('serialized Lambda runs the actual expiry engine with explicit SDK operations', async () => {
  const t = render(), source = resource(t, 'ExpiryFunction').Code.ZipFile;
  const calls = [];
  class Client {
    constructor(options) { assert.equal(options.region, 'eu-south-2'); assert.equal(options.maxAttempts, 3); }
    async send(command) {
      calls.push(command);
      if (command.name === 'DescribeInstancesCommand') return { Reservations: [] };
      if (command.name === 'DescribeVolumesCommand') return { Volumes: [] };
      if (command.name === 'PutObjectCommand') return {};
      throw new Error('Unexpected SDK operation');
    }
  }
  const command = name => class { constructor(input) { this.name = name; this.input = input; } };
  const exports = {};
  vm.runInNewContext(source, { exports, process: { env: { AWS_REGION: 'eu-south-2', ACCOUNT: '462991287391', STACK_ID: 'arn:aws:cloudformation:eu-south-2:462991287391:stack/d570/00000000-0000-4000-8000-000000000000', BUCKET: 'd570-synthetic', ACCESS_EXPIRY: resource(render(), 'ExpiryFunction').Environment.Variables.ACCESS_EXPIRY } }, require(name) {
    if (name === '@aws-sdk/client-ec2') return { EC2Client: Client, ...Object.fromEntries(['DescribeInstances', 'DescribeVolumes', 'TerminateInstances', 'DeleteVolume'].map(n => [`${n}Command`, command(`${n}Command`)])) };
    if (name === '@aws-sdk/client-s3') return { S3Client: Client, PutObjectCommand: command('PutObjectCommand') };
    throw new Error(`Unexpected import: ${name}`);
  } });
  const result = await exports.handler();
  assert.equal(result.schema, 'd570-sweep-v1');
  assert.deepEqual(calls.map(c => c.name), ['DescribeInstancesCommand', 'DescribeVolumesCommand', 'PutObjectCommand']);
  assert.equal(calls[2].input.Key, 'd570/health/reaper.json');
});

test('up and down refuse all execution while owner lifecycle and live qualification are unfinished', () => {
  for (const action of ['up', 'down']) {
    const result = spawnSync(process.execPath, [new URL('./setup.mjs', import.meta.url).pathname, action], { encoding: 'utf8', env: { PATH: '/nonexistent' } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /owner-run lifecycle is not implemented/);
    assert.equal(result.stdout, '');
  }
});

test('symlinked CLI refuses up, down and unknown commands without running the next step', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'd570-cli-refusal-'));
  try {
    const alias = join(scratch, 'setup.mjs');
    symlinkSync(new URL('./setup.mjs', import.meta.url).pathname, alias);
    for (const action of ['up', 'down', '--force']) {
      const result = spawnSync(process.execPath, [alias, action], { encoding: 'utf8', env: { PATH: '/nonexistent' } });
      assert.equal(result.status, 1, action);
      assert.match(result.stderr, /owner-run lifecycle is not implemented/);
      assert.equal(result.stdout, '');
    }
  } finally { rmSync(scratch, { recursive: true }); }
});

test('expiry role, environment and invocation target retain separate ownership boundaries', () => {
  const t = render();
  assert.deepEqual(resource(t, 'ExpiryRole').AssumeRolePolicyDocument, { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] });
  const fn = resource(t, 'ExpiryFunction');
  assert.deepEqual(fn.Role, { 'Fn::GetAtt': ['ExpiryRole', 'Arn'] });
  assert.equal(fn.ReservedConcurrentExecutions, 1);
  assert.deepEqual(fn.Environment.Variables, { ACCOUNT: '462991287391', STACK_ID: { Ref: 'AWS::StackId' }, BUCKET: { Ref: 'Bucket' }, ACCESS_EXPIRY: '2027-02-28T23:59:00Z' });
  assert.deepEqual(resource(t, 'ExpiryRule').Targets, [{ Id: 'D570Expiry', Arn: { 'Fn::GetAtt': ['ExpiryFunction', 'Arn'] }, RetryPolicy: { MaximumEventAgeInSeconds: 60, MaximumRetryAttempts: 0 } }]);
  assert.deepEqual(resource(t, 'ExpiryPermission').FunctionName, { Ref: 'ExpiryFunction' });
  assert.equal(resource(t, 'ExpiryPermission').Principal, 'events.amazonaws.com');
  assert.equal(resource(t, 'LaunchTemplate').LaunchTemplateData.DisableApiTermination, undefined);
});

test('tagging and cleanup permissions keep both exact resource and request boundaries', () => {
  const t = render();
  const arns = ['arn:aws:ec2:eu-south-2:462991287391:instance/*', 'arn:aws:ec2:eu-south-2:462991287391:volume/*'];
  const owned = { StringEquals: { 'aws:RequestedRegion': 'eu-south-2', 'ec2:ResourceTag/Proof': 'D570', 'ec2:ResourceTag/Stack': { Ref: 'AWS::StackId' } } };
  for (const [role, sid] of [['LauncherRole', 'OwnedCleanup'], ['ExpiryRole', 'TerminateOwned']]) {
    const s = statements(t, role).find(s => s.Sid === sid);
    assert.deepEqual(s?.Resource, arns);
    assert.deepEqual(s?.Condition.StringEquals, owned.StringEquals);
  }
  const tags = statements(t, 'LauncherRole').find(s => s.Sid === 'LaunchTags');
  assert.deepEqual(tags?.Resource, arns);
  assert.deepEqual(tags?.Condition.StringEquals, { 'aws:RequestedRegion': 'eu-south-2', 'ec2:CreateAction': 'RunInstances', 'aws:RequestTag/Proof': 'D570', 'aws:RequestTag/Stack': { Ref: 'AWS::StackId' } });
  const run = statements(t, 'LauncherRole').find(s => s.Sid === 'TaggedRun');
  assert.deepEqual(run?.Resource, arns);
  assert.deepEqual(run?.Condition.StringEquals, { 'aws:RequestedRegion': 'eu-south-2', 'aws:RequestTag/Proof': 'D570', 'aws:RequestTag/Stack': { Ref: 'AWS::StackId' }, 'ec2:InstanceType': 'm7g.2xlarge' });
  assert.deepEqual(run?.Condition.Null, { 'aws:RequestTag/Run': 'false', 'aws:RequestTag/ExpiresAt': 'false' });
  assert.deepEqual(run?.Condition.ArnEquals, { 'ec2:LaunchTemplate': { 'Fn::Sub': 'arn:aws:ec2:eu-south-2:462991287391:launch-template/${LaunchTemplate}' } });
  const fixed = statements(t, 'LauncherRole').find(s => s.Sid === 'FixedTemplateResources');
  assert.deepEqual(fixed?.Condition.Bool, { 'ec2:IsLaunchTemplateResource': 'true' });
  assert.deepEqual(fixed?.Condition.ArnEquals, run?.Condition.ArnEquals);
});

test('bucket and endpoint policies keep transport and create-only object boundaries', () => {
  const t = render(), p = resource(t, 'BucketPolicy').PolicyDocument.Statement;
  const tls = p.find(s => s.Sid === 'TlsOnly');
  assert.deepEqual(tls, { Sid: 'TlsOnly', Effect: 'Deny', Action: 's3:*', Resource: [{ 'Fn::GetAtt': ['Bucket', 'Arn'] }, { 'Fn::Sub': '${Bucket.Arn}/*' }], Condition: { Bool: { 'aws:SecureTransport': 'false' } }, Principal: '*' });
  assert.deepEqual(p.find(s => s.Sid === 'CreateOnlyEvidence'), { Sid: 'CreateOnlyEvidence', Effect: 'Deny', Action: 's3:PutObject', Resource: [{ 'Fn::Sub': '${Bucket.Arn}/d570/payload/*' }, { 'Fn::Sub': '${Bucket.Arn}/d570/receipt/*' }], Condition: { Null: { 's3:if-none-match': 'true' }, Bool: { 's3:ObjectCreationOperation': 'true' } }, Principal: '*' });
  assert.deepEqual(resource(t, 'S3Endpoint').PolicyDocument, { Version: '2012-10-17', Statement: [{ Sid: 'ProofObjects', Effect: 'Allow', Action: ['s3:GetObject', 's3:PutObject', 's3:AbortMultipartUpload', 's3:ListMultipartUploadParts'], Resource: { 'Fn::Sub': '${Bucket.Arn}/d570/*' }, Principal: '*' }] });
});

test('launcher reads, lists and multipart work stay inside their declared prefixes', () => {
  const t = render(), launcher = statements(t, 'LauncherRole');
  assert.deepEqual(launcher.find(s => s.Sid === 'ReadObjects')?.Resource, ['ledger', 'health', 'payload', 'receipt'].map(p => ({ 'Fn::Sub': '${Bucket.Arn}/d570/' + p + '/*' })));
  const list = launcher.find(s => s.Sid === 'ListPrefixes');
  assert.equal(list?.Action, 's3:ListBucket');
  assert.deepEqual(list?.Resource, { 'Fn::GetAtt': ['Bucket', 'Arn'] });
  assert.deepEqual(list?.Condition.StringLike, { 's3:prefix': ['d570/ledger/*', 'd570/health/*', 'd570/payload/*', 'd570/receipt/*'] });
  const multipart = launcher.find(s => s.Sid === 'PayloadMultipart');
  assert.deepEqual(multipart?.Action, ['s3:AbortMultipartUpload', 's3:ListMultipartUploadParts']);
  assert.deepEqual(multipart?.Resource, { 'Fn::Sub': '${Bucket.Arn}/d570/payload/*' });
});

test('approval policy and rendered template retain the same owner limits', () => {
  const policy = JSON.parse(readFileSync(new URL('./policy.json', import.meta.url)));
  const t = render();
  assert.equal(policy.monthlyCapUsd, Number(t.Outputs.MonthlyCapUsd.Value));
  assert.equal(policy.instanceType, resource(t, 'LaunchTemplate').LaunchTemplateData.InstanceType);
  assert.equal(policy.sessionSeconds, resource(t, 'LauncherRole').MaxSessionDuration);
  assert.equal(policy.accessExpiry, t.Outputs.AccessExpiry.Value);
  assert.equal(policy.approvedBaselineUsd, 0);
  assert.equal(policy.admission, t.Outputs.Admission.Value);
  assert.equal(policy.forbiddenAccount, '949687825720');
});

test('already assumed launcher sessions lose every granted action at the approved expiry', () => {
  for (const statement of statements(render(), 'LauncherRole').filter(s => s.Effect === 'Allow')) {
    assert.deepEqual(statement.Condition?.DateLessThan, { 'aws:CurrentTime': '2027-02-28T23:59:00Z' }, statement.Sid);
  }
});

test('serialized Lambda requests actual termination and volume deletion before publishing health', async () => {
  const calls = [], stackId = 'arn:aws:cloudformation:eu-south-2:462991287391:stack/d570/00000000-0000-4000-8000-000000000000';
  const tags = Object.entries({ Proof: 'D570', Stack: stackId, Run: '11111111-1111-4111-8111-111111111111', ExpiresAt: '2026-11-05T19:00:00Z' }).map(([Key, Value]) => ({ Key, Value }));
  class Client {
    constructor(options) { assert.equal(options.region, 'eu-south-2'); assert.equal(options.maxAttempts, 3); }
    async send(command) {
      calls.push(command);
      if (command.name === 'DescribeInstances') return withRootMappings(this, { Reservations: [{ Instances: [{ InstanceId: 'i-0123456789abcdef0', State: { Name: 'running' }, LaunchTime: new Date('2026-11-05T18:00:00Z'), NetworkInterfaces: [{ Attachment: { DeviceIndex: 0, AttachTime: new Date('2026-11-05T18:00:00Z') } }], Tags: tags }] }] });
      if (command.name === 'DescribeVolumes' && command.input.VolumeIds) return { Volumes: command.input.VolumeIds.map(id => this.rootDisks.get(id)) };
      if (command.name === 'DescribeVolumes') return { Volumes: [{ VolumeId: 'vol-0123456789abcdef0', State: 'available', CreateTime: new Date('2026-11-05T18:00:00Z'), Attachments: [], Tags: tags }] };
      if (command.name === 'TerminateInstances') {
        assert.deepEqual(JSON.parse(JSON.stringify(command.input)), { InstanceIds: ['i-0123456789abcdef0'] });
        return { TerminatingInstances: [{ InstanceId: 'i-0123456789abcdef0', CurrentState: { Name: 'shutting-down' } }] };
      }
      if (command.name === 'DeleteVolume') { assert.equal(command.input.VolumeId, 'vol-0123456789abcdef0'); return {}; }
      if (command.name === 'PutObject') return {};
      throw new Error('Wrong SDK operation');
    }
  }
  const command = name => class { constructor(input) { this.name = name; this.input = input; } };
  class Clock extends Date { static now() { return Date.parse('2026-11-05T20:00:00Z'); } }
  const exports = {};
  vm.runInNewContext(resource(render(), 'ExpiryFunction').Code.ZipFile, { exports, Date: Clock, process: { env: { AWS_REGION: 'eu-south-2', ACCOUNT: '462991287391', STACK_ID: stackId, BUCKET: 'd570-synthetic', ACCESS_EXPIRY: resource(render(), 'ExpiryFunction').Environment.Variables.ACCESS_EXPIRY } }, require(name) {
    if (name === '@aws-sdk/client-ec2') return { EC2Client: Client, ...Object.fromEntries(['DescribeInstances', 'DescribeVolumes', 'TerminateInstances', 'DeleteVolume'].map(n => [`${n}Command`, command(n)])) };
    if (name === '@aws-sdk/client-s3') return { S3Client: Client, PutObjectCommand: command('PutObject') };
    throw new Error('Unexpected import');
  } });
  const result = await exports.handler();
  assert.deepEqual(calls.map(c => c.name), ['DescribeInstances', 'DescribeVolumes', 'DescribeVolumes', 'TerminateInstances', 'DeleteVolume', 'PutObject']);
  assert.deepEqual(JSON.parse(JSON.stringify(result.terminationRequested)), ['i-0123456789abcdef0']);
  assert.deepEqual(JSON.parse(JSON.stringify(result.volumeDeletionRequested)), ['vol-0123456789abcdef0']);
});

test('serialized Lambda continues owned cleanup after an SDK refusal but publishes no healthy heartbeat', async () => {
  const calls = [], failure = new Error('synthetic termination refused');
  const stackId = 'arn:aws:cloudformation:eu-south-2:462991287391:stack/d570/00000000-0000-4000-8000-000000000000';
  const tags = Object.entries({ Proof: 'D570', Stack: stackId, Run: '11111111-1111-4111-8111-111111111111', ExpiresAt: '2026-11-05T19:00:00Z' }).map(([Key, Value]) => ({ Key, Value }));
  class Client {
    async send(command) {
      calls.push({ name: command.name, input: JSON.parse(JSON.stringify(command.input)) });
      if (command.name === 'DescribeInstances') return withRootMappings(this, { Reservations: [{ Instances: ['i-0123456789abcdef0', 'i-11111111111111111'].map(InstanceId => ({ InstanceId, State: { Name: 'running' }, LaunchTime: new Date('2026-11-05T18:00:00Z'), NetworkInterfaces: [{ Attachment: { DeviceIndex: 0, AttachTime: new Date('2026-11-05T18:00:00Z') } }], Tags: tags })) }] });
      if (command.name === 'DescribeVolumes' && command.input.VolumeIds) return { Volumes: command.input.VolumeIds.map(id => this.rootDisks.get(id)) };
      if (command.name === 'DescribeVolumes') return { Volumes: [{ VolumeId: 'vol-0123456789abcdef0', State: 'available', CreateTime: new Date('2026-11-05T18:00:00Z'), Attachments: [], Tags: tags }] };
      if (command.name === 'TerminateInstances') {
        if (command.input.InstanceIds[0] === 'i-0123456789abcdef0') throw failure;
        return { TerminatingInstances: [{ InstanceId: 'i-11111111111111111', CurrentState: { Name: 'shutting-down' } }] };
      }
      if (command.name === 'DeleteVolume' || command.name === 'PutObject') return {};
      throw new Error('Unexpected SDK operation');
    }
  }
  const command = name => class { constructor(input) { this.name = name; this.input = input; } };
  class Clock extends Date { static now() { return Date.parse('2026-11-05T20:00:00Z'); } }
  const exports = {};
  vm.runInNewContext(resource(render(), 'ExpiryFunction').Code.ZipFile, { exports, Date: Clock, process: { env: { AWS_REGION: 'eu-south-2', ACCOUNT: '462991287391', STACK_ID: stackId, BUCKET: 'd570-synthetic', ACCESS_EXPIRY: resource(render(), 'ExpiryFunction').Environment.Variables.ACCESS_EXPIRY } }, require(name) {
    if (name === '@aws-sdk/client-ec2') return { EC2Client: Client, ...Object.fromEntries(['DescribeInstances', 'DescribeVolumes', 'TerminateInstances', 'DeleteVolume'].map(n => [`${n}Command`, command(n)])) };
    if (name === '@aws-sdk/client-s3') return { S3Client: Client, PutObjectCommand: command('PutObject') };
    throw new Error('Unexpected import');
  } });
  await assert.rejects(exports.handler(), error => error === failure);
  assert.deepEqual(calls.slice(2), [
    { name: 'DescribeVolumes', input: { VolumeIds: ['vol-8123456789abcdef0'] } },
    { name: 'TerminateInstances', input: { InstanceIds: ['i-0123456789abcdef0'] } },
    { name: 'DescribeVolumes', input: { VolumeIds: ['vol-91111111111111111'] } },
    { name: 'TerminateInstances', input: { InstanceIds: ['i-11111111111111111'] } },
    { name: 'DeleteVolume', input: { VolumeId: 'vol-0123456789abcdef0' } },
  ]);
});

function renderedSweepFixture({ instances, volumes, instant = '2026-11-05T20:00:00Z', afterReadMs = 0, rootVolumes }) {
  let clock = Date.parse(instant);
  const calls = [], stackId = 'arn:aws:cloudformation:eu-south-2:462991287391:stack/d570/00000000-0000-4000-8000-000000000000';
  class Client {
    async send(command) {
      calls.push({ name: command.name, input: JSON.parse(JSON.stringify(command.input)) });
      if (command.name === 'DescribeInstances') { clock += afterReadMs; return withRootMappings(this, { Reservations: [{ Instances: structuredClone(instances) }] }); }
      if (command.name === 'DescribeVolumes' && command.input.VolumeIds) return { Volumes: rootVolumes ?? command.input.VolumeIds.map(id => this.rootDisks.get(id)) };
      if (command.name === 'DescribeVolumes') return { Volumes: volumes };
      if (command.name === 'TerminateInstances') return { TerminatingInstances: command.input.InstanceIds.map(InstanceId => ({ InstanceId, CurrentState: { Name: 'shutting-down' } })) };
      if (command.name === 'DeleteVolume' || command.name === 'PutObject') return {};
      throw new Error('Unexpected SDK operation');
    }
  }
  const command = name => class { constructor(input) { this.name = name; this.input = input; } };
  class Clock extends Date { static now() { return clock; } }
  const exports = {}, fn = resource(render(), 'ExpiryFunction');
  vm.runInNewContext(fn.Code.ZipFile, { exports, Date: Clock, process: { env: { AWS_REGION: 'eu-south-2', ACCOUNT: '462991287391', STACK_ID: stackId, BUCKET: 'd570-synthetic', ACCESS_EXPIRY: fn.Environment.Variables.ACCESS_EXPIRY } }, require(name) {
    if (name === '@aws-sdk/client-ec2') return { EC2Client: Client, ...Object.fromEntries(['DescribeInstances', 'DescribeVolumes', 'TerminateInstances', 'DeleteVolume'].map(n => [`${n}Command`, command(n)])) };
    if (name === '@aws-sdk/client-s3') return { S3Client: Client, PutObjectCommand: command('PutObject') };
    throw new Error('Unexpected import');
  } });
  return { calls, handler: exports.handler };
}

test('rendered Lambda isolates malformed run ownership and preserves independent cleanup', async () => {
  const stack = 'arn:aws:cloudformation:eu-south-2:462991287391:stack/d570/00000000-0000-4000-8000-000000000000';
  const tags = (run, proof = 'D570') => Object.entries({ Proof: proof, Stack: stack, Run: run, ExpiresAt: '2026-11-05T19:59:59Z' }).map(([Key, Value]) => ({ Key, Value }));
  const owned = '11111111-1111-4111-8111-111111111111', began = new Date('2026-11-05T19:00:00Z');
  const f = renderedSweepFixture({ instances: [
    { InstanceId: 'i-0123456789abcdef0', State: { Name: 'running' }, Tags: tags('unknown') },
    { InstanceId: 'i-11111111111111111', State: { Name: 'running' }, LaunchTime: began, NetworkInterfaces: [{ Attachment: { DeviceIndex: 0, AttachTime: began } }], Tags: tags(owned) },
  ], volumes: [
    { VolumeId: 'vol-0123456789abcdef0', State: 'available', Attachments: [], CreateTime: began, Tags: tags('unknown') },
    { VolumeId: 'vol-11111111111111111', State: 'available', Attachments: [], CreateTime: began, Tags: tags(owned) },
    { VolumeId: 'vol-22222222222222222', State: 'available', Attachments: [], CreateTime: began, Tags: tags(owned, 'FOREIGN') },
  ] });
  await assert.rejects(f.handler(), /ownership/);
  assert.deepEqual(f.calls.slice(2), [
    { name: 'DescribeVolumes', input: { VolumeIds: ['vol-91111111111111111'] } },
    { name: 'TerminateInstances', input: { InstanceIds: ['i-11111111111111111'] } },
    { name: 'DeleteVolume', input: { VolumeId: 'vol-11111111111111111' } },
  ]);
});

test('rendered Lambda enforces both original lifetime and configured access expiry without a heartbeat', async () => {
  const stack = 'arn:aws:cloudformation:eu-south-2:462991287391:stack/d570/00000000-0000-4000-8000-000000000000';
  for (const scenario of [
    { initial: '2026-11-05T19:00:00Z', latest: '2026-11-05T19:00:00Z', expiry: '2026-11-05T21:15:00.001Z', instant: '2026-11-05T20:00:00Z' },
    { initial: '2026-11-05T17:00:00Z', latest: '2026-11-05T19:59:00Z', expiry: '2026-11-05T20:01:00Z', instant: '2026-11-05T20:00:00Z' },
    { initial: '2027-02-28T23:00:00Z', latest: '2027-02-28T23:00:00Z', expiry: '2027-02-28T23:59:00.001Z', instant: '2027-02-28T23:59:00Z' },
  ]) {
    const tags = Object.entries({ Proof: 'D570', Stack: stack, Run: '11111111-1111-4111-8111-111111111111', ExpiresAt: scenario.expiry }).map(([Key, Value]) => ({ Key, Value }));
    const f = renderedSweepFixture({ instant: scenario.instant,
      instances: [{ InstanceId: 'i-0123456789abcdef0', State: { Name: 'running' }, Tags: tags, LaunchTime: new Date(scenario.latest), NetworkInterfaces: [{ Attachment: { DeviceIndex: 0, AttachTime: new Date(scenario.initial) } }] }],
      volumes: [{ VolumeId: 'vol-0123456789abcdef0', State: 'available', Attachments: [], Tags: tags, CreateTime: new Date(scenario.initial) }] });
    await assert.rejects(f.handler(), /lifetime/);
    assert.deepEqual(f.calls.slice(2).map(c => c.name), ['DescribeVolumes', 'TerminateInstances', 'DeleteVolume']);
  }
});

test('rendered Lambda preserves a healthy resource created while its inventory request is in flight', async () => {
  const stack = 'arn:aws:cloudformation:eu-south-2:462991287391:stack/d570/00000000-0000-4000-8000-000000000000';
  const began = new Date('2026-11-05T20:00:01Z');
  const tags = Object.entries({ Proof: 'D570', Stack: stack, Run: '11111111-1111-4111-8111-111111111111', ExpiresAt: '2026-11-05T20:10:00Z' }).map(([Key, Value]) => ({ Key, Value }));
  const f = renderedSweepFixture({ afterReadMs: 2000,
    instances: [{ InstanceId: 'i-0123456789abcdef0', State: { Name: 'running' }, Tags: tags, LaunchTime: began, NetworkInterfaces: [{ Attachment: { DeviceIndex: 0, AttachTime: began } }] }],
    volumes: [{ VolumeId: 'vol-0123456789abcdef0', State: 'available', Attachments: [], Tags: tags, CreateTime: began }] });
  const pending = f.handler();
  await assert.doesNotReject(pending);
  const result = await pending;
  assert.deepEqual(f.calls.map(c => c.name), ['DescribeInstances', 'DescribeVolumes', 'PutObject']);
  assert.equal(result.completedAt, '2026-11-05T20:00:02.000Z');
});

test('rendered Lambda withholds termination when its root disk has uncertain ownership', async () => {
  const stack = 'arn:aws:cloudformation:eu-south-2:462991287391:stack/d570/00000000-0000-4000-8000-000000000000';
  const tags = run => Object.entries({ Proof: 'D570', Stack: stack, Run: run, ExpiresAt: '2026-11-05T19:59:59Z' }).map(([Key, Value]) => ({ Key, Value }));
  const owned = tags('11111111-1111-4111-8111-111111111111'), began = new Date('2026-11-05T19:00:00Z');
  const f = renderedSweepFixture({
    instances: [{ InstanceId: 'i-0123456789abcdef0', State: { Name: 'running' }, Tags: owned, LaunchTime: began, NetworkInterfaces: [{ Attachment: { DeviceIndex: 0, AttachTime: began } }] }],
    volumes: [{ VolumeId: 'vol-11111111111111111', State: 'available', Attachments: [], Tags: owned, CreateTime: began }],
    rootVolumes: [{ VolumeId: 'vol-8123456789abcdef0', State: 'in-use', Tags: tags('unknown'), Attachments: [{ InstanceId: 'i-0123456789abcdef0', Device: '/dev/xvda', State: 'attached' }] }],
  });
  await assert.rejects(f.handler(), /ownership/);
  assert.deepEqual(f.calls.slice(2), [
    { name: 'DescribeVolumes', input: { VolumeIds: ['vol-8123456789abcdef0'] } },
    { name: 'DeleteVolume', input: { VolumeId: 'vol-11111111111111111' } },
  ]);
});
