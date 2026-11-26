import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile, realpath, stat} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {existsSync} from 'node:fs';
const api = await import('./amazon-run.mjs').catch(error => {if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; return {};});

// Skipping EC2's stopped confirmation would let the repeat race the old host.
test('Amazon repeat waits for stopped C, fifteen minutes and replacement; success waits for independent deletion', async () => {
  assert.equal(typeof api.runAmazonExperiment, 'function');
  const calls = [], stage = name => async () => {calls.push(name);};
  const result = await api.runAmazonExperiment({create: stage('create'), prepare: stage('prepare'),
    journey: async phase => {calls.push(phase); return {phase};}, stopWorker: stage('stop'),
    waitStopped: stage('stopped'), replace: stage('replace'), checkStopped: stage('still-stopped'),
    waitDeleted: stage('deleted'), deleteStack: stage('delete')},
    {sleep: async ms => {calls.push(ms);}, waitExpiry: stage('expiry')});
  assert.deepEqual(calls, ['create', 'prepare', 'before', 'stop', 'stopped', 'replace', 900000, 'after', 'still-stopped', 'expiry', 'deleted']);
  assert.deepEqual(result.journeys, [{phase: 'before'}, {phase: 'after'}]);
  assert.equal(result.removed, true);
});

for (const abort of [false, true]) test('Stockholm writes recorded failures before teardown ' + (abort ? 'on abort' : 'after all checks'), async t => {
  const calls = [], evidence = [];
  t.mock.method(process.stderr, 'write', value => {calls.push(value.trim()); return true;});
  await assert.rejects(api.runAmazonExperiment({
    create: async () => {}, prepare: async () => {},
    baseline: async () => {
      evidence.push({stage: 'first-stop', failures: [{check: 'p1.session_after_recovery', count: 1}]});
      if (abort) throw Error('unsafe rejoin');
      calls.push('final-restore');
      return {restored: true};
    },
    deleteStack: async () => {calls.push('delete');}, waitDeleted: async () => {calls.push('deleted');},
  }, {evidence, waitExpiry: async () => {calls.push('expiry');}}), abort ? /unsafe rejoin/ : /amazon.qualification_failed/);
  const summary = calls.findIndex(line => line.startsWith('D621 failure summary '));
  assert.ok(summary >= 0 && summary < calls.indexOf('delete'));
  assert.equal(calls.filter(line => line.startsWith('D621 failure summary ')).length, 1);
  assert.match(calls[summary], /p1\.session_after_recovery/);
  assert.equal(JSON.parse(calls[summary].slice('D621 failure summary '.length)).measurements?.restored, abort ? undefined : true);
  assert.equal(calls.includes('final-restore'), !abort);
  assert.equal(calls.at(-2), 'deleted');
});

for (const failure of ['create', 'prepare', 'before', 'stop', 'stopped', 'replace', 'after', 'still-stopped', 'expiry', 'deleted']) {
  test('Amazon teardown runs and failure survives at ' + failure, async t => {
    assert.equal(typeof api.runAmazonExperiment, 'function');
    const calls = [], stage = name => async () => {calls.push(name); if (name === failure) throw Error('failed-' + name);};
    const diagnostics = [];
    if (failure === 'before') t.mock.method(process.stderr, 'write', value => {diagnostics.push([calls.at(-1), value.trim()]); return true;});
    await assert.rejects(api.runAmazonExperiment({create: stage('create'), prepare: stage('prepare'),
      journey: async phase => stage(phase)(), stopWorker: stage('stop'), waitStopped: stage('stopped'),
      replace: stage('replace'), checkStopped: stage('still-stopped'), waitDeleted: stage('deleted'), deleteStack: stage('delete')},
      {sleep: stage('sleep'), waitExpiry: stage('expiry')}), new RegExp('failed-' + failure));
    assert.ok(calls.includes('delete'));
    assert.equal(calls.at(-1), 'deleted');
    if (failure === 'before') assert.deepEqual(diagnostics,
      [['before', 'Amazon early deletion requested'], ['deleted', 'Amazon early deletion confirmed']]);
    if (['stop', 'stopped'].includes(failure)) assert.equal(calls.includes('after'), false);
  });
}

test('Amazon teardown reports a failed deletion wait', async t => {
  const original = Error('journey failed'), cleanup = Error('deletion wait failed');
  const diagnostics = [];
  t.mock.method(process.stderr, 'write', value => {diagnostics.push(value.trim()); return true;});
  await assert.rejects(api.runAmazonExperiment({
    create: async () => {},
    prepare: async () => {},
    journey: async () => {throw original;},
    deleteStack: async () => {},
    waitDeleted: async () => {throw cleanup;},
  }), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [original, cleanup]);
    return /journey failed; Amazon teardown failed/.test(error.message);
  });
  assert.deepEqual(diagnostics, ['Amazon early deletion requested']);
});

test('all three machines wait for deletion schedule, use disposable root disks and scope SSH and mesh ingress to the operator', async () => {
  const stack = JSON.parse(await readFile(new URL('../deploy/kubernetes/bounded-amazon/stack.yaml', import.meta.url)));
  const resources = stack.Resources;
  const machines = Object.entries(resources).filter(([, row]) => row.Type === 'AWS::EC2::Instance');
  assert.deepEqual(machines.map(([name]) => name), ['A', 'B', 'C']);
  for (const [, row] of machines) {
    assert.ok(row.DependsOn.includes('Expiry'));
    assert.equal(row.Properties.InstanceType, 'm7i.xlarge');
    assert.equal(row.Properties.BlockDeviceMappings[0].Ebs.DeleteOnTermination, true);
    assert.equal(row.Properties.MetadataOptions.HttpTokens, 'required');
  }
  const expiry = resources.Expiry.Properties;
  assert.equal(expiry.Target.Arn, 'arn:aws:scheduler:::aws-sdk:cloudformation:deleteStack');
  assert.deepEqual(expiry.Target.RoleArn, {Ref: 'SchedulerRole'});
  assert.deepEqual(JSON.parse(expiry.Target.Input['Fn::Sub']), {StackName: '${AWS::StackId}', RoleARN: '${StackRole}'});
  assert.equal(expiry.FlexibleTimeWindow.Mode, 'OFF');
  assert.deepEqual(resources.Firewall.Properties.SecurityGroupIngress, [
    {IpProtocol: 'tcp', FromPort: 22, ToPort: 22, CidrIp: {Ref: 'OperatorCidr'}},
    {IpProtocol: 'udp', FromPort: 51821, ToPort: 51821, CidrIp: {Ref: 'OperatorCidr'}},
  ]);
  assert.deepEqual(resources.Mesh.Properties, {GroupId: {Ref: 'Firewall'}, IpProtocol: 'udp', FromPort: 51821, ToPort: 51821, SourceSecurityGroupId: {Ref: 'Firewall'}});
});

// A public instance or a kind cluster must not qualify as this Amazon run's target.
test('Amazon binding rejects mixed cluster, node, context and instance identities before commands', async () => {
  const {runKubernetesCheck} = await import('./kubernetes-check.mjs');
  const target = {type: 'amazon', cluster: 'd618-12345678-1234-4234-8234-123456789abc', phase: 'before',
    address: '10.77.0.1', instances: ['i-00000000000000001', 'i-00000000000000002', 'i-00000000000000003']};
  target.context = target.cluster;
  target.nodes = [target.cluster + '-control-plane', target.cluster + '-worker', target.cluster + '-worker2'];
  const {assertAmazonBinding} = await import('./test-cloud-integration.mjs');
  assert.equal(typeof assertAmazonBinding, 'function');
  assertAmazonBinding(target);
  for (const change of [{context: 'kind-' + target.cluster}, {nodes: ['a', 'b', 'c']}, {instances: ['i-00000000000000001']},
    {phase: 'prod'}, {address: '203.0.113.1'}, {cluster: 'd620-abc'}]) {
    await assert.rejects(runKubernetesCheck({...target, ...change}), /kubernetes.amazon_binding/);
  }
});

import {spawnSync} from 'node:child_process';
for (const mode of ['apply', '', '--help']) test('launcher refuses unsupported mode before account access: ' + mode, () => {
  const result = spawnSync(process.execPath, ['scripts/amazon-run.mjs', mode], {encoding: 'utf8', env: {...process.env, D618_CONFIG: '/does-not-exist'}});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Use start or stop/);
});
test('launcher explains missing D618_CONFIG before starting or stopping', () => {
  const env = {...process.env};
  delete env.D618_CONFIG;
  for (const mode of ['start', 'stop']) {
    const result = spawnSync(process.execPath, ['scripts/amazon-run.mjs', mode], {encoding: 'utf8', env});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Set D618_CONFIG to your private run configuration JSON file\./);
  }
});
test('the Stockholm dry run refuses to run from outside its launch checkout root', () => {
  const result = spawnSync(process.execPath, ['amazon-run.mjs', 'measured-stops-dry-run'], {cwd: 'scripts', encoding: 'utf8'});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Run from the launcher checkout root/);
});
test('bootstrap refuses an unsupported phase before touching the host', () => {
  const result = spawnSync('bash', ['deploy/kubernetes/bounded-amazon/bootstrap.sh', 'unknown'], {encoding: 'utf8'});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown bootstrap phase/);
});

const config = {region: 'eu-north-1', account: '123456789012', image: 'ami-00000000000000001', key: 'synthetic-d618',
  operatorCidr: '203.0.113.8/32', sshKey: '/synthetic/key', stackRole: 'arn:aws:iam::123456789012:role/d618-stack',
  schedulerRole: 'arn:aws:iam::123456789012:role/d618-expiry', waitronCheckout: '/synthetic/waitron'};
const rehearsedWaitronImage = 'sha256:' + 'a'.repeat(64);

test('measured stops require the saved Waitron image ID before provider access', async () => {
  for (const image of [undefined, 'waitron:latest']) {
    await assert.rejects(api.startAmazon({...config, baseline: true, measuredStops: true, rehearsedWaitronImage: image}, {
      aws: async () => {throw Error('provider reached before the rehearsal image was checked');},
    }), /Set rehearsedWaitronImage to the loaded rehearsal image ID/);
  }
});

test('the Stockholm stop confirms the owned instance before marking it, holds it down and rejoins the same instance', async () => {
  const instance = 'i-00000000000000002', node = 'private-node-b';
  let clock = 10_000, state = 'running';
  const calls = [];
  const result = await api.stopAmazonRehearsalNode({instance, node, now: () => clock,
    sleep: async ms => {calls.push(['hold', ms]); clock += ms;},
    async aws(service, args) {
      assert.equal(service, 'ec2');
      assert.deepEqual(args.slice(-2), ['--instance-ids', instance]);
      calls.push(args.slice(0, -2));
      if (args[0] === 'wait') state = args[1] === 'instance-stopped' ? 'stopped' : 'running';
      if (args[0] === 'describe-instances') return JSON.stringify({Reservations: [{Instances: [
        {InstanceId: instance, State: {Name: state}, PublicIpAddress: '203.0.113.12'},
      ]}]});
    },
    async kube(args) {calls.push(args);},
    async whileStopped() {calls.push(['prove']); clock += 41_000; return {observed: true};},
    async afterRestart(row) {calls.push(['restore', row.InstanceId, row.PublicIpAddress]);},
  });
  const taint = 'node.kubernetes.io/out-of-service';
  assert.deepEqual(calls, [
    ['stop-instances', '--skip-os-shutdown'], ['wait', 'instance-stopped'], ['describe-instances'],
    ['taint', 'node', node, taint + '=nodeshutdown:NoExecute'], ['prove'], ['hold', 859_000], ['describe-instances'],
    ['start-instances'], ['wait', 'instance-running'], ['describe-instances'], ['restore', instance, '203.0.113.12'],
    ['taint', 'node', node, taint + ':NoExecute-'],
  ]);
  assert.deepEqual(result, {stopped: node, offMs: 900_000, observed: true});
});

