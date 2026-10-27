import {createWriteStream} from 'node:fs';
import {spawn} from 'node:child_process';
import {stat} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createWaitronVerifier} from './waitron-verifier.ts';
import {readVerifierMemoryEvents,verifierResourceDiagnostic} from './verify-process.ts';
if(process.argv[2]==='--bound'){
 const child=spawn(process.execPath,['--max-old-space-size=512','--permission','--allow-fs-read=/waitron/apps/server/dist/','--allow-fs-read=/verifier/','--allow-fs-read=/scratch/','--allow-fs-write=/scratch/','/verifier/waitron-data-verify-child.mjs','/waitron/apps/server/dist','/scratch'],{env:{TMPDIR:'/scratch'},stdio:['pipe','pipe','pipe']});
 let expired=false;
 // The watchdog has its own event loop so synchronous verifier code cannot block it.
 const watchdog=setTimeout(()=>{expired=true;child.kill('SIGKILL');},30000);
 child.on('error',()=>{});
 child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
 const upload=pipeline(process.stdin,child.stdin).catch(()=>{});
 const outcome=await new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
 clearTimeout(watchdog);process.stdin.destroy();await upload;
 process.exitCode=expired?74:['SIGXCPU','SIGXFSZ','SIGKILL','SIGABRT'].includes(outcome.signal)?73:outcome.code??1;
}else{
// The container owns this watchdog even if the orchestration process disappears.
const deadline=setTimeout(()=>process.exit(74),30000);
const memoryBefore=readVerifierMemoryEvents();
try{
 const iterator=process.stdin[Symbol.asyncIterator]();let head=Buffer.alloc(0),tail;
 while(tail===undefined){
  const part=await iterator.next();if(part.done)throw Error('missing header');
  const newline=part.value.indexOf(10);
  if(newline<0){head=Buffer.concat([head,part.value]);}else{head=Buffer.concat([head,part.value.subarray(0,newline)]);tail=part.value.subarray(newline+1);}
  if(head.length>65536)throw Error('large header');
 }
 const request=JSON.parse(head.toString()),path='/scratch/input.backup.enc';
 await pipeline(Readable.from((async function*(){yield tail;for(;;){const part=await iterator.next();if(part.done)return;yield part.value;}})()),createWriteStream(path,{flags:'wx',mode:0o600}));
 const verify=await createWaitronVerifier('/waitron',{temporaryRoot:'/scratch'});
 const {createReadStream}=await import('node:fs');
 const result=await verify({receipt:{size:(await stat(path)).size,digest:''},open:()=>createReadStream(path),async dispose(){}},{recoveryKey:request.recoveryKey},{sourceNodeId:request.sourceNodeId,modules:request.modules,capturedAt:request.capturedAt},new AbortController().signal);
 console.log(JSON.stringify(result));
}catch(error){
 process.exitCode=error.code==='ENOSPC'||error.message==='backup.verifier_resource'?73:1;
 // Restore errors may carry secret archive content; only a fixed diagnostic leaves the container.
 console.error(process.exitCode===73?'backup.verifier_resource':'backup.verifier_failed');
 if(process.exitCode===73)console.error('backup.verifier_resource_detail '+JSON.stringify(verifierResourceDiagnostic({entryPid:process.pid,entryReason:error.code==='ENOSPC'?'scratch_full':'child_resource',child:error.cause,memoryBefore,memoryAfter:readVerifierMemoryEvents()})));
}finally{clearTimeout(deadline);}

}
