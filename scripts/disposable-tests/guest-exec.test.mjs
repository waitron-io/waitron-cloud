import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
const script = new URL('../../deploy/disposable-tests/guest-exec.py', import.meta.url).pathname;
function fixture(t) {
  const directory=mkdtempSync(join(tmpdir(),'disposable-exec-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  return directory;
}
function run(directory,request) {
  return spawnSync('python3',['-B','-c',`import importlib.util,json,sys
s=importlib.util.spec_from_file_location('executor',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
sys.exit(m.execute(json.loads(sys.argv[3]),sys.argv[2]))`,script,directory,JSON.stringify(request)],{encoding:'utf8',timeout:10000});
}

// Turning argv into a shell string changes quoting and can execute extra commands.
test('the guest executes literal arguments in the source directory and preserves exit3',t=>{
  const directory=fixture(t);
  const request={argv:[process.execPath,'-e',`require('fs').writeFileSync('output',process.argv[1]);process.stdout.write('case-complete\\n');process.exit(3)`, 'meal; $(false) with spaces'],deadline:Date.now()+5000};
  const result=run(directory,request);
  assert.equal(result.status,3,result.stderr);
  assert.equal(result.stdout,'case-complete\n');
  assert.equal(readFileSync(join(directory,'output'),'utf8'),'meal; $(false) with spaces');
});

// Ignoring the absolute deadline would run an expired command or leave a timed-out child alive.
test('expired, overlong and malformed requests cannot start a candidate',t=>{
  const directory=fixture(t);
  const argv=[process.execPath,'-e',"require('fs').writeFileSync('started','unexpected')"];
  for(const request of [{argv,deadline:Date.now()-1},{argv,deadline:Date.now()+3600000},{argv,deadline:'later'},{argv,deadline:Date.now()+5000,shell:true}]) {
    const result=run(directory,request);
    assert.notEqual(result.status,0);
  }
  assert.throws(()=>readFileSync(join(directory,'started')),/ENOENT/);
});

test('a deadline terminates the command and prevents its later side effects',t=>{
  const directory=fixture(t);
  const started=performance.now();
  const result=run(directory,{argv:[process.execPath,'-e',"setTimeout(()=>require('fs').writeFileSync('late','unexpected'),1000)"],deadline:Date.now()+250});
  assert.equal(result.status,124,result.stderr);
  assert.ok(performance.now()-started<3500);
  assert.throws(()=>readFileSync(join(directory,'late')),/ENOENT/);
});


// A dead controller must not leave its command or the command's children running.
test('cancellation terminates the owned process group and reports143',async t=>{
  const directory=fixture(t);
  const request={argv:[process.execPath,'-e',"process.on('SIGTERM',()=>{});process.stdout.write('started\\n');setTimeout(()=>require('fs').writeFileSync('late','unexpected'),3500)"],deadline:Date.now()+5000};
  const child=spawn('python3',['-B','-c',`import importlib.util,json,sys
s=importlib.util.spec_from_file_location('executor',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
sys.exit(m.execute(json.loads(sys.argv[3]),sys.argv[2]))`,script,directory,JSON.stringify(request)],{stdio:['ignore','pipe','pipe']});
  t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
  const closed=once(child,'close');
  await Promise.race([once(child.stdout,'data'),closed.then(()=>assert.fail('executor ended before command readiness'))]);
  child.kill('SIGTERM');
  const [code,signal]=await closed;
  assert.equal(code,143);
  assert.equal(signal,null);
  await delay(1600);
  assert.throws(()=>readFileSync(join(directory,'late')),/ENOENT/);
});

// The command entry point must refuse accidental execution on the controller or VM host.
test('the guest entry point refuses an unbound turn before reading a command',()=>{
  const result=spawnSync('python3',[script],{input:JSON.stringify({argv:['false'],deadline:Date.now()+5000}),encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/disposable guest/i);
});

// A valid nonzero slot must reach request validation; an unbound or invalid slot must not.
test('the guest entry binds nonzero slots to its actual cloud-init identity',()=>{
 const program=`import pathlib,runpy,sys
original=pathlib.Path
class Identity:
 def is_file(self):return True
 def read_text(self):return sys.argv[3]
pathlib.Path=lambda value:Identity() if str(value)=='/var/lib/cloud/data/instance-id' else original(value)
script,resource,bound=sys.argv[1:];sys.argv=[script,resource,'--ci']
# Retain the bound string after replacing the CLI vector.
Identity.read_text=lambda self:bound
runpy.run_path(script,run_name='__main__')`;
 for(const [resource,bound,want] of [['dt-fixture-5-1','dt-fixture-5-1',/Invalid CI credential input/],['dt-fixture-15-1','dt-fixture-15-1',/Invalid CI credential input/],['dt-fixture-16-1','dt-fixture-16-1',/requires a disposable guest/],['dt-fixture-5-1','dt-fixture-4-1',/requires a disposable guest/]]){
  const result=spawnSync('python3',['-B','-c',program,script,resource,bound],{input:'{}',encoding:'utf8',timeout:5000});
  assert.equal(result.status,125,result.stderr);assert.match(result.stderr,want);
 }
});