test('the Stockholm stop refuses a shortened hold and never marks a running or different instance', async () => {
  const instance = 'i-00000000000000002';
  const forbidden = () => assert.fail('a premature fault or Kubernetes write was sent');
  const common = {instance, node: 'private-node-b', kube: forbidden, whileStopped: forbidden, afterRestart: forbidden};
  await assert.rejects(async () => api.stopAmazonRehearsalNode({...common, holdMs: 360_000, aws: forbidden}),
    /amazon.rehearsal_hold/);
  for (const [id, state] of [['i-00000000000000001', 'stopped'], [instance, 'running']]) {
    await assert.rejects(async () => api.stopAmazonRehearsalNode({...common,
      async aws(_service, args) {
        if (args[0] === 'describe-instances') return JSON.stringify({Reservations: [{Instances: [{InstanceId: id, State: {Name: state}}]}]});
        assert.ok(['stop-instances', 'wait'].includes(args[0]));
      }}), /amazon.rehearsal_instance_state/);
  }
});
test('failed AWS commands show the provider error without dumping response data', async t => {
  const {mkdtemp, writeFile, rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os'); const {join} = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'd618-error-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const configPath = join(directory, 'config.json');
  await writeFile(configPath, JSON.stringify({...config, rehearsedWaitronImage}));
  await writeFile(join(directory, 'aws'), `#!${process.execPath}
console.log('synthetic-private-response');
console.error('An error occurred (AccessDenied) when calling the DescribeStacks operation: no identity-based policy allows the action');
process.exit(255);
`, {mode: 0o700});
  for (const mode of ['start', 'stop', 'measured-stops']) {
    const result = spawnSync(process.execPath, ['scripts/amazon-run.mjs', mode, 'd618-12345678-1234-4234-8234-123456789abc'],
      {encoding: 'utf8', env: {...process.env, D618_CONFIG: configPath, PATH: directory + ':' + process.env.PATH}, timeout: 10000});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /AccessDenied.*no identity-based policy allows the action/);
    assert.match(result.stderr, /amazon.command_failed:aws:Error:255/);
    if (mode === 'measured-stops') {
      const revision = spawnSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).stdout.trim();
      assert.match(revision, /^[a-f0-9]{40}$/);
      assert.equal(result.stderr.split('\n')[0], 'Amazon launch mode measured-stops; Cloud commit ' + revision);
    }
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic-private-response/);
  }
});

test('launcher policy lets the owner read stack failures within the D618 stack scope', async () => {
  const policy = JSON.parse(await readFile(new URL('../deploy/kubernetes/bounded-amazon/setup/launcher-policy.json', import.meta.url), 'utf8'));
  const grants = policy.Statement.filter(row => row.Effect === 'Allow' && [row.Action].flat().includes('cloudformation:DescribeStackEvents'));
  assert.equal(grants.length, 1);
  assert.equal(grants[0].Resource, 'arn:aws:cloudformation:REGION:ACCOUNT_ID:stack/d618-*/*');
  assert.equal(grants[0].Condition, undefined, 'failure diagnosis remains available after a budget denial');
});

test('the launcher can start and stop the region’s D618 machines under the same tag restriction', async () => {
  const policy = JSON.parse(await readFile(new URL('../deploy/kubernetes/bounded-amazon/setup/launcher-policy.json', import.meta.url), 'utf8'));
  for (const action of ['ec2:StartInstances', 'ec2:StopInstances']) {
    const grants = policy.Statement.filter(row => row.Effect === 'Allow' && [row.Action].flat().includes(action));
    assert.equal(grants.length, 1, action);
    assert.equal(grants[0].Resource, 'arn:aws:ec2:REGION:ACCOUNT_ID:instance/*', action);
    assert.equal(grants[0].Condition.StringEquals['ec2:ResourceTag/cloud.campaign'], 'D618', action);
  }
});

test('an explicit region is required before account access', async () => {
  for (const region of [undefined, '', 'REGION']) {
    await assert.rejects(api.startAmazon({...config, region}, {
      aws: () => assert.fail('no account access without an explicit region'),
      run: () => assert.fail('no build without an explicit region'),
    }), /Set an explicit AWS region/);
  }
});

test('CLI start and stop require a region; stop uses the selected Stockholm region', async t => {
  const {mkdtemp, writeFile, rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os'); const {join} = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'd618-region-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const log = join(directory, 'calls'), configPath = join(directory, 'config.json');
  await writeFile(join(directory, 'aws'), `#!${process.execPath}
const fs = require('node:fs'), args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
console.error('synthetic-success-diagnostic');
console.log(JSON.stringify(args.includes('describe-stacks') ? {Stacks: [{Tags: [{Key: 'cloud.campaign', Value: 'D618'}]}]} : {}));
`, {mode: 0o700});
  const invoke = mode => spawnSync(process.execPath, ['scripts/amazon-run.mjs', mode, 'd618-12345678-1234-4234-8234-123456789abc'],
    {encoding: 'utf8', env: {...process.env, D618_CONFIG: configPath, PATH: directory + ':' + process.env.PATH}, timeout: 10000});
  for (const region of [undefined, '', 'REGION']) {
    await writeFile(configPath, JSON.stringify({...config, region}));
    for (const mode of ['start', 'stop']) {
      const result = invoke(mode);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Set an explicit AWS region/);
    }
  }
  await assert.rejects(readFile(log), {code: 'ENOENT'});
  await writeFile(configPath, JSON.stringify(config));
  const result = invoke('stop');
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /synthetic-success-diagnostic/);
  const calls = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(calls.map(args => args.slice(0, 5)), [
    ['--region', 'eu-north-1', '--no-cli-pager', 'cloudformation', 'describe-stacks'],
    ['--region', 'eu-north-1', '--no-cli-pager', 'cloudformation', 'delete-stack'],
    ['--region', 'eu-north-1', '--no-cli-pager', 'cloudformation', 'wait'],
  ]);
});

