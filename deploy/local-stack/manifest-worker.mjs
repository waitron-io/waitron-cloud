import {createPrivateKey,createPublicKey} from 'node:crypto';
import {mkdir,open,readFile,rename,rm,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {signManifest,verifyManifest} from '../../packages/remote-access/src/manifest.ts';
import {loadRuntime} from './runtime.mjs';

async function privateFile(path){const info=await stat(path);if((info.mode&0o777)!==0o600)throw Error();return readFile(path);}
async function atomic(directory,name,value){
 const temporary=join(directory,`.${name}.${process.pid}.tmp`),path=join(directory,name),file=await open(temporary,'wx',0o600);
 try{await file.writeFile(value);await file.sync();}finally{await file.close();}await rename(temporary,path);const dir=await open(directory,'r');try{await dir.sync();}finally{await dir.close();}
}
async function lock(directory){try{const path=join(directory,'.manifest.lock');await mkdir(path,{mode:0o700});return path;}catch{throw new Error('local_stack.manifest_busy');}}
function existingSequence(envelope,publicKey,cellId){
 try{const decoded=JSON.parse(Buffer.from(envelope.payload,'base64url').toString('utf8'));return verifyManifest(envelope,publicKey,cellId,decoded.issuedAt).sequence;}catch{throw new Error('local_stack.manifest_state_invalid');}
}
export async function refreshManifest(directory,{now=Date.now(),afterSequence=async()=>{}}={}){
 const held=await lock(directory);
 try{
  const config=await loadRuntime(directory),sequenceText=(await privateFile(join(directory,'gateway-sequence'))).toString().trim(),sequence=Number(sequenceText);
  if(!Number.isSafeInteger(sequence)||sequence<1)throw new Error('local_stack.manifest_state_invalid');
  const envelope=JSON.parse(await readFile(join(directory,'gateway-manifest.json'),'utf8')),publicKey=createPublicKey(await privateFile(join(directory,'gateway-issuer.pem')));
  if(existingSequence(envelope,publicKey,config.gateway.cellId)!==sequence)throw new Error('local_stack.manifest_state_invalid');
  const next=sequence+1,expiresAt=now+540000,privateKey=createPrivateKey(await privateFile(join(directory,'gateway-signing-key.pem')));
  const signed=signManifest({version:1,audience:'waitron-cloud-gateway',cellId:config.gateway.cellId,sequence:next,issuedAt:now,expiresAt,routes:[]},privateKey,now);
  await atomic(directory,'gateway-sequence',next+'\n');await afterSequence();await atomic(directory,'gateway-manifest.json',JSON.stringify(signed));
  const status={version:1,sequence:next,publishedAt:new Date(now).toISOString(),expiresAt:new Date(expiresAt).toISOString()};await atomic(directory,'gateway-manifest-status.json',JSON.stringify(status));return status;
 }catch(error){if(error instanceof Error&&error.message.startsWith('local_stack.'))throw error;throw new Error('local_stack.manifest_state_invalid');}
 finally{await rm(held,{recursive:true,force:true});}
}
export async function runManifestWorker({directory=process.env.LOCAL_STACK_CONFIG_DIR??'/run/local-stack',signal,now=Date.now,wait=(ms,abort)=>delay(ms,undefined,{signal:abort})}){
 while(!signal.aborted){await refreshManifest(directory,{now:now()});try{await wait(240000,signal);}catch(error){if(signal.aborted&&error?.name==='AbortError')return;throw error;}}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const stop=new AbortController(),shutdown=()=>stop.abort();process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
 try{await runManifestWorker({signal:stop.signal});}catch{console.error('Local gateway manifest worker failed; check its private authority state');process.exitCode=1;}
 finally{process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);}
}
