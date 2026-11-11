import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const script = new URL('./private-packages.py', import.meta.url).pathname;

test('prebuilt tool checks verify every direct pin offline and reject a changed package or executable', t => {
 const root=mkdtempSync(join(tmpdir(),'guest-tool-check-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const [name,body] of Object.entries({
  'dpkg-query': 'printf "%s" "${2#*=}"',
  node: 'echo v26.13.0', pnpm: 'echo 9.15.0',
  docker: 'if [[ "$1" = compose ]]; then echo 2.26.1-4; else echo 26.1.5; fi',
  systemctl: 'echo "$*" >> "$ROOT/services"',
  'systemd-detect-virt': 'echo kvm', id: 'echo 0', uname: 'echo x86_64',
  'apt-get': 'echo forbidden-network-install >&2; exit 97',
  curl: 'echo forbidden-download >&2; exit 97',
  sha256sum: 'test "${BAD:-}" != digest',
  runuser: 'test "$1 $2 $3" = "-u runner --"; echo runner > "$ROOT/checked-user"; shift 3; exec "$@"',
 }))writeFileSync(join(root,name),'#!/bin/bash\n'+body+'\n',{mode:0o755});
 for(const file of ['guest-tools.sh','runner-tools.sh']){
  const source=readFileSync(new URL('../../deploy/disposable-tests/'+file,import.meta.url),'utf8');
  const block=source.match(/# BEGIN offline check\n([\s\S]*?)# END offline check/);
  assert.ok(block, file+' must expose its network-free pin checks');
  const pins=[...source.matchAll(/'([a-z][a-z0-9+.-]*=[^'\s]+)'/g)].map(m=>m[1]);
  assert.ok(pins.length>0);
  writeFileSync(join(root,'dpkg-query'),'#!/bin/bash\nfor pin in '+pins.map(p=>"'"+p+"'").join(' ')+'; do if [[ "$3" = "${pin%%=*}" ]]; then if [[ "${BAD:-}" = package ]]; then echo wrong; else printf "%s" "${pin#*=}"; fi; exit; fi; done\nexit 1\n',{mode:0o755});
  writeFileSync(join(root,'os-release'),'ID=debian\nVERSION_ID=13\n');
  writeFileSync(join(root,'instance-id'),'dt-check-0-1\n');
  let body=source.replaceAll('/etc/os-release',join(root,'os-release')).replaceAll('/var/lib/cloud/data/instance-id',join(root,'instance-id'));
  const run=bad=>spawnSync('bash',['-c',body,'tool-check','--check'],{encoding:'utf8',timeout:5000,env:{...process.env,PATH:root+':'+process.env.PATH,ROOT:root,BAD:bad}});
  if(file==='runner-tools.sh'){
   // Paths are fixed in the guest; the portable harness redirects only its executable/receipt reads.
   body=body.replaceAll('/opt/actions-runner/bin/Runner.Listener',join(root,'Runner.Listener')).replaceAll('/opt/waitron-tools/runner-version.txt',join(root,'runner-version.txt'));
   writeFileSync(join(root,'Runner.Listener'),'#!/bin/bash\necho 2.338.2\n',{mode:0o755});writeFileSync(join(root,'runner-version.txt'),'2.338.2\n');
  }
  let result=run('');assert.equal(result.status,0,result.stderr);
  result=run('package');assert.notEqual(result.status,0,file+' accepted a changed package');
  if(file==='guest-tools.sh'){
   writeFileSync(join(root,'node'),'#!/bin/bash\necho v26.0.0\n',{mode:0o755});
   result=run('');assert.notEqual(result.status,0,'a wrong Node version passed');writeFileSync(join(root,'node'),'#!/bin/bash\necho v26.13.0\n',{mode:0o755});
  }else{assert.ok(existsSync(join(root,'checked-user')),'runner version must use the runner account');assert.equal(readFileSync(join(root,'checked-user'),'utf8'),'runner\n');result=run('digest');assert.notEqual(result.status,0,'a changed runner passed');}
 }
});

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

