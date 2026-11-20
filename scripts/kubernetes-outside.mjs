import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {rm, writeFile} from 'node:fs/promises';
import {isIPv4} from 'node:net';
import {join} from 'node:path';

const wireGuardKey = /^[A-Za-z0-9+/]{43}=$/;
export const rehearsalAddress = '10.77.0.4';
export const rehearsalMtu = 1420;
export const meshNodeAddress = index => '10.77.0.' + (index + 1);

export function outsideNodePeer(publicKey) {
  assert.match(publicKey, wireGuardKey, 'outside.host_public_key');
  return '\n[Peer]\nPublicKey = ' + publicKey + '\nAllowedIPs = ' + rehearsalAddress + '/32\n';
}

export async function startOutsideMesh({directory, peers, prepareNodes, run}) {
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
  try {
    await run('sudo', ['-n', 'wg-quick', 'up', path], undefined, true);
  } catch (error) {
    await rm(path);
    throw error;
  }
  return {interfaceName, async close() {
    await run('sudo', ['-n', 'wg-quick', 'down', path], undefined, true);
    await rm(path);
  }};
}
