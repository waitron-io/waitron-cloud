import {Readable} from 'node:stream';
import {parseBackupVerificationJson,readBackupVerificationRequest,type BackupVerificationRequest} from './verification-protocol.ts';
export interface VerificationKey {version:number;reference:string;secret:string;}
export function readVerificationKey(raw:string,request:BackupVerificationRequest):VerificationKey{
 const key=parseBackupVerificationJson(raw,4096) as Record<string,unknown>;
 if(!key||typeof key!=='object'||Array.isArray(key)||Object.keys(key).sort().join(',')!=='reference,secret,version'||key.version!==request.backupKey.version||key.reference!==request.backupKey.reference||typeof key.secret!=='string'||!key.secret||key.secret.length>2048)throw Error('backup.verifier_input');
 return {version:request.backupKey.version,reference:request.backupKey.reference,secret:key.secret};
}
function frame(value:Buffer){const size=Buffer.alloc(4);size.writeUInt32BE(value.length);return [size,value];}
export async function* verificationInput(request:BackupVerificationRequest,key:VerificationKey,source:Readable):AsyncGenerator<Buffer>{
 try{
  const raw=JSON.stringify(request);readBackupVerificationRequest(raw);
  const secret=JSON.stringify(key);readVerificationKey(secret,request);
  for(const value of frame(Buffer.from(raw)))yield value;
  for(const value of frame(Buffer.from(secret)))yield value;
  for await(const chunk of source)yield Buffer.from(chunk);
 }finally{source.destroy();}
}
export async function readVerificationInput(source:AsyncIterable<Uint8Array>){
 const iterator=source[Symbol.asyncIterator]();let pending:Buffer=Buffer.alloc(0);
 async function exact(size:number){
  const value=Buffer.alloc(size);let offset=0;
  while(offset<size){
   if(!pending.length){const part=await iterator.next();if(part.done)throw Error('backup.verifier_input');pending=Buffer.from(part.value.buffer,part.value.byteOffset,part.value.byteLength);}
   const count=Math.min(size-offset,pending.length);pending.copy(value,offset,0,count);pending=pending.subarray(count);offset+=count;
  }
  return value;
 }
 async function textFrame(maximum:number){
  const size=(await exact(4)).readUInt32BE();
  if(!size||size>maximum)throw Error('backup.verifier_input');
  return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await exact(size));
 }
 const request=readBackupVerificationRequest(await textFrame(65536));
 const key=readVerificationKey(await textFrame(4096),request);
 async function* archive(){
  if(pending.length){yield pending;pending=Buffer.alloc(0);}
  for(;;){const part=await iterator.next();if(part.done)return;yield part.value;}
 }
 return {request,key,archive:archive()};
}
