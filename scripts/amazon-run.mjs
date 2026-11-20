import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {fluxImages,prepareFluxBundle} from './kubernetes-git.mjs';
import {installStockholmStore, storeBuildArgs} from './kubernetes-storage.mjs';
import {meshNodeAddress, outsideNodePeer, outsidePublication, startOutsideMesh} from './kubernetes-outside.mjs';
import {cleanUp} from './kubernetes-database.mjs';
import {servicesNamespace, verifierScratchPath} from '../deploy/kubernetes/services.mjs';
import {readRehearsalVerificationTarget} from '../deploy/test-cloud/test-fixtures/integration-verification-target.mjs';
import {spreadCoreDns} from './kubernetes-placement.mjs';
import {selectSurvivingNode} from './kubernetes-remote.mjs';

export async function runAmazonExperiment(operations, {sleep = delay, waitExpiry} = {}) {
  try {
    await operations.create();
    await operations.prepare();
    if (operations.baseline) {
      const baseline = await operations.baseline();
      await waitExpiry();
      await operations.waitDeleted();
      return {baseline, removed: true};
    }
    let journeys, observation;
    if (operations.observe) observation = await operations.observe();
    else {
    const before = await operations.journey('before');
    await operations.stopWorker();
    await operations.waitStopped();
    await operations.replace();
    await sleep(900000);
    const after = await operations.journey('after');
    journeys = [before, after];
    }
    await operations.checkStopped();
    await waitExpiry();
    await operations.waitDeleted();
    return {...(journeys ? {journeys} : {observation}), removed: true};
  } catch (error) {
    try {await operations.deleteStack(); await operations.waitDeleted();}
    catch (cleanup) {throw new AggregateError([error, cleanup], error.message + '; Amazon teardown failed');}
    throw error;
  }
}

import {execFile, spawn} from 'node:child_process';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
async function command(binary, args, input, signal, timeout = 180000) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = execFile(binary, args, {signal, timeout, maxBuffer: 32 * 1024 * 1024}, (error, stdout, stderr) => {
      if ((error || binary !== 'aws') && stderr) process.stderr.write(stderr);
      if (error) reject(Object.assign(Error('amazon.command_failed:' + binary + ':' + error.name + ':' + (error.killed ? 'ETIMEDOUT' : error.code)), {code: error.killed ? 'ETIMEDOUT' : error.code}));
      else resolve(stdout.trim());
    });
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}

async function main() {
  const [mode, stack] = process.argv.slice(2);
  assert.ok(['start', 'stop', 'observe', 'baseline'].includes(mode), 'Use start or stop or observe or baseline');
  assert.ok(process.env.D618_CONFIG, 'Set D618_CONFIG to your private run configuration JSON file.');
  const config = JSON.parse(await readFile(process.env.D618_CONFIG, 'utf8'));
  assert.match(config.region ?? '', /^[a-z]{2}-[a-z]+-\d$/, 'Set an explicit AWS region');
  const aws = (service, args, cleanup = false) => command('aws', ['--region', config.region, '--no-cli-pager', service, ...args, '--output', 'json'], undefined, cleanup ? undefined : stop.signal, 300000);
  const stop = new AbortController(), shutdown = () => stop.abort();
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  try {
    if (mode === 'stop') {
      assert.match(stack ?? '', /^d618-[a-f0-9-]{36}$/);
      const rows = JSON.parse(await aws('cloudformation', ['describe-stacks', '--stack-name', stack])).Stacks;
      assert.ok(rows.length === 1 && rows[0].Tags.some(row => row.Key === 'cloud.campaign' && row.Value === 'D618'), 'Not a D618 stack');
      await aws('cloudformation', ['delete-stack', '--stack-name', stack], true);
      await aws('cloudformation', ['wait', 'stack-delete-complete', '--stack-name', stack], true);
      return;
    }
    process.stdout.write(JSON.stringify(await startAmazon({...config, observer: mode === 'observe', baseline: mode === 'baseline'}, {
      signal: stop.signal, run: (binary, args, input, cleanup, timeout, request) => command(binary, args, input,
        cleanup ? undefined : AbortSignal.any([stop.signal, request].filter(Boolean)), timeout), aws,
      sleep: ms => delay(ms, undefined, {signal: stop.signal})})) + '\n');
  } finally {process.removeListener('SIGINT', shutdown); process.removeListener('SIGTERM', shutdown);}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {await main();} catch (error) {process.stderr.write(error.message + '\n'); process.exitCode = 1;}
}

