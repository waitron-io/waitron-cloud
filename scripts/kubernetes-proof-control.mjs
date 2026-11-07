import { execFile } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { realpath, mkdtemp, writeFile, lstat, readFile, rm, mkdir, open, readdir, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { join, dirname, basename, resolve } from 'node:path';
import { promisify, isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { renderManualSetup } from '../deploy/kubernetes/proof/setup.mjs';
import policy from '../deploy/kubernetes/proof/policy.json' with { type: 'json' };
import { inspectBudget, initializeLedger, reserveRun, createS3LedgerStore } from './kubernetes-proof-budget.mjs';
import { calculateManualCost, acquirePriceCatalogue } from '../deploy/kubernetes/proof/prices.mjs';
import { renderDeadlineBootstrap } from '../deploy/kubernetes/proof/bootstrap.mjs';

const execute = promisify(execFile);
const mainChecks = new AsyncLocalStorage();
const account = '462991287391', region = 'eu-north-1';
const refuse = (reason = 'control input') => { throw new Error(`D570 controller refused: ${reason}`); };
const checkControl = (value, reason = 'control input') => { if (!value) refuse(reason); };
const check = checkControl;
const pending = (code, reason) => { throw Object.assign(new Error(`D570 controller refused: ${reason}`), { code }); };
const iso = instant => new Date(instant).toISOString().replace('.000Z', 'Z');
function instant(value) {
  const check = (value, reason = 'clock') => checkControl(value, reason);
  check(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value));
  const result = Date.parse(value);
  check(Number.isFinite(result) && iso(result) === value);
  return result;
}

export function createManualAwsCli({ executable = 'aws' } = {}) {
  return { async call(service, operation, input) {
    check((service === 'sts' && operation === 'get-caller-identity')
      || (service === 'ce' && operation === 'get-cost-and-usage')
      || (service === 'cloudformation' && ['describe-stacks', 'describe-stack-resources', 'describe-stack-events', 'create-stack', 'delete-stack'].includes(operation))
      || (service === 'events' && ['describe-rule', 'list-targets-by-rule', 'enable-rule', 'disable-rule'].includes(operation))
      || (service === 's3api' && ['get-object', 'put-object', 'list-objects-v2', 'delete-objects'].includes(operation))
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
    if (service === 'cloudformation' && ['delete-stack', 'describe-stack-events'].includes(operation)) check(input
      && Object.keys(input).join(',') === 'StackName' && typeof input.StackName === 'string'
      && /^arn:aws:cloudformation:eu-north-1:462991287391:stack\/d570-first\/[a-f0-9-]{36}$/.test(input.StackName));
    if (service === 'events' && ['enable-rule', 'disable-rule'].includes(operation)) check(input
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
      } else if (operation === 'delete-objects') check(keys(['Bucket', 'ExpectedBucketOwner', 'Delete'])
        && input.Delete && Object.keys(input.Delete).sort().join(',') === 'Objects,Quiet' && input.Delete.Quiet === false
        && Array.isArray(input.Delete.Objects) && input.Delete.Objects.length > 0 && input.Delete.Objects.length <= 1000
        && input.Delete.Objects.every(row => row && Object.keys(row).join(',') === 'Key'
          && (ledgerKey(row.Key) || row.Key === 'd570/health/reaper.json'))
        && new Set(input.Delete.Objects.map(row => row.Key)).size === input.Delete.Objects.length);
      else check(keys(['Bucket', 'ExpectedBucketOwner', 'Prefix', 'MaxKeys', ...(Object.hasOwn(input, 'ContinuationToken') ? ['ContinuationToken'] : [])])
        && (input.Prefix === 'd570/ledger/' && input.MaxKeys === 100 || input.Prefix === 'd570/' && input.MaxKeys === 1000)
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
      const emptySuccess = service === 'events' && ['enable-rule', 'disable-rule'].includes(operation)
        || service === 'cloudformation' && operation === 'delete-stack';
      const metadata = emptySuccess && stdout.trim() === '' ? {} : JSON.parse(stdout);
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

async function checkedMain(checkout, { forceRemote = false } = {}) {
  const check = (value, reason = 'checkout') => checkControl(value, reason);
  const cwd = await realpath(checkout);
  async function git(...args) {
    try {
      const { stdout } = await execute('git', args, { cwd, encoding: 'utf8', timeout: 30_000,
        killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
      return stdout.trim();
    } catch { refuse('checkout'); }
  }
  const values = (await git('rev-parse', '--show-toplevel', 'HEAD', 'HEAD^{tree}', 'refs/remotes/origin/main')).split('\n');
  check(values.length === 4 && await realpath(values[0]) === cwd);
  check(await git('symbolic-ref', '--short', 'HEAD') === 'main');
  check(await git('status', '--porcelain=v1', '--untracked-files=all') === '');
  check(['https://github.com/waitron-io/waitron-cloud.git', 'git@github.com:waitron-io/waitron-cloud.git']
    .includes(await git('config', '--get', 'remote.origin.url')));
  const [, head, tree, recordedMain] = values;
  check(/^[a-f0-9]{40}$/.test(head) && /^[a-f0-9]{40}$/.test(tree));
  check(recordedMain === head);
  const context = mainChecks.getStore(), scoped = context?.checkout === cwd;
  if (scoped && context.source) check(context.source.head === head && context.source.tree === tree);
  if (!scoped || !context.source || forceRemote) {
    check(await git('ls-remote', '--exit-code', 'origin', 'refs/heads/main') === `${head}\trefs/heads/main`);
    if (scoped) context.source = { head, tree };
  }
  return { head, tree };
}

function billingObservation(response, period, now) {
  const check = (value, reason = 'ce billing shape') => checkControl(value, reason);
  check(response && !response.NextPageToken && (response.GroupDefinitions === undefined
    || Array.isArray(response.GroupDefinitions) && response.GroupDefinitions.length === 0) && Array.isArray(response.ResultsByTime) && response.ResultsByTime.length === 1);
  const row = response.ResultsByTime[0], total = row?.Total?.UnblendedCost;
  check(row?.TimePeriod?.Start === period.Start && row.TimePeriod.End === period.End
    && typeof row.Estimated === 'boolean' && Array.isArray(row.Groups) && row.Groups.length === 0
    && total?.Unit === 'USD' && typeof total.Amount === 'string');
  if (/^-(0|[1-9]\d{0,9})(\.\d{1,10})?$/.test(total.Amount)) {
    throw Object.assign(new Error('D570 controller refused: account bill contains a credit'), {
      opening: { billing: { observedAt: now, period, rawUsd: total.Amount, estimated: row.Estimated }, items: [] },
    });
  }
  check(/^(0|[1-9]\d{0,9})(\.\d{1,10})?$/.test(total.Amount));
  const [whole, fraction = ''] = total.Amount.split('.');
  const nanos = BigInt(whole + fraction.padEnd(10, '0'));
  const microUsd = Number((nanos + 9999n) / 10000n);
  check(Number.isSafeInteger(microUsd) && microUsd < 10_000_000);
  // Current-month estimates do not establish reconciled billing or release cost ownership.
  return { observedAt: now, period, microUsd, estimated: row.Estimated };
}

async function inspectManualOwner({ checkout, region: requestedRegion, now, aws, environment = process.env, clock = Date.now }, withBilling) {
  const check = (value, reason = 'clock') => checkControl(value, reason);
  check(requestedRegion === region && !environment.GITHUB_ACTIONS && !environment.GITHUB_EVENT_NAME, 'control input');
  const current = instant(now);
  check(current < Date.parse('2027-02-28T23:59:00Z'));
  check(typeof aws?.call === 'function', 'control input');
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
    && /^arn:aws:sts::462991287391:assumed-role\/[\w+=,.@/-]+\/[\w+=,.@-]+$/.test(identity.Arn), 'sts identity');
  fresh();
  check(JSON.stringify(await checkedMain(checkout)) === JSON.stringify(source), 'checkout');
  fresh();
  if (!withBilling) return { account, region, ...source };
  const period = { Start: now.slice(0, 7) + '-01', End: iso(current + 86400_000).slice(0, 10) };
  const response = await aws.call('ce', 'get-cost-and-usage', { TimePeriod: period, Granularity: 'MONTHLY',
    Metrics: ['UnblendedCost'], Filter: { Dimensions: { Key: 'LINKED_ACCOUNT', Values: [account] } } });
  fresh();
  check(JSON.stringify(await checkedMain(checkout)) === JSON.stringify(source), 'checkout');
  fresh();
  return { account, region, ...source, billing: billingObservation(response, period, now) };
}

export async function inspectManualControl(options) { return inspectManualOwner(options, true); }

export async function inspectManualOpening(options) {
  const check = (value, reason = 'ce grouped shape') => checkControl(value, reason);
  const inspection = await inspectManualControl(options), { aws, checkout, now, clock = Date.now } = options;
  const explanations = structuredClone(options.explanations ?? []), items = [];
  if (inspection.billing.microUsd > 0) {
    const groupBy = [{ Type: 'DIMENSION', Key: 'SERVICE' }, { Type: 'DIMENSION', Key: 'USAGE_TYPE' }];
    const response = await aws.call('ce', 'get-cost-and-usage', { TimePeriod: inspection.billing.period,
      Granularity: 'MONTHLY', Metrics: ['UnblendedCost', 'UsageQuantity'], GroupBy: groupBy,
      Filter: { Dimensions: { Key: 'LINKED_ACCOUNT', Values: [account] } } });
    const source = await checkedMain(checkout), at = clock();
    check(source.head === inspection.head && source.tree === inspection.tree && at >= instant(now)
      && at < Date.parse(policy.accessExpiry) && iso(at).slice(0, 10) === now.slice(0, 10));
    check(!response?.NextPageToken && isDeepStrictEqual(response?.GroupDefinitions, groupBy)
      && Array.isArray(response.ResultsByTime) && response.ResultsByTime.length === 1);
    const row = response.ResultsByTime[0];
    check(isDeepStrictEqual(row?.TimePeriod, inspection.billing.period) && row.Estimated === inspection.billing.estimated
      && Array.isArray(row.Groups) && row.Groups.length <= 1000);
    const seen = new Set(); let total = 0n;
    for (const group of row.Groups) {
      const cost = group?.Metrics?.UnblendedCost;
      check(Array.isArray(group?.Keys) && group.Keys.length === 2
        && group.Keys.every(key => typeof key === 'string' && key.length > 0 && key.length <= 256)
        && cost?.Unit === 'USD' && typeof cost.Amount === 'string' && /^(0|[1-9]\d{0,9})(\.\d{1,10})?$/.test(cost.Amount));
      const key = JSON.stringify(group.Keys); check(!seen.has(key)); seen.add(key);
      const [whole, fraction = ''] = cost.Amount.split('.'), nanos = BigInt(whole + fraction.padEnd(10, '0'));
      total += nanos;
      if (nanos > 0n) items.push({ service: group.Keys[0], usageType: group.Keys[1], microUsd: Number((nanos + 9999n) / 10000n) });
    }
    check(Number((total + 9999n) / 10000n) === inspection.billing.microUsd);
  }
  const opening = { billing: inspection.billing, items };
  const refuseOpening = () => { throw Object.assign(new Error('D570 opening spend needs explanations'), { opening }); };
  if (!Array.isArray(explanations) || explanations.length !== items.length) refuseOpening();
  const seen = new Set(), matched = [];
  for (const explanation of explanations) {
    if (!explanation || Object.keys(explanation).sort().join(',') !== 'maxMicroUsd,reason,service,usageType'
      || !Number.isSafeInteger(explanation.maxMicroUsd) || explanation.maxMicroUsd < 0 || explanation.maxMicroUsd >= 10_000_000
      || typeof explanation.reason !== 'string' || explanation.reason.trim().length === 0 || explanation.reason.length > 1000) refuseOpening();
    const key = JSON.stringify([explanation.service, explanation.usageType]);
    const row = items.find(item => item.service === explanation.service && item.usageType === explanation.usageType);
    if (seen.has(key) || !row || row.microUsd > explanation.maxMicroUsd) refuseOpening();
    seen.add(key); matched.push({ ...row, maxMicroUsd: explanation.maxMicroUsd, reason: explanation.reason });
  }
  return { ...inspection, openingExplanations: matched };
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
    && typeof parameter.Value === 'string' && /^ami-[a-f0-9]{17}$/.test(parameter.Value), 'ssm parameter');
  const images = await read('ec2', 'describe-images', { ImageIds: [parameter.Value], Owners: [policy.officialImageOwner] });
  check(!images?.NextToken && Array.isArray(images?.Images) && images.Images.length === 1
    && images.Images[0]?.ImageId === parameter.Value, 'ec2 image');
  const input = { account, region, now, repository: { fullName: policy.repository, id: policy.repositoryId,
    ownerId: policy.repositoryOwnerId }, image: images.Images[0] };
  // Validate the provider image before any further discovery, using the renderer's same image contract.
  try { renderManualSetup({ ...input, s3PrefixListId: 'pl-00000000' }); }
  catch (error) {
    if (error instanceof Error && error.message === 'Unverified official ARM image') refuse('ec2 image');
    throw error;
  }
  const types = await read('ec2', 'describe-instance-types', { InstanceTypes: [policy.instanceType] });
  check(!types?.NextToken && Array.isArray(types?.InstanceTypes) && types.InstanceTypes.length === 1, 'ec2 capacity');
  const machine = types.InstanceTypes[0];
  check(machine?.InstanceType === policy.instanceType && machine.MemoryInfo?.SizeInMiB === 32768
    && machine.VCpuInfo?.DefaultVCpus === 8 && Array.isArray(machine.ProcessorInfo?.SupportedArchitectures)
    && machine.ProcessorInfo.SupportedArchitectures.includes('arm64')
    && Array.isArray(machine.SupportedUsageClasses) && machine.SupportedUsageClasses.includes('on-demand'), 'ec2 capacity');
  const prefixName = `com.amazonaws.${region}.s3`;
  const prefixes = await read('ec2', 'describe-managed-prefix-lists', { Filters: [
    { Name: 'prefix-list-name', Values: [prefixName] }, { Name: 'owner-id', Values: ['AWS'] }] });
  check(!prefixes?.NextToken && Array.isArray(prefixes?.PrefixLists) && prefixes.PrefixLists.length === 1, 'ec2 prefix');
  const prefix = prefixes.PrefixLists[0];
  check(prefix?.OwnerId === 'AWS' && prefix.PrefixListName === prefixName && prefix.AddressFamily === 'IPv4'
    && typeof prefix.PrefixListId === 'string' && /^pl-[0-9a-f]{8,17}$/.test(prefix.PrefixListId), 'ec2 prefix');
  return { ...inspection, template: renderManualSetup({ ...input, s3PrefixListId: prefix.PrefixListId }) };
}

async function readManualProtection(read, stackId, states) {
  const described = await read('cloudformation', 'describe-stacks', { StackName: stackId });
  check(!described?.NextToken && Array.isArray(described?.Stacks) && described.Stacks.length === 1
    && described.Stacks[0]?.StackId === stackId
    && ['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(described.Stacks[0].StackStatus), 'stack');
  const inventory = await read('cloudformation', 'describe-stack-resources', { StackName: stackId });
  check(!inventory?.NextToken && Array.isArray(inventory?.StackResources) && inventory.StackResources.length <= 100, 'stack resources');
  function resource(logicalId, type, pattern) {
    const rows = inventory.StackResources.filter(row => row?.LogicalResourceId === logicalId);
    check(rows.length === 1 && rows[0].StackId === stackId && rows[0].ResourceType === type
      && ['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(rows[0].ResourceStatus)
      && typeof rows[0].PhysicalResourceId === 'string' && pattern.test(rows[0].PhysicalResourceId), 'stack resources');
    return rows[0].PhysicalResourceId;
  }
  const bucket = resource('Bucket', 'AWS::S3::Bucket', /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/);
  const ruleName = resource('ExpiryRule', 'AWS::Events::Rule', /^[A-Za-z0-9_.-]{1,64}$/);
  const functionName = resource('ExpiryFunction', 'AWS::Lambda::Function', /^[A-Za-z0-9_-]{1,64}$/);
  // The explicit default bus and its exact rule ARN identify the bus even when the reply omits its name.
  const rule = await read('events', 'describe-rule', { Name: ruleName, EventBusName: 'default' });
  check(rule?.Name === ruleName && rule.Arn === `arn:aws:events:${region}:${account}:rule/${ruleName}`
    && states.includes(rule.State) && rule.ScheduleExpression === 'rate(1 minute)'
    && (rule.EventBusName === undefined || rule.EventBusName === 'default') && !rule.EventPattern, 'events rule');
  const targets = await read('events', 'list-targets-by-rule', { Rule: ruleName, EventBusName: 'default', Limit: 100 });
  check(!targets?.NextToken && Array.isArray(targets?.Targets) && targets.Targets.length === 1, 'events targets');
  const target = targets.Targets[0];
  check(target?.Id === 'D570Expiry' && target.Arn === `arn:aws:lambda:${region}:${account}:function:${functionName}`
    && target.RetryPolicy?.MaximumEventAgeInSeconds === 60 && target.RetryPolicy.MaximumRetryAttempts === 0
    && !Object.hasOwn(target, 'Input') && !Object.hasOwn(target, 'InputPath') && !Object.hasOwn(target, 'InputTransformer'), 'events targets');
  return { bucket, ruleName };
}

export async function inspectManualProtection(options) {
  const check = (value, reason = 's3 object') => checkControl(value, reason);
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
  try { heartbeat = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(object.Body)); } catch { refuse('s3 object'); }
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
  const check = (value, reason = 's3 ledger') => checkControl(value, reason);
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
  const check = (value, reason = 'booking') => checkControl(value, reason);
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
    let source; try { source = new URL(item.source); } catch { refuse('booking'); }
    check(source.protocol === 'https:' && ['pricing.us-east-1.amazonaws.com', 'aws.amazon.com'].includes(source.hostname)
      && !source.username && !source.password && !source.port && !source.search && !source.hash);
    upperMicroUsd += item.upperMicroUsd;
    check(Number.isSafeInteger(upperMicroUsd) && upperMicroUsd < 10_000_000);
  }
  check(typeof directory === 'string' && directory === resolve(directory));
  const parent = await lstat(dirname(directory));
  check(parent.isDirectory() && (parent.mode & 0o777) === 0o700 && parent.uid === process.getuid());
  const inspection = await inspectManualSetup(options);
  if (options.expectedOpening) check(isDeepStrictEqual(inspection.billing, options.expectedOpening));
  check(inspection.billing.microUsd + upperMicroUsd < 10_000_000);
  // Keep even incomplete bookings: an uncertain write must never erase setup's reserved cost.
  await mkdir(directory, { mode: 0o700 });
  const file = await open(join(directory, 'setup.json'), 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify({ ...inspection, cost, upperMicroUsd,
      ...(options.openingExplanations === undefined ? {} : { openingExplanations: options.openingExplanations }),
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
  return { ...inspection, directory, cost, upperMicroUsd,
    ...(options.openingExplanations === undefined ? {} : { openingExplanations: options.openingExplanations }) };
}

export async function bookManualFirstSetup(options) {
  const check = (value, reason = 'booking') => checkControl(value, reason);
  check(['cost', 'priceInputs', 'quantities', 'fixed'].every(name => options[name] === undefined));
  return bookManualSetup({ ...options, priceInputs: firstSetupPriceInputs(options.catalogues) });
}

function firstSetupPriceInputs(catalogues) {
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
  return { catalogues, quantities, fixed };
}

export async function createManualFirstSetup(options) {
  const check = (value, reason = 'stack') => checkControl(value, reason);
  const { aws, checkout, now, clock = Date.now, sleep = delay } = options;
  const opening = await inspectManualOpening(options);
  const booking = await bookManualFirstSetup({ ...options, expectedOpening: opening.billing,
    openingExplanations: opening.openingExplanations });
  async function unchanged() {
    const before = clock(), source = await checkedMain(checkout), after = clock();
    check(source.head === booking.head && source.tree === booking.tree
      && Number.isSafeInteger(before) && Number.isSafeInteger(after) && before >= instant(now) && after >= before
      && after < Date.parse(policy.accessExpiry) && iso(after).slice(0, 10) === now.slice(0, 10), 'setup time');
  }
  async function call(service, operation, input) {
    await unchanged();
    const result = await aws.call(service, operation, input);
    await unchanged();
    return result;
  }
  const templateBody = JSON.stringify(booking.template);
  check(Buffer.byteLength(templateBody) <= 51200, 'setup template');
  const request = { StackName: 'd570-first', TemplateBody: templateBody, Capabilities: ['CAPABILITY_IAM'],
    Tags: [{ Key: 'Proof', Value: 'D570' }], TimeoutInMinutes: 10, OnFailure: 'ROLLBACK',
    ClientRequestToken: 'd570-' + createHash('sha256').update(JSON.stringify({ head: booking.head, tree: booking.tree, now })).digest('hex') };
  const created = await call('cloudformation', 'create-stack', request), stackId = created?.StackId;
  check(typeof stackId === 'string'
    && /^arn:aws:cloudformation:eu-north-1:462991287391:stack\/d570-first\/[a-f0-9-]{36}$/.test(stackId), 'stack id');
  async function failedStack(status) {
    const statuses = ['CREATE_IN_PROGRESS', 'CREATE_FAILED', 'ROLLBACK_IN_PROGRESS', 'ROLLBACK_FAILED', 'ROLLBACK_COMPLETE',
      'DELETE_IN_PROGRESS', 'DELETE_FAILED', 'DELETE_COMPLETE', 'UPDATE_IN_PROGRESS', 'UPDATE_COMPLETE',
      'UPDATE_ROLLBACK_IN_PROGRESS', 'UPDATE_ROLLBACK_FAILED', 'UPDATE_ROLLBACK_COMPLETE'];
    let reason = 'stack status ' + (statuses.includes(status) ? status : 'unrecognized');
    try {
      const events = await call('cloudformation', 'describe-stack-events', { StackName: stackId });
      if (!Array.isArray(events?.StackEvents) || events.StackEvents.length > 1000) throw new Error('invalid events');
      if (events.NextToken !== undefined && events.NextToken !== null) {
        if (typeof events.NextToken !== 'string' || !events.NextToken || events.NextToken.length > 1024) throw new Error('invalid event page');
        reason += '; failure events truncated';
      }
      const event = events.StackEvents.filter(row => row?.StackId === stackId
        && Object.hasOwn(booking.template.Resources, row.LogicalResourceId)
        && row.ResourceStatus === 'CREATE_FAILED' && typeof row.ResourceStatusReason === 'string'
        && row.ResourceStatusReason !== 'Resource creation cancelled').at(-1);
      if (event) {
        reason += '; ' + event.LogicalResourceId + ': ';
        if (event.ResourceStatusReason.includes('Specified ReservedConcurrentExecutions')
          && event.ResourceStatusReason.includes('UnreservedConcurrentExecution')
          && event.ResourceStatusReason.includes('minimum value')) reason += 'Lambda reserved concurrency exceeds account allowance';
        else {
          const path = join(dirname(options.directory), 'setup-failure.json');
          try {
            await privateWrite(path, JSON.stringify({ stackId, logicalResourceId: event.LogicalResourceId,
              reason: event.ResourceStatusReason.slice(0, 1024) }) + '\n');
          } catch (error) {
            if (error.code !== 'EEXIST' || (await privateJson(path)).stackId !== stackId) throw error;
          }
          reason += 'failure details in ' + path;
        }
      }
    } catch { reason += '; failure event unavailable'; }
    refuse(reason);
  }
  for (let attempt = 0; ; attempt++) {
    const response = await call('cloudformation', 'describe-stacks', { StackName: stackId });
    check(!response?.NextToken && Array.isArray(response?.Stacks) && response.Stacks.length === 1
      && response.Stacks[0]?.StackId === stackId, 'stack status');
    const status = response.Stacks[0].StackStatus;
    if (status === 'CREATE_COMPLETE') break;
    if (status !== 'CREATE_IN_PROGRESS' || attempt >= 39) await failedStack(status);
    await sleep(15000);
  }
  const { ruleName } = await readManualProtection(call, stackId, ['DISABLED', 'ENABLED']);
  await call('events', 'enable-rule', { Name: ruleName, EventBusName: 'default' });
  for (let attempt = 0; ; attempt++) {
    await unchanged();
    try {
      const protection = await inspectManualProtection({ ...options, stackId });
      await unchanged();
      check(protection.billing.microUsd <= booking.billing.microUsd + booking.upperMicroUsd);
      return { ...booking, ...protection, openingBilling: booking.billing };
    } catch (error) {
      if (error.name !== 'NoSuchKey' || error.$metadata?.httpStatusCode !== 404) throw error;
      check(attempt < 7);
      await sleep(15000);
    }
  }
}

export async function initializeManualFirstSetup(options) {
  const check = (value, reason = 's3 ledger') => checkControl(value, reason);
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
  const openings = {}, cursor = new Date(instant(now));
  const until = instant(now) + 31 * 86400_000 + 300_000;
  cursor.setUTCDate(1); cursor.setUTCHours(0, 0, 0, 0);
  while (cursor.getTime() <= until) {
    const month = cursor.toISOString().slice(0, 7);
    const baselineMicroUsd = month === now.slice(0, 7) ? setup.openingBilling.microUsd : 0;
    openings[month] = { baselineMicroUsd, overheadMicroUsd: setup.upperMicroUsd - runMicroUsd,
      digest: createHash('sha256').update(JSON.stringify({ month, baselineMicroUsd, billing: setup.openingBilling,
        cost: setup.cost, openingExplanations: setup.openingExplanations })).digest('hex') };
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
  const check = (value, reason = 'ec2 launch') => checkControl(value, reason);
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
  const check = (value, reason = 'ec2 observation') => checkControl(value, reason);
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
    check(instance?.InstanceId === launch.instanceId && instance.ClientToken === reservation.uuid
      && instance.SubnetId === launch.subnetId && instance.InstanceType === 'm7g.2xlarge'
      && !instance.PublicIpAddress && !instance.IamInstanceProfile && !instance.KeyName
      && instance.RootDeviceName === '/dev/xvda' && instance.RootDeviceType === 'ebs');
    const expectedTags = { Proof: 'D570', Stack: launch.stackId, Run: reservation.uuid, ExpiresAt: reservation.expiry };
    check(Array.isArray(instance.Tags) && Object.entries(expectedTags).every(([key, value]) => {
      const matches = instance.Tags.filter(tag => tag?.Key === key);
      return matches.length === 1 && matches[0].Value === value;
    }));
    if (instance.State?.Name === 'pending') pending('D570_NOT_READY', 'readiness pending');
    check(instance.State?.Name === 'running');
    check(Array.isArray(instance.BlockDeviceMappings) && instance.BlockDeviceMappings.length === 1
      && Array.isArray(instance.NetworkInterfaces) && instance.NetworkInterfaces.length === 1);
    const disk = instance.BlockDeviceMappings[0], network = instance.NetworkInterfaces[0];
    check(disk?.DeviceName === '/dev/xvda' && disk.Ebs?.DeleteOnTermination === true && disk.Ebs.Status === 'attached'
      && typeof disk.Ebs.VolumeId === 'string' && /^vol-[a-f0-9]{17}$/.test(disk.Ebs.VolumeId));
    // DescribeInstances nests the attachment under the already checked instance.
    check(typeof network?.NetworkInterfaceId === 'string' && /^eni-[a-f0-9]{17}$/.test(network.NetworkInterfaceId)
      && network.OwnerId === account && network.SubnetId === launch.subnetId && network.Status === 'in-use' && !network.Association
      && (!network.Ipv6Addresses || Array.isArray(network.Ipv6Addresses) && network.Ipv6Addresses.length === 0)
      && Array.isArray(network.Groups) && network.Groups.length === 1 && network.Groups[0].GroupId === launch.groupId
      && (network.Attachment?.InstanceId === undefined || network.Attachment.InstanceId === launch.instanceId)
      && network.Attachment?.DeviceIndex === 0
      && network.Attachment.Status === 'attached' && network.Attachment.DeleteOnTermination === true);
    return { volumeIds: [disk.Ebs.VolumeId], interfaceIds: [network.NetworkInterfaceId] };
  }
  const resources = await liveResources();
  const shutdown = await call('describe-instance-attribute', { InstanceId: launch.instanceId, Attribute: 'instanceInitiatedShutdownBehavior' });
  check(shutdown?.InstanceId === launch.instanceId && shutdown.InstanceInitiatedShutdownBehavior?.Value === 'terminate');
  // The CLI decodes console bytes; a line seen only after termination cannot establish live readiness.
  const consoleOutput = await call('get-console-output', { InstanceId: launch.instanceId, Latest: true });
  const timestamp = Date.parse(consoleOutput?.Timestamp);
  check(consoleOutput?.InstanceId === launch.instanceId);
  if (consoleOutput.Output === undefined || consoleOutput.Output === '') pending('D570_NOT_READY', 'readiness pending');
  check(Number.isFinite(timestamp)
    && timestamp >= instant(reservation.startedAt) && timestamp <= clock()
    && typeof consoleOutput.Output === 'string' && Buffer.byteLength(consoleOutput.Output) <= 1024 * 1024);
  const prefix = `D570_DEADLINE_READY ${reservation.uuid} ${instant(launch.guestExpiry) / 1000} `;
  const lines = consoleOutput.Output.split(/\r?\n/).filter(line => line.startsWith(prefix));
  const boots = new Set(lines.map(line => line.slice(prefix.length)));
  if (boots.size === 0) {
    check(!consoleOutput.Output.split(/\r?\n/).some(line => line.startsWith('D570_DEADLINE_READY ')));
    pending('D570_NOT_READY', 'readiness pending');
  }
  check(boots.size === 1 && [...boots].every(boot => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(boot)));
  check(isDeepStrictEqual(await liveResources(), resources));
  return { ...launch, ...inspection, ...resources, bootId: [...boots][0], consoleOutput,
    observedAt: iso(Math.floor(await unchanged() / 1000) * 1000) };
}

export async function observeManualFirstShutdown(options) {
  const check = (value, reason = 'ec2 observation') => checkControl(value, reason);
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
  refuse('ec2 observation');
}

export async function inspectManualFirstGuestCleanup(options) {
  const check = (value, reason = 'ec2 cleanup') => checkControl(value, reason);
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
  check(!volumes?.NextToken && Array.isArray(volumes?.Volumes));
  if (volumes.Volumes.length) {
    check(volumes.Volumes.every(row => ready.volumeIds.includes(row?.VolumeId)));
    pending('D570_CLEANUP_PENDING', 'cleanup pending');
  }
  // Interfaces are not tagged by the template; the owned subnet also exposes leftovers after controller loss.
  const interfaces = await call('describe-network-interfaces', { Filters: [{ Name: 'subnet-id', Values: [ready.subnetId] }], MaxResults: 100 });
  check(!interfaces?.NextToken && Array.isArray(interfaces?.NetworkInterfaces));
  if (interfaces.NetworkInterfaces.length) {
    check(interfaces.NetworkInterfaces.every(row => ready.interfaceIds.includes(row?.NetworkInterfaceId)
      && row.SubnetId === ready.subnetId && row.OwnerId === account));
    pending('D570_CLEANUP_PENDING', 'cleanup pending');
  }
  // An OS actor and absent resources do not establish when the guest stopped or reconcile its bill.
  return { ...ready, ...inspection, stateReason: instance.StateReason, terminated: true, volumesAbsent: true, interfacesAbsent: true,
    observedAt: iso(Math.floor(await unchanged() / 1000) * 1000) };
}

export async function inspectManualFirstBilling(options) {
  const check = (value, reason = 'ce grouped shape') => checkControl(value, reason);
  const { checkout, aws, now, clock = Date.now } = options;
  const setup = structuredClone(options.setup), launch = structuredClone(options.launch);
  const inspection = await inspectManualBudget({ ...options, stackId: setup?.stackId, store: undefined });
  const reservation = launch?.reservation;
  check(setup.account === account && setup.region === region && setup.head === reservation?.head && setup.tree === reservation.tree
    && setup.bucket === inspection.bucket && launch.account === account && launch.region === region
    && launch.stackId === setup.stackId && launch.bucket === inspection.bucket
    && launch.head === setup.head && launch.tree === setup.tree
    && reservation?.uuid === inspection.budget.activeUuid
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
  const store = createManualLedgerStore({ bucket: inspection.bucket, aws: guarded });
  const saved = await store.get('d570/ledger/active.json');
  check(saved);
  const retained = JSON.parse(saved.body).active;
  check(retained && ['uuid', 'head', 'tree', 'startedAt', 'expiry', 'liabilityUntil']
    .every(key => retained.identity[key] === reservation[key])
    && retained.upperMicroUsd === reservation.upperMicroUsd && retained.evidenceHash === reservation.evidenceHash
    && isDeepStrictEqual(retained.months, reservation.months));
  const openingMonth = setup.openingBilling?.period?.Start?.slice(0, 7);
  const baselineMicroUsd = setup.openingBilling?.microUsd;
  check(retained.evidence.openings[openingMonth]?.digest === createHash('sha256').update(JSON.stringify({
    month: openingMonth, baselineMicroUsd, billing: setup.openingBilling, cost: setup.cost,
    openingExplanations: setup.openingExplanations })).digest('hex'));
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

const removalExport = Symbol('owned removal export');

export async function retainManualHistory(options) {
  const check = (value, reason = 'private history') => checkControl(value, reason);
  const { checkout, directory, aws, now, clock = Date.now } = options, cleanup = options[removalExport];
  check(typeof directory === 'string' && directory === resolve(directory));
  const parent = await lstat(dirname(directory));
  check(parent.isDirectory() && (parent.mode & 0o777) === 0o700 && parent.uid === process.getuid());
  const root = await realpath(checkout), destination = join(await realpath(dirname(directory)), basename(directory));
  check(destination !== root && !destination.startsWith(root + '/'));
  const inspection = cleanup ? { ...cleanup.inspection, stackId: options.stackId, bucket: cleanup.bucket }
    : await inspectManualBudget({ ...options, store: undefined });
  async function unchanged() {
    const before = clock(), source = await checkedMain(checkout), after = clock();
    check(source.head === inspection.head && source.tree === inspection.tree
      && Number.isSafeInteger(before) && Number.isSafeInteger(after) && before >= instant(now) && after >= before
      && after < Date.parse(policy.accessExpiry) && iso(after).slice(0, 10) === now.slice(0, 10)
      && (cleanup || after - Date.parse(inspection.heartbeat.startedAt) < 120_000));
  }
  const guarded = { async call(...args) {
    await unchanged(); const result = await aws.call(...args); await unchanged(); return result;
  } };
  let existing;
  if (cleanup) {
    try { existing = await lstat(directory); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existing) check(existing.isDirectory() && existing.uid === process.getuid() && (existing.mode & 0o777) === 0o700);
  }
  const store = inspection.bucket ? createManualLedgerStore({ bucket: inspection.bucket, aws: guarded }) : null;
  const keys = store ? (await store.list()).sort() : [], records = new Map(), repairs = new Set();
  const scope = { account, region, stackId: inspection.stackId };
  for (const key of keys) {
    const row = await store.get(key); check(row);
    if (cleanup) check(isDeepStrictEqual(JSON.parse(row.body).scope, scope));
    records.set(key, { body: Buffer.from(row.body), etag: row.etag });
  }
  let bookingBytes;
  if (cleanup) {
    bookingBytes = await readFile(join(cleanup.setup.directory, 'setup.json'));
    const booking = JSON.parse(bookingBytes);
    check(booking.account === account && booking.region === region
      && booking.head === cleanup.setup.head && booking.tree === cleanup.setup.tree);
  }
  if (existing) {
    const names = await readdir(directory); check(names.length <= 15);
    for (const name of names) {
      check(name === 'setup.json' || name === 'active.json' || /^\d{4}-(0[1-9]|1[0-2])\.json$/.test(name));
      const path = join(directory, name), info = await lstat(path);
      check(info.isFile() && info.uid === process.getuid() && (info.mode & 0o777) === 0o600 && info.size <= 1024 * 1024);
      const body = await readFile(path), key = 'd570/ledger/' + name;
      let value;
      try { value = JSON.parse(body); }
      catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        check(name === 'setup.json' || records.has(key)); repairs.add(name); continue;
      }
      if (name === 'setup.json') { check(body.equals(bookingBytes)); continue; }
      check(isDeepStrictEqual(value.scope, scope));
      if (records.has(key)) check(records.get(key).body.equals(body));
      else records.set(key, { body, etag: '"private-export"' });
    }
  }
  // Validate exactly the bytes retained locally, rather than a different set of live reads.
  const snapshot = { async list() { return [...records.keys()]; }, async get(key) { return records.get(key) ?? null; } };
  if (!cleanup) {
    const budget = await inspectBudget({ scope, now, billingMicroUsd: inspection.billing.microUsd, store: snapshot });
    check(isDeepStrictEqual(budget, inspection.budget));
  } else if (records.has('d570/ledger/active.json')) {
    const active = JSON.parse(records.get('d570/ledger/active.json').body);
    if (active.active) check(active.active.identity.head === cleanup.setup.head && active.active.identity.tree === cleanup.setup.tree);
    if (!active.active || active.active.state === 'reserved') {
      const lastMonth = Object.keys(active.monthHeads).sort().at(-1);
      check(typeof lastMonth === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(lastMonth));
      const end = new Date(lastMonth + '-01T00:00:00Z'); end.setUTCMonth(end.getUTCMonth() + 1);
      const validationNow = iso(Math.min(instant(now), end.getTime() - 1000));
      await inspectBudget({ scope, now: validationNow, billingMicroUsd: 0, store: snapshot });
    }
  }
  if (store) {
    check(isDeepStrictEqual((await store.list()).sort(), keys));
    for (const [key, row] of records) {
      if (!keys.includes(key)) continue;
      const current = await store.get(key);
      check(current && current.etag === row.etag && Buffer.from(current.body).equals(row.body));
    }
  }
  await unchanged();
  const latestParent = await lstat(dirname(directory));
  check(latestParent.isDirectory() && (latestParent.mode & 0o777) === 0o700 && latestParent.uid === process.getuid());
  try { await mkdir(directory, { mode: 0o700 }); }
  catch (error) { if (!cleanup || error.code !== 'EEXIST') throw error; }
  const created = await lstat(directory);
  check(created.isDirectory() && (created.mode & 0o777) === 0o700 && created.uid === process.getuid());
  const bodies = new Map([...(cleanup ? [['setup.json', bookingBytes]] : []),
    ...[...records].map(([key, row]) => [key.slice('d570/ledger/'.length), row.body])]);
  for (const [name, body] of bodies) {
    const path = join(directory, name); let handle;
    try {
      try { handle = await open(path, 'wx', 0o600); }
      catch (error) {
        if (!cleanup || error.code !== 'EEXIST') throw error;
        if (repairs.has(name)) {
          handle = await open(path, constants.O_WRONLY | constants.O_NOFOLLOW);
          const info = await handle.stat();
          check(info.isFile() && info.uid === process.getuid() && (info.mode & 0o777) === 0o600);
          await handle.truncate(0);
        }
      }
      if (handle) {
        await handle.writeFile(body); await handle.sync();
        const info = await handle.stat();
        check(info.isFile() && (info.mode & 0o777) === 0o600 && info.uid === process.getuid() && info.size === body.byteLength);
      }
    } finally { if (handle) await handle.close(); }
    const info = await lstat(path);
    check(info.isFile() && (info.mode & 0o777) === 0o600 && info.uid === process.getuid() && (await readFile(path)).equals(body));
  }
  for (const path of [directory, dirname(directory)]) {
    const handle = await open(path, 'r'); try { await handle.sync(); } finally { await handle.close(); }
  }
  await unchanged();
  return { ...inspection, directory, files: [...bodies.keys()] };
}

async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function replacePrivateJson(path, value) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    await privateWrite(temporary, JSON.stringify(value) + '\n');
    if (await exists(path)) await privateJson(path);
    await rename(temporary, path);
    const parent = await open(dirname(path), 'r');
    try { await parent.sync(); } finally { await parent.close(); }
  } finally { await rm(temporary, { force: true }); }
}

async function readCleanup(base) {
  const path = join(base, 'setup-removal.json');
  if (!await exists(path)) return null;
  const record = await privateJson(path), booking = await privateJson(join(base, 'setup', 'setup.json'));
  check(record?.schema === 'd570-cleanup-v1' && record.account === account && record.region === region
    && record.head === booking.head && record.tree === booking.tree && record.upperMicroUsd === booking.upperMicroUsd
    && isDeepStrictEqual(record.billing, booking.billing) && typeof record.eligible === 'boolean'
    && typeof record.stackId === 'string'
    && /^arn:aws:cloudformation:eu-north-1:462991287391:stack\/d570-first\/[a-f0-9-]{36}$/.test(record.stackId)
    && (record.releasedAt === null || record.eligible && instant(record.releasedAt) > 0), 'private history');
  if (record.releasedAt) {
    const history = join(base, 'history'), info = await lstat(history);
    check(info.isDirectory() && info.uid === process.getuid() && (info.mode & 0o777) === 0o700
      && isDeepStrictEqual((await readdir(history)).sort(), ['setup.json'])
      && !await exists(join(base, 'initialized.json')) && !await exists(join(base, 'launch.json')), 'private history');
    await privateJson(join(history, 'setup.json'));
    check((await readFile(join(history, 'setup.json'))).equals(await readFile(join(base, 'setup', 'setup.json'))), 'private history');
  }
  return record;
}

export async function removeManualFirstSetup(options) {
  const check = (value, reason = 'ec2 cleanup') => checkControl(value, reason);
  const { checkout, aws, directory, now, clock = Date.now, sleep = delay } = options;
  const setup = structuredClone(options.setup), inspection = await inspectManualOwner(options, false);
  check(setup?.account === account && setup.region === region && /^[a-f0-9]{40}$/.test(setup.head)
    && /^[a-f0-9]{40}$/.test(setup.tree) && setup.template?.Resources
    && typeof setup.directory === 'string' && setup.directory === resolve(setup.directory));
  const base = dirname(setup.directory), cleanupPath = join(base, 'setup-removal.json'), priorCleanup = await readCleanup(base);
  async function call(service, operation, input) {
    async function unchanged() {
      const source = await checkedMain(checkout), at = clock();
      check(source.head === inspection.head && source.tree === inspection.tree && Number.isSafeInteger(at)
        && at >= instant(now) && at < Date.parse(policy.accessExpiry) && iso(at).slice(0, 10) === now.slice(0, 10));
    }
    await unchanged();
    const response = await aws.call(service, operation, input);
    await unchanged();
    return response;
  }
  const described = await call('cloudformation', 'describe-stacks', { StackName: setup.stackId ?? priorCleanup?.stackId ?? 'd570-first' });
  check(!described?.NextToken && Array.isArray(described?.Stacks) && described.Stacks.length === 1);
  const stack = described.Stacks[0], stackId = stack?.StackId;
  check(typeof stackId === 'string' && /^arn:aws:cloudformation:eu-north-1:462991287391:stack\/d570-first\/[a-f0-9-]{36}$/.test(stackId)
    && (!setup.stackId || setup.stackId === stackId)
    && Array.isArray(stack.Tags) && stack.Tags.filter(row => row?.Key === 'Proof' && row.Value === 'D570').length === 1
    && Date.parse(stack.CreationTime) >= instant(setup.openingBilling?.observedAt ?? setup.billing.observedAt)
    && Date.parse(stack.CreationTime) <= clock());
  if (priorCleanup) check(priorCleanup.stackId === stackId);
  async function waitForDeletion() {
    for (let attempt = 0; attempt < 40; attempt++) {
      const result = await call('cloudformation', 'describe-stacks', { StackName: stackId });
      check(!result?.NextToken && Array.isArray(result?.Stacks) && result.Stacks.length === 1 && result.Stacks[0].StackId === stackId);
      if (result.Stacks[0].StackStatus === 'DELETE_COMPLETE') return;
      check(result.Stacks[0].StackStatus === 'DELETE_IN_PROGRESS', 'stack deletion status'); await sleep(15000);
    }
    refuse('stack deletion pending');
  }
  if (priorCleanup && stack.StackStatus === 'DELETE_IN_PROGRESS') { await waitForDeletion(); stack.StackStatus = 'DELETE_COMPLETE'; }
  if (stack.StackStatus === 'ROLLBACK_IN_PROGRESS') refuse('stack cleanup status ROLLBACK_IN_PROGRESS; wait for rollback to finish');
  check(['CREATE_COMPLETE', 'CREATE_FAILED', 'ROLLBACK_COMPLETE', 'ROLLBACK_FAILED', 'UPDATE_COMPLETE',
    'DELETE_FAILED'].includes(stack.StackStatus) || priorCleanup && stack.StackStatus === 'DELETE_COMPLETE', 'stack cleanup status');
  const inventory = await call('cloudformation', 'describe-stack-resources', { StackName: stackId });
  check(!inventory?.NextToken && Array.isArray(inventory?.StackResources) && inventory.StackResources.length <= 100);
  const resources = new Map();
  for (const row of inventory.StackResources) {
    check(row?.StackId === stackId && !resources.has(row.LogicalResourceId)
      && setup.template.Resources[row.LogicalResourceId]?.Type === row.ResourceType);
    if (row.ResourceStatus !== 'DELETE_COMPLETE') resources.set(row.LogicalResourceId, row);
  }
  function resource(name, pattern) {
    const row = resources.get(name);
    if (!row) { check(stack.StackStatus !== 'CREATE_COMPLETE' && stack.StackStatus !== 'UPDATE_COMPLETE'); return null; }
    check(typeof row.PhysicalResourceId === 'string' && pattern.test(row.PhysicalResourceId));
    return row.PhysicalResourceId;
  }
  const bucket = resource('Bucket', /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/);
  const subnet = resource('Subnet', /^subnet-[a-f0-9]{17}$/);
  const rule = resource('ExpiryRule', /^[A-Za-z0-9_.-]{1,64}$/);
  if (subnet) {
    const instances = await call('ec2', 'describe-instances', { Filters: [{ Name: 'subnet-id', Values: [subnet] }], MaxResults: 100 });
    check(!instances?.NextToken && Array.isArray(instances?.Reservations));
    for (const row of instances.Reservations) {
      check(row?.OwnerId === account && Array.isArray(row.Instances));
      for (const instance of row.Instances) check(instance?.SubnetId === subnet && instance.State?.Name === 'terminated');
    }
    const interfaces = await call('ec2', 'describe-network-interfaces', { Filters: [{ Name: 'subnet-id', Values: [subnet] }], MaxResults: 100 });
    check(!interfaces?.NextToken && Array.isArray(interfaces?.NetworkInterfaces) && interfaces.NetworkInterfaces.length === 0);
  }
  const volumes = await call('ec2', 'describe-volumes', { Filters: [
    { Name: 'tag:Proof', Values: ['D570'] }, { Name: 'tag:Stack', Values: [stackId] }], MaxResults: 100 });
  check(!volumes?.NextToken && Array.isArray(volumes?.Volumes) && volumes.Volumes.length === 0);
  const retained = await retainManualHistory({ ...options, aws: { call }, stackId,
    [removalExport]: { inspection, setup, bucket } });
  const keys = retained.files.filter(name => name === 'active.json' || /^\d{4}-(0[1-9]|1[0-2])\.json$/.test(name))
    .map(name => 'd570/ledger/' + name);
  if (rule) {
    await call('events', 'disable-rule', { Name: rule, EventBusName: 'default' });
    const disabled = await call('events', 'describe-rule', { Name: rule, EventBusName: 'default' });
    check(disabled?.Name === rule && disabled.State === 'DISABLED');
    const start = clock(); await sleep(120000); check(clock() >= start + 120000);
  }
  if (bucket) {
    const contents = await call('s3api', 'list-objects-v2', { Bucket: bucket, ExpectedBucketOwner: account, Prefix: 'd570/', MaxKeys: 1000 });
    check(contents?.IsTruncated === false && !contents.NextContinuationToken && Array.isArray(contents.Contents ?? []));
    const objects = (contents.Contents ?? []).map(row => ({ Key: row?.Key }));
    check(objects.length <= 1000 && new Set(objects.map(row => row.Key)).size === objects.length
      && objects.every(row => typeof row.Key === 'string' && (row.Key === 'd570/health/reaper.json' || keys.includes(row.Key))));
    if (objects.length) {
      const removed = await call('s3api', 'delete-objects', { Bucket: bucket, ExpectedBucketOwner: account,
        Delete: { Objects: objects, Quiet: false } });
      check(!removed?.Errors?.length && Array.isArray(removed?.Deleted)
        && isDeepStrictEqual(removed.Deleted.map(row => row.Key).sort(), objects.map(row => row.Key).sort()));
    }
    const empty = await call('s3api', 'list-objects-v2', { Bucket: bucket, ExpectedBucketOwner: account, Prefix: 'd570/', MaxKeys: 1000 });
    check(empty?.IsTruncated === false && !empty.NextContinuationToken && (empty.Contents ?? []).length === 0);
  }
  const noRun = !await exists(join(base, 'initialized.json')) && !await exists(join(base, 'launch.json'))
    && isDeepStrictEqual(retained.files, ['setup.json']);
  const eligible = noRun && (priorCleanup?.eligible ?? ['CREATE_FAILED', 'ROLLBACK_COMPLETE', 'ROLLBACK_FAILED'].includes(stack.StackStatus));
  const record = priorCleanup ?? { schema: 'd570-cleanup-v1', account, region, stackId, head: setup.head, tree: setup.tree,
    billing: setup.billing, upperMicroUsd: setup.upperMicroUsd, subnet, eligible, releasedAt: null };
  check(!record.eligible || eligible, 'booking');
  await replacePrivateJson(cleanupPath, record);
  if (stack.StackStatus !== 'DELETE_COMPLETE') {
    await call('cloudformation', 'delete-stack', { StackName: stackId });
    await waitForDeletion();
  }
  const remaining = await call('ec2', 'describe-volumes', { Filters: [
    { Name: 'tag:Proof', Values: ['D570'] }, { Name: 'tag:Stack', Values: [stackId] }], MaxResults: 100 });
  check(!remaining?.NextToken && Array.isArray(remaining?.Volumes) && remaining.Volumes.length === 0);
  if (record.subnet) {
    check(/^subnet-[a-f0-9]{17}$/.test(record.subnet));
    const instances = await call('ec2', 'describe-instances', { Filters: [{ Name: 'subnet-id', Values: [record.subnet] }], MaxResults: 100 });
    check(!instances?.NextToken && Array.isArray(instances?.Reservations));
    for (const row of instances.Reservations) {
      check(row?.OwnerId === account && Array.isArray(row.Instances));
      for (const instance of row.Instances) check(instance?.SubnetId === record.subnet && instance.State?.Name === 'terminated');
    }
    const interfaces = await call('ec2', 'describe-network-interfaces', { Filters: [{ Name: 'subnet-id', Values: [record.subnet] }], MaxResults: 100 });
    check(!interfaces?.NextToken && Array.isArray(interfaces?.NetworkInterfaces) && interfaces.NetworkInterfaces.length === 0);
  }
  const deletedAt = iso(Math.floor(clock() / 1000) * 1000);
  await replacePrivateJson(cleanupPath, { ...record, deletedAt, releasedAt: eligible ? deletedAt : null,
    reason: eligible ? 'failed setup removed without a run' : 'setup removed; booking retained' });
  return { ...inspection, stackId, directory, deleted: true };
}

async function privateWrite(path, body) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(body); await file.sync(); } finally { await file.close(); }
  const parent = await open(dirname(path), 'r');
  try { await parent.sync(); } finally { await parent.close(); }
}

async function privateJson(path) {
  const check = (value, reason = 'private history') => checkControl(value, reason);
  const info = await lstat(path);
  check(info.isFile() && info.uid === process.getuid() && (info.mode & 0o777) === 0o600 && info.size > 0 && info.size <= 1024 * 1024);
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function runManualCommand(options) {
  return mainChecks.run({ checkout: await realpath(options.checkout) }, () => runManualCommandInContext(options));
}

async function runManualCommandInContext(options) {
  const { args, checkout, clock = Date.now, sleep = delay } = options;
  check(Array.isArray(args) && ['up', 'drill', 'reconcile', 'down'].includes(args[0]));
  const [command, directory, ...flags] = args;
  check(typeof directory === 'string' && directory === resolve(directory));
  const info = await lstat(directory), root = await realpath(checkout);
  let base = await realpath(directory);
  check(info.isDirectory() && info.uid === process.getuid() && (info.mode & 0o777) === 0o700
    && base !== root && !base.startsWith(root + '/'));
  const explanations = [];
  check(command === 'up' || flags.length === 0);
  for (let index = 0; index < flags.length; index += 5) {
    check(flags[index] === '--explain' && flags.slice(index, index + 5).length === 5
      && /^(0|[1-9]\d{0,7})$/.test(flags[index + 3]));
    explanations.push({ service: flags[index + 1], usageType: flags[index + 2],
      maxMicroUsd: Number(flags[index + 3]), reason: flags[index + 4] });
  }
  const stamp = () => iso(Math.floor(clock() / 1000) * 1000);
  const common = { checkout, region: options.region ?? region, environment: options.environment ?? process.env, clock, sleep };
  const provider = options.aws ?? createManualAwsCli();
  const initial = await inspectManualOwner({ ...common, now: stamp(), aws: provider }, false);
  for (;;) {
    const cleanup = await readCleanup(base);
    if (!cleanup?.releasedAt) break;
    check(!await exists(join(base, 'initialized.json')) && !await exists(join(base, 'launch.json')), 'booking');
    const child = join(base, 'retry');
    if (!await exists(child)) {
      if (command !== 'up') break;
      try { await mkdir(child, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    const childInfo = await lstat(child);
    check(childInfo.isDirectory() && childInfo.uid === process.getuid() && (childInfo.mode & 0o777) === 0o700, 'private history');
    base = child;
  }
  const aws = { async call(...request) {
    async function unchanged() {
      const source = await checkedMain(checkout);
      check(source.head === initial.head && source.tree === initial.tree);
    }
    await unchanged();
    if (['create-stack', 'run-instances', 'put-object', 'enable-rule', 'disable-rule', 'delete-objects', 'delete-stack'].includes(request[1])) {
      await checkedMain(checkout, { forceRemote: true });
    }
    const response = await provider.call(...request); await unchanged(); return response;
  } };
  const fresh = () => ({ ...common, aws, now: stamp() });
  const save = (name, value) => privateWrite(join(base, name), JSON.stringify(value) + '\n');
  if (command === 'up') {
    try { await lstat(join(base, 'setup')); refuse('booking'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const opening = await inspectManualOpening({ ...fresh(), explanations });
    const prices = await mkdtemp(join(base, 'prices-')), catalogues = {};
    for (const service of ['AmazonEC2', 'AmazonS3', 'AWSLambda', 'AmazonCloudWatch']) {
      catalogues[service] = await acquirePriceCatalogue(service, { fetch: options.fetch ?? globalThis.fetch, clock,
        retain: ({ body }) => privateWrite(join(prices, service + '.json'), body) });
    }
    const cost = calculateManualCost({ ...firstSetupPriceInputs(catalogues), now: stamp() });
    const estimateMicroUsd = Object.values(cost.components).reduce((sum, row) => sum + row.upperMicroUsd, 0);
    const headroomMicroUsd = 10_000_000 - opening.billing.microUsd - estimateMicroUsd;
    if (headroomMicroUsd <= 0) throw Object.assign(new Error('D570 opening and reservation reach the monthly cap'), {
      opening: { billing: opening.billing, items: opening.openingExplanations, estimateMicroUsd, headroomMicroUsd } });
    const setup = await initializeManualFirstSetup({ ...fresh(), directory: join(base, 'setup'), catalogues, explanations });
    await save('initialized.json', setup);
    return setup;
  }
  let setup;
  try { setup = await privateJson(join(base, 'initialized.json')); }
  catch (error) {
    if (command !== 'down' || error.code !== 'ENOENT') throw error;
    setup = { ...await privateJson(join(base, 'setup', 'setup.json')), directory: join(base, 'setup') };
  }
  if (command === 'down') return removeManualFirstSetup({ ...fresh(), setup, directory: join(base, 'history') });
  if (command === 'reconcile') {
    const launch = await privateJson(join(base, 'launch.json'));
    return inspectManualFirstBilling({ ...fresh(), setup, launch });
  }
  try { await lstat(join(base, 'launch.json')); refuse('ec2 launch'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const launch = await launchManualFirstDrill({ ...fresh(), setup, uuid: options.uuid });
  await save('launch.json', launch);
  async function poll(read, code, until) {
    while (clock() < until) {
      try { return await read(); }
      catch (error) { if (error?.code !== code) throw error; }
      const remaining = until - clock(); check(remaining > 0); await sleep(Math.min(5000, remaining));
    }
    refuse('ec2 observation');
  }
  const ready = await poll(() => inspectManualFirstGuest({ ...fresh(), launch }), 'D570_NOT_READY', instant(launch.guestExpiry));
  await save('ready.json', ready);
  const shutdown = await observeManualFirstShutdown({ ...fresh(), ready });
  await save('shutdown.json', shutdown);
  const cleanup = await poll(() => inspectManualFirstGuestCleanup({ ...fresh(), ready: shutdown }),
    'D570_CLEANUP_PENDING', clock() + 120000);
  const start = instant(launch.reservation.startedAt), observation = shutdown.shutdownObservation;
  const running = Date.parse(observation.runningRequestedAt), terminated = Date.parse(observation.terminatedReceivedAt);
  const result = { ...cleanup, runtimeObservation: { runningObservedAfterSeconds: (running - start) / 1000,
    terminatedObservedAfterSeconds: (terminated - start) / 1000, shutdownObservedWithinSeconds: (terminated - running) / 1000,
    exactPoweroff: false } };
  await save('cleanup.json', result);
  return result;
}

if (process.argv[1] && process.argv[1] !== '-' && await realpath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('node scripts/kubernetes-proof-control.mjs up|drill|reconcile|down /absolute/private-directory [--explain SERVICE USAGE_TYPE MAX_MICRO_USD REASON ...]\nUse an existing owner-only private directory outside the checkout. Amounts are millionths of USD. Run from clean reviewed main with the temporary staging sign-in.');
  } else try {
    check(args.length >= 2 && await realpath(process.cwd()) === await realpath(join(dirname(fileURLToPath(import.meta.url)), '..')));
    const result = await runManualCommand({ args, checkout: process.cwd() });
    const usd = value => Number.isSafeInteger(value) ? (value / 1_000_000).toFixed(6) : null;
    console.log(JSON.stringify({ command: args[0], account: result.account, region: result.region, stackId: result.stackId,
      ...(result.openingBilling ? { openingUsd: usd(result.openingBilling.microUsd), openingEstimated: result.openingBilling.estimated,
        opening: result.openingExplanations.map(row => ({ service: row.service, usageType: row.usageType, usd: usd(row.microUsd), what: row.reason })),
        reservedUsd: usd(result.upperMicroUsd), headroomUsd: usd(10_000_000 - result.openingBilling.microUsd - result.upperMicroUsd) } : {}),
      ...(result.runtimeObservation ? { runtimeObservation: result.runtimeObservation } : {}),
      ...(result.costReport ? { costReport: result.costReport } : {}),
      ...(result.deleted ? { deleted: true, privateHistory: result.directory } : {}),
    }, null, 2));
  } catch (error) {
    console.error(error?.message?.startsWith('D570 ') ? error.message : 'D570 command refused; keep the private files for removal.');
    if (error?.opening) console.error(JSON.stringify(error.opening, null, 2));
    process.exitCode = 1;
  }
}
