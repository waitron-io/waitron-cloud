import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir, rm, writeFile} from 'node:fs/promises';
import {isIPv4} from 'node:net';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fluxImages, installFlux, prepareFluxBundle, startOutsideFluxMirror} from './kubernetes-git.mjs';
import {cleanUp} from './kubernetes-database.mjs';

const wireGuardKey = /^[A-Za-z0-9+/]{43}=$/;
export const rehearsalAddress = '10.77.0.4';
export const rehearsalMtu = 1420;
export const meshNodeAddress = index => '10.77.0.' + (index + 1);

export function outsideNodePeer(publicKey) {
  assert.match(publicKey, wireGuardKey, 'outside.host_public_key');
  return '\n[Peer]\nPublicKey = ' + publicKey + '\nAllowedIPs = ' + rehearsalAddress + '/32\n';
}

async function installHostFilter(run, name) {
  const iptables = (...args) => run('sudo', ['-n', 'iptables', '-w', ...args], undefined, true);
  const rule = (...args) => iptables('-t', 'mangle', ...args);
  const jump = ['PREROUTING', '-i', name, '-j', name];
  const input = ['INPUT', '-i', name, '-m', 'conntrack', '!', '--ctstate', 'ESTABLISHED,RELATED', '-j', 'DROP'];
  let attached = false, local = false, chain = true;
  const remove = async () => {
    if (local) {await iptables('-D', ...input); local = false;}
    if (attached) {await rule('-D', ...jump); attached = false;}
    if (chain) {await rule('-F', name); await rule('-X', name); chain = false;}
  };
  await rule('-N', name);
  try {
    await rule('-A', name, '-m', 'conntrack', '--ctstate', 'ESTABLISHED,RELATED', '-j', 'RETURN');
    // Match the Git listener before Docker rewrites the destination.
    await rule('-A', name, '-p', 'tcp', '-d', rehearsalAddress, '--dport', '18000', '-j', 'RETURN');
    await rule('-A', name, '-j', 'DROP');
    await rule('-I', ...jump);
    attached = true;
    // Before the mirror is published, the same port could reach a host listener.
    await iptables('-I', ...input);
    local = true;
  } catch (error) {
    await cleanUp(error, remove);
    throw error;
  }
  return remove;
}

export async function startOutsideMesh({directory, peers, prepareNodes, run, restrictInbound = false}) {
  assert.equal(peers.length, 3, 'outside.mesh_nodes');
  assert.equal(new Set(peers.map(peer => peer.endpoint)).size, 3, 'outside.mesh_endpoints');
  for (const {endpoint, publicKey} of peers) {
    assert.ok(isIPv4(endpoint) && !endpoint.startsWith('10.77.0.'), 'outside.mesh_endpoint');
    assert.match(publicKey, wireGuardKey, 'outside.mesh_public_key');
  }
  const privateKey = await run('wg', ['genkey']);
  assert.match(privateKey, wireGuardKey, 'outside.host_private_key');
  const publicKey = await run('wg', ['pubkey'], privateKey + '\n');
  assert.match(publicKey, wireGuardKey, 'outside.host_public_key');
  await prepareNodes(publicKey);
  const interfaceName = 'd621' + randomUUID().replaceAll('-', '').slice(0, 11);
  const path = join(directory, interfaceName + '.conf');
  const config = ['[Interface]', 'Address = ' + rehearsalAddress + '/32', 'MTU = ' + rehearsalMtu, 'PrivateKey = ' + privateKey,
    ...peers.flatMap((peer, index) => ['', '[Peer]', 'PublicKey = ' + peer.publicKey,
      'AllowedIPs = ' + meshNodeAddress(index) + '/32', 'Endpoint = ' + peer.endpoint + ':51821', 'PersistentKeepalive = 15']),
    '',
  ].join('\n');
  await writeFile(path, config, {mode: 0o600, flag: 'wx'});
  // wg-quick owns rollback while adding routes. Let it finish even when the rehearsal is cancelled.
  let removeFilter;
  try {
    if (restrictInbound) removeFilter = await installHostFilter(run, interfaceName);
    await run('sudo', ['-n', 'wg-quick', 'up', path], undefined, true);
  } catch (error) {
    await cleanUp(error, async () => {
      try {await removeFilter?.();}
      finally {await rm(path);}
    });
    throw error;
  }
  let active = true;
  return {interfaceName, async close() {
    if (active) {
      await run('sudo', ['-n', 'wg-quick', 'down', path], undefined, true);
      active = false;
    }
    await removeFilter?.();
    removeFilter = undefined;
    await rm(path);
  }};
}