export async function checkAmazonArchive(archive, images, run) {
  const members = new Set((await run('tar', ['-tf', archive])).split('\n'));
  const present = path => {assert.ok(members.has(path), 'amazon.archive_blob:' + path); return path;};
  const read = async path => JSON.parse(await run('tar', ['-xOf', archive, present(path)]));
  const blob = descriptor => 'blobs/' + descriptor.digest.replace(':', '/');
  const index = await read('index.json');
  for (const image of images) {
    const canonical = 'docker.io/' + (image.includes('/') ? image : 'library/' + image);
    let descriptor = index.manifests.find(row => [image, canonical].includes(row.annotations?.['io.containerd.image.name']));
    assert.ok(descriptor, 'amazon.archive_image');
    let manifest = await read(blob(descriptor));
    while (true) {
      if (descriptor.platform !== undefined) assert.ok(descriptor.platform?.os === 'linux' && descriptor.platform.architecture === 'amd64', 'amazon.archive_platform');
      if (!manifest.manifests) break;
      // Other platforms and attestations need not be bundled for the selected runtime.
      descriptor = manifest.manifests.find(row => row.platform?.os === 'linux' && row.platform.architecture === 'amd64');
      assert.ok(descriptor, 'amazon.archive_platform');
      manifest = await read(blob(descriptor));
    }
    const config = await read(blob(manifest.config));
    assert.ok(config?.os === 'linux' && config.architecture === 'amd64', 'amazon.archive_platform');
    for (const part of [manifest.config, ...manifest.layers]) present(blob(part));
  }
}

async function runOutsideServices(context) {
  const {runKubernetesServices} = await import('./kubernetes-services.mjs');
  return runKubernetesServices(context);
}