test('wrong account or root identity cannot build or create resources', async () => {
  assert.equal(typeof api.startAmazon, 'function');
  for (const identity of [{Account: '000000000000', Arn: 'arn:aws:iam::000000000000:user/test'}, {Account: config.account, Arn: 'arn:aws:iam::123456789012:root'}]) {
    await assert.rejects(api.startAmazon(config, {run: () => assert.fail('no build before identity'),
      aws: async (service, args) => {assert.equal(service, 'sts'); assert.equal(args[0], 'get-caller-identity'); return JSON.stringify(identity);}}), /amazon.identity/);
  }
});
test('launcher refuses a standard vCPU quota below twelve before building or creating a stack', async () => {
  for (const value of [8, 11, 12]) {
    await assert.rejects(api.startAmazon(config, {
      aws: async (service, args) => {
        if (service === 'sts') return JSON.stringify({Account: config.account, Arn: 'arn:aws:iam::123456789012:user/test'});
        assert.equal(service, 'service-quotas');
        assert.deepEqual(args, ['get-service-quota', '--service-code', 'ec2', '--quota-code', 'L-1216C47A']);
        return JSON.stringify({Quota: {Value: value}});
      },
      run: async () => {throw Error('builder reached');},
    }), value < 12 ? new RegExp(`D618 needs a Running On-Demand Standard instances quota of at least 12 vCPUs; current quota is ${value}`) : /builder reached/);
  }
});
for (const [scenario, expectedError] of [['measured stops dry run', null], ['complete', null], ['baseline', null], ['baseline measured stops', null], ['baseline missing rehearsal image', /saved image unavailable/], ['baseline deadline', /amazon.run_deadline/], ['baseline cold', null], ['baseline cold denied', /start denied/], ['baseline cold cancelled', {name: 'AbortError'}], ['baseline cold late', /amazon.cold_restart_late/], ['baseline cold volumes changed', /amazon.cold_restart_volumes/],
  ['baseline cold private changed', /amazon.cold_restart_private_address/], ['baseline cold duplicate public', /amazon.cold_restart_public_addresses/],
  ['baseline cold wrong old address', /amazon.cold_restart_binding/], ['baseline cold stale boot', {name: 'TimeoutError'}],
  ['baseline cold foreign metadata', {name: 'TimeoutError'}], ['baseline cold stale lease', {name: 'TimeoutError'}],
  ['baseline single stop late', /amazon.measured_stops_expiry/], ['baseline interrupted', {name: 'AbortError'}], ['baseline cleanup failure', /synthetic tunnel close failure/], ['observer', null], ['observer failed after stop', /synthetic observer stop failure/], ['observer expiry', /amazon.observer_expiry/], ['observer copy baseline', /amazon.observer_baseline_late/], ['observer late baseline', /amazon.observer_baseline_late/], ['failed creation', /creation failed/], ['wrong instance', /amazon.instance_binding/], ['wrong imported image', /amazon.import_digest/], ['late deletion', /amazon.deletion_late/], ['incomplete archive', /amazon.archive_blob/], ['failed bundle upload', /upload failed/], ['failed private copy', /private copy failed/], ['missing flannel', /amazon.flannel_plugin: machine 2 /], ['failed control-plane join', /synthetic join refusal/], ['database not ready', /synthetic database readiness failure/], ['store not ready', /synthetic store readiness failure/]]) test('Amazon distribution and journeys: ' + scenario, async t => {
  const diagnostics = [], stop = new AbortController();
  if (['observer failed after stop', 'baseline measured stops'].includes(scenario)) {
    t.mock.method(process.stderr, 'write', value => {diagnostics.push(String(value)); calls.push(['stderr', String(value)]); return true;});
  }
  const calls = [], phases = [], metadata = [], transports = [], hashes = 'a'.repeat(64);
  let evidenceBOffline = false;
  const dryRun = scenario === 'measured stops dry run';
  const checksSource = dryRun || scenario === 'baseline measured stops';
  const relayPath = 'deploy/kubernetes/remote-relay.mjs';
  let sourceArchive, sourceBytes;
  const underPrivateUmask = (binary, args) => {
    const result = spawnSync('sh', ['-c', 'umask 077; exec "$@"', 'private source', binary, ...args]);
    assert.equal(result.status, 0, result.stderr?.toString());
    return result.stdout;
  };
  const imageHash = tag => (scenario === 'baseline measured stops' && tag.endsWith(':cloud')) || (dryRun && tag.endsWith(':waitron')) ? 'd'.repeat(64) : hashes;
  const certificateKey = 'b'.repeat(64), joins = [];
  let time = Date.UTC(2026, 10, 10), target, savedTags = [], deleting = false, tunnelCloseAttempts = 0;
  let markStage,releaseStage,markRemoval,releaseRemoval;
  const stageReady=new Promise(resolve=>{markStage=resolve;});
  const removalReady=new Promise(resolve=>{markRemoval=resolve;});
  const output = {A: 'i-00000000000000001', B: 'i-00000000000000002', C: 'i-00000000000000003',
    AddressA: '203.0.113.1', AddressB: '203.0.113.2', AddressC: '203.0.113.3', PrivateA: '10.78.0.10', PrivateB: '10.78.0.11', PrivateC: '10.78.0.12'};
  const cold = scenario.startsWith('baseline cold');
  const measuredStops = dryRun || cold || ['baseline measured stops', 'baseline missing rehearsal image', 'baseline deadline', 'baseline single stop late'].includes(scenario), restartedAddress = '203.0.113.33';
  let restarted = false, allState = 'running', stopClock = 100, lateCommandReturned = false;
  if (/ (stale boot|foreign metadata|stale lease)$/.test(scenario)) {
    const timeout = AbortSignal.timeout;
    t.mock.method(AbortSignal, 'timeout', ms => timeout(ms === 300_000 ? 1000 : ms));
  }
  const roles = ['A', 'B', 'C'], ids = roles.map(role => output[role]);
  const diskMarkers = new Map();
  const publicAfter = ['203.0.113.11', '203.0.113.12', '203.0.113.13'];
  if (measuredStops) t.mock.method(performance, 'now', () => stopClock);
  const running = api.startAmazon({...config, baseline: dryRun || scenario.startsWith('baseline'), measuredStops, dryRun, rehearsedWaitronImage,
    observer: scenario.startsWith('observer')}, {now: () => time, signal: stop.signal, sleep: async ms => {stop.signal.throwIfAborted(); time += ms;},
    prepareFlux: async (directory, _name, options) => {calls.push(['flux-prepare', options.node]);return directory+'/flux.json';},
    async runBaseline(context) {
      assert.match(scenario, /^baseline/);
      assert.equal(context.databasePrepared, true);
      assert.deepEqual(context.amazon.instances, [output.A, output.B, output.C]);
      assert.equal(context.amazon.phase, 'baseline');
      assert.deepEqual(context.nodes.map(node => node.ip), ['10.77.0.1', '10.77.0.2', '10.77.0.3']);
      if (measuredStops) {
        assert.equal(context.stopServiceNodes, true);
        assert.equal(context.holdMs, 900_000);
        assert.deepEqual(calls.find(row => row[0] === 'flux-prepare')[1], context.nodes.map(row => row.name));
        assert.deepEqual(transports.filter(row => row.args.at(-1).includes("'release-staging'")).map(row => row.args.at(-2)),
          ['admin@203.0.113.2', 'admin@203.0.113.3']);
        assert.ok(transports.findIndex(row => row.args.at(-1).includes("'release-staging'")) <
          transports.findIndex(row => row.args.at(-1).includes("'join'")));
      }
      if (scenario === 'baseline measured stops') {
        const kubeEvidence = await context.bindEvidenceKube(context.signal);
        await context.bindEvidenceKube(context.signal);
        assert.equal(transports.filter(row => row.args.at(-1).includes('--request-timeout=250ms')).length, 2);
        await kubeEvidence(['get', 'cluster', 'cloud-db', '-o', 'name'], {signal: context.signal});
        assert.deepEqual(transports.at(-1).args.slice(-2), ['admin@203.0.113.2',
          "'sudo' 'kubectl' '--kubeconfig=/etc/kubernetes/admin.conf' '--context' '" + context.cluster +
          "' 'get' 'cluster' 'cloud-db' '-o' 'name' 2>/dev/null"]);
        await assert.rejects(kubeEvidence(['get', 'cluster', 'cloud-db'], {signal: AbortSignal.abort()}), {name: 'AbortError'});
        evidenceBOffline = true;
        await context.bindEvidenceKube(context.signal);
        assert.equal(transports.at(-1).args.at(-2), 'admin@203.0.113.3');
        evidenceBOffline = false;
      }
      await context.kube(['-n', 'd621-data', 'create', '-f', '-'], {input: 'synthetic-migration'});
      await context.kube(['-n', 'd621-data', 'create', '-f', '-'], {input: '{"kind": "Secret"}'});
      await context.kube(['-n', 'd621-data', 'exec', '-i', 'pod/service', '--', 'node'], {input: '{"kind":"Secret"}'});
      await context.importVerifierImage('sha256:' + hashes, ['exec', '-i', 'pod/verifier', '--', 'docker', 'load']);
      if (scenario === 'baseline deadline') {
        time += 126 * 60_000;
        assert.equal(await context.run('probe-venue', []), '');
        time += 17 * 60_000;
        await context.run('probe-cleanup', [], {signal: null});
        const late = context.run('probe-too-late', []);
        lateCommandReturned = true;
        await late;
      }
      if (cold) {
        if (scenario.endsWith('late')) time += 126 * 60_000;
        const result = await context.restartAll(async ({confirmStopped}) => {
          assert.equal(allState, 'stopped');
          await confirmStopped();
          calls.push(['outside outage']);
        });
        assert.deepEqual(Object.keys(result.bootTimesMs), context.nodes.map(row => row.name));
        assert.deepEqual(Object.keys(result.stopTimesMs), context.nodes.map(row => row.name));
      }
      if (scenario === 'baseline single stop late') {
        time += 126 * 60_000;
        await context.stopNode(context.nodes[2].name, {});
      }
      if (scenario === 'baseline measured stops') {
        assert.equal(context.waitronImage, 'sha256:' + 'c'.repeat(64), 'outside Docker uses the inspected image ID');
        assert.equal(context.image, 'sha256:' + 'f'.repeat(64), 'the outside peer uses the inspected Cloud image ID');
        assert.equal(context.verifierImage, 'sha256:' + hashes, 'the classic verifier uses the bundle configuration digest');
        assert.deepEqual(diagnostics.filter(line => line.startsWith('Waitron rehearsal image ')),
          ['Waitron rehearsal image sha256:' + hashes + '\n']);
        const {name} = context.nodes[2];
        const resumed = await context.stopNode(name, {
          async whileStopped({holdMs, signal}) {
            const kubeEvidence = await context.bindEvidenceKube(signal);
            await kubeEvidence(['get', 'cluster', 'cloud-db']);
            assert.equal(transports.at(-1).args.at(-2), 'admin@203.0.113.2', 'samples avoid the stopped controller');
            stopClock += holdMs;
            return {};
          },
          async afterRestart() {
            assert.ok(calls.some(row => row[0] === 'sudo' && row.includes('wg') && row.includes(restartedAddress + ':51821')));
            assert.ok(transports.some(row => row.args.at(-2) === 'admin@' + restartedAddress &&
              row.args.at(-1).includes('verifier-scratch')));
          },
        });
        assert.equal(resumed.offMs, 900_000);
        assert.equal(resumed.stopped, name);
      }
      if (scenario === 'baseline interrupted') {
        stop.abort();
        await context.kube(['-n', 'd621-data', 'logs', 'pod/service'], {signal: null});
      }
      return {restored: true};
    },
    observe: async (binary, args, {onReady, timeout}) => {
      assert.equal(binary, 'ssh'); assert.equal(timeout, 3600000);
      assert.equal(calls.some(row => row[1] === 'stop-instances'), false, 'no fault before observer ready');
      assert.equal(target.observer, true); assert.ok(args.at(-1).includes('kubernetes-check.mjs'));
      if (scenario === 'observer copy baseline') time += 1200000;
      if (scenario === 'observer late baseline') time += 1200001;
      const messages = []; await onReady(value => {messages.push(value); if (scenario === 'observer failed after stop') calls.push(['signal', value]);});
      assert.deepEqual(messages, ['P1_STOPPED', 'P1_REPLACEMENT_READY']);
      if (scenario === 'observer failed after stop') throw Error('synthetic observer stop failure');
      time += 900000; return {continuous: true};
    },
    aws: async (service, args, cleanup, request) => {
      assert.equal(dryRun, false, 'a dry run must never reach the provider: ' + service);
      calls.push([service, ...args]);
      if (scenario === 'observer failed after stop') {
        if (args[0] === 'stop-instances') time += 12000;
        if (args[0] === 'wait' && args[1] === 'instance-stopped') time += 81000;
      }
      if (args[0] === 'create-stack' && scenario === 'failed creation') throw Error('creation failed');
      if (args[0] === 'delete-stack') deleting = true;
      if (args[0] === 'wait' && args[1] === 'stack-delete-complete' && scenario === 'late deletion' && !deleting) throw Object.assign(Error('timeout'), {code: 'ETIMEDOUT'});
      if (service === 'sts') return JSON.stringify({Account: config.account, Arn: 'arn:aws:iam::123456789012:user/test'});
      if (service === 'service-quotas') return JSON.stringify({Quota: {Value: 12}});
      if (args[0] === 'describe-stacks') return JSON.stringify({Stacks: [{Outputs: Object.entries(output).map(([OutputKey, OutputValue]) => ({OutputKey, OutputValue}))}]});
      if (cold && service === 'ec2') {
        assert.deepEqual(args.slice(args.indexOf('--instance-ids') + 1), ids);
        assert.equal(request?.aborted, false, 'EC2 calls have a live deadline');
        if (args[0] === 'stop-instances') {allState = 'stopped'; assert.ok(args.includes('--skip-os-shutdown'));}
        if (args[0] === 'start-instances') {
          if (scenario.endsWith('denied')) throw Error('start denied');
          restarted = true;
          allState = 'running';
        }
        if (args[0] === 'describe-instances') {
          if (allState === 'stopped' && scenario.endsWith('cancelled')) {
            stop.abort();
            request.throwIfAborted();
          }
          return JSON.stringify({Reservations: [{Instances: roles.map((role, index) => ({
            InstanceId: ids[index], State: {Name: allState},
            PublicIpAddress: restarted ? publicAfter[scenario.endsWith('duplicate public') && index === 2 ? 1 : index] :
              scenario.endsWith('wrong old address') && index === 2 ? '203.0.113.21' : output['Address' + role],
            PrivateIpAddress: output['Private' + (restarted && scenario.endsWith('private changed') ? ['A', 'C', 'B'][index] : role)],
            BlockDeviceMappings: [{DeviceName: '/dev/xvda', Ebs: {VolumeId: 'vol-0000000000000000' +
              (restarted && scenario.endsWith('volumes changed') ? 9 : index)}}],
          })).reverse()}]});
        }
        return '';
      }
      if (args[0] === 'start-instances') restarted = true;
      if (args[0] === 'describe-instances') return JSON.stringify({Reservations: [{Instances: [{
        InstanceId: output.C, State: {Name: restarted ? 'running' : 'stopped'},
        PublicIpAddress: restarted ? restartedAddress : output.AddressC, PrivateIpAddress: output.PrivateC,
      }]}]});
      assert.ok(['create-stack', 'start-instances', 'stop-instances', 'wait', 'delete-stack'].includes(args[0]), 'unexpected provider command ' + args[0]);
      return '';
    }, run: async (binary, args, input, cleanup, timeout, request) => {
      if (!cleanup) stop.signal.throwIfAborted();
      if (cold && binary === 'sudo' && args.includes('wg') && args.includes('set')) {
        assert.equal(cleanup, false, 'refreshing a live route is bounded ordinary work');
        assert.equal(request?.aborted, false);
      }
      calls.push([binary, ...args]);
      if (['ssh','scp'].includes(binary)) {
        const socket = args.find(arg => arg.startsWith('ControlPath='))?.slice('ControlPath='.length);
        transports.push({binary,args,input,cleanup,timeout,socketDirectoryPresent:socket && existsSync(socket.slice(0,-3))});
      }
      if (binary === 'uname') return 'x86_64';
      if (binary === 'git' && args[0] === 'rev-parse') return '1'.repeat(40);
      if (checksSource && binary === process.execPath) {
        return underPrivateUmask(binary, [...args.slice(0, -1), await realpath(args.at(-1))]).toString().trim();
      }
      if (checksSource && binary === 'git' && args.includes('archive')) {
        assert.equal(sourceArchive, undefined, 'write the source archive once');
        sourceArchive = args[args.indexOf('-o') + 1];
        underPrivateUmask('git', ['-c', 'tar.umask=user', ...args]);
        sourceBytes = await readFile(sourceArchive);
        return '';
      }
      if (checksSource && binary === 'tar' && args.includes('-C')) {
        assert.equal(args[1], sourceArchive, 'extract the archive used for machine uploads');
        underPrivateUmask('tar', args);
        return '';
      }
      if (checksSource && binary === 'docker' && args[0] === 'buildx' && args.at(-2).endsWith(':cloud')) {
        assert.ok(sourceArchive, 'archive the committed source before the Cloud image build');
        const stage = join(dirname(sourceArchive), 'source');
        assert.equal(args.at(-1), stage);
        assert.equal(args[args.indexOf('-f') + 1], join(stage, 'deploy/local-stack/Dockerfile'));
        assert.equal(args[args.indexOf('--secret') + 1], 'id=npm_token,env=NODE_AUTH_TOKEN');
        assert.equal(existsSync(join(stage, 'source.tar')), false);
        assert.equal((await stat(join(stage, 'deploy'))).mode & 0o777, 0o755);
        assert.equal((await stat(join(stage, relayPath))).mode & 0o777, 0o644);
        assert.deepEqual(await readFile(join(stage, relayPath)), underPrivateUmask('tar', ['-xOf', sourceArchive, relayPath]));
      }
      if (checksSource && binary === 'scp' && args.at(-1).endsWith(':/tmp/d618-source.tar')) {
        assert.equal(args.at(-2), sourceArchive);
        assert.deepEqual(await readFile(args.at(-2)), sourceBytes, 'upload the same source bytes');
      }
      if (binary === 'docker' && args[0] === 'tag' && args[1] === rehearsedWaitronImage &&
        scenario === 'baseline missing rehearsal image') throw Error('saved image unavailable');
      if (binary === 'docker' && args[0] === 'network' && args[1] === 'create') return 'd'.repeat(64);
      if (binary === 'docker' && args[0] === 'save') savedTags = args.slice(args.indexOf('-o') + 2);
      if (binary === 'wc') return '1303994368 images.tar';
      if (binary === 'scp' && args.at(-2).endsWith('images.tar') && scenario === 'failed bundle upload') throw Error('upload failed');
      if (binary === 'tar') {
        const blobs = scenario === 'incomplete archive' ? ['b', 'c'] : ['a', 'b', 'c'];
        if (dryRun) blobs.push('d', 'e');
        if (args[0] === '-tf') return ['index.json', 'manifest.json', ...blobs.map(n => 'blobs/sha256/' + n.repeat(64))].join('\n');
        if (args.at(-1) === 'index.json') return JSON.stringify({schemaVersion:2,mediaType:'application/vnd.oci.image.index.v1+json',manifests:savedTags.map(tag => ({
          annotations:{'io.containerd.image.name':'docker.io/' + (tag.includes('/') ? tag : 'library/' + tag)},platform:{os:'linux',architecture:'amd64'},
          digest:'sha256:' + (dryRun && tag.endsWith(':waitron') ? 'e' : 'b').repeat(64)}))});
        if (dryRun && args.at(-1) === 'blobs/sha256/' + 'e'.repeat(64)) return JSON.stringify({schemaVersion:2,
          mediaType:'application/vnd.oci.image.manifest.v1+json',config:{digest:'sha256:' + 'd'.repeat(64)},layers:[{digest:'sha256:' + 'c'.repeat(64)}]});
        if (args.at(-1) === 'blobs/sha256/' + 'b'.repeat(64)) return JSON.stringify({schemaVersion:2,mediaType:'application/vnd.oci.image.manifest.v1+json',config:{digest:'sha256:' + hashes},layers:[{digest:'sha256:' + 'c'.repeat(64)}]});
        if (args.at(-1) === 'blobs/sha256/' + hashes || (dryRun && args.at(-1) === 'blobs/sha256/' + 'd'.repeat(64))) return JSON.stringify({os:'linux',architecture:'amd64'});
        return JSON.stringify(savedTags.map(tag => ({Config:'blobs/sha256/' + imageHash(tag),RepoTags:['docker.io/' + (tag.includes('/') ? tag : 'library/' + tag)]})));
      }
      if (binary === 'wg') return 'A'.repeat(43) + '=';
      if (binary === 'sudo' && args[1] === 'wg-quick' && args[2] === 'down' &&
          ++tunnelCloseAttempts === 1 && scenario === 'baseline cleanup failure') throw Error('synthetic tunnel close failure');
      if (binary === 'docker' && args[0] === 'image' && args[1] === 'inspect') {
        const id = args[2].endsWith(':cloud') ? 'f' : 'c';
        return JSON.stringify([{Id: 'sha256:' + id.repeat(64), Architecture: 'amd64', Os: 'linux'}]);
      }
      if (binary === 'scp' && args.at(-2).endsWith('target.json')) {target = JSON.parse(await readFile(args.at(-2), 'utf8')); if (scenario === 'observer copy baseline') time += 1;}
      if (binary === 'ssh') {
        const script = args.at(-1);
        if (cold && script.includes("'cold-scratch-witness'")) {
          const index = Number(args.at(-2).at(-1)) - 1;
          const role = ids[index];
          assert.ok(script.endsWith("'" + role + "'"));
          if (script.includes("'cold-scratch-witness' 'write'")) diskMarkers.set(role, script.split("'").at(-2));
          else assert.equal(diskMarkers.get(role), role, 'read the original marker from that machine');
        }
        if (cold && script.includes('/proc/sys/kernel/random/boot_id')) {
          return '00000000-0000-4000-8000-00000000000' + (restarted && !(scenario.endsWith('stale boot') && args.at(-2).endsWith('.13')) ? '2' : '1');
        }
        if (cold && script.includes('169.254.169.254')) {
          const role = args.at(-2).at(-1);
          return restarted && scenario.endsWith('foreign metadata') && role === '3' ? ids[0] : ids[Number(role) - 1];
        }
        if (script.includes("'kube-node-lease'")) {
          return JSON.stringify({spec: {renewTime: restarted && !(scenario.endsWith('stale lease') && args.at(-2).endsWith('.13')) ? '2026-11-10T00:16:01Z' : '2026-11-10T00:00:01Z'}});
        }
        if (script.includes('--raw=/readyz')) {
          if (evidenceBOffline && script.includes('--request-timeout=250ms') && args.at(-2) === 'admin@203.0.113.2') throw Error('synthetic evidence controller offline');
          if (['baseline', 'baseline measured stops', 'baseline interrupted'].includes(scenario) && args.at(-2) === 'admin@203.0.113.1') throw Error('synthetic first control plane stopped');
          return 'ok';
        }
        if (script.includes("'get' 'endpointslices'") && script.includes('kubernetes.io/service-name=kube-dns')) {
          const clusterName = script.match(/'--context' '([^']+)'/)[1];
          return JSON.stringify({items: [{endpoints: ['-control-plane', '-worker', '-worker2'].map(suffix => {
            const name = clusterName + suffix;
            return {nodeName: name, conditions: {ready: true}, hints: {forNodes: [{name}]}};
          })}]});
        }
        if (script.includes("'rollout' 'status' 'deployment/coredns'")) {
          await new Promise(setImmediate);
          calls.push(['dns rollout completed']);
        }
        if(scenario==='complete'&&!releaseStage&&script==="'sudo' 'cp' '/tmp/d618-images.tar' '/var/local/d620-config/d618-images.tar'"){
          markStage();await new Promise(resolve=>{releaseStage=resolve;});
        }
        if(scenario==='complete'&&!releaseRemoval&&script==="'sudo' 'rm' '/var/local/d620-config/d618-images.tar'"){
          markRemoval();await new Promise(resolve=>{releaseRemoval=resolve;});
        }
        if (scenario === 'failed private copy' && args.at(-2) === 'admin@203.0.113.2' && script.includes("'cp' '/var/local/d620-config/d618-images.tar'")) throw Error('private copy failed');
        if (script.includes('169.254.169.254')) {const index = Number(args.at(-2).at(-1)); metadata.push(index); return scenario === 'wrong instance' ? 'i-00000000000000009' : output[['A','B','C'][index - 1]];}
        if (script.includes('sha256sum')) return hashes;
        if (script.includes('/opt/cni/bin/flannel')) return scenario === 'missing flannel' && args.at(-2) === 'admin@203.0.113.3' ? 'missing' : 'present';
        if (script.includes('crictl') && scenario === 'observer expiry') time += 700000;
        if (script.includes('crictl')) {
          const importedHash = scenario === 'wrong imported image' ? 'b'.repeat(64) : imageHash(script.split("'").at(-2));
          return JSON.stringify({status: {id: 'sha256:' + importedHash, pinned: false, repoTags: [], repoDigests: [], size: '364', username: ''}, info: {}});
        }
        if (script.includes('kubernetes-check.mjs')) {phases.push(target.phase); assert.ok(script.includes('sha256:' + hashes)); assert.equal(target.instances[2], output.C); return JSON.stringify({checked: target.phase});}
        if (script.includes('jsonpath=')) return 'manifest-old';
        if (script.includes("bootstrap.sh' 'control'")) return certificateKey;
        if (script.includes("bootstrap.sh' 'join'")) {
          joins.push({host: args.at(-2), input});
          if (scenario === 'failed control-plane join') throw Error('synthetic join refusal');
        }
        if (scenario === 'database not ready' && script.includes('scripts/kubernetes-data.mjs')) {
          throw Error('synthetic database readiness failure');
        }
        if (scenario === 'store not ready' && script.includes('scripts/kubernetes-storage.mjs')) {
          throw Error('synthetic store readiness failure');
        }
        if (script.includes("'token' 'create'")) return 'kubeadm join d618-api:6443 --token abcdef.0123456789abcdef --discovery-token-ca-cert-hash sha256:' + hashes;
      }
      return '';
    }});
  if(scenario==='complete'){
    try{
      await Promise.race([stageReady,removalReady,running]);await new Promise(setImmediate);
      assert.equal(calls.some(row=>row[0]==='ssh'&&row.at(-1).includes("'cp' '/var/local/d620-config/d618-images.tar'")),false,'worker copies wait for staging to finish');
      releaseStage?.();await Promise.race([removalReady,running]);
      await new Promise(setImmediate);assert.equal(calls.some(row=>row[0]==='ssh'&&row.at(-1).includes("'ctr'")),false,'imports wait for shared-file removal to finish');
    }finally{releaseStage?.();releaseRemoval?.();await running.catch(()=>{});}
  }
  let result;
  if (expectedError) await assert.rejects(running, expectedError); else result = await running;
  if (dryRun) {
    assert.equal(result.dryRun, true);
    assert.equal(result.revision, '1'.repeat(40));
    assert.deepEqual(Object.keys(result.images), savedTags);
    assert.equal(result.images[savedTags[1]], 'sha256:' + 'd'.repeat(64));
    assert.deepEqual(calls.find(row => row[0] === 'docker' && row[1] === 'tag' && row[3] === savedTags[1]),
      ['docker', 'tag', rehearsedWaitronImage, savedTags[1]]);
    assert.ok(calls.some(([binary, arg]) => binary === 'kubectl' && arg === 'version'));
    assert.ok(calls.some(([binary, arg]) => binary === 'wg' && arg === 'pubkey'));
    assert.ok(calls.some(row => row[0] === process.execPath && row.at(-1) === join(dirname(sourceArchive), 'source', 'scripts', 'kubernetes-data.mjs')));
    assert.ok(calls.some(row => row[0] === 'tar' && row[1] === '-tf'), 'archive checked before a successful receipt');
    assert.deepEqual(calls.filter(row => row[0] === 'docker' && row[1] === 'network').map(row => row[2]), ['create', 'rm']);
    assert.deepEqual(calls.filter(row => row[0] === 'docker' && row[1] === 'image' && row[2] === 'rm').map(row => row[3]),
      savedTags.filter(tag => tag.startsWith('d618-')));
    assert.deepEqual(transports, []);
    assert.equal(existsSync(dirname(sourceArchive)), false);
    return;
  }
  if (scenario === 'baseline missing rehearsal image') {
    assert.equal(calls.some(row => row[1] === 'create-stack'), false);
    return;
  }
  if (scenario === 'incomplete archive') {
    assert.equal(calls.some(row => row[1] === 'create-stack'), false, 'no machines before archive closure');
    assert.equal(calls.some(row => row[1] === 'delete-stack'), false);
    assert.deepEqual(transports, []); return;
  }
  const save = calls.find(row => row[0] === 'docker' && row[1] === 'save');
  assert.equal(save[save.indexOf('--platform') + 1], 'linux/amd64');
  const preflight = calls.findIndex(row => row[0] === 'tar' && row[1] === '-tf');
  assert.ok(preflight >= 0 && preflight < calls.findIndex(row => row[1] === 'create-stack'), 'archive closure checked before creating machines');
  const closes = transports.filter(row => row.args.includes('-O'));
  if (scenario === 'failed creation') assert.deepEqual(transports, []);
  else {
    const retargeted = scenario === 'baseline cold' || / (stale boot|foreign metadata|stale lease)$/.test(scenario);
    assert.deepEqual(closes.map(row => row.args.at(-1)), retargeted ?
      ['203.0.113.1', '203.0.113.2', '203.0.113.3', ...publicAfter].map(ip => 'admin@' + ip) :
      !cold && restarted && measuredStops ? ['admin@203.0.113.3', 'admin@203.0.113.1', 'admin@203.0.113.2', 'admin@' + restartedAddress] :
      ['admin@203.0.113.1', 'admin@203.0.113.2', 'admin@203.0.113.3']);
    assert.ok(closes.every(row => row.cleanup === true && row.args.includes('exit')));
    assert.ok(closes.every(row => row.socketDirectoryPresent), 'socket directory remains until every master is closed');
    const paths = new Set();
    for (const row of transports) {
      for (const option of ['ServerAliveInterval=15','ServerAliveCountMax=4']) assert.ok(row.args.includes(option), option);
      if (row.binary === 'ssh') for (const option of ['ControlMaster=auto','ControlPersist=yes']) assert.ok(row.args.includes(option), option);
      if (row.binary === 'scp') assert.ok(transports.slice(0,transports.indexOf(row)).some(prior => prior.binary === 'ssh' && prior.args.includes(row.args.at(-1).split(':')[0])), 'SSH establishes a master before SCP reuses it');
      const path = row.args.find(arg => arg.startsWith('ControlPath='));
      assert.match(path, /\/d618-[^/]+\/%C$/); paths.add(path.slice('ControlPath='.length));
    }
    assert.equal(paths.size, 1, 'all machine commands and copies share the run-private template');
    assert.equal(existsSync([...paths][0].slice(0,-3)), false, 'private sockets directory is removed after closure');
    assert.ok(calls.findLastIndex(row => row[0] === 'ssh' && row.includes('-O')) > calls.findLastIndex(row => row[0] === 'ssh' && !row.includes('-O')));
  }
  if (cold) {
    const lastHost = transports.filter(row => row.args.at(-2) === 'admin@' + publicAfter[2]).map(row => row.args.at(-1));
    if (scenario.endsWith('foreign metadata')) {
      assert.ok(lastHost.some(command => command.includes('169.254.169.254')));
      assert.ok(!lastHost.some(command => command.includes('/proc/sys/kernel/random/boot_id')));
    }
    if (scenario.endsWith('stale boot')) {
      assert.ok(lastHost.some(command => command.includes('/proc/sys/kernel/random/boot_id')));
      assert.ok(!lastHost.some(command => command.includes("'cold-scratch-witness' 'read'")));
    }
    if (scenario.endsWith('stale lease')) assert.ok(lastHost.some(command => command.includes("'kube-node-lease'")));
    const stopped = calls.findIndex(row => row[1] === 'stop-instances');
    const outage = calls.findIndex(row => row[0] === 'outside outage');
    const start = calls.findIndex(row => row[1] === 'start-instances');
    if (scenario.endsWith('late') || scenario.endsWith('wrong old address')) assert.equal(stopped, -1);
    else assert.ok(stopped >= 0);
    if (scenario.endsWith('cancelled')) assert.equal(start, -1);
    if (start >= 0) assert.ok(stopped < outage && outage < start);
    if (!expectedError) {
      assert.equal(result.removed, true);
      assert.deepEqual([...diskMarkers.values()].sort(), ids);
      const witnesses = transports.map(row => row.args.at(-1)).filter(command => command.includes("'cold-scratch-witness'"));
      assert.equal(witnesses.length, 6);
      for (const command of witnesses) assert.match(command, /'cold-scratch-witness' '(write|read)' '\/var\/local\/d621-verifier\/mount' /);
      assert.deepEqual(transports.filter(row => row.args.at(-1).includes("'cold-scratch-witness' 'read'"))
        .map(row => row.args.at(-2)).sort(), publicAfter.map(ip => 'admin@' + ip));
      for (const ip of publicAfter) {
        assert.ok(calls.some(row => row[0] === 'sudo' && row.includes('wg') && row.includes(ip + ':51821')));
        assert.ok(transports.some(row => row.args.at(-2) === 'admin@' + ip && row.args.at(-1).includes("'verifier-scratch' 'check'")));
      }
      return;
    }
  }
  if (expectedError) {
    if (scenario === 'baseline single stop late') assert.equal(calls.some(row => row[1] === 'stop-instances'), false);
    if (scenario === 'baseline deadline') {
      assert.equal(lateCommandReturned, true, 'an expired async command returns a rejected promise');
      assert.ok(calls.some(row => row[0] === 'probe-venue'));
      assert.ok(calls.some(row => row[0] === 'probe-cleanup'));
      assert.equal(calls.some(row => row[0] === 'probe-too-late'), false);
      assert.ok(calls.some(row => row[0] === 'docker' && row[1] === 'network' && row[2] === 'rm'));
    }
    if (scenario === 'baseline interrupted') {
      const logs = transports.find(row => row.args.at(-1).includes("'logs' 'pod/service'"));
      assert.equal(logs?.args.at(-2), 'admin@203.0.113.2');
      assert.equal(logs.cleanup, true);
    }
    if (scenario === 'baseline cleanup failure') {
      const removedNetwork = calls.findIndex(row => row[0] === 'docker' && row[1] === 'network' && row[2] === 'rm');
      const deletedStack = calls.findIndex(row => row[1] === 'delete-stack');
      assert.ok(removedNetwork >= 0 && removedNetwork < deletedStack, 'one host cleanup failure must not strand the other resource');
      assert.equal(tunnelCloseAttempts, 2);
      assert.ok(calls.findIndex(row => row[0] === 'sudo' && row.includes('-X')) > deletedStack);
    }
    if (scenario === 'observer failed after stop') {
      assert.deepEqual(diagnostics.filter(row => row.startsWith('P1 timing ')), [
        'P1 timing launcher stop-request-complete 12000\n',
        'P1 timing launcher stop-wait-complete 93000\n',
      ]);
      const stopped = calls.findIndex(row => row[1] === 'wait' && row[2] === 'instance-stopped');
      const sent = calls.findIndex(row => row[0] === 'signal' && row[1] === 'P1_STOPPED');
      const replacement = calls.findIndex(row => row[0] === 'ssh' && row.at(-1).includes("'jsonpath={.items[0].metadata.name}'"));
      const requested = calls.findIndex(row => row[1] === 'stop-instances');
      const requestLine = calls.findIndex(row => row[0] === 'stderr' && row[1].startsWith('P1 timing launcher stop-request-complete '));
      const waitLine = calls.findIndex(row => row[0] === 'stderr' && row[1].startsWith('P1 timing launcher stop-wait-complete '));
      assert.ok(requested >= 0 && requested < requestLine && requestLine < stopped, 'report stop request before waiting');
      assert.ok(stopped >= 0 && stopped < waitLine && waitLine < sent && sent < replacement, 'report confirmed stop and send STOPPED before replacement');
    } else if (scenario.startsWith('observer')) assert.equal(calls.some(row => row[1] === 'stop-instances'), false, 'no fault with insufficient expiry');
    const created = calls.find(row => row[1] === 'create-stack'), name = created[created.indexOf('--stack-name') + 1];
    assert.match(name, /^d618-[a-f0-9-]{36}$/);
    assert.equal(calls.find(row => row[1] === 'delete-stack')?.at(-1), name);
    assert.equal(calls.find(row => row[1] === 'wait' && row[2] === 'stack-delete-complete')?.at(-1), name);
    assert.equal(calls.some(row => row[0] === 'docker' && row[1] === 'buildx' && ['create', 'rm'].includes(row[2])), false);
    if (['wrong instance', 'wrong imported image', 'failed bundle upload', 'failed private copy', 'missing flannel'].includes(scenario)) assert.deepEqual(phases, []);
    if (scenario === 'failed control-plane join') {
      assert.deepEqual(joins.map(row => row.host), ['admin@203.0.113.2']);
      assert.deepEqual(phases, [], 'no fixture starts after a failed member join');
    }
    if (scenario === 'database not ready') {
      assert.deepEqual(phases, [], 'no fixture starts if PostgreSQL setup fails');
      assert.equal(calls.some(row => row[1] === 'stop-instances'), false);
    }
    if (scenario === 'store not ready') {
      assert.deepEqual(phases, [], 'no fixture starts if the store fails readiness');
      assert.equal(calls.some(row => row[1] === 'stop-instances'), false);
    }
    if (['failed bundle upload','failed private copy'].includes(scenario)) assert.equal(calls.some(row => row[0] === 'ssh' && row.at(-1).includes("'ctr'")),false,'no import after a failed distribution');
    return;
  }
  assert.deepEqual(metadata, [1, 2, 3]);
  const meshCalls = transports.filter(row => row.binary === 'ssh' && row.args.at(-1).includes("bootstrap.sh' 'mesh'"));
  assert.deepEqual(meshCalls.map(row => row.args.at(-2)), ['admin@203.0.113.1', 'admin@203.0.113.2', 'admin@203.0.113.3']);
  for (const [index, mesh] of meshCalls.entries()) {
    const address = '10.77.0.' + (index + 1);
    assert.ok(mesh.args.at(-1).endsWith("'mesh' '" + address + "'"), 'filter address belongs to this machine');
    assert.ok(mesh.input.startsWith('[Interface]\nAddress=' + address + '/24\n'), 'filter matches the interface address');
  }

  if (scenario === 'baseline' || measuredStops) {
    if (measuredStops) {
      assert.equal(result.baseline.restored, true);
      assert.equal(result.baseline.controlPlaneSelection.calls, 9);
      assert.ok(Number.isFinite(result.baseline.controlPlaneSelection.totalMs));
      const created = calls.find(row => row[1] === 'create-stack');
      const parameters = JSON.parse(created[created.indexOf('--parameters') + 1]);
      assert.equal(parameters.find(row => row.ParameterKey === 'ExpiryTime').ParameterValue, '2026-11-10T02:25:00');
    } else assert.deepEqual(result.baseline, {restored: true});
    assert.equal(result.removed, true);
    assert.ok(meshCalls.every(row => row.input.includes('AllowedIPs = 10.77.0.4/32')));
    assert.ok(calls.some(row => row[0] === 'sudo' && row.includes('mangle') && row.includes('PREROUTING')));
    const createdNetwork = calls.findIndex(row => row[0] === 'docker' && row[1] === 'network' && row[2] === 'create');
    assert.ok(createdNetwork >= 0 && createdNetwork < calls.findIndex(row => row[1] === 'create-stack'));
    assert.match(transports.find(row => row.input === '{"kind": "Secret"}')?.args.at(-1) ?? '', /2>\/dev\/null$/);
    assert.match(transports.find(row => row.input === '{"kind":"Secret"}')?.args.at(-1) ?? '', /'exec'.*'node'$/);
    const lifecycle = ['stop-instances', 'describe-instances', 'start-instances'];
    assert.deepEqual(calls.filter(row => lifecycle.includes(row[1])).map(row => [row[1], row.at(-1)]), measuredStops ?
      ['stop-instances', 'describe-instances', 'describe-instances', 'start-instances', 'describe-instances'].map(call => [call, output.C]) : []);
    assert.equal(calls.some(row => row[0] === 'ssh' && row.at(-1).includes('scripts/kubernetes-storage.mjs')), false);
    if (measuredStops) {
      assert.deepEqual(calls.find(row => row[0] === 'docker' && row[1] === 'tag' && row[3].endsWith(':waitron')),
        ['docker', 'tag', rehearsedWaitronImage, savedTags[1]]);
      assert.equal(calls.some(row => row[0] === 'env' && row.includes('scripts/build-backup-verifier.mjs')), false);
      assert.equal(calls.some(row => row[0] === 'docker' && row[1] === 'image' && row[2] === 'rm' && row.includes(rehearsedWaitronImage)), false);
    } else {
      assert.ok(calls.some(row => row[0] === 'env' && row.includes('--amazon-test')));
    }
    assert.deepEqual(savedTags.filter(tag => /:(source|kustomize)-controller$/.test(tag)).length, 2);
    assert.match(transports.find(row => row.input === 'synthetic-migration')?.args.at(-1) ?? '', /--context/);
    assert.equal(transports.find(row => row.input === 'synthetic-migration')?.args.at(-2), 'admin@203.0.113.2');
    assert.equal(transports.find(row => row.args.at(-1).includes('docker save'))?.args.at(-2), 'admin@203.0.113.2');
    for (const fragment of ['verifier-scratch', "'docker' 'load'"]) {
      assert.deepEqual(transports.filter(row => row.args.at(-1).includes(fragment)).map(row => row.args.at(-2)),
        ['admin@203.0.113.1', 'admin@203.0.113.2', 'admin@203.0.113.3',
          ...(measuredStops && fragment === 'verifier-scratch' ? ['admin@' + restartedAddress] : [])]);
    }
    const removedNetwork = calls.findIndex(row => row[0] === 'docker' && row[1] === 'network' && row[2] === 'rm' && row[3] === 'd'.repeat(64));
    const deletedStack = calls.findIndex(row => row[1] === 'wait' && row[2] === 'stack-delete-complete');
    assert.ok(removedNetwork >= 0 && removedNetwork < deletedStack);
    assert.equal(calls.some(row => row[1] === 'delete-stack'), false);
    return;
  }

  const uploads=transports.filter(row=>row.binary==='scp'&&row.args.at(-2).endsWith('images.tar'));
  assert.equal(uploads.length,1,'the owner uploads the image archive only once');
  assert.equal(uploads[0].args.at(-1),'admin@203.0.113.1:/tmp/d618-images.tar');
  assert.equal(uploads[0].timeout,1103196,'size-derived 10 Mbit/s cutoff plus 60 seconds');
  const privateCopies=transports.filter(row=>row.binary==='ssh'&&row.args.at(-1).includes("'cp' '/var/local/d620-config/d618-images.tar' '/tmp/d618-images.tar'"));
  assert.deepEqual(privateCopies.map(row=>[row.args.at(-2),row.timeout]),[['admin@203.0.113.2',1103196],['admin@203.0.113.3',1103196]]);
  const staged=transports.find(row=>row.binary==='ssh'&&row.args.at(-1)==="'sudo' 'cp' '/tmp/d618-images.tar' '/var/local/d620-config/d618-images.tar'");
  assert.equal(staged?.timeout,1103196);
  assert.equal(staged.args.at(-2),'admin@203.0.113.1','stage on the machine that received the upload');
  assert.ok(transports.indexOf(uploads[0])<transports.indexOf(staged)&&transports.indexOf(staged)<transports.indexOf(privateCopies[0]),'upload, then stage, then copy to workers');
  const removed=transports.find(row=>row.binary==='ssh'&&row.args.at(-1)==="'sudo' 'rm' '/var/local/d620-config/d618-images.tar'");
  assert.ok(removed,'remove shared bundle before the application can mount that directory');
  const lastStorage=calls.findLastIndex(row=>row[0]==='ssh'&&row.at(-1).includes("'storage'"));
  const upload=calls.findIndex(row=>row[0]==='scp'&&row.at(-2).endsWith('images.tar'));
  assert.ok(lastStorage>=0&&lastStorage<upload,'every worker has its private mount before distribution');
  const removal=calls.findIndex(row=>row[0]==='ssh'&&row.at(-1)==="'sudo' 'rm' '/var/local/d620-config/d618-images.tar'");
  assert.ok(removal>calls.findLastIndex(row=>row[0]==='ssh'&&row.at(-1).includes("'cp'"))&&removal<calls.findIndex(row=>row[0]==='ssh'&&row.at(-1).includes("'ctr'")));
  assert.deepEqual(joins.map(row => row.host), ['admin@203.0.113.2', 'admin@203.0.113.3']);
  for (const {input} of joins) {
    assert.equal(input, 'kubeadm join d618-api:6443 --token abcdef.0123456789abcdef --discovery-token-ca-cert-hash sha256:' + hashes + '\n' + certificateKey + '\n');
  }
  assert.ok(transports.every(({args}) => !args.some(arg => arg.includes(certificateKey) || arg.includes('abcdef.0123456789abcdef'))));
  const created = calls.find(row => row[1] === 'create-stack');
  const clusterName = created[created.indexOf('--stack-name') + 1];
  const control = calls.find(row => row[0] === 'ssh' && row.at(-1).includes("bootstrap.sh' 'control'"));
  assert.ok(control?.at(-1).endsWith("'control' '" + clusterName + "'"), 'the first member uses the run name too');
  const joinCalls = calls.filter(row => row[0] === 'ssh' && row.at(-1).includes("bootstrap.sh' 'join'"));
  assert.ok(joinCalls.every(row => row.at(-1).endsWith("'join' '" + clusterName + "'")), 'each member renames its admin context to the run name');
  const lastJoin = calls.indexOf(joinCalls.at(-1));
  const refresh = calls.findIndex(row => row[0] === 'ssh' && row.at(-1).includes("'rollout' 'restart' 'daemonset/kube-proxy'"));
  const ready = calls.findIndex(row => row[0] === 'ssh' && row.at(-1).includes("'rollout' 'status' 'daemonset/kube-proxy'"));
  const fixture = calls.findIndex(row => row[0] === 'scp' && row.at(-2).endsWith('target.json'));
  assert.ok(lastJoin >= 0 && lastJoin < refresh && refresh < ready && ready < fixture, 'refresh the proxy after both joins and wait before fixtures');
  const nodeReady = calls.findIndex(row => row[0] === 'ssh' && row.at(-1).includes("'--for=condition=Ready' 'nodes'"));
  const disks = calls.filter(row => row[0] === 'ssh' && row.at(-1).includes("bootstrap.sh' 'database-storage'"));
  const data = calls.findIndex(row => row[0] === 'ssh' && row.at(-1).includes('scripts/kubernetes-data.mjs'));
  assert.deepEqual(disks.map(row => row.at(-2)), ['admin@203.0.113.1', 'admin@203.0.113.2', 'admin@203.0.113.3']);
  assert.ok(nodeReady > lastJoin && nodeReady < data && ready < data && data < fixture);
  const dnsPatch = calls.findIndex(row => row[0] === 'ssh' && row.at(-1).includes("'patch' 'deployment' 'coredns'"));
  const dnsRollout = calls.findIndex(row => row[0] === 'ssh' && row.at(-1).includes("'rollout' 'status' 'deployment/coredns'"));
  const dnsReady = calls.findIndex(row => row[0] === 'dns rollout completed');
  assert.ok(ready < dnsPatch && dnsPatch < dnsRollout && dnsRollout < dnsReady && dnsReady < data,
    'place DNS after the proxy rollout and finish the DNS rollout before starting data setup');
  const dnsHints = calls.findIndex(row => row[0] === 'ssh' && row.at(-1).includes("'get' 'endpointslices'") &&
    row.at(-1).includes('kubernetes.io/service-name=kube-dns'));
  assert.ok(dnsReady < dnsHints && dnsHints < data, 'wait for local routing hints before starting data setup');
  assert.equal(transports.find(row => row.args.at(-1) === calls[dnsRollout].at(-1)).timeout, 125_000);
  assert.ok(disks.every(row => calls.indexOf(row) < data), 'all local directories exist before PostgreSQL starts');
  assert.equal(calls[data].at(-2), 'admin@203.0.113.1');
  // Allow the operator and database waits to finish and print their own diagnosis.
  assert.ok(transports.find(row => row.args.at(-1) === calls[data].at(-1)).timeout >= 750_000);
  assert.match(calls[data].at(-1), /'--kubeconfig=\/etc\/kubernetes\/admin\.conf'/);
  assert.ok(calls[data].at(-1).includes("'--context=" + clusterName + "'"));
  for (const suffix of ['-control-plane', '-worker', '-worker2']) {
    assert.ok(calls[data].at(-1).includes("'" + clusterName + suffix + "'"));
  }
  const storeTag = clusterName + ':store';
  const storeBuild = calls.findIndex(row => row[0] === 'docker' && row[1] === 'buildx' &&
    row.includes('deploy/kubernetes/images/store/Dockerfile') && row.includes(storeTag));
  assert.ok(storeBuild >= 0 && storeBuild < calls.indexOf(save), 'build the local store before archiving');
  assert.ok(savedTags.includes(storeTag), 'the verified bundle carries the store');
  const storeDisks = calls.filter(row => row[0] === 'ssh' && row.at(-1).includes("bootstrap.sh' 'object-storage'"));
  const store = calls.findIndex(row => row[0] === 'ssh' && row.at(-1).includes('scripts/kubernetes-storage.mjs'));
  assert.deepEqual(storeDisks.map(row => row.at(-2)), ['admin@203.0.113.1', 'admin@203.0.113.2', 'admin@203.0.113.3']);
  const storeImports = calls.filter(row => row[0] === 'ssh' && row.at(-1).includes("'inspecti'") && row.at(-1).includes(storeTag));
  assert.deepEqual(storeImports.map(row => row.at(-2)), ['admin@203.0.113.1', 'admin@203.0.113.2', 'admin@203.0.113.3']);
  assert.ok(nodeReady < store && store < fixture);
  assert.ok([...storeDisks, ...storeImports].every(row => calls.indexOf(row) < store));
  assert.equal(calls[store].at(-2), 'admin@203.0.113.1');
  assert.ok(calls[store].at(-1).includes("'" + storeTag + "'"));
  assert.match(calls[store].at(-1), /'--kubeconfig=\/etc\/kubernetes\/admin\.conf'/);
  assert.ok(calls[store].at(-1).includes("'--context=" + clusterName + "'"));
  assert.ok(calls[store].at(-1).endsWith("'10.77.0.1' '10.77.0.2' '10.77.0.3'"));
  if (scenario === 'observer') {
    assert.ok(calls.findIndex(row=>row[0]==='flux-prepare')>=0&&calls.findIndex(row=>row[0]==='flux-prepare')<calls.findIndex(row=>row[1]==='create-stack'),'prepare offline controllers before machines');
    assert.equal(savedTags.filter(tag=>/:(source|kustomize)-controller$/.test(tag)).length,2);
    assert.equal(transports.filter(row=>row.binary==='scp'&&row.args.at(-2).endsWith('/flux.json')).length,1);
    assert.deepEqual(phases, []); assert.deepEqual(result.observation, {continuous: true, stopMs: 0, replacementMs: 0});
  } else {
    assert.deepEqual(phases, ['before', 'after']);
    assert.deepEqual(result.journeys, [{checked: 'before'}, {checked: 'after'}]);
  }
  assert.equal(result.removed, true);
  const imports = calls.filter(row => row[0] === 'ssh' && row.at(-1).includes("'ctr' '-n' 'k8s.io' 'images' 'import'"));
  assert.deepEqual(imports.map(row => row.at(-2)), ['admin@203.0.113.1', 'admin@203.0.113.2', 'admin@203.0.113.3']);
  assert.deepEqual(calls.find(row => row[1] === 'stop-instances'), ['ec2', 'stop-instances', '--skip-os-shutdown', '--instance-ids', output.C]);
  const stopped = calls.findIndex(row => row[1] === 'wait' && row[2] === 'instance-stopped');
  const taint = calls.findIndex(row => row[0] === 'ssh' && row.at(-1).includes("'taint'"));
  assert.ok(stopped >= 0 && stopped < taint);
  assert.equal(calls.some(row => row[1] === 'delete-stack'), false, 'successful run must exercise independent expiry');
});

