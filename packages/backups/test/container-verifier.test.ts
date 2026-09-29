import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {Readable} from 'node:stream';
import {DatabaseSync} from 'node:sqlite';
import {before,after,test} from 'node:test';
import {createContainerWaitronVerifier} from '../src/container-verifier.ts';
import {receipt} from '../src/object-transfer.ts';
const root=fileURLToPath(new URL('../../../',import.meta.url)),owner='test-'+randomUUID(),image='cloud-verifier-test:'+owner;
const docker=(...args:string[])=>execFileSync('docker',args,{encoding:'utf8',timeout:120000,stdio:['pipe','pipe','pipe']}).trim();
let bytes:Buffer;
before(async()=>{
 docker('build','-q','-t',image,'-f',join(root,'packages/backups/test/container-fixture/Dockerfile'),root);
 const dir=await mkdtemp(join(tmpdir(),'container-snapshot-'));
 try{const path=join(dir,'data.db'),db=new DatabaseSync(path);db.exec('CREATE TABLE proof(value TEXT)');db.close();bytes=await readFile(path);}finally{await rm(dir,{recursive:true,force:true});}
});
after(()=>{const ids=docker('ps','-aq','--filter','label=cloud.backup-verifier.owner='+owner).split(/\s+/).filter(Boolean);if(ids.length)docker('rm','-f',...ids);docker('image','rm',image);});
const source=(mode:number)=>{const data=Buffer.concat([Buffer.from([mode]),bytes]);return {receipt:receipt(data),open:()=>Readable.from([data]),async dispose(){}};};
const point=(mode:number)=>({sourceNodeId:'00000000-0000-4000-8000-'+String(mode).padStart(12,'0'),modules:{fake:1},capturedAt:'2026-09-26T00:00:00.000Z'} as never);
const keys={recoveryKey:'private-recovery',streamKey:'must-not-cross-boundary'};
const empty=()=>assert.equal(docker('ps','-aq','--filter','label=cloud.backup-verifier.owner='+owner),'');
test('native memory and total scratch exhaustion refuse restoration; the parent verifies a later snapshot',async(t)=>{
 const verify=await createContainerWaitronVerifier({image,owner,memoryMiB:192,scratchMiB:16});
 for(const mode of [1,2]){
  const start=Date.now();await assert.rejects(verify(source(mode),keys,point(mode),new AbortController().signal),(error:any)=>{assert.equal(error.message,'backup.verifier_resource');assert.equal(error.cause.memoryBytes,201326592);assert.equal(error.cause.memorySwapBytes,201326592);assert.deepEqual(error.cause.mounts,[]);assert.equal(error.cause.readOnly,true);assert.equal(error.cause.network,'none');assert.match(error.cause.scratch['/scratch'],/size=16m/);if(mode===1)assert.equal(error.cause.oomKilled,true);t.diagnostic(JSON.stringify({mode,...error.cause}));return true;});
  assert(Date.now()-start<30000);empty();
 }
 const value=await verify(source(0),keys,point(0),new AbortController().signal) as any;
 assert.equal(value.integrityOk,true);assert.equal(value.networkDenied,true);assert.equal(value.outsideWriteDenied,true);assert.equal(value.childProcessDenied,true);empty();
});
test('container cancellation reaps owned work and keeps simultaneous venues isolated',async()=>{
 const verify=await createContainerWaitronVerifier({image,owner,memoryMiB:192,scratchMiB:16}),stop=new AbortController();
 const hanging=verify(source(3),keys,point(3),stop.signal);const rejection=assert.rejects(hanging,/backup.verifier_cancelled/);
 const value=await verify(source(5),keys,point(5),new AbortController().signal) as any;
 assert.equal(value.integrityOk,true);
 const live=docker('ps','-q','--filter','label=cloud.backup-verifier.owner='+owner);assert(live);
 const boundary=JSON.parse(docker('exec',live,'node','-e',`const fs=require('node:fs'),net=require('node:net');let writeDenied=false,socketAbsent=false;try{fs.writeFileSync('/verifier/outside','bad')}catch(e){writeDenied=['EROFS','EACCES'].includes(e.code)}try{fs.statSync('/var/run/docker.sock')}catch(e){socketAbsent=e.code==='ENOENT'}const socket=net.createConnection({host:'1.1.1.1',port:443});socket.on('error',e=>console.log(JSON.stringify({writeDenied,socketAbsent,networkError:e.code})));socket.on('connect',()=>{socket.destroy();console.log('{}')});socket.setTimeout(1000,()=>{socket.destroy();console.log('{}')});`));
 assert.deepEqual(boundary,{writeDenied:true,socketAbsent:true,networkError:'ENETUNREACH'});
 stop.abort();await rejection;empty();
 await assert.rejects(verify(source(0),keys,point(5),new AbortController().signal),/backup.verifier_failed/);empty();
});
test('configuration fails closed before running containers',async()=>{
 for(const settings of [{memoryMiB:0},{scratchMiB:0},{owner:''},{image:''}])await assert.rejects(createContainerWaitronVerifier({image,owner,...settings}),/backup.verifier_configuration/);
 empty();
});

