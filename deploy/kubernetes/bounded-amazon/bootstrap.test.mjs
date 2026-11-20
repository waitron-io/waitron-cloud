import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {stockholmStoreResources} from '../../../scripts/kubernetes-storage.mjs';

const key = 'b'.repeat(64);
const token = 'abcdef.0123456789abcdef';
const joinInput = endpoint =>
  `kubeadm join ${endpoint} --token ${token} --discovery-token-ca-cert-hash sha256:${'a'.repeat(64)}\n${key}\n`;

function bootstrap(t, phase, address, input, failJoin = false, keyOutput = key, phaseArgument = 'synthetic-context') {
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
    if (name === 'iptables' && args.includes('-C')) process.exitCode = 1;
    if (name === 'id') console.log('0');
    if (name === 'ip') console.log('7: wg0 inet ' + process.env.ADDRESS + '/24 scope global wg0');
    if (name === 'hostname') console.log('synthetic-node');
    if (name === 'kubectl') console.log('synthetic ' + args[0]);
    if (name === 'kubeadm' && args[0] === 'certs') console.log(process.env.KEY_OUTPUT);
    if (name === 'kubeadm' && args[0] !== 'certs') console.log(${JSON.stringify(token)});
    if (name === 'kubeadm' && args[0] === 'join' && process.env.FAIL_JOIN === 'true') {
      console.error('synthetic join failure ' + args.join(' '));
      process.exitCode = 1;
    }
  `, {mode: 0o755});
  for (const name of ['id', 'ip', 'hostname', 'kubeadm', 'kubectl', 'curl', 'sleep', 'sed', 'install', 'iptables']) symlinkSync(stub, join(dir, name));
  symlinkSync('/usr/bin/awk', join(dir, 'awk'));
  symlinkSync('/bin/cat', join(dir, 'cat'));
  if (root) {
    chmodSync(dir, 0o755);
    for (const path of [hosts, log]) chmodSync(path, 0o666);
  }
  const result = spawnSync('/bin/bash', [script, phase, phaseArgument], {
    env: {PATH: dir, D618_HOSTS_FILE: hosts, CALLS: log, ADDRESS: address, FAIL_JOIN: String(failJoin), KEY_OUTPUT: keyOutput},
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

test('A refuses malformed certificate-key output before initialising kubeadm', t => {
  const {result, calls} = bootstrap(t, 'control', '10.77.0.1', undefined, false, 'short-key');
  assert.notEqual(result.status, 0);
  assert.equal(result.stderr.trim(), 'Invalid kubeadm certificate key');
  assert.equal(result.stdout, '');
  assert.ok(!calls.some(({name, args}) => name === 'kubeadm' && args[0] === 'init'));
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
    ['unexpected argument', valid.replace('\n', ' --unexpected-flag\n'), '10.77.0.2'],
    ['bad token', valid.replace(token, 'not-a-token'), '10.77.0.2'],
    ['bad CA hash', valid.replace('a'.repeat(64), 'missing-hash'), '10.77.0.2'],
    ['bad certificate key', valid.replace(key, 'short-key'), '10.77.0.2'],
    ['wrong member address', valid, '10.77.0.1', 'Invalid joining WireGuard address'],
  ];
  for (const [name, input, address, message = 'Invalid kubeadm join inputs'] of cases) await t.test(name, t => {
    const {result, calls, hosts} = bootstrap(t, 'join', address, input);
    assert.notEqual(result.status, 0);
    assert.equal(result.stderr.trim(), message);
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


test('the database bootstrap prepares a private directory on this machine', t => {
  const {result, calls} = bootstrap(t, 'database-storage');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls.map(({name, args}) => [name, ...args]), [
    ['id', '-u'],
    ['install', '-d', '-m', '0700', '-o', '26', '-g', '26', '/var/local/d621-postgres'],
  ]);
});

test('the store bootstrap prepares two private directories with the store process ownership', t => {
  const {result, calls} = bootstrap(t, 'object-storage');
  assert.equal(result.status, 0, result.stderr);
  const resources = stockholmStoreResources(['stockholm-a', 'stockholm-b', 'stockholm-c'], 'local:store');
  const {runAsUser, runAsGroup} = resources.find(row => row.kind === 'StatefulSet').spec.template.spec.securityContext;
  const users = readFileSync(new URL('../images/store/Dockerfile', import.meta.url), 'utf8').match(/^USER (\d+):(\d+)$/m);
  assert.deepEqual(users?.slice(1), [String(runAsUser), String(runAsGroup)]);
  assert.deepEqual(calls.map(({name, args}) => [name, ...args]), [
    ['id', '-u'],
    ['install', '-d', '-m', '0700', '-o', users[1], '-g', users[2], '/var/local/d621-store/0', '/var/local/d621-store/1'],
  ]);
});

test('outside filtering applies to new rehearsal-host traffic before port rewriting', async t => {
  for (const address of ['10.77.0.1', '10.77.0.2', '10.77.0.3']) await t.test(address, t => {
    const {result, calls} = bootstrap(t, 'outside-filter', address, undefined, false, key, address);
    assert.equal(result.status, 0, result.stderr);
    const rules = calls.filter(call => call.name === 'iptables').map(call => call.args);
    assert.deepEqual(rules.at(-1), ['-w', '-t', 'mangle', '-I', 'PREROUTING', '-i', 'wg0', '-s', '10.77.0.4/32',
      '-m', 'conntrack', '--ctstate', 'NEW', '-j', 'D618-OUTSIDE']);
    const ports = rules.filter(rule => rule.at(-1) === 'RETURN').map(rule => [
      rule[rule.indexOf('-d') + 1], rule[rule.indexOf('-p') + 1], rule[rule.indexOf('--dport') + 1],
    ]);
    assert.deepEqual(ports, [
      ...(address === '10.77.0.1' ? [[address, 'tcp', '3000']] : []),
      [address, 'tcp', '30443'], [address, 'tcp', '30900'], [address, 'udp', '31820'],
    ]);
    assert.deepEqual(rules.at(-2).slice(-4), ['-A', 'D618-OUTSIDE', '-j', 'DROP']);
  });
});

test('the saved node mesh config installs the rehearsal filter before bringing the interface up', t => {
  const input = '[Interface]\nAddress=10.77.0.2/24\nListenPort=51821\n[Peer]\nAllowedIPs=10.77.0.4/32\n';
  const {result} = bootstrap(t, 'mesh-config', undefined, input, false, key, '10.77.0.2');
  assert.equal(result.status, 0, result.stderr);
  const [section, hook, ...rest] = result.stdout.split('\n');
  assert.equal(section, '[Interface]');
  assert.match(hook, /^PreUp = bash .+bootstrap\.sh outside-filter 10\.77\.0\.2$/);
  assert.equal(rest.join('\n'), input.slice('[Interface]\n'.length));
});
