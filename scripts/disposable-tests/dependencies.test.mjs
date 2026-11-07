import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const script = new URL('./private-packages.py', import.meta.url).pathname;

// An integrity bypass would allow changed package bytes into the guest store.
test('private package bytes must match the complete pinned SHA512 before consumption', t => {
  const root = mkdtempSync(join(tmpdir(), 'disposable-dependency-'));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  const file = join(root, 'ui.tgz');
  const bytes = Buffer.from('shared-ui-package');
  const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
  writeFileSync(file, bytes);
  const verify = value => spawnSync('python3', [script, 'verify', file, value], {encoding:'utf8'});
  const good = verify(integrity);
  assert.equal(good.status, 0, good.stderr);
  writeFileSync(file, 'changed-package');
  const changed = verify(integrity);
  assert.notEqual(changed.status, 0);
  assert.match(changed.stderr, /integrity mismatch/i);
  for (const invalid of ['', 'sha1-AA==', integrity+' extra', 'sha512-AA==']) {
    const bad = verify(invalid);
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /invalid.*integrity/i);
  }
});

// Candidate-provided URLs must not turn the Mac's package token into a general downloader.
test('the authenticated adapter refuses a caller-selected URL or credential', () => {
  for (const args of [['fetch', '/tmp/unused', 'https://outside.example/pkg'], ['fetch', '/tmp/unused', '--token=NEVER-SEND']]) {
    const result = spawnSync('python3', [script, ...args], {encoding:'utf8'});
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /usage/i);
    assert.equal(result.stdout, '');
  }
});

