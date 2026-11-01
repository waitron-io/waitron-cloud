import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {before,after,test} from 'node:test';
import * as factory from '../src/container-verifier.ts';
import {bufferObject} from '../src/object-transfer.ts';
import {backupVerificationRequestDigest,type BackupVerificationRequest} from '../src/verification-protocol.ts';
// @ts-expect-error deployment controller is JavaScript
import {openVerifierController} from '../../../deploy/test-cloud/verifier-controller.mjs';
const vector=JSON.parse(await readFile(new URL('./fixtures/verification-vector.json',import.meta.url),'utf8'));
const root=fileURLToPath(new URL('../../../',import.meta.url)),owner='bound-'+randomUUID(),tag='cloud-bound-test:'+owner;
const docker=(...args:string[])=>execFileSync('docker',args,{encoding:'utf8',timeout:120000,stdio:['pipe','pipe','pipe']}).trim();
let image:string,directory:string;
const key={version:1,reference:'key-1',secret:'private-fixture-key'};
before(async()=>{
 directory=await mkdtemp(join(tmpdir(),'cloud-bound-docker-'));
 const args=['build','--progress=plain','--iidfile',join(directory,'image-id'),'-t',tag,'-f',join(root,'packages/backups/test/container-fixture/Bound.Dockerfile'),root],started=performance.now();
 try{docker(...args);image=(await readFile(join(directory,'image-id'),'utf8')).trim();}
 catch(error){
  const failure=error as {status?:number;signal?:string;code?:string;stderr?:string};
  // The runner can hit its job deadline before printing the hook's final error summary.
  process.stderr.write('backup fixture build failed: '+JSON.stringify({command:['docker',...args],elapsedMs:Math.round(performance.now()-started),status:failure.status,signal:failure.signal,code:failure.code,stderrTail:String(failure.stderr??'').slice(-8192)})+'\n');
  throw error;
 }
},{timeout:150000});
after(async()=>{
 try{
  // A failed build may have tagged its image; try only our unique tag without another two-minute wait.
  execFileSync('docker',['image','rm',tag],{encoding:'utf8',timeout:image?120000:1000,stdio:['pipe','pipe','pipe']});
 }finally{if(directory)await rm(directory,{recursive:true,force:true});}
});
async function setup(extra:object={}){
 assert.equal(typeof factory.createBoundContainerWaitronVerifier,'function','bound container factory is missing');
 const controlDirectory=join(directory,randomUUID()),controller=await openVerifierController({directory:controlDirectory,owner,image});
 const verify=await factory.createBoundContainerWaitronVerifier({image,owner,controller,memoryMiB:192,scratchMiB:16,...extra});
 const req:BackupVerificationRequest={...structuredClone(vector),verifierImage:'local.waitron-verifier@'+image,attempt:{...vector.attempt,controllerScope:controller.scope,childToken:randomUUID(),deadline:new Date(Date.now()+25000).toISOString()}};
 return {controller,controlDirectory,verify,req};
}
const source=(mode=0)=>bufferObject(Buffer.from([mode,255,1,2]));
const empty=()=>assert.equal(docker('ps','-aq','--filter','label=cloud.backup-verifier.owner='+owner),'');
test('bound container returns exact child provenance only after confirmed cleanup',async()=>{
 const {verify,req}=await setup(),output=await verify(source(),key,req,new AbortController().signal);
 assert.equal(output.result.status,'passed');assert.equal(output.result.activation,'not_attempted');
 assert.equal(output.result.modules.length,2);
 assert.deepEqual(output.receipt,{childId:output.receipt.childId,imageId:image,requestDigest:backupVerificationRequestDigest(req),controllerScope:req.attempt.controllerScope,childToken:req.attempt.childToken,terminated:true,cleanupConfirmed:true});
 assert.match(output.receipt.childId,/^[a-f0-9]{64}$/);empty();
 assert.throws(()=>docker('inspect',output.receipt.childId));
});
for(const mode of [1,2,7,8,9,10,11])test(`bound container refuses unbound, malformed or private output mode ${mode}`,async()=>{
 const {verify,req}=await setup();await assert.rejects(verify(source(mode),key,req,new AbortController().signal),/^Error: backup.verifier_(output|failed)$/);empty();
});
test('invalid archive is a bounded verdict, distinct from a container failure',async()=>{
 const {verify,req}=await setup(),out=await verify(source(4),key,req,new AbortController().signal);
 assert.equal(out.result.status,'invalid');assert.equal(out.result.reason,'archive_invalid');assert.equal(out.receipt.cleanupConfirmed,true);empty();
});
test('wrong key, scope, image, expired deadline or cancellation stays outside source and child',async()=>{
 const {verify,req}=await setup();let opened=0;
 const unopened={...source(),open(){opened++;throw Error('private must not open');}};
 for(const bad of [{...key,version:2},{...key,reference:'foreign'},{...key,secret:''}])await assert.rejects(verify(unopened,bad,req,new AbortController().signal),/^Error: backup.verifier_input$/);
 for(const bad of [{...req,verifierImage:'local.waitron-verifier@sha256:'+'0'.repeat(64)},{...req,attempt:{...req.attempt,controllerScope:'foreign'}}])await assert.rejects(verify(unopened,key,bad,new AbortController().signal),/^Error: backup.verifier_configuration$/);
 await assert.rejects(verify(unopened,key,{...req,attempt:{...req.attempt,deadline:'2026-01-01T00:00:00.000Z'}},new AbortController().signal),/^Error: backup.verifier_timeout$/);
 await assert.rejects(verify(unopened,key,req,AbortSignal.abort()),/^Error: backup.verifier_cancelled$/);
 assert.equal(opened,0);empty();
});
test('new container path enforces scratch and memory quotas',async()=>{
 for(const mode of [5,6]){const {verify,req}=await setup({scratchMiB:1});await assert.rejects(verify(source(mode),key,req,new AbortController().signal),/^Error: backup.verifier_resource$/);empty();}
});
test('cancellation removes the exact isolated child and leaves the controller reusable',async()=>{
 const {verify,req,controller}=await setup(),stop=new AbortController(),pending=verify(source(3),key,req,stop.signal),rejected=assert.rejects(pending,/backup.verifier_cancelled/);let id='';
 try{
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){id=docker('ps','-q','--no-trunc','--filter','label=cloud.backup-verifier.token='+req.attempt.childToken);if(id){try{docker('exec',id,'test','-f','/scratch/entered');break;}catch{}}await delay(25);}
  assert(id);const [info]=JSON.parse(docker('inspect',id));
  assert.equal(info.HostConfig.NetworkMode,'none');assert.equal(info.HostConfig.ReadonlyRootfs,true);assert.equal(info.Config.User,'1000:1000');assert.deepEqual(info.Mounts,[]);
  assert.deepEqual(info.HostConfig.CapDrop,['ALL']);assert.equal(info.HostConfig.Privileged,false);assert.equal(info.HostConfig.PidsLimit,64);assert.equal(info.HostConfig.Memory,201326592);assert.equal(info.HostConfig.MemorySwap,201326592);
  const probe=JSON.parse(docker('exec',id,'node','-e',`const fs=require('node:fs'),net=require('node:net');let write=false,socket=false;try{fs.writeFileSync('/verifier/escape','bad')}catch(e){write=['EACCES','EROFS'].includes(e.code)}socket=!fs.existsSync('/var/run/docker.sock');const s=net.connect({host:'1.1.1.1',port:443});s.on('error',e=>console.log(JSON.stringify({write,socket,network:e.code})));s.on('connect',()=>{s.destroy();console.log('{}')});s.setTimeout(1000,()=>{s.destroy();console.log('{}')});`));
  assert.deepEqual(probe,{write:true,socket:true,network:'ENETUNREACH'});
  assert(!JSON.stringify(info).includes(key.secret));
 }finally{stop.abort();await rejected;}empty();await controller.reclaim();
 const again={...req,attempt:{...req.attempt,childToken:randomUUID(),deadline:new Date(Date.now()+25000).toISOString()}};
 assert.equal((await verify(source(),key,again,new AbortController().signal)).result.status,'passed');empty();
});
test('source errors are bounded and cleanup completes',async()=>{
 const {verify,req}=await setup();for(const open of [()=>{throw Error('private-fixture-key');},()=>Readable.from((async function*(){yield Buffer.from([0]);throw Error('private-fixture-key');})())])await assert.rejects(verify({...source(),open},key,req,new AbortController().signal),/^Error: backup.verifier_input$/);empty();
});
for(const status of [0,4])test(`cleanup uncertainty overrides ${status===0?'passed':'invalid'} output`,async()=>{
 const base=await setup(),controller={...base.controller,async remove(){}};
 const verify=await factory.createBoundContainerWaitronVerifier({image,owner,controller,memoryMiB:192,scratchMiB:16});
 try{await assert.rejects(verify(source(status),key,base.req,new AbortController().signal),/^Error: backup.verifier_cleanup$/);}
 finally{const ids=docker('ps','-aq','--no-trunc','--filter','label=cloud.backup-verifier.token='+base.req.attempt.childToken).split(/\s+/).filter(Boolean);assert.equal(ids.length,1);for(const id of ids)await base.controller.remove(id,base.req);}empty();
});
const unsafeSettings:[string,string,string][]=[['network','--network','bridge'],['root write','--read-only','false'],['capabilities','--cap-drop','CHOWN'],['root user','--user','0:0'],['process quota','--pids-limit','128'],['CPU quota','--cpus','2'],['memory quota','--memory','128m'],['swap quota','--memory-swap','256m'],['IPC','--ipc','private'],['scratch quota','--tmpfs','/scratch:rw,noexec,nosuid,nodev,size=32m,uid=1000,gid=1000,mode=0700'],['logs','--log-driver','json-file']];
for(const [name,flag,value] of unsafeSettings)test(`actual ${name} mismatch is refused before archive open`,async()=>{
 const base=await setup(),controller={...base.controller,async create(args:string[],req:BackupVerificationRequest){const changed=[...args],index=changed.indexOf(flag);assert(index>=0);if(flag==='--read-only')changed[index]='--read-only=false';else changed[index+1]=value;return base.controller.create(changed,req);}};
 const verify=await factory.createBoundContainerWaitronVerifier({image,owner,controller,memoryMiB:192,scratchMiB:16});let opened=0;
 await assert.rejects(verify({...source(),open(){opened++;return source().open();}},key,base.req,new AbortController().signal),/^Error: backup.verifier_container$/);assert.equal(opened,0);empty();
});
test('foreign child identity refuses output and never removes the foreign child',async()=>{
 const base=await setup(),foreign=docker('create','--entrypoint','node',image,'-e','');
 const controller={...base.controller,async create(){return foreign;}};
 const verify=await factory.createBoundContainerWaitronVerifier({image,owner,controller,memoryMiB:192,scratchMiB:16});
 try{await assert.rejects(verify(source(),key,base.req,new AbortController().signal),/^Error: backup.verifier_cleanup$/);assert.equal(JSON.parse(docker('inspect',foreign))[0].State.Status,'created');}finally{docker('rm',foreign);}empty();
});
test('a live request deadline stops the child and removes private scratch',async()=>{
 const {verify,req}=await setup();req.attempt.deadline=new Date(Date.now()+1800).toISOString();const started=Date.now();
 await assert.rejects(verify(source(3),key,req,new AbortController().signal),/^Error: backup.verifier_timeout$/);assert(Date.now()-started<10000,'request watchdog did not bound the live child');empty();
});
test('cancellation during confirmed removal cannot publish the completed verdict',async()=>{
 const base=await setup(),stop=new AbortController(),controller={...base.controller,async remove(id:string,req:BackupVerificationRequest){await base.controller.remove(id,req);stop.abort();}};
 const verify=await factory.createBoundContainerWaitronVerifier({image,owner,controller,memoryMiB:192,scratchMiB:16});
 await assert.rejects(verify(source(),key,base.req,stop.signal),/^Error: backup.verifier_cancelled$/);empty();
});
for(const name of ['privilege','security option','host mount'])test(`actual ${name} mismatch refuses before start`,async()=>{
 const base=await setup(),controller={...base.controller,async create(args:string[],req:BackupVerificationRequest){let changed=[...args];if(name==='privilege')changed=['--privileged',...changed];else if(name==='host mount')changed=['--mount',`type=bind,src=${directory},dst=/host,readonly`,...changed];else{const i=changed.indexOf('--security-opt');changed.splice(i,2);}return base.controller.create(changed,req);}};
 const verify=await factory.createBoundContainerWaitronVerifier({image,owner,controller,memoryMiB:192,scratchMiB:16});
 await assert.rejects(verify(source(),key,base.req,new AbortController().signal),/^Error: backup.verifier_container$/);empty();
});
test('bound configuration cannot increase the approved quotas or use mutable images',async()=>{
 const base=await setup();
 for(const bad of [{image:tag},{image:'sha256:bad'},{owner:''},{memoryMiB:0},{memoryMiB:1025},{scratchMiB:0},{scratchMiB:257},{controller:null}])await assert.rejects(factory.createBoundContainerWaitronVerifier({image,owner,controller:base.controller,...bad} as never),/^Error: backup.verifier_configuration$/);
 empty();
});
test('the bound watchdog stops a CPU-blocked verifier after host death and restart reclaims only its exact child',{timeout:60000},async()=>{
 const base=await setup(),adapter=new URL('../src/container-verifier.ts',import.meta.url).href,controllerModule=new URL('../../../deploy/test-cloud/verifier-controller.mjs',import.meta.url).href,objects=new URL('../src/object-transfer.ts',import.meta.url).href;
 const program=`import {createBoundContainerWaitronVerifier} from ${JSON.stringify(adapter)};import {openVerifierController} from ${JSON.stringify(controllerModule)};import {bufferObject} from ${JSON.stringify(objects)};let raw='';for await(const bytes of process.stdin)raw+=bytes;const {directory,owner,image,key,request}=JSON.parse(raw),controller=await openVerifierController({directory,owner,image}),verify=await createBoundContainerWaitronVerifier({image,owner,controller,memoryMiB:192,scratchMiB:16});await verify(bufferObject(Buffer.from([15,255,1,2])),key,request,new AbortController().signal);`;
 const host=spawn(process.execPath,['--input-type=module','-e',program],{stdio:['pipe','ignore','ignore']}),closed=new Promise(resolve=>host.once('close',resolve));
 host.stdin.end(JSON.stringify({directory:base.controlDirectory,owner,image,key,request:base.req}));let id='';
 try{
  const startedBy=Date.now()+10000;let entered=false;
  while(Date.now()<startedBy){id=docker('ps','-q','--no-trunc','--filter','label=cloud.backup-verifier.token='+base.req.attempt.childToken);if(id){try{docker('exec',id,'test','-f','/scratch/entered');entered=true;break;}catch{}}await delay(25);}
  assert(entered);assert(host.pid);host.kill('SIGKILL');await closed;
  const exitedBy=Date.now()+35000;
  while(Date.now()<exitedBy&&JSON.parse(docker('inspect',id))[0].State.Running)await delay(100);
  const [info]=JSON.parse(docker('inspect',id));assert.equal(info.State.Running,false);assert.equal(info.State.ExitCode,74);
  const restarted=await openVerifierController({directory:base.controlDirectory,owner,image});await restarted.reclaim();empty();assert.throws(()=>docker('inspect',id));
 }finally{host.kill('SIGKILL');await closed;if(id){const remaining=docker('ps','-aq','--no-trunc','--filter','label=cloud.backup-verifier.token='+base.req.attempt.childToken);if(remaining)await base.controller.remove(id,base.req);}}
});
for(const field of ['image','id','owner','scope','token','claim','request','deadline'])test(`parent refuses an independently mismatched ${field} inspection`,async()=>{
 const base=await setup(),scratch=await mkdtemp(join(tmpdir(),'cloud-inspection-')),realDocker=execFileSync('which',['docker'],{encoding:'utf8'}).trim(),oldPath=process.env.PATH;
 const counter=join(scratch,'count'),wrapper=join(scratch,'docker');
 await writeFile(wrapper,`#!${process.execPath}
const fs=require('node:fs'),cp=require('node:child_process'),args=process.argv.slice(2),r=cp.spawnSync(${JSON.stringify(realDocker)},args,{encoding:'utf8'});let out=r.stdout;
if(args[0]==='inspect'&&r.status===0){const count=fs.existsSync(${JSON.stringify(counter)})?Number(fs.readFileSync(${JSON.stringify(counter)},'utf8'))+1:1;fs.writeFileSync(${JSON.stringify(counter)},String(count));if(count===2){const info=JSON.parse(out),field=${JSON.stringify(field)};if(field==='image')info[0].Image='sha256:'+'0'.repeat(64);else if(field==='id')info[0].Id='0'.repeat(64);else info[0].Config.Labels['cloud.backup-verifier.'+field]='foreign';out=JSON.stringify(info);}}
if(out)process.stdout.write(out);if(r.stderr)process.stderr.write(r.stderr);process.exit(r.status??1);
`);await chmod(wrapper,0o700);process.env.PATH=scratch+':'+oldPath;let opened=0;
 try{await assert.rejects(base.verify({...source(),open(){opened++;return source().open();}},key,base.req,new AbortController().signal),/^Error: backup.verifier_container$/);assert.equal(opened,0);empty();}
 finally{process.env.PATH=oldPath;await rm(scratch,{recursive:true,force:true});}
});
for(const mode of [12,13])test(`streamed output overflow stops the live child before the request deadline mode ${mode}`,async()=>{
 const {verify,req}=await setup(),started=Date.now();
 await assert.rejects(verify(source(mode),key,req,new AbortController().signal),/^Error: backup.verifier_output$/);assert(Date.now()-started<10000);empty();
});
test('external kill is infrastructure uncertainty and never an archive verdict',async()=>{
 const {verify,req}=await setup(),pending=verify(source(3),key,req,new AbortController().signal),rejected=assert.rejects(pending,/^Error: backup.verifier_container$/);let id='';
 const by=Date.now()+10000;while(Date.now()<by){id=docker('ps','-q','--no-trunc','--filter','label=cloud.backup-verifier.token='+req.attempt.childToken);if(id){try{docker('exec',id,'test','-f','/scratch/entered');break;}catch{}}await delay(25);}
 assert(id);docker('kill','--signal','KILL',id);await rejected;empty();
});
for(const field of ['entrypoint','command'])test(`a different ${field} cannot replace the shipped verifier in the pinned image`,async()=>{
 const base=await setup(),controller={...base.controller,async create(args:string[],req:BackupVerificationRequest){const changed=[...args];if(field==='entrypoint')changed[changed.indexOf('--entrypoint')+1]='/bin/sh';else changed.splice(changed.indexOf(image)+1,100,'-e',"process.stdin.resume();process.stdin.once('end',()=>console.log('{}'))");return base.controller.create(changed,req);}};
 const verify=await factory.createBoundContainerWaitronVerifier({image,owner,controller,memoryMiB:192,scratchMiB:16});let opened=0;
 await assert.rejects(verify({...source(),open(){opened++;return source().open();}},key,base.req,new AbortController().signal),/^Error: backup.verifier_container$/);assert.equal(opened,0);empty();
});

