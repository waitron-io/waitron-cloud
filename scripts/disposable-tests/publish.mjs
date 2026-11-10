import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync,chmodSync,realpathSync,lstatSync,cpSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {LocalLeases,configuredSlots} from './leases.mjs';
import {withKernelLock} from './kernel-lock.mjs';
import {GithubApp} from './github-app.mjs';
import {hostedAttempts} from './ci-canary.mjs';
import {SSHTransport,runProcess} from './transport.mjs';

export async function prepareHosts(p,{execute=runProcess,signal=AbortSignal.timeout(3600000)}={}){
 const c=p.configuration;configuredSlots(c);assert.ok(c.slotHosts,'Host setup needs an explicit slot mapping');
 assert.match(c.recipe,/^\/opt\/waitron-disposable-[a-zA-Z0-9_-]+$/);assert.match(p.sha,/^[a-f0-9]{40}$/);
 const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!name.startsWith('GIT_')));
 assert.equal(execFileSync('git',['-C',p.source,'rev-parse','HEAD'],{env,encoding:'utf8'}).trim(),p.sha,'Publication source changed');
 const archive=execFileSync('git',['-C',p.source,'archive','--format=tar',p.sha,'deploy/disposable-tests','scripts/disposable-tests/snapshot.py'],{env,maxBuffer:16*1024*1024});
 const stager=String.raw`import json,subprocess,sys,tarfile,tempfile
from pathlib import Path
p=json.loads(sys.argv[1])
with tempfile.TemporaryDirectory(prefix='waitron-host-install-') as temporary:
 with tarfile.open(fileobj=sys.stdin.buffer,mode='r|') as archive:archive.extractall(temporary,filter='data')
 subprocess.run(['python3','-I','-B',str(Path(temporary)/'deploy/disposable-tests/install-host.py'),p['recipe'],*p['peers']],check=True,timeout=3500)
`;
 const quote=value=>"'"+value.replaceAll("'","'\"'\"'")+"'";
 const command='python3 -I -B -c '+quote(stager)+' '+quote(JSON.stringify({recipe:c.recipe,peers:p.peerAddresses}));
 const hosts=[...new Set(c.slotHosts)],wrapper=new URL('../../deploy/disposable-tests/ssh.sh',import.meta.url).pathname;
 const results=await Promise.allSettled(hosts.map(async host=>{
  const result=await execute('bash',[wrapper,host,command],{input:archive,signal,terminationGraceMs:500000});
  assert.equal(result.code,0,'Host installation failed');
 }));
 if(results.some(result=>result.status==='rejected'))throw new AggregateError(results.filter(result=>result.status==='rejected').map(result=>result.reason),'Host installation failed; existing controller is unchanged');
 return {prepared:hosts.length};
}

