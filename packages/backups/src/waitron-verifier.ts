import {createWriteStream} from 'node:fs';
import {access,mkdtemp,realpath,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import {runNodeVerifier} from './verify-process.ts';
import type {BackupPoint} from './catalogue.ts';
import type {BackupKeys} from './keys.ts';
import {readBackupVerificationRequest,type BackupVerificationRequest,type BackupVerificationResult} from './verification-protocol.ts';
import {readVerificationKey,verificationInput,type VerificationKey} from './verification-transport.ts';
import type {ReplayableObject} from './object-transfer.ts';
export type LegacyRestoreVerifier=(source:ReplayableObject,keys:BackupKeys,point:BackupPoint,signal:AbortSignal)=>Promise<unknown>;
export type NativeDataRestoreVerifier=(source:ReplayableObject,key:VerificationKey,request:BackupVerificationRequest,signal:AbortSignal)=>Promise<BackupVerificationResult>;
interface WaitronVerifierOptions {temporaryRoot?:string;}
// tsx probes a case-inverted checkout path to detect case sensitivity; grant only that alias.
const swapCase=(value:string)=>value.replace(/[a-z]/gi,letter=>letter===letter.toLowerCase()?letter.toUpperCase():letter.toLowerCase());
export async function createWaitronVerifier(checkout:string,options:WaitronVerifierOptions={}):Promise<LegacyRestoreVerifier>{
 let root:string,tsx:string;
 try{
  if(!process.allowedNodeEnvironmentFlags.has('--allow-net'))throw Error();
  root=await realpath(checkout);
  for(const file of ['restore.ts','modules.ts','env-file.ts'])await access(join(root,'apps/server/src',file));
  tsx=createRequire(join(root,'apps/server/package.json')).resolve('tsx');
 }catch{throw Error('backup.verifier_configuration');}
 return async(source,keys,point,signal)=>{
  const temporaryRoot=await realpath(options.temporaryRoot??tmpdir()),temporary=await realpath(await mkdtemp(join(temporaryRoot,'cloud-verify-'))),child=fileURLToPath(new URL('./waitron-verify-child.mjs',import.meta.url));
  try{
   await pipeline(source.open(),createWriteStream(join(temporary,'input.backup.enc'),{flags:'wx',mode:0o600}),{signal});
   return await runNodeVerifier(['--import',tsx,child],{
    cwd:join(root,'apps/server'),signal,readablePaths:[join(root,'**'),join(swapCase(root),'**'),temporary,child],writablePaths:[temporary],allowWorker:true,
    input:{checkout:root,root:temporary,recoveryKey:keys.recoveryKey,sourceNodeId:point.sourceNodeId,modules:point.modules,capturedAt:point.capturedAt},
   });
  }finally{await rm(temporary,{recursive:true,force:true});}
 };
}

// Native integration returns data only; Docker provenance belongs to the trusted controller.
export async function createBoundWaitronVerifier(checkout:string,options:WaitronVerifierOptions={}):Promise<NativeDataRestoreVerifier>{
 let dist:string;
 try{dist=join(await realpath(checkout),'apps/server/dist');await access(join(dist,'backup-verification.js'));await access(join(dist,'drizzle'));}
 catch{throw Error('backup.verifier_configuration');}
 return async(source,key,supplied,signal)=>{
  let request:BackupVerificationRequest,secret:VerificationKey;
  try{request=readBackupVerificationRequest(JSON.stringify(supplied));secret=readVerificationKey(JSON.stringify(key),request);}
  catch{throw Error('backup.verifier_input');}
  if(signal.aborted)throw Error('backup.verifier_cancelled');
  const timeoutMs=Math.min(30000,Date.parse(request.attempt.deadline)-Date.now());
  if(timeoutMs<1)throw Error('backup.verifier_timeout');
  const temporary=await realpath(await mkdtemp(join(await realpath(options.temporaryRoot??tmpdir()),'cloud-bound-verify-')));
  try{
   let input:ReturnType<ReplayableObject['open']>;
   try{input=source.open();}catch{throw Error('backup.verifier_input');}
   try{
   const child=fileURLToPath(new URL('./waitron-data-verify-child.mjs',import.meta.url)),library=fileURLToPath(new URL('./',import.meta.url));
   return await runNodeVerifier([child,dist,temporary],{cwd:dist,signal,timeoutMs,boundRequest:request,inputStream:verificationInput(request,secret,input),readablePaths:[join(dist,'**'),join(library,'**'),temporary],writablePaths:[temporary]}) as BackupVerificationResult;
   }finally{input.destroy();}
  }finally{try{await rm(temporary,{recursive:true,force:true});}catch{throw Error('backup.verifier_cleanup');}}
 };
}
