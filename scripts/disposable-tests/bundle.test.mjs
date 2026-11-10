import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, rmSync, writeFileSync, symlinkSync, mkdirSync, readFileSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

test('the controller bundle contains only the exact request, snapshot and private package bytes', t => {
  const dir = mkdtempSync(join(tmpdir(), 'disposable-bundle-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const source = join(dir, 'source.tar'), pkg = join(dir, 'ui-core-0.2.1.tgz'), output = join(dir, 'bundle.tar');
  writeFileSync(source, 'candidate source'); writeFileSync(pkg, 'verified package bytes');
  const request = {resourceId: 'dt-bundle-0-1', snapshot: createHash('sha256').update('candidate source').digest('hex'), argv: ['node', '-e', 'process.exit(3)'], deadline: Date.now()+600000};
  const script = new URL('./bundle.py', import.meta.url).pathname;
  const result = spawnSync('python3', ['-B', '-c', `import importlib.util,json,pathlib,sys,tarfile
s=importlib.util.spec_from_file_location('bundle',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
m.create(sys.argv[2],sys.argv[4],[sys.argv[3]],json.loads(sys.argv[5]))
with tarfile.open(sys.argv[4],'r:') as a:
 assert a.getnames()==['request.json','source.tar','ui.tgz']
 assert json.load(a.extractfile('request.json'))==json.loads(sys.argv[5])
 assert a.extractfile('source.tar').read()==b'candidate source'
 assert a.extractfile('ui.tgz').read()==b'verified package bytes'
`, script, source, pkg, output, JSON.stringify(request)], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('a changed snapshot or linked input never publishes a controller bundle', t => {
  const dir = mkdtempSync(join(tmpdir(), 'disposable-bundle-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const source = join(dir, 'source.tar'), pkg = join(dir, 'ui-core-0.2.1.tgz'), output = join(dir, 'bundle.tar');
  writeFileSync(source, 'changed'); writeFileSync(pkg, 'package');
  const script = new URL('./bundle.py', import.meta.url).pathname;
  const request = {snapshot: 'a'.repeat(64)};
  const run = () => spawnSync('python3', ['-I', '-B', script, source, output, pkg], {input: JSON.stringify(request), encoding: 'utf8'});
  assert.notEqual(run().status, 0);
  symlinkSync(source, join(dir, 'linked'));
  const linked = spawnSync('python3', ['-I', '-B', script, join(dir, 'linked'), output, pkg], {input: JSON.stringify({snapshot: createHash('sha256').update('changed').digest('hex')}), encoding: 'utf8'});
  assert.notEqual(linked.status, 0);
  const verify = spawnSync('python3', ['-c', 'import pathlib,sys;assert not pathlib.Path(sys.argv[1]).exists()', output]);
  assert.equal(verify.status, 0);
});

test('a received manual bundle leaves only the extracted inputs',t=>{
 const root=mkdtempSync(join(tmpdir(),'disposable-bundle-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 writeFileSync(root+'/source','source');writeFileSync(root+'/ui-core-0.2.1.tgz','package');writeFileSync(root+'/contract-0.2.9.tgz','contract');mkdirSync(root+'/received');
 const script=new URL('./bundle.py',import.meta.url).pathname,request={snapshot:createHash('sha256').update('source').digest('hex'),argv:['false']};
 const created=spawnSync('python3',['-I','-B',script,root+'/source',root+'/packet',root+'/ui-core-0.2.1.tgz',root+'/contract-0.2.9.tgz'],{input:JSON.stringify(request)});assert.equal(created.status,0,created.stderr.toString());
 const bytes=readFileSync(root+'/packet'),result=spawnSync('python3',['-I','-B',script,'--receive',root+'/received'],{input:Buffer.concat([Buffer.from(bytes.length+'\n'),bytes]),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),request);assert.deepEqual(readdirSync(root+'/received').sort(),['contract-0.2.9.tgz','request.json','source.tar','ui.tgz']);
 assert.equal(readFileSync(root+'/received/contract-0.2.9.tgz','utf8'),'contract');
});


test('bundle construction refuses unreviewed, duplicate or missing private archives',t=>{
 const root=mkdtempSync(join(tmpdir(),'disposable-bundle-inputs-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const script=new URL('./bundle.py',import.meta.url).pathname;
 const result=spawnSync('python3',['-I','-B','-c',`import hashlib,importlib.util,pathlib,sys
s=importlib.util.spec_from_file_location('bundle',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
root=pathlib.Path(sys.argv[2]);source=root/'source';source.write_bytes(b'source')
ui=root/'ui-core-0.2.1.tgz';ui.write_bytes(b'UI');unknown=root/'unreviewed.tgz';unknown.write_bytes(b'unknown')
for files in [[unknown],[ui,ui],[]]:
 output=root/'bundle.tar'
 try:m.create(source,output,files,{'snapshot':hashlib.sha256(b'source').hexdigest()})
 except ValueError:pass
 else:raise AssertionError('unsafe package inputs accepted: '+str(files))
 assert not output.exists()
`,script,root],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
});

test('a signing-only manual upload is refused before admission',t=>{
 const root=mkdtempSync(join(tmpdir(),'disposable-no-ui-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const script=new URL('./bundle.py',import.meta.url).pathname;
 writeFileSync(root+'/source','source');writeFileSync(root+'/contract-0.2.9.tgz','contract');mkdirSync(root+'/received');
 const created=spawnSync('python3',['-I','-B',script,root+'/source',root+'/packet',root+'/contract-0.2.9.tgz'],{input:JSON.stringify({snapshot:createHash('sha256').update('source').digest('hex'),argv:['false']})});assert.equal(created.status,0,created.stderr.toString());
 const bytes=readFileSync(root+'/packet');
 const result=spawnSync('python3',['-I','-B',script,'--receive',root+'/received'],{input:Buffer.concat([Buffer.from(bytes.length+'\n'),bytes]),encoding:'utf8'});
 assert.equal(result.status,125);assert.match(result.stderr,/Incomplete manual upload/);
});