export async function stageServer(p,{execute=runProcess,signal=AbortSignal.timeout(3600000)}={}){
 const privateBytes=path=>{const info=lstatSync(path);assert.ok(info.isFile()&&!info.isSymbolicLink()&&info.uid===process.getuid()&&(info.mode&0o077)===0&&info.size>0&&info.size<=65536,'App input must be private and bounded');return readFileSync(path);};
 assert.match(p.controllerHost,/^[a-zA-Z0-9][a-zA-Z0-9.:-]*$/);
 assert.match(p.serverRelease,/^\/opt\/waitron-disposable-controller-[a-zA-Z0-9_-]+$/);
 assert.match(p.serverState,/^\/var\/lib\/waitron-disposable-controller\/states\/[a-zA-Z0-9_-]+$/);
 const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!name.startsWith('GIT_')));
 assert.match(p.sha,/^[a-f0-9]{40}$/);assert.equal(execFileSync('git',['-C',p.source,'rev-parse','HEAD'],{env,encoding:'utf8'}).trim(),p.sha,'Publication source changed');
 const archive=execFileSync('git',['-C',p.source,'archive',p.sha,'scripts/disposable-tests','deploy/disposable-tests'],{env,maxBuffer:16*1024*1024});
 const c=p.configuration,hosts=[...new Set(c.slotHosts??[c.host])];
 const knownHosts=p.knownHosts??hosts.map(host=>execFileSync('ssh-keygen',['-F',host,'-f',join(process.env.HOME,'.ssh/known_hosts')],{encoding:'utf8'}).split('\n').filter(line=>line&&!line.startsWith('#')).join('\n')).join('\n')+'\n';
 assert.ok(knownHosts.length>0&&knownHosts.length<=65536,'Pinned host keys required');
 const appEnv=privateBytes(c.ci.appEnv),appKey=privateBytes(c.ci.appKey);
 const configuration={...c,state:p.serverState,ci:{...c.ci,appEnv:'/var/lib/waitron-disposable-controller/app.env',appKey:'/var/lib/waitron-disposable-controller/app.key'}};
 const header={archiveBytes:archive.length,envBytes:appEnv.length,keyBytes:appKey.length,release:p.serverRelease,configuration,knownHosts};
 const stager=readFileSync(new URL('../../deploy/disposable-tests/stage-controller.py',import.meta.url),'utf8');
 const quote=value=>"'"+value.replaceAll("'","'\"'\"'")+"'";
 const result=await execute('bash',[new URL('../../deploy/disposable-tests/ssh.sh',import.meta.url).pathname,p.controllerHost,'python3 -I -B -c '+quote(stager)],{signal,capture:true,input:Buffer.concat([Buffer.from(JSON.stringify(header)+'\n'),archive,appEnv,appKey])});
 assert.equal(result.code,0,'Server controller staging failed');
 const receipt=JSON.parse(result.stdout);assert.equal(receipt.release,p.serverRelease);assert.equal(receipt.configuration,p.serverRelease+'/config.json');assert.match(receipt.publicKey,/^ssh-ed25519 [A-Za-z0-9+/=]+(?: .*)?$/);return receipt;
}

export async function withDrained({configuration:c,api,transport,signal=AbortSignal.timeout(3600000),wait=delay},work){
 const slots=configuredSlots(c),paths=[...Array.from({length:slots},(_,slot)=>join(c.state,'slot-'+slot)),c.state];
 const inspect=()=>new LocalLeases(join(c.state,'ledger'),{hostGeneration:c.hostGeneration,slots}).inspect();
 const free=slot=>slot.state==='free'&&!slot.ciInvocation&&!slot.orphanRunners?.length;
 const pending=Symbol('pending terminal status'),completedRuns=new Map(),completedJobs=new Set();
 async function terminalHistory(ledger){
  const runs=new Map();
  for(const key of Object.keys(ledger.turns)){
   const identity=/^[A-K]:ci-([0-9]+)-([0-9]+)(?:-([0-9]+))?$/.exec(key);
   if(identity){const [,run,attempt,job]=identity;if(!runs.has(run))runs.set(run,[]);runs.get(run).push({attempt:Number(attempt),job});}
  }
  for(const [run,records] of runs){
   assert.ok(api&&c.ci,'Recorded CI history needs its original App');
   const latest=Math.max(...records.map(record=>record.attempt));
   if((completedRuns.get(run)??0)>=latest)continue;
   const prefix=`/repos/${c.ci.repository}/actions/`,seen=await api.get(prefix+'runs/'+run,{signal});
   assert.ok(seen.id===Number(run)&&seen.run_attempt>=latest,'Recorded CI run identity differs');
   if(seen.status==='completed'){completedRuns.set(run,seen.run_attempt);continue;}
   for(const {attempt,job} of records){
    if(completedJobs.has(run+':'+attempt+':'+job))continue;
    if(!job)throw pending;
    const value=await api.get(prefix+'jobs/'+job,{signal});
    assert.ok(value.id===Number(job)&&value.run_id===Number(run)&&value.run_attempt===attempt,'Recorded CI job identity differs');
    if(value.status!=='completed')throw pending;
    completedJobs.add(run+':'+attempt+':'+job);
   }
  }
 }
 async function acquire(index){
  for(;;){
   signal.throwIfAborted();
   const result=await withKernelLock(paths[index],async()=>{
    const ledger=inspect();
    if(index<slots&&!free(ledger.slots[index]))return {code:75};
    if(index+1<paths.length)return acquire(index+1);
    if(ledger.ciInvocation||ledger.orphanRunners?.length||!ledger.slots.every(free))return {code:75};
    await terminalHistory(ledger);
    // Advancing a slot already required absence of its predecessor; check its last generation.
    for(const slot of ledger.slots.filter(slot=>slot.generation>0)){
     const resourceId=`dt-${c.hostGeneration}-${slot.id}-${slot.generation}`;
     const seen=await transport.inspect({resourceId},{signal});
     assert.ok(seen.resourceId===resourceId&&seen.absent===true,'Recorded guest absence is uncertain');
    }
    if(c.ci)assert.equal(Object.keys(await hostedAttempts({api,policy:c.ci,signal})).length,0,'Hosted movements remain pending; publication refused');
    return work(ledger);
   },{signal});
   if(result.code!==75)return result;
   await wait(1000,undefined,{signal});
  }
 }
 for(;;){
  try{return await acquire(0);}
  catch(error){if(error!==pending)throw error;}
  // GitHub may report a just-finished job as running; release admission while it catches up.
  console.error('Waiting for recorded CI jobs to finish before publication');
  await wait(30000,undefined,{signal});
 }
}

