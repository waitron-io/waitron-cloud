import {randomUUID} from 'node:crypto';
import {isAbsolute,dirname,join} from 'node:path';
import {mkdir,open,readFile,rename,rm} from 'node:fs/promises';
import {isUuid} from './manifest.ts';
import {deleteChallenge,writeChallenge,type ChallengeFile} from './challenge-files.ts';
import type {ReconcilerArtifacts} from './reconciler.ts';

interface RouteFile {cellId:string;output:string;publicCertificates:string;challenges?:string}
interface FileReconcilerConfig {routes:RouteFile[];keyDirectory:string}

function path(value:string){if(typeof value!=='string'||!isAbsolute(value))throw new Error('invalid_reconciler_files');return value;}
async function atomic(destination:string,value:string){
 const temporary=`${destination}.${randomUUID()}`;
 try{const file=await open(temporary,'wx',0o600);try{await file.writeFile(value);await file.sync();}finally{await file.close();}await rename(temporary,destination);const directory=await open(dirname(destination),'r');try{await directory.sync();}finally{await directory.close();}}
 finally{await rm(temporary,{force:true});}
}
async function optional(file:string){try{return await readFile(file,'utf8');}catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT')return;throw error;}}

export class FileReconcilerArtifacts implements ReconcilerArtifacts {
 readonly #keyDirectory:string;readonly #publicCertificates=new Map<string,string>();
 readonly #routes=new Map<string,string>();
 readonly #challenges=new Map<string,string>();
 constructor(config:FileReconcilerConfig){
  if(!config||!Array.isArray(config.routes)||'certificates'in config||'staffExchange'in config)throw new Error('invalid_reconciler_files');
  this.#keyDirectory=path(config.keyDirectory);
  for(const target of config.routes){if(!isUuid(target.cellId)||this.#routes.has(target.cellId))throw new Error('invalid_reconciler_files');this.#routes.set(target.cellId,path(target.output));this.#publicCertificates.set(target.cellId,path(target.publicCertificates));if(target.challenges!==undefined)this.#challenges.set(target.cellId,path(target.challenges));}
 }
 async readPublicCertificate(installationId:string){
  if(!isUuid(installationId)||!this.#keyDirectory)throw new Error('invalid_reconciler_files');
  const pem=await optional(join(this.#keyDirectory,installationId+'.public.pem')),csr=await optional(join(this.#keyDirectory,installationId+'.public.csr'));
  return pem!==undefined&&csr!==undefined?{pem,csr}:undefined;
 }
 async publishPublicCertificate(installationId:string,venueId:string,cellIds:string[],copy:{pem:string;csr:string}){
  if(!isUuid(installationId)||!isUuid(venueId)||!this.#keyDirectory)throw new Error('invalid_reconciler_files');
  // Retain an issued certificate before delivery so a failed gateway write needs no new order.
  await mkdir(this.#keyDirectory,{recursive:true,mode:0o700});
  await atomic(join(this.#keyDirectory,installationId+'.public.pem'),copy.pem);await atomic(join(this.#keyDirectory,installationId+'.public.csr'),copy.csr);
  let complete=true;const copied:string[]=[];
  for(const id of cellIds){
   const directory=this.#publicCertificates.get(id);
   try{if(!directory)throw new Error('route_mapping_missing');await atomic(join(directory,venueId+'.pem'),copy.pem);copied.push(id);}catch{complete=false;}
  }
  for(const [id,directory]of this.#publicCertificates)if(!cellIds.includes(id))try{await rm(join(directory,venueId+'.pem'),{force:true});}catch{complete=false;}
  return {copied,complete};
 }
 hasChallengeFolder(cellId:string){return this.#challenges.has(cellId);}
 async writeChallenge(cellId:string,file:ChallengeFile){
  const folder=this.#challenges.get(cellId);if(!folder)throw new Error('challenge_not_answerable');
  await writeChallenge(folder,file);
 }
 async deleteChallenge(cellId:string,hostname:string){
  const folder=this.#challenges.get(cellId);if(folder)await deleteChallenge(folder,hostname);
 }
 async publishManifest(cellId:string,envelope:string){const output=this.#routes.get(cellId);if(!output)throw new Error('route_mapping_missing');await atomic(output,envelope);}
}
