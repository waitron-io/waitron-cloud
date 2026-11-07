import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { realpath, mkdtemp, writeFile, lstat, readFile, rm, mkdir, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { join, dirname, basename, resolve } from 'node:path';
import { promisify, isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { renderManualSetup } from '../deploy/kubernetes/proof/setup.mjs';
import policy from '../deploy/kubernetes/proof/policy.json' with { type: 'json' };
import { inspectBudget, initializeLedger, reserveRun, createS3LedgerStore } from './kubernetes-proof-budget.mjs';
import { calculateManualCost } from '../deploy/kubernetes/proof/prices.mjs';
import { renderDeadlineBootstrap } from '../deploy/kubernetes/proof/bootstrap.mjs';

const execute = promisify(execFile);
const account = '462991287391', region = 'eu-north-1';
const refuse = () => { throw new Error('D570 controller refused'); };
const check = value => { if (!value) refuse(); };
const iso = instant => new Date(instant).toISOString().replace('.000Z', 'Z');
function instant(value) {
  check(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value));
  const result = Date.parse(value);
  check(Number.isFinite(result) && iso(result) === value);
  return result;
}

export function createManualAwsCli({ executable = 'aws' } = {}) {
  return { async call(service, operation, input) {
    check((service === 'sts' && operation === 'get-caller-identity')
      || (service === 'ce' && operation === 'get-cost-and-usage')
      || (service === 'cloudformation' && ['describe-stacks', 'describe-stack-resources', 'create-stack'].includes(operation))
      || (service === 'events' && ['describe-rule', 'list-targets-by-rule', 'enable-rule'].includes(operation))
      || (service === 's3api' && ['get-object', 'put-object', 'list-objects-v2'].includes(operation))
      || (service === 'ssm' && operation === 'get-parameter')
      || (service === 'ec2' && ['describe-images', 'describe-instance-types', 'describe-managed-prefix-lists',
        'describe-launch-template-versions', 'run-instances', 'describe-instances',
        'describe-instance-attribute', 'get-console-output', 'describe-volumes', 'describe-network-interfaces'].includes(operation)));
    if (service === 'ec2' && operation === 'describe-launch-template-versions') check(input
      && Object.keys(input).sort().join(',') === 'LaunchTemplateId,Versions'
      && typeof input.LaunchTemplateId === 'string' && /^lt-[a-f0-9]{17}$/.test(input.LaunchTemplateId)
      && isDeepStrictEqual(input.Versions, ['1']));
    if (service === 'ec2' && operation === 'run-instances') {
      check(input && Object.keys(input).sort().join(',') === 'ClientToken,LaunchTemplate,MaxCount,MinCount,TagSpecifications,UserData'
        && typeof input.ClientToken === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.ClientToken)
        && input.MinCount === 1 && input.MaxCount === 1 && input.LaunchTemplate
        && Object.keys(input.LaunchTemplate).sort().join(',') === 'LaunchTemplateId,Version'
        && /^lt-[a-f0-9]{17}$/.test(input.LaunchTemplate.LaunchTemplateId) && input.LaunchTemplate.Version === '1'
        && typeof input.UserData === 'string' && input.UserData.length > 0 && input.UserData.length <= 21848
        && Buffer.from(input.UserData, 'base64').toString('base64') === input.UserData
        && Buffer.from(input.UserData, 'base64').length <= 16384
        && Array.isArray(input.TagSpecifications) && input.TagSpecifications.length === 2);
      const first = input.TagSpecifications[0], second = input.TagSpecifications[1];
      check(first?.ResourceType === 'instance' && second?.ResourceType === 'volume'
        && Object.keys(first).sort().join(',') === 'ResourceType,Tags'
        && Object.keys(second).sort().join(',') === 'ResourceType,Tags'
        && isDeepStrictEqual(first.Tags, second.Tags) && Array.isArray(first.Tags) && first.Tags.length === 4);
      const tags = first.Tags;
      check(tags.every(row => row && Object.keys(row).sort().join(',') === 'Key,Value')
        && tags[0].Key === 'Proof' && tags[0].Value === 'D570'
        && tags[1].Key === 'Stack' && typeof tags[1].Value === 'string'
        && /^arn:aws:cloudformation:eu-north-1:462991287391:stack\/d570-first\/[a-f0-9-]{36}$/.test(tags[1].Value)
        && tags[2].Key === 'Run' && tags[2].Value === input.ClientToken
        && tags[3].Key === 'ExpiresAt' && instant(tags[3].Value) <= Date.parse(policy.accessExpiry));
    }
    if (service === 'cloudformation' && operation === 'create-stack') {
      check(input && Object.keys(input).sort().join(',') === 'Capabilities,ClientRequestToken,OnFailure,StackName,Tags,TemplateBody,TimeoutInMinutes'
        && input.StackName === 'd570-first' && typeof input.TemplateBody === 'string'
        && Buffer.byteLength(input.TemplateBody) > 0 && Buffer.byteLength(input.TemplateBody) <= 51200
        && JSON.stringify(input.Capabilities) === '["CAPABILITY_IAM"]'
        && JSON.stringify(input.Tags) === '[{"Key":"Proof","Value":"D570"}]'
        && input.TimeoutInMinutes === 10 && input.OnFailure === 'ROLLBACK'
        && typeof input.ClientRequestToken === 'string' && /^d570-[a-f0-9]{64}$/.test(input.ClientRequestToken));
    }
    if (service === 'events' && operation === 'enable-rule') check(input
      && Object.keys(input).sort().join(',') === 'EventBusName,Name' && input.EventBusName === 'default'
      && typeof input.Name === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(input.Name));
    const download = service === 's3api' && operation === 'get-object';
    const upload = service === 's3api' && operation === 'put-object';
    const ledgerKey = key => typeof key === 'string'
      && (key === 'd570/ledger/active.json' || /^d570\/ledger\/\d{4}-(0[1-9]|1[0-2])\.json$/.test(key));
    if (service === 's3api') {
      check(input && typeof input.Bucket === 'string' && /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(input.Bucket)
        && input.ExpectedBucketOwner === account);
      const keys = names => Object.keys(input).sort().join(',') === names.sort().join(',');
      if (download) check(keys(['Bucket', 'ExpectedBucketOwner', 'Key', 'Range'])
        && (input.Key === 'd570/health/reaper.json' || ledgerKey(input.Key)) && input.Range === 'bytes=0-1048576');
      else if (upload) {
        const conditional = input.IfNoneMatch === '*' ? 'IfNoneMatch' : 'IfMatch';
        check(keys(['Bucket', 'ExpectedBucketOwner', 'Key', 'Body', 'ContentType', 'ServerSideEncryption', conditional])
          && ledgerKey(input.Key) && input.Body instanceof Uint8Array && input.Body.byteLength > 0 && input.Body.byteLength <= 1024 * 1024
          && input.ContentType === 'application/json' && input.ServerSideEncryption === 'AES256'
          && (conditional === 'IfNoneMatch' || typeof input.IfMatch === 'string' && /^"[\x21\x23-\x7e]{1,254}"$/.test(input.IfMatch)));
      } else check(keys(['Bucket', 'ExpectedBucketOwner', 'Prefix', 'MaxKeys', ...(Object.hasOwn(input, 'ContinuationToken') ? ['ContinuationToken'] : [])])
        && input.Prefix === 'd570/ledger/' && input.MaxKeys === 100
        && (!Object.hasOwn(input, 'ContinuationToken') || typeof input.ContinuationToken === 'string'
          && input.ContinuationToken.length > 0 && input.ContinuationToken.length <= 2048));
    }
    // EC2's CLI encoder needs plain text; the controller retains the API's base64 representation.
    const payload = JSON.stringify(upload ? { ...input, Body: undefined }
      : service === 'ec2' && operation === 'run-instances' ? { ...input, UserData: Buffer.from(input.UserData, 'base64').toString('utf8') } : input);
    check(typeof payload === 'string' && Buffer.byteLength(payload) <= 64 * 1024);
    let directory;
    try {
      let output;
      if (download || upload) {
        directory = await mkdtemp(join(tmpdir(), 'd570-object-'));
        output = join(directory, 'object.json');
        await writeFile(output, upload ? input.Body : '', { mode: 0o600, flag: 'wx' });
      }
      const { stdout } = await execute(executable, [service, operation,
        ...(download ? ['--bucket', input.Bucket, '--key', input.Key, '--expected-bucket-owner', input.ExpectedBucketOwner,
          '--range', input.Range] : ['--cli-input-json', payload]),
        '--region', service === 'ce' ? 'us-east-1' : region, '--output', 'json', '--no-paginate', '--no-cli-pager',
        '--cli-connect-timeout', '5', '--cli-read-timeout', '15', ...(download ? [output] : upload ? ['--body', output] : [])], {
        timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
        env: { ...process.env, AWS_MAX_ATTEMPTS: '3', AWS_RETRY_MODE: 'standard',
          AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true', AWS_EC2_METADATA_DISABLED: 'true', AWS_PAGER: '' },
      });
      const metadata = service === 'events' && operation === 'enable-rule' && stdout.trim() === '' ? {} : JSON.parse(stdout);
      if (!download) return metadata;
      const file = await lstat(output);
      check(file.isFile() && file.size > 0 && file.size <= 1024 * 1024 && (file.mode & 0o777) === 0o600
        && Number.isSafeInteger(metadata.ContentLength) && metadata.ContentLength === file.size
        && metadata.ContentRange === `bytes 0-${file.size - 1}/${file.size}`
        && (input.Key === 'd570/health/reaper.json'
          || metadata.ServerSideEncryption === 'AES256' && metadata.ContentType === 'application/json'));
      const body = await readFile(output);
      check(body.byteLength === file.size);
      const modified = typeof metadata.LastModified === 'string' ? metadata.LastModified.replace('+00:00', 'Z') : '';
      check(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(modified)
        && Number.isFinite(Date.parse(modified)) && new Date(modified).toISOString().replace('.000Z', 'Z') === modified.replace('.000Z', 'Z'));
      return { ...metadata, LastModified: new Date(modified).toISOString().replace('.000Z', 'Z'), Body: body };
    } catch (error) {
      // Only the CLI's exact missing-key response is absence; denied and uncertain reads preserve history.
      if (download && (ledgerKey(input.Key) || input.Key === 'd570/health/reaper.json') && error.code === 254 && !error.killed
        && typeof error.stderr === 'string'
        && /^\s*(?:aws: \[ERROR\]: )?An error occurred \(NoSuchKey\) when calling the GetObject operation: [^\r\n]*(?:\r?\n)?$/.test(error.stderr)) {
        const missing = new Error('D570 ledger key is absent');
        missing.name = 'NoSuchKey'; missing.$metadata = { httpStatusCode: 404 }; throw missing;
      }
      throw new Error(`D570 AWS ${service}/${operation} failed`);
    }
    finally { if (directory) await rm(directory, { recursive: true, force: true }); }
  } };
}

async function checkedMain(checkout) {
  const cwd = await realpath(checkout);
  async function git(...args) {
    try {
      const { stdout } = await execute('git', args, { cwd, encoding: 'utf8', timeout: 30_000,
        killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
      return stdout.trim();
    } catch { refuse(); }
  }
  check(await realpath(await git('rev-parse', '--show-toplevel')) === cwd);
  check(await git('symbolic-ref', '--short', 'HEAD') === 'main');
  check(await git('status', '--porcelain=v1', '--untracked-files=all') === '');
  check(['https://github.com/waitron-io/waitron-cloud.git', 'git@github.com:waitron-io/waitron-cloud.git']
    .includes(await git('config', '--get', 'remote.origin.url')));
  const head = await git('rev-parse', 'HEAD'), tree = await git('rev-parse', 'HEAD^{tree}');
  check(/^[a-f0-9]{40}$/.test(head) && /^[a-f0-9]{40}$/.test(tree));
  check(await git('rev-parse', 'refs/remotes/origin/main') === head);
  check(await git('ls-remote', '--exit-code', 'origin', 'refs/heads/main') === `${head}\trefs/heads/main`);
  return { head, tree };
}

function billingObservation(response, period, now) {
  check(response && !response.NextPageToken && Array.isArray(response.GroupDefinitions)
    && response.GroupDefinitions.length === 0 && Array.isArray(response.ResultsByTime) && response.ResultsByTime.length === 1);
  const row = response.ResultsByTime[0], total = row?.Total?.UnblendedCost;
  check(row?.TimePeriod?.Start === period.Start && row.TimePeriod.End === period.End
    && typeof row.Estimated === 'boolean' && Array.isArray(row.Groups) && row.Groups.length === 0
    && total?.Unit === 'USD' && typeof total.Amount === 'string' && /^(0|[1-9]\d{0,9})(\.\d{1,10})?$/.test(total.Amount));
  const [whole, fraction = ''] = total.Amount.split('.');
  const nanos = BigInt(whole + fraction.padEnd(10, '0'));
  const microUsd = Number((nanos + 9999n) / 10000n);
  check(Number.isSafeInteger(microUsd) && microUsd < 10_000_000);
  // Current-month estimates do not establish reconciled billing or release cost ownership.
  return { observedAt: now, period, microUsd, estimated: row.Estimated };
}

export async function inspectManualControl({ checkout, region: requestedRegion, now, aws, environment = process.env, clock = Date.now }) {
  check(requestedRegion === region && !environment.GITHUB_ACTIONS && !environment.GITHUB_EVENT_NAME);
  const current = instant(now);
  check(current < Date.parse('2027-02-28T23:59:00Z') && typeof aws?.call === 'function');
  const fresh = () => {
    const at = clock();
    check(Number.isSafeInteger(at) && at >= current && at < Date.parse('2027-02-28T23:59:00Z')
      && iso(at).slice(0, 10) === now.slice(0, 10));
  };
  fresh();
  const source = await checkedMain(checkout);
  fresh();
  const identity = await aws.call('sts', 'get-caller-identity', {});
  check(identity?.Account === account && typeof identity.Arn === 'string'
    && /^arn:aws:sts::462991287391:assumed-role\/[\w+=,.@/-]+\/[\w+=,.@-]+$/.test(identity.Arn));
  fresh();
  check(JSON.stringify(await checkedMain(checkout)) === JSON.stringify(source));
  fresh();
  const period = { Start: now.slice(0, 7) + '-01', End: iso(current + 86400_000).slice(0, 10) };
  const response = await aws.call('ce', 'get-cost-and-usage', { TimePeriod: period, Granularity: 'MONTHLY',
    Metrics: ['UnblendedCost'], Filter: { Dimensions: { Key: 'LINKED_ACCOUNT', Values: [account] } } });
  fresh();
  check(JSON.stringify(await checkedMain(checkout)) === JSON.stringify(source));
  fresh();
  return { account, region, ...source, billing: billingObservation(response, period, now) };
}

export async function inspectManualSetup(options) {
  const inspection = await inspectManualControl(options), { aws, now, checkout, clock = Date.now } = options;
  const source = { head: inspection.head, tree: inspection.tree };
  async function read(service, operation, input) {
    async function unchanged() {
      const at = clock();
      check(Number.isSafeInteger(at) && at >= instant(now) && at < Date.parse(policy.accessExpiry)
        && iso(at).slice(0, 10) === now.slice(0, 10));
      check(JSON.stringify(await checkedMain(checkout)) === JSON.stringify(source));
      const after = clock();
      check(Number.isSafeInteger(after) && after >= at && after < Date.parse(policy.accessExpiry)
        && iso(after).slice(0, 10) === now.slice(0, 10));
    }
    await unchanged();
    const response = await aws.call(service, operation, input);
    await unchanged();
    return response;
  }
  const parameterName = '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64';
  const parameter = (await read('ssm', 'get-parameter', { Name: parameterName, WithDecryption: false }))?.Parameter;
  check(parameter?.Name === parameterName && parameter.Type === 'String'
    && typeof parameter.Value === 'string' && /^ami-[a-f0-9]{17}$/.test(parameter.Value));
  const images = await read('ec2', 'describe-images', { ImageIds: [parameter.Value], Owners: [policy.officialImageOwner] });
  check(!images?.NextToken && Array.isArray(images?.Images) && images.Images.length === 1
    && images.Images[0]?.ImageId === parameter.Value);
  const input = { account, region, now, repository: { fullName: policy.repository, id: policy.repositoryId,
    ownerId: policy.repositoryOwnerId }, image: images.Images[0] };
  // Validate the provider image before any further discovery, using the renderer's same image contract.
  renderManualSetup({ ...input, s3PrefixListId: 'pl-00000000' });
  const types = await read('ec2', 'describe-instance-types', { InstanceTypes: [policy.instanceType] });
  check(!types?.NextToken && Array.isArray(types?.InstanceTypes) && types.InstanceTypes.length === 1);
  const machine = types.InstanceTypes[0];
  check(machine?.InstanceType === policy.instanceType && machine.MemoryInfo?.SizeInMiB === 32768
    && machine.VCpuInfo?.DefaultVCpus === 8 && Array.isArray(machine.ProcessorInfo?.SupportedArchitectures)
    && machine.ProcessorInfo.SupportedArchitectures.includes('arm64')
    && Array.isArray(machine.SupportedUsageClasses) && machine.SupportedUsageClasses.includes('on-demand'));
  const prefixName = `com.amazonaws.${region}.s3`;
  const prefixes = await read('ec2', 'describe-managed-prefix-lists', { Filters: [
    { Name: 'prefix-list-name', Values: [prefixName] }, { Name: 'owner-id', Values: ['AWS'] }] });
  check(!prefixes?.NextToken && Array.isArray(prefixes?.PrefixLists) && prefixes.PrefixLists.length === 1);
  const prefix = prefixes.PrefixLists[0];
  check(prefix?.OwnerId === 'AWS' && prefix.PrefixListName === prefixName && prefix.AddressFamily === 'IPv4');
  return { ...inspection, template: renderManualSetup({ ...input, s3PrefixListId: prefix.PrefixListId }) };
}

async function readManualProtection(read, stackId, states) {
  const described = await read('cloudformation', 'describe-stacks', { StackName: stackId });
  check(!described?.NextToken && Array.isArray(described?.Stacks) && described.Stacks.length === 1
    && described.Stacks[0]?.StackId === stackId
    && ['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(described.Stacks[0].StackStatus));
  const inventory = await read('cloudformation', 'describe-stack-resources', { StackName: stackId });
  check(!inventory?.NextToken && Array.isArray(inventory?.StackResources) && inventory.StackResources.length <= 100);
  function resource(logicalId, type, pattern) {
    const rows = inventory.StackResources.filter(row => row?.LogicalResourceId === logicalId);
    check(rows.length === 1 && rows[0].StackId === stackId && rows[0].ResourceType === type
      && ['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(rows[0].ResourceStatus)
      && typeof rows[0].PhysicalResourceId === 'string' && pattern.test(rows[0].PhysicalResourceId));
    return rows[0].PhysicalResourceId;
  }
  const bucket = resource('Bucket', 'AWS::S3::Bucket', /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/);
  const ruleName = resource('ExpiryRule', 'AWS::Events::Rule', /^[A-Za-z0-9_.-]{1,64}$/);
  const functionName = resource('ExpiryFunction', 'AWS::Lambda::Function', /^[A-Za-z0-9_-]{1,64}$/);
  const rule = await read('events', 'describe-rule', { Name: ruleName, EventBusName: 'default' });
  check(rule?.Name === ruleName && rule.Arn === `arn:aws:events:${region}:${account}:rule/${ruleName}`
    && states.includes(rule.State) && rule.ScheduleExpression === 'rate(1 minute)'
    && rule.EventBusName === 'default' && !rule.EventPattern);
  const targets = await read('events', 'list-targets-by-rule', { Rule: ruleName, EventBusName: 'default', Limit: 100 });
  check(!targets?.NextToken && Array.isArray(targets?.Targets) && targets.Targets.length === 1);
  const target = targets.Targets[0];
  check(target?.Id === 'D570Expiry' && target.Arn === `arn:aws:lambda:${region}:${account}:function:${functionName}`
    && target.RetryPolicy?.MaximumEventAgeInSeconds === 60 && target.RetryPolicy.MaximumRetryAttempts === 0
    && !Object.hasOwn(target, 'Input') && !Object.hasOwn(target, 'InputPath') && !Object.hasOwn(target, 'InputTransformer'));
  return { bucket, ruleName };
}

export async function inspectManualProtection(options) {
  const { stackId, checkout, aws, now, clock = Date.now } = options;
  check(typeof stackId === 'string'
    && /^arn:aws:cloudformation:eu-north-1:462991287391:stack\/d570[-a-z0-9]*\/[a-f0-9-]{36}$/.test(stackId));
  const inspection = await inspectManualControl(options);
  async function unchanged() {
    const at = clock();
    check(Number.isSafeInteger(at) && at >= instant(now) && at < Date.parse(policy.accessExpiry)
      && iso(at).slice(0, 10) === now.slice(0, 10));
    const source = await checkedMain(checkout);
    check(source.head === inspection.head && source.tree === inspection.tree);
    const after = clock();
    check(Number.isSafeInteger(after) && after >= at && after < Date.parse(policy.accessExpiry)
      && iso(after).slice(0, 10) === now.slice(0, 10));
  }
  async function read(service, operation, input) {
    await unchanged();
    const result = await aws.call(service, operation, input);
    await unchanged();
    return result;
  }
  const { bucket } = await readManualProtection(read, stackId, ['ENABLED']);
  const object = await read('s3api', 'get-object', { Bucket: bucket, Key: 'd570/health/reaper.json',
    ExpectedBucketOwner: account, Range: 'bytes=0-1048576' });
  check(object?.Body instanceof Uint8Array && object.Body.byteLength > 0 && object.Body.byteLength <= 1024 * 1024
    && object.ServerSideEncryption === 'AES256' && object.ContentType === 'application/json');
  let heartbeat;
  try { heartbeat = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(object.Body)); } catch { refuse(); }
  check(heartbeat?.schema === 'd570-sweep-v1' && heartbeat.account === account
    && heartbeat.region === region && heartbeat.stackId === stackId);
  function serviceTime(value) {
    check(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value));
    const parsed = Date.parse(value);
    check(Number.isSafeInteger(parsed) && new Date(parsed).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z'));
    return parsed;
  }
  const started = serviceTime(heartbeat.startedAt), completed = serviceTime(heartbeat.completedAt);
  const modified = serviceTime(object.LastModified), observed = clock();
  check(Number.isSafeInteger(observed) && observed >= instant(now) && observed < Date.parse(policy.accessExpiry)
    && started <= completed && completed <= observed && observed - started < 120_000
    && modified >= Math.floor(completed / 1000) * 1000 && modified <= observed && observed - modified < 120_000);
  for (const [key, pattern] of [['terminationRequested', /^i-[a-f0-9]{17}$/], ['volumeDeletionRequested', /^vol-[a-f0-9]{17}$/]]) {
    const rows = heartbeat[key];
    check(Array.isArray(rows) && rows.length <= 2000 && new Set(rows).size === rows.length
      && rows.every(id => typeof id === 'string' && pattern.test(id)));
  }
  // Accepted sweep requests establish health only; separate live reads must establish cleanup.
  return { ...inspection, stackId, bucket, heartbeat };
}

export function createManualLedgerStore({ bucket, aws }) {
  check(typeof aws?.call === 'function');
  return createS3LedgerStore({ bucket, aws: { call(operation, input) {
    const operations = { GetObject: 'get-object', PutObject: 'put-object', ListObjectsV2: 'list-objects-v2' };
    check(Object.hasOwn(operations, operation));
    return aws.call('s3api', operations[operation], { ...input, ...(operation === 'GetObject' ? { Range: 'bytes=0-1048576' } : {}) });
  } } });
}

export async function inspectManualBudget(options) {
  const inspection = await inspectManualProtection(options);
  const { now, checkout, store, clock = Date.now } = options;
  const scope = { account, region, stackId: inspection.stackId };
  const liveStore = store ?? createManualLedgerStore({ bucket: inspection.bucket, aws: options.aws });
  const budget = await inspectBudget({ scope, now, billingMicroUsd: inspection.billing.microUsd, store: liveStore });
  const source = await checkedMain(checkout), observed = clock();
  check(source.head === inspection.head && source.tree === inspection.tree
    && Number.isSafeInteger(observed) && observed >= instant(now) && observed < Date.parse(policy.accessExpiry)
    && iso(observed).slice(0, 10) === now.slice(0, 10)
    && observed - Date.parse(inspection.heartbeat.startedAt) < 120_000);
  return { ...inspection, budget };
}

export async function bookManualSetup(options) {
  const { now, directory, clock = Date.now } = options;
  check(options.priceInputs === undefined || options.cost === undefined);
  const priceInputs = structuredClone(options.priceInputs);
  const cost = priceInputs === undefined ? structuredClone(options.cost)
    : calculateManualCost({ ...priceInputs, now });
  const categories = ['compute', 'disk', 'storage', 'requests', 'transfer', 'events', 'lambda', 'logs', 'network', 'tax', 'contingency'];
  check(cost && Object.keys(cost).sort().join(',') === 'components,observedAt'
    && instant(cost.observedAt) <= instant(now) && cost.observedAt.slice(0, 10) === now.slice(0, 10)
    && cost.components && Object.keys(cost.components).sort().join(',') === categories.sort().join(','));
  let upperMicroUsd = 0;
  for (const item of Object.values(cost.components)) {
    check(item && Object.keys(item).sort().join(',') === 'digest,source,upperMicroUsd'
      && Number.isSafeInteger(item.upperMicroUsd) && item.upperMicroUsd > 0
      && typeof item.digest === 'string' && /^[a-f0-9]{64}$/.test(item.digest)
      && typeof item.source === 'string' && item.source.length <= 2048);
    let source; try { source = new URL(item.source); } catch { refuse(); }
    check(source.protocol === 'https:' && ['pricing.us-east-1.amazonaws.com', 'aws.amazon.com'].includes(source.hostname)
      && !source.username && !source.password && !source.port && !source.search && !source.hash);
    upperMicroUsd += item.upperMicroUsd;
    check(Number.isSafeInteger(upperMicroUsd) && upperMicroUsd < 10_000_000);
  }
  check(typeof directory === 'string' && directory === resolve(directory));
  const parent = await lstat(dirname(directory));
  check(parent.isDirectory() && (parent.mode & 0o777) === 0o700 && parent.uid === process.getuid());
  const inspection = await inspectManualSetup(options);
  check(inspection.billing.microUsd + upperMicroUsd < 10_000_000);
  // Keep even incomplete bookings: an uncertain write must never erase setup's reserved cost.
  await mkdir(directory, { mode: 0o700 });
  const file = await open(join(directory, 'setup.json'), 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify({ ...inspection, cost, upperMicroUsd,
      ...(priceInputs === undefined ? {} : { priceInputs }) }) + '\n');
    await file.sync();
  }
  finally { await file.close(); }
  for (const path of [directory, dirname(directory)]) {
    const handle = await open(path, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  }
  const source = await checkedMain(options.checkout), observed = clock();
  check(source.head === inspection.head && source.tree === inspection.tree
    && Number.isSafeInteger(observed) && observed >= instant(now) && observed < Date.parse(policy.accessExpiry)
    && iso(observed).slice(0, 10) === now.slice(0, 10));
  return { ...inspection, directory, cost, upperMicroUsd };
}

export async function bookManualFirstSetup(options) {
  check(['cost', 'priceInputs', 'quantities', 'fixed'].every(name => options[name] === undefined));
  const monthSeconds = 31 * 86400;
  const quantities = {
    computeSeconds: 1200, diskGiBSeconds: 64 * 86400,
    storageByteSeconds: 16 * 1024 * 1024 * monthSeconds,
    putRequests: 3 * monthSeconds / 60, getRequests: 5000,
    lambdaMiBSeconds: 128 * monthSeconds, lambdaRequests: 3 * monthSeconds / 60,
    logIngestBytes: 1024 ** 3, logStoredByteSeconds: 1024 ** 3 * 4 * 86400,
  };
  const allowances = { transfer: 100000, events: 100000, network: 100000, tax: 2000000, contingency: 1000000 };
  // These are reserved allowances, not acquired prices; the digest identifies these fixed inputs.
  const digest = createHash('sha256').update(JSON.stringify({ quantities, allowances })).digest('hex');
  const fixed = Object.fromEntries(Object.entries(allowances).map(([name, upperMicroUsd]) => [name,
    { upperMicroUsd, source: 'https://aws.amazon.com/pricing/', digest }]));
  return bookManualSetup({ ...options, priceInputs: { catalogues: options.catalogues, quantities, fixed } });
}

export async function createManualFirstSetup(options) {
  const { aws, checkout, now, clock = Date.now, sleep = delay } = options;
  const booking = await bookManualFirstSetup(options);
  // Only the approved first zero opening can start without an imported reconciled history.
  check(booking.billing.microUsd === 0);
  async function unchanged() {
    const before = clock(), source = await checkedMain(checkout), after = clock();
    check(source.head === booking.head && source.tree === booking.tree
      && Number.isSafeInteger(before) && Number.isSafeInteger(after) && before >= instant(now) && after >= before
      && after < Date.parse(policy.accessExpiry) && iso(after).slice(0, 10) === now.slice(0, 10));
  }
  async function call(service, operation, input) {
    await unchanged();
    const result = await aws.call(service, operation, input);
    await unchanged();
    return result;
  }
  const templateBody = JSON.stringify(booking.template);
  check(Buffer.byteLength(templateBody) <= 51200);
  const request = { StackName: 'd570-first', TemplateBody: templateBody, Capabilities: ['CAPABILITY_IAM'],
    Tags: [{ Key: 'Proof', Value: 'D570' }], TimeoutInMinutes: 10, OnFailure: 'ROLLBACK',
    ClientRequestToken: 'd570-' + createHash('sha256').update(JSON.stringify({ head: booking.head, tree: booking.tree, now })).digest('hex') };
  const created = await call('cloudformation', 'create-stack', request), stackId = created?.StackId;
  check(typeof stackId === 'string'
    && /^arn:aws:cloudformation:eu-north-1:462991287391:stack\/d570-first\/[a-f0-9-]{36}$/.test(stackId));
  for (let attempt = 0; ; attempt++) {
    const response = await call('cloudformation', 'describe-stacks', { StackName: stackId });
    check(!response?.NextToken && Array.isArray(response?.Stacks) && response.Stacks.length === 1
      && response.Stacks[0]?.StackId === stackId);
    const status = response.Stacks[0].StackStatus;
    if (status === 'CREATE_COMPLETE') break;
    check(status === 'CREATE_IN_PROGRESS' && attempt < 39);
    await sleep(15000);
  }
  const { ruleName } = await readManualProtection(call, stackId, ['DISABLED', 'ENABLED']);
  await call('events', 'enable-rule', { Name: ruleName, EventBusName: 'default' });
  for (let attempt = 0; ; attempt++) {
    await unchanged();
    try {
      const protection = await inspectManualProtection({ ...options, stackId });
      await unchanged();
      check(protection.billing.microUsd <= booking.upperMicroUsd);
      return { ...booking, ...protection, openingBilling: booking.billing };
    } catch (error) {
      if (error.name !== 'NoSuchKey' || error.$metadata?.httpStatusCode !== 404) throw error;
      check(attempt < 7);
      await sleep(15000);
    }
  }
}

export async function initializeManualFirstSetup(options) {
  const setup = await createManualFirstSetup(options);
  const { checkout, now, clock = Date.now } = options;
  async function unchanged() {
    const before = clock(), source = await checkedMain(checkout), after = clock();
    check(source.head === setup.head && source.tree === setup.tree
      && Number.isSafeInteger(before) && Number.isSafeInteger(after) && before >= instant(now) && after >= before
      && after < Date.parse(policy.accessExpiry) && iso(after).slice(0, 10) === now.slice(0, 10)
      && after - Date.parse(setup.heartbeat.startedAt) < 120_000);
  }
  const aws = { async call(...args) {
    await unchanged();
    const result = await options.aws.call(...args);
    await unchanged();
    return result;
  } };
  const store = createManualLedgerStore({ bucket: setup.bucket, aws });
  const scope = { account, region, stackId: setup.stackId };
  // The setup booking already owns protection and fixed allowances; only machine and disk are booked per drill.
  const components = Object.fromEntries(Object.entries(setup.cost.components).map(([name, row]) => [name,
    { ...row, upperMicroUsd: ['compute', 'disk'].includes(name) ? row.upperMicroUsd : 0 }]));
  const runMicroUsd = components.compute.upperMicroUsd + components.disk.upperMicroUsd;
  const opening = { baselineMicroUsd: setup.openingBilling.microUsd, overheadMicroUsd: setup.upperMicroUsd - runMicroUsd,
    digest: createHash('sha256').update(JSON.stringify({ billing: setup.openingBilling, cost: setup.cost })).digest('hex') };
  const openings = {}, cursor = new Date(instant(now));
  const until = instant(now) + 31 * 86400_000 + 300_000;
  cursor.setUTCDate(1); cursor.setUTCHours(0, 0, 0, 0);
  while (cursor.getTime() <= until) {
    openings[cursor.toISOString().slice(0, 7)] = { ...opening };
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  // This reconciles the first opening to its retained booking, never the eventual final bill.
  const runEvidence = { observedAt: now, account, region, currency: 'USD', pricesReconciled: true,
    billingReconciled: true, protectionHealthy: true, components, openings };
  await initializeLedger({ scope, now, evidence: runEvidence, store });
  const budget = await inspectBudget({ scope, now, billingMicroUsd: setup.billing.microUsd, store });
  await unchanged();
  return { ...setup, runEvidence, budget };
}

export async function launchManualFirstDrill(options) {
  const { checkout, aws, now, clock = Date.now, uuid = randomUUID() } = options;
  const setup = structuredClone(options.setup);
  const inspection = await inspectManualBudget({ ...options, stackId: setup?.stackId, store: undefined });
  check(setup.account === account && setup.region === region && setup.head === inspection.head && setup.tree === inspection.tree
    && setup.bucket === inspection.bucket && inspection.budget.activeUuid === null && inspection.budget.bookedMicroUsd === 0);
  async function unchanged() {
    const before = clock(), source = await checkedMain(checkout), after = clock();
    check(source.head === inspection.head && source.tree === inspection.tree
      && Number.isSafeInteger(before) && Number.isSafeInteger(after) && before >= instant(now) && after >= before
      && after < Date.parse(policy.accessExpiry) && iso(after).slice(0, 10) === now.slice(0, 10)
      && after - Date.parse(inspection.heartbeat.startedAt) < 120_000);
    return after;
  }
  async function call(service, operation, input) {
    await unchanged();
    const result = await aws.call(service, operation, input);
    await unchanged();
    return result;
  }
  const inventory = await call('cloudformation', 'describe-stack-resources', { StackName: setup.stackId });
  check(!inventory?.NextToken && Array.isArray(inventory?.StackResources) && inventory.StackResources.length <= 100);
  function resource(name, pattern) {
    const rows = inventory.StackResources.filter(row => row?.LogicalResourceId === name);
    check(rows.length === 1 && rows[0].StackId === setup.stackId && rows[0].ResourceType === 'AWS::EC2::' + name
      && rows[0].ResourceStatus === 'CREATE_COMPLETE' && typeof rows[0].PhysicalResourceId === 'string'
      && pattern.test(rows[0].PhysicalResourceId));
    return rows[0].PhysicalResourceId;
  }
  const templateId = resource('LaunchTemplate', /^lt-[a-f0-9]{17}$/);
  const subnetId = resource('Subnet', /^subnet-[a-f0-9]{17}$/), groupId = resource('SecurityGroup', /^sg-[a-f0-9]{17}$/);
  const response = await call('ec2', 'describe-launch-template-versions', { LaunchTemplateId: templateId, Versions: ['1'] });
  check(!response?.NextToken && Array.isArray(response?.LaunchTemplateVersions) && response.LaunchTemplateVersions.length === 1);
  const version = response.LaunchTemplateVersions[0], imageId = setup.template?.Parameters?.ImageId?.Default;
  check(typeof imageId === 'string' && /^ami-[a-f0-9]{17}$/.test(imageId)
    && version?.LaunchTemplateId === templateId && version.VersionNumber === 1);
  const expected = { ImageId: imageId, InstanceType: 'm7g.2xlarge', InstanceInitiatedShutdownBehavior: 'terminate',
    MetadataOptions: { HttpEndpoint: 'enabled', HttpTokens: 'required', HttpPutResponseHopLimit: 1, InstanceMetadataTags: 'disabled' },
    NetworkInterfaces: [{ DeviceIndex: 0, AssociatePublicIpAddress: false, DeleteOnTermination: true, SubnetId: subnetId, Groups: [groupId] }],
    BlockDeviceMappings: [{ DeviceName: '/dev/xvda', Ebs: { Encrypted: true, DeleteOnTermination: true,
      VolumeSize: 64, VolumeType: 'gp3', Iops: 3000, Throughput: 125 } }],
  };
  check(isDeepStrictEqual(version.LaunchTemplateData, expected));
  const start = Math.floor(await unchanged() / 1000) * 1000;
  const identity = { uuid, head: setup.head, tree: setup.tree, startedAt: iso(start), expiry: iso(start + 300_000),
    liabilityUntil: iso(start + 300_000 + 31 * 86400_000) };
  const scope = { account, region, stackId: setup.stackId };
  const store = createManualLedgerStore({ bucket: setup.bucket, aws: { call } });
  const reservation = await reserveRun({ scope, identity, evidence: setup.runEvidence, now: iso(start), store, clock });
  const guestExpiry = iso(start + 180_000);
  const userData = renderDeadlineBootstrap({ scope, reservation: { ...reservation, expiry: guestExpiry } });
  const tags = [{ Key: 'Proof', Value: 'D570' }, { Key: 'Stack', Value: scope.stackId },
    { Key: 'Run', Value: uuid }, { Key: 'ExpiresAt', Value: identity.expiry }];
  const request = { ClientToken: uuid, MinCount: 1, MaxCount: 1, LaunchTemplate: { LaunchTemplateId: templateId, Version: '1' },
    UserData: Buffer.from(userData).toString('base64'), TagSpecifications: ['instance', 'volume'].map(ResourceType => ({ ResourceType, Tags: tags })) };
  check(await unchanged() < instant(guestExpiry));
  // A lost reply keeps the reservation. A new invocation must not start another first drill.
  const launched = await call('ec2', 'run-instances', request);
  check(launched?.OwnerId === account && Array.isArray(launched.Instances) && launched.Instances.length === 1);
  const instance = launched.Instances[0];
  check(typeof instance?.InstanceId === 'string' && /^i-[a-f0-9]{17}$/.test(instance.InstanceId)
    && instance.ClientToken === uuid && instance.ImageId === imageId && instance.InstanceType === 'm7g.2xlarge' && instance.SubnetId === subnetId
    && ['pending', 'running'].includes(instance.State?.Name));
  return { ...inspection, reservation, guestExpiry, instanceId: instance.InstanceId, subnetId, groupId, templateId };
}

export async function inspectManualFirstGuest(options) {
  const { checkout, aws, now, clock = Date.now } = options, launch = structuredClone(options.launch);
  const inspection = await inspectManualBudget({ ...options, stackId: launch?.stackId, store: undefined });
  const reservation = launch.reservation;
  check(launch.account === account && launch.region === region && launch.head === inspection.head && launch.tree === inspection.tree
    && launch.bucket === inspection.bucket && reservation?.uuid === inspection.budget.activeUuid
    && reservation.head === inspection.head && reservation.tree === inspection.tree
    && instant(reservation.startedAt) <= instant(now) && instant(reservation.expiry) === instant(reservation.startedAt) + 300_000
    && instant(launch.guestExpiry) === instant(reservation.startedAt) + 180_000
    && typeof launch.instanceId === 'string' && /^i-[a-f0-9]{17}$/.test(launch.instanceId));
  async function unchanged() {
    const before = clock(), source = await checkedMain(checkout), after = clock();
    check(source.head === inspection.head && source.tree === inspection.tree
      && Number.isSafeInteger(before) && Number.isSafeInteger(after) && before >= instant(now) && after >= before
      && after < instant(launch.guestExpiry) && after - Date.parse(inspection.heartbeat.startedAt) < 120_000);
    return after;
  }
  async function call(operation, input) {
    await unchanged();
    const result = await aws.call('ec2', operation, input);
    await unchanged();
    return result;
  }
  async function liveResources() {
    const response = await call('describe-instances', { InstanceIds: [launch.instanceId] });
    check(!response?.NextToken && Array.isArray(response?.Reservations) && response.Reservations.length === 1);
    const row = response.Reservations[0];
    check(row?.OwnerId === account && Array.isArray(row.Instances) && row.Instances.length === 1);
    const instance = row.Instances[0];
    check(instance?.InstanceId === launch.instanceId && instance.ClientToken === reservation.uuid && instance.State?.Name === 'running'
      && instance.SubnetId === launch.subnetId && instance.InstanceType === 'm7g.2xlarge'
      && !instance.PublicIpAddress && !instance.IamInstanceProfile && !instance.KeyName
      && instance.RootDeviceName === '/dev/xvda' && instance.RootDeviceType === 'ebs');
    const expectedTags = { Proof: 'D570', Stack: launch.stackId, Run: reservation.uuid, ExpiresAt: reservation.expiry };
    check(Array.isArray(instance.Tags) && Object.entries(expectedTags).every(([key, value]) => {
      const matches = instance.Tags.filter(tag => tag?.Key === key);
      return matches.length === 1 && matches[0].Value === value;
    }));
    check(Array.isArray(instance.BlockDeviceMappings) && instance.BlockDeviceMappings.length === 1
      && Array.isArray(instance.NetworkInterfaces) && instance.NetworkInterfaces.length === 1);
    const disk = instance.BlockDeviceMappings[0], network = instance.NetworkInterfaces[0];
    check(disk?.DeviceName === '/dev/xvda' && disk.Ebs?.DeleteOnTermination === true && disk.Ebs.Status === 'attached'
      && typeof disk.Ebs.VolumeId === 'string' && /^vol-[a-f0-9]{17}$/.test(disk.Ebs.VolumeId));
    check(typeof network?.NetworkInterfaceId === 'string' && /^eni-[a-f0-9]{17}$/.test(network.NetworkInterfaceId)
      && network.OwnerId === account && network.SubnetId === launch.subnetId && network.Status === 'in-use' && !network.Association
      && (!network.Ipv6Addresses || Array.isArray(network.Ipv6Addresses) && network.Ipv6Addresses.length === 0)
      && Array.isArray(network.Groups) && network.Groups.length === 1 && network.Groups[0].GroupId === launch.groupId
      && network.Attachment?.InstanceId === launch.instanceId && network.Attachment.DeviceIndex === 0
      && network.Attachment.Status === 'attached' && network.Attachment.DeleteOnTermination === true);
    return { volumeIds: [disk.Ebs.VolumeId], interfaceIds: [network.NetworkInterfaceId] };
  }
  const resources = await liveResources();
  const shutdown = await call('describe-instance-attribute', { InstanceId: launch.instanceId, Attribute: 'instanceInitiatedShutdownBehavior' });
  check(shutdown?.InstanceId === launch.instanceId && shutdown.InstanceInitiatedShutdownBehavior?.Value === 'terminate');
  // The CLI decodes console bytes; a line seen only after termination cannot establish live readiness.
  const consoleOutput = await call('get-console-output', { InstanceId: launch.instanceId, Latest: true });
  const timestamp = Date.parse(consoleOutput?.Timestamp);
  check(consoleOutput?.InstanceId === launch.instanceId && Number.isFinite(timestamp)
    && timestamp >= instant(reservation.startedAt) && timestamp <= clock()
    && typeof consoleOutput.Output === 'string' && Buffer.byteLength(consoleOutput.Output) <= 1024 * 1024);
  const prefix = `D570_DEADLINE_READY ${reservation.uuid} ${instant(launch.guestExpiry) / 1000} `;
  const lines = consoleOutput.Output.split(/\r?\n/).filter(line => line.startsWith(prefix));
  const boots = new Set(lines.map(line => line.slice(prefix.length)));
  check(boots.size === 1 && [...boots].every(boot => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(boot)));
  check(isDeepStrictEqual(await liveResources(), resources));
  return { ...launch, ...inspection, ...resources, bootId: [...boots][0], consoleOutput,
    observedAt: iso(Math.floor(await unchanged() / 1000) * 1000) };
}

export async function observeManualFirstShutdown(options) {
  const { checkout, aws, now, clock = Date.now, sleep = delay } = options, ready = structuredClone(options.ready);
  const inspection = await inspectManualBudget({ ...options, stackId: ready?.stackId, store: undefined });
  const reservation = ready.reservation;
  check(ready.account === account && ready.region === region && ready.head === inspection.head && ready.tree === inspection.tree
    && ready.bucket === inspection.bucket && reservation?.uuid === inspection.budget.activeUuid
    && reservation.head === inspection.head && reservation.tree === inspection.tree
    && instant(reservation.startedAt) <= instant(ready.observedAt) && instant(ready.observedAt) < instant(ready.guestExpiry)
    && instant(ready.guestExpiry) === instant(reservation.startedAt) + 180_000
    && instant(reservation.expiry) === instant(reservation.startedAt) + 300_000
    && instant(ready.observedAt) <= instant(now)
    && typeof ready.instanceId === 'string' && /^i-[a-f0-9]{17}$/.test(ready.instanceId)
    && !inspection.heartbeat.terminationRequested.includes(ready.instanceId));
  const earliest = instant(reservation.startedAt) + 170_000, expiry = instant(reservation.expiry);
  let last = instant(now), running;
  function time() {
    const at = clock();
    check(Number.isSafeInteger(at) && at >= last && at < Date.parse(policy.accessExpiry)
      && iso(at).slice(0, 10) === now.slice(0, 10));
    last = at;
    return at;
  }
  async function unchanged() {
    const source = await checkedMain(checkout);
    check(source.head === inspection.head && source.tree === inspection.tree);
    return time();
  }
  // Request time bounds the running observation; reply time bounds termination, independent of later cleanup.
  for (let poll = 0; poll < 64; poll++) {
    const at = await unchanged();
    check(at < expiry);
    if (at < earliest) { await sleep(Math.min(5000, earliest - at)); continue; }
    const requested = time();
    check(requested < expiry);
    const response = await aws.call('ec2', 'describe-instances', { InstanceIds: [ready.instanceId] });
    const received = time();
    check(received < expiry);
    await unchanged();
    check(!response?.NextToken && Array.isArray(response?.Reservations) && response.Reservations.length === 1);
    const row = response.Reservations[0], instance = row?.Instances?.[0];
    check(row?.OwnerId === account && Array.isArray(row.Instances) && row.Instances.length === 1
      && instance?.InstanceId === ready.instanceId && instance.ClientToken === reservation.uuid && instance.SubnetId === ready.subnetId);
    const tags = { Proof: 'D570', Stack: ready.stackId, Run: reservation.uuid, ExpiresAt: reservation.expiry };
    check(Array.isArray(instance.Tags) && Object.entries(tags).every(([key, value]) => {
      const matches = instance.Tags.filter(tag => tag?.Key === key);
      return matches.length === 1 && matches[0].Value === value;
    }));
    if (instance.State?.Name === 'running') {
      running ??= { runningRequestedAt: iso(requested), runningReceivedAt: iso(received) };
    } else {
      check(running && ['shutting-down', 'terminated'].includes(instance.State?.Name));
      if (instance.State.Name === 'terminated') {
        check(instance.StateReason?.Code === 'Client.InstanceInitiatedShutdown');
        return { ...ready, shutdownObservation: { ...running, terminatedReceivedAt: iso(received), stateReason: instance.StateReason } };
      }
    }
    const remaining = expiry - time();
    check(remaining > 0);
    await sleep(Math.min(5000, remaining));
  }
  refuse();
}

export async function inspectManualFirstGuestCleanup(options) {
  const { checkout, aws, now, clock = Date.now } = options, ready = structuredClone(options.ready);
  const inspection = await inspectManualBudget({ ...options, stackId: ready?.stackId, store: undefined });
  const reservation = ready.reservation;
  check(ready.account === account && ready.region === region && ready.head === inspection.head && ready.tree === inspection.tree
    && ready.bucket === inspection.bucket && reservation?.uuid === inspection.budget.activeUuid
    && reservation.head === inspection.head && reservation.tree === inspection.tree
    && instant(reservation.startedAt) <= instant(ready.observedAt) && instant(ready.observedAt) < instant(ready.guestExpiry)
    && instant(ready.guestExpiry) === instant(reservation.startedAt) + 180_000
    && instant(reservation.expiry) === instant(reservation.startedAt) + 300_000
    && instant(ready.observedAt) <= instant(now)
    && typeof ready.instanceId === 'string' && /^i-[a-f0-9]{17}$/.test(ready.instanceId)
    && typeof ready.subnetId === 'string' && /^subnet-[a-f0-9]{17}$/.test(ready.subnetId)
    && Array.isArray(ready.volumeIds) && ready.volumeIds.length === 1 && /^vol-[a-f0-9]{17}$/.test(ready.volumeIds[0])
    && Array.isArray(ready.interfaceIds) && ready.interfaceIds.length === 1 && /^eni-[a-f0-9]{17}$/.test(ready.interfaceIds[0]));
  async function unchanged() {
    const before = clock(), source = await checkedMain(checkout), after = clock();
    check(source.head === inspection.head && source.tree === inspection.tree
      && Number.isSafeInteger(before) && Number.isSafeInteger(after) && before >= instant(now) && after >= before
      && after < Date.parse(policy.accessExpiry) && iso(after).slice(0, 10) === now.slice(0, 10)
      && after - Date.parse(inspection.heartbeat.startedAt) < 120_000);
    return after;
  }
  async function call(operation, input) {
    await unchanged();
    const result = await aws.call('ec2', operation, input);
    await unchanged();
    return result;
  }
  const response = await call('describe-instances', { InstanceIds: [ready.instanceId] });
  check(!response?.NextToken && Array.isArray(response?.Reservations) && response.Reservations.length === 1);
  const row = response.Reservations[0], instance = row?.Instances?.[0];
  check(row?.OwnerId === account && Array.isArray(row.Instances) && row.Instances.length === 1
    && instance?.InstanceId === ready.instanceId && instance.ClientToken === reservation.uuid
    && instance.SubnetId === ready.subnetId && instance.State?.Name === 'terminated'
    && instance.StateReason?.Code === 'Client.InstanceInitiatedShutdown');
  const tags = { Proof: 'D570', Stack: ready.stackId, Run: reservation.uuid, ExpiresAt: reservation.expiry };
  check(Array.isArray(instance.Tags) && Object.entries(tags).every(([key, value]) => {
    const matches = instance.Tags.filter(tag => tag?.Key === key);
    return matches.length === 1 && matches[0].Value === value;
  }));
  const volumes = await call('describe-volumes', { Filters: [{ Name: 'volume-id', Values: ready.volumeIds }], MaxResults: 100 });
  check(!volumes?.NextToken && Array.isArray(volumes?.Volumes) && volumes.Volumes.length === 0);
  // Interfaces are not tagged by the template; the owned subnet also exposes leftovers after controller loss.
  const interfaces = await call('describe-network-interfaces', { Filters: [{ Name: 'subnet-id', Values: [ready.subnetId] }], MaxResults: 100 });
  check(!interfaces?.NextToken && Array.isArray(interfaces?.NetworkInterfaces) && interfaces.NetworkInterfaces.length === 0);
  // An OS actor and absent resources do not establish when the guest stopped or reconcile its bill.
  return { ...ready, ...inspection, stateReason: instance.StateReason, terminated: true, volumesAbsent: true, interfacesAbsent: true,
    observedAt: iso(Math.floor(await unchanged() / 1000) * 1000) };
}

export async function inspectManualFirstBilling(options) {
  const { checkout, aws, now, clock = Date.now } = options;
  const setup = structuredClone(options.setup), launch = structuredClone(options.launch);
  const inspection = await inspectManualBudget({ ...options, stackId: setup?.stackId, store: undefined });
  const reservation = launch?.reservation;
  check(setup.account === account && setup.region === region && setup.head === inspection.head && setup.tree === inspection.tree
    && setup.bucket === inspection.bucket && launch.account === account && launch.region === region
    && launch.stackId === setup.stackId && launch.bucket === inspection.bucket
    && launch.head === inspection.head && launch.tree === inspection.tree
    && reservation?.uuid === inspection.budget.activeUuid && reservation.head === inspection.head && reservation.tree === inspection.tree
    && instant(reservation.startedAt) <= instant(now) && instant(reservation.expiry) === instant(reservation.startedAt) + 300_000
    && setup.upperMicroUsd === inspection.budget.overheadMicroUsd + inspection.budget.bookedMicroUsd);
  async function unchanged() {
    const before = clock(), source = await checkedMain(checkout), after = clock();
    check(source.head === inspection.head && source.tree === inspection.tree
      && Number.isSafeInteger(before) && Number.isSafeInteger(after) && before >= instant(now) && after >= before
      && after < Date.parse(policy.accessExpiry) && iso(after).slice(0, 10) === now.slice(0, 10)
      && after - Date.parse(inspection.heartbeat.startedAt) < 120_000);
  }
  const guarded = { async call(...args) {
    await unchanged();
    const result = await aws.call(...args);
    await unchanged();
    return result;
  } };
  const start = setup.openingBilling?.period?.Start;
  check(typeof start === 'string' && /^\d{4}-\d\d-01$/.test(start)
    && instant(start + 'T00:00:00Z') <= instant(reservation.startedAt));
  const period = { Start: start, End: inspection.billing.period.End };
  const expected = [], cursor = new Date(start + 'T00:00:00Z');
  while (cursor.toISOString().slice(0, 10) < period.End) {
    check(expected.length < 3);
    const from = cursor.toISOString().slice(0, 10);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    expected.push({ Start: from, End: cursor.toISOString().slice(0, 10) < period.End ? cursor.toISOString().slice(0, 10) : period.End });
  }
  const groupBy = [{ Type: 'DIMENSION', Key: 'SERVICE' }, { Type: 'DIMENSION', Key: 'USAGE_TYPE' }];
  const response = await guarded.call('ce', 'get-cost-and-usage', { TimePeriod: period, Granularity: 'MONTHLY',
    Metrics: ['UnblendedCost', 'UsageQuantity'], GroupBy: groupBy,
    Filter: { Dimensions: { Key: 'LINKED_ACCOUNT', Values: [account] } } });
  check(!response?.NextPageToken && isDeepStrictEqual(response?.GroupDefinitions, groupBy)
    && Array.isArray(response?.ResultsByTime) && response.ResultsByTime.length === expected.length);
  const store = createManualLedgerStore({ bucket: inspection.bucket, aws: guarded });
  const scope = { account, region, stackId: setup.stackId }, months = [];
  const decimal = value => typeof value === 'string' && /^(0|[1-9]\d{0,9})(\.\d{1,10})?$/.test(value);
  const rounded = nanos => Number((nanos + 9999n) / 10000n);
  for (const [index, row] of response.ResultsByTime.entries()) {
    check(isDeepStrictEqual(row?.TimePeriod, expected[index]) && typeof row.Estimated === 'boolean'
      && Array.isArray(row.Groups) && row.Groups.length <= 1000);
    const seen = new Set(), components = []; let total = 0n;
    for (const group of row.Groups) {
      check(Array.isArray(group?.Keys) && group.Keys.length === 2
        && group.Keys.every(key => typeof key === 'string' && key.length > 0 && key.length <= 256));
      const key = JSON.stringify(group.Keys), cost = group.Metrics?.UnblendedCost, usage = group.Metrics?.UsageQuantity;
      check(!seen.has(key) && cost?.Unit === 'USD' && decimal(cost.Amount) && decimal(usage?.Amount)
        && typeof usage.Unit === 'string' && usage.Unit.length > 0 && usage.Unit.length <= 128);
      seen.add(key);
      const [whole, fraction = ''] = cost.Amount.split('.'), nanos = BigInt(whole + fraction.padEnd(10, '0'));
      total += nanos;
      components.push({ service: group.Keys[0], usageType: group.Keys[1], microUsd: rounded(nanos),
        usage: { amount: usage.Amount, unit: usage.Unit } });
    }
    const accountCostMicroUsd = rounded(total), month = row.TimePeriod.Start.slice(0, 7);
    if (month === now.slice(0, 7)) check(accountCostMicroUsd === inspection.billing.microUsd && row.Estimated === inspection.billing.estimated);
    const at = month === now.slice(0, 7) ? now : iso(instant(row.TimePeriod.End + 'T00:00:00Z') - 1000);
    const budget = await inspectBudget({ scope, now: at, billingMicroUsd: accountCostMicroUsd, store });
    check(budget.activeUuid === reservation.uuid && accountCostMicroUsd >= budget.baselineMicroUsd);
    months.push({ period: row.TimePeriod, estimated: row.Estimated, accountCostMicroUsd,
      baselineMicroUsd: budget.baselineMicroUsd, components });
  }
  await unchanged();
  const accountCostMicroUsd = months.reduce((sum, month) => sum + month.accountCostMicroUsd, 0);
  // Account totals include setup and other services; they are never an attributed per-run cost or a refund.
  return { ...inspection, costReport: { estimateMicroUsd: setup.upperMicroUsd, accountCostMicroUsd,
    billedAccountMicroUsd: months.some(month => month.estimated) ? null : accountCostMicroUsd, months } };
}

export async function retainManualHistory(options) {
  const { checkout, directory, aws, now, clock = Date.now } = options;
  check(typeof directory === 'string' && directory === resolve(directory));
  const parent = await lstat(dirname(directory));
  check(parent.isDirectory() && (parent.mode & 0o777) === 0o700 && parent.uid === process.getuid());
  const root = await realpath(checkout), destination = join(await realpath(dirname(directory)), basename(directory));
  check(destination !== root && !destination.startsWith(root + '/'));
  const inspection = await inspectManualBudget({ ...options, store: undefined });
  async function unchanged() {
    const before = clock(), source = await checkedMain(checkout), after = clock();
    check(source.head === inspection.head && source.tree === inspection.tree
      && Number.isSafeInteger(before) && Number.isSafeInteger(after) && before >= instant(now) && after >= before
      && after < Date.parse(policy.accessExpiry) && iso(after).slice(0, 10) === now.slice(0, 10)
      && after - Date.parse(inspection.heartbeat.startedAt) < 120_000);
  }
  const guarded = { async call(...args) {
    await unchanged();
    const result = await aws.call(...args);
    await unchanged();
    return result;
  } };
  const store = createManualLedgerStore({ bucket: inspection.bucket, aws: guarded });
  const keys = (await store.list()).sort(), records = new Map();
  for (const key of keys) {
    const row = await store.get(key); check(row);
    records.set(key, { body: Buffer.from(row.body), etag: row.etag });
  }
  // Validate exactly the bytes retained locally, rather than a different set of live reads.
  const snapshot = { async list() { return [...keys]; }, async get(key) { return records.get(key) ?? null; } };
  const scope = { account, region, stackId: inspection.stackId };
  const budget = await inspectBudget({ scope, now, billingMicroUsd: inspection.billing.microUsd, store: snapshot });
  check(isDeepStrictEqual(budget, inspection.budget));
  check(isDeepStrictEqual((await store.list()).sort(), keys));
  for (const [key, row] of records) {
    const current = await store.get(key);
    check(current && current.etag === row.etag && Buffer.from(current.body).equals(row.body));
  }
  // An uncertain local write leaves its private partial export and all provider records intact.
  await unchanged();
  const latestParent = await lstat(dirname(directory));
  check(latestParent.isDirectory() && (latestParent.mode & 0o777) === 0o700 && latestParent.uid === process.getuid());
  await mkdir(directory, { mode: 0o700 });
  const created = await lstat(directory);
  check(created.isDirectory() && (created.mode & 0o777) === 0o700 && created.uid === process.getuid());
  const files = [];
  for (const [key, row] of records) {
    const name = key.slice('d570/ledger/'.length), path = join(directory, name);
    const handle = await open(path, 'wx', 0o600);
    try {
      await handle.writeFile(row.body);
      await handle.sync();
      const info = await handle.stat();
      check(info.isFile() && (info.mode & 0o777) === 0o600 && info.uid === process.getuid()
        && info.size === row.body.byteLength && (await readFile(path)).equals(row.body));
    } finally { await handle.close(); }
    files.push(name);
  }
  for (const path of [directory, dirname(directory)]) {
    const handle = await open(path, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  }
  await unchanged();
  return { ...inspection, directory, files };
}

if (process.argv[1] && process.argv[1] !== '-' && await realpath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.error('D570 manual lifecycle is not implemented. No setup, launch, reconciliation or removal was performed.');
  process.exitCode = 1;
}
