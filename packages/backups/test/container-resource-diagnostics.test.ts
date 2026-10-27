import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {Readable} from 'node:stream';
import {createContainerWaitronVerifier} from '../src/container-verifier.ts';
const detail={entryPid:1,entryReason:'child_resource',child:{childPid:9,childExitCode:null,childSignal:'SIGKILL',fatalHeap:false,scratchFull:false,fileLimit:false},memoryBefore:{oom:0,oom_kill:0},memoryAfter:{oom:1,oom_kill:1}};

for(const entryReason of ['child_resource','scratch_full'])test(`the real entry program reports ${entryReason} and both memory snapshots`,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'verifier-entry-report-')),preload=join(directory,'preload.mjs'),input=join(directory,'input');
 const stub=`export async function createWaitronVerifier(){return async()=>{throw Error('backup.verifier_resource',{cause:${JSON.stringify({...detail.child,private:'private-child-secret'})}})}}`;
 const entry=fileURLToPath(new URL('../src/container-entry.mjs',import.meta.url));
 try{
  await writeFile(preload,`import fs from 'node:fs';import {syncBuiltinESMExports,registerHooks} from 'node:module';
const originalRead=fs.readFileSync,originalCreate=fs.createWriteStream,originalStream=fs.createReadStream,originalStat=fs.promises.stat;let count=0;
fs.readFileSync=(path,...args)=>path==='/sys/fs/cgroup/memory.events'?(count++?'oom 1\\noom_kill 1\\n':'oom 0\\noom_kill 0\\n'):originalRead(path,...args);
fs.createWriteStream=(path,...args)=>{if(${JSON.stringify(entryReason)}==='scratch_full')throw Object.assign(Error('private-scratch-secret'),{code:'ENOSPC'});return originalCreate(path==='/scratch/input.backup.enc'?${JSON.stringify(input)}:path,...args)};
fs.createReadStream=(path,...args)=>originalStream(path==='/scratch/input.backup.enc'?${JSON.stringify(input)}:path,...args);
fs.promises.stat=(path,...args)=>originalStat(path==='/scratch/input.backup.enc'?${JSON.stringify(input)}:path,...args);syncBuiltinESMExports();
registerHooks({resolve(specifier,context,next){if(specifier==='./waitron-verifier.ts'&&context.parentURL.endsWith('/container-entry.mjs'))return {url:${JSON.stringify('data:text/javascript,'+encodeURIComponent(stub))},shortCircuit:true};return next(specifier,context)}});`);
  let entryPid:number|undefined;
  const pending=new Promise((resolve,reject)=>{
   const child=execFile(process.execPath,['--import',preload,entry],{timeout:5000},(error,stdout,stderr)=>error?reject(Object.assign(error,{stdout,stderr})):resolve({stdout,stderr}));
   entryPid=child.pid;child.stdin!.end('{}\nprivate-archive');
  });
  await assert.rejects(pending, (error:any)=>{
   assert.equal(error.code,73);
   const line=error.stderr.split('\n').find((line:string)=>line.startsWith('backup.verifier_resource_detail '));
   assert(line,'entry must report its resource boundary');
   assert.deepEqual(JSON.parse(line.slice('backup.verifier_resource_detail '.length)),{...detail,entryReason,child:entryReason==='scratch_full'?null:detail.child,entryPid});
   assert.equal(typeof JSON.parse(line.slice('backup.verifier_resource_detail '.length)).entryPid,'number');
   assert(!error.stderr.includes('private-child-secret'));assert(!error.stderr.includes('private-scratch-secret'));return true;
  });
 }finally{await rm(directory,{recursive:true,force:true});}
});

for(const [name,stderr,exitCode,expected] of [
 ['child killed inside a surviving entry','backup.verifier_resource_detail '+JSON.stringify({...detail,private:'private-container-secret'})+'\n',73,detail],
 ['unavailable child diagnostics','backup.verifier_resource\nprivate-container-secret',73,null],
 ['malformed child diagnostics','backup.verifier_resource_detail {invalid private-container-secret}\n',73,null],
 ['advisory text on a successful exit','backup.verifier_resource_detail '+JSON.stringify(detail)+'\n',0,null],
] as const)test(`container reporting handles ${name} and still removes owned work`,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'verifier-docker-report-')),state=join(directory,'state'),removed=join(directory,'removed'),oldPath=process.env.PATH;
 const wrapper=join(directory,'docker');
 await writeFile(wrapper,`#!${process.execPath}
const fs=require('node:fs'),args=process.argv.slice(2),state=${JSON.stringify(state)};
if(args[0]==='image')console.log(JSON.stringify([{Id:'sha256:fixture',Config:{}}]));
else if(args[0]==='ps')console.log('');
else if(args[0]==='create'){fs.writeFileSync(state,'created');console.log(args[args.indexOf('--name')+1]);}
else if(args[0]==='inspect')console.log(JSON.stringify([{State:{Status:fs.readFileSync(state,'utf8'),ExitCode:${exitCode},OOMKilled:false,Error:''},HostConfig:{Memory:201326592,MemorySwap:201326592,Tmpfs:{'/scratch':'size=16m'},NetworkMode:'none',ReadonlyRootfs:true},Mounts:[]}]));
else if(args[0]==='start'){fs.writeFileSync(state,'running');process.stdin.resume();process.stdin.on('end',()=>{process.stdout.write('{"integrityOk":true}');process.stderr.write(${JSON.stringify(stderr)});fs.writeFileSync(state,'exited');process.exitCode=${exitCode};});}
else if(args[0]==='rm'){fs.writeFileSync(${JSON.stringify(removed)},'removed');console.log('removed');}
else process.exitCode=125;`);await chmod(wrapper,0o700);process.env.PATH=directory+':'+oldPath;
 try{
  const verify=await createContainerWaitronVerifier({image:'fixture',owner:'test',memoryMiB:192,scratchMiB:16});
  const pending=verify({receipt:{size:1,digest:''},open:()=>Readable.from([Buffer.from('x')]),async dispose(){}},{recoveryKey:'private-key'} as never,{} as never,new AbortController().signal);
  if(exitCode===0)assert.deepEqual(await pending,{integrityOk:true});
  else await assert.rejects(pending,(error:any)=>{
   assert.equal(error.message,'backup.verifier_resource');assert.equal(error.cause.oomKilled,false);assert.equal(error.cause.exitCode,73);
   assert.equal(error.cause.status,'exited');assert.equal(error.cause.startError,false);assert.equal(error.cause.attachCode,73);assert.equal(error.cause.uploadFailed,false);
   assert.deepEqual(error.cause.resourceDetail,expected);assert(!JSON.stringify(error.cause).includes('private-container-secret'));return true;
  });
  assert.equal(await readFile(removed,'utf8'),'removed');
 }finally{process.env.PATH=oldPath;await rm(directory,{recursive:true,force:true});}
});
