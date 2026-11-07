import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync,rmSync,symlinkSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync,spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {LocalLeases} from './leases.mjs';
const script=new URL('./manual.mjs',import.meta.url).pathname;
function fixture(t,mode='normal') {
 const root=mkdtempSync(join(tmpdir(),'disposable-pipeline-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const name of ['bin','tmp','repo','state'])mkdirSync(join(root,name),{mode:0o700});
 execFileSync('git',['init','-q',join(root,'repo')]);
 const config=join(root,'config.json');
 writeFileSync(config,JSON.stringify({version:2,mode:'manual-one-slot',host:'fixture.invalid',hostGeneration:'fixture',recipe:'/opt/waitron-disposable-fixture',repository:join(root,'repo/.git'),state:join(root,'state')}));
 const python=execFileSync('python3',['-I','-c','import sys;print(sys.executable)'],{encoding:'utf8'}).trim();
 writeFileSync(join(root,'bin/python3'),`#!${python}
import sys,os,json,hashlib,time
from pathlib import Path
args=sys.argv[1:];root=Path(os.environ['FIXTURE_ROOT']);mode=os.environ['FIXTURE_MODE']
if any(a.endswith('/snapshot.py') for a in args):
 (root/'packaged').touch()
 if mode=='snapshot-budget':time.sleep(0.15);sys.exit(9)
 if mode=='snapshot-failure':sys.exit(9)
 data=b'opaque source fixture';Path(args[-1]).write_bytes(data);print(json.dumps({'sha256':hashlib.sha256(data).hexdigest()}))
elif any(a.endswith('/private-packages.py') for a in args):
 if args[-2]=='select':print(os.environ.get('PRIVATE_SELECTED','ui-core-0.2.1.tgz'));sys.exit(0)
 p=Path(args[-1]);p.mkdir();(p/os.environ.get('PRIVATE_SELECTED','ui-core-0.2.1.tgz')).write_bytes(b'private fixture')
 if mode=='packaging':(root/'packaging.pid').write_text(str(os.getpid()));(root/'packaging-ready').touch();time.sleep(60)
 print('{}')
else:os.execv(${JSON.stringify(python)},[${JSON.stringify(python)},*args])
`,{mode:0o700});
 writeFileSync(join(root,'bin/ssh'),`#!${python}
import sys,os,json,time
from pathlib import Path
root=Path(os.environ['FIXTURE_ROOT']);parts=sys.argv[-1].split();mode=parts[-1] if parts[-1]=='health' else parts[-2];rid=parts[-1]
with (root/'calls').open('a') as f:f.write(mode+'\\n')
if mode=='health':
 if os.environ['FIXTURE_MODE']=='unreachable':
  import signal
  signal.signal(signal.SIGTERM,signal.SIG_IGN);(root/'health.pid').write_text(str(os.getpid()));time.sleep(60)
 print(json.dumps({'healthy':os.environ['FIXTURE_MODE']!='unhealthy'}))
elif mode=='transfer':sys.stdin.buffer.read();(root/rid).touch();print('{}')
elif mode=='prepare':
 if os.environ['FIXTURE_MODE']=='work':(root/'work.pid').write_text(str(os.getpid()));print('WORK-READY',flush=True);time.sleep(60)
 if os.environ['FIXTURE_MODE']=='concurrency':
  (root/'work-ready').touch()
  while not (root/'release').exists():time.sleep(.02)
elif mode in ('execute','execute-v2'):pass
elif mode=='result':print(json.dumps({'resourceId':rid,'code':3}))
elif mode=='destroy':
 if os.environ['FIXTURE_MODE']=='recovery-cancel':(root/'destroy-ready').touch();time.sleep(5)
 (root/rid).unlink(missing_ok=True);print(json.dumps({'resourceId':rid,'absent':True}))
elif mode=='inspect':
 if os.environ['FIXTURE_MODE']=='stuck-cleanup':
  stuck=root/'state/tmp/stuck';stuck.mkdir(mode=0o700,exist_ok=True);(stuck/'orphan').write_text('private')
 print(json.dumps({'resourceId':rid,'absent':not(root/rid).exists()}))
else:sys.exit(125)
`,{mode:0o700});
 const env={...process.env,PATH:join(root,'bin')+':'+process.env.PATH,FIXTURE_ROOT:root,FIXTURE_MODE:mode,TMPDIR:join(root,'tmp'),XDG_CACHE_HOME:join(root,'cache')};
 writeFileSync(join(root,'state/mac-controller.lock'),'',{mode:0o600});
 new LocalLeases(join(root,'state/ledger'),{hostGeneration:'fixture',slots:1,bootstrap:true});
 writeFileSync(join(root,'tmp/global-sentinel'),'unrelated');
 return {root,env,args:[script,config,'I',join(root,'repo'),'--','false'],config};
}
function run(f){return spawnSync(process.execPath,f.args,{env:f.env,encoding:'utf8',timeout:10000});}
function assertNoTemporaries(f){
 const temporary=join(f.root,'state/tmp');
 assert.deepEqual(existsSync(temporary)?readdirSync(temporary):[],[]);
 assert.deepEqual(readdirSync(join(f.root,'tmp')).filter(name=>name.startsWith('disposable-') && name!=='disposable-unrelated'),[]);
 assert.equal(readFileSync(join(f.root,'tmp/global-sentinel'),'utf8'),'unrelated');
}

function assertControllerReleased(f){
 assert.equal(existsSync(join(f.root,'state/mac-controller.lock')),true);
 assert.equal(JSON.parse(readFileSync(join(f.root,'state/ledger/state.json'),'utf8')).slots[0].state,'free');
 const result=spawnSync(process.execPath,[script,f.config,'--once'],{env:f.env,encoding:'utf8',timeout:5000});
 assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(result.stdout,'');
}

test('background recovery removes only private interrupted temporary data and preserves global files',t=>{
 const f=fixture(t);const temporary=join(f.root,'state/tmp');mkdirSync(temporary,{mode:0o700});
 writeFileSync(join(temporary,'orphan-source'),'private source');
 const ledgerTemporary=join(f.root,'state/ledger/state-11111111-1111-4111-8111-111111111111.tmp');
 writeFileSync(ledgerTemporary,'uncommitted',{mode:0o600});
 writeFileSync(join(f.root,'tmp/disposable-unrelated'),'foreign');
 const result=spawnSync(process.execPath,[script,f.config,'--once'],{env:f.env,encoding:'utf8',timeout:5000});
 assert.equal(result.status,0,result.stdout+result.stderr);
 assert.equal(existsSync(join(temporary,'orphan-source')),false);
 assert.equal(existsSync(ledgerTemporary),false);
 assert.equal(readFileSync(join(f.root,'tmp/disposable-unrelated'),'utf8'),'foreign');
 assertNoTemporaries(f);
});

test('only explicit bootstrap creates fresh controller state and never reopens an existing path',t=>{
 const f=fixture(t);rmSync(join(f.root,'state'),{recursive:true});
 const ordinary=run(f);assert.equal(ordinary.status,125,ordinary.stdout+ordinary.stderr);
 assert.equal(existsSync(join(f.root,'state')),false);
 const boot=spawnSync(process.execPath,[script,f.config,'--bootstrap'],{env:f.env,encoding:'utf8',timeout:5000});
 assert.equal(boot.status,0,boot.stdout+boot.stderr);
 const before=readFileSync(join(f.root,'state/ledger/state.json'),'utf8');
 const again=spawnSync(process.execPath,[script,f.config,'--bootstrap'],{env:f.env,encoding:'utf8',timeout:5000});
 assert.equal(again.status,125);assert.equal(readFileSync(join(f.root,'state/ledger/state.json'),'utf8'),before);
 assert.equal(existsSync(join(f.root,'calls')),false);assert.equal(existsSync(join(f.root,'packaged')),false);
 assert.equal(JSON.parse(before).hostGeneration,'fixture');
 assert.equal(run(f).status,3);assertNoTemporaries(f);
});

test('manual CLI preserves a verified nonzero result and removes all owned preparation data',t=>{
 const f=fixture(t);const r=run(f);assert.equal(r.status,3,r.stdout+r.stderr);assert.match(r.stdout,/"code":3/);assert.match(r.stdout,/"cleanup":"absent"/);assertNoTemporaries(f);assertControllerReleased(f);
});
test('an occupied recorded lease refuses before packaging or host contact',t=>{
 const f=fixture(t);const leases=new LocalLeases(join(f.root,'state/ledger'),{hostGeneration:'fixture',slots:1});
 leases.reserveLocal({lane:'I',turn:'held',snapshot:'a'.repeat(64),argv:['false']});
 const r=run(f);assert.equal(r.status,75,r.stdout+r.stderr);assert.equal(existsSync(join(f.root,'packaged')),false);assert.equal(existsSync(join(f.root,'calls')),false);
});
test('an unhealthy host refuses before snapshot and private package preparation',t=>{
 const f=fixture(t,'unhealthy');const r=run(f);assert.equal(r.status,75,r.stdout+r.stderr);assert.equal(existsSync(join(f.root,'packaged')),false);assertNoTemporaries(f);
});
test('a failed snapshot leaves no admitted work or owned temporary data',t=>{
 const f=fixture(t,'snapshot-failure');const r=run(f);assert.equal(r.status,125,r.stdout+r.stderr);assertNoTemporaries(f);assertControllerReleased(f);
});
for(const signal of ['SIGTERM','SIGINT','SIGHUP'])test(`${signal} during packaging returns143 and cleans its private data`,async t=>{
 const f=fixture(t,'packaging');const child=spawn(process.execPath,f.args,{env:f.env,stdio:['ignore','pipe','pipe']});
 const closed=once(child,'close');let output='';child.stderr.on('data',()=>{});
 child.stdout.on('data',data=>output+=data.toString());
 try {
 const end=performance.now()+10000;
 while(!existsSync(join(f.root,'packaging-ready'))&&child.exitCode===null&&child.signalCode===null&&performance.now()<end)await delay(10);
 assert.equal(existsSync(join(f.root,'packaging-ready')),true,'No real packaging readiness: '+output);
 if(signal==='SIGTERM'){
  const sources=readdirSync(join(f.root,'state/tmp')).filter(name=>name.startsWith('disposable-manual-'));
  assert.equal(sources.length,1);assert.equal(existsSync(join(f.root,'state/tmp',sources[0],'source.tar')),true);
  assert.deepEqual(readdirSync(join(f.root,'tmp')).filter(name=>name.startsWith('disposable-')),[]);
 }
  child.kill(signal);const [code]=await closed;assert.equal(code,143,output);assert.match(output,/"code":143/);assertNoTemporaries(f);assertControllerReleased(f);
 } finally {
  if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
  if(existsSync(join(f.root,'packaging.pid'))){try{process.kill(-Number(readFileSync(join(f.root,'packaging.pid'),'utf8')),'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}}
  await closed;
 }
});


test('background recovery releases only a killed CLI turn before a successor',async t=>{
 const f=fixture(t,'work');const child=spawn(process.execPath,f.args,{env:f.env,stdio:['ignore','pipe','pipe']});const closed=once(child,'close');let output='';child.stderr.on('data',()=>{});
 const ready=new Promise(resolve=>child.stdout.on('data',data=>{output+=data.toString();if(output.includes('WORK-READY'))resolve();}));
 try {
  await Promise.race([ready,closed.then(()=>assert.fail('Work never started: '+output))]);
  child.kill('SIGKILL');await closed;
  process.kill(Number(readFileSync(join(f.root,'work.pid'),'utf8')),0);
  const busy=run({...f,env:{...f.env,FIXTURE_MODE:'normal'}});assert.equal(busy.status,75,busy.stdout+busy.stderr);
  const ledger=JSON.parse(readFileSync(join(f.root,'state/ledger/state.json'),'utf8'));const resource=ledger.slots[0].lease.resourceId;
  const recovered=spawnSync(process.execPath,[script,f.config,'--once'],{env:{...f.env,FIXTURE_MODE:'unhealthy'},encoding:'utf8',timeout:10000});
  assert.equal(recovered.status,0,recovered.stdout+recovered.stderr);assert.match(recovered.stdout,/"cleanup":"absent"/);
  assert.equal(JSON.parse(readFileSync(join(f.root,'state/ledger/state.json'),'utf8')).slots[0].state,'free');
  assert.equal(run({...f,env:{...f.env,FIXTURE_MODE:'normal'}}).status,3);
  assertNoTemporaries(f);
 } finally {
  if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
  if(existsSync(join(f.root,'work.pid'))){try{process.kill(-Number(readFileSync(join(f.root,'work.pid'),'utf8')),'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}}
  await closed;
 }
});

test('closing both terminal pipes and sending SIGHUP still finishes exact cleanup',async t=>{
 const f=fixture(t,'work');const child=spawn(process.execPath,f.args,{env:f.env,stdio:['ignore','pipe','pipe']});const closed=once(child,'close');let output='';child.stderr.on('data',()=>{});
 const ready=new Promise(resolve=>child.stdout.on('data',data=>{output+=data.toString();if(output.includes('WORK-READY'))resolve();}));
 try {
  await Promise.race([ready,closed.then(()=>assert.fail('Work never started: '+output))]);child.stdout.destroy();child.stderr.destroy();child.kill('SIGHUP');
  const [code]=await closed;assert.equal(code,143);assert.equal(JSON.parse(readFileSync(join(f.root,'state/ledger/state.json'),'utf8')).slots[0].state,'free');assertNoTemporaries(f);assertControllerReleased(f);
 } finally {
  if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
  if(existsSync(join(f.root,'work.pid'))){try{process.kill(-Number(readFileSync(join(f.root,'work.pid'),'utf8')),'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}}
  await closed;
 }
});

test('a legacy configuration is refused before selecting source or contacting a host',t=>{
 const f=fixture(t);const config=JSON.parse(readFileSync(f.config,'utf8'));config.version=1;writeFileSync(f.config,JSON.stringify(config));const result=run(f);
 assert.equal(result.status,125,result.stdout+result.stderr);assert.equal(existsSync(join(f.root,'packaged')),false);assert.equal(existsSync(join(f.root,'calls')),false);
});

const macWrapper = new URL('../../deploy/disposable-tests/mac-controller.py', import.meta.url).pathname;
function runMac(f, args = f.args.slice(2)) {
 return spawnSync('python3', ['-I', '-B', macWrapper, process.execPath, f.config, ...args], {env:f.env, encoding:'utf8', timeout:10000});
}

test('the OS-locked Mac entry point preserves the real command status and exact cleanup', t => {
 const f = fixture(t);
 const result = runMac(f);
 assert.equal(result.status, 3, result.stdout + result.stderr);
 assert.equal(JSON.parse(readFileSync(join(f.root, 'state/ledger/state.json'), 'utf8')).slots[0].state, 'free');
 assertNoTemporaries(f);
});

test('foreground refuses an interrupted turn until background recovery permits a clean successor', async t => {
 const f=fixture(t,'work');
 const child=spawn(process.execPath,f.args,{env:f.env,stdio:['ignore','pipe','pipe']});
 const closed=once(child,'close');let output='';child.stderr.on('data',()=>{});
 try {
  const ready=new Promise(resolve=>child.stdout.on('data',data=>{output+=data;if(output.includes('WORK-READY'))resolve();}));
  await Promise.race([ready,closed.then(()=>assert.fail('No interrupted work readiness: '+output))]);
  child.kill('SIGKILL');await closed;
  const before=JSON.parse(readFileSync(join(f.root,'state/ledger/state.json'),'utf8')).slots[0].lease;
  assert.equal(runMac({...f,env:{...f.env,FIXTURE_MODE:'normal'}}).status,75);
  const recovery=runMac({...f,env:{...f.env,FIXTURE_MODE:'unhealthy'}},['--once']);
  assert.equal(recovery.status,0,recovery.stdout+recovery.stderr);
  const successor=runMac({...f,env:{...f.env,FIXTURE_MODE:'normal'}});
  assert.equal(successor.status,3,successor.stdout+successor.stderr);
  assert.equal(existsSync(join(f.root,before.resourceId)),false);
  const after=JSON.parse(readFileSync(join(f.root,'state/ledger/state.json'),'utf8')).slots[0];
  assert.equal(after.state,'free');assert.equal(after.generation,before.generation+1);
 } finally {
  if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
  if(existsSync(join(f.root,'work.pid'))){try{process.kill(-Number(readFileSync(join(f.root,'work.pid'),'utf8')),'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}}
  await closed;
 }
});

test('direct background recovery takes its own controller lock',t=>{
 const f=fixture(t);const result=spawnSync(process.execPath,[script,f.config,'--once'],{env:f.env,encoding:'utf8',timeout:5000});
 assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(existsSync(join(f.root,'calls')),false);
 assert.equal(result.stdout,'');
});

test('the Mac entry point resolves a relative checkout before entering its safe working directory',t=>{
 const f=fixture(t);
 const result=spawnSync('python3',['-I','-B',macWrapper,process.execPath,f.config,'I','.','--','false'],{
  cwd:join(f.root,'repo'),env:f.env,encoding:'utf8',timeout:10000});
 assert.equal(result.status,3,result.stdout+result.stderr);
});

test('a foreign inherited descriptor cannot replace the controller lock',async t=>{
 const f=fixture(t);const {openSync,closeSync}=await import('node:fs');
 const {withKernelLock}=await import('./kernel-lock.mjs');
 const foreign=join(f.root,'foreign-lock');writeFileSync(foreign,'foreign',{mode:0o600});const fd=openSync(foreign,'r+');
 try {
  await withKernelLock(join(f.root,'state'),async()=>{
   const result=spawnSync(process.execPath,[script,f.config,'--once'],{
    env:f.env,stdio:['ignore','pipe','pipe',fd],encoding:'utf8',timeout:5000});
   assert.equal(result.status,75,result.stdout+result.stderr);return {code:0};
  });
  assert.equal(readFileSync(foreign,'utf8'),'foreign');
 } finally {closeSync(fd);}
});

test('a substituted python3 on PATH cannot bypass a live controller lock',async t=>{
 const f=fixture(t);const {withKernelLock}=await import('./kernel-lock.mjs');
 const leases=new LocalLeases(join(f.root,'state/ledger'),{hostGeneration:'fixture',slots:1});
 const lease=leases.reserveLocal({lane:'I',turn:'held',snapshot:'a'.repeat(64),argv:['false']}).lease;
 leases.start(lease);const guest=join(f.root,lease.resourceId);writeFileSync(guest,'guest');
 writeFileSync(join(f.root,'bin/python3'),'#!/bin/sh\nexit 0\n',{mode:0o700});
 await withKernelLock(join(f.root,'state'),async()=>{
  const result=spawnSync(process.execPath,[script,f.config,'--once'],{env:f.env,encoding:'utf8',timeout:5000});
  assert.equal(result.status,75,result.stdout+result.stderr);
  assert.match(result.stdout,/"code":75/);
  assert.equal(existsSync(guest),true);assert.equal(leases.inspect().slots[0].state,'running');
  return {code:0};
 });
});


test('initial git and health share the sub-ten-second refusal budget',{concurrency:true},async t=>{
 await Promise.all(['slow-git','slow-health'].map(mode=>t.test(mode,{timeout:15000},async sub=>{
  const f=fixture(sub,mode==='slow-health'?'unreachable':'normal');
  const python=execFileSync('python3',['-I','-c','import sys;print(sys.executable)'],{encoding:'utf8'}).trim();
  const git=execFileSync('python3',['-I','-c','import shutil;print(shutil.which("git"))'],{encoding:'utf8'}).trim();
  writeFileSync(join(f.root,'bin/git'),`#!${python}
import os,sys,time,signal
from pathlib import Path
Path(${JSON.stringify(join(f.root,'git.pid'))}).write_text(str(os.getpid()))
if ${JSON.stringify(mode)}=='slow-git':
 signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(60)
else:
 time.sleep(3);os.execv(${JSON.stringify(git)},[${JSON.stringify(git)},*sys.argv[1:]])
`,{mode:0o700});
  const start=performance.now();const child=spawn(process.execPath,f.args,{env:f.env,stdio:['ignore','pipe','pipe']});
  const closed=once(child,'close');let stdout='',stderr='';
  child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
  const stop=()=>child.kill('SIGTERM');sub.signal.addEventListener('abort',stop,{once:true});
  let status;try{[status]=await closed;}finally{sub.signal.removeEventListener('abort',stop);}
  const result={status,stdout,stderr};const elapsed=performance.now()-start;
  assert.equal(result.status,75,result.stdout+result.stderr);
  assert.match(result.stdout,/"code":75/);
  assert.ok(elapsed<10000,`Admission took ${elapsed}ms`);
  assert.equal(existsSync(join(f.root,'packaged')),false);
  assert.equal(JSON.parse(readFileSync(join(f.root,'state/ledger/state.json'),'utf8')).slots[0].state,'free');
  assertNoTemporaries(f);
 })));
});

test('an expired admission clock cannot turn a later packaging error into busy',t=>{
 const f=fixture(t,'snapshot-budget');
 const program=`import {existsSync} from 'node:fs';import {main} from ${JSON.stringify(new URL('./manual.mjs',import.meta.url).href)};
 const expiry=new AbortController();const original=AbortSignal.timeout;let first=true;
 AbortSignal.timeout=ms=>{if(first){first=false;return expiry.signal;}return original.call(AbortSignal,ms);};
 const timer=setInterval(()=>{if(existsSync(${JSON.stringify(join(f.root,'packaged'))})){expiry.abort();clearInterval(timer);}},5);
 try{process.exitCode=await main(${JSON.stringify(f.args.slice(1))});}catch(error){console.error(error.message);process.exitCode=125;}finally{clearInterval(timer);}`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',program],{env:f.env,encoding:'utf8',timeout:5000});
 assert.equal(result.status,125,result.stdout+result.stderr);assert.match(result.stderr,/Source snapshot failed/);assertNoTemporaries(f);
});


test('eight real entry points admit one turn and refuse seven before packaging',async t=>{
 const f=fixture(t,'concurrency');
 const outcomes=[];
 const children=Array.from({length:8},()=>{
  const child=spawn(process.execPath,f.args,{env:f.env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  child.stdout.pause();child.once('exit',()=>child.stdout.resume());
  child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
  const closed=once(child,'close').then(([code,signal])=>{
   assert.equal(signal,null,stderr);const receipt=JSON.parse(stdout.trim().split('\n').at(-1));
   const result={code,receipt};outcomes.push(result);return result;
  });
  return {child,closed};
 });
 try {
  const end=performance.now()+10000;
  while((outcomes.length<7 || !existsSync(join(f.root,'work-ready'))) && performance.now()<end)await delay(10);
  assert.equal(outcomes.length,7);assert.equal(outcomes.filter(r=>r.code===75).length,7);
  const held=JSON.parse(readFileSync(join(f.root,'state/ledger/state.json'),'utf8'));
  assert.equal(held.slots.filter(slot=>slot.state!=='free').length,1);
  writeFileSync(join(f.root,'release'),'finish');
  const results=await Promise.all(children.map(c=>c.closed));
  assert.equal(results.filter(r=>r.code===3).length,1);assert.equal(results.filter(r=>r.code===75).length,7);
  assert.equal(results.find(r=>r.code===3).receipt.cleanup,'absent');
  const after=JSON.parse(readFileSync(join(f.root,'state/ledger/state.json'),'utf8'));
  assert.equal(after.slots[0].state,'free');assert.equal(after.slots[0].generation,1);assert.equal(Object.keys(after.turns).length,1);
  assertNoTemporaries(f);
 } finally {
  for(const {child} of children)if(child.exitCode===null && child.signalCode===null)child.kill('SIGTERM');
  await Promise.allSettled(children.map(c=>c.closed));
 }
});


for(const unsafe of ['linked-state','public-state','linked-lock','public-lock','directory-lock','relative-state'])test(`real Node refuses ${unsafe} before preparation or host contact`,t=>{
 const f=fixture(t);const state=join(f.root,'state');const config=JSON.parse(readFileSync(f.config,'utf8'));
 if(unsafe==='linked-state'){symlinkSync(state,join(f.root,'linked'));config.state=join(f.root,'linked');}
 if(unsafe==='public-state')chmodSync(state,0o755);
 if(unsafe==='linked-lock'){rmSync(join(state,'mac-controller.lock'));writeFileSync(join(f.root,'foreign'),'foreign',{mode:0o600});symlinkSync(join(f.root,'foreign'),join(state,'mac-controller.lock'));}
 if(unsafe==='public-lock')chmodSync(join(state,'mac-controller.lock'),0o644);
 if(unsafe==='directory-lock'){rmSync(join(state,'mac-controller.lock'));mkdirSync(join(state,'mac-controller.lock'));}
 if(unsafe==='relative-state')config.state='relative';
 writeFileSync(f.config,JSON.stringify(config));const result=spawnSync(process.execPath,f.args,{cwd:f.root,env:f.env,encoding:'utf8',timeout:5000});
 assert.equal(result.status,125,result.stdout+result.stderr);assert.equal(existsSync(join(f.root,'calls')),false);assert.equal(existsSync(join(f.root,'packaged')),false);
 if(unsafe==='linked-lock')assert.equal(readFileSync(join(f.root,'foreign'),'utf8'),'foreign');
 assert.equal(existsSync(join(f.root,'relative')),false);
});

for(const invalid of [[],{state:37}])test(`real Node refuses invalid configuration ${JSON.stringify(invalid)} without a traceback`,t=>{
 const f=fixture(t);writeFileSync(f.config,JSON.stringify(invalid));const result=runMac(f,['--once']);
 assert.equal(result.status,125,result.stderr);assert.doesNotMatch(result.stderr,/Traceback/);assert.equal(existsSync(join(f.root,'calls')),false);
});

for(const damage of ['missing','corrupt'])test(`ordinary and background calls refuse a ${damage} ledger without initializing it`,t=>{
 const f=fixture(t);const path=join(f.root,'state/ledger/state.json');
 if(damage==='missing')rmSync(path);else writeFileSync(path,'corrupt');
 for(const args of [f.args,[script,f.config,'--once'],[script,f.config,'--bootstrap']]){
  const result=spawnSync(process.execPath,args,{env:f.env,encoding:'utf8',timeout:5000});
  assert.equal(result.status,125,result.stdout+result.stderr);
  assert.equal(existsSync(path),damage==='corrupt');if(damage==='corrupt')assert.equal(readFileSync(path,'utf8'),'corrupt');
 }
 assert.equal(existsSync(join(f.root,'calls')),false);assert.equal(existsSync(join(f.root,'packaged')),false);
});

for(const damage of ['missing-turns','null-turns','array-turns','linked-state-file','public-state-file'])test(`malformed ledger ${damage} refuses before source or host work`,t=>{
 const f=fixture(t);const path=join(f.root,'state/ledger/state.json');
 const ledger=JSON.parse(readFileSync(path,'utf8'));
 if(damage==='missing-turns')delete ledger.turns;
 if(damage==='null-turns')ledger.turns=null;
 if(damage==='array-turns')ledger.turns=[];
 writeFileSync(path,JSON.stringify(ledger),{mode:0o600});
 if(damage==='public-state-file')chmodSync(path,0o644);
 const target=join(f.root,'linked-ledger');
 if(damage==='linked-state-file'){writeFileSync(target,readFileSync(path),{mode:0o600});rmSync(path);symlinkSync(target,path);}
 const before=readFileSync(path,'utf8');
 for(const args of [f.args,[script,f.config,'--once']]){
  const result=spawnSync(process.execPath,args,{env:f.env,encoding:'utf8',timeout:5000});
  assert.equal(result.status,125,result.stdout+result.stderr);
  assert.equal(existsSync(join(f.root,'calls')),false);assert.equal(existsSync(join(f.root,'packaged')),false);
  assert.equal(readFileSync(path,'utf8'),before);
 }
 if(damage==='linked-state-file')assert.equal(readFileSync(target,'utf8'),before);
});

for(const gate of ['manual.lock','recovery.lock','ledger/lock'])test(`the CLI refuses legacy ${gate} before cleaning any unexpected state`,t=>{
 const f=fixture(t);mkdirSync(join(f.root,'state',gate),{mode:0o700});
 const temporary=join(f.root,'state/tmp');mkdirSync(temporary,{mode:0o700});writeFileSync(join(temporary,'retained'),'keep');
 for(const args of [f.args,[script,f.config,'--once']]){
  const result=spawnSync(process.execPath,args,{env:f.env,encoding:'utf8',timeout:5000});
  assert.equal(result.status,125,result.stdout+result.stderr);assert.match(result.stderr,/Legacy gate/);
  assert.equal(readFileSync(join(temporary,'retained'),'utf8'),'keep');assert.equal(existsSync(join(f.root,'state',gate)),true);
 }
 assert.equal(existsSync(join(f.root,'calls')),false);
});

test('the exec launcher runs from root without the four runtime injection variables',t=>{
 const f=fixture(t);const node=join(f.root,'node');
 const python=execFileSync('python3',['-I','-c','import sys;print(sys.executable)'],{encoding:'utf8'}).trim();
 writeFileSync(node,`#!/bin/sh\nprintf '%s|%s|%s|%s|%s' "$PWD" "\${NODE_OPTIONS-absent}" "\${NODE_PATH-absent}" "\${PYTHONPATH-absent}" "\${PYTHONHOME-absent}" > '${f.root}/context'\n`,{mode:0o700});
 const result=spawnSync(python,['-I','-B',macWrapper,node,f.config,'--once'],{
  cwd:f.root,env:{...f.env,NODE_OPTIONS:'candidate-options',NODE_PATH:'candidate-node',PYTHONPATH:'candidate-python',PYTHONHOME:'candidate-home'},encoding:'utf8',timeout:5000});
 assert.equal(result.status,0,result.stderr);assert.equal(readFileSync(join(f.root,'context'),'utf8'),'/|absent|absent|absent|absent');
});

test('the rendered agent recovers with only its declared HOME and PATH',t=>{
 const f=fixture(t);const leases=new LocalLeases(join(f.root,'state/ledger'),{hostGeneration:'fixture',slots:1});
 const lease=leases.reserveLocal({lane:'I',turn:'agent',snapshot:'a'.repeat(64),argv:['false']}).lease;
 leases.start(lease);writeFileSync(join(f.root,lease.resourceId),'guest');
 const python=execFileSync('python3',['-I','-c','import sys;print(sys.executable)'],{encoding:'utf8'}).trim();
 let template=readFileSync(new URL('../../deploy/disposable-tests/com.waitron.disposable-recovery.plist.in',import.meta.url),'utf8');
 const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 for(const [key,value] of Object.entries({PYTHON:python,CONTROLLER:new URL('../../',import.meta.url).pathname.replace(/\/$/,''),NODE:process.execPath,CONFIG:f.config,PATH:f.env.PATH,STATE:join(f.root,'state'),HOME:f.root}))template=template.replaceAll('@'+key+'@',escape(value));
 const rendered=JSON.parse(execFileSync(python,['-I','-B','-c','import json,plistlib,sys;print(json.dumps(plistlib.loads(sys.stdin.buffer.read())))'],{input:template,encoding:'utf8'}));
 // No shell environment supplies a hidden HOME or cache path.
 const result=spawnSync(rendered.ProgramArguments[0],rendered.ProgramArguments.slice(1),{encoding:'utf8',timeout:5000,
  env:{...rendered.EnvironmentVariables,FIXTURE_ROOT:f.root,FIXTURE_MODE:'unhealthy'}});
 assert.equal(result.status,0,result.stdout+result.stderr);
 assert.equal(leases.inspect().slots[0].state,'free');assert.equal(existsSync(join(f.root,lease.resourceId)),false);
 assert.deepEqual(readFileSync(join(f.root,'calls'),'utf8').trim().split('\n'),['destroy','inspect']);
});

test('exec preserves the Node process identity and its operating-system signal result',async t=>{
 const f=fixture(t);const node=join(f.root,'node');
 writeFileSync(node,`#!/bin/sh\necho $$ > '${f.root}/node-pid'\nkill -KILL $$\n`,{mode:0o700});
 const child=spawn('python3',['-I','-B',macWrapper,node,f.config,'--once'],{env:f.env,stdio:['ignore','pipe','pipe']});
 child.stdout.resume();child.stderr.resume();const [code,signal]=await once(child,'close');
 assert.equal(code,null);assert.equal(signal,'SIGKILL');assert.equal(Number(readFileSync(join(f.root,'node-pid'),'utf8')),child.pid);
});

test('a busy direct controller preserves75 after its output pipe closes',async t=>{
 const f=fixture(t);const {withKernelLock}=await import('./kernel-lock.mjs');
 await withKernelLock(join(f.root,'state'),async()=>{
  const child=spawn(process.execPath,[script,f.config,'--once'],{env:f.env,stdio:['ignore','pipe','pipe']});
  const closed=once(child,'close');child.stderr.resume();child.stdout.destroy();
  assert.equal((await closed)[0],75);return {code:0};
 });
});

test('Ctrl-C during the lock helper returns143 for the owned process group',async t=>{
 const f=fixture(t);const ready=join(f.root,'helper-ready');
 const helper=`require('node:fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));setTimeout(()=>{},5000);`;
 const program=`import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
 const original=cp.spawnSync,originalAsync=cp.spawn;const isHelper=argv=>argv.includes('-c') && argv.at(-1).includes('fcntl.flock');
 cp.spawnSync=(command,argv,options)=>isHelper(argv)?original(process.execPath,['-e',${JSON.stringify(helper)}],options):original(command,argv,options);
 cp.spawn=(command,argv,options)=>isHelper(argv)?originalAsync(process.execPath,['-e',${JSON.stringify(helper)}],options):originalAsync(command,argv,options);
 syncBuiltinESMExports();const {main}=await import(${JSON.stringify(new URL('./manual.mjs',import.meta.url).href)});
 try{process.exitCode=await main(${JSON.stringify(f.args.slice(1))});}catch(error){console.error(error.message);process.exitCode=125;}`;
 const child=spawn(process.execPath,['--input-type=module','-e',program],{detached:true,env:f.env,stdio:['ignore','pipe','pipe']});
 const closed=once(child,'close');let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
 try{
  const end=performance.now()+5000;
  while(!existsSync(ready) && child.exitCode===null && child.signalCode===null && performance.now()<end)await delay(10);
  assert.equal(existsSync(ready),true,output);
  process.kill(-child.pid,'SIGINT');const [code]=await closed;
  assert.equal(code,143,output);assert.match(output,/"reason":"cancelled"/);assert.equal(existsSync(join(f.root,'calls')),false);assertNoTemporaries(f);
 }finally{
  if(child.exitCode===null && child.signalCode===null)try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
  await closed;
 }
});


test('the manual CLI refuses another repository before source preparation, host contact or ledger mutation',t=>{
 const f=fixture(t);const foreign=join(f.root,'foreign');execFileSync('git',['init','-q',foreign]);
 const before=readFileSync(join(f.root,'state/ledger/state.json'),'utf8');
 const result=spawnSync(process.execPath,[script,f.config,'I',foreign,'--','false'],{env:f.env,encoding:'utf8',timeout:5000});
 assert.equal(result.status,125,result.stdout+result.stderr);assert.match(result.stderr,/only the configured Cloud repository/);
 assert.equal(readFileSync(join(f.root,'state/ledger/state.json'),'utf8'),before);
 assert.equal(existsSync(join(f.root,'calls')),false);assert.equal(existsSync(join(f.root,'packaged')),false);assertNoTemporaries(f);
});


for(const phase of ['recovery','verified-command'])test(`failed temporary deletion cannot replace ${phase}`,t=>{
 const f=fixture(t,phase==='recovery'?'unhealthy':'stuck-cleanup');
 const temporary=join(f.root,'state/tmp'),stuck=join(temporary,'stuck');
 if(phase==='recovery'){
  mkdirSync(temporary,{mode:0o700});mkdirSync(stuck,{mode:0o700});writeFileSync(join(stuck,'orphan'),'private');
  const leases=new LocalLeases(join(f.root,'state/ledger'),{hostGeneration:'fixture',slots:1});
  const lease=leases.reserveLocal({lane:'I',turn:'interrupted',snapshot:'a'.repeat(64),argv:['false']}).lease;
  leases.start(lease);writeFileSync(join(f.root,lease.resourceId),'guest');
 }
 const args=phase==='recovery'?[f.config,'--once']:f.args.slice(1);
 const program=`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
 const remove=fs.rmSync;fs.rmSync=(path,options)=>{if([${JSON.stringify(temporary)},${JSON.stringify(stuck)}].includes(String(path)) && fs.existsSync(${JSON.stringify(stuck)}))throw Object.assign(new Error('controlled undeletable private subtree'),{code:'ENOTEMPTY'});return remove(path,options);};
 syncBuiltinESMExports();const {main}=await import(${JSON.stringify(new URL('./manual.mjs',import.meta.url).href)});
 try{process.exitCode=await main(${JSON.stringify(args)});}catch(error){console.error(error.message);process.exitCode=125;}`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',program],{env:f.env,encoding:'utf8',timeout:10000});
 assert.equal(result.status,phase==='recovery'?0:3,result.stdout+result.stderr);
 assert.equal(JSON.parse(readFileSync(join(f.root,'state/ledger/state.json'),'utf8')).slots[0].state,'free');
 assert.match(result.stderr,/Temporary cleanup incomplete/);
 assert.equal(readFileSync(join(f.root,'tmp/global-sentinel'),'utf8'),'unrelated');
 if(phase==='recovery')assert.deepEqual(readFileSync(join(f.root,'calls'),'utf8').trim().split('\n'),['destroy','inspect']);
});


test('SIGTERM during background destruction returns143 and retains quarantine until a clean retry',async t=>{
 const f=fixture(t,'recovery-cancel');const leases=new LocalLeases(join(f.root,'state/ledger'),{hostGeneration:'fixture',slots:1});
 const lease=leases.reserveLocal({lane:'I',turn:'cancel-recovery',snapshot:'a'.repeat(64),argv:['false']}).lease;
 leases.start(lease);const guest=join(f.root,lease.resourceId);writeFileSync(guest,'guest');
 const child=spawn(process.execPath,[script,f.config,'--once'],{env:f.env,stdio:['ignore','pipe','pipe']});
 const closed=once(child,'close');let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
 try{
  const end=performance.now()+5000;
  while(!existsSync(join(f.root,'destroy-ready')) && child.exitCode===null && child.signalCode===null && performance.now()<end)await delay(10);
  assert.equal(existsSync(join(f.root,'destroy-ready')),true,output);
  child.kill('SIGTERM');assert.equal((await closed)[0],143,output);assert.match(output,/"reason":"cancelled"/);
  assert.equal(leases.inspect().slots[0].state,'quarantined');assert.equal(existsSync(guest),true);
  const retried=spawnSync(process.execPath,[script,f.config,'--once'],{env:{...f.env,FIXTURE_MODE:'normal'},encoding:'utf8',timeout:5000});
  assert.equal(retried.status,0,retried.stdout+retried.stderr);assert.equal(leases.inspect().slots[0].state,'free');assert.equal(existsSync(guest),false);assertNoTemporaries(f);
 }finally{if(child.exitCode===null && child.signalCode===null)child.kill('SIGTERM');await closed;}
});

// The ordinary CLI, not a test adapter, must bootstrap and use its configured pool.
for(const withCI of [false,true])test('the manual CLI bootstraps several slots and can use the next while one is quarantined',t=>{
 const f=fixture(t);rmSync(join(f.root,'state'),{recursive:true});
 const config=JSON.parse(readFileSync(f.config,'utf8'));config.mode='manual-slots';config.slots=4;
 if(withCI)config.ci={repository:'fixture/cloud',repositoryId:123,workflowId:456,workflowPath:'.github/workflows/ci.yml',workflowDigest:'a'.repeat(64),appEnv:join(f.root,'app.env'),appKey:join(f.root,'app.pem')};
 writeFileSync(f.config,JSON.stringify(config));
 const boot=spawnSync(process.execPath,[script,f.config,'--bootstrap'],{env:f.env,encoding:'utf8',timeout:5000});
 assert.equal(boot.status,0,boot.stdout+boot.stderr);
 const leases=new LocalLeases(join(f.root,'state/ledger'),{hostGeneration:'fixture',slots:4});
 const blocked=leases.reserveLocal({lane:'H',turn:'quarantine',snapshot:'a'.repeat(64),argv:['true']}).lease;
 leases.release(blocked,undefined);
 const result=run(f);assert.equal(result.status,3,result.stdout+result.stderr);assert.match(result.stdout,/dt-fixture-1-1/);
 assert.equal(leases.inspect().slots[0].state,'quarantined');assert.equal(leases.inspect().slots[1].state,'free');
 assert.equal(readFileSync(join(f.root,'tmp/global-sentinel'),'utf8'),'unrelated');
 assert.deepEqual(readdirSync(join(f.root,'state/slot-1/tmp')),[]);
});

// The package selector owns version choice; the CLI must consume its literal filename.
test('manual preparation sends the approved package selected for a historical checkout',t=>{
 const f=fixture(t);f.env.PRIVATE_SELECTED='ui-core-0.1.0.tgz';
 const result=run(f);assert.equal(result.status,3,result.stdout+result.stderr);assert.match(result.stdout,/"cleanup":"absent"/);assertNoTemporaries(f);assertControllerReleased(f);
});
