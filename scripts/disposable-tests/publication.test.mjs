import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync,chmodSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {LocalLeases} from './leases.mjs';
import {withKernelLock} from './kernel-lock.mjs';
import {ciRequest} from './ci-identity.mjs';
import {runProcess} from './transport.mjs';

async function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'disposable-publish-'));
 const remove=path=>{chmodSync(path,0o700);for(const entry of readdirSync(path,{withFileTypes:true}))if(entry.isDirectory())remove(join(path,entry.name));};
 t.after(()=>{remove(root);rmSync(root,{recursive:true,force:true});});
 const source=new URL('../../',import.meta.url).pathname;
 const python=execFileSync('python3',['-I','-c','import sys;print(sys.executable)'],{encoding:'utf8'}).trim();
 const ci={repository:'fixture/waitron',repositoryId:123,workflowId:456,workflowPath:'.github/workflows/ci.yml',workflowDigest:'a'.repeat(64),appEnv:root+'/app.env',appKey:root+'/app.key'};
 const old={version:2,mode:'manual-slots',slots:2,host:'old.invalid',hostGeneration:'old',recipe:'/opt/waitron-disposable-old',state:root+'/old-state',repository:source+'.git',ci};
 await withKernelLock(old.state,async()=>{new LocalLeases(old.state+'/ledger',{hostGeneration:'old',slots:2,bootstrap:true});},{bootstrap:true});
 for(const slot of [0,1])await withKernelLock(old.state+'/slot-'+slot,async()=>({code:0}),{bootstrap:true});
 const scoped=new LocalLeases(old.state+'/ledger',{hostGeneration:'old',slots:2,slot:0});
 const identity={repositoryId:123,workflowId:456,workflowPath:ci.workflowPath,workflowSha:'1'.repeat(40),workflowDigest:ci.workflowDigest,event:'pull_request',sourceSha:'1'.repeat(40),sourceTree:'2'.repeat(40),runId:789,attempt:1,jobId:901,jobKey:'test-ui-1'};
 const lease=scoped.reserveLocal(ciRequest('I',identity)).lease;scoped.release(lease,{resourceId:lease.resourceId,absent:true});scoped.forgetRunner(scoped.inspect().orphanRunners[0]);
 const configuration={...old,state:root+'/new-state',hostGeneration:'new',host:'new.invalid',slotHosts:['new.invalid','bench.invalid']};
 const gitEnv=Object.fromEntries(Object.entries(process.env).filter(([name])=>!name.startsWith('GIT_')));
 const p={source,sha:execFileSync('git',['rev-parse','HEAD'],{cwd:source,env:gitEnv,encoding:'utf8'}).trim(),node:process.execPath,python,
  configuration,oldController:source.slice(0,-1),oldConfiguration:root+'/old-config.json',newController:root+'/release',
  launchAgent:root+'/agent.plist',wrapper:root+'/run.sh',launchLabel:'gui/'+process.getuid()+'/fixture'};
 writeFileSync(p.oldConfiguration,JSON.stringify(old),{mode:0o600});
 const args=[python,'-I','-B',p.oldController+'/deploy/disposable-tests/mac-controller.py',process.execPath,p.oldConfiguration,'--once'];
 const xml=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;');
 writeFileSync(p.launchAgent,'<?xml version="1.0"?><plist version="1.0"><dict><key>ProgramArguments</key><array>'+args.map(arg=>'<string>'+xml(arg)+'</string>').join('')+'</array><key>ProcessType</key><string>Standard</string></dict></plist>',{mode:0o600});
 writeFileSync(p.wrapper,'#!/bin/sh\nexec '+args.slice(0,6).join(' ')+' "$@"\n',{mode:0o700});
 const api={get:async path=>{if(path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS'))return {value:'{}'};if(path.endsWith('/runs/789'))return {id:789,run_attempt:1,status:'in_progress'};assert.equal(path,'/repos/fixture/waitron/actions/jobs/901');return {id:901,run_id:789,run_attempt:1,status:'completed'};}};
 const transport={inspect:async received=>{assert.equal(received.resourceId,lease.resourceId);return {resourceId:lease.resourceId,absent:true};}};
 const execute=async(command,argv,options)=>command==='launchctl'?{code:0,stdout:argv[0]==='print'?readFileSync(p.launchAgent,'utf8'):''}:runProcess(command,argv,options);
 return {root,old,p,api,transport,execute};
}

test('a publisher CLI invoked through a path alias reports its missing manifest',async t=>{
 const f=await fixture(t);
 const alias=f.root+'/publish.mjs';symlinkSync(new URL('./publish.mjs',import.meta.url).pathname,alias);
 const result=spawnSync(process.execPath,[alias,f.root+'/missing.json'],{encoding:'utf8',timeout:5000});
 assert.equal(result.status,1);assert.match(result.stderr,/ENOENT/);assert.equal(result.stdout,'');
});

test('publisher functions remain importable from a stdin module program',()=>{
 const {status,stdout,stderr}=spawnSync(process.execPath,['--input-type=module','-'],{input:'await import('+JSON.stringify(new URL('./publish.mjs',import.meta.url).href)+');console.log("loaded");',encoding:'utf8',timeout:5000});
 assert.equal(status,0,stderr);assert.equal(stdout,'loaded\n');
});

test('publication refuses unfinished recorded jobs and uncertain guest absence before changing callers',async t=>{
 const f=await fixture(t),{withDrained}=await import('./publish.mjs');let called=false;
 const work=async()=>{called=true;return {code:0};};
 for(const changed of [{id:790},{run_attempt:0}])
  await assert.rejects(withDrained({configuration:f.old,api:{get:async(path,options)=>path.endsWith('/runs/789')?{id:789,run_attempt:1,status:'completed',...changed}:f.api.get(path,options)},transport:f.transport},work),/identity/i);
 for(const changed of [{id:902},{run_id:790},{run_attempt:2}])
  await assert.rejects(withDrained({configuration:f.old,api:{get:async(path,options)=>path.includes('/jobs/')?{id:901,run_id:789,run_attempt:1,status:'completed',...changed}:f.api.get(path,options)},transport:f.transport},work),/identity/i);
 await assert.rejects(withDrained({configuration:f.old,api:{get:async(path,options)=>path.endsWith('DISPOSABLE_TESTS_HOSTED_ATTEMPTS')?{value:'{"789":2}'}:f.api.get(path,options)},transport:f.transport},work),/Hosted movements/);
 await assert.rejects(withDrained({configuration:f.old,api:f.api,transport:{inspect:async()=>({resourceId:'dt-old-0-1',absent:false})}},work),/absence|absent/i);
 assert.equal(called,false);assert.equal(existsSync(f.old.state+'/manual.lock'),false);assert.equal(existsSync(f.p.newController),false);
});

test('drain waits for final GitHub status without holding the old admission locks',async t=>{
 const f=await fixture(t),{withDrained}=await import('./publish.mjs');let jobs=0,waits=0;
 const messages=[];t.mock.method(console,'error',message=>messages.push(message));
 const api={get:async(path,options)=>path.includes('/jobs/')?{id:901,run_id:789,run_attempt:1,status:++jobs===1?'in_progress':'completed'}:f.api.get(path,options)};
 const result=await withDrained({configuration:f.old,api,transport:f.transport,wait:async()=>{
  waits++;assert.equal((await withKernelLock(f.old.state+'/slot-0',async()=>({code:0}))).code,0);
 }},async()=>({code:0}));
 assert.equal(result.code,0);assert.equal(jobs,2);assert.equal(waits,1);assert.equal(messages.length,1);
});

test('drain groups completed run history and checks only the latest guest generation',async t=>{
 const f=await fixture(t),{withDrained}=await import('./publish.mjs');
 const leases=new LocalLeases(f.old.state+'/ledger',{hostGeneration:'old',slots:2,slot:0});
 for(let i=0;i<10;i++){
  const lease=leases.reserveLocal({lane:'I',turn:'ci-789-1-'+(902+i),snapshot:'a'.repeat(64),argv:['true']}).lease;
  leases.release(lease,{resourceId:lease.resourceId,absent:true});
 }
 const paths=[],resources=[];
 const api={get:async path=>{paths.push(path);return path.endsWith('/runs/789')?{id:789,run_attempt:1,status:'completed'}:{value:'{}'};}};
 await withDrained({configuration:f.old,api,transport:{inspect:async({resourceId})=>{resources.push(resourceId);return {resourceId,absent:true};}}},async()=>({code:0}));
 assert.deepEqual(paths,['/repos/fixture/waitron/actions/runs/789','/repos/fixture/waitron/actions/variables/DISPOSABLE_TESTS_HOSTED_ATTEMPTS']);
 assert.deepEqual(resources,['dt-old-0-11']);
});

test('a failed status-reader installation leaves the old service admitting work',async t=>{
 const f=await fixture(t),{publish}=await import('./publish.mjs');let bootouts=0;
 f.p.statusAdapter=f.root+'/missing/ci-status.py';
 const execute=async(command,argv,options)=>{if(command==='launchctl'&&argv[0]==='bootout')bootouts++;return f.execute(command,argv,options);};
 await assert.rejects(publish(f.p,{api:f.api,transport:f.transport,candidateTransport:{healthySlots:async()=>[0,1]},execute}),/Publication command failed/);
 assert.equal(bootouts,0);assert.equal(existsSync(f.old.state+'/manual.lock'),false);
});

test('publication rewrites manual command arguments once even when the new path contains the old root',async t=>{
 const f=await fixture(t),{publish}=await import('./publish.mjs');
 const original=f.p.oldController;f.p.oldController=f.root;
 for(const path of [f.p.launchAgent,f.p.wrapper])writeFileSync(path,readFileSync(path,'utf8').replaceAll(original,f.root));
 f.p.newController=f.root+'/release';
 writeFileSync(f.p.wrapper,readFileSync(f.p.wrapper,'utf8').replace('#!/bin/sh\n','#!/bin/sh\nlane=$1; checkout=$2; shift 2\n').replace(' \"$@\"',' \"$lane\" \"$checkout\" -- \"$@\"'));
 await publish(f.p,{api:f.api,transport:f.transport,candidateTransport:{healthySlots:async()=>[0,1]},execute:f.execute});
 const args=JSON.parse(execFileSync(f.p.python,['-I','-c','import shlex,sys,json;print(json.dumps(shlex.split(open(sys.argv[1]).read().splitlines()[-1])))',f.p.wrapper],{encoding:'utf8'}));
 assert.deepEqual(args,['exec',f.p.python,'-I','-B',f.p.newController+'/deploy/disposable-tests/mac-controller.py',process.execPath,f.p.newController+'/config.json','$lane','$checkout','--','$@']);
 const probe=f.root+'/argument-probe';writeFileSync(probe,'#!/usr/bin/env python3\nimport json,sys;print(json.dumps(sys.argv[1:]))\n',{mode:0o700});
 writeFileSync(f.p.wrapper,readFileSync(f.p.wrapper,'utf8').replace(f.p.python,probe));
 const received=JSON.parse(execFileSync('sh',[f.p.wrapper,'I','/fixture/checkout with spaces','exit','3'],{encoding:'utf8'}));
 assert.deepEqual(received,['-I','-B',f.p.newController+'/deploy/disposable-tests/mac-controller.py',process.execPath,f.p.newController+'/config.json','I','/fixture/checkout with spaces','--','exit','3']);
});

test('host preparation sends the reviewed pinned recipe to both destinations and reports either failure',async t=>{
 const f=await fixture(t),{prepareHosts}=await import('./publish.mjs');
 f.p.peerAddresses=['8.8.4.4','9.9.9.9'];
 for(const fail of [false,true]){
  const hosts=[];
  const operation=prepareHosts(f.p,{execute:async(command,argv,options)=>{
   assert.equal(command,'bash');hosts.push(argv[1]);
   const files=execFileSync('tar',['-tf','-'],{input:options.input,encoding:'utf8'}).split('\n');
   assert.ok(files.includes('deploy/disposable-tests/install-host.py'));
   assert.ok(files.includes('deploy/disposable-tests/host-packages.txt'));
   assert.ok(files.includes('scripts/disposable-tests/snapshot.py'));
   assert.ok(!files.some(name=>name.endsWith('app.key')||name.includes('node_modules')));
   return {code:fail&&argv[1]==='bench.invalid'?1:0};
  }});
  if(fail)await assert.rejects(operation,/installation/i);else assert.equal((await operation).prepared,2);
  assert.deepEqual(hosts.sort(),['bench.invalid','new.invalid']);
  assert.equal(existsSync(f.old.state+'/manual.lock'),false);
 }
});

test('a changed installed caller refuses publication before closing old admission',async t=>{
 const f=await fixture(t),{publish}=await import('./publish.mjs');
 writeFileSync(f.p.launchAgent,readFileSync(f.p.launchAgent,'utf8').replace(f.p.oldController+'/deploy/disposable-tests/mac-controller.py','/unrelated/controller.py'));
 await assert.rejects(publish(f.p,{api:f.api,transport:f.transport,candidateTransport:{healthySlots:async()=>[0,1]},execute:f.execute}),/Publication|caller|controller|agent/i);
 assert.equal(existsSync(f.old.state+'/manual.lock'),false);assert.equal(existsSync(f.p.configuration.state),false);
});

test('uncertain replacement guest absence keeps rollback admission closed without stopping its service',async t=>{
 const f=await fixture(t),{publish}=await import('./publish.mjs');let bootouts=0,failed=false;
 const execute=async(command,argv,options)=>{
  if(command==='launchctl'&&argv[0]==='bootout')bootouts++;
  if(command==='launchctl'&&argv[0]==='print'&&!failed){
   failed=true;const leases=new LocalLeases(f.p.configuration.state+'/ledger',{hostGeneration:'new',slots:2,slot:0});
   const lease=leases.reserveLocal({lane:'I',turn:'manual-new',snapshot:'a'.repeat(64),argv:['true']}).lease;
   leases.release(lease,{resourceId:lease.resourceId,absent:true});return {code:1,stdout:''};
  }
  return f.execute(command,argv,options);
 };
 await assert.rejects(publish(f.p,{api:f.api,transport:f.transport,execute,
  candidateTransport:{healthySlots:async()=>[0,1],inspect:async()=>({resourceId:'dt-new-0-1',absent:false})}}),/absence|closed/i);
 assert.equal(bootouts,1);assert.equal(existsSync(f.p.configuration.state+'/manual.lock'),true);
 assert.equal(existsSync(f.p.newController+'/rollback-config.json'),false);
});

for(const fail of [false,true])test(`publication uses fresh state and preserves a retired gate, including rollback: ${fail}`,async t=>{
 const f=await fixture(t),{publish}=await import('./publish.mjs');let failed=false;
 const execute=async(command,argv,options)=>{
  if(command==='launchctl'&&argv[0]==='bootstrap'&&fail&&!failed){failed=true;return {code:1,stdout:''};}
  return f.execute(command,argv,options);
 };
 const operation=publish(f.p,{api:f.api,transport:f.transport,candidateTransport:{healthySlots:async()=>[0,1]},execute});
 if(fail)await assert.rejects(operation,/rollback/i);else assert.equal((await operation).published,true);
 assert.equal(existsSync(f.old.state+'/manual.lock'),true);
 const text=readFileSync(f.p.launchAgent,'utf8');
 const configPath=fail?f.p.newController+'/rollback-config.json':f.p.newController+'/config.json';
 assert.ok(text.includes(configPath));assert.ok(readFileSync(f.p.wrapper,'utf8').includes(configPath));
 const config=JSON.parse(readFileSync(configPath,'utf8'));
 assert.notEqual(config.state,f.old.state);assert.notEqual(config.hostGeneration,'old');
 const ledger=JSON.parse(readFileSync(config.state+'/ledger/state.json','utf8'));
 assert.equal(ledger.hostGeneration,config.hostGeneration);assert.deepEqual(ledger.turns,{});
 assert.ok(ledger.slots.every(slot=>slot.state==='free'));
 assert.equal(config.host,fail?'old.invalid':'new.invalid');
 assert.ok(Object.keys(JSON.parse(readFileSync(f.old.state+'/ledger/state.json','utf8')).turns).includes('I:ci-789-1-901'));
});


test('server staging stays private and disabled until fresh-state activation',async t=>{
 const f=await fixture(t),installer=new URL('../../deploy/disposable-tests/install-controller.py',import.meta.url).pathname;
 const program=`import importlib.util,json,os,sys,uuid,subprocess
from pathlib import Path
spec=importlib.util.spec_from_file_location('installer',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
root=Path(sys.argv[2]);m.OPT=root/'opt';m.OPT.mkdir();m.ROOT=root/'controller';m.HOME=root/'home';m.HOME.mkdir();m.OWNER=os.getuid();m.UNITS=root/'units';m.UNITS.mkdir()
calls=[]
def command(argv,timeout=300):
 calls.append(argv)
 if '--bootstrap' in argv:subprocess.run(argv,check=True,stdout=subprocess.DEVNULL)
 if argv[0]=='ssh-keygen':
  key=Path(argv[argv.index('-f')+1]);key.write_text('private host identity');key.chmod(0o600);key.with_suffix('.pub').write_text('ssh-ed25519 fixture')
 return ''
m.command=command;m.NODE=sys.argv[3]
config=json.loads(sys.argv[4]);config['state']=str(m.ROOT/'states'/'first');config['ci'].update(appEnv=str(m.ROOT/'app.env'),appKey=str(m.ROOT/'app.key'))
plan={'release':str(m.OPT/'waitron-disposable-controller-first'),'configuration':config,'knownHosts':'fixture.invalid ssh-ed25519 fixture\\n'}
keydata=('private-'+uuid.uuid4().hex).encode();receipt=m.install(plan,b'private-app-identity',keydata)
release=Path(receipt['release']);assert (release/'scripts/disposable-tests/manual.mjs').is_file()
assert (m.ROOT/'app.key').read_bytes()==keydata
assert (m.ROOT/'app.key').stat().st_mode&0o777==0o600
assert not any(keydata in p.read_bytes() for p in release.rglob('*') if p.is_file())
assert not Path(config['state']).exists()
assert not any(argv[0]=='systemctl' for argv in calls)
assert not any(keydata.decode() in arg for argv in calls for arg in argv)
before=(release/'scripts/disposable-tests/manual.mjs').stat().st_mtime_ns;m.install(plan,b'private-app-identity',keydata);assert (release/'scripts/disposable-tests/manual.mjs').stat().st_mtime_ns==before
(m.ROOT/'app.key').chmod(0o644)
try:m.install(plan,b'private-app-identity',keydata);raise AssertionError('publicly readable credential accepted')
except ValueError:pass
(m.ROOT/'app.key').chmod(0o600)
m.activate(receipt)
ledger=json.loads((Path(config['state'])/'ledger/state.json').read_text());assert ledger['hostGeneration']=='new' and ledger['turns']=={}
boot=next(i for i,a in enumerate(calls) if '--bootstrap' in a);start=next(i for i,a in enumerate(calls) if a[:2]==['systemctl','start']);assert boot<start
try:m.activate(receipt);raise AssertionError('existing ledger reopened')
except ValueError:pass
print('private frozen staging; no active ledger or pickup until activation')`;
 const result=spawnSync(f.p.python,['-I','-B','-c',program,installer,f.root,process.execPath,JSON.stringify(f.p.configuration)],{encoding:'utf8',timeout:10000});
 assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/no active ledger or pickup/);
});

test('controller runtime verifies pinned packages and the Node archive before installation',async t=>{
 const f=await fixture(t),installer=new URL('../../deploy/disposable-tests/install-controller.py',import.meta.url).pathname;
 const program=`import importlib.util,json,os,sys,hashlib
from pathlib import Path
spec=importlib.util.spec_from_file_location('installer',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
root=Path(sys.argv[2]);m.NODE=str(root/'runtime/bin/node');m.NODE_ARCHIVE_SHA=hashlib.sha256(b'node archive fixture').hexdigest();bad=False;calls=[]
def command(argv,timeout=300):
 calls.append(argv)
 if argv[0]=='dpkg-query':return {'git':'1:2.47.3-0+deb13u1','python3':'3.13.5-1'}[argv[-1]]
 if argv[0]=='curl':Path(argv[-1]).write_bytes(b'bad' if bad else b'node archive fixture')
 if argv[0]=='tar':
  directory=Path(argv[argv.index('--directory')+1])/'node-v26.13.0-linux-x64/bin';directory.mkdir(parents=True);(directory/'node').write_text('verified fixture')
 if argv[0]==m.NODE:return 'v26.13.0\\n'
 return ''
m.command=command;bad=True
try:m.prepare_runtime();raise AssertionError('corrupt Node installed')
except ValueError:pass
assert not Path(m.NODE).exists();assert not any(a[0]=='tar' for a in calls)
bad=False;m.prepare_runtime();assert Path(m.NODE).read_text()=='verified fixture'
assert any('git=1:2.47.3-0+deb13u1' in a and 'python3=3.13.5-1' in a for a in calls)
print('pinned runtime verified')`;
 const result=spawnSync(f.p.python,['-I','-B','-c',program,installer,f.root],{encoding:'utf8',timeout:10000});
 assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/pinned runtime verified/);
});
