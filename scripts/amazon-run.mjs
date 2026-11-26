import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {fluxImages,prepareFluxBundle} from './kubernetes-git.mjs';
import {installStockholmStore, storeBuildArgs} from './kubernetes-storage.mjs';
import {meshNodeAddress, outsideNodePeer, outsidePublication, startOutsideMesh} from './kubernetes-outside.mjs';
import {cleanUp} from './kubernetes-database.mjs';
import {servicesNamespace, verifierScratchPath} from '../deploy/kubernetes/services.mjs';
import {readRehearsalVerificationTarget} from '../deploy/test-cloud/test-fixtures/integration-verification-target.mjs';
import {spreadCoreDns} from './kubernetes-placement.mjs';
import {selectSurvivingNode, untilRemote} from './kubernetes-remote.mjs';

const stockholmHoldMs = 900_000;

export async function stopAmazonRehearsalNode({instance, node, aws, kube, whileStopped, afterRestart, signal,
  holdMs = stockholmHoldMs, now = () => performance.now(), sleep = delay}) {
  assert.equal(holdMs, stockholmHoldMs, 'amazon.rehearsal_hold');
  assert.match(instance ?? '', /^i-[a-f0-9]{17}$/, 'amazon.rehearsal_instance');
  const instanceCall = (...args) => {
    signal?.throwIfAborted();
    return aws('ec2', [...args, '--instance-ids', instance]);
  };
  async function confirm(expected) {
    const {Reservations} = JSON.parse(await instanceCall('describe-instances'));
    const rows = Reservations.flatMap(row => row.Instances);
    assert.ok(rows.length === 1 && rows[0].InstanceId === instance && rows[0].State.Name === expected,
      'amazon.rehearsal_instance_state');
    return rows[0];
  }

  const started = now();
  await instanceCall('stop-instances', '--skip-os-shutdown');
  await instanceCall('wait', 'instance-stopped');
  await confirm('stopped');
  const stoppedAt = now();
  const fault = {signal: AbortSignal.any([signal, AbortSignal.timeout(holdMs + 30_000)].filter(Boolean))};
  const taint = 'node.kubernetes.io/out-of-service';
  await kube(['taint', 'node', node, taint + '=nodeshutdown:NoExecute'], fault);
  const result = await whileStopped({...fault, started, stoppedAt, holdMs});
  await sleep(Math.max(0, stoppedAt + holdMs - now()), undefined, {signal});
  await confirm('stopped');
  const offMs = Math.round(now() - stoppedAt);
  await instanceCall('start-instances');
  await instanceCall('wait', 'instance-running');
  await afterRestart(await confirm('running'), {signal});
  await kube(['taint', 'node', node, taint + ':NoExecute-'], {signal});
  return {...result, stopped: node, offMs};
}