export async function startAmazon(config, {run, aws, sleep = delay, now = Date.now, signal,
  observe = observerCommand, prepareFlux = prepareFluxBundle, runBaseline = runOutsideServices}) {
  assert.ok(!(config.baseline && config.observer), 'amazon.mode');
  assert.match(config.region ?? '', /^[a-z]{2}-[a-z]+-\d$/, 'Set an explicit AWS region');
  const identity = JSON.parse(await aws('sts', ['get-caller-identity']));
  assert.ok(identity.Account === config.account && !identity.Arn.endsWith(':root'), 'amazon.identity');
  assert.match(config.image, /^ami-[a-f0-9]{17}$/);
  assert.match(config.operatorCidr, /^(?:\d{1,3}\.){3}\d{1,3}\/32$/);
  const quota = JSON.parse(await aws('service-quotas', ['get-service-quota', '--service-code', 'ec2', '--quota-code', 'L-1216C47A'])).Quota.Value;
  assert.ok(quota >= 12, `D618 needs a Running On-Demand Standard instances quota of at least 12 vCPUs; current quota is ${quota}. Request an increase in ${config.region} before retrying.`);
  assert.equal(await run('uname', ['-m']), 'x86_64', 'Use the x86 test-box builder');
  assert.equal(await run('git', ['status', '--porcelain']), '', 'Use a clean, committed Cloud checkout');
  const name = 'd618-' + randomUUID();
  const directory = await mkdtemp(join(tmpdir(), 'd618-')), ownedImages = [];
  const cloud = name + ':cloud', waitron = name + ':waitron', store = name + ':store';
  let hosts, mesh, networkId, failure;
  const closeHost = async () => {
    let failure;
    try {
      if (mesh) {await mesh.close(); mesh = undefined;}
    } catch (error) {failure = error; throw error;}
    finally {
      await cleanUp(failure, async () => {
        if (networkId) {await run('docker', ['network', 'rm', networkId], undefined, true); networkId = undefined;}
      });
    }
  };
  const sshOptions = ['-i', config.sshKey, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'UserKnownHostsFile=' + join(directory, 'known_hosts'),
    '-o', 'ControlMaster=auto', '-o', 'ControlPath=' + join(directory, '%C'), '-o', 'ControlPersist=yes', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4'];
  try {
    ownedImages.push(cloud);
    await run('docker', ['buildx', 'build', '--builder', 'default', '--platform', 'linux/amd64', '--load',
      '--secret', 'id=npm_token,env=NODE_AUTH_TOKEN', '--build-arg', 'SEAWEED_AMD64_SHA256=31fb804858885f9e7f18b6d3b1da09e824baac3e6a55b5a62c3c4c77e6ed6d7d',
      '-f', 'deploy/local-stack/Dockerfile', '-t', cloud, '.'], undefined, false, 900000);
    ownedImages.push(waitron);
    await run('env', ['BUILDX_BUILDER=default', 'WAITRON_CHECKOUT=' + config.waitronCheckout, 'CLOUD_VERIFIER_IMAGE=' + waitron,
      process.execPath, 'scripts/build-backup-verifier.mjs', ...(config.baseline ? ['--amazon-test'] : [])], undefined, false, 900000);
    ownedImages.push(store);
    await run('docker', storeBuildArgs(store, ['--platform', 'linux/amd64']), undefined, false, 900000);
    let fluxBundle;
    if (config.observer || config.baseline) {
      await run('docker',['run','--rm','--entrypoint','sh',waitron,'-ec','git --version && test -x "$(git --exec-path)/git-http-backend"']);
      fluxBundle=await prepareFlux(directory,name,{run});
    }
    const manifest = JSON.parse(await readFile(new URL('../deploy/kubernetes/local-checks.yaml', import.meta.url), 'utf8'));
    const images = [...new Set(JSON.stringify(manifest).match(/"image":"([^"]+)"/g)?.map(row => JSON.parse('{' + row + '}').image) ?? [])].filter(image => image !== 'CLOUD_IMAGE');
    for (const image of images) {
      try {await run('docker', ['image', 'inspect', image]);} catch {ownedImages.push(image);}
      await run('docker', ['pull', '--platform', 'linux/amd64', image]);
    }
    if(config.observer || config.baseline)for(const {upstream,tag} of fluxImages(name)) {
      try {await run('docker',['image','inspect',upstream]);}catch{ownedImages.push(upstream);}
      await run('docker',['pull','--platform','linux/amd64',upstream]);
      ownedImages.push(tag);await run('docker',['tag',upstream,tag]);images.push(tag);
    }
    const bundleImages = [cloud, waitron, store, ...images];
    for (const image of bundleImages) {
      const [row] = JSON.parse(await run('docker', ['image', 'inspect', image]));
      assert.ok(row.Architecture === 'amd64' && row.Os === 'linux', 'amazon.image_architecture');
    }
    await run('docker', ['save', '--platform', 'linux/amd64', '-o', join(directory, 'images.tar'), ...bundleImages], undefined, false, 300000);
    await checkAmazonArchive(join(directory, 'images.tar'), bundleImages, run);
    const archive = JSON.parse(await run('tar', ['-xOf', join(directory, 'images.tar'), 'manifest.json'])), ids = {};
    for (const image of bundleImages) {
      const canonical = 'docker.io/' + (image.includes('/') ? image : 'library/' + image);
      const config = archive.find(row => row.RepoTags?.some(tag => tag === image || tag === canonical))?.Config;
      const digest = config?.split('/').at(-1).replace(/\.json$/, '');
      assert.match(digest ?? '', /^[a-f0-9]{64}$/, 'amazon.archive_image');
      ids[image] = 'sha256:' + digest;
    }
    const bytes = parseInt(await run('wc', ['-c', join(directory, 'images.tar')]), 10);
    const archiveCopyTimeout = Math.ceil(bytes * 8 / 10000000 * 1000) + 60000;
    process.stderr.write('Image bundle ' + bytes + ' bytes; one upload and private copies each have ' + archiveCopyTimeout + ' ms (10 Mbit/s cutoff plus 60 seconds)\n');
    await run('git', ['archive', '--format=tar', '-o', join(directory, 'source.tar'), 'HEAD']);
    const expiry = now() + 90 * 60000;
    const parameters = {Image: config.image, Key: config.key, OperatorCidr: config.operatorCidr,
      StackRole: config.stackRole, SchedulerRole: config.schedulerRole, ExpiryTime: new Date(expiry).toISOString().slice(0, 19)};
    let outputs, target;
    const ssh = (index, args, input, timeout = 600000, request, hideStderr = false) => run('ssh',
      [...sshOptions, 'admin@' + hosts[index], args.map(quote).join(' ') + (hideStderr ? ' 2>/dev/null' : '')],
      input, request === null, timeout, request);
    const copy = (index, file, path, timeout = 300000) => run('scp', [...sshOptions, join(directory, file), 'admin@' + hosts[index] + ':' + path], undefined, false, timeout);
    const bootstrap = (index, phase, args = [], input) => ssh(index, ['sudo', 'bash', '/opt/d618/deploy/kubernetes/bounded-amazon/bootstrap.sh', phase, ...args], input);
    const kubeArgs = ['kubectl', '--kubeconfig=/etc/kubernetes/admin.conf', '--context', name];
    const kubeOn = (index, args, {input, timeout, signal: request} = {}) => {
      // kubectl validation errors can quote the submitted Secret.
      const privateManifest = args.includes('-f') && /"kind"\s*:\s*"Secret"/.test(input ?? '');
      return ssh(index, ['sudo', ...kubeArgs, ...args], input, timeout, request, privateManifest);
    };
    const kube = (args, options) => kubeOn(0, args, options);
    const local = (binary, args, {input, signal: request = signal, timeout} = {}) =>
      run(binary, args, input, request === null, timeout, request);
    const waitDeleted = async () => {
      try {await aws('cloudformation', ['wait', 'stack-delete-complete', '--stack-name', name], true);}
      catch (error) {if (error.code === 'ETIMEDOUT') throw Error('amazon.deletion_late'); throw error;}
    };
    const operations = {
      create: async () => {
        process.stderr.write('Creating owned Amazon stack ' + name + '; expiry ' + new Date(expiry).toISOString() + '\n');
        await aws('cloudformation', ['create-stack', '--stack-name', name, '--role-arn', config.stackRole,
          '--template-body', 'file://deploy/kubernetes/bounded-amazon/stack.yaml', '--tags', 'Key=cloud.campaign,Value=D618',
          '--parameters', JSON.stringify(Object.entries(parameters).map(([ParameterKey, ParameterValue]) => ({ParameterKey, ParameterValue})))]);
        await aws('cloudformation', ['wait', 'stack-create-complete', '--stack-name', name]);
        const response = JSON.parse(await aws('cloudformation', ['describe-stacks', '--stack-name', name]));
        outputs = Object.fromEntries(response.Stacks[0].Outputs.map(row => [row.OutputKey, row.OutputValue]));
        hosts = ['A', 'B', 'C'].map(role => outputs['Address' + role]);
        assert.ok(hosts.every(ip => /^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)), 'amazon.host_binding');
        target = {type: 'amazon', cluster: name, context: name, address: '10.77.0.1', phase: 'before',
          instances: ['A', 'B', 'C'].map(role => outputs[role]), nodes: ['-control-plane', '-worker', '-worker2'].map(suffix => name + suffix)};
      },
      prepare: async () => {
        const privateKeys = [], publicKeys = [];
        for (let index = 0; index < 3; index++) {
          privateKeys.push(await run('wg', ['genkey']));
          publicKeys.push(await run('wg', ['pubkey'], privateKeys[index] + '\n'));
          let ready = false;
          for (let attempt = 0; attempt < 30; attempt++) {try {await ssh(index, ['true']); ready = true; break;} catch {await sleep(5000);}}
          assert.ok(ready, 'amazon.ssh_ready');
          const instance = await ssh(index, ['sh', '-ec', 'token=$(curl -fsS -X PUT -H "X-aws-ec2-metadata-token-ttl-seconds: 60" http://169.254.169.254/latest/api/token); curl -fsS -H "X-aws-ec2-metadata-token: $token" http://169.254.169.254/latest/meta-data/instance-id']);
          assert.equal(instance, target.instances[index], 'amazon.instance_binding');
          await copy(index, 'source.tar', '/tmp/d618-source.tar');
          await ssh(index, ['sudo', 'mkdir', '-p', '/opt/d618']);
          await ssh(index, ['sudo', 'tar', '-xf', '/tmp/d618-source.tar', '-C', '/opt/d618']);
          if(index===0&&config.observer)await copy(0,'flux.json','/tmp/d618-flux.json');
          await bootstrap(index, 'prepare', [target.nodes[index], '10.77.0.' + (index + 1)]);
        }
        const prepareNodes = async outsideKey => {
          for (let index = 0; index < 3; index++) {
            const peers = [0, 1, 2].filter(peer => peer !== index).map(peer => '\n[Peer]\nPublicKey=' + publicKeys[peer] +
              '\nAllowedIPs=' + meshNodeAddress(peer) + '/32\nEndpoint=' + outputs['Private' + ['A', 'B', 'C'][peer]] + ':51821\nPersistentKeepalive=15\n').join('');
            const address = meshNodeAddress(index);
            await bootstrap(index, 'mesh', [address], '[Interface]\nAddress=' + address + '/24\nListenPort=51821\nPrivateKey=' +
              privateKeys[index] + '\n' + peers + (outsideKey ? outsideNodePeer(outsideKey) : ''));
          }
        };
        if (config.baseline) {
          mesh = await startOutsideMesh({directory, peers: hosts.map((endpoint, index) => ({endpoint, publicKey: publicKeys[index]})),
            prepareNodes, run, restrictInbound: true});
        } else await prepareNodes();
        for (let index = 0; index < 3; index++) await bootstrap(index, 'storage', [index === 0 ? 'control' : 'worker']);
        process.stderr.write('Uploading image bundle once to machine 0\n');
        await copy(0, 'images.tar', '/tmp/d618-images.tar', archiveCopyTimeout);
        await ssh(0, ['sudo', 'cp', '/tmp/d618-images.tar', '/var/local/d620-config/d618-images.tar'], undefined, archiveCopyTimeout);
        for (const index of [1, 2]) {
          process.stderr.write('Copying image bundle to machine ' + index + ' over the private share\n');
          await ssh(index, ['sudo', 'cp', '/var/local/d620-config/d618-images.tar', '/tmp/d618-images.tar'], undefined, archiveCopyTimeout);
        }
        // Pods mount this directory, so only their intended configuration may remain.
        await ssh(0, ['sudo', 'rm', '/var/local/d620-config/d618-images.tar']);
        for (let index = 0; index < 3; index++) {
          await ssh(index, ['sudo', 'ctr', '-n', 'k8s.io', 'images', 'import', '/tmp/d618-images.tar']);
          for (const [image, id] of Object.entries(ids)) {
            const info = JSON.parse(await ssh(index, ['sudo', 'crictl', '--image-endpoint', 'unix:///run/containerd/containerd.sock', 'inspecti', '-o', 'json', image]));
            assert.equal(info.status.id, id, 'amazon.import_digest');
          }
        }
        for (const index of config.baseline ? [0, 1, 2] : [0]) {
          await ssh(index, ['sudo', 'docker', 'load', '-i', '/tmp/d618-images.tar']);
        }
        if (!config.baseline) await ssh(0, ['sudo', 'docker', 'network', 'create', '--subnet', '10.79.0.0/24', name]);
        const certificateKey = await bootstrap(0, 'control', [name]);
        const joinCommand = await ssh(0, ['sudo', 'kubeadm', 'token', 'create', '--ttl', '20m', '--print-join-command']);
        for (const index of [1, 2]) await bootstrap(index, 'join', [name], joinCommand + '\n' + certificateKey + '\n');
        await kube(['wait', '--for=condition=Ready', 'nodes', '--all', '--timeout=180s']);
        // Recreate pods so their hosts files use the API on their own machines.
        await kube(['-n', 'kube-system', 'rollout', 'restart', 'daemonset/kube-proxy']);
        await kube(['-n', 'kube-system', 'rollout', 'status', 'daemonset/kube-proxy', '--timeout=180s']);
        for (let index = 0; index < 3; index++) {
          const found = await ssh(index, ['sh', '-c', 'test -x /opt/cni/bin/flannel && echo present || echo missing']);
          assert.equal(found, 'present', 'amazon.flannel_plugin: machine ' + index + ' has no flannel network plugin in /opt/cni/bin, where containerd looks');
        }
        await spreadCoreDns(kube, target.nodes);
        for (let index = 0; index < 3; index++) await bootstrap(index, 'database-storage');
        // Leave the remote installer time for both rollouts and their failure diagnostics.
        await ssh(0, ['sudo', 'node', '/opt/d618/scripts/kubernetes-data.mjs',
          '--kubeconfig=/etc/kubernetes/admin.conf', '--context=' + name, ...target.nodes], undefined, 750_000);
        for (let index = 0; index < 3; index++) await bootstrap(index, 'object-storage');
        if (!config.baseline) await ssh(0, ['sudo', 'node', '/opt/d618/scripts/kubernetes-storage.mjs',
          '--kubeconfig=/etc/kubernetes/admin.conf', '--context=' + name, store,
          ...target.nodes, '10.77.0.1', '10.77.0.2', '10.77.0.3'], undefined, 360_000);
      },
      journey: async phase => {
        target.phase = phase;
        await writeFile(join(directory, 'target.json'), JSON.stringify(target), {mode: 0o600});
        await copy(0, 'target.json', '/tmp/d618-target.json');
        return JSON.parse(await ssh(0, ['sudo', 'sh', '-ec', 'cd /opt/d618 && TEST_CLOUD_INTEGRATION_IMAGE=' + quote(ids[cloud]) + ' TEST_CLOUD_INTEGRATION_WAITRON_IMAGE=' + quote(ids[waitron]) + ' node scripts/kubernetes-check.mjs --amazon /tmp/d618-target.json'], undefined, 1200000));
      },
      stopWorker: () => aws('ec2', ['stop-instances', '--skip-os-shutdown', '--instance-ids', outputs.C]),
      waitStopped: () => aws('ec2', ['wait', 'instance-stopped', '--instance-ids', outputs.C]),
      replace: async () => {
        const old = await kube(['get', 'pods', '-l', 'app=manifest', '-o', 'jsonpath={.items[0].metadata.name}']);
        await kube(['taint', 'node', target.nodes[2], 'node.kubernetes.io/out-of-service=nodeshutdown:NoExecute']);
        await kube(['wait', '--for=delete', 'pod/' + old, '--timeout=180s']);
        await kube(['rollout', 'status', 'deployment/manifest', '--timeout=180s']);
      },
      checkStopped: async () => {
        const response = JSON.parse(await aws('ec2', ['describe-instances', '--instance-ids', outputs.C]));
        assert.equal(response.Reservations[0].Instances[0].State.Name, 'stopped', 'amazon.worker_restarted');
      },
      waitDeleted,
      deleteStack: () => aws('cloudformation', ['delete-stack', '--stack-name', name], true),
    };
    if (config.baseline) operations.baseline = async () => {
      let baselineFailure;
      try {
        const nodes = target.nodes.map((node, index) => ({name: node, ip: meshNodeAddress(index)}));
        const limit = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, expiry - now()))].filter(Boolean));
        for (const index of [0, 1, 2]) await ssh(index, ['sudo', 'sh', '-ec', `
          scratch=$(mktemp -d /var/local/d621-verifier.XXXXXX)
          fallocate -l 1G "$scratch/disk"
          mkfs.ext4 -q -m 0 "$scratch/disk"
          mkdir "$scratch/mount"
          mount -o loop,nodev,nosuid,noexec "$scratch/disk" "$scratch/mount"
          install -d -m 0700 -o 1000 -g 1000 "$scratch/mount/work"
          install -d -m 0700 "$1"
          mount --bind "$scratch/mount/work" "$1"`,
          'verifier-scratch', verifierScratchPath], undefined, 30_000, limit);
        let controller = 0;
        const controlPlane = async request => {
          const preference = [controller, ...[0, 1, 2].filter(index => index !== controller)];
          controller = await selectSurvivingNode(preference, (index, probeSignal) =>
            ssh(index, ['sudo', ...kubeArgs, '--request-timeout=3s', 'get', '--raw=/readyz'], undefined, 5000, probeSignal),
          request === null ? null : request ?? limit);
          return controller;
        };
        const outsideKube = async (args, options) => kubeOn(await controlPlane(options?.signal), args, options);
        const verificationTarget = await readRehearsalVerificationTarget();
        const context = {cluster: name, nodes, directory, kube: outsideKube, run: local, image: ids[cloud], waitronImage: ids[waitron],
          signal: limit, verificationTarget, amazon: {...target, phase: 'baseline'}, baseline: true, databasePrepared: true};
        const execute = (binary, args, input, cleanup, request) =>
          run(binary, args, input, cleanup, undefined, request ?? limit);
        const prepareOutside = () => outsidePublication({...context, run: execute, mesh,
          controllersPath: fluxBundle, close: async () => {}});
        return await runBaseline({...context, prepareOutside,
          installStore: openId => installStockholmStore({...context, image: store, nodes: target.nodes,
            addresses: nodes.map(node => node.ip), openId}),
          importVerifierImage: async (image, args) => ssh(await controlPlane(limit), ['sudo', 'bash', '-o', 'pipefail', '-c',
            'docker save "$1" | ' + [...kubeArgs, '-n', servicesNamespace, ...args].map(quote).join(' '),
            'verifier-image', image], undefined, 180_000, limit),
        });
      } catch (error) {baselineFailure = error; throw error;}
      finally {await cleanUp(baselineFailure, closeHost);}
    };
    if (config.observer) operations.observe = async () => {
      // Include target transfer in baseline so the one-hour budget leaves forty minutes.
      const baselineStarted = now();
      assert.ok(expiry - baselineStarted >= 3600000, 'amazon.observer_expiry');
      target.observer = true;
      await writeFile(join(directory, 'target.json'), JSON.stringify(target), {mode: 0o600});
      await copy(0, 'target.json', '/tmp/d618-target.json');
      let stopMs, replacementMs;
      const result = await observe('ssh', [...sshOptions, 'admin@' + hosts[0],
        ['sudo', 'sh', '-ec', 'cd /opt/d618 && TEST_CLOUD_INTEGRATION_IMAGE=' + quote(ids[cloud]) + ' TEST_CLOUD_INTEGRATION_WAITRON_IMAGE=' + quote(ids[waitron]) + ' node scripts/kubernetes-check.mjs --amazon /tmp/d618-target.json'].map(quote).join(' ')], {
        signal, timeout: 3600000, onReady: async send => {
          assert.ok(now() - baselineStarted <= 1200000, 'amazon.observer_baseline_late');
          const before = now();
          await operations.stopWorker();
          process.stderr.write('P1 timing launcher stop-request-complete ' + (now() - before) + '\n');
          await operations.waitStopped();
          process.stderr.write('P1 timing launcher stop-wait-complete ' + (now() - before) + '\n');
          stopMs = now() - before; send('P1_STOPPED');
          const replacement = now(); await operations.replace();
          replacementMs = now() - replacement; send('P1_REPLACEMENT_READY');
        }});
      return {...result, stopMs, replacementMs};
    };
    if (config.baseline) {
      const id = await run('docker', ['network', 'create', '--subnet', '172.30.250.0/24', name]);
      assert.match(id, /^[a-f0-9]{64}$/, 'amazon.outside_network');
      networkId = id;
    }
    const outcome = await runAmazonExperiment(operations, {sleep, waitExpiry: () => sleep(Math.max(0, expiry - now()))});
    return {stack: name, ...outcome};
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    let cleanupFailure;
    try {await closeHost();} catch (error) {cleanupFailure = error;}
    for (const host of hosts ?? []) {
      // A stopped worker or disconnected master may already have no socket to close.
      try {await run('ssh', [...sshOptions, '-O', 'exit', 'admin@' + host], undefined, true);} catch {}
    }
    for (const image of ownedImages) {try {await run('docker', ['image', 'rm', image], undefined, true);} catch {process.stderr.write('Owned image cleanup failed\n');}}
    if (cleanupFailure && mesh) process.stderr.write('Outside tunnel or firewall cleanup needs its private configuration in ' + directory + '\n');
    else await rm(directory, {recursive: true, force: true});
    if (cleanupFailure) await cleanUp(failure, async () => {throw cleanupFailure;});
  }
}

