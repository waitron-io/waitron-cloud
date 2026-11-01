import {execFile} from 'node:child_process';
import {constants} from 'node:fs';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {mkdir,open,rm,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {atomicPrivateFile} from './storage-authority.mjs';
import {readBackupVerificationRequest,backupVerificationRequestDigest,parseBackupVerificationJson} from '../../packages/backups/src/verification-protocol.ts';
const execute=promisify(execFile),idPattern=/^[a-f0-9]{64}$/,imagePattern=/^sha256:[a-f0-9]{64}$/;
async function docker(args,{missing}={}){
 const started=performance.now();
 try{return (await execute('docker',args,{timeout:10000,maxBuffer:65536})).stdout.trim();}
 catch(error){if(missing&&error.code===1&&!error.signal&&!error.killed&&[`error: no such object: ${missing}`,`error response from daemon: no such container: ${missing}`].includes(error.stderr?.trim().toLowerCase()))return '';throw Error('test_cloud.verifier_docker',{cause:{operation:args[0],code:Number.isInteger(error.code)?error.code:['ENOENT','ETIMEDOUT','ERR_CHILD_PROCESS_STDIO_MAXBUFFER'].includes(error.code)?error.code:null,signal:['SIGTERM','SIGKILL','SIGABRT'].includes(error.signal)?error.signal:null,killed:error.killed===true,elapsedMs:Math.max(0,Math.round(performance.now()-started))}});}
}
async function privateState(path){
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const info=await file.stat();
  if(!info.isFile()||(info.mode&0o077)!==0||info.size>131072)throw Error('test_cloud.verifier_ownership');
  const bytes=Buffer.alloc(131073),{bytesRead}=await file.read(bytes,0,bytes.length,0);
  if(bytesRead>131072)throw Error('test_cloud.verifier_ownership');
  return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,bytesRead));
 }finally{await file.close();}
}
export async function openVerifierController({directory,owner,image}){
 if(!imagePattern.test(image??'')||!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(owner??''))throw Error('test_cloud.verifier_configuration');
 await mkdir(directory,{recursive:true,mode:0o700});const info=await lstat(directory);
 if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o077)!==0)throw Error('test_cloud.verifier_configuration');
 const identity=join(directory,'identity.json'),child=join(directory,'child.json');
 try{const file=await open(identity,'wx',0o600);try{await file.writeFile(JSON.stringify({version:1,owner,image,scope:randomUUID()}));await file.sync();}finally{await file.close();}}
 catch(error){if(error.code!=='EEXIST')throw error;}
 let saved;try{saved=parseBackupVerificationJson(await privateState(identity),131072);}catch{throw Error('test_cloud.verifier_ownership');}
 if(!saved||saved.version!==1||saved.owner!==owner||saved.image!==image||!/^[-a-f0-9]{36}$/.test(saved.scope??''))throw Error('test_cloud.verifier_ownership');
 const labels={ 'cloud.backup-verifier.owner':owner,'cloud.backup-verifier.scope':saved.scope };
 function binding(supplied){
  try{
   const request=readBackupVerificationRequest(JSON.stringify(supplied));
   if(request.attempt.controllerScope!==saved.scope||request.verifierImage!=='local.waitron-verifier@'+image)throw Error();
   return request;
  }catch{throw Error('test_cloud.verifier_ownership');}
 }
 function ownedLabels(state){return {...labels,'cloud.backup-verifier.token':state.token,...(state.version===2?{'cloud.backup-verifier.claim':state.request.attempt.claimId,'cloud.backup-verifier.request':state.requestDigest,'cloud.backup-verifier.deadline':String(state.deadline)}:{})};}
 async function journal(){
  try{
   const state=parseBackupVerificationJson(await privateState(child),131072);
   if(!Number.isSafeInteger(state.deadline)||state.id!==null&&!idPattern.test(state.id??''))throw Error();
   if(state.version===2){
    if(Object.keys(state).sort().join(',')!=='deadline,id,request,requestDigest,token,version')throw Error();
    const request=binding(state.request);
    if(state.token!==request.attempt.childToken||state.deadline!==Date.parse(request.attempt.deadline)||state.requestDigest!==backupVerificationRequestDigest(request))throw Error();
   }else if(state.version!==undefined||!/^[-a-f0-9]{36}$/.test(state.token??''))throw Error();
   return state;
  }catch(error){if(error.code==='ENOENT')return null;throw Error('test_cloud.verifier_ownership');}
 }
 async function inspect(id,state){
  if(!idPattern.test(id))throw Error('test_cloud.verifier_ownership');
  const text=await docker(['inspect',id],{missing:id});if(!text)return null;
  const [container]=JSON.parse(text);
  if(container.Id!==id||container.Image!==image||Object.entries(ownedLabels(state)).some(([key,value])=>container.Config.Labels?.[key]!==value))throw Error('test_cloud.verifier_ownership');
  return container;
 }
 async function discover(state){
  const ids=(await docker(['ps','-aq','--no-trunc',...Object.entries({...labels,'cloud.backup-verifier.token':state.token}).flatMap(([key,value])=>['--filter',`label=${key}=${value}`])])).split(/\s+/).filter(Boolean);
  if(ids.length>1||ids.some(id=>!idPattern.test(id))||state.id&&ids.some(id=>id!==state.id))throw Error('test_cloud.verifier_ownership');
  return state.id??ids[0]??null;
 }
 async function remove(id,supplied){
  let stage='journal';
  try{
   const state=await journal();if(!state||!idPattern.test(id))throw Error('test_cloud.verifier_ownership');
   stage='request-binding';
   if(state.version===2){if(backupVerificationRequestDigest(binding(supplied))!==state.requestDigest)throw Error('test_cloud.verifier_ownership');}
   else if(supplied!==undefined)throw Error('test_cloud.verifier_ownership');
   stage='discover';if(await discover(state)!==id)throw Error('test_cloud.verifier_ownership');
   stage='inspect-owned';
   if(await inspect(id,state)){stage='remove-child';await docker(['rm','-f',id],{missing:id});}
   stage='confirm-absent';if(state.version===2&&await inspect(id,state))throw Error('test_cloud.verifier_ownership');
   stage='remove-journal';await rm(child);
  }catch(error){
   // Only fixed controller errors carry command diagnostics; daemon text stays private.
   if(error.message==='test_cloud.verifier_docker'||error.message==='test_cloud.verifier_ownership')throw Error(error.message,{cause:{stage,...(error.message==='test_cloud.verifier_docker'?error.cause:{})}});
   throw error;
  }
 }
 async function reclaim(){
  const state=await journal();if(!state){
   const found=await docker(['ps','-aq','--no-trunc',...Object.entries(labels).flatMap(([key,value])=>['--filter',`label=${key}=${value}`])]);
   if(found)throw Error('test_cloud.verifier_ownership');return;
  }
  if(state.deadline>=Date.now())throw Error('test_cloud.verifier_busy');
  const id=await discover(state);if(id)await remove(id,state.request);else if(state.version===2)throw Error('test_cloud.verifier_ownership');else await rm(child);
 }
 await reclaim();
 return {scope:saved.scope,reclaim,remove,async create(args,supplied){
  let state;
  if(supplied!==undefined){
   const request=binding(supplied),deadline=Date.parse(request.attempt.deadline);
   if(deadline<=Date.now()||deadline>Date.now()+30000||!Array.isArray(args)||args.some(arg=>typeof arg!=='string'||arg.includes('cloud.backup-verifier.')))throw Error('test_cloud.verifier_ownership');
   state={version:2,request,requestDigest:backupVerificationRequestDigest(request),token:request.attempt.childToken,deadline,id:null};
  }else state={token:randomUUID(),deadline:Date.now()+60000,id:null};
  let file;try{file=await open(child,'wx',0o600);}catch(error){if(error.code==='EEXIST')throw Error('test_cloud.verifier_busy');throw error;}
  try{await file.writeFile(JSON.stringify(state));await file.sync();}finally{await file.close();}
  // Intent is written before Docker runs; an interrupted create is found only by its private token.
  try{
   const id=await docker(['create',...Object.entries(ownedLabels(state)).flatMap(([key,value])=>['--label',`${key}=${value}`]),...args]);
   if(!idPattern.test(id))throw Error('test_cloud.verifier_ownership');
   const present=await inspect(id,state);if(state.version===2&&!present)throw Error('test_cloud.verifier_ownership');await atomicPrivateFile(child,JSON.stringify({...state,id}));return id;
  }catch(error){const id=await discover(state);if(id)await remove(id,state.request);throw error;}
 }};
}
