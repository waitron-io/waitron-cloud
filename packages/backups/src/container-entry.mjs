import {createWriteStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createWaitronVerifier} from './waitron-verifier.ts';
// The container owns this watchdog even if the orchestration process disappears.
const deadline=setTimeout(()=>process.exit(74),30000);
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
}finally{clearTimeout(deadline);}
