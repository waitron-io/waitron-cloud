import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {runNodeVerifier} from '../src/verify-process.ts';

test('verifier policy permits its scratch directory and denies host reads, writes, network and subprocesses',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cloud-verifier-boundary-')),scratch=join(root,'scratch'),outside=join(root,'outside');
 await mkdir(scratch);
 const code=`(async()=>{const fs=require('node:fs'),net=require('node:net'),cp=require('node:child_process');let readDenied=false,writeDenied=false,childDenied=false;try{fs.readFileSync(process.cwd()+'/package.json')}catch(e){readDenied=e.code==='ERR_ACCESS_DENIED'}try{fs.writeFileSync(${JSON.stringify(outside)},'escaped')}catch(e){writeDenied=e.code==='ERR_ACCESS_DENIED'}fs.writeFileSync(${JSON.stringify(join(scratch,'allowed'))},'inside');try{cp.spawn(process.execPath,['-e',''],{stdio:'ignore'})}catch(e){childDenied=e.code==='ERR_ACCESS_DENIED'}const networkDenied=await new Promise(resolve=>{try{const socket=net.createConnection({host:'127.0.0.1',port:9});socket.once('error',e=>resolve(e.code==='ERR_ACCESS_DENIED'));socket.once('connect',()=>{socket.destroy();resolve(false)})}catch(e){resolve(e.code==='ERR_ACCESS_DENIED')}});console.log(JSON.stringify({readDenied,writeDenied,childDenied,networkDenied}))})()`;
 try{
  const result=await runNodeVerifier(['-e',code],{input:{},writablePaths:[scratch]});
  assert.deepEqual(result,{readDenied:true,writeDenied:true,childDenied:true,networkDenied:true});
  assert.equal(await readFile(join(scratch,'allowed'),'utf8'),'inside');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('verifier process receives private input without inheriting application secrets',async()=>{
 process.env.CLOUD_PROCESS_TEST_SECRET='private-test-value';
 try{const value=await runNodeVerifier(['-e',"let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>console.log(JSON.stringify({input:JSON.parse(s),secret:process.env.CLOUD_PROCESS_TEST_SECRET??null})))"],{input:{key:'private-stdin-value'}});assert.deepEqual(value,{input:{key:'private-stdin-value'},secret:null});}finally{delete process.env.CLOUD_PROCESS_TEST_SECRET;}
});
test('verifier callers cannot widen the fixed process policy with Node permission flags',async()=>{
 await assert.rejects(runNodeVerifier(['--allow-child-process','-e',"console.log('{}')"],{input:{}}),/^Error: backup.verifier_configuration$/);
 await assert.rejects(runNodeVerifier(['--allow-net','-e',"console.log('{}')"],{input:{}}),/^Error: backup.verifier_configuration$/);
 await assert.rejects(runNodeVerifier(['--allow-fs-read=*','-e',"console.log('{}')"],{input:{}}),/^Error: backup.verifier_configuration$/);
});
test('verifier process bounds time, output and cancellation without echoing child errors',async()=>{
 await assert.rejects(runNodeVerifier(['-e','setInterval(()=>{},1000)'],{input:{},timeoutMs:100}),/^Error: backup.verifier_timeout$/);
 await assert.rejects(runNodeVerifier(['-e',"console.log('private-output'.repeat(10000))"],{input:{}}),/^Error: backup.verifier_output$/);
 await assert.rejects(runNodeVerifier(['-e',"console.error('private-error');process.exit(3)"],{input:{}}),/^Error: backup.verifier_failed$/);
 const stop=new AbortController();const pending=runNodeVerifier(['-e','setInterval(()=>{},1000)'],{input:{},signal:stop.signal});stop.abort();await assert.rejects(pending,/backup.verifier_cancelled/);
 await assert.rejects(runNodeVerifier(['-e',"console.log('invalid JSON')"],{input:{}}),/backup.verifier_output/);
});

test('verifier CPU use is stopped by the resource limit before its wall deadline',async()=>{
 const started=Date.now();
 await assert.rejects(runNodeVerifier(['-e','for(;;){}'],{input:{},timeoutMs:5000,limits:{cpuSeconds:1}}),/^Error: backup.verifier_resource$/);
 assert(Date.now()-started<4000);
});

test('verifier cannot create a file beyond its resource limit',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cloud-verifier-file-limit-')),target=join(root,'too-large');
 try{
  await assert.rejects(runNodeVerifier(['-e',`require('node:fs').writeFileSync(${JSON.stringify(target)},Buffer.alloc(4096));console.log('{}')`],{input:{},writablePaths:[root],limits:{maxFileBytes:1024}}),/backup\.verifier_(?:failed|resource)/);
  assert((await stat(target).catch(()=>({size:0}))).size<=1024);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('verifier cannot exhaust the worker host file descriptors',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cloud-verifier-open-files-'));
 const code=`const fs=require('node:fs'),fds=[];let opened=0,error=null;try{for(;opened<256;opened++)fds.push(fs.openSync(${JSON.stringify(root)}+'/'+opened,'w'))}catch(e){error=e.code}for(const fd of fds)fs.closeSync(fd);console.log(JSON.stringify({opened,error}))`;
 try{
  const result=await runNodeVerifier(['-e',code],{input:{},writablePaths:[root],limits:{maxOpenFiles:128}}) as {opened:number;error:string};
  assert(result.opened<128);
  assert(['EMFILE','ENFILE'].includes(result.error));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('verifier JavaScript allocations stay inside the configured heap ceiling',async()=>{
 await assert.rejects(runNodeVerifier(['-e',"const values=[];for(let i=0;i<5_000_000;i++)values.push(i);console.log('{}')"],{input:{},timeoutMs:5000,limits:{heapMiB:16}}),/backup\.verifier_(?:failed|resource)/);
});

test('a timed-out verifier is reaped before temporary files are cleaned',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cloud-verifier-reap-')),pidFile=join(root,'pid');let pid=0;
 try{
  await assert.rejects(runNodeVerifier(['-e',`require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000)`],{input:{},writablePaths:[root],timeoutMs:100}),/backup.verifier_timeout/);
  pid=Number(await readFile(pidFile,'utf8'));assert.throws(()=>process.kill(pid,0));
 }finally{if(pid)try{process.kill(pid,'SIGKILL');}catch{/* Already reaped. */}await rm(root,{recursive:true,force:true});}
});
