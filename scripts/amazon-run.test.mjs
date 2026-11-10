import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
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

for (const failure of ['create', 'prepare', 'before', 'stop', 'stopped', 'replace', 'after', 'still-stopped', 'expiry', 'deleted']) {
  test('Amazon teardown runs and failure survives at ' + failure, async () => {
    assert.equal(typeof api.runAmazonExperiment, 'function');
    const calls = [], stage = name => async () => {calls.push(name); if (name === failure) throw Error('failed-' + name);};
    await assert.rejects(api.runAmazonExperiment({create: stage('create'), prepare: stage('prepare'),
      journey: async phase => stage(phase)(), stopWorker: stage('stop'), waitStopped: stage('stopped'),
      replace: stage('replace'), checkStopped: stage('still-stopped'), waitDeleted: stage('deleted'), deleteStack: stage('delete')},
      {sleep: stage('sleep'), waitExpiry: stage('expiry')}), new RegExp('failed-' + failure));
    assert.ok(calls.includes('delete'));
    assert.equal(calls.at(-1), 'deleted');
    if (['stop', 'stopped'].includes(failure)) assert.equal(calls.includes('after'), false);
  });
}

test('all three machines wait for deletion schedule, use disposable root disks and expose only SSH to the operator', async () => {
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
  assert.deepEqual(resources.Firewall.Properties.SecurityGroupIngress, [{IpProtocol: 'tcp', FromPort: 22, ToPort: 22, CidrIp: {Ref: 'OperatorCidr'}}]);
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
test('bootstrap refuses an unsupported phase before touching the host', () => {
  const result = spawnSync('bash', ['deploy/kubernetes/bounded-amazon/bootstrap.sh', 'unknown'], {encoding: 'utf8'});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown bootstrap phase/);
});

const config = {region: 'eu-north-1', account: '123456789012', image: 'ami-00000000000000001', key: 'synthetic-d618',
  operatorCidr: '203.0.113.8/32', sshKey: '/synthetic/key', stackRole: 'arn:aws:iam::123456789012:role/d618-stack',
  schedulerRole: 'arn:aws:iam::123456789012:role/d618-expiry', waitronCheckout: '/synthetic/waitron'};
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
for (const [scenario, expectedError] of [['complete', null], ['failed creation', /creation failed/], ['wrong instance', /amazon.instance_binding/], ['wrong imported image', /amazon.import_digest/], ['late deletion', /amazon.deletion_late/]]) test('Amazon distribution and journeys: ' + scenario, async () => {
  const calls = [], phases = [], metadata = [], hashes = 'a'.repeat(64);
  let time = Date.UTC(2026, 10, 10), target, savedTags = [], deleting = false;
  const output = {A: 'i-00000000000000001', B: 'i-00000000000000002', C: 'i-00000000000000003',
    AddressA: '203.0.113.1', AddressB: '203.0.113.2', AddressC: '203.0.113.3', PrivateA: '10.78.0.10', PrivateB: '10.78.0.11', PrivateC: '10.78.0.12'};
  const running = api.startAmazon(config, {now: () => time, sleep: async ms => {time += ms;},
    aws: async (service, args) => {
      calls.push([service, ...args]);
      if (args[0] === 'create-stack' && scenario === 'failed creation') throw Error('creation failed');
      if (args[0] === 'delete-stack') deleting = true;
      if (args[0] === 'wait' && args[1] === 'stack-delete-complete' && scenario === 'late deletion' && !deleting) throw Object.assign(Error('timeout'), {code: 'ETIMEDOUT'});
      if (service === 'sts') return JSON.stringify({Account: config.account, Arn: 'arn:aws:iam::123456789012:user/test'});
      if (args[0] === 'describe-stacks') return JSON.stringify({Stacks: [{Outputs: Object.entries(output).map(([OutputKey, OutputValue]) => ({OutputKey, OutputValue}))}]});
      if (args[0] === 'describe-instances') return JSON.stringify({Reservations: [{Instances: [{InstanceId: output.C, State: {Name: 'stopped'}}]}]});
      assert.ok(['create-stack', 'stop-instances', 'wait', 'delete-stack'].includes(args[0]), 'unexpected provider command ' + args[0]);
      return '';
    }, run: async (binary, args, input) => {
      calls.push([binary, ...args]);
      if (binary === 'uname') return 'x86_64';
      if (binary === 'docker' && args[0] === 'save') savedTags = args.slice(3);
      if (binary === 'wc') return '104857600 images.tar';
    if (binary === 'tar') return JSON.stringify(savedTags.map(tag => ({Config: 'blobs/sha256/' + hashes, RepoTags: ['docker.io/' + (tag.includes('/') ? tag : 'library/' + tag)]})));
      if (binary === 'wg') return 'A'.repeat(43) + '=';
      if (binary === 'docker' && args[0] === 'image' && args[1] === 'inspect') return JSON.stringify([{Id: 'sha256:' + 'c'.repeat(64), Architecture: 'amd64', Os: 'linux'}]);
      if (binary === 'scp' && args.at(-2).endsWith('target.json')) target = JSON.parse(await readFile(args.at(-2), 'utf8'));
      if (binary === 'ssh') {
        const script = args.at(-1);
        if (script.includes('169.254.169.254')) {const index = Number(args.at(-2).at(-1)); metadata.push(index); return scenario === 'wrong instance' ? 'i-00000000000000009' : output[['A','B','C'][index - 1]];}
        if (script.includes('sha256sum')) return hashes;
        if (script.includes('crictl')) return JSON.stringify({status: {id: 'sha256:' + (scenario === 'wrong imported image' ? 'b'.repeat(64) : hashes), pinned: false, repoTags: [], repoDigests: [], size: '364', username: ''}, info: {}});
        if (script.includes('kubernetes-check.mjs')) {phases.push(target.phase); assert.ok(script.includes('sha256:' + hashes)); assert.equal(target.instances[2], output.C); return JSON.stringify({checked: target.phase});}
        if (script.includes('jsonpath=')) return 'manifest-old';
        if (script.includes('token')) return 'kubeadm join 10.77.0.1:6443 --token synthetic --discovery-token-ca-cert-hash sha256:' + hashes;
      }
      return '';
    }});
  if (expectedError) {
    await assert.rejects(running, expectedError);
    const created = calls.find(row => row[1] === 'create-stack'), name = created[created.indexOf('--stack-name') + 1];
    assert.match(name, /^d618-[a-f0-9-]{36}$/);
    assert.equal(calls.find(row => row[1] === 'delete-stack')?.at(-1), name);
    assert.equal(calls.find(row => row[1] === 'wait' && row[2] === 'stack-delete-complete')?.at(-1), name);
    assert.equal(calls.some(row => row[0] === 'docker' && row[1] === 'buildx' && ['create', 'rm'].includes(row[2])), false);
    if (['wrong instance', 'wrong imported image'].includes(scenario)) assert.deepEqual(phases, []);
    return;
  }
  const result = await running;
  assert.deepEqual(metadata, [1, 2, 3]);
  assert.deepEqual(phases, ['before', 'after']);
  assert.deepEqual(result.journeys, [{checked: 'before'}, {checked: 'after'}]);
  assert.equal(result.removed, true);
  const imports = calls.filter(row => row[0] === 'ssh' && row.at(-1).includes("'ctr' '-n' 'k8s.io' 'images' 'import'"));
  assert.deepEqual(imports.map(row => row.at(-2)), ['admin@203.0.113.1', 'admin@203.0.113.2', 'admin@203.0.113.3']);
  assert.deepEqual(calls.find(row => row[1] === 'stop-instances'), ['ec2', 'stop-instances', '--instance-ids', output.C]);
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
