import {accountRequest,type ApiResult} from './api.ts';
import type {Copy} from './locale.ts';
import type {UsageSummary} from './usage-types.ts';

export class UsageController{
 organisationId:string|undefined;summary:UsageSummary|undefined;pending=false;loaded=false;error:keyof Copy|undefined;retryAt=0;
 #account:string|undefined;#generation=0;readonly #changed:()=>void;readonly #request:typeof accountRequest;
 constructor(changed:()=>void,request:typeof accountRequest=accountRequest){this.#changed=changed;this.#request=request;}
 account(id:string|undefined){if(id!==this.#account){this.#account=id;this.#generation++;this.organisationId=undefined;this.#clear();this.pending=false;this.error=undefined;}}
 organisation(id:string|undefined){if(id!==this.organisationId){this.organisationId=id;this.#generation++;this.#clear();this.pending=false;this.error=undefined;}}
 #clear(){this.summary=undefined;this.loaded=false;}
 get waiting(){return Math.max(0,Math.ceil((this.retryAt-Date.now())/1000));}
 refresh(){if(this.pending)return;this.loaded=false;this.error=undefined;this.#changed();}
 async load(){
  if(!this.#account||!this.organisationId||this.pending||this.loaded||this.waiting)return;
  const organisationId=this.organisationId,generation=this.#generation;this.pending=true;this.error=undefined;this.#changed();
  const result=await this.#request<UsageSummary>('/usage/read',{organisationId});
  if(generation!==this.#generation)return;
  this.pending=false;
  if(result.ok&&result.value.organisationId===organisationId){this.summary=result.value;this.loaded=true;}
  else if(result.ok)this.error='unavailable';
  else this.#failure(result);
  this.#changed();
 }
 #failure(result:Extract<ApiResult<unknown>,{ok:false}>){
  this.retryAt=Math.max(this.retryAt,Date.now()+result.retryAfterMs);
  if(result.status===401||result.status===403)this.#clear();
  this.error=result.status===429?'limited':result.status===401?'pairSession':result.status===403?'forbidden':'unavailable';
 }
}