// GitHub's signed blob redirect must lose workstation headers and stay on its exact HTTPS origin.
test('package redirects strip authentication and refuse other destinations', () => {
  const result = spawnSync('python3', ['-B','-c', `import importlib.util,sys,urllib.request
spec=importlib.util.spec_from_file_location('packages',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
r=urllib.request.Request('https://npm.pkg.github.com/download/package',headers={'Authorization':'Bearer NEVER-FORWARD','Cookie':'private'})
h=m.RefuseRedirect()
allowed=h.redirect_request(r,None,302,'Found',{},'https://pkg-npm.githubusercontent.com/blob?signature=temporary')
assert allowed.full_url=='https://pkg-npm.githubusercontent.com/blob?signature=temporary'
assert allowed.get_header('Authorization') is None
assert allowed.get_header('Cookie') is None
for url in ['http://pkg-npm.githubusercontent.com/blob','https://outside.example/blob','https://pkg-npm.githubusercontent.com.outside.example/blob','https://user@pkg-npm.githubusercontent.com/blob','https://pkg-npm.githubusercontent.com:444/blob']:
 try:h.redirect_request(r,None,302,'Found',{},url)
 except ValueError:pass
 else:raise AssertionError('unapproved credential redirect accepted')
`, script], {encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr);
});

// A changed pin cannot send workstation authentication to an arbitrary host.
test('unapproved pins and corrupt downloads leave no published package directory',t=>{
  const root=mkdtempSync(join(tmpdir(),'disposable-dependency-failure-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const result=spawnSync('python3',['-B','-c',`import importlib.util,io,pathlib,sys
s=importlib.util.spec_from_file_location('packages',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
m.subprocess.check_output=lambda *a,**k:'NEVER-COPY'
class NoNetwork:
 def open(self,*a,**k):raise AssertionError('unapproved URL reached network')
m.urllib.request.build_opener=lambda *a:NoNetwork()
original=m.PACKAGES
for i,url in enumerate(['https://outside.example/package','http://npm.pkg.github.com/download/@waitron-io/ui-core/0.1.0/'+'a'*40,'https://user@npm.pkg.github.com/download/@waitron-io/ui-core/0.1.0/'+'a'*40]):
 m.PACKAGES=[{**original[0],'url':url}];target=pathlib.Path(sys.argv[2])/str(i)
 try:m.fetch(target)
 except ValueError as e:assert 'origin' in str(e)
 else:raise AssertionError('unapproved pin accepted')
 assert not target.exists()
class CorruptNetwork:
 def open(self,*a,**k):return io.BytesIO(b'corrupt-package')
m.PACKAGES=original;m.urllib.request.build_opener=lambda *a:CorruptNetwork()
target=pathlib.Path(sys.argv[2])/'corrupt'
try:m.fetch(target)
except ValueError as e:assert 'integrity mismatch' in str(e)
else:raise AssertionError('corrupt package published')
assert not target.exists()
`,script,root],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout,'');
});

// An updated workspace must still install in a guest without workstation credentials.
test('the guest package preparation covers every private tarball in the workspace lockfile', () => {
  const result = spawnSync('python3', ['-B', '-c', `import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('packages',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
print(json.dumps(m.PACKAGES))
`, script], {encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const prepared = JSON.parse(result.stdout);
  const lock = readFileSync(new URL('../../pnpm-lock.yaml', import.meta.url), 'utf8');
  const privatePins = [...lock.matchAll(/resolution: \{integrity: (sha512-[^,}]+), tarball: (https:\/\/npm\.pkg\.github\.com\/[^}]+)\}/g)];
  assert.ok(privatePins.length > 0, 'the private consumer pins must be checked');
  for (const [, integrity, url] of privatePins) {
    const pin = prepared.find(package_ => package_.url === url);
    assert.ok(pin, 'guest preparation is missing the locked private release: ' + url);
    assert.equal(pin.integrity, integrity, 'guest bytes must match the locked release');
  }
});

// The single package sent to a guest must match the immutable captured checkout.
test('package selection reads the captured lockfile and refuses unknown or mixed private releases',t=>{
 const root=mkdtempSync(join(tmpdir(),'disposable-private-selection-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const current=readFileSync(new URL('../../pnpm-lock.yaml',import.meta.url),'utf8');
 const legacy=current.replaceAll('ui-core@0.2.1','ui-core@0.1.0').replaceAll('/ui-core/0.2.1/04b5f4e9e2d872e3b1e955211bc64290beb28f58','/ui-core/0.1.0/d2467965338838c9162336c791083d10d56522c9').replaceAll('SzF5SF/NXCVkOwVIS9XLcVr1vQ6EOF14QHqqXs4QXRwG9dWdp3HBY1JTubRA8+Ygpx0z9Y8M0RE37Dliduy59w==','MzgeKuubpLe6LPEL1M6hZgWDuNSBeyQNVGnzw/J29UwKeZ/6nTKD8k/H1nrSMeOx95C/3f34eNYQtbMM8P+2ng==');
 for(const [id,lock,want] of [['current',current,'ui-core-0.2.1.tgz'],['legacy',legacy,'ui-core-0.1.0.tgz'],['unknown',current.replaceAll('/ui-core/0.2.1/','/ui-core/9.9.9/'),null],['mixed',legacy+'\n'+current,null],['missing','lockfileVersion: 9.0\n',null]]){
  const snapshot=join(root,id+'.tar');const make=spawnSync('python3',['-I','-B','-c',`import io,sys,tarfile
with tarfile.open(sys.argv[1],'w',format=tarfile.USTAR_FORMAT) as archive:
 data=sys.stdin.buffer.read();member=tarfile.TarInfo('pnpm-lock.yaml');member.size=len(data);archive.addfile(member,io.BytesIO(data))`,snapshot],{input:lock,encoding:'utf8'});
  assert.equal(make.status,0,make.stderr);
  const result=spawnSync('python3',['-I','-B',script,'select',snapshot],{encoding:'utf8',timeout:5000});
  if(want){assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),want);}
  else{assert.notEqual(result.status,0);assert.match(result.stderr,/lock|approved|private|release/i);assert.equal(result.stdout,'');}
 }
});
