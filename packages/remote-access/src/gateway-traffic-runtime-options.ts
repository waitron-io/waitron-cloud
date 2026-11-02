import {createPrivateKey,createPublicKey,type KeyObject} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,open,realpath} from 'node:fs/promises';
import {dirname,isAbsolute,normalize,relative} from 'node:path';
import {type GatewayTrafficOptions} from './gateway-traffic-options.ts';
import {isUuid} from './manifest.ts';
import type {TrafficMapping} from './traffic-coverage.ts';

interface Configuration {directory:string;keyFile:string;lifetimeSocket:string;socketDirectory:string;mapping:TrafficMapping;maxBytes:number}
export interface GatewayTrafficRuntimeOptions {directory:string;lifetimeSocket:string;mapping:TrafficMapping;maxBytes:number;reporterKey:KeyObject}
const names=['STATE_DIRECTORY','REPORTER_KEY','REPORT_DIRECTORY','LIFETIME_SOCKET','READER_GID','MAX_BYTES'].map(n=>'GATEWAY_TRAFFIC_'+n);
function unavailable():never{throw new Error('traffic_runtime_unavailable');}
function path(value:unknown):string{
 if(typeof value!=='string'||!isAbsolute(value)||normalize(value)!==value||value==='/')unavailable();return value;
}
function within(parent:string,child:string):boolean{const r=relative(parent,child);return r===''||r!=='..'&&!r.startsWith('../')&&!isAbsolute(r);}
function integer(value:unknown,min:number,max:number):number{
 if(typeof value!=='string'||!/^(0|[1-9][0-9]*)$/.test(value))unavailable();
 const n=Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)unavailable();return n;
}
/** Validate the complete opt-in before the gateway opens credentials or changes its network namespace. */
export function gatewayTrafficRuntimeConfiguration(env:NodeJS.ProcessEnv,traffic:GatewayTrafficOptions|undefined,cellId:string):Configuration|undefined{
 try{
  if(!traffic){if(names.some(n=>env[n]!==undefined))unavailable();return;}
  if(!isUuid(cellId))unavailable();
  const directory=path(env.GATEWAY_TRAFFIC_STATE_DIRECTORY),keyFile=path(env.GATEWAY_TRAFFIC_REPORTER_KEY),reportDirectory=path(env.GATEWAY_TRAFFIC_REPORT_DIRECTORY);
  const socketDirectory=path(traffic.socketDirectory),lifetimeSocket=path(env.GATEWAY_TRAFFIC_LIFETIME_SOCKET);
  if(lifetimeSocket.length>100||!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.sock$/.test(lifetimeSocket))unavailable();
  const roots=[directory,reportDirectory,socketDirectory,dirname(lifetimeSocket)];
  for(let i=0;i<roots.length;i++){
   if(within(roots[i]!,keyFile))unavailable();
   for(let j=0;j<i;j++)if(within(roots[i]!,roots[j]!)||within(roots[j]!,roots[i]!))unavailable();
  }
  const mapping:TrafficMapping={country:'ES',environment:'test',cellId,directory:reportDirectory,writerUid:process.geteuid!(),readerGid:integer(env.GATEWAY_TRAFFIC_READER_GID,0,4294967294)};
  return {directory,keyFile,lifetimeSocket,socketDirectory,mapping,maxBytes:integer(env.GATEWAY_TRAFFIC_MAX_BYTES,1024,67108864)};
 }catch{return unavailable();}
}
async function directory(path:string,mode:number,gid?:number){
 const s=await lstat(path,{bigint:true});
 if(!s.isDirectory()||s.uid!==BigInt(process.geteuid!())||(s.mode&0o7777n)!==BigInt(mode)||gid!==undefined&&s.gid!==BigInt(gid)||await realpath(path)!==path)unavailable();
 return s;
}
export async function gatewayTrafficRuntimeOptions(env:NodeJS.ProcessEnv,traffic:GatewayTrafficOptions|undefined,issuerKey:KeyObject,cellId:string,otherKeyFiles:readonly string[]):Promise<GatewayTrafficRuntimeOptions|undefined>{
 try{
  const config=gatewayTrafficRuntimeConfiguration(env,traffic,cellId);if(!config)return;
  const state=await directory(config.directory,0o700),reports=await directory(config.mapping.directory,0o2750,config.mapping.readerGid);
  if(state.dev!==reports.dev)unavailable();
  await directory(config.socketDirectory,0o700);await directory(dirname(config.lifetimeSocket),0o700);
  if(await realpath(config.keyFile)!==config.keyFile)unavailable();
  for(const other of otherKeyFiles)if(await realpath(other)===config.keyFile)unavailable();
  const file=await open(config.keyFile,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  let reporterKey:KeyObject;
  try{
   const s=await file.stat({bigint:true});
   if(!s.isFile()||s.uid!==BigInt(process.geteuid!())||s.nlink!==1n||(s.mode&0o7777n)!==0o600n||s.size>4096n)unavailable();
   const bytes=Buffer.alloc(4097);let size=0;
   while(size<bytes.length){const r=await file.read(bytes,size,bytes.length-size,null);if(!r.bytesRead)break;size+=r.bytesRead;}
   const after=await lstat(config.keyFile,{bigint:true});
   if(size>4096||s.dev!==after.dev||s.ino!==after.ino||s.size!==after.size||s.mtimeNs!==after.mtimeNs||s.ctimeNs!==after.ctimeNs||await realpath(config.keyFile)!==config.keyFile)unavailable();
   reporterKey=createPrivateKey(bytes.subarray(0,size));
  }finally{await file.close();}
  if(reporterKey.asymmetricKeyType!=='ed25519'||createPublicKey(reporterKey).export({type:'spki',format:'der'}).equals(issuerKey.export({type:'spki',format:'der'})))unavailable();
  return {directory:config.directory,lifetimeSocket:config.lifetimeSocket,mapping:config.mapping,maxBytes:config.maxBytes,reporterKey};
 }catch{return unavailable();}
}