const render=String.raw`import base64,json,os,plistlib,shlex,sys,tempfile
from pathlib import Path
p=json.load(sys.stdin);agent=plistlib.loads(base64.b64decode(p['agent']))
assert agent['ProgramArguments'][5]==p['oldConfiguration']
assert agent['ProgramArguments'][3]==p['oldController']+'/deploy/disposable-tests/mac-controller.py'
old_script=p['oldController']+'/deploy/disposable-tests/mac-controller.py'
lines=p['body'].splitlines(keepends=True);changed=0
for index,line in enumerate(lines):
 if not line.lstrip().startswith('exec '):continue
 args=shlex.split(line)
 assert args[-1]=='$@' and args.count(old_script)==1 and args.count(p['oldConfiguration'])==1
 replacements={old_script:p.get('controller',p['oldController'])+'/deploy/disposable-tests/mac-controller.py',
               p['oldConfiguration']:p.get('configurationPath',p['oldConfiguration'])}
 if p.get('oldServer') and p.get('remoteController'):replacements[p['oldServer']['configuration']]=p['remoteController']['configuration']
 lexer=shlex.shlex(line,posix=True);lexer.whitespace_split=True;lexer.commenters='';pieces=[]
 while True:
  start=lexer.instream.tell();value=lexer.get_token();raw=line[start:lexer.instream.tell()]
  if value in replacements:
   raw=raw[:len(raw)-len(raw.lstrip())]+shlex.quote(replacements[value])+raw[len(raw.rstrip()):]
   if value==p['oldConfiguration'] and p.get('remoteController') and not p.get('oldServer'):
    target=p['remoteController'];raw=raw.rstrip()+' remote '+shlex.quote(target['host'])+' '+shlex.quote(target['configuration'])+raw[len(raw.rstrip()):]
  pieces.append(raw)
  if value is None:break
 lines[index]=''.join(pieces);changed+=1
assert changed==1
body=''.join(lines)
if p.get('validate'):sys.exit(0)
agent['ProgramArguments'][3]=p['controller']+'/deploy/disposable-tests/mac-controller.py'
agent['ProgramArguments'][5]=p['configurationPath'];agent['ProcessType']='Standard'
for key,name in [('StandardOutPath','recovery.stdout.log'),('StandardErrorPath','recovery.stderr.log')]:
 path=Path(p['state'])/name
 if not path.exists():path.touch(mode=0o600)
 agent[key]=str(path)
files=[(p['launchAgent'],plistlib.dumps(agent,sort_keys=False),0o600),(p['wrapper'],body.encode(),0o700)]
status_data=None
if p.get('statusAdapter'):
 if p.get('remoteController'):
  target=p['remoteController'];command=[p['python'],'-I','-B',p['controller']+'/deploy/disposable-tests/ci-status.py','--remote',target['host'],target['configuration']]
  status_data=('import os\nos.execv('+repr(p['python'])+','+repr(command)+')\n').encode()
 elif p.get('statusRestore') is not None:status_data=base64.b64decode(p['statusRestore'])
 if status_data is not None:files.append((p['statusAdapter'],status_data,0o500))
for name,data,mode in files:
 path=Path(name);fd,temporary=tempfile.mkstemp(prefix='.'+path.name,dir=path.parent)
 try:
  with os.fdopen(fd,'wb') as output:output.write(data);output.flush();os.fsync(output.fileno())
  os.chmod(temporary,mode);os.replace(temporary,path)
 finally:
  if os.path.exists(temporary):os.unlink(temporary)
if status_data is not None:assert Path(p['statusAdapter']).read_bytes()==status_data
assert Path(p['wrapper']).read_text()==body
assert plistlib.loads(Path(p['launchAgent']).read_bytes())['ProgramArguments']==agent['ProgramArguments']
`;

