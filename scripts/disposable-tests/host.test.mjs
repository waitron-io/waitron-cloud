import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
const script = new URL('../../deploy/disposable-tests/host.py', import.meta.url).pathname;
const key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGiUcL7F9BcOzhFJbD97eQj+L6u16A5RylAnj1BrChgC';
const request = () => ({resourceId: 'dt-bridge-1-0-1', deadline: Date.now() + 600000, sshPublicKey: key});
function plan(input) {
  return spawnSync('python3', [script, 'plan'], {input: JSON.stringify(input), encoding: 'utf8', timeout: 10000});
}

// Passing candidate-supplied QEMU flags would expose host resources to a guest.
test('the host refuses candidate-controlled sockets, mounts, images, ports and shared stores', () => {
  for (const extra of [{mounts: ['/']}, {socket: '/var/run/docker.sock'}, {image: '/etc/shadow'}, {port: 22}, {store: '/root/.local/share/pnpm'}, {argv: ['-virtfs', 'local,path=/']}]) {
    const result = plan({...request(), ...extra});
    assert.notEqual(result.status, 0); assert.match(result.stderr, /unknown.*field/i);
    assert.equal(result.stdout, '');
  }
});

test('escaping resource IDs, out-of-range slots, expired deadlines and overlong turns are refused', () => {
  for (const changed of [{resourceId: '../peer'}, {resourceId: 'dt-bridge-1-16-1'}, {resourceId: 'dt-bridge-1-0-0'}, {resourceId: 'dt-bridge-1-0-1;id'}, {deadline: Date.now() - 1}, {deadline: Date.now() + 3600000}, {deadline: 'later'}, {sshPublicKey: key + '\ncommand="id"'}]) {
    const result = plan({...request(), ...changed});
    assert.notEqual(result.status, 0); assert.match(result.stderr, /invalid|deadline/i);
    assert.equal(result.stdout, '');
  }
});

test('a local guest uses a private disk, bounded unprivileged service and loopback-only management', () => {
  const result = plan(request()); assert.equal(result.status, 0, result.stderr);
  const p = JSON.parse(result.stdout);
  assert.equal(p.directory, '/var/lib/waitron-disposable/turns/dt-bridge-1-0-1');
  assert.equal(p.uid, 62000);
  assert.equal(p.port, 22000);
  const q = p.qemu;
  assert.equal(q[q.indexOf('-netdev') + 1], 'user,id=net0,ipv6=off,hostfwd=tcp:127.0.0.1:22000-:22');
  assert.equal(q[q.indexOf('-smp') + 1], '4'); assert.equal(q[q.indexOf('-m') + 1], '16384');
  assert.equal(q.includes('-virtfs'), false); assert.equal(q.includes('-fsdev'), false);
  assert.ok(q.includes('file=/var/lib/waitron-disposable/turns/dt-bridge-1-0-1/disk.qcow2,format=qcow2,if=virtio'));
  assert.ok(p.service.includes('User=62000'));
  assert.ok(p.service.includes('KillMode=control-group'));
  assert.ok(p.service.includes('MemoryMax=18G'));
  const runtime = p.service.find(v => v.startsWith('RuntimeMaxSec='));
  assert.ok(Number(runtime.split('=')[1]) > 0 && Number(runtime.split('=')[1]) <= 600);
  assert.deepEqual(JSON.parse(p.userData.slice('#cloud-config\n'.length)).users[0].ssh_authorized_keys, [key]);
});

// Reusing a management port or host UID would join two guests' authority.
test('parallel slots use distinct loopback ports, host accounts and egress identities',()=>{
 for(const [resourceId,uid,port] of [['dt-bridge-1-1-1',62001,22001],['dt-bridge-1-5-1',62005,22005],['dt-bridge-1-15-1',62015,22015]]){
  const result=plan({...request(),resourceId});assert.equal(result.status,0,result.stderr);
  const p=JSON.parse(result.stdout);assert.equal(p.uid,uid);assert.equal(p.port,port);
  assert.ok(p.service.includes('User='+uid));
  assert.equal(p.qemu[p.qemu.indexOf('-netdev')+1],`user,id=net0,ipv6=off,hostfwd=tcp:127.0.0.1:${port}-:22`);
 }
});