test('input scratch exhaustion is a resource refusal and a broken upload leaves no container',async()=>{
 const verify=await createContainerWaitronVerifier({image,owner,memoryMiB:192,scratchMiB:1}),data=Buffer.alloc(4*1024*1024,1);
 await assert.rejects(verify({receipt:receipt(data),open:()=>Readable.from([data]),async dispose(){}},keys,point(0),new AbortController().signal),/backup.verifier_resource/);empty();
 await assert.rejects(verify({receipt:receipt(data),open:()=>Readable.from((async function*(){yield data.subarray(0,10);throw Error('private upload error');})()),async dispose(){}},keys,point(0),new AbortController().signal),/backup.verifier_input/);empty();
});

test('restart reclaims expired owned work and preserves work within its deadline and foreign work',async()=>{
 const own=docker('create','--label','cloud.backup-verifier.deadline=0','--label','cloud.backup-verifier.owner='+owner,'--entrypoint','node',image,'-e',''),foreign=docker('create','--label','cloud.backup-verifier.owner=foreign-'+owner,'--entrypoint','node',image,'-e',''),live=docker('run','-d','--label','cloud.backup-verifier.deadline='+String(Date.now()+60000),'--label','cloud.backup-verifier.owner='+owner,'--entrypoint','node',image,'-e','setTimeout(()=>{},20000)');
 const expiredLive=docker('run','-d','--label','cloud.backup-verifier.deadline=0','--label','cloud.backup-verifier.owner='+owner,'--entrypoint','node',image,'-e','setInterval(()=>{},1000)');
 const recent=docker('create','--label','cloud.backup-verifier.deadline='+String(Date.now()+60000),'--label','cloud.backup-verifier.owner='+owner,'--entrypoint','node',image,'-e','');
 try{
  docker('start','-a',own);docker('start','-a',recent);
  await createContainerWaitronVerifier({image,owner});
  assert.throws(()=>docker('inspect',own));assert.throws(()=>docker('inspect',expiredLive));
  assert.equal(JSON.parse(docker('inspect',recent))[0].State.Status,'exited');
  assert.equal(JSON.parse(docker('inspect',live))[0].State.Running,true);
  assert.equal(JSON.parse(docker('inspect',foreign))[0].State.Status,'created');
 }finally{for(const id of [own,foreign,live,recent,expiredLive])try{docker('rm','-f',id);}catch{}}
 empty();
});


