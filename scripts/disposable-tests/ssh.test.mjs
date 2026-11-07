import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync, rmSync, symlinkSync, chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const script = new URL('../../deploy/disposable-tests/ssh.sh', import.meta.url).pathname;
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'disposable-ssh-'));
  t.after(() => rmSync(base, {recursive: true, force: true}));
  const bin = join(base, 'bin'); mkdirSync(bin);
  const capture = join(base, 'argv.json');
  // The SSH double must not import candidate Python modules itself.
  const node = "'" + process.execPath.replaceAll("'", "'\\''") + "'";
  writeFileSync(join(bin, 'ssh'), `#!/bin/sh\nexec ${node} -e 'require("node:fs").writeFileSync(process.env.CAPTURE_PATH,JSON.stringify(process.argv.slice(1)))' -- "$@"\n`, {mode: 0o755});
  return {base, capture, cache: join(base, 'cache'), env: {...process.env, PATH: bin + ':' + process.env.PATH, CAPTURE_PATH: capture, XDG_CACHE_HOME: join(base, 'cache')}};
}
test('all host commands reuse the common private socket and keep strict key verification', t => {
  const f = fixture(t);
  for (const command of ['true', 'python3 /opt/waitron-disposable/host.py inspect']) {
    const result = spawnSync('bash', [script, '2.29.248.230', command], {env: f.env, encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    const args = JSON.parse(readFileSync(f.capture));
    for (const option of ['ControlMaster=auto', 'ControlPersist=600', 'StrictHostKeyChecking=yes', 'BatchMode=yes', 'ConnectTimeout=8', 'ForwardAgent=no', 'ForwardX11=no', 'ClearAllForwardings=yes']) assert.ok(args.includes(option), option);
    assert.ok(args.includes(`ControlPath=${f.cache}/wt-ssh/%C`));
    assert.deepEqual(args.slice(-2), ['root@2.29.248.230', command]);
    assert.equal(statSync(join(f.cache, 'wt-ssh')).mode & 0o777, 0o700);
  }
});
test('an invalid host cannot inject SSH options or commands', t => {
  const f = fixture(t);
  for (const host of ['-oProxyCommand=id', '2.29.248.230;id', 'root@server', 'server\nother', '']) {
    const result = spawnSync('bash', [script, host, 'true'], {env: f.env, encoding: 'utf8'});
    assert.notEqual(result.status, 0); assert.match(result.stderr, /invalid.*host/i);
    assert.equal(existsSync(f.capture), false);
  }
});
test('a linked or shared writable socket directory refuses before SSH', t => {
  const f = fixture(t); mkdirSync(f.cache);
  const outside = join(f.base, 'outside'); mkdirSync(outside, {mode: 0o700});
  symlinkSync(outside, join(f.cache, 'wt-ssh'));
  const result = spawnSync('bash', [script, '2.29.248.230', 'true'], {env: f.env, encoding: 'utf8'});
  assert.notEqual(result.status, 0); assert.match(result.stderr, /private|linked/i);
  assert.equal(existsSync(f.capture), false);
});
test('a shared writable directory cannot host the controller socket', t => {
  const f = fixture(t); mkdirSync(f.cache);
  const directory = join(f.cache, 'wt-ssh'); mkdirSync(directory); chmodSync(directory, 0o777);
  const result = spawnSync('bash', [script, '2.29.248.230', 'true'], {env: f.env, encoding: 'utf8'});
  assert.notEqual(result.status, 0); assert.match(result.stderr, /private/i);
  assert.equal(existsSync(f.capture), false);
});

test('candidate Python modules cannot execute while the trusted SSH wrapper prepares its socket', t => {
  const f = fixture(t);
  const planted = join(f.base, 'planted');
  writeFileSync(join(f.base, 'pathlib.py'), `open(${JSON.stringify(planted)},'w').write('candidate ran on Mac')\nraise RuntimeError('planted module')\n`);
  const result = spawnSync('bash', [script, '2.29.248.230', 'true'], {cwd: f.base, env: {...f.env, PYTHONPATH: f.base}, encoding: 'utf8'});
  assert.equal(existsSync(planted), false, 'Candidate code ran before any guest existed');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(f.capture), true);
});
