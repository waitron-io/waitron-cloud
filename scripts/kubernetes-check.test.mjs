import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn, spawnSync} from 'node:child_process';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bootstrap} from '../deploy/local-stack/bootstrap.mjs';
import {runTestCloudClients} from './test-cloud-integration.mjs';
import {testRuntimeEnvironment} from '../deploy/test-cloud/runtime.mjs';

test('Kubernetes account selects its proxy while other roles discard that input and secrets', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'cloud-kube-runtime-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const config = await bootstrap(directory);
  const input = {CLOUD_TEST_SERVICE_PLANS: '1', CLOUD_HTTP_TRUSTED_PROXY_IPS: '10.244.0.12', NODE_AUTH_TOKEN: 'synthetic-not-forwarded'};
  const account = testRuntimeEnvironment('account', config, input);
  assert.equal(account.CLOUD_HTTP_TRUSTED_PROXY_IPS, '10.244.0.12');
  assert.equal(account.NODE_AUTH_TOKEN, undefined);
  assert.equal(testRuntimeEnvironment('account', config, {}).CLOUD_HTTP_TRUSTED_PROXY_IPS, '10.79.0.2');
  for (const role of ['email', 'monitor', 'usage', 'probe', 'backup', 'gateway', 'manifest', 'reconcile', 'translation']) {
    const environment = testRuntimeEnvironment(role, config, input);
    assert.equal(environment.CLOUD_HTTP_TRUSTED_PROXY_IPS, undefined, role);
    assert.equal(environment.NODE_AUTH_TOKEN, undefined, role);
  }
});

for (const detail of ['', ' npm E404']) test('client build records the observed builder without disclosing private output' + detail, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'cloud-kube-build-'));
  const before = process.env.PATH;
  t.after(async () => {process.env.PATH = before; await rm(directory, {recursive: true, force: true});});
  const image = 'sha256:' + 'b'.repeat(64);
  await writeFile(join(directory, 'docker'), `#!${process.execPath}
const a=process.argv.slice(2);
if(a[0]==='image'&&a[1]==='inspect')console.log(JSON.stringify([{Id:${JSON.stringify(image)},RepoTags:['d620-pinned:local'],Config:{Labels:{'cloud.waitron-revision':'ec91a9e34d2daba146f4ee61850ea4136ad5cfb7'}}}]));
if(a[0]==='build'){process.stderr.write(${JSON.stringify('DEPRECATED: The legacy builder is deprecated. Install the buildx component.' + detail + ' PRIVATE_BUILD_CANARY')});process.exit(17);}
`, {mode: 0o700});
  process.env.PATH = directory + ':' + before;
  await assert.rejects(runTestCloudClients({image: 'sha256:' + 'a'.repeat(64), waitronImage: image}), error => {
    assert.equal(error.message, 'integration.command_failed:client-build:integration.client_build_used_legacy_builder');
    assert.equal(String(error.stack).includes('PRIVATE_BUILD_CANARY'), false);
    return true;
  });
});

// Without the target binding guard, an incomplete Kubernetes target can silently run Compose.
test('Kubernetes journey refuses an incomplete target before building or creating Compose services', async () => {
  await assert.rejects(runTestCloudClients({image: 'sha256:' + 'a'.repeat(64), waitronImage: 'sha256:' + 'b'.repeat(64),
    kubernetes: {namespace: 'default'}}), /integration.kubernetes_binding/);
});

