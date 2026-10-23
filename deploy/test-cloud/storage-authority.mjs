import {randomBytes,randomUUID} from 'node:crypto';
import {lstat,mkdir,open,readFile,rename,rm} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {createRequire} from 'node:module';
import {Agent} from 'node:https';
import {setTimeout as delay} from 'node:timers/promises';
import {claimLease} from '../local-stack/lease.mjs';
const require=createRequire(new URL('../../packages/backups/package.json',import.meta.url));
const {S3Client,GetObjectCommand,ListObjectsV2Command}=require('@aws-sdk/client-s3');
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const credentials=()=>({accessKeyId:'managed-'+randomBytes(16).toString('hex'),secretAccessKey:randomBytes(32).toString('base64url')});
function validCredentials(c){return c&&typeof c.accessKeyId==='string'&&c.accessKeyId.length>0&&typeof c.secretAccessKey==='string'&&c.secretAccessKey.length>0;}
function same(a,b){return a.endpoint===b.endpoint&&a.region===b.region&&a.bucket===b.bucket;}
function scope(input,endpoint,region){
 if(!input||!uuid(input.venueId)||input.prefix!==`streams/${input.venueId}/`||!input.location||input.location.endpoint!==endpoint||input.location.region!==region||!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(input.location.bucket))throw Error('test_cloud.storage_scope');
}
async function privateDirectory(path){await mkdir(path,{recursive:true,mode:0o700});const info=await lstat(path);if(!info.isDirectory()||(info.mode&0o777)!==0o700)throw Error('test_cloud.storage_permissions');}
export async function atomicPrivateFile(path,bytes){
 const temporary=path+'.'+randomUUID();let handle;
 try{handle=await open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=undefined;await rename(temporary,path);const dir=await open(dirname(path),'r');try{await dir.sync();}finally{await dir.close();}}
 finally{await handle?.close();await rm(temporary,{force:true});}
}

