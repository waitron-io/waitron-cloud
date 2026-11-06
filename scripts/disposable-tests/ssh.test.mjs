import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const script = new URL('../../deploy/disposable-tests/ssh.sh', import.meta.url).pathname;
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'disposable-ssh-'));
  t.after(() => rmSync(base, {recursive: true, force: true}));
  const bin = join(base, 'bin'); mkdirSync(bin);
  const capture = join(base, 'argv.json');
  writeFileSync(join(bin, 'ssh'), '#!/bin/sh\nexec python3 -c \'import json,os,sys;open(os.environ["CAPTURE_PATH"],"w").write(json.dumps(sys.argv[1:]))\' "$@"\n', {mode: 0o755});
  return {base, capture, cache: join(base, 'cache'), env: {...process.env, PATH: bin + ':' + process.env.PATH, CAPTURE_PATH: capture, XDG_CACHE_HOME: join(base, 'cache')}};
}
test('all host commands reuse the common private socket and keep strict key verification', t => {
  const f = fixture(t);
  for (const command of ['true', 'python3 /opt/waitron-disposable/host.py inspect']) {
    const result = spawnSync('bash', [script, '2.29.248.230', command], {env: f.env, encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    const args = JSON.parse(readFileSync(f.capture));
    for (const option of ['ControlMaster=auto', 'ControlPersist=600', 'StrictHostKeyChecking=yes', 'BatchMode=yes', 'ConnectTimeout=8']) assert.ok(args.includes(option), option);
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
  const outside = join(f.base, 'outside'); mkdirSync(outside);
  symlinkSync(outside, join(f.cache, 'wt-ssh'));
  const result = spawnSync('bash', [script, '2.29.248.230', 'true'], {env: f.env, encoding: 'utf8'});
  assert.notEqual(result.status, 0); assert.match(result.stderr, /private|linked/i);
  assert.equal(existsSync(f.capture), false);
});