// This exercises the actual native clients and every retained refusal against Kubernetes.
test('one-node Kubernetes services sign in, pair, restore a captured backup and withdraw remote access', {
  skip: process.env.TEST_KUBERNETES_CHECK !== '1', timeout: 900000,
}, () => {
  const run = spawnSync(process.execPath, ['scripts/kubernetes-check.mjs'], {encoding: 'utf8', timeout: 840000});
  assert.equal(run.status, 0, run.stderr);
  if (run.stderr) process.stderr.write(run.stderr);
  const reply = JSON.parse(run.stdout);
  assert.match(reply.kubernetes.cluster, /^d620-/);
  assert.equal(reply.accountMail.free, 'proved'); assert.equal(reply.accountMail.paid, 'proved');
  assert.equal(reply.clients.demoVenues, 2); assert.equal(reply.clients.restartIdentity, 'proved');
  assert.deepEqual(reply.freeRemote.submit, {status: 403, error: 'permission_denied'});
  assert.deepEqual(reply.freeRemote.invalidProof, {status: 401, error: 'invalid_proof'});
  assert.equal(reply.paidRemote.routes.staffAvailability, 200);
  assert.equal(reply.paidRemote.routes.publicAfterChallenge, 200);
  assert.equal(reply.paidRemote.withdrawal.peerRemoved, true);
  assert.ok(reply.paidSnapshot, 'the native client must publish a captured backup');
  assert.equal(reply.paidSnapshot.verification, 'verified');
  const verification = reply.paidSnapshot.workerVerification;
  for (const key of ['pointId', 'sha256', 'bytes']) assert.equal(verification[key], reply.paidSnapshot[key]);
  assert.equal(verification.modules, 15); assert.equal(verification.status, 'passed');
  assert.equal(verification.activation, 'not_attempted'); assert.equal(verification.noSupersession, true);
  assert.equal(verification.cleanupConfirmed, true); assert.equal(verification.childAbsent, true);
  assert.equal(verification.workerStoppedNaturally, true);
  assert.deepEqual(reply.cleanup.remaining, []);
  assert.equal(reply.kubernetes.removed, true);
});

test('Kubernetes refuses unsupported recovery modes and a target outside its owned cluster', async t => {
  const fixture = await commandFixture(t, 'guards'), before = process.env.PATH;
  process.env.PATH = fixture.env.PATH; t.after(() => {process.env.PATH = before;});
  const target = {cluster: 'd620-abc', namespace: 'default', account: 'kube-account', ca: 'not-consumed',
    network: 'kind', proxyIp: '172.18.0.2', port: 3000, mailPort: 8025,
    exec: () => assert.fail('must not reach cluster'), remote: {worker: () => assert.fail('must not reach worker')}};
  const options = {image: 'sha256:' + 'a'.repeat(64), waitronImage: 'sha256:' + 'b'.repeat(64), kubernetes: target};
  for (const flag of ['paidRecovery', 'paidAuthorisedRecovery', 'paidStream', 'paidContinuousRecovery',
    'measureCapacity', 'measureIntegration', 'cloudRollback', 'schemaRollback', 'fixedProject', 'pairedExpiry', 'paidSnapshot']) {
    await assert.rejects(runTestCloudClients({...options, [flag]: true}), /integration.kubernetes_scope/, flag);
  }
  for (const change of [{account: 'some-real-container'}, {network: 'bridge'}]) {
    await assert.rejects(runTestCloudClients({...options, kubernetes: {...target, ...change}}), /integration.kubernetes_binding/);
  }
  assert.equal(await readFile(fixture.log, 'utf8').catch(() => ''), '', 'invalid targets must reach no external tool');
});

