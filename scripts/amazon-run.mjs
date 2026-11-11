import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';

export async function runAmazonExperiment(operations, {sleep = delay, waitExpiry} = {}) {
  try {
    await operations.create();
    await operations.prepare();
    const before = await operations.journey('before');
    await operations.stopWorker();
    await operations.waitStopped();
    await operations.replace();
    await sleep(900000);
    const after = await operations.journey('after');
    await operations.checkStopped();
    await waitExpiry();
    await operations.waitDeleted();
    return {journeys: [before, after], removed: true};
  } catch (error) {
    try {await operations.deleteStack(); await operations.waitDeleted();}
    catch (cleanup) {throw new AggregateError([error, cleanup], error.message + '; Amazon teardown failed');}
    throw error;
  }
}

import {execFile} from 'node:child_process';
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
  assert.ok(['start', 'stop'].includes(mode), 'Use start or stop');
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
    process.stdout.write(JSON.stringify(await startAmazon(config, {run: (binary, args, input, cleanup, timeout) => command(binary, args, input, cleanup ? undefined : stop.signal, timeout), aws,
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
    while (manifest.manifests) {
      // Other platforms and attestations need not be bundled for the selected runtime.
      descriptor = manifest.manifests.find(row => row.platform?.os === 'linux' && row.platform.architecture === 'amd64');
      assert.ok(descriptor, 'amazon.archive_platform');
      manifest = await read(blob(descriptor));
    }
    assert.ok(descriptor.platform?.os === 'linux' && descriptor.platform.architecture === 'amd64', 'amazon.archive_platform');
    for (const part of [manifest.config, ...manifest.layers]) present(blob(part));
  }
}

export async function startAmazon(config, {run, aws, sleep = delay, now = Date.now}) {
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
  const cloud = name + ':cloud', waitron = name + ':waitron';
  let hosts;
  const sshOptions = ['-i', config.sshKey, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'UserKnownHostsFile=' + join(directory, 'known_hosts'),
    '-o', 'ControlMaster=auto', '-o', 'ControlPath=' + join(directory, '%C'), '-o', 'ControlPersist=600', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4'];
  try {
    ownedImages.push(cloud);
    await run('docker', ['buildx', 'build', '--builder', 'default', '--platform', 'linux/amd64', '--load',
      '--secret', 'id=npm_token,env=NODE_AUTH_TOKEN', '--build-arg', 'SEAWEED_AMD64_SHA256=31fb804858885f9e7f18b6d3b1da09e824baac3e6a55b5a62c3c4c77e6ed6d7d',
      '-f', 'deploy/local-stack/Dockerfile', '-t', cloud, '.'], undefined, false, 900000);
    ownedImages.push(waitron);
    await run('env', ['BUILDX_BUILDER=default', 'WAITRON_CHECKOUT=' + config.waitronCheckout, 'CLOUD_VERIFIER_IMAGE=' + waitron,
      process.execPath, 'scripts/build-backup-verifier.mjs'], undefined, false, 900000);
    const manifest = JSON.parse(await readFile(new URL('../deploy/kubernetes/local-checks.yaml', import.meta.url), 'utf8'));
    const images = [...new Set(JSON.stringify(manifest).match(/"image":"([^"]+)"/g)?.map(row => JSON.parse('{' + row + '}').image) ?? [])].filter(image => image !== 'CLOUD_IMAGE');
    for (const image of images) {
      try {await run('docker', ['image', 'inspect', image]);} catch {ownedImages.push(image);}
      await run('docker', ['pull', '--platform', 'linux/amd64', image]);
    }
    for (const image of [cloud, waitron, ...images]) {
      const [row] = JSON.parse(await run('docker', ['image', 'inspect', image]));
      assert.ok(row.Architecture === 'amd64' && row.Os === 'linux', 'amazon.image_architecture');
    }
    await run('docker', ['save', '--platform', 'linux/amd64', '-o', join(directory, 'images.tar'), cloud, waitron, ...images], undefined, false, 300000);
    await checkAmazonArchive(join(directory, 'images.tar'), [cloud, waitron, ...images], run);
    const archive = JSON.parse(await run('tar', ['-xOf', join(directory, 'images.tar'), 'manifest.json'])), ids = {};
    for (const image of [cloud, waitron, ...images]) {
      const canonical = 'docker.io/' + (image.includes('/') ? image : 'library/' + image);
      const config = archive.find(row => row.RepoTags?.some(tag => tag === image || tag === canonical))?.Config;
      const digest = config?.split('/').at(-1).replace(/\.json$/, '');
      assert.match(digest ?? '', /^[a-f0-9]{64}$/, 'amazon.archive_image');
      ids[image] = 'sha256:' + digest;
    }
    const bytes = parseInt(await run('wc', ['-c', join(directory, 'images.tar')]), 10);
    process.stderr.write('Image bundle ' + bytes + ' bytes; each 300-second upload needs at least ' + (bytes * 8 / 300 / 1e6).toFixed(1) + ' Mbit/s plus headroom\n');
    await run('git', ['archive', '--format=tar', '-o', join(directory, 'source.tar'), 'HEAD']);
    const expiry = now() + 90 * 60000;
    const parameters = {Image: config.image, Key: config.key, OperatorCidr: config.operatorCidr,
      StackRole: config.stackRole, SchedulerRole: config.schedulerRole, ExpiryTime: new Date(expiry).toISOString().slice(0, 19)};
    let outputs, target;
    const ssh = (index, args, input, timeout = 600000) => run('ssh', [...sshOptions, 'admin@' + hosts[index], args.map(quote).join(' ')], input, false, timeout);
    const copy = (index, file, path) => run('scp', [...sshOptions, join(directory, file), 'admin@' + hosts[index] + ':' + path], undefined, false, 300000);
    const bootstrap = (index, phase, args = [], input) => ssh(index, ['sudo', 'bash', '/opt/d618/deploy/kubernetes/bounded-amazon/bootstrap.sh', phase, ...args], input);
    const kube = args => ssh(0, ['sudo', 'kubectl', '--kubeconfig=/etc/kubernetes/admin.conf', '--context', name, ...args]);
    const waitDeleted = async () => {
      try {await aws('cloudformation', ['wait', 'stack-delete-complete', '--stack-name', name], true);}
      catch (error) {if (error.code === 'ETIMEDOUT') throw Error('amazon.deletion_late'); throw error;}
    };
    const outcome = await runAmazonExperiment({
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
          await bootstrap(index, 'prepare', [target.nodes[index], '10.77.0.' + (index + 1)]);
        }
        for (let index = 0; index < 3; index++) {
          const peers = [0, 1, 2].filter(peer => peer !== index).map(peer => '\n[Peer]\nPublicKey=' + publicKeys[peer] + '\nAllowedIPs=10.77.0.' + (peer + 1) + '/32\nEndpoint=' + outputs['Private' + ['A', 'B', 'C'][peer]] + ':51821\nPersistentKeepalive=15\n').join('');
          await bootstrap(index, 'mesh', [], '[Interface]\nAddress=10.77.0.' + (index + 1) + '/24\nListenPort=51821\nPrivateKey=' + privateKeys[index] + '\n' + peers);
        }
        for (let index = 0; index < 3; index++) {
          await bootstrap(index, 'storage', [index === 0 ? 'control' : 'worker']);
          await copy(index, 'images.tar', '/tmp/d618-images.tar');
          await ssh(index, ['sudo', 'ctr', '-n', 'k8s.io', 'images', 'import', '/tmp/d618-images.tar']);
          for (const [image, id] of Object.entries(ids)) {
            const info = JSON.parse(await ssh(index, ['sudo', 'crictl', '--image-endpoint', 'unix:///run/containerd/containerd.sock', 'inspecti', '-o', 'json', image]));
            assert.equal(info.status.id, id, 'amazon.import_digest');
          }
        }
        await ssh(0, ['sudo', 'docker', 'load', '-i', '/tmp/d618-images.tar']);
        await ssh(0, ['sudo', 'docker', 'network', 'create', '--subnet', '10.79.0.0/24', name]);
        await bootstrap(0, 'control', [name]);
        const joinCommand = await ssh(0, ['sudo', 'kubeadm', 'token', 'create', '--ttl', '20m', '--print-join-command']);
        for (const index of [1, 2]) await bootstrap(index, 'join', [], joinCommand + '\n');
        await kube(['wait', '--for=condition=Ready', 'nodes', '--all', '--timeout=180s']);
      },
      journey: async phase => {
        target.phase = phase;
        await writeFile(join(directory, 'target.json'), JSON.stringify(target), {mode: 0o600});
        await copy(0, 'target.json', '/tmp/d618-target.json');
        return JSON.parse(await ssh(0, ['sudo', 'sh', '-ec', 'cd /opt/d618 && TEST_CLOUD_INTEGRATION_IMAGE=' + quote(ids[cloud]) + ' TEST_CLOUD_INTEGRATION_WAITRON_IMAGE=' + quote(ids[waitron]) + ' node scripts/kubernetes-check.mjs --amazon /tmp/d618-target.json'], undefined, 1200000));
      },
      stopWorker: () => aws('ec2', ['stop-instances', '--instance-ids', outputs.C]),
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
    }, {sleep, waitExpiry: () => sleep(Math.max(0, expiry - now()))});
    return {stack: name, ...outcome};
  } finally {
    for (const host of hosts ?? []) {
      // A stopped worker or expired idle master may already have no socket to close.
      try {await run('ssh', [...sshOptions, '-O', 'exit', 'admin@' + host], undefined, true);} catch {}
    }
    for (const image of ownedImages) {try {await run('docker', ['image', 'rm', image], undefined, true);} catch {process.stderr.write('Owned image cleanup failed\n');}}
    await rm(directory, {recursive: true, force: true});
  }
}