export function outsidePublication({cluster, signal, waitronImage, run, mesh, controllersPath, close = mesh.close}) {
  let flux;
  return {
    get revision() {return flux?.revision;},
    restoreNode: mesh.restoreNode,
    async install({deployment, kube, worker}) {
      flux = await installFlux({name: cluster, image: waitronImage, run, deployment, kube, signal,
        controllersPath, baselineNode: worker,
        mirror: options => startOutsideFluxMirror({...options, interfaceName: mesh.interfaceName})});
    },
    async close() {
      try {await flux?.close();}
      finally {await close();}
    },
  };
}

export async function startKindOutsideMesh({directory, nodes, run, signal}, {restrictInbound = false} = {}) {
  const execute = (binary, args, input, cleanup) => run(binary, args, {input, signal: cleanup ? null : signal, timeout: 180_000});
  const bootstrap = fileURLToPath(new URL('../deploy/kubernetes/bounded-amazon/bootstrap.sh', import.meta.url));
  const peers = [];
  const nodePid = async node => {
    const pid = await run('docker', ['inspect', '--type=container', '--format={{.State.Pid}}', node.id]);
    assert.match(pid, /^[1-9][0-9]*$/);
    return pid;
  };
  const configPath = index => join(directory, 'mesh-node-' + index, 'wg0.conf');
  const connectNode = async (index, options) =>
    run('nsenter', ['-t', await nodePid(nodes[index]), '-n', 'wg-quick', 'up', configPath(index)], options);
  for (const node of nodes) {
    const privateKey = await run('wg', ['genkey']);
    const publicKey = await execute('wg', ['pubkey'], privateKey + '\n');
    peers.push({endpoint: node.ip, publicKey, privateKey});
  }
  const mesh = await startOutsideMesh({directory, peers, run: execute, restrictInbound, async prepareNodes(publicKey) {
    for (const [index, {privateKey}] of peers.entries()) {
      const path = configPath(index), address = meshNodeAddress(index);
      await mkdir(join(directory, 'mesh-node-' + index));
      const input = `[Interface]\nAddress = ${address}/32\nListenPort = 51821\nMTU = ${rehearsalMtu}\nPrivateKey = ${privateKey}\n` + outsideNodePeer(publicKey);
      await run('bash', ['-c', 'umask 077; bash "$1" mesh-config "$2" > "$3"', 'mesh-config', bootstrap, address, path], {input});
      await connectNode(index);
    }
  }});
  return {...mesh, restoreNode(name, options) {
    const index = nodes.findIndex(node => node.name === name);
    assert.ok(index >= 0, 'outside.unknown_node');
    return connectNode(index, options);
  }};
}

export async function prepareKindOutsideBaseline({prepareBundle = prepareFluxBundle, ...context}) {
  const {cluster, directory, nodes, run, signal} = context;
  const execute = (binary, args, input, cleanup, limit) => run(binary, args,
    {input, signal: cleanup ? null : limit ?? signal, timeout: 180_000});
  const controllersPath = await prepareBundle(directory, cluster, {run: execute, node: nodes[0].name});
  for (const {upstream, tag} of fluxImages(cluster)) {
    const cached = await run('docker', ['image', 'inspect', upstream]).then(() => true, error => {
      if (!error.message.includes('No such image: ' + upstream)) throw error;
      return false;
    });
    if (!cached) await run('docker', ['pull', upstream], {timeout: 180_000});
    try {
      await run('docker', ['tag', upstream, tag]);
      try {await run('kind', ['load', 'docker-image', '--name', cluster, tag], {timeout: 180_000});}
      finally {await run('docker', ['image', 'rm', tag], {signal: null});}
    } finally {
      if (!cached) await run('docker', ['image', 'rm', upstream], {signal: null});
    }
  }
  const mesh = await startKindOutsideMesh(context, {restrictInbound: true});
  return outsidePublication({...context, mesh, run: execute, controllersPath});
}
