import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {mkdir,open,readFile,rm,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {atomicPrivateFile} from './storage-authority.mjs';
const execute=promisify(execFile),idPattern=/^[a-f0-9]{64}$/,imagePattern=/^sha256:[a-f0-9]{64}$/;
async function docker(args,{missing}={}){
 try{return (await execute('docker',args,{timeout:10000,maxBuffer:65536})).stdout.trim();}
 catch(error){if(missing&&error.code===1&&!error.signal&&!error.killed&&[`error: no such object: ${missing}`,`error response from daemon: no such container: ${missing}`].includes(error.stderr?.trim().toLowerCase()))return '';throw Error('test_cloud.verifier_docker');}
}
export async function openVerifierController({directory,owner,image}){
 if(!imagePattern.test(image??'')||!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(owner??''))throw Error('test_cloud.verifier_configuration');
 await mkdir(directory,{recursive:true,mode:0o700});const info=await lstat(directory);
 if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o077)!==0)throw Error('test_cloud.verifier_configuration');
 const identity=join(directory,'identity.json'),child=join(directory,'child.json');
 try{const file=await open(identity,'wx',0o600);try{await file.writeFile(JSON.stringify({version:1,owner,image,scope:randomUUID()}));await file.sync();}finally{await file.close();}}
 catch(error){if(error.code!=='EEXIST')throw error;}
 const saved=JSON.parse(await readFile(identity,'utf8'));
 if(saved.version!==1||saved.owner!==owner||saved.image!==image||!/^[-a-f0-9]{36}$/.test(saved.scope??''))throw Error('test_cloud.verifier_ownership');
 const labels={ 'cloud.backup-verifier.owner':owner,'cloud.backup-verifier.scope':saved.scope };
 async function journal(){try{const state=JSON.parse(await readFile(child,'utf8'));if(!/^[-a-f0-9]{36}$/.test(state.token??'')||!Number.isSafeInteger(state.deadline)||state.id!==null&&!idPattern.test(state.id??''))throw Error();return state;}catch(error){if(error.code==='ENOENT')return null;throw Error('test_cloud.verifier_ownership');}}
 async function inspect(id,state){
  if(!idPattern.test(id))throw Error('test_cloud.verifier_ownership');
  const text=await docker(['inspect',id],{missing:id});if(!text)return null;
  const [container]=JSON.parse(text);
  if(container.Id!==id||container.Image!==image||Object.entries({...labels,'cloud.backup-verifier.token':state.token}).some(([key,value])=>container.Config.Labels?.[key]!==value))throw Error('test_cloud.verifier_ownership');
  return container;
 }
 async function discover(state){
  const ids=(await docker(['ps','-aq','--no-trunc',...Object.entries({...labels,'cloud.backup-verifier.token':state.token}).flatMap(([key,value])=>['--filter',`label=${key}=${value}`])])).split(/\s+/).filter(Boolean);
  if(ids.length>1||ids.some(id=>!idPattern.test(id))||state.id&&ids.some(id=>id!==state.id))throw Error('test_cloud.verifier_ownership');
  return state.id??ids[0]??null;
 }
 async function remove(id){
  const state=await journal();if(!state||!idPattern.test(id)||await discover(state)!==id)throw Error('test_cloud.verifier_ownership');
  if(await inspect(id,state))await docker(['rm','-f',id],{missing:id});
  await rm(child);
 }
 async function reclaim(){
  const state=await journal();if(!state){
   const found=await docker(['ps','-aq','--no-trunc',...Object.entries(labels).flatMap(([key,value])=>['--filter',`label=${key}=${value}`])]);
   if(found)throw Error('test_cloud.verifier_ownership');return;
  }
  if(state.deadline>=Date.now())throw Error('test_cloud.verifier_busy');
  const id=await discover(state);if(id)await remove(id);else await rm(child);
 }
 await reclaim();
 return {reclaim,remove,async create(args){
  const state={token:randomUUID(),deadline:Date.now()+60000,id:null};
  let file;try{file=await open(child,'wx',0o600);}catch(error){if(error.code==='EEXIST')throw Error('test_cloud.verifier_busy');throw error;}
  try{await file.writeFile(JSON.stringify(state));await file.sync();}finally{await file.close();}
  // Intent is written before Docker runs; an interrupted create is found only by its private token.
  try{
   const id=await docker(['create',...Object.entries({...labels,'cloud.backup-verifier.token':state.token}).flatMap(([key,value])=>['--label',`${key}=${value}`]),...args]);
   if(!idPattern.test(id))throw Error('test_cloud.verifier_ownership');
   await inspect(id,state);await atomicPrivateFile(child,JSON.stringify({...state,id}));return id;
  }catch(error){const id=await discover(state);if(id)await remove(id);throw error;}
 }};
}