test('a refused removal reports its boundary without publishing the archive verdict',async()=>{
 const base=await setup(),scratch=await mkdtemp(join(tmpdir(),'bound-remove-refusal-')),realDocker=execFileSync('which',['docker'],{encoding:'utf8'}).trim(),oldPath=process.env.PATH;
 await writeFile(join(scratch,'docker'),`#!${process.execPath}
const cp=require('node:child_process'),args=process.argv.slice(2);
if(args[0]==='rm'){process.stderr.write('private-fixture-key /private/archive');process.exit(42);}
const result=cp.spawnSync(${JSON.stringify(realDocker)},args,{stdio:'inherit'});process.exit(result.status??1);
`,{mode:0o700});process.env.PATH=scratch+':'+oldPath;
 try{
  await assert.rejects(base.verify(source(4),key,base.req,new AbortController().signal),(error:any)=>{
   assert.equal(error.message,'backup.verifier_cleanup');assert.equal(error.cause.stage,'controller-remove');
   assert.equal(error.cause.reason,'test_cloud.verifier_docker');assert.equal(error.cause.controllerStage,'remove-child');
   assert.equal(error.cause.operation,'rm');assert.equal(error.cause.code,42);
   assert.equal(error.cause.signal,null);assert.equal(error.cause.killed,false);assert(Number.isSafeInteger(error.cause.elapsedMs));
   assert(!JSON.stringify(error.cause).includes('private-fixture-key'));assert(!JSON.stringify(error.cause).includes('/private/archive'));return true;
  });
  const journal=JSON.parse(await readFile(join(base.controlDirectory,'child.json'),'utf8'));
  assert.equal(JSON.parse(execFileSync(realDocker,['inspect',journal.id],{encoding:'utf8'}))[0].State.Status,'exited');
 }finally{
  process.env.PATH=oldPath;
  try{const journal=JSON.parse(await readFile(join(base.controlDirectory,'child.json'),'utf8'));await base.controller.remove(journal.id,base.req);}
  finally{await rm(scratch,{recursive:true,force:true});}
 }
 empty();
});
