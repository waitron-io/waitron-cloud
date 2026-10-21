import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {runNodeVerifier} from '../src/verify-process.ts';

test('verifier policy permits its scratch directory and denies host reads, writes, network and subprocesses',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cloud-verifier-boundary-')),scratch=join(root,'scratch'),outside=join(root,'outside');
 await mkdir(scratch);
 const code=`(async()=>{const fs=require('node:fs'),net=require('node:net'),cp=require('node:child_process');let readDenied=false,writeDenied=false,childDenied=false,addonDenied=false;try{fs.readFileSync(process.cwd()+'/package.json')}catch(e){readDenied=e.code==='ERR_ACCESS_DENIED'}try{fs.writeFileSync(${JSON.stringify(outside)},'escaped')}catch(e){writeDenied=e.code==='ERR_ACCESS_DENIED'}fs.writeFileSync(${JSON.stringify(join(scratch,'allowed'))},'inside');try{cp.spawn(process.execPath,['-e',''],{stdio:'ignore'})}catch(e){childDenied=e.code==='ERR_ACCESS_DENIED'}try{process.dlopen({exports:{}},'/missing-addon.node')}catch(e){addonDenied=e.code==='ERR_DLOPEN_DISABLED'}const networkDenied=await new Promise(resolve=>{try{const socket=net.createConnection({host:'127.0.0.1',port:9});socket.once('error',e=>resolve(e.code==='ERR_ACCESS_DENIED'));socket.once('connect',()=>{socket.destroy();resolve(false)})}catch(e){resolve(e.code==='ERR_ACCESS_DENIED')}});console.log(JSON.stringify({readDenied,writeDenied,childDenied,addonDenied,networkDenied}))})()`;
 try{
  const result=await runNodeVerifier(['-e',code],{input:{},writablePaths:[scratch]});
  assert.deepEqual(result,{readDenied:true,writeDenied:true,childDenied:true,addonDenied:true,networkDenied:true});
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
 await assert.rejects(runNodeVerifier(['--experimental-permission','-e',"console.log('{}')"],{input:{}}),/^Error: backup.verifier_configuration$/);
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
  await assert.rejects(runNodeVerifier(['-e',`require('node:fs').writeFileSync(${JSON.stringify(target)},Buffer.alloc(4096));console.log('{}')`],{input:{},writablePaths:[root],limits:{maxFileBytes:1024}}),/^Error: backup.verifier_resource$/);
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
 await assert.rejects(runNodeVerifier(['-e',"const values=[];for(let i=0;i<5_000_000;i++)values.push(i);console.log('{}')"],{input:{},timeoutMs:5000,limits:{heapMiB:16}}),/^Error: backup.verifier_resource$/);
});

test('a timed-out verifier is reaped before temporary files are cleaned',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cloud-verifier-reap-')),pidFile=join(root,'pid');let pid=0;
 try{
  // Leave cold-start headroom: this assertion targets reaping after timeout, not process launch speed.
  await assert.rejects(runNodeVerifier(['-e',`require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000)`],{input:{},writablePaths:[root],timeoutMs:1000}),/backup.verifier_timeout/);
  pid=Number(await readFile(pidFile,'utf8'));assert.throws(()=>process.kill(pid,0));
 }finally{if(pid)try{process.kill(pid,'SIGKILL');}catch{/* Already reaped. */}await rm(root,{recursive:true,force:true});}
});

