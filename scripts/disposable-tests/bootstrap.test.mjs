import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, writeFileSync, rmSync, existsSync, chmodSync} from 'node:fs';
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

test('host installation freezes the reviewed recipe and refuses active or changed installations', t => {
 const root=mkdtempSync(join(tmpdir(),'disposable-install-'));t.after(()=>{
  const frozen=join(root,'opt/waitron-disposable-fixture');if(existsSync(frozen))chmodSync(frozen,0o700);
  rmSync(root,{recursive:true,force:true});
 });
 const installer=new URL('../../deploy/disposable-tests/install-host.py',import.meta.url).pathname;
 const program=`import importlib.util,json,os,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('installer',sys.argv[1]);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
root=Path(sys.argv[2]);module.OPT=root/'opt';module.OPT.mkdir();module.STATE=root/'state';module.STATE.mkdir();module.UNIT=root/'startup.service';module.OWNER=os.getuid()
calls=[];metadata=False
def command(argv,timeout=600):
 global metadata
 calls.append(argv)
 if '--metadata' in argv:metadata=True
 if '--install' in argv:
  assert metadata,'Pinned install ran without package metadata';metadata=False
module.command=command
recipe=module.OPT/'waitron-disposable-fixture'
plan=module.installation(str(recipe),['8.8.4.4','9.9.9.9']);module.install(plan)
assert (recipe/'host.py').read_bytes()==(module.SOURCE/'host.py').read_bytes()
assert (recipe/'snapshot.py').read_bytes()==(module.SOURCE.parent.parent/'scripts/disposable-tests/snapshot.py').read_bytes()
assert json.loads((recipe/'peer-addresses.json').read_text())==['8.8.4.4','9.9.9.9']
assert any(argv[:2]==['systemctl','enable'] for argv in calls)
assert str(recipe)+'/startup.py' in module.UNIT.read_text()
before={str(p):p.stat().st_mtime_ns for p in recipe.iterdir()};module.install(plan)
assert before=={str(p):p.stat().st_mtime_ns for p in recipe.iterdir()}
calls.clear();(module.STATE/'active-6.json').write_text('{}')
try:module.install(plan);raise AssertionError('active guest admitted')
except ValueError:pass
assert calls==[];(module.STATE/'active-6.json').unlink()
unit=module.UNIT.read_text();module.UNIT.unlink();outside=root/'unrelated.service';outside.write_text(unit);module.UNIT.symlink_to(outside)
try:module.install(plan);raise AssertionError('linked service accepted')
except ValueError:pass
assert calls==[];module.UNIT.unlink();module.UNIT.write_text(unit)
(recipe/'host.py').chmod(0o600);(recipe/'host.py').write_text('changed')
try:module.install(plan);raise AssertionError('changed recipe accepted')
except ValueError:pass
assert calls==[]
print('installation and refusals verified')`;
 const result=spawnSync('python3',['-I','-B','-c',program,installer,root],{encoding:'utf8',timeout:10000});
 assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/installation and refusals verified/);
});