test('a UI-only fetch does not depend on an unselected contract download',t=>{
 const root=mkdtempSync(join(tmpdir(),'disposable-selected-download-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const result=spawnSync('python3',['-I','-B','-c',`import base64,hashlib,importlib.util,io,pathlib,sys,urllib.error
s=importlib.util.spec_from_file_location('packages',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
m.subprocess.check_output=lambda *a,**k:'SYNTHETIC-NEVER-COPY'
body=b'reviewed UI fixture';ui='ui-core-0.2.1.tgz'
m.PACKAGES=[{**p,'integrity':'sha512-'+base64.b64encode(hashlib.sha512(body).digest()).decode()} for p in m.PACKAGES]
seen=[]
class Network:
 def open(self,request,**kwargs):
  seen.append(request.full_url)
  if '/contract/' in request.full_url:raise urllib.error.HTTPError(request.full_url,403,'Forbidden',{},None)
  return io.BytesIO(body)
m.urllib.request.build_opener=lambda *a:Network()
target=pathlib.Path(sys.argv[2])/'ui'
m.fetch(target,[ui])
assert sorted(p.name for p in target.iterdir())==['manifest.json',ui]
assert len(seen)==1 and '/ui-core/0.2.1/' in seen[0]
seen.clear();target=pathlib.Path(sys.argv[2])/'both'
try:m.fetch(target,[ui,'contract-0.2.9.tgz'])
except urllib.error.HTTPError:pass
else:raise AssertionError('selected contract failure ignored')
assert not target.exists() and len(seen)==2
seen.clear();target=pathlib.Path(sys.argv[2])/'unknown'
try:m.fetch(target,['unreviewed.tgz'])
except ValueError:pass
else:raise AssertionError('unreviewed filename accepted')
assert not target.exists() and seen==[]
`,script,root],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
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

// Package bytes sent to a guest must match the immutable captured checkout.
test('package selection reads the captured lockfile and refuses unknown or mixed private releases',t=>{
 const root=mkdtempSync(join(tmpdir(),'disposable-private-selection-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const current=readFileSync(new URL('../../pnpm-lock.yaml',import.meta.url),'utf8');
 const contract='\n  resolution: {integrity: sha512-L69COV7C5WiqiuyVGfICKwnK0irYLClis8AKCtDnIJtTiOByROrnu8rnbc2YFCFwQ98MdGr5BPeyW9Wk2VRY3g==, tarball: https://npm.pkg.github.com/download/@waitron-io/contract/0.2.9/9a5a01d89bf30a5df255f2c22ca0116d99da5508}\n';
 assert.ok(current.includes(contract.trim()));
 const uiOnly=current.replace(contract.trim(),'');
 const legacy=uiOnly.replaceAll('ui-core@0.2.1','ui-core@0.1.0').replaceAll('/ui-core/0.2.1/04b5f4e9e2d872e3b1e955211bc64290beb28f58','/ui-core/0.1.0/d2467965338838c9162336c791083d10d56522c9').replaceAll('SzF5SF/NXCVkOwVIS9XLcVr1vQ6EOF14QHqqXs4QXRwG9dWdp3HBY1JTubRA8+Ygpx0z9Y8M0RE37Dliduy59w==','MzgeKuubpLe6LPEL1M6hZgWDuNSBeyQNVGnzw/J29UwKeZ/6nTKD8k/H1nrSMeOx95C/3f34eNYQtbMM8P+2ng==');
 for(const [id,lock,want] of [['both',current+contract,['ui-core-0.2.1.tgz','contract-0.2.9.tgz']],['contract-only',contract,null],['unknown-contract',current+contract.replace('/contract/0.2.9/','/contract/9.9.9/'),null],['current',current,['ui-core-0.2.1.tgz','contract-0.2.9.tgz']],['ui-only',uiOnly,['ui-core-0.2.1.tgz']],['legacy',legacy,['ui-core-0.1.0.tgz']],['unknown',current.replaceAll('/ui-core/0.2.1/','/ui-core/9.9.9/'),null],['mixed',legacy+'\n'+current,null],['missing','lockfileVersion: 9.0\n',null]]){
  const snapshot=join(root,id+'.tar');const make=spawnSync('python3',['-I','-B','-c',`import io,sys,tarfile
with tarfile.open(sys.argv[1],'w',format=tarfile.USTAR_FORMAT) as archive:
 data=sys.stdin.buffer.read();member=tarfile.TarInfo('pnpm-lock.yaml');member.size=len(data);archive.addfile(member,io.BytesIO(data))`,snapshot],{input:lock,encoding:'utf8'});
  assert.equal(make.status,0,make.stderr);
  const result=spawnSync('python3',['-I','-B',script,'select',snapshot],{encoding:'utf8',timeout:5000});
  if(want){assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),want);}
  else{assert.notEqual(result.status,0);assert.match(result.stderr,/lock|approved|private|release/i);assert.equal(result.stdout,'');}
 }
});

function toolDownload(t, sequence, budget=60, pause=0) {
  const root=mkdtempSync(join(tmpdir(),'guest-download-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  writeFileSync(join(root,'curl'), `#!/bin/bash
n=0; test ! -f "$ROOT/count" || read -r n < "$ROOT/count"
n=$((n+1)); echo "$n" > "$ROOT/count"
echo "$*" >> "$ROOT/args"
IFS=, read -ra answers <<< "$SEQUENCE"
IFS=: read -r status code <<< "\${answers[$((n-1))]:-22:503}"
output=; report=false
while (($#)); do
 case "$1" in -o) output=$2; shift;; --write-out) report=true; shift;; esac
 shift
done
printf '%s' "$n" >> "$output"
if [[ "$PAUSE" != 0 ]]; then /bin/sleep "$PAUSE"; fi
$report && printf '%s' "$code"
if ((status)); then echo 'SECRET provider-body https://private.example/?signature=SECRET' >&2; fi
exit "$status"
`, {mode:0o755});
  writeFileSync(join(root,'sleep'),`#!/bin/bash
printf '%s\\n' "$*" >> "$ROOT/sleeps"
`,{mode:0o755});
  const source=readFileSync(new URL('../../deploy/disposable-tests/guest-tools.sh',import.meta.url),'utf8');
  const fn=source.match(/# BEGIN bounded download\n([\s\S]*?)# END bounded download/);
  const command=fn ? fn[1]+'\ndownload Node "$BUDGET" 134217728 https://nodejs.org/tool "$ROOT/node.tar.xz"' : source.match(/curl --fail[\s\S]*?-o "\$temporary\/node.tar.xz"/)[0];
  const result=spawnSync('bash',['-c','set -euo pipefail\ntemporary="$ROOT"\n'+command],{
    encoding:'utf8',timeout:5000,env:{...process.env,PATH:root+':'+process.env.PATH,ROOT:root,SEQUENCE:sequence,BUDGET:String(budget),PAUSE:String(pause)},
  });
  return {...result,root};
}

test('guest tool downloads recover from a brief 503 without leaking the response',t=>{
 const result=toolDownload(t,'22:503,0:200');
 assert.equal(result.status,0,result.stderr);
 assert.equal(readFileSync(join(result.root,'count'),'utf8').trim(),'2');
 assert.equal(readFileSync(join(result.root,'node.tar.xz'),'utf8'),'2');
 assert.equal(result.stderr,'');
});

for(const code of [6,7,18,28,52,55,56])test(`guest downloads retry network exit ${code}`,t=>{
 const result=toolDownload(t,`${code}:000,0:200`);assert.equal(result.status,0,result.stderr);
 assert.equal(readFileSync(join(result.root,'count'),'utf8').trim(),'2');assert.equal(result.stderr,'');
});
for(const [code,http] of [[22,600],[0,404],[22,401],[22,404],[22,408],[22,429],[6,404],[35,'000'],[60,'000'],[63,'000']])test(`guest downloads refuse curl ${code} HTTP ${http} immediately`,t=>{
 const result=toolDownload(t,`${code}:${http},0:200`);assert.notEqual(result.status,0);
 assert.equal(readFileSync(join(result.root,'count'),'utf8').trim(),'1');
 assert.match(result.stderr,/Node download failed/);assert.match(result.stderr,new RegExp(`curl ${code}`));
 assert.doesNotMatch(result.stderr,/SECRET|https:/);
});
test('guest downloads stop after three failed attempts',t=>{
 const result=toolDownload(t,'22:503,22:502,22:504,0:200');assert.notEqual(result.status,0);
 assert.equal(readFileSync(join(result.root,'count'),'utf8').trim(),'3');
 assert.deepEqual(readFileSync(join(result.root,'sleeps'),'utf8').trim().split('\n'),['1','1']);
 assert.match(result.stderr,/Node download failed.*curl 22.*HTTP 504/);assert.doesNotMatch(result.stderr,/SECRET|https:/);
});
test('a zero download budget makes no curl request',t=>{
 const result=toolDownload(t,'0:200',0);assert.notEqual(result.status,0);
 assert.match(result.stderr,/Node download failed.*budget exhausted/);
 assert.throws(()=>readFileSync(join(result.root,'count')),{code:'ENOENT'});
});
test('the remaining budget is passed as a positive curl timeout and pins stay in both scripts',t=>{
 const result=toolDownload(t,'22:503,0:200');assert.equal(result.status,0,result.stderr);
 for(const line of readFileSync(join(result.root,'args'),'utf8').trim().split('\n')){
  assert.match(line,/--max-time [1-9][0-9]*/);assert.match(line,/--connect-timeout 10/);
  assert.match(line,/--proto =https --proto-redir =https/);assert.match(line,/--max-filesize 134217728/);
 }
 const sources=['guest-tools.sh','runner-tools.sh'].map(name=>readFileSync(new URL('../../deploy/disposable-tests/'+name,import.meta.url),'utf8'));
 const sections=sources.map(source=>source.match(/# BEGIN bounded download\n([\s\S]*?)# END bounded download/)[1]);assert.equal(sections[0],sections[1]);
 for(const [source,tool,budget,size,url] of [[sources[0],'Node',60,134217728,'https://nodejs.org/dist/v26.13.0/node-v26.13.0-linux-x64.tar.xz'],[sources[0],'pnpm',30,33554432,'https://registry.npmjs.org/pnpm/-/pnpm-9.15.0.tgz'],[sources[1],'Actions-runner',120,268435456,'https://github.com/actions/runner/releases/download/v2.338.2/actions-runner-linux-x64-2.338.2.tar.gz']])assert.ok(source.includes(`download ${tool} ${budget} ${size} ${url}`));
});


test('an attempt that spends its budget makes no retry',t=>{
 const result=toolDownload(t,'28:000,0:200',1,1);assert.notEqual(result.status,0);
 assert.equal(readFileSync(join(result.root,'count'),'utf8').trim(),'1');
 assert.match(result.stderr,/Node download failed.*budget exhausted/);
 assert.throws(()=>readFileSync(join(result.root,'sleeps')),{code:'ENOENT'});
});
test('corrupt Node, pnpm and runner bytes fail with the tool named before extraction',t=>{
 const root=mkdtempSync(join(tmpdir(),'guest-integrity-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const checksumPath=process.platform==='darwin'?'/opt/homebrew/opt/coreutils/libexec/gnubin:/usr/local/opt/coreutils/libexec/gnubin:'+process.env.PATH:process.env.PATH;
 writeFileSync(join(root,'known-bytes'),'abc');
 const good=spawnSync('bash',['-c',`printf '%s  %s\\n' ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad "$ROOT/known-bytes" | sha256sum --check --status`],{encoding:'utf8',timeout:5000,env:{...process.env,PATH:checksumPath,ROOT:root}});
 assert.equal(good.status,0,good.stderr);
 for(const [script,file,message] of [['guest-tools.sh','node.tar.xz',/Node integrity mismatch/],['guest-tools.sh','pnpm.tgz',/pnpm integrity mismatch/],['runner-tools.sh','runner.tgz',/Actions runner integrity mismatch/]]){
  writeFileSync(join(root,file),'corrupt');
  const source=readFileSync(new URL('../../deploy/disposable-tests/'+script,import.meta.url),'utf8');
  const check=file==='pnpm.tgz' ? source.match(/python3 - "\$temporary\/pnpm.tgz" <<'PY'\n[\s\S]*?\nPY/)[0] : source.split('\n').find(line=>line.startsWith('printf ') && line.includes(file));
  const result=spawnSync('bash',['-c','set -euo pipefail\ntemporary="$ROOT"\n'+check],{encoding:'utf8',timeout:5000,env:{...process.env,PATH:checksumPath,ROOT:root}});
  assert.notEqual(result.status,0);assert.match(result.stderr,message);
  const extraction=source.split('\n').find(line=>line.startsWith('tar --extract') && line.includes(file));assert.ok(extraction);
  assert.ok(source.indexOf(check)<source.indexOf(extraction));
 }
});

for (const [file,tool,budget,output] of [
 ['guest-tools.sh','Node','60','node.tar.xz'],
 ['guest-tools.sh','pnpm','30','pnpm.tgz'],
 ['runner-tools.sh','Actions-runner','120','runner.tgz'],
]) test(`the real ${tool} download call passes five shell arguments`,()=>{
 const source=readFileSync(new URL('../../deploy/disposable-tests/'+file,import.meta.url),'utf8');
 const call=source.split('\n').find(line=>line.startsWith('download '+tool+' '));
 assert.ok(call);
 const result=spawnSync('bash',['-c',`temporary=/tmp/fixture-tools
download() { printf '%s\\0' "$@"; }
${call}
`],{encoding:'utf8',timeout:5000});
 assert.equal(result.status,0,result.stderr);
 const args=result.stdout.split('\0');args.pop();
 assert.equal(args.length,5);assert.equal(args[0],tool);assert.equal(args[1],budget);
 assert.equal(args[4],'/tmp/fixture-tools/'+output);
});

for(const code of [2,127])test(`an empty HTTP report retains numeric diagnostics for curl ${code}`,t=>{
 const result=toolDownload(t,`${code}:`);assert.notEqual(result.status,0);
 assert.match(result.stderr,new RegExp(`curl ${code} HTTP 000\\)`));
});

test('retry curl timeouts share the original two-second budget',{timeout:5000},async t=>{
 // Keep both requests away from Bash's whole-second boundary in this short fixture.
 while(Date.now()%1000>100)await new Promise(resolve=>setTimeout(resolve,5));
 const result=toolDownload(t,'22:503,0:200',2,1.05);assert.equal(result.status,0,result.stderr);
 const timeouts=readFileSync(join(result.root,'args'),'utf8').trim().split('\n').map(line=>Number(line.match(/--max-time (\d+)/)[1]));
 assert.deepEqual(timeouts,[2,1]);
});
