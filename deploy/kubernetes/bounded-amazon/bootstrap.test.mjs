import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

const key = 'b'.repeat(64);
const token = 'abcdef.0123456789abcdef';
const joinInput = endpoint =>
  `kubeadm join ${endpoint} --token ${token} --discovery-token-ca-cert-hash sha256:${'a'.repeat(64)}\n${key}\n`;

function bootstrap(t, phase, address, input, failJoin = false) {
  const root = process.getuid() === 0;
  const dir = mkdtempSync(join(root ? '/tmp' : tmpdir(), 'd618-bootstrap-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const hosts = join(dir, 'hosts'), log = join(dir, 'calls'), script = join(dir, 'bootstrap.sh');
  copyFileSync(new URL('./bootstrap.sh', import.meta.url), script);
  writeFileSync(hosts, '127.0.0.1 localhost\n', {mode: 0o666});
  writeFileSync(log, '', {mode: 0o666});
  const stub = join(dir, 'stub');
  writeFileSync(stub, '#!' + process.execPath + '\n' + `
    const fs = require('node:fs'), path = require('node:path');
    const [, file, ...args] = process.argv, name = path.basename(file);
    const hosts = fs.readFileSync(process.env.D618_HOSTS_FILE, 'utf8');
    fs.appendFileSync(process.env.CALLS, JSON.stringify({name, args, hosts}) + '\\n');
    if (name === 'sed' && args[0] === '-E') {
      process.stdout.write(require('node:child_process').execFileSync('/usr/bin/sed', args, {input: fs.readFileSync(0)}));
    }
    if (name === 'id') console.log('0');
    if (name === 'ip') console.log('7: wg0 inet ' + process.env.ADDRESS + '/24 scope global wg0');
    if (name === 'hostname') console.log('synthetic-node');
    if (name === 'kubectl') console.log('synthetic ' + args[0]);
    if (name === 'kubeadm' && args[0] === 'certs') console.log(${JSON.stringify(key)});
    if (name === 'kubeadm' && args[0] !== 'certs') console.log(${JSON.stringify(token)});
    if (name === 'kubeadm' && args[0] === 'join' && process.env.FAIL_JOIN === 'true') {
      console.error('synthetic join failure ' + args.join(' '));
      process.exitCode = 1;
    }
  `, {mode: 0o755});
  for (const name of ['id', 'ip', 'hostname', 'kubeadm', 'kubectl', 'curl', 'sleep', 'sed']) symlinkSync(stub, join(dir, name));
  symlinkSync('/usr/bin/awk', join(dir, 'awk'));
  if (root) {
    chmodSync(dir, 0o755);
    for (const path of [hosts, log]) chmodSync(path, 0o666);
  }
  const result = spawnSync('/bin/bash', [script, phase, 'synthetic-context'], {
    env: {PATH: dir, D618_HOSTS_FILE: hosts, CALLS: log, ADDRESS: address, FAIL_JOIN: String(failJoin)},
    ...(root ? {uid: 65534, gid: 65534} : {}), input, encoding: 'utf8', timeout: 15000,
  });
  assert.ifError(result.error);
  const calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  return {result, calls, hosts: readFileSync(hosts, 'utf8')};
}

test('A resolves the private API before kubeadm init and returns only the certificate key', t => {
  const {result, calls} = bootstrap(t, 'control', '10.77.0.1');
  assert.equal(result.status, 0, result.stderr);
  const init = calls.find(({name, args}) => name === 'kubeadm' && args[0] === 'init');
  assert.match(init.hosts, /^10\.77\.0\.1 d618-api$/m);
  for (const arg of ['--control-plane-endpoint=d618-api:6443', '--apiserver-advertise-address=10.77.0.1', '--upload-certs', '--certificate-key=' + key])
    assert.ok(init.args.includes(arg), arg);
  assert.equal(result.stdout.trim(), key);
  assert.doesNotMatch(result.stderr, new RegExp(token + '|' + key));
});

test('B and C join through A before using their own mesh address for API and etcd checks', async t => {
  for (const address of ['10.77.0.2', '10.77.0.3']) await t.test(address, t => {
    const {result, calls, hosts} = bootstrap(t, 'join', address, joinInput('d618-api:6443'));
    assert.equal(result.status, 0, result.stderr);
    const joinCall = calls.find(({name, args}) => name === 'kubeadm' && args[0] === 'join');
    assert.match(joinCall.hosts, /^10\.77\.0\.1 d618-api$/m);
    for (const arg of ['d618-api:6443', '--control-plane', '--apiserver-advertise-address=' + address, '--certificate-key=' + key])
      assert.ok(joinCall.args.includes(arg), arg);
    assert.equal(hosts, '127.0.0.1 localhost\n' + address + ' d618-api\n');
    const probes = calls.filter(({name, args}) => name === 'kubectl' && args.some(arg => arg.startsWith('--raw=/readyz')));
    assert.ok(probes.some(({args}) => args.includes('--raw=/readyz/etcd')), 'check local etcd before advancing');
    assert.ok(probes.some(({args}) => args.includes('--raw=/readyz')), 'check the full local API');
    assert.ok(probes.every(probe => probe.hosts === hosts && calls.indexOf(probe) > calls.indexOf(joinCall)));
    assert.ok(calls.some(({args}) => args.includes('rename-context') && args.at(-1) === 'synthetic-context'));
    assert.ok(calls.some(({args}) => args.includes('node-role.kubernetes.io/control-plane:NoSchedule-')));
    assert.equal(result.stdout, '');
  });
});

test('join refuses the old numeric endpoint before invoking kubeadm', t => {
  const {result, calls, hosts} = bootstrap(t, 'join', '10.77.0.2', joinInput('10.77.0.1:6443'));
  assert.notEqual(result.status, 0);
  assert.ok(!calls.some(({name}) => name === 'kubeadm'));
  assert.equal(hosts, '127.0.0.1 localhost\n');
});

test('join refuses malformed credentials or the first member address before invoking kubeadm', async t => {
  const valid = joinInput('d618-api:6443');
  const cases = [
    ['unexpected argument', valid.replace(' --token', ' --discovery-token-unsafe-skip-ca-verification --token'), '10.77.0.2'],
    ['bad token', valid.replace(token, 'not-a-token'), '10.77.0.2'],
    ['bad CA hash', valid.replace('a'.repeat(64), 'missing-hash'), '10.77.0.2'],
    ['bad certificate key', valid.replace(key, 'short-key'), '10.77.0.2'],
    ['wrong member address', valid, '10.77.0.1'],
  ];
  for (const [name, input, address] of cases) await t.test(name, t => {
    const {result, calls, hosts} = bootstrap(t, 'join', address, input);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid kubeadm join inputs|Invalid joining WireGuard address/);
    assert.ok(!calls.some(({name}) => name === 'kubeadm'));
    assert.equal(hosts, '127.0.0.1 localhost\n');
  });
});

test('failed join keeps the diagnosis and hides the token and certificate key', t => {
  const {result, hosts} = bootstrap(t, 'join', '10.77.0.2', joinInput('d618-api:6443'), true);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /synthetic join failure/);
  assert.ok(!result.stderr.includes(token) && !result.stderr.includes(key));
  assert.equal(result.stdout, '');
  assert.match(hosts, /^10\.77\.0\.1 d618-api$/m);
});
