import assert from 'node:assert/strict';
import {mkdirSync, lstatSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, unlinkSync, rmdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const uuid = /^[a-f0-9-]{36}$/i;
function bootIdentity() {
  const value = process.platform === 'darwin'
    ? execFileSync('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'], {cwd: '/', encoding: 'utf8', timeout: 2000})
    : readFileSync('/proc/sys/kernel/random/boot_id', 'utf8');
  assert.match(value.trim(), uuid, 'Unknown boot identity');
  return value.trim().toLowerCase();
}
function processIdentity(pid) {
  const value = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'uid='],
    {cwd: '/', encoding: 'utf8', timeout: 2000, env: {PATH: '/usr/bin:/bin', LC_ALL: 'C'}}).trim();
  assert.ok(value.length > 0 && value.length < 128, 'Unknown process identity');
  return value;
}
let identity;
function currentOwner() {
  identity ??= {version: 2, pid: process.pid, boot: bootIdentity(), started: processIdentity(process.pid)};
  return {...identity, nonce: randomUUID()};
}
export function readOwner(path) {
  const directory = lstatSync(path);
  assert.ok(directory.isDirectory() && !directory.isSymbolicLink() && directory.uid === process.getuid() && (directory.mode & 0o077) === 0, 'Unknown gate directory');
  const info = lstatSync(join(path, 'owner.json'));
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.uid === process.getuid() && info.size <= 1024 && (info.mode & 0o077) === 0, 'Unknown gate owner');
  const owner = JSON.parse(readFileSync(join(path, 'owner.json'), 'utf8'));
  assert.ok([1, 2].includes(owner.version) && Number.isSafeInteger(owner.pid) && owner.pid > 0 && typeof owner.nonce === 'string' && uuid.test(owner.nonce), 'Unknown gate owner');
  if (owner.version === 2) assert.ok(typeof owner.boot === 'string' && uuid.test(owner.boot) && typeof owner.started === 'string' && owner.started.length > 0 && owner.started.length < 128, 'Unknown process owner');
  return owner;
}
export function claimGate(directory, name) {
  const path = join(directory, name);
  try {mkdirSync(path, {mode: 0o700});}
  catch (error) {if (error.code === 'EEXIST') return; throw error;}
  const owner = currentOwner();
  const fd = openSync(join(path, 'owner.json'), 'wx', 0o600);
  try {writeFileSync(fd, JSON.stringify(owner)); fsyncSync(fd);} finally {closeSync(fd);}
  const parent = openSync(path, 'r'); try {fsyncSync(parent);} finally {closeSync(parent);}
  return {path, owner};
}
export function releaseGate(gate) {
  assert.deepEqual(readOwner(gate.path), gate.owner, 'Another process owns this gate');
  unlinkSync(join(gate.path, 'owner.json')); rmdirSync(gate.path);
}
export function ownerDead(owner) {
  try {
    if (owner.version === 2 && owner.boot.toLowerCase() !== bootIdentity()) return true;
    try {process.kill(owner.pid, 0);} catch (error) {return error.code === 'ESRCH';}
    return owner.version === 2 && owner.started !== processIdentity(owner.pid);
  } catch {return false;}
}

// Only the OS-locked Mac controller reclaims abandoned gates. Ordinary callers
// cannot remove a lock, and an incomplete identity never authorizes reclamation.
export function reclaimDeadGate(path) {
  let owner;
  try {owner = readOwner(path);} catch {return false;}
  if (!ownerDead(owner)) return false;
  releaseGate({path, owner});
  return true;
}