// These cases catch permissive decoding or parsing before the process is reaped.
const boundRequest=JSON.parse(await readFile(new URL('./fixtures/verification-vector.json',import.meta.url),'utf8'));
const boundResult={protocol:'backup-data-restore/v1',requestDigest:'ecac239bf44b948246432671c1f896219d079c9a3a11b1e3a96d7bd6240e786a',attemptToken:'child-1',measuredArchive:{sha256:'1'.repeat(64),bytes:8388608},targetDigest:boundRequest.target.digest,policyDigest:boundRequest.target.policyDigest,modules:['core','orders'].map(name=>({name,semanticsVersion:1,status:'passed',checks:[{code:'data',status:'passed'}]})),status:'passed',reason:'none',activation:'not_attempted'};
const boundRun=(raw:string)=>runNodeVerifier(['-e',`process.stdout.write(${JSON.stringify(raw)})`],{input:{},boundRequest});
test('exit_zero_without_bound_output_refused',async()=>{
 for(const raw of ['', '{}', JSON.stringify({...boundResult,requestDigest:'0'.repeat(64)}),JSON.stringify({...boundResult,attemptToken:'foreign'}),JSON.stringify({...boundResult,modules:[]}),JSON.stringify({...boundResult,activation:'attempted'}),JSON.stringify(boundResult).slice(0,-1)])await assert.rejects(boundRun(raw),/^Error: backup.verifier_output$/);
 assert.deepEqual(await boundRun(JSON.stringify(boundResult)),boundResult);
});
test('bound output refuses duplicate decoded keys and noncanonical numbers before parsing',async()=>{
 const raw=JSON.stringify(boundResult);
 for(const bad of [raw.replace('"bytes":8388608','"bytes":8.388608e6'),raw.replace('"attemptToken":"child-1"','"attemptToken":"foreign","attempt\\u0054oken":"child-1"'),raw.replace('"measuredArchive":{','"measuredArchive":{"bytes":1,')])await assert.rejects(boundRun(bad),/^Error: backup.verifier_output$/);
});
test('bound output refuses malformed UTF-8 and over-limit split output before decoding',async()=>{
 const prefix=Buffer.from(JSON.stringify(boundResult).slice(0,-1)+',"ignored":"');
 await assert.rejects(runNodeVerifier(['-e',`process.stdout.write(Buffer.from(${JSON.stringify([...prefix])}));process.stdout.write(Buffer.from([0xc0]));setImmediate(()=>process.stdout.write(Buffer.from([0xaf,34,125])))`],{input:{},boundRequest}),/^Error: backup.verifier_output$/);
 await assert.rejects(boundRun(JSON.stringify(boundResult)+' '.repeat(32768)),/^Error: backup.verifier_output$/);
});
test('a valid bound result is not admitted before a later process failure or cancellation',async()=>{
 await assert.rejects(runNodeVerifier(['-e',`process.stdout.write(${JSON.stringify(JSON.stringify(boundResult))});process.exitCode=3`],{input:{},boundRequest}),/^Error: backup.verifier_failed$/);
 await assert.rejects(runNodeVerifier(['-e',`process.stdout.write(${JSON.stringify(JSON.stringify(boundResult))});setInterval(()=>{},1000)`],{input:{},boundRequest,timeoutMs:100}),/^Error: backup.verifier_timeout$/);
});
test('streamed private stdin preserves binary bytes without inheriting secrets',async()=>{
 const inputStream=(async function*(){yield Buffer.from([0,255]);yield Buffer.from([1,2]);})();
 assert.deepEqual(await runNodeVerifier(['-e',"const chunks=[];process.stdin.on('data',c=>chunks.push(c));process.stdin.on('end',()=>console.log(JSON.stringify([...Buffer.concat(chunks)])))"],{inputStream}),[0,255,1,2]);
 await assert.rejects(runNodeVerifier(['-e',''],{input:{},inputStream:(async function*(){})()}),/^Error: backup.verifier_input$/);
 await assert.rejects(runNodeVerifier(['-e',"process.stdin.resume()"],{inputStream:(async function*(){yield Buffer.from([1]);throw Error('private input failure')})()}),/^Error: backup.verifier_input$/);
});
test('the bound stdout limit is enforced before waiting for process close',async()=>{
 await assert.rejects(runNodeVerifier(['-e',"process.stdout.write(' '.repeat(32769));setInterval(()=>{},1000)"],{input:{},boundRequest,timeoutMs:1000}),/^Error: backup.verifier_output$/);
});
test('invalid stream configuration refuses before a child can start',async()=>{
 await assert.rejects(runNodeVerifier(['-e',''],{inputStream:{} as never}),/^Error: backup.verifier_input$/);
});