export async function publish(p,{api,transport,candidateTransport,execute=runProcess,signal=AbortSignal.timeout(3600000)}={}){
 const old=JSON.parse(readFileSync(p.oldConfiguration,'utf8')),c=p.configuration;
 assert.ok(c.state!==old.state&&c.hostGeneration!==old.hostGeneration,'Handoff requires fresh state and host generation');
 assert.ok(!existsSync(c.state)&&!existsSync(p.newController),'Replacement state and release must be absent');
 const gitEnv=Object.fromEntries(Object.entries(process.env).filter(([name])=>!name.startsWith('GIT_')));
 const git=(...args)=>execFileSync('git',['-c','core.fsmonitor=false','-C',p.source,...args],{env:gitEnv});
 assert.match(p.sha,/^[a-f0-9]{40}$/);assert.equal(git('rev-parse','HEAD').toString().trim(),p.sha,'Publication source changed');
 api??=old.ci?new GithubApp(old.ci):undefined;transport??=new SSHTransport(old);candidateTransport??=new SSHTransport(c);
 const available=await candidateTransport.healthySlots({signal});
 assert.equal(available.length,configuredSlots(c),'Replacement host capacity is unavailable');
 const agent=readFileSync(p.launchAgent),body=readFileSync(p.wrapper,'utf8');
 const checked=async(command,argv,options={})=>{
  const result=await execute(command,argv,{capture:true,signal,...options});
  assert.equal(result.code,0,`Publication command failed: ${command} ${argv[0]} exited ${result.code}`);return result;
 };
 await checked(p.python,['-I','-B','-c',render],{input:JSON.stringify({...p,agent:agent.toString('base64'),body,validate:true})});
 return withDrained({configuration:old,api,transport,signal},async()=>{
  assert.deepEqual(readFileSync(p.launchAgent),agent,'Launch agent changed during drain');
  assert.equal(readFileSync(p.wrapper,'utf8'),body,'Manual helper changed during drain');
  mkdirSync(p.newController,{mode:0o700});
  for(const line of git('ls-tree','-r',p.sha,'--','scripts/disposable-tests','deploy/disposable-tests').toString().trim().split('\n')){
   const match=/^100(?:644|755) blob ([a-f0-9]{40})\t(.+)$/.exec(line);assert.ok(match,'Only regular reviewed release files are accepted');
   const path=join(p.newController,match[2]);mkdirSync(dirname(path),{recursive:true,mode:0o700});
   writeFileSync(path,git('cat-file','blob',match[1]),{mode:match[2].endsWith('.sh')?0o500:0o400});
  }
  const bootstrap=async(configuration,name,controller)=>{
   const path=join(p.newController,name);writeFileSync(path,JSON.stringify(configuration)+'\n',{mode:0o400});
   await checked(p.python,['-I','-B',join(controller,'deploy/disposable-tests/mac-controller.py'),p.node,path,'--bootstrap']);return path;
  };
  const configPath=await bootstrap(c,'config.json',p.newController);
  const switchTo=async(configuration,path,controller)=>{
   await checked(p.python,['-I','-B','-c',render],{input:JSON.stringify({...p,agent:agent.toString('base64'),body,controller,configurationPath:path,state:configuration.state})});
   await checked('launchctl',['bootstrap','gui/'+process.getuid(),p.launchAgent]);
   const printed=await checked('launchctl',['print',p.launchLabel]);
   assert.ok(printed.stdout.includes(path),'Launch agent readback differs');
  };
  if(p.statusAdapter){
   await checked(p.python,['-I','-B','-c',String.raw`import os,sys,tempfile
from pathlib import Path
target=Path(sys.argv[1]);fd,temporary=tempfile.mkstemp(prefix='.'+target.name,dir=target.parent)
with os.fdopen(fd,'wb') as output:output.write(Path(sys.argv[2]).read_bytes());output.flush();os.fsync(output.fileno())
os.chmod(temporary,0o500);os.replace(temporary,target)
`,p.statusAdapter,join(p.newController,'deploy/disposable-tests/ci-status.py')]);
  }
  mkdirSync(join(old.state,'manual.lock'),{mode:0o700});
  try{
   await checked('launchctl',['bootout',p.launchLabel]);
   await switchTo(c,configPath,p.newController);
  }catch(error){
   try{
    await withDrained({configuration:c,api,transport:candidateTransport,signal},async()=>{
     mkdirSync(join(c.state,'manual.lock'),{mode:0o700});
     await execute('launchctl',['bootout',p.launchLabel],{capture:true,signal});
     const suffix=randomBytes(4).toString('hex');
     const rollback={...old,state:c.state+'-rollback-'+suffix,hostGeneration:old.hostGeneration.slice(0,40)+'-rollback-'+suffix};
     const path=await bootstrap(rollback,'rollback-config.json',p.oldController);
     await switchTo(rollback,path,p.oldController);return {code:0};
    });
   }catch(rollbackError){
    if(!existsSync(join(c.state,'manual.lock')))mkdirSync(join(c.state,'manual.lock'),{mode:0o700});
    throw new Error('Publication rollback stopped; admission remains closed',{cause:rollbackError});
   }
   throw new Error('Publication failed; fresh-state rollback is restored',{cause:error});
  }
  const freeze=directory=>{for(const entry of readdirSync(directory,{withFileTypes:true}))if(entry.isDirectory())freeze(join(directory,entry.name));chmodSync(directory,0o500);};
  freeze(p.newController);
  return {code:0,published:true,controller:p.newController,configurationPath:configPath,state:c.state};
 });
}

