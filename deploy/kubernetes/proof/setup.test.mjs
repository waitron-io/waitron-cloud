import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import vm from 'node:vm';

const module = await import('./setup.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const inputs = () => ({
  account: '462991287391', region: 'eu-south-2', now: '2026-11-05T20:00:00Z',
  repository: { fullName: 'waitron-io/waitron-cloud', id: 1381507078, ownerId: 332029685 },
  oidcProviderArn: 'arn:aws:iam::462991287391:oidc-provider/token.actions.githubusercontent.com',
  image: { ImageId: 'ami-0123456789abcdef0', OwnerId: '137112412989', Architecture: 'arm64', State: 'available', Public: true, RootDeviceType: 'ebs', VirtualizationType: 'hvm' },
  s3PrefixListId: 'pl-0123456789abcdef0',
});
function render(input = inputs()) {
  assert.equal(typeof module.renderSetup, 'function', 'reviewable setup template compiler is missing');
  return module.renderSetup(input);
}
const resource = (t, name) => t.Resources[name].Properties;
const statements = (t, name) => resource(t, name).Policies.flatMap(p => p.PolicyDocument.Statement);

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

test('shared OIDC provider is referenced conditionally and survives stack removal', () => {
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
  vm.runInNewContext(source, { exports, process: { env: { AWS_REGION: 'eu-south-2', ACCOUNT: '462991287391', STACK_ID: 'arn:aws:cloudformation:eu-south-2:462991287391:stack/d570/00000000-0000-4000-8000-000000000000', BUCKET: 'd570-synthetic' } }, require(name) {
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
