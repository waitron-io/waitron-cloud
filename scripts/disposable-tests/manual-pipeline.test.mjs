import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync,spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {LocalLeases} from './leases.mjs';
const script=new URL('./manual.mjs',import.meta.url).pathname;
function fixture(t,mode='normal') {
 const root=mkdtempSync(join(tmpdir(),'disposable-pipeline-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const name of ['bin','state','tmp','repo'])mkdirSync(join(root,name),{mode:0o700});
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
 if mode=='snapshot-failure':sys.exit(9)
 data=b'opaque source fixture';Path(args[-1]).write_bytes(data);print(json.dumps({'sha256':hashlib.sha256(data).hexdigest()}))
elif any(a.endswith('/private-packages.py') for a in args):
 p=Path(args[-1]);p.mkdir();(p/'ui-core-0.1.0.tgz').write_bytes(b'private fixture')
 if mode=='packaging':(root/'packaging.pid').write_text(str(os.getpid()));(root/'packaging-ready').touch();time.sleep(60)
 print('{}')
else:os.execv(${JSON.stringify(python)},[${JSON.stringify(python)},*args])
`,{mode:0o700});
 writeFileSync(join(root,'bin/ssh'),`#!${python}
import sys,os,json,time
from pathlib import Path
root=Path(os.environ['FIXTURE_ROOT']);parts=sys.argv[-1].split();mode=parts[-1] if parts[-1]=='health' else parts[-2];rid=parts[-1]
with (root/'calls').open('a') as f:f.write(mode+'\\n')
if mode=='health':print(json.dumps({'healthy':os.environ['FIXTURE_MODE']!='unhealthy'}))
elif mode=='transfer':sys.stdin.buffer.read();(root/rid).touch();print('{}')
elif mode=='prepare':
 if os.environ['FIXTURE_MODE']=='work':(root/'work.pid').write_text(str(os.getpid()));print('WORK-READY',flush=True);time.sleep(60)
elif mode in ('execute','execute-v2'):pass
elif mode=='result':print(json.dumps({'resourceId':rid,'code':3}))
elif mode=='destroy':
 (root/rid).unlink(missing_ok=True);print(json.dumps({'resourceId':rid,'absent':True}))
elif mode=='inspect':print(json.dumps({'resourceId':rid,'absent':not(root/rid).exists()}))
else:sys.exit(125)
`,{mode:0o700});
 const env={...process.env,PATH:join(root,'bin')+':'+process.env.PATH,FIXTURE_ROOT:root,FIXTURE_MODE:mode,TMPDIR:join(root,'tmp'),XDG_CACHE_HOME:join(root,'cache')};
 return {root,env,args:[script,config,'I',join(root,'repo'),'--','false'],config};
}
function run(f){return spawnSync(process.execPath,f.args,{env:f.env,encoding:'utf8',timeout:10000});}
function assertNoTemporaries(f){assert.deepEqual(readdirSync(join(f.root,'tmp')).filter(n=>n.startsWith('disposable-')),[]);}

test('manual CLI preserves a verified nonzero result and removes all owned preparation data',t=>{
 const f=fixture(t);const r=run(f);assert.equal(r.status,3,r.stdout+r.stderr);assert.match(r.stdout,/"code":3/);assert.match(r.stdout,/"cleanup":"absent"/);assertNoTemporaries(f);assert.equal(existsSync(join(f.root,'state/manual.lock')),false);
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
 const f=fixture(t,'snapshot-failure');const r=run(f);assert.equal(r.status,125,r.stdout+r.stderr);assertNoTemporaries(f);assert.equal(existsSync(join(f.root,'state/manual.lock')),false);
});
for(const signal of ['SIGTERM','SIGINT','SIGHUP'])test(`${signal} during packaging returns143 and cleans its private data`,async t=>{
 const f=fixture(t,'packaging');const child=spawn(process.execPath,f.args,{env:f.env,stdio:['ignore','pipe','pipe']});
 const closed=once(child,'close');let output='';child.stderr.on('data',()=>{});
 child.stdout.on('data',data=>output+=data.toString());
 try {
 const end=performance.now()+10000;
 while(!existsSync(join(f.root,'packaging-ready'))&&child.exitCode===null&&child.signalCode===null&&performance.now()<end)await delay(10);
 assert.equal(existsSync(join(f.root,'packaging-ready')),true,'No real packaging readiness: '+output);
  child.kill(signal);const [code]=await closed;assert.equal(code,143,output);assertNoTemporaries(f);assert.equal(existsSync(join(f.root,'state/manual.lock')),false);
 } finally {
  if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
  if(existsSync(join(f.root,'packaging.pid'))){try{process.kill(-Number(readFileSync(join(f.root,'packaging.pid'),'utf8')),'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}}
  await closed;
 }
});


test('an explicitly recovered dead CLI owner releases only its recorded job before a successor',async t=>{
 const f=fixture(t,'work');const child=spawn(process.execPath,f.args,{env:f.env,stdio:['ignore','pipe','pipe']});const closed=once(child,'close');let output='';child.stderr.on('data',()=>{});
 const ready=new Promise(resolve=>child.stdout.on('data',data=>{output+=data.toString();if(output.includes('WORK-READY'))resolve();}));
 try {
  await Promise.race([ready,closed.then(()=>assert.fail('Work never started: '+output))]);
  child.kill('SIGKILL');await closed;
  const busy=run({...f,env:{...f.env,FIXTURE_MODE:'normal'}});assert.equal(busy.status,75,busy.stdout+busy.stderr);
  const ledger=JSON.parse(readFileSync(join(f.root,'state/ledger/state.json'),'utf8'));const resource=ledger.slots[0].lease.resourceId;
  const recovered=spawnSync(process.execPath,[script,f.config,'--recover',resource],{env:{...f.env,FIXTURE_MODE:'unhealthy'},encoding:'utf8',timeout:10000});
  assert.equal(recovered.status,0,recovered.stdout+recovered.stderr);assert.match(recovered.stdout,/"cleanup":"absent"/);
  assert.equal(JSON.parse(readFileSync(join(f.root,'state/ledger/state.json'),'utf8')).slots[0].state,'free');
  assert.equal(run({...f,env:{...f.env,FIXTURE_MODE:'normal'}}).status,3);
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
  const [code]=await closed;assert.equal(code,143);assert.equal(JSON.parse(readFileSync(join(f.root,'state/ledger/state.json'),'utf8')).slots[0].state,'free');assertNoTemporaries(f);assert.equal(existsSync(join(f.root,'state/manual.lock')),false);
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