// Only this mode keeps SSH stdin open; the other launcher modes retain execFile.
export async function observerCommand(binary, args, {onReady, signal, timeout = 3600000}) {
  signal?.throwIfAborted();
  const child = spawn(binary, args, {stdio: ['pipe', 'pipe', 'pipe']});
  let output = '', ready = false, task, failure, bytes = 0;
  const stop = error => {failure ??= error; child.kill('SIGKILL');};
  const abort = () => stop(Error('amazon.observer_cancelled'));
  const timer = setTimeout(() => stop(Error('amazon.observer_timeout')), timeout);
  signal?.addEventListener('abort', abort, {once: true});
  child.stdin.on('error', () => {});
  child.stdout.on('data', part => {
    bytes += part.length;
    if (bytes > 32 * 1024 * 1024) return stop(Error('amazon.observer_output_large'));
    output += part;
    if (!ready && output.includes('\n')) {
      if (!output.startsWith('P1_READY\n')) return stop(Error('amazon.observer_not_ready'));
      ready = true; output = output.slice('P1_READY\n'.length);
      task = Promise.resolve().then(() => onReady(value => child.stdin.write(value + '\n'))).catch(stop);
    }
  });
  child.stderr.on('data', part => {
    bytes += part.length;
    if (bytes > 32 * 1024 * 1024) stop(Error('amazon.observer_output_large'));
    else process.stderr.write(part);
  });
  try {
    const code = await new Promise(resolve => {
      child.once('error', error => {failure ??= error;}); child.once('close', resolve);
    });
    await task;
    if (failure) throw failure;
    assert.ok(ready && code === 0, 'amazon.observer_failed');
    return JSON.parse(output);
  } finally {clearTimeout(timer); signal?.removeEventListener('abort', abort); child.stdin.destroy();}
}