// This owns one dedicated test IAM file. State is committed before IAM publication:
// a crash can delay withdrawal, but reopening reapplies the durable intent before returning.
export async function openStorageAuthority({directory,iamPath,admin,endpoint,region,ca,reload,authorizeWriter=async()=>true}){
 if(!validCredentials(admin)||typeof reload!=='function'||new URL(endpoint).protocol!=='https:'||!region)throw Error('test_cloud.storage_configuration');
 await privateDirectory(directory);const statePath=join(directory,'state.json');
 async function locked(fn){
  let held;for(let n=0;n<200&&!held;n++){held=await claimLease(join(directory,'.authority.lock'));if(!held)await delay(25);}if(!held)throw Error('test_cloud.storage_busy');
  try{return await fn(held);}finally{await held.release();}
 }
 async function load(){
  let info;try{info=await lstat(statePath);}catch(e){
   if(e.code!=='ENOENT')throw e;
   try{const iam=JSON.parse(await readFile(iamPath,'utf8'));if(!Array.isArray(iam.identities)||iam.identities.some(v=>v.name.startsWith('managed-')))throw Error('test_cloud.storage_state');}
   catch(cause){if(cause.code!=='ENOENT')throw Error('test_cloud.storage_state');}
   return {version:1,venues:{}};
  }
  if(!info.isFile()||(info.mode&0o777)!==0o600)throw Error('test_cloud.storage_permissions');
  try{
   const state=JSON.parse(await readFile(statePath,'utf8'));
   if(state.version!==1||!state.venues||Array.isArray(state.venues)||typeof state.venues!=='object')throw Error();
   const refs=new Set();
   for(const [id,item] of Object.entries(state.venues)){
    scope({venueId:id,...item},endpoint,region);
    if(!Number.isSafeInteger(item.policyRevision)||item.policyRevision<0||!validCredentials(item.reader)||!uuid(item.readerId)||!Array.isArray(item.retired)||!item.retired.every(validCredentials)||item.writer!==null&&(!validCredentials(item.writer)||!uuid(item.writerId)))throw Error();
    for(const c of [item.reader,item.writer,...item.retired].filter(Boolean)){if(refs.has(c.accessKeyId))throw Error();refs.add(c.accessKeyId);}
   }
   return state;
  }catch{throw Error('test_cloud.storage_state');}
 }
 function client(location,auth){return new S3Client({endpoint:location.endpoint,region:location.region,credentials:{...auth},forcePathStyle:true,maxAttempts:1,requestHandler:{httpsAgent:new Agent({ca})}});}
 async function revoked(item,auth){
  const s3=client(item.location,auth);
  try{await s3.send(new ListObjectsV2Command({Bucket:item.location.bucket,Prefix:item.prefix,MaxKeys:1}),{abortSignal:AbortSignal.timeout(2000)});return false;}
  catch(e){if(e?.$metadata?.httpStatusCode===403)return true;throw Error('test_cloud.storage_withdrawal_unverified');}
  finally{s3.destroy();}
 }
 async function publish(state,held){
  let policyError;
  for(const [id,item] of Object.entries(state.venues))if(item.writer){
   let allowed=false;try{allowed=await authorizeWriter(id,item.policyRevision);}catch(error){policyError??=error;}
   if(!allowed){item.retired.push(item.writer);item.writer=null;item.writerId=null;}
  }
  await held.assertOwned();await atomicPrivateFile(statePath,JSON.stringify(state));
  const identities=[{name:'test-cloud-admin',credentials:[{accessKey:admin.accessKeyId,secretKey:admin.secretAccessKey}],actions:['Admin','Read','Write','List','Tagging']}];
  for(const [id,item] of Object.entries(state.venues)){
   const target=`${item.location.bucket}/${item.prefix}*`;
   // SeaweedFS merges static-file reloads; a missing identity remains live.
   // Replace the writer with an explicit disabled identity to remove its old key.
   if(!item.writer)identities.push({name:`managed-writer-${id}`,disabled:true,credentials:[],actions:[]});
   for(const [kind,auth] of [['reader',item.reader],['writer',item.writer]])if(auth)identities.push({name:`managed-${kind}-${id}`,credentials:[{accessKey:auth.accessKeyId,secretKey:auth.secretAccessKey}],actions:kind==='reader'?[`Read:${target}`,`List:${target}`]:[`Read:${target}`,`Write:${target}`,`List:${target}`]});
  }
  await held.assertOwned();await atomicPrivateFile(iamPath,JSON.stringify({identities}));await reload();
  // A successful signal is not evidence of a completed provider reload.
  for(const item of Object.values(state.venues)){
   for(const [auth,wantRefused] of [[item.reader,false],...(item.writer?[[item.writer,false]]:[]),...item.retired.map(auth=>[auth,true])]){
    let applied=false;for(let n=0;n<40&&!applied;n++){applied=(await revoked(item,auth))===wantRefused;if(!applied)await delay(50);}if(!applied)throw Error('test_cloud.storage_withdrawal_unverified');
   }
  }
  if(policyError)throw policyError;
 }
 function output(item){return {writerReference:`managed:${item.writerId}:writer`,readerReference:`managed:${item.readerId}:reader`,writerCredentials:{...item.writer}};}
 const authority={
  async provision(input){
   scope(input,endpoint,region);const revision=input.policyRevision??0;if(!Number.isSafeInteger(revision)||revision<0)throw Error('test_cloud.storage_scope');
   return locked(async held=>{
    const state=await load();let item=state.venues[input.venueId];
    if(item&&(!same(item.location,input.location)||item.prefix!==input.prefix))throw Error('test_cloud.storage_scope');
    if(!item)item=state.venues[input.venueId]={location:{...input.location},prefix:input.prefix,reader:credentials(),readerId:randomUUID(),policyRevision:revision,writer:null,writerId:null,retired:[]};
    if(item.writer&&item.policyRevision!==revision){item.retired.push(item.writer);item.writer=null;item.writerId=null;}
    item.policyRevision=revision;
    if(!item.writer){item.writer=credentials();item.writerId=randomUUID();}
    await publish(state,held);if(!item.writer)throw Error('permission_denied');return output(item);
   });
  },
  async withdrawWriter(venueId,revision){
   if(!uuid(venueId))throw Error('test_cloud.storage_scope');
   return locked(async held=>{const state=await load(),item=state.venues[venueId];if(item?.writer&&(revision===undefined||item.policyRevision===revision)){item.retired.push(item.writer);item.writer=null;item.writerId=null;}await publish(state,held);});
  },
  reconcile:()=>locked(async held=>publish(await load(),held)),
  async reader(input){
   scope(input,endpoint,region);
   return locked(async()=>{const state=await load(),item=state.venues[input.venueId];if(!item||!same(item.location,input.location)||item.prefix!==input.prefix||input.reference!==`managed:${item.readerId}:reader`)throw Error('test_cloud.storage_scope');return {...item.reader};});
  },
  async read(reference,location,key){
   const auth=await locked(async()=>{const state=await load(),item=Object.values(state.venues).find(v=>reference===`managed:${v.readerId}:reader`);if(!item||!same(item.location,location)||typeof key!=='string'||!key.startsWith(item.prefix)||key.includes('..'))throw Error('test_cloud.storage_scope');return {...item.reader};});
   const s3=client(location,auth);try{const result=await s3.send(new GetObjectCommand({Bucket:location.bucket,Key:key}),{abortSignal:AbortSignal.timeout(10000)});return Buffer.from(await result.Body.transformToByteArray());}finally{s3.destroy();}
  }
 };
 await locked(async held=>publish(await load(),held));return authority;
}
