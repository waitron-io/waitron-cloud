import type {KeyObject} from 'node:crypto';
import {verifyManifest,type GatewayManifest,type GatewayRoute} from './manifest.ts';
interface Hooks {persist:(envelope:unknown)=>Promise<void>;apply:(routes:GatewayRoute[])=>Promise<void>;close:()=>Promise<void>}
/** The caller serializes accept/restore/tick and calls tick at least once a second. */
export class GatewayAuthority {
 #manifest:GatewayManifest|undefined;#sequence=0;
 readonly #key:KeyObject;readonly #cell:string;readonly #hooks:Hooks;readonly #now:()=>number;
 constructor(key:KeyObject,cell:string,hooks:Hooks,now=Date.now){this.#key=key;this.#cell=cell;this.#hooks=hooks;this.#now=now;}
 get routes():GatewayRoute[]{return this.#manifest&&this.#manifest.expiresAt>this.#now()?this.#manifest.routes:[];}
 get sequence(){return this.#sequence;}
 async accept(envelope:unknown){
  const value=verifyManifest(envelope,this.#key,this.#cell,this.#now(),this.#sequence);
  try{await this.#hooks.persist(envelope);this.#sequence=value.sequence;await this.#hooks.apply(value.routes);this.#manifest=value;}
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