const shellQuote=value=>"'"+value.replaceAll("'","'\"'\"'")+"'";
const controllerNode='/opt/waitron-controller-node-v26.13.0/bin/node';
const wrapperPath=new URL('../../deploy/disposable-tests/ssh.sh',import.meta.url).pathname;

async function rootCommand(p,command,input,{execute,signal,capture=true}){
 return execute('bash',[wrapperPath,p.controllerHost,command],{input,capture,signal,terminationGraceMs:500000});
}
function freezeRelease(path){
 for(const entry of readdirSync(path,{withFileTypes:true})){const child=join(path,entry.name);if(entry.isDirectory())freezeRelease(child);else chmodSync(child,entry.name.endsWith('.sh')?0o500:0o400);}
 chmodSync(path,0o500);
}
function copyRelease(p){
 mkdirSync(p.newController,{mode:0o700});
 const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!name.startsWith('GIT_')));
 const git=(...args)=>execFileSync('git',['-C',p.source,...args],{env});
 for(const line of git('ls-tree','-r',p.sha,'--','scripts/disposable-tests','deploy/disposable-tests').toString().trim().split('\n')){
  const match=/^100(?:644|755) blob ([a-f0-9]{40})\t(.+)$/.exec(line);assert.ok(match,'Only regular release files accepted');
  const path=join(p.newController,match[2]);mkdirSync(dirname(path),{recursive:true,mode:0o700});writeFileSync(path,git('cat-file','blob',match[1]),{mode:match[2].endsWith('.sh')?0o500:0o400});
 }
}
export async function activateServer({receipt,oldServer},{execute=runProcess,api,transport,signal=AbortSignal.timeout(3600000)}={}){
 assert.ok(receipt&&typeof receipt.release==='string'&&typeof receipt.configuration==='string'&&typeof receipt.node==='string','Invalid server activation receipt');
 const invoke=async(received,action='activate')=>{
  const code="import importlib.util,json,sys;from pathlib import Path;p=json.load(sys.stdin);s=importlib.util.spec_from_file_location('installer',Path(p['release'])/'deploy/disposable-tests/install-controller.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);m."+action+"(p)";
  const result=await execute('/usr/bin/python3',['-I','-B','-c',code],{input:JSON.stringify(received),signal,capture:true});assert.equal(result.code,0,'Server activation failed');
 };
 if(!oldServer){await invoke(receipt);return {code:0,receipt};}
 const old=JSON.parse(readFileSync(oldServer.configuration)),candidate=JSON.parse(readFileSync(receipt.configuration));
 assert.ok(candidate.state!==old.state&&candidate.hostGeneration!==old.hostGeneration,'Server update requires fresh state and generation');
 return withDrained({configuration:old,api:api??new GithubApp(old.ci),transport:transport??new SSHTransport(old),signal},async()=>{
  mkdirSync(join(old.state,'manual.lock'),{mode:0o700});
  for(const unit of ['timer','service'])assert.equal((await execute('systemctl',[...(unit==='timer'?['disable','--now']:['stop']),'waitron-disposable-controller.'+unit],{signal})).code,0,'Server stop failed');
  try{await invoke(receipt);return {code:0,receipt};}
  catch(error){
   await stopServer(receipt,{execute,api,transport,signal});
   const suffix=randomBytes(4).toString('hex'),release=oldServer.release+'-rollback-'+suffix;
   mkdirSync(release,{mode:0o700});for(const area of ['scripts/disposable-tests','deploy/disposable-tests'])cpSync(join(oldServer.release,area),join(release,area),{recursive:true});
   const configuration=join(release,'config.json'),rollback={...old,state:old.state+'-rollback-'+suffix,hostGeneration:old.hostGeneration.slice(0,40)+'-rollback-'+suffix};
   writeFileSync(configuration,JSON.stringify(rollback)+'\n',{mode:0o400});
   const restored={release,configuration,node:oldServer.node??controllerNode};freezeRelease(release);await invoke(restored);return {code:1,rollback:restored,error:error.message};
  }
 });
}
export async function stopServer(receipt,{execute=runProcess,api,transport,signal=AbortSignal.timeout(3600000)}={}){
 const c=JSON.parse(readFileSync(receipt.configuration));if(!existsSync(c.state))return {code:0};
 return withDrained({configuration:c,api:api??new GithubApp(c.ci),transport:transport??new SSHTransport(c),signal},async()=>{
  if(!existsSync(join(c.state,'manual.lock')))mkdirSync(join(c.state,'manual.lock'),{mode:0o700});
  for(const unit of ['timer','service'])assert.equal((await execute('systemctl',[...(unit==='timer'?['disable','--now']:['stop']),'waitron-disposable-controller.'+unit],{signal})).code,0,'Server stop failed');return {code:0};
 });
}
export async function publishServer(p,{execute=runProcess,api,transport,signal=AbortSignal.timeout(3600000)}={}){
 const old=JSON.parse(readFileSync(p.oldConfiguration)),receipt=await stageServer(p,{execute,signal});
 assert.ok(p.configuration.hostGeneration!==old.hostGeneration,'Handoff requires a fresh host generation');
 const agent=readFileSync(p.launchAgent),body=readFileSync(p.wrapper,'utf8'),statusRestore=p.statusAdapter&&existsSync(p.statusAdapter)?readFileSync(p.statusAdapter).toString('base64'):undefined;
 const checked=async(command,argv,options={})=>{const r=await execute(command,argv,{signal,capture:true,...options});assert.equal(r.code,0,'Server publication command failed');return r;};
 const renderTo=async(remoteController,configurationPath,controller=p.newController)=>checked(p.python,['-I','-B','-c',render],{input:JSON.stringify({...p,agent:agent.toString('base64'),body,controller,configurationPath,state:JSON.parse(readFileSync(configurationPath)).state,remoteController,statusRestore})});
 await checked(p.python,['-I','-B','-c',render],{input:JSON.stringify({...p,agent:agent.toString('base64'),body,validate:true})});
 const authorize=readFileSync(new URL('../../deploy/disposable-tests/authorize-controller.py',import.meta.url),'utf8');
 for(const host of new Set(p.configuration.slotHosts??[p.configuration.host])){
  const result=await execute('bash',[wrapperPath,host,'python3 -I -B -c '+shellQuote(authorize)],{input:JSON.stringify({host:p.controllerHost,key:receipt.publicKey}),signal,capture:true});assert.equal(result.code,0,'Server SSH authorization failed');
 }
 copyRelease(p);const localConfiguration=join(p.newController,'config.json');writeFileSync(localConfiguration,JSON.stringify(old)+'\n',{mode:0o400});
 const activate=()=>rootCommand(p,`${controllerNode} ${receipt.release}/scripts/disposable-tests/publish.mjs server-activate`,JSON.stringify({receipt,oldServer:p.oldServer}),{execute,signal});
 const commitCallers=async target=>{assert.deepEqual(readFileSync(p.launchAgent),agent,'Mac agent changed during drain');assert.equal(readFileSync(p.wrapper,'utf8'),body,'Manual helper changed during drain');await renderTo({host:p.controllerHost,configuration:target.configuration},localConfiguration);freezeRelease(p.newController);};
 if(p.oldServer){const result=await activate();assert.ok(result.stdout?.trim(),'Server rollback stopped; callers remain closed');const value=JSON.parse(result.stdout);const target=result.code===0?receipt:value.rollback;assert.ok(target,'Server rollback stopped; callers remain closed');await commitCallers(target);if(result.code!==0)throw new Error('Publication failed; fresh-state server rollback is restored');return {published:true,receipt};}
  const probed=await rootCommand(p,'python3 -I -B '+receipt.release+'/deploy/disposable-tests/probe-controller.py',JSON.stringify({...receipt,recipe:p.configuration.recipe,peers:p.peerAddresses.filter(host=>host!==p.controllerHost)}),{execute,signal,capture:false});assert.equal(probed.code,0,'Server qualification failed before Mac stop');
 return withDrained({configuration:old,api:api??new GithubApp(old.ci),transport:transport??new SSHTransport(old),signal},async()=>{
  assert.deepEqual(readFileSync(p.launchAgent),agent,'Mac agent changed during drain');assert.equal(readFileSync(p.wrapper,'utf8'),body,'Manual helper changed during drain');
  mkdirSync(join(old.state,'manual.lock'),{mode:0o700});
  try{
   await checked('launchctl',['bootout',p.launchLabel]);await checked('launchctl',['disable',p.launchLabel]);
   const result=await activate();assert.equal(result.code,0,'Server activation failed');await commitCallers(receipt);
  }catch(error){
   const stopped=await rootCommand(p,`${controllerNode} ${receipt.release}/scripts/disposable-tests/publish.mjs server-stop`,JSON.stringify(receipt),{execute,signal});assert.equal(stopped.code,0,'Rollback stopped; admission remains closed');
   const suffix=randomBytes(4).toString('hex'),rollback={...old,state:old.state+'-rollback-'+suffix,hostGeneration:old.hostGeneration.slice(0,40)+'-rollback-'+suffix},path=join(p.newController,'rollback-config.json');writeFileSync(path,JSON.stringify(rollback)+'\n',{mode:0o400});
   await checked(p.python,['-I','-B',join(p.oldController,'deploy/disposable-tests/mac-controller.py'),p.node,path,'--bootstrap']);await renderTo(undefined,path,p.oldController);await checked('launchctl',['enable',p.launchLabel]);await checked('launchctl',['bootstrap','gui/'+process.getuid(),p.launchAgent]);throw new Error('Server publication failed; fresh-state Mac rollback is restored',{cause:error});
  }
  return {code:0,published:true,receipt};
 });
}

if(process.argv[1]&&existsSync(process.argv[1])&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href){
 try{
  const mode=process.argv[2];
  if(mode==='server-activate'||mode==='server-stop'){
   const value=JSON.parse(readFileSync(0,'utf8')),result=await (mode==='server-activate'?activateServer(value):stopServer(value));console.log(JSON.stringify(result));process.exitCode=result.code;
  }else{
   const hosts=mode==='hosts',server=mode==='server',p=JSON.parse(readFileSync(process.argv[hosts||server?3:2],'utf8'));
   console.log(JSON.stringify(await (hosts?prepareHosts:server?publishServer:publish)(p)));
  }
 }
 catch(error){console.error(error.message);process.exitCode=1;}
}
