import type {KeyObject} from 'node:crypto';
import {verifyManifest,type GatewayManifest,type GatewayRoute,type ManifestEnvelope} from './manifest.ts';
interface Hooks {persist:(envelope:unknown)=>Promise<void>;apply:(routes:GatewayRoute[])=>Promise<void>;close:()=>Promise<void>}
/** The caller serializes accept/restore/tick and calls tick at least once a second. */
export class GatewayAuthority {
 #manifest:GatewayManifest|undefined;#sequence=0;#pending:ManifestEnvelope|undefined;
 readonly #key:KeyObject;readonly #cell:string;readonly #hooks:Hooks;readonly #now:()=>number;
 constructor(key:KeyObject,cell:string,hooks:Hooks,now=Date.now){this.#key=key;this.#cell=cell;this.#hooks=hooks;this.#now=now;}
 get hasAuthority():boolean{return !!this.#manifest&&this.#manifest.expiresAt>this.#now();}
 get routes():GatewayRoute[]{return this.hasAuthority?this.#manifest!.routes:[];}
 get sequence(){return this.#sequence;}
 async accept(envelope:unknown){
  const candidate=envelope as Partial<ManifestEnvelope>|null;
  const retry=!!this.#pending&&candidate?.payload===this.#pending.payload&&candidate?.signature===this.#pending.signature;
  // Retry only the exact persisted envelope whose apply failed, with its original signed expiry.
  const value=verifyManifest(envelope,this.#key,this.#cell,this.#now(),retry?this.#sequence-1:this.#sequence);
  try{
   if(!retry){await this.#hooks.persist(envelope);this.#sequence=value.sequence;this.#pending={payload:candidate!.payload!,signature:candidate!.signature!};}
   await this.#hooks.apply(value.routes);this.#manifest=value;this.#pending=undefined;
  }
  catch(error){this.#manifest=undefined;await this.#hooks.close();throw error;}
 }
 async restore(envelope:unknown){
  // An expired, authentically signed cache still supplies the anti-rollback floor.
  let issuedAt:number;try{issuedAt=JSON.parse(Buffer.from((envelope as {payload:string}).payload,'base64url').toString()).issuedAt;}catch{throw new Error('invalid_manifest');}
  const value=verifyManifest(envelope,this.#key,this.#cell,issuedAt,0);
  if(value.expiresAt<=this.#now()){this.#sequence=value.sequence;await this.#hooks.close();return;}
  await this.accept(envelope);
 }
 async tick(){if(this.#manifest&&this.#manifest.expiresAt<=this.#now()){this.#manifest=undefined;await this.#hooks.close();}}
}
