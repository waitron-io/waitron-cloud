import {randomUUID} from 'node:crypto';
import {isAbsolute,dirname} from 'node:path';
import {open,readFile,rename,rm} from 'node:fs/promises';
import {isUuid} from './manifest.ts';
import type {ReconcilerArtifacts} from './reconciler.ts';

interface CertificateFile {installationId:string;kind:'staff'|'public';csrFile:string;output:string}
interface RouteFile {cellId:string;output:string}
interface FileReconcilerConfig {certificates:CertificateFile[];routes:RouteFile[]}

function path(value:string){if(typeof value!=='string'||!isAbsolute(value))throw new Error('invalid_reconciler_files');return value;}
async function atomic(destination:string,value:string){
 const temporary=`${destination}.${randomUUID()}`;
 try{const file=await open(temporary,'wx',0o600);try{await file.writeFile(value);await file.sync();}finally{await file.close();}await rename(temporary,destination);const directory=await open(dirname(destination),'r');try{await directory.sync();}finally{await directory.close();}}
 finally{await rm(temporary,{force:true});}
}
async function optional(file:string){try{return await readFile(file,'utf8');}catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT')return;throw error;}}

export class FileReconcilerArtifacts implements ReconcilerArtifacts {
 readonly #certificates=new Map<string,{csrFile:string;output:string}>();readonly #routes=new Map<string,string>();
 constructor(config:FileReconcilerConfig){
  if(!config||!Array.isArray(config.certificates)||!Array.isArray(config.routes))throw new Error('invalid_reconciler_files');
  for(const target of config.certificates){if(!isUuid(target.installationId)||!['staff','public'].includes(target.kind))throw new Error('invalid_reconciler_files');const key=`${target.installationId}:${target.kind}`;if(this.#certificates.has(key))throw new Error('invalid_reconciler_files');this.#certificates.set(key,{csrFile:path(target.csrFile),output:path(target.output)});}
  for(const target of config.routes){if(!isUuid(target.cellId)||this.#routes.has(target.cellId))throw new Error('invalid_reconciler_files');this.#routes.set(target.cellId,path(target.output));}
 }
 #certificate(installationId:string,kind:'staff'|'public'){const target=this.#certificates.get(`${installationId}:${kind}`);if(!target)throw new Error('certificate_mapping_missing');return target;}
 async readCsr(installationId:string,kind:'staff'|'public'){return readFile(this.#certificate(installationId,kind).csrFile,'utf8');}
 async readCertificate(installationId:string,kind:'staff'|'public'){return optional(this.#certificate(installationId,kind).output);}
 async publishCertificate(installationId:string,kind:'staff'|'public',certificate:string){await atomic(this.#certificate(installationId,kind).output,certificate);}
 async publishManifest(cellId:string,envelope:string){const output=this.#routes.get(cellId);if(!output)throw new Error('route_mapping_missing');await atomic(output,envelope);}
}
