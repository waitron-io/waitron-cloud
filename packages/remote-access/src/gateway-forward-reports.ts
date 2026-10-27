import {createPrivateKey,createPublicKey,type KeyObject} from 'node:crypto';
import {constants} from 'node:fs';
import {open,realpath} from 'node:fs/promises';
import {isAbsolute,relative} from 'node:path';
import type {GatewayAuthority} from './authority.ts';
import type {GatewayRoute} from './manifest.ts';
import {routeBinding,type ForwardCause} from './forward-report.ts';
import {ForwardReportWriter} from './forward-report-writer.ts';
interface Options {directory?:string;keyFile?:string;readerGid?:number;issuerKey?:KeyObject;now?:()=>number}
/** Optional diagnostics have no authority to interrupt the gate or change its readiness. */
export class GatewayForwardReports {
 readonly #authority:GatewayAuthority;readonly #options:Options;#writer:ForwardReportWriter|undefined;#identity:string|undefined;
 constructor(authority:GatewayAuthority,options:Options){this.#authority=authority;this.#options={...options};}
 async refresh():Promise<void>{
  try{
   const binding=this.#authority.routes.map(route=>this.#authority.forwardBinding(route.installationId)).find(Boolean);
   if(!binding){this.#writer=undefined;this.#identity=undefined;return;}
   const identity=JSON.stringify([binding.cellId,binding.gatewayId,binding.generation]);if(this.#identity===identity)return;
   this.#writer=undefined;this.#identity=identity;
   const {directory,keyFile,issuerKey}=this.#options;
   if(!directory||!keyFile||!isAbsolute(directory)||!isAbsolute(keyFile)||await realpath(keyFile)!==keyFile) return;
   const rel=relative(directory,keyFile);if(rel===''||(!rel.startsWith('../')&&!isAbsolute(rel)))return;
   const file=await open(keyFile,constants.O_RDONLY|constants.O_NOFOLLOW);let key:KeyObject;
   try{const s=await file.stat();if(!s.isFile()||s.nlink!==1||s.uid!==process.geteuid!()||(s.mode&0o7777)!==0o600||s.size>4096)return;
    key=createPrivateKey(await file.readFile());
   }finally{await file.close();}
   if(issuerKey&&createPublicKey(key).export({type:'spki',format:'der'}).equals(issuerKey.export({type:'spki',format:'der'})))return;
   const writer=new ForwardReportWriter({directory,key,cellId:binding.cellId,gatewayId:binding.gatewayId,generation:binding.generation,readerGid:this.#options.readerGid??1000,now:this.#options.now});
   await writer.restore((this.#options.now??Date.now)());this.#writer=writer;
  }catch{this.#writer=undefined;}
 }
 beginForward(route:Readonly<GatewayRoute&{revision?:number}>,startedAt:number):((category:ForwardCause|null,observedAt:number)=>void)|undefined {
  try{
   const writer=this.#writer,binding=this.#authority.forwardBinding(route.installationId);
   if(!writer||!binding||route.revision!==binding.revision||binding.routeBinding!==routeBinding(route))return;
   const complete=writer.begin(binding,startedAt);
   return (category,observedAt)=>{
    try{if(this.#writer===writer&&JSON.stringify(this.#authority.forwardBinding(route.installationId))===JSON.stringify(binding))complete(category,observedAt);}catch{}
   };
  }catch{return;}
 }
 async flush(now:number):Promise<void>{await this.refresh();await this.#writer?.flush(now);}
}