test('a killed worker leaves bounded work that the next startup reaps', {timeout:90000},async()=>{
 const adapter=new URL('../src/container-verifier.ts',import.meta.url).href;
 const child=spawn(process.execPath,['--input-type=module','-e',`import {createContainerWaitronVerifier} from ${JSON.stringify(adapter)};import {Readable} from 'node:stream';const verify=await createContainerWaitronVerifier(${JSON.stringify({image,owner,memoryMiB:192,scratchMiB:16})});await verify({receipt:{size:1,digest:''},open:()=>Readable.from([Buffer.from([3])]),async dispose(){}},{recoveryKey:'fixture'},${JSON.stringify(point(3))},new AbortController().signal);`],{stdio:'ignore'});
 const done=new Promise(resolve=>child.once('close',resolve));let id='';
 try{
  const deadline=Date.now()+10000;while(!id&&Date.now()<deadline){id=docker('ps','-q','--filter','label=cloud.backup-verifier.owner='+owner);if(!id)await delay(50);}
  assert(id);child.kill('SIGKILL');await done;
  const expiry=Date.now()+35000;while(JSON.parse(docker('inspect',id))[0].State.Running&&Date.now()<expiry)await delay(250);
  assert.equal(JSON.parse(docker('inspect',id))[0].State.Running,false);
  const reclaimAt=Number(JSON.parse(docker('inspect',id))[0].Config.Labels['cloud.backup-verifier.deadline']);
  await delay(Math.max(0,reclaimAt-Date.now()+50));
  await createContainerWaitronVerifier({image,owner});empty();
 }finally{child.kill('SIGKILL');await done;if(id)try{docker('rm','-f',id);}catch{}}
});


test('scratch refusal retains its resource reason with a file-backed streaming source',async()=>{
 const verify=await createContainerWaitronVerifier({image,owner,memoryMiB:192,scratchMiB:1}),dir=await mkdtemp(join(tmpdir(),'container-stream-')),path=join(dir,'archive'),data=Buffer.alloc(4*1024*1024,1);
 try{await writeFile(path,data);await assert.rejects(verify({receipt:receipt(data),open:()=>createReadStream(path),async dispose(){}},keys,point(0),new AbortController().signal),/backup.verifier_resource/);empty();}
 finally{await rm(dir,{recursive:true,force:true});}
});


test('scratch exhaustion fills the bounded filesystem independently of child error text',async(t)=>{
 const verify=await createContainerWaitronVerifier({image,owner,memoryMiB:192,scratchMiB:16}),stop=new AbortController(),pending=verify(source(6),keys,point(6),stop.signal),cancelled=assert.rejects(pending,/backup.verifier_cancelled/);
 let capacity=0,free=-1;
 try{
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){
   const id=docker('ps','-q','--filter','label=cloud.backup-verifier.owner='+owner);
   if(id){const info=JSON.parse(docker('exec',id,'node','-e',`const fs=require('node:fs'),s=fs.statfsSync('/scratch');console.log(JSON.stringify({capacity:s.blocks*s.bsize,free:s.bavail*s.bsize}))`));capacity=info.capacity;free=info.free;if(free===0)break;}
   await delay(50);
  }
  assert.equal(capacity,16777216);assert.equal(free,0);t.diagnostic(JSON.stringify({scratchCapacityBytes:capacity,scratchFreeBytes:free}));
 }finally{stop.abort();await cancelled;}empty();
});

test('the verifier pins its image and refuses images with extra writable volumes',async()=>{
 const alias=image+'-alias',volume=image+'-volume';
 try{
  docker('tag',image,alias);const verify=await createContainerWaitronVerifier({image:alias,owner});
  docker('tag','node:26',alias);assert.equal((await verify(source(0),keys,point(0),new AbortController().signal) as any).integrityOk,true);empty();
  execFileSync('docker',['build','-q','-t',volume,'-'],{input:`FROM ${image}\nVOLUME /extra\n`,encoding:'utf8',timeout:120000,stdio:['pipe','pipe','pipe']});
  await assert.rejects(createContainerWaitronVerifier({image:volume,owner}),/backup.verifier_configuration/);empty();
 }finally{for(const tag of [alias,volume])try{docker('image','rm',tag);}catch{}}
});