for (const phase of ['before', 'after']) test('Amazon target reuses its cluster and binds the manifest worker: ' + phase, async t => {
  const {mkdtemp, writeFile, rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os'); const {join} = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'd618-target-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const log = join(directory, 'calls');
  const target = {type: 'amazon', cluster: 'd618-12345678-1234-4234-8234-123456789abc', phase, address: '10.77.0.1',
    instances: ['i-00000000000000001','i-00000000000000002','i-00000000000000003']};
  target.context = target.cluster; target.nodes = ['-control-plane', '-worker', '-worker2'].map(suffix => target.cluster + suffix);
  await writeFile(join(directory, 'target.json'), JSON.stringify(target));
  const source = `#!${process.execPath}
const phase=${JSON.stringify(phase)},cluster=${JSON.stringify(target.cluster)};
const fs=require('node:fs'),a=process.argv.slice(2),name=require('node:path').basename(process.argv[1]);
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify([name,...a])+'\\n');
if(name==='kubectl'){
 const b=a[0]==='--context'?a.slice(4):a;
 if(b[0]==='version')console.log(JSON.stringify({clientVersion:{gitVersion:'v1.34.3'}}));
 if(b[0]==='get'){const role=b[b.indexOf('-l')+1]?.split('=')[1];if(role==='cloud')process.exit(23);console.log(JSON.stringify({items:role==='manifest'?[{metadata:{name:'manifest-old'},spec:{nodeName:cluster+(phase==='after'?'-worker':'-worker2')}}]:[]}));}
 if(b[0]==='apply'){process.stdin.resume();process.stdin.on('end',()=>process.exit(phase==='before'?17:0));}
}
`;
  for (const name of ['kubectl', 'docker', 'kind']) await writeFile(join(directory, name), source, {mode: 0o700});
  const reply = spawnSync(process.execPath, ['scripts/kubernetes-check.mjs', '--amazon', join(directory, 'target.json')],
    {encoding: 'utf8', env: {...process.env, PATH: directory + ':' + process.env.PATH,
      TEST_CLOUD_INTEGRATION_IMAGE: 'sha256:' + 'a'.repeat(64), TEST_CLOUD_INTEGRATION_WAITRON_IMAGE: 'sha256:' + 'b'.repeat(64)}, timeout: 10000});
  assert.equal(reply.status, 1); assert.match(reply.stderr, phase === 'before' ? /kubernetes.command_failed:kubectl:apply/ : /kubernetes.command_failed:kubectl:get/);
  const calls = (await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(calls.some(row => row[0] === 'kind'), false);
  assert.equal(calls.some(row => row[0] === 'docker' && row[1] === 'image' && row[2] === 'rm'), false);
  assert.equal(calls.find(row => row.includes('apply'))[2], target.context);
});

test('Amazon nested verifier keeps Docker configuration ids used by the retained ownership checks', async () => {
  const {createKubernetesVerifier} = await import('./kubernetes-check.mjs');
  const manifest = JSON.parse(await readFile(new URL('../deploy/kubernetes/local-checks.yaml', import.meta.url), 'utf8'));
  let applied;
  const adapter = createKubernetesVerifier({template: manifest.items.find(row => row.metadata.name === 'verifier'), classicImages: true,
    pod: async role => role === 'cloud' ? {status: {podIP: '10.244.0.5'}} : undefined,
    kube: async (args, input) => {if (args[0] === 'apply') applied = JSON.parse(input); return '';}, loadImage: async () => {}});
  await adapter.start('12345678-1234-4234-8234-123456789abc', {image: 'sha256:' + 'a'.repeat(64), revision: 'c'.repeat(40)});
  assert.ok(applied.spec.containers.find(row => row.name === 'docker').args.includes('--feature=containerd-snapshotter=false'));
});

test('saved tar requires the selected amd64 manifest, config and every layer', async t => {
  assert.equal(typeof api.checkAmazonArchive, 'function');
  const {mkdtemp, mkdir, writeFile, rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os'); const {join} = await import('node:path');
  const {execFileSync} = await import('node:child_process');
  const directory = await mkdtemp(join(tmpdir(), 'd618-tar-'));
  t.after(() => rm(directory, {recursive:true,force:true}));
  const digest = n => 'sha256:' + n.repeat(64), blob = n => 'blobs/sha256/' + n.repeat(64);
  const selected = {digest:digest('2'),platform:{os:'linux',architecture:'amd64'}};
  const root = {annotations:{'io.containerd.image.name':'docker.io/library/synthetic:local'},digest:digest('1')};
  const files = {'index.json':JSON.stringify({manifests:[root]}),
    [blob('1')]:JSON.stringify({manifests:[{digest:digest('9'),platform:{os:'linux',architecture:'arm64'}},selected]}),
    [blob('2')]:JSON.stringify({config:{digest:digest('3')},layers:[{digest:digest('4')}]}),
    [blob('3')]:JSON.stringify({os:'linux',architecture:'amd64'}),[blob('4')]:'synthetic layer'};
  await mkdir(join(directory,'blobs/sha256'),{recursive:true});
  for (const [name,data] of Object.entries(files)) await writeFile(join(directory,name),data);
  const archive = join(directory,'images.tar');
  const pack = omitted => execFileSync('tar',['-cf',archive,'-C',directory,...Object.keys(files).filter(name => name !== omitted)]);
  const run = async (binary,args) => execFileSync(binary,args,{encoding:'utf8'}).trim();
  pack(); await api.checkAmazonArchive(archive,['synthetic:local'],run);
  for (const missing of ['index.json',blob('1'),blob('2'),blob('3'),blob('4')]) {
    pack(missing);
    await assert.rejects(api.checkAmazonArchive(archive,['synthetic:local'],run), /amazon.archive_blob/);
  }
  await writeFile(join(directory,'index.json'),JSON.stringify({manifests:[{...root,...selected}]}));
  pack(); await api.checkAmazonArchive(archive,['synthetic:local'],run);
  await writeFile(join(directory,'index.json'),JSON.stringify({manifests:[{...root,...selected,platform:{os:'linux',architecture:'arm64'}}]}));
  pack(); await assert.rejects(api.checkAmazonArchive(archive,['synthetic:local'],run), /amazon.archive_platform/);
  await t.test('direct manifest requires configuration-proved linux/amd64',async()=>{
    await writeFile(join(directory,'index.json'),JSON.stringify({manifests:[{...root,digest:selected.digest}]}));
    pack();await api.checkAmazonArchive(archive,['synthetic:local'],run);
    await writeFile(join(directory,blob('3')),JSON.stringify({os:'linux',architecture:'arm64'}));pack();
    await assert.rejects(api.checkAmazonArchive(archive,['synthetic:local'],run),/amazon.archive_platform/);
    await writeFile(join(directory,blob('3')),files[blob('3')]);
  });
  await writeFile(join(directory,'index.json'),JSON.stringify({manifests:[{...root,...selected}]}));
  for(const config of [{os:'linux'},{architecture:'amd64'},{os:'linux',architecture:'arm64'},
    {os:'linux',architecture:'unknown'},{os:'windows',architecture:'amd64'}])await t.test('configuration refuses '+JSON.stringify(config),async()=>{
    await writeFile(join(directory,blob('3')),JSON.stringify(config));pack();
    await assert.rejects(api.checkAmazonArchive(archive,['synthetic:local'],run),/amazon.archive_platform/);
  });
  await t.test('malformed configuration cannot supply platform evidence',async()=>{
    await writeFile(join(directory,blob('3')),'{broken');pack();
    await assert.rejects(api.checkAmazonArchive(archive,['synthetic:local'],run),SyntaxError);
  });
  await writeFile(join(directory,blob('3')),files[blob('3')]);
  for(const platform of [{os:'linux'},{os:'linux',architecture:'arm64'}])await t.test('outer metadata refuses '+JSON.stringify(platform),async()=>{
    await writeFile(join(directory,'index.json'),JSON.stringify({manifests:[{...root,platform}]}));pack();
    await assert.rejects(api.checkAmazonArchive(archive,['synthetic:local'],run),/amazon.archive_platform/);
  });
  await writeFile(join(directory,'index.json'),files['index.json']);pack();
  await assert.rejects(api.checkAmazonArchive(archive,['wrong:local'],run),/amazon.archive_image/);
  await writeFile(join(directory,blob('1')),JSON.stringify({manifests:[{...selected,platform:{os:'linux',architecture:'arm64'}}]}));pack();
  await assert.rejects(api.checkAmazonArchive(archive,['synthetic:local'],run),/amazon.archive_platform/);
});

test('Amazon baseline runs one healthy journey and keeps the independent deletion check', async () => {
  const calls = [], stage = name => async () => {calls.push(name);};
  const forbidden = () => assert.fail('baseline must not stop or replace a machine');
  const operations = {create: stage('create'), prepare: stage('prepare'),
    baseline: async () => {calls.push('baseline'); return {restored: true};},
    journey: forbidden, stopWorker: forbidden, waitStopped: forbidden, replace: forbidden,
    checkStopped: forbidden, waitDeleted: stage('deleted'), deleteStack: stage('delete')};
  assert.deepEqual(await api.runAmazonExperiment(operations, {waitExpiry: stage('expiry')}),
    {baseline: {restored: true}, removed: true});
  assert.deepEqual(calls, ['create', 'prepare', 'baseline', 'expiry', 'deleted']);
  calls.length = 0;
  await assert.rejects(api.runAmazonExperiment({...operations, baseline: async () => {throw Error('baseline failed');}},
    {waitExpiry: forbidden}), /baseline failed/);
  assert.deepEqual(calls, ['create', 'prepare', 'delete', 'deleted']);
});

// The observer owns the retained clients; no second journey may replace them.
test('observer mode completes before stopped-state readback and independent deletion', async () => {
  const calls = [], stage = name => async () => {calls.push(name);};
  const result = await api.runAmazonExperiment({create: stage('create'), prepare: stage('prepare'),
    observe: async () => {calls.push('observe'); return {offMs: 900000};},
    journey: () => {throw Error('separate journey');}, checkStopped: stage('still-stopped'),
    waitDeleted: stage('deleted'), deleteStack: stage('delete')}, {waitExpiry: stage('expiry')});
  assert.deepEqual(calls, ['create', 'prepare', 'observe', 'still-stopped', 'expiry', 'deleted']);
  assert.deepEqual(result.observation, {offMs: 900000}); assert.equal(result.removed, true);
});

test('observer transport waits for ready, confirms stopped and replacement over its open stdin', async () => {
  assert.equal(typeof api.observerCommand, 'function');
  const stages = [];
  const program = `process.stdout.write('P1_READY\\n'); let s=''; process.stdin.on('data',p=>{s+=p; if(s==='P1_STOPPED\\nP1_REPLACEMENT_READY\\n'){process.stdout.write(JSON.stringify({observed:true}));process.exit(0);}});`;
  const result = await api.observerCommand(process.execPath, ['-e', program], {
    onReady: async send => {stages.push('stop'); send('P1_STOPPED'); stages.push('replace'); send('P1_REPLACEMENT_READY');}, timeout: 3000});
  assert.deepEqual(result, {observed: true}); assert.deepEqual(stages, ['stop', 'replace']);
});

for (const failure of ['never ready', 'stop failed', 'cancelled']) test('observer transport closes its owned child: ' + failure, async () => {
  assert.equal(typeof api.observerCommand, 'function');
  const controller = new AbortController();
  const ready = failure === 'never ready' ? '' : `process.stdout.write('P1_READY\\n');`;
  await assert.rejects(api.observerCommand(process.execPath, ['-e', ready + 'setInterval(()=>{},1000);'], {
    timeout: failure === 'never ready' ? 100 : 3000, signal: controller.signal,
    onReady: async () => {if (failure === 'stop failed') throw Error('stop failed'); controller.abort();},
  }), failure === 'stop failed' ? /stop failed/ : /amazon.observer_/);
});

test('outside host binds three individual mesh routes and removes only its own interface', async t => {
  const {mkdtemp, rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const outside = await import('./kubernetes-outside.mjs').catch(error => {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    return {};
  });
  assert.equal(typeof outside.startOutsideMesh, 'function');
  const directory = await mkdtemp(join(tmpdir(), 'outside-mesh-test-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const privateKey = Buffer.alloc(32, 1).toString('base64');
  const publicKey = Buffer.alloc(32, 2).toString('base64');
  const peers = [3, 4, 5].map(value => ({endpoint: '192.0.2.' + value,
    publicKey: Buffer.alloc(32, value).toString('base64')}));
  const calls = [], signal = new AbortController().signal;
  const mesh = await outside.startOutsideMesh({directory, peers, async prepareNodes(key) {
    assert.equal(key, publicKey);
    calls.push('nodes ready');
  }, async run(binary, args, input, cleanup, timeout, request) {
    if (binary === 'wg') return args[0] === 'genkey' ? privateKey : publicKey;
    calls.push([binary, ...args]);
    if (args[1] === 'wg') {
      assert.equal(cleanup, false, 'a live route refresh must follow its own deadline');
      assert.equal(request, signal);
    } else {
      assert.equal(cleanup, true, 'an interrupted command must not strand an interface');
    }
  }});
  assert.match(mesh.interfaceName, /^d621[a-f0-9]{11}$/);
  const config = join(directory, mesh.interfaceName + '.conf');
  assert.equal(await readFile(config, 'utf8'), [
    '[Interface]', 'Address = 10.77.0.4/32', 'MTU = 1420', 'PrivateKey = ' + privateKey,
    ...peers.flatMap((peer, index) => ['', '[Peer]', 'PublicKey = ' + peer.publicKey,
      'AllowedIPs = 10.77.0.' + (index + 1) + '/32', 'Endpoint = ' + peer.endpoint + ':51821', 'PersistentKeepalive = 15']),
    '',
  ].join('\n'));
  assert.deepEqual(calls, ['nodes ready', ['sudo', '-n', 'wg-quick', 'up', config]]);
  await mesh.refreshEndpoint(1, '192.0.2.24', signal);
  assert.deepEqual(calls.at(-1), ['sudo', '-n', 'wg', 'set', mesh.interfaceName, 'peer', peers[1].publicKey,
    'endpoint', '192.0.2.24:51821']);
  await mesh.close();
  assert.deepEqual(calls.at(-1), ['sudo', '-n', 'wg-quick', 'down', config]);
  assert.equal(existsSync(config), false);
});

test('the outside baseline installs its host firewall before the tunnel and removes it after the tunnel', async t => {
  const {mkdtemp, rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const {startOutsideMesh} = await import('./kubernetes-outside.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'outside-firewall-test-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const key = 'A'.repeat(43) + '=';
  const peers = [1, 2, 3].map(i => ({endpoint: '192.0.2.' + i, publicKey: key}));
  const calls = [];
  let refused = false;
  const mesh = await startOutsideMesh({directory, peers, restrictInbound: true, prepareNodes: async () => {},
    run: async (binary, args, input, cleanup) => {
      if (binary === 'wg') return key;
      calls.push(args.slice(1));
      assert.equal(cleanup, true);
      if (args.includes('mangle') && args.includes('-D') && !refused) {refused = true; throw Error('synthetic filter removal failure');}
    }});
  const jump = ['PREROUTING', '-i', mesh.interfaceName, '-j', mesh.interfaceName];
  const iptables = ['iptables', '-w', '-t', 'mangle'];
  const hostInput = ['iptables', '-w', '-i', mesh.interfaceName, '-m', 'conntrack',
    '!', '--ctstate', 'ESTABLISHED,RELATED', '-j', 'DROP'];
  const inputRule = op => [...hostInput.slice(0, 2), op, 'INPUT', ...hostInput.slice(2)];
  const mangle = calls.filter(args => args.includes('mangle'));
  assert.ok(calls.findIndex(args => JSON.stringify(args) === JSON.stringify(inputRule('-I'))) >= 0);
  assert.deepEqual(mangle.slice(-5), [
    [...iptables, '-A', mesh.interfaceName, '-m', 'conntrack', '--ctstate', 'ESTABLISHED,RELATED', '-j', 'RETURN'],
    [...iptables, '-A', mesh.interfaceName, '-p', 'tcp', '-d', '10.77.0.4', '--dport', '18000', '-j', 'RETURN'],
    [...iptables, '-A', mesh.interfaceName, '-p', 'tcp', '-d', '10.77.0.4', '--dport', '1025', '-j', 'RETURN'],
    [...iptables, '-A', mesh.interfaceName, '-j', 'DROP'],
    [...iptables, '-I', ...jump],
  ]);
  assert.equal(calls.at(-1)[1], 'up');
  await assert.rejects(mesh.close(), /synthetic filter removal failure/);
  await mesh.close();
  assert.equal(calls.filter(args => args[0] === 'wg-quick' && args[1] === 'down').length, 1);
  const removed = calls.slice(calls.findIndex(args => args[0] === 'wg-quick' && args[1] === 'down') + 1);
  assert.equal(removed.filter(args => JSON.stringify(args) === JSON.stringify(inputRule('-D'))).length, 1);
  assert.deepEqual(removed.filter(args => args.includes('mangle')).at(-3), [...iptables, '-D', ...jump]);
  assert.deepEqual(removed.filter(args => args.includes('mangle')).at(-1), [...iptables, '-X', mesh.interfaceName]);
});
