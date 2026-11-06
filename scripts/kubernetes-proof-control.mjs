import { execFile } from 'node:child_process';
import { realpath, mkdtemp, writeFile, lstat, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { renderManualSetup } from '../deploy/kubernetes/proof/setup.mjs';
import policy from '../deploy/kubernetes/proof/policy.json' with { type: 'json' };

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
      || (service === 'cloudformation' && ['describe-stacks', 'describe-stack-resources'].includes(operation))
      || (service === 'events' && ['describe-rule', 'list-targets-by-rule'].includes(operation))
      || (service === 's3api' && operation === 'get-object')
      || (service === 'ssm' && operation === 'get-parameter')
      || (service === 'ec2' && ['describe-images', 'describe-instance-types', 'describe-managed-prefix-lists'].includes(operation)));
    const download = service === 's3api';
    if (download) check(input && Object.keys(input).sort().join(',') === 'Bucket,ExpectedBucketOwner,Key,Range'
      && typeof input.Bucket === 'string' && /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(input.Bucket)
      && input.Key === 'd570/health/reaper.json' && input.ExpectedBucketOwner === account && input.Range === 'bytes=0-1048576');
    const payload = JSON.stringify(input);
    check(typeof payload === 'string' && Buffer.byteLength(payload) <= 64 * 1024);
    let directory;
    try {
      let output;
      if (download) {
        directory = await mkdtemp(join(tmpdir(), 'd570-heartbeat-'));
        output = join(directory, 'heartbeat.json');
        await writeFile(output, '', { mode: 0o600, flag: 'wx' });
      }
      const { stdout } = await execute(executable, [service, operation, '--cli-input-json', payload,
        '--region', service === 'ce' ? 'us-east-1' : region, '--output', 'json', '--no-paginate', '--no-cli-pager',
        '--cli-connect-timeout', '5', '--cli-read-timeout', '15', ...(download ? [output] : [])], {
        timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
        env: { ...process.env, AWS_MAX_ATTEMPTS: '3', AWS_RETRY_MODE: 'standard',
          AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true', AWS_EC2_METADATA_DISABLED: 'true', AWS_PAGER: '' },
      });
      const metadata = JSON.parse(stdout);
      if (!download) return metadata;
      const file = await lstat(output);
      check(file.isFile() && file.size > 0 && file.size <= 1024 * 1024 && (file.mode & 0o777) === 0o600
        && Number.isSafeInteger(metadata.ContentLength) && metadata.ContentLength === file.size
        && metadata.ContentRange === `bytes 0-${file.size - 1}/${file.size}`);
      const body = await readFile(output);
      check(body.byteLength === file.size);
      const modified = typeof metadata.LastModified === 'string' ? metadata.LastModified.replace('+00:00', 'Z') : '';
      check(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(modified)
        && Number.isFinite(Date.parse(modified)) && new Date(modified).toISOString().replace('.000Z', 'Z') === modified.replace('.000Z', 'Z'));
      return { ...metadata, LastModified: new Date(modified).toISOString().replace('.000Z', 'Z'), Body: body };
    } catch { throw new Error(`D570 AWS ${service}/${operation} failed`); }
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
    && rule.State === 'ENABLED' && rule.ScheduleExpression === 'rate(1 minute)'
    && rule.EventBusName === 'default' && !rule.EventPattern);
  const targets = await read('events', 'list-targets-by-rule', { Rule: ruleName, EventBusName: 'default', Limit: 100 });
  check(!targets?.NextToken && Array.isArray(targets?.Targets) && targets.Targets.length === 1);
  const target = targets.Targets[0];
  check(target?.Id === 'D570Expiry' && target.Arn === `arn:aws:lambda:${region}:${account}:function:${functionName}`
    && target.RetryPolicy?.MaximumEventAgeInSeconds === 60 && target.RetryPolicy.MaximumRetryAttempts === 0
    && !Object.hasOwn(target, 'Input') && !Object.hasOwn(target, 'InputPath') && !Object.hasOwn(target, 'InputTransformer'));
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

if (process.argv[1] && process.argv[1] !== '-' && await realpath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.error('D570 manual lifecycle is not implemented. No setup, launch, reconciliation or removal was performed.');
  process.exitCode = 1;
}