async function commandFixture(t, mode) {
  const directory = await mkdtemp(join(tmpdir(), 'cloud-kube-commands-')), log = join(directory, 'calls');
  t.after(async () => {
    for (const line of (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean)) {
      const row = JSON.parse(line); if (row.forward || row.exporter) {try {process.kill(row.forward || row.exporter, 'SIGKILL');} catch {}}
    }
    await rm(directory, {recursive: true, force: true});
  });
  const source = `#!${process.execPath}
const fs=require('node:fs'),a=process.argv.slice(2),name=require('node:path').basename(process.argv[1]);
const log=${JSON.stringify(log)},mode=${JSON.stringify(mode)},record=row=>fs.appendFileSync(log,JSON.stringify(row)+'\\n');
record({name,args:a});
if(name==='docker'&&a[0]==='save'&&mode==='load-fails'){record({exporter:process.pid});process.stdout.on('error',()=>{});process.on('SIGTERM',()=>{});setInterval(()=>process.stdout.write(Buffer.alloc(1024)),25);}
if(name==='docker'&&a[0]==='save'&&mode==='load-exit'){record({exporter:process.pid});process.stdout.write('archive');}
if(name==='kind'&&a[0]==='version')console.log('kind v0.31.0');
if(name==='kind'&&a[0]==='create'&&a.includes('--config'))record({configuration:JSON.parse(fs.readFileSync(0,'utf8'))});
if(name==='kind'&&a[0]==='create'&&mode==='create-fails')process.exit(17);
if(name==='docker'&&a[0]==='volume'&&a[1]==='create')console.log(a.at(-1));
if(name==='docker'&&a[0]==='volume'&&a[1]==='inspect')console.log('/var/lib/docker/volumes/'+a.at(-1)+'/_data');
if(name==='docker'&&a[0]==='volume'&&a[1]==='ls')console.log(a.find(v=>v.startsWith('name=')).slice(5));
if(name==='docker'&&a[0]==='inspect')console.log(JSON.stringify([{NetworkSettings:{Networks:{kind:{IPAddress:'172.18.0.2'}}}}]));
if(name==='kubectl'){
 const b=a[0]==='--context'?a.slice(4):a;
 if(b[0]==='version')console.log(JSON.stringify({clientVersion:{gitVersion:'v1.34.3'}}));
 if(b[0]==='apply'){let text='';process.stdin.on('data',v=>text+=v);process.stdin.on('end',()=>{record({manifest:JSON.parse(text)});if(mode==='apply-fails')process.exit(17);});}
 if(b[0]==='get'){
  const role=b[b.indexOf('-l')+1]?.split('=')[1],cluster=a[1].slice(5);
  console.log(JSON.stringify({items:[{metadata:{name:role},spec:{nodeName:cluster+'-control-plane',containers:[{name:'account',image:cluster+':cloud'}]},status:role==='verifier'&&mode==='signal'?{containerStatuses:[{name:'verifier',state:{terminated:{reason:'Error',exitCode:137}}}]}:undefined}]}));
 }
 if(b[0]==='port-forward'){
  process.on('SIGTERM',()=>{});record({forward:process.pid});
  for(const port of b.filter(v=>/^:\\d+$/.test(v)))console.log('Forwarding from 127.0.0.1:41000 -> '+port.slice(1));
  setInterval(()=>{},1000);
 }
 if(b[0]==='exec'){if(mode==='load-exit'){process.stdin.resume();process.stdin.on('end',()=>{process.stderr.write('PRIVATE_IMAGE_LOAD_CANARY');process.exit(17);});}else if(mode==='load-fails'){const refuse=()=>{if(fs.readFileSync(log,'utf8').includes('\"exporter\":')){process.stderr.write('PRIVATE_IMAGE_LOAD_CANARY');process.exit(17);}setTimeout(refuse,5);};refuse();}else process.kill(process.ppid,'SIGTERM');}
}
`;
  for (const name of ['kind', 'kubectl', 'docker']) await writeFile(join(directory, name), source, {mode: 0o700});
  return {directory, log, env: {...process.env, TMPDIR: directory, PATH: directory + ':' + process.env.PATH,
    TEST_CLOUD_INTEGRATION_IMAGE: 'sha256:' + 'a'.repeat(64), TEST_CLOUD_INTEGRATION_WAITRON_IMAGE: 'sha256:' + 'b'.repeat(64)}};
}
for (const mode of ['create-fails', 'signal', 'apply-fails']) test('local command cleans owned cluster, tag and scratch after ' + mode, async t => {
  const fixture = await commandFixture(t, mode);
  const child = spawn(process.execPath, ['scripts/kubernetes-check.mjs'], {env: fixture.env, stdio: ['ignore', 'ignore', 'pipe']});
  let error = ''; child.stderr.on('data', part => {error += part;});
  const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
  const code = await new Promise(resolve => child.once('close', resolve)); clearTimeout(timer);
  assert.equal(code, 1, error);
  if (mode === 'apply-fails') assert.match(error, /kubernetes.command_failed:kubectl:apply/);
  const rows = (await readFile(fixture.log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  if (mode === 'signal') {
    assert.match(error, /Kubernetes verifier termination \{"reason":"Error","exitCode":137\}/);
    assert.ok(rows.some(row => row.args?.[4] === 'logs'), 'cancelled runs must still collect worker output');
  }
  if (mode === 'apply-fails') {
    const applied = rows.find(row => row.manifest).manifest;
    assert.equal(applied.items.some(item => item.metadata.name === 'verifier'), false, 'verifier must wait for the actual captured point');
    const config = applied.items.find(item => item.kind === 'ConfigMap').data['proxy.cfg'];
    const original = await readFile(new URL('../deploy/test-cloud/proxy.cfg', import.meta.url), 'utf8');
    for (const line of original.split('\n').filter(line => !line.includes('bind :3000') && !line.includes('server account account:3000'))) assert.ok(config.includes(line));
    assert.ok(config.includes('bind :3443')); assert.ok(config.includes('server account 127.0.0.1:3000'));
  }
  assert.ok(rows.some(row => row.name === 'kind' && row.args[0] === 'delete'), 'owned cluster deletion must run');
  assert.ok(rows.some(row => row.name === 'docker' && row.args[0] === 'image' && row.args[1] === 'rm'), 'owned tag removal must run');
  const create = rows.find(row => row.name === 'kind' && row.args[0] === 'create').args;
  const remove = rows.find(row => row.name === 'kind' && row.args[0] === 'delete').args;
  assert.equal(remove[remove.indexOf('--name') + 1], create[create.indexOf('--name') + 1]);
  assert.equal(create.includes('--config'), false, 'the default target retains one node');
  assert.equal(rows.find(row => row.name === 'docker' && row.args[0] === 'image').args.at(-1), rows.find(row => row.name === 'docker' && row.args[0] === 'tag').args.at(-1));
  assert.equal((await readdir(fixture.directory)).some(name => name.startsWith('cloud-kubernetes-')), false);
});

test('three-node target mounts one private configuration directory into every node', async t => {
  const fixture = await commandFixture(t, 'create-fails');
  const run = spawnSync(process.execPath, ['scripts/kubernetes-check.mjs', '--worker-loss'], {env: fixture.env, encoding: 'utf8', timeout: 10000});
  assert.equal(run.status, 1, run.stderr);
  const rows = (await readFile(fixture.log, 'utf8')).trim().split('\n').map(JSON.parse);
  const config = rows.find(row => row.configuration)?.configuration;
  assert.deepEqual(config?.nodes.map(row => row.role), ['control-plane', 'worker', 'worker']);
  const source = config.nodes[0].extraMounts[0].hostPath;
  for (const node of config.nodes) assert.deepEqual(node.extraMounts, [{hostPath: source, containerPath: '/var/local/d620-config'}]);
  const volume = rows.find(row => row.name === 'docker' && row.args[0] === 'volume' && row.args[1] === 'create');
  assert.ok(volume, 'create an owned Linux volume before kind');
  const name = volume.args.at(-1);
  assert.match(name, /^d620-[a-f0-9-]+-config$/);
  assert.ok(volume.args.includes('cloud.campaign=D618'));
  assert.ok(volume.args.includes('cloud.d618.run=' + name.slice(0, -7)));
  assert.equal(source, '/var/lib/docker/volumes/' + name + '/_data');
  const removed = rows.findIndex(row => row.name === 'docker' && row.args[0] === 'volume' && row.args[1] === 'rm');
  assert.deepEqual(rows[removed]?.args, ['volume', 'rm', name]);
  assert.ok(removed > rows.findIndex(row => row.name === 'kind' && row.args[0] === 'delete'), 'the owned volume outlives cluster teardown');
  assert.ok(rows.some(row => row.args?.[0] === 'delete'), 'failed creation still removes its own cluster');
});

test('three-node target rejects a manifest worker on the data node', async t => {
  const fixture = await commandFixture(t, 'wrong-node');
  const run = spawnSync(process.execPath, ['scripts/kubernetes-check.mjs', '--worker-loss'], {env: fixture.env, encoding: 'utf8', timeout: 10000});
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /kubernetes.node_binding/);
  const rows = (await readFile(fixture.log, 'utf8')).trim().split('\n').map(JSON.parse);
  const create = rows.find(row => row.name === 'kind' && row.args[0] === 'create').args;
  const cluster = create[create.indexOf('--name') + 1], items = rows.find(row => row.manifest).manifest.items;
  for (const name of ['cloud', 'gateway']) assert.deepEqual(items.find(row => row.metadata.name === name).spec.nodeSelector, {'kubernetes.io/hostname': cluster + '-control-plane'});
  const affinity = items.find(row => row.metadata.name === 'manifest').spec.template.spec.affinity.nodeAffinity;
  assert.deepEqual(affinity.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms[0].matchExpressions, [{key: 'kubernetes.io/hostname', operator: 'In', values: [cluster + '-worker', cluster + '-worker2']}]);
  assert.deepEqual(affinity.preferredDuringSchedulingIgnoredDuringExecution[0], {weight: 100, preference: {matchExpressions: [{key: 'kubernetes.io/hostname', operator: 'In', values: [cluster + '-worker2']}]}});
  assert.deepEqual(rows.filter(row => row.name === 'docker' && row.args[0] === 'exec').map(row => row.args[1]), [cluster + '-control-plane', cluster + '-worker', cluster + '-worker2']);
});

test('an unsupported Kubernetes target reaches no external commands', async t => {
  const fixture = await commandFixture(t, 'guards');
  const run = spawnSync(process.execPath, ['--input-type=module', '-e',
    "import {runKubernetesCheck} from './scripts/kubernetes-check.mjs'; await runKubernetesCheck('production');"], {env: fixture.env, encoding: 'utf8', timeout: 10000});
  assert.equal(run.status, 1); assert.match(run.stderr, /kubernetes.target/);
  assert.equal(await readFile(fixture.log, 'utf8').catch(() => ''), '');
});

test('worker loss confirms the owned node stopped before fencing and requiring replacement', async () => {
  const api = await import('./kubernetes-check.mjs'); assert.equal(typeof api.loseKubernetesWorker, 'function');
  for (const running of [true, false]) {
    const calls = [], cluster = 'd620-unit';
    const run = async (binary, args) => {calls.push([binary, ...args]); return args[0] === 'inspect' ? String(running) : '';};
    const kube = async args => {calls.push(['kubectl', ...args]);};
    const lost = api.loseKubernetesWorker({cluster, run, kube, manifest: 'manifest-old'});
    if (running) {await assert.rejects(lost, /kubernetes.worker_still_running/); assert.equal(calls.length, 2);}
    else {
      assert.deepEqual(await lost, {stopped: cluster + '-worker2', replacement: cluster + '-worker'});
      assert.deepEqual(calls, [
        ['docker', 'kill', cluster + '-worker2'], ['docker', 'inspect', '--format', '{{.State.Running}}', cluster + '-worker2'],
        ['kubectl', 'taint', 'node', cluster + '-worker2', 'node.kubernetes.io/out-of-service=nodeshutdown:NoExecute'],
        ['kubectl', 'wait', '--for=delete', 'pod/manifest-old', '--timeout=180s'],
        ['kubectl', 'rollout', 'status', 'deployment/manifest', '--timeout=180s'],
      ]);
    }
  }
});

test('local manifest keeps one instance per role and enables only the declared test adapters', async () => {
  const value = JSON.parse(await readFile(new URL('../deploy/kubernetes/local-checks.yaml', import.meta.url), 'utf8'));
  const roles = [];
  for (const item of value.items.filter(item => ['Pod', 'Deployment'].includes(item.kind))) {
    if (item.kind === 'Deployment') assert.equal(item.spec.replicas, 1);
    const spec = item.kind === 'Pod' ? item.spec : item.spec.template.spec;
    for (const container of [...(spec.initContainers ?? []), ...spec.containers]) {
      roles.push(container.name);
      const flag = container.env?.find(entry => entry.name === 'CLOUD_TEST_SERVICE_PLANS')?.value;
      if (flag !== undefined) assert.equal(flag, ['account', 'storage', 'manifest', 'verifier'].includes(container.name) ? '1' : '0', container.name);
    }
  }
  assert.deepEqual(roles.sort(), ['bootstrap', 'postgres', 'migrate', 'account', 'storage', 'email', 'mailpit', 'monitor', 'usage', 'probe', 'proxy', 'manifest', 'gateway', 'docker', 'verifier'].sort());
});

test('nested verifier adapter binds the captured point and pinned image to its own Pod', async () => {
  let api;
  await assert.doesNotReject(async () => {api = await import('./kubernetes-check.mjs');}, 'import must not launch a cluster');
  assert.equal(typeof api.createKubernetesVerifier, 'function');
  const value = JSON.parse(await readFile(new URL('../deploy/kubernetes/local-checks.yaml', import.meta.url), 'utf8'));
  const template = value.items.find(item => item.metadata.name === 'verifier'); assert.ok(template);
  const daemon = template.spec.containers.find(row => row.name === 'docker');
  assert.equal(template.spec.volumes.find(row => row.name === 'tmp').emptyDir.sizeLimit, '96Mi');
  for (const container of template.spec.containers) {
    const socket = container.volumeMounts.find(row => row.name === 'socket').mountPath;
    const canonical = socket === '/var/run' ? '/run' : socket;
    assert.equal(['/run/local-stack', '/run/backup-verifier'].some(path => path.startsWith(canonical + '/')), false, 'socket mount must not hide private runtime or controller state');
    const endpoint = 'unix://' + socket + '/docker.sock';
    assert.equal(container.env.find(row => row.name === 'DOCKER_HOST')?.value, endpoint);
    assert.deepEqual(daemon.args, ['--host=' + endpoint]);
  }
  const point = '12345678-1234-4234-8234-123456789abc', image = 'sha256:' + 'b'.repeat(64), revision = 'c'.repeat(40);
  const statuses = [{name: 'docker', state: {running: {}}}, {name: 'verifier', state: {running: {}}}];
  const identity = {version: 1, owner: 'waitron-cloud-test-backup', image, scope: point};
  let applied, loaded, importing, finishLoad; const calls = [];
  const entered = new Promise(resolve => {importing = resolve;}), transfer = new Promise(resolve => {finishLoad = resolve;});
  const adapter = api.createKubernetesVerifier({template,
    pod: async role => {assert.ok(['cloud', 'verifier'].includes(role)); return {status: {podIP: '10.244.0.5', containerStatuses: statuses}};},
    loadImage: async id => {loaded = id; assert.ok(applied); importing(); await transfer;},
    kube: async (args, input) => {
      calls.push(args);
      if (args[0] === 'apply') applied = JSON.parse(input);
      if (args[0] === 'exec') {
        assert.equal(args[2], 'pod/verifier');
        if (args[4] === 'docker') return 'nested-daemon-output';
        if (args.includes('cat')) return JSON.stringify(identity);
        if (args.includes('process.kill(1,"SIGTERM")')) statuses[1].state = {terminated: {exitCode: 0}};
      }
      return '';
    }});
  await assert.rejects(adapter.start('not-a-point', {image, revision}), /kubernetes.verifier_binding/); assert.deepEqual(calls, []);
  const starting = adapter.start(point, {image, revision}); await entered;
  assert.equal(calls.some(args => args.some(value => value.includes('image-loaded'))), false, 'worker stays gated while image import is unfinished');
  finishLoad(); assert.equal(await starting, 'kube-verifier');
  assert.deepEqual(calls.find(args => args[0] === 'delete'), ['delete', 'pod/verifier', '--ignore-not-found', '--wait=true', '--timeout=30s']);
  assert.ok(calls.findIndex(args => args[0] === 'delete') < calls.findIndex(args => args[0] === 'apply'), 'a finished Pod must be removed before new immutable environment is applied');
  const previousLog = calls.findIndex(args => args[0] === 'logs');
  assert.ok(previousLog >= 0 && previousLog < calls.findIndex(args => args[0] === 'delete'), 'retain the previous worker output before deleting it');
  assert.ok(calls.some(args => args.includes('require("node:fs").writeFileSync("/run/backup-verifier/image-loaded","")')), 'successful import must release the worker');
  const worker = applied.spec.containers.find(row => row.name === 'verifier');
  const environment = Object.fromEntries(worker.env.map(row => [row.name, row.value]));
  assert.equal(environment.CLOUD_INTEGRATION_POINT_ID, point); assert.equal(environment.CLOUD_VERIFIER_IMAGE, image);
  assert.equal(environment.CLOUD_INTEGRATION_WAITRON_REVISION, revision); assert.equal(environment.CLOUD_TEST_SERVICE_PLANS, '1');
  assert.equal(loaded, image); assert.equal(applied.spec.restartPolicy, 'Never');
  assert.deepEqual(applied.spec.hostAliases, [{ip: '10.244.0.5', hostnames: ['waitron.local']}]);
  assert.deepEqual(await adapter.identity(), identity); assert.equal(await adapter.running(), true);
  assert.equal(await adapter.docker(['ps', '-aq']), 'nested-daemon-output');
  await adapter.stop(); assert.equal(await adapter.running(), false); assert.equal(await adapter.exitCode(), '0');
  calls.length = 0;
  const nextPoint = '87654321-4321-4321-8321-cba987654321';
  await adapter.start(nextPoint, {image, revision});
  assert.equal(calls.filter(args => args[0] === 'delete').length, 1);
  assert.equal(applied.spec.containers.find(row => row.name === 'verifier').env.find(row => row.name === 'CLOUD_INTEGRATION_POINT_ID').value, nextPoint);
  assert.notEqual(template.spec.containers.find(row => row.name === 'verifier').env.find(row => row.name === 'CLOUD_INTEGRATION_POINT_ID').value, point);
});

test('Kubernetes verification needs the complete nested adapter before any Docker call', async t => {
  const fixture = await commandFixture(t, 'guards'), before = process.env.PATH;
  process.env.PATH = fixture.env.PATH; t.after(() => {process.env.PATH = before;});
  const methods = ['start', 'identity', 'docker', 'running', 'stop', 'exitCode'];
  const verifier = Object.fromEntries(methods.map(name => [name, () => assert.fail('must inspect the pinned image first')]));
  const target = {cluster: 'd620-abc', namespace: 'default', account: 'kube-account', ca: 'not-consumed', network: 'kind',
    proxyIp: '172.18.0.2', port: 3000, mailPort: 8025, exec: () => assert.fail(), remote: {worker: () => assert.fail()}, verifier};
  const options = {image: 'sha256:' + 'a'.repeat(64), waitronImage: 'sha256:' + 'b'.repeat(64), paidVerification: true};
  for (const method of methods) await assert.rejects(runTestCloudClients({...options,
    kubernetes: {...target, verifier: {...verifier, [method]: undefined}}}), /integration.kubernetes_binding/, method);
  assert.equal(await readFile(fixture.log, 'utf8').catch(() => ''), '');
  await assert.rejects(runTestCloudClients({...options, kubernetes: target}), /integration.invalid_json/);
  assert.ok((await readFile(fixture.log, 'utf8')).includes('inspect'));
});

test('first verifier start has no previous diagnostics to lose', async t => {
  const {createKubernetesVerifier} = await import('./kubernetes-check.mjs');
  const manifest = JSON.parse(await readFile(new URL('../deploy/kubernetes/local-checks.yaml', import.meta.url), 'utf8'));
  const diagnostics = [];
  t.mock.method(process.stderr, 'write', value => {diagnostics.push(String(value)); return true;});
  const adapter = createKubernetesVerifier({template: manifest.items.find(row => row.metadata.name === 'verifier'),
    pod: async role => role === 'cloud' ? {status: {podIP: '10.244.0.5'}} : undefined,
    kube: async () => '', loadImage: async () => {}});
  await adapter.start('12345678-1234-4234-8234-123456789abc', {image: 'sha256:' + 'b'.repeat(64), revision: 'c'.repeat(40)});
  assert.deepEqual(diagnostics, []);
});

test('malformed private verifier identity has a fixed error without its contents', async () => {
  const {createKubernetesVerifier} = await import('./kubernetes-check.mjs');
  const adapter = createKubernetesVerifier({kube: async () => 'PRIVATE_VERIFIER_IDENTITY_CANARY'});
  await assert.rejects(adapter.identity(), error => {
    assert.equal(error.message, 'integration.invalid_json'); assert.equal(String(error.stack).includes('PRIVATE_VERIFIER_IDENTITY_CANARY'), false); return true;
  });
});

for (const mode of ['load-fails', 'load-exit']) test('failed verifier image transfer drains its own exporter without printing private output: ' + mode, {timeout: 10000}, async t => {
  const {loadVerifierImage} = await import('./kubernetes-check.mjs'); assert.equal(typeof loadVerifierImage, 'function');
  const fixture = await commandFixture(t, mode);
  await assert.rejects(loadVerifierImage('sha256:' + 'b'.repeat(64),
    ['--context', 'kind-d620-unit', '--namespace', 'default', 'exec', '-i', 'pod/verifier', '-c', 'docker', '--', 'docker', 'load'], fixture.env), error => {
      assert.equal(error.message, 'kubernetes.verifier_image_load'); assert.equal(String(error.stack).includes('PRIVATE_IMAGE_LOAD_CANARY'), false); return true;
    });
  const rows = (await readFile(fixture.log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const exporter = rows.find(row => row.exporter).exporter;
  assert.throws(() => process.kill(exporter, 0), {code: 'ESRCH'});
});

// The worker must identify a failure without echoing its private input or assertion text.
for (const [code, expected] of [
  [undefined, {stage: 'point', exceptionClass: 'AssertionError', code: 'ERR_ASSERTION'}],
  ['EAI_AGAIN', {stage: 'runtime', exceptionClass: 'Error', code: 'EAI_AGAIN'}],
  ['28P01', {stage: 'runtime', exceptionClass: 'Error', code: '28P01'}],
]) test('verifier startup reports its stage and error class without private values: ' + code, () => {
  const stub = 'data:text/javascript,' + encodeURIComponent(`export function loadRuntime(){throw Object.assign(Error('PRIVATE_POINT_CANARY'),{code:${JSON.stringify(code)}});}`);
  const loader = 'data:text/javascript,' + encodeURIComponent(`import {registerHooks} from 'node:module';registerHooks({resolve(s,c,next){return s==='../../local-stack/runtime.mjs'&&c.parentURL?.endsWith('/test-fixtures/integration-verifier.mjs')?{url:${JSON.stringify(stub)},shortCircuit:true}:next(s,c);}});`);
  const run = spawnSync(process.execPath, [...(code ? ['--import', loader] : []), 'deploy/test-cloud/test-fixtures/integration-verifier.mjs'], {
    encoding: 'utf8', env: {...process.env, CLOUD_INTEGRATION_POINT_ID: code ? '12345678-1234-4234-8234-123456789abc' : 'PRIVATE_POINT_CANARY'}, timeout: 10000});
  assert.equal(run.status, 1); assert.equal(run.stdout, '');
  const row = run.stderr.split('\n').filter(line => line.startsWith('integration.verifier_diagnostic ')).at(-1); assert.ok(row, run.stderr);
  assert.deepEqual(JSON.parse(row.slice('integration.verifier_diagnostic '.length)), expected);
  assert.equal(run.stderr.includes('PRIVATE_POINT_CANARY'), false);
});

// The shell must acknowledge waiting before the parent releases it, then execute the worker.
test('manifest worker stays behind the actual image-transfer gate', {timeout: 5000}, async t => {
  const fixture = await commandFixture(t, 'guards'), ready = join(fixture.directory, 'image-loaded');
  const manifest = JSON.parse(await readFile(new URL('../deploy/kubernetes/local-checks.yaml', import.meta.url), 'utf8'));
  const worker = manifest.items.find(row => row.metadata.name === 'verifier').spec.containers.find(row => row.name === 'verifier');
  await writeFile(join(fixture.directory, 'sleep'), '#!/bin/sh\nprintf "waiting\\n"\n/bin/sleep 0.05\n', {mode: 0o700});
  await writeFile(join(fixture.directory, 'node'), '#!/bin/sh\n[ "$1" = deploy/test-cloud/test-fixtures/integration-verifier.mjs ] || exit 19\nprintf "started\\n"\n', {mode: 0o700});
  const child = spawn(worker.command[0], [worker.command[1], worker.command[2].replace('/run/backup-verifier/image-loaded', '"$VERIFIER_READY"')], {
    env: {...fixture.env, VERIFIER_READY: ready}, stdio: ['ignore', 'pipe', 'pipe']});
  const closed = new Promise(resolve => child.once('close', resolve)), timer = setTimeout(() => child.kill('SIGKILL'), 3000);
  t.after(() => {clearTimeout(timer); child.kill('SIGKILL');}); child.stderr.resume();
  let output = ''; child.stdout.on('data', part => {output += part;});
  const first = await Promise.race([new Promise(resolve => child.stdout.once('data', part => resolve(String(part)))), closed.then(() => '')]);
  assert.equal(first.split('\n')[0], 'waiting'); assert.equal(output.includes('started'), false);
  await writeFile(ready, ''); assert.equal(await closed, 0); assert.ok(output.endsWith('started\n'));
});
