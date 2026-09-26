import {access,mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runNodeVerifier} from './verify-process.ts';
import type {RestoreVerifier} from './worker.ts';
interface WaitronVerifierOptions {temporaryRoot?:string;}
// tsx probes a case-inverted checkout path to detect case sensitivity; grant only that alias.
const swapCase=(value:string)=>value.replace(/[a-z]/gi,letter=>letter===letter.toLowerCase()?letter.toUpperCase():letter.toLowerCase());
export async function createWaitronVerifier(checkout:string,options:WaitronVerifierOptions={}):Promise<RestoreVerifier>{
 let root:string,tsx:string;
 try{
  if(!process.allowedNodeEnvironmentFlags.has('--allow-net'))throw Error();
  root=await realpath(checkout);
  for(const file of ['restore.ts','modules.ts','env-file.ts'])await access(join(root,'apps/server/src',file));
  tsx=createRequire(join(root,'apps/server/package.json')).resolve('tsx');
 }catch{throw Error('backup.verifier_configuration');}
 return async(bytes,keys,point,signal)=>{
  const temporaryRoot=await realpath(options.temporaryRoot??tmpdir()),temporary=await realpath(await mkdtemp(join(temporaryRoot,'cloud-verify-'))),child=fileURLToPath(new URL('./waitron-verify-child.mjs',import.meta.url));
  try{
   await writeFile(join(temporary,'input.backup.enc'),bytes,{mode:0o600});
   return await runNodeVerifier(['--import',tsx,child],{
    cwd:join(root,'apps/server'),signal,readablePaths:[join(root,'**'),join(swapCase(root),'**'),temporary,child],writablePaths:[temporary],allowWorker:true,
    input:{checkout:root,root:temporary,recoveryKey:keys.recoveryKey,sourceNodeId:point.sourceNodeId,modules:point.modules,capturedAt:point.capturedAt},
   });
  }finally{await rm(temporary,{recursive:true,force:true});}
 };
}
