import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const script = new URL('../../deploy/disposable-tests/bootstrap-host.sh', import.meta.url).pathname;
const valid = ['qemu-system-x86=1:10.0.2-1', 'qemu-utils=1:10.0.2-1', 'cloud-image-utils=0.33-1', 'nftables=1.1.3-1'];
function plan(t, lines) {
  const dir = mkdtempSync(join(tmpdir(), 'disposable-bootstrap-'));
  t.after(() => rmSync(dir, {force: true, recursive: true}));
  const pins = join(dir, 'packages.txt');
  writeFileSync(pins, lines.join('\n') + '\n');
  return spawnSync('bash', [script, '--plan', pins], {encoding: 'utf8'});
}
test('bootstrap plans only the four explicitly versioned VM prerequisites', t => {
  const result = plan(t, valid);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n'), valid);
});
for (const lines of [valid.slice(1), [...valid, 'docker.io=1'], [...valid, valid[0]], valid.map(v => v.startsWith('qemu-utils=') ? 'qemu-utils' : v), valid.map(v => v.startsWith('qemu-utils=') ? 'qemu-utils=$(touch /tmp/forbidden)' : v)]) {
  test(`bootstrap refuses an incomplete, extra, duplicated or unversioned package set: ${JSON.stringify(lines)}`, t => {
    const result = plan(t, lines);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid.*pin/i);
    assert.equal(result.stdout, '');
  });
}