export async function runAmazonExperiment(operations, {sleep = delay, waitExpiry, evidence} = {}) {
  const report = outcome => process.stderr.write('D621 failure summary ' + JSON.stringify({outcome, evidence}) + '\n');
  try {
    await operations.create();
    await operations.prepare();
    if (operations.baseline) {
      const baseline = await operations.baseline();
      if (evidence?.some(stage => stage.failures.length)) throw Error('amazon.qualification_failed');
      if (evidence) report('passed');
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
    if (evidence) report(error.message === 'amazon.qualification_failed' ? 'failed' : 'aborted');
    try {
      process.stderr.write('Amazon early deletion requested\n');
      await operations.deleteStack();
      await operations.waitDeleted();
      process.stderr.write('Amazon early deletion confirmed\n');
    }
    catch (cleanup) {throw new AggregateError([error, cleanup], error.message + '; Amazon teardown failed');}
    throw error;
  }
}

import {execFile, spawn} from 'node:child_process';
import {mkdir, mkdtemp, readFile, realpath, writeFile, rm} from 'node:fs/promises';
import {isIPv4} from 'node:net';
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
  const dryRun = mode === 'measured-stops-dry-run';
  const measuredStops = dryRun || mode === 'measured-stops';
  assert.ok(['start', 'stop', 'observe', 'baseline', 'measured-stops', 'measured-stops-dry-run'].includes(mode),
    'Use start or stop or observe or baseline or measured-stops or measured-stops-dry-run');
  if (measuredStops) assert.equal(await realpath(process.cwd()), await realpath(new URL('../', import.meta.url)),
    'Run from the launcher checkout root');
  assert.ok(process.env.D618_CONFIG, 'Set D618_CONFIG to your private run configuration JSON file.');
  const config = JSON.parse(await readFile(process.env.D618_CONFIG, 'utf8'));
  assert.match(config.region ?? '', /^[a-z]{2}-[a-z]+-\d$/, 'Set an explicit AWS region');
  const aws = (service, args, cleanup = false, request) => command('aws',
    ['--region', config.region, '--no-cli-pager', service, ...args, '--output', 'json'],
    undefined, cleanup ? undefined : AbortSignal.any([stop.signal, request].filter(Boolean)), 300000);
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
    const revision = await command('git', ['rev-parse', 'HEAD']);
    process.stderr.write('Amazon launch mode ' + mode + '; Cloud commit ' + revision + '\n');
    process.stdout.write(JSON.stringify(await startAmazon({...config, observer: mode === 'observe',
      baseline: mode === 'baseline' || measuredStops, measuredStops, dryRun}, {
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

export async function startAmazon(config, {run: execute, aws: provider, sleep = delay, now = Date.now, signal,
  observe = observerCommand, prepareFlux = prepareFluxBundle, runBaseline = runOutsideServices}) {
  assert.ok(!(config.baseline && config.observer), 'amazon.mode');
  assert.ok(!config.measuredStops || config.baseline, 'amazon.measured_stops_scope');
  assert.ok(!config.dryRun || config.measuredStops, 'amazon.dry_run_scope');
  if (config.measuredStops) assert.match(config.rehearsedWaitronImage ?? '', /^sha256:[a-f0-9]{64}$/,
    'Set rehearsedWaitronImage to the loaded rehearsal image ID');
  assert.match(config.region ?? '', /^[a-z]{2}-[a-z]+-\d$/, 'Set an explicit AWS region');
  let runDeadline, runSignal;
  const active = (cleanup, request) => {
    if (cleanup || !runSignal) return request;
    assert.ok(now() < runDeadline, 'amazon.run_deadline');
    const limit = request ? AbortSignal.any([runSignal, request]) : runSignal;
    limit.throwIfAborted();
    return limit;
  };
  const run = async (binary, args, input, cleanup, timeout, request) =>
    execute(binary, args, input, cleanup, timeout, active(cleanup, request));
  const aws = async (service, args, cleanup, request) => {
    assert.ok(!config.dryRun, 'amazon.dry_run_provider');
    return provider(service, args, cleanup, active(cleanup, request));
  };
  if (!config.dryRun) {
    const identity = JSON.parse(await aws('sts', ['get-caller-identity']));
    assert.ok(identity.Account === config.account && !identity.Arn.endsWith(':root'), 'amazon.identity');
  }
  assert.match(config.image, /^ami-[a-f0-9]{17}$/);
  assert.match(config.operatorCidr, /^(?:\d{1,3}\.){3}\d{1,3}\/32$/);
  if (!config.dryRun) {
    const quota = JSON.parse(await aws('service-quotas', ['get-service-quota', '--service-code', 'ec2', '--quota-code', 'L-1216C47A'])).Quota.Value;
    assert.ok(quota >= 12, `D618 needs a Running On-Demand Standard instances quota of at least 12 vCPUs; current quota is ${quota}. Request an increase in ${config.region} before retrying.`);
  }
  assert.equal(await run('uname', ['-m']), 'x86_64', 'Use the x86 test-box builder');
  assert.equal(await run('git', ['status', '--porcelain']), '', 'Use a clean, committed Cloud checkout');
  if (config.measuredStops) {
    await run('kubectl', ['version', '--client=true']);
    const privateKey = await run('wg', ['genkey']);
    await run('wg', ['pubkey'], privateKey + '\n');
    await run('sudo', ['-n', 'wg', 'show', 'interfaces']);
    await run('sudo', ['-n', 'wg-quick', '--help']);
    await import('./kubernetes-services.mjs');
    await import('../deploy/test-cloud/test-fixtures/integration-paid-remote.mjs');
  }
  const name = 'd618-' + randomUUID();
  const directory = await mkdtemp(join(tmpdir(), 'd618-')), ownedImages = [];
  const sourceArchive = join(directory, 'source.tar'), sourceDirectory = join(directory, 'source');
  const cloud = name + ':cloud', waitron = name + ':waitron', store = name + ':store';
  let hosts, mesh, networkId, failure;
  const evidence = config.measuredStops ? [] : undefined;
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
    // The relay reads the image as user 1000 even when the launch checkout is private.
    await run('git', ['-c', 'tar.umask=0022', 'archive', '--format=tar', '-o', sourceArchive, 'HEAD']);
    await mkdir(sourceDirectory, {mode: 0o700});
    await run('tar', ['-xpf', sourceArchive, '-C', sourceDirectory]);
    if (config.measuredStops) {
      // The remote installer uses argv[1] to distinguish its CLI from an import.
      await run(process.execPath, ['--input-type=module', '-e',
        "import {pathToFileURL} from 'node:url'; await import(pathToFileURL(process.argv[2]));",
        'import-only', join(sourceDirectory, 'scripts', 'kubernetes-data.mjs')]);
    }
    ownedImages.push(cloud);
    await run('docker', ['buildx', 'build', '--builder', 'default', '--platform', 'linux/amd64', '--load',
      '--secret', 'id=npm_token,env=NODE_AUTH_TOKEN', '--build-arg', 'SEAWEED_AMD64_SHA256=31fb804858885f9e7f18b6d3b1da09e824baac3e6a55b5a62c3c4c77e6ed6d7d',
      '-f', join(sourceDirectory, 'deploy/local-stack/Dockerfile'), '-t', cloud, sourceDirectory], undefined, false, 900000);
    ownedImages.push(waitron);
    if (config.measuredStops) await run('docker', ['tag', config.rehearsedWaitronImage, waitron]);
    else await run('env', ['BUILDX_BUILDER=default', 'WAITRON_CHECKOUT=' + config.waitronCheckout, 'CLOUD_VERIFIER_IMAGE=' + waitron,
      process.execPath, 'scripts/build-backup-verifier.mjs', ...(config.baseline ? ['--amazon-test'] : [])], undefined, false, 900000);
    ownedImages.push(store);
    await run('docker', storeBuildArgs(store, ['--platform', 'linux/amd64']), undefined, false, 900000);
    let fluxBundle;
    if (config.observer || config.baseline) {
      await run('docker',['run','--rm','--entrypoint','sh',waitron,'-ec','git --version && test -x "$(git --exec-path)/git-http-backend"']);
      fluxBundle=await prepareFlux(directory,name,{run, ...(config.measuredStops && {
        node: ['-control-plane', '-worker', '-worker2'].map(suffix => name + suffix),
      })});
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
    const bundleImages = [cloud, waitron, store, ...images], localIds = {};
    for (const image of bundleImages) {
      const [row] = JSON.parse(await run('docker', ['image', 'inspect', image]));
      assert.ok(row.Architecture === 'amd64' && row.Os === 'linux', 'amazon.image_architecture');
      localIds[image] = row.Id;
    }
    await run('docker', ['save', '--platform', 'linux/amd64', '-o', join(directory, 'images.tar'), ...bundleImages], undefined, false, 300000);
    await checkAmazonArchive(join(directory, 'images.tar'), bundleImages, run);
    const archive = JSON.parse(await run('tar', ['-xOf', join(directory, 'images.tar'), 'manifest.json'])), archiveIds = {};
    for (const image of bundleImages) {
      const canonical = 'docker.io/' + (image.includes('/') ? image : 'library/' + image);
      const config = archive.find(row => row.RepoTags?.some(tag => tag === image || tag === canonical))?.Config;
      const digest = config?.split('/').at(-1).replace(/\.json$/, '');
      assert.match(digest ?? '', /^[a-f0-9]{64}$/, 'amazon.archive_image');
      archiveIds[image] = 'sha256:' + digest;
    }
    if (config.measuredStops) process.stderr.write('Waitron rehearsal image ' + archiveIds[waitron] + '\n');
    const bytes = parseInt(await run('wc', ['-c', join(directory, 'images.tar')]), 10);
    const archiveCopyTimeout = Math.ceil(bytes * 8 / 10000000 * 1000) + 60000;
    process.stderr.write('Image bundle ' + bytes + ' bytes; one upload and private copies each have ' + archiveCopyTimeout + ' ms (10 Mbit/s cutoff plus 60 seconds)\n');
    // Stockholm's 150-minute limit includes five minutes to confirm deletion.
    const expiry = now() + (config.measuredStops ? 145 : 90) * 60_000;
    if (config.measuredStops) {
      runDeadline = expiry - 2 * 60_000;
      runSignal = AbortSignal.any([signal, AbortSignal.timeout(runDeadline - now())].filter(Boolean));
    }
    const parameters = {Image: config.image, Key: config.key, OperatorCidr: config.operatorCidr,
      StackRole: config.stackRole, SchedulerRole: config.schedulerRole, ExpiryTime: new Date(expiry).toISOString().slice(0, 19)};
    let outputs, target;
    const ssh = (index, args, input, timeout = 600000, request, hideStderr = false) => run('ssh',
      [...sshOptions, 'admin@' + hosts[index], args.map(quote).join(' ') + (hideStderr ? ' 2>/dev/null' : '')],
      input, request === null, timeout, request);
    const instanceIdentity = (index, request) => ssh(index, ['sh', '-ec',
      'token=$(curl -fsS -X PUT -H "X-aws-ec2-metadata-token-ttl-seconds: 60" http://169.254.169.254/latest/api/token); curl -fsS -H "X-aws-ec2-metadata-token: $token" http://169.254.169.254/latest/meta-data/instance-id'],
      undefined, 15_000, request);
    const copy = (index, file, path, timeout = 300000) => run('scp', [...sshOptions, join(directory, file), 'admin@' + hosts[index] + ':' + path], undefined, false, timeout);
    const bootstrap = (index, phase, args = [], input) => ssh(index, ['sudo', 'bash', '/opt/d618/deploy/kubernetes/bounded-amazon/bootstrap.sh', phase, ...args], input);
    const kubeArgs = ['kubectl', '--kubeconfig=/etc/kubernetes/admin.conf', '--context', name];
    const kubeOn = (index, args, {input, timeout, signal: request, quiet = false} = {}) => {
      // kubectl validation errors can quote the submitted Secret.
      const privateManifest = args.includes('-f') && /"kind"\s*:\s*"Secret"/.test(input ?? '');
      return ssh(index, ['sudo', ...kubeArgs, ...args], input, timeout, request, quiet || privateManifest);
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
          const instance = await instanceIdentity(index);
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
        if (config.measuredStops) for (const index of [1, 2]) await bootstrap(index, 'release-staging');
        for (let index = 0; index < 3; index++) {
          await ssh(index, ['sudo', 'ctr', '-n', 'k8s.io', 'images', 'import', '/tmp/d618-images.tar']);
          for (const [image, id] of Object.entries(archiveIds)) {
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
        return JSON.parse(await ssh(0, ['sudo', 'sh', '-ec', 'cd /opt/d618 && TEST_CLOUD_INTEGRATION_IMAGE=' + quote(archiveIds[cloud]) + ' TEST_CLOUD_INTEGRATION_WAITRON_IMAGE=' + quote(archiveIds[waitron]) + ' node scripts/kubernetes-check.mjs --amazon /tmp/d618-target.json'], undefined, 1200000));
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
        const reserve = config.measuredStops ? 20 * 60_000 : 0;
        assert.ok(!config.measuredStops || expiry - now() >= reserve + 3 * (stockholmHoldMs + 5 * 60_000),
          'amazon.measured_stops_expiry');
        const singleStopDeadline = expiry - reserve;
        const stopSignal = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, singleStopDeadline - now()))].filter(Boolean));
        const limit = runSignal ?? stopSignal;
        const scratch = (index, phase, request) => ssh(index,
          ['sudo', 'bash', '/opt/d618/deploy/kubernetes/bounded-amazon/bootstrap.sh', 'verifier-scratch', phase],
          undefined, 30_000, request);
        for (const index of [0, 1, 2]) await scratch(index, config.measuredStops ? 'boot' : 'once', limit);
        let controller = 0, evidenceController = 0, unavailable;
        const preferred = first => [first, ...[0, 1, 2].filter(index => index !== first)].filter(index => index !== unavailable);
        const controlPlaneSelection = {calls: 0, totalMs: 0, longestMs: 0};
        const controlPlane = async request => {
          const started = performance.now();
          try {
            controller = await selectSurvivingNode(preferred(controller), (index, probeSignal) =>
              ssh(index, ['sudo', ...kubeArgs, '--request-timeout=3s', 'get', '--raw=/readyz'], undefined, 5000, probeSignal),
            request === null ? null : request ?? limit);
            return controller;
          } finally {
            const elapsed = performance.now() - started;
            controlPlaneSelection.calls++;
            controlPlaneSelection.totalMs += elapsed;
            controlPlaneSelection.longestMs = Math.max(controlPlaneSelection.longestMs, elapsed);
          }
        };
        const outsideKube = async (args, options) => kubeOn(await controlPlane(options?.signal), args, options);
        const bindEvidenceKube = async signal => {
          const index = await selectSurvivingNode(preferred(evidenceController), (candidate, request) =>
            kubeOn(candidate, ['--request-timeout=250ms', 'get', '--raw=/readyz'], {signal: request, timeout: 300, quiet: true}), signal);
          evidenceController = index;
          return (args, options) => kubeOn(index, args, {signal, ...options, quiet: true});
        };
        async function stopNode(node, {whileStopped, afterRestart}) {
          assert.ok(now() < singleStopDeadline, 'amazon.measured_stops_expiry');
          stopSignal.throwIfAborted();
          const index = target.nodes.indexOf(node);
          assert.ok(index >= 0, 'amazon.measured_stop_node');
          const heartbeat = async signal => JSON.parse(await outsideKube(
            ['-n', 'kube-node-lease', 'get', 'lease', node, '-o', 'json'], {signal})).spec.renewTime;
          const before = Date.parse(await heartbeat(stopSignal));
          assert.ok(Number.isFinite(before), 'amazon.measured_stop_lease');
          unavailable = index;
          const receipt = await stopAmazonRehearsalNode({instance: target.instances[index], node, aws: (service, args) => aws(service, args, false, stopSignal), kube: outsideKube,
            whileStopped, signal: stopSignal,
            async afterRestart(instance) {
              const endpoint = instance.PublicIpAddress;
              assert.ok(isIPv4(endpoint) && !hosts.some((address, peer) => peer !== index && address === endpoint) &&
                instance.PrivateIpAddress === outputs['Private' + ['A', 'B', 'C'][index]], 'amazon.restarted_address');
              if (hosts[index] !== endpoint) {
                await run('ssh', [...sshOptions, '-O', 'exit', 'admin@' + hosts[index]], undefined, true).catch(() => {});
                hosts[index] = endpoint;
              }
              await mesh.refreshEndpoint(index, endpoint, stopSignal);
              await untilRemote(async signal => {
                if (await kubeOn(index, ['get', '--raw=/readyz'], {signal, timeout: 5000}) !== 'ok') return false;
                return Date.parse(await heartbeat(signal)) > before;
              }, 180_000, stopSignal, 'amazon_node_rejoined');
              await scratch(index, 'check', stopSignal);
              await afterRestart({signal: stopSignal});
            }});
          unavailable = undefined;
          await outsideKube(['wait', '--for=condition=Ready', 'node', node, '--timeout=180s'], {signal: stopSignal});
          return receipt;
        }
        async function restartAll(whileStopped) {
          const indexes = [0, 1, 2], roles = ['A', 'B', 'C'];
          assert.ok(target.instances.length === 3 && new Set(target.instances).size === 3 &&
            target.instances.every(id => /^i-[a-f0-9]{17}$/.test(id)), 'amazon.cold_restart_instances');
          const invoke = (request, ...args) => aws('ec2', [...args, '--instance-ids', ...target.instances], false, request);
          const read = async request => {
            const {Reservations} = JSON.parse(await invoke(request, 'describe-instances'));
            const byId = new Map(Reservations.flatMap(row => row.Instances).map(row => [row.InstanceId, row]));
            assert.ok(byId.size === 3 && target.instances.every(id => byId.has(id)), 'amazon.cold_restart_instances');
            return target.instances.map(id => byId.get(id));
          };
          const bootId = (index, request) => ssh(index, ['cat', '/proc/sys/kernel/random/boot_id'], undefined, 15_000, request);
          const scratchWitness = (index, phase, request) => ssh(index, ['sudo', 'sh', '-ec', `
            marker=$2/.d618-cold-restart
            if [ "$1" = write ]; then
              umask 077
              printf '%s\n' "$3" > "$marker"
            else
              test "$(cat "$marker")" = "$3"
            fi`, 'cold-scratch-witness', phase, verifierScratchPath, target.instances[index]], undefined, 15_000, request);
          const heartbeat = async (index, request) => Date.parse(JSON.parse(await kubeOn(index,
            ['-n', 'kube-node-lease', 'get', 'lease', target.nodes[index], '-o', 'json'], {signal: request})).spec.renewTime);
          const admit = () => assert.ok(now() <= singleStopDeadline, 'amazon.cold_restart_late');
          const volumeIds = row => (row.BlockDeviceMappings ?? []).map(device => device.Ebs?.VolumeId).sort();
          admit();
          const before = await read(limit);
          const disks = before.map(volumeIds);
          for (const [index, row] of before.entries()) {
            assert.ok(row.State.Name === 'running' && row.PrivateIpAddress === outputs['Private' + roles[index]] &&
              row.PublicIpAddress === hosts[index] && disks[index].length &&
              disks[index].every(id => /^vol-[a-f0-9]+$/.test(id)), 'amazon.cold_restart_binding');
          }
          const oldBoot = await Promise.all(indexes.map(index => bootId(index, limit)));
          assert.ok(oldBoot.every(id => /^[0-9a-f-]{36}$/.test(id)), 'amazon.cold_restart_boot_id');
          await Promise.all(indexes.map(index => scratchWitness(index, 'write', limit)));
          const oldLeases = await Promise.all(indexes.map(index => heartbeat(index, limit)));
          assert.ok(oldLeases.every(Number.isFinite), 'amazon.cold_restart_lease');
          admit();
          const started = performance.now(), stopTimesMs = {}, bootTimesMs = {};
          const fault = AbortSignal.any([limit, AbortSignal.timeout(240_000)]);
          await invoke(fault, 'stop-instances', '--skip-os-shutdown');
          await untilRemote(async request => {
            const rows = await read(request);
            for (const [index, row] of rows.entries()) {
              if (row.State.Name === 'stopped') stopTimesMs[nodes[index].name] ??= Math.round(performance.now() - started);
            }
            return rows.every(row => row.State.Name === 'stopped');
          }, 240_000, fault, 'amazon_all_stopped');
          const confirmStopped = async (request = fault) => {
            assert.ok((await read(request)).every(row => row.State.Name === 'stopped'), 'amazon.cold_restart_still_running');
          };
          const outage = await whileStopped({signal: fault, confirmStopped});
          const bootStarted = performance.now(), boot = AbortSignal.any([limit, AbortSignal.timeout(300_000)]);
          await invoke(boot, 'start-instances');
          const current = await untilRemote(async request => {
            const rows = await read(request);
            return rows.every(row => row.State.Name === 'running' && row.PublicIpAddress) && rows;
          }, 300_000, boot, 'amazon_all_running');
          const endpoints = current.map(row => row.PublicIpAddress);
          assert.ok(endpoints.every(isIPv4) && new Set(endpoints).size === 3, 'amazon.cold_restart_public_addresses');
          for (const [index, row] of current.entries()) {
            assert.equal(row.PrivateIpAddress, before[index].PrivateIpAddress, 'amazon.cold_restart_private_address');
            assert.deepEqual(volumeIds(row), disks[index], 'amazon.cold_restart_volumes');
          }
          await Promise.all(hosts.map(host =>
            run('ssh', [...sshOptions, '-O', 'exit', 'admin@' + host], undefined, true).catch(() => {})));
          hosts = endpoints;
          for (const index of indexes) await mesh.refreshEndpoint(index, hosts[index], boot);
          await Promise.all(indexes.map(async index => {
            await untilRemote(async request => {
              if (await instanceIdentity(index, request) !== target.instances[index]) return false;
              const id = await bootId(index, request);
              if (!/^[0-9a-f-]{36}$/.test(id) || id === oldBoot[index]) return false;
              await scratch(index, 'check', request);
              await scratchWitness(index, 'read', request);
              bootTimesMs[nodes[index].name] ??= Math.round(performance.now() - bootStarted);
              return await heartbeat(index, request) > oldLeases[index] &&
                await kubeOn(index, ['get', '--raw=/readyz'], {signal: request, timeout: 5000}) === 'ok';
            }, 300_000, boot, 'amazon_all_rejoined');
          }));
          await outsideKube(['wait', '--for=condition=Ready', 'nodes', '--all', '--timeout=180s'], {signal: boot});
          return {outage, stopTimesMs, bootTimesMs, recoveryMs: Math.round(performance.now() - bootStarted)};
        }
        const verificationTarget = await readRehearsalVerificationTarget();
        // The launch host can use a different Docker image store from the classic verifier.
        const context = {cluster: name, nodes, directory, kube: outsideKube, run: local,
          image: localIds[cloud], waitronImage: localIds[waitron], verifierImage: archiveIds[waitron],
          signal: limit, verificationTarget, amazon: {...target, phase: 'baseline', ...(config.measuredStops && {measuredStops: true})},
          baseline: true, databasePrepared: true,
          ...(config.measuredStops && {stopServiceNodes: true, stopNode, stopSignal, restartAll, holdMs: stockholmHoldMs,
            bindEvidenceKube, recordEvidence: (stage, failures) => evidence.push({stage, failures})})};
        const execute = (binary, args, input, cleanup, request) =>
          run(binary, args, input, cleanup, undefined, request ?? limit);
        const prepareOutside = () => outsidePublication({...context, run: execute, mesh,
          controllersPath: fluxBundle, close: async () => {}});
        const result = await runBaseline({...context, prepareOutside,
          installStore: openId => installStockholmStore({...context, image: store, nodes: target.nodes,
            addresses: nodes.map(node => node.ip), openId}),
          importVerifierImage: async (image, args) => ssh(await controlPlane(limit), ['sudo', 'bash', '-o', 'pipefail', '-c',
            'docker save "$1" | ' + [...kubeArgs, '-n', servicesNamespace, ...args].map(quote).join(' '),
            'verifier-image', image], undefined, 180_000, limit),
        });
        return config.measuredStops ? {...result, controlPlaneSelection} : result;
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
        ['sudo', 'sh', '-ec', 'cd /opt/d618 && TEST_CLOUD_INTEGRATION_IMAGE=' + quote(archiveIds[cloud]) + ' TEST_CLOUD_INTEGRATION_WAITRON_IMAGE=' + quote(archiveIds[waitron]) + ' node scripts/kubernetes-check.mjs --amazon /tmp/d618-target.json'].map(quote).join(' ')], {
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
    if (config.dryRun) return {dryRun: true, revision: await run('git', ['rev-parse', 'HEAD']), images: archiveIds};
    const outcome = await runAmazonExperiment(operations, {sleep, evidence, waitExpiry: () => sleep(Math.max(0, expiry - now()))});
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
