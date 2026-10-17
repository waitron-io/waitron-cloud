import {accountRequest,type ApiResult} from './api.ts';
import type {Copy} from './locale.ts';
export const translationConsentVersion='providers-2026-10-14';
export interface TranslationConsent {venueId:string;consented:boolean;consentedAt:string|null}
export class TranslationConsentController {
 consents:TranslationConsent[]=[];loaded=false;pending=false;error:keyof Copy|undefined;errorVenueId:string|undefined;retryAt=0;
 #account:string|undefined;#generation=0;readonly #changed:()=>void;readonly #request:typeof accountRequest;
 constructor(changed:()=>void,request:typeof accountRequest=accountRequest){this.#changed=changed;this.#request=request;}
 account(id:string|undefined){if(this.#account!==id){this.#account=id;this.#generation++;this.#clear();this.pending=false;this.error=undefined;}}
 #clear(){this.consents=[];this.loaded=false;this.errorVenueId=undefined;}
 get waiting(){return Math.max(0,Math.ceil((this.retryAt-Date.now())/1000));}
 consented(venueId:string){return this.consents.some(c=>c.venueId===venueId&&c.consented);}
 async load(){await this.#perform(undefined);}
 async agree(venueId:string){await this.#perform({venueId,choice:'agree',consentVersion:translationConsentVersion});}
 async withdraw(venueId:string){await this.#perform({venueId,choice:'withdraw'});}
 async #perform(body:Record<string,unknown>|undefined){
  if(!this.#account||this.pending||this.waiting)return;
  const generation=this.#generation;this.pending=true;this.error=undefined;this.errorVenueId=undefined;this.#changed();
  const result=await this.#request<{consents:TranslationConsent[]}>('/translation-consent',body);
  if(generation!==this.#generation)return;this.pending=false;
  if(result.ok){this.consents=result.value.consents;this.loaded=true;}
  else {this.#failure(result,body!==undefined);this.errorVenueId=typeof body?.venueId==='string'?body.venueId:undefined;}
  this.#changed();
 }
 #failure(result:Extract<ApiResult<unknown>,{ok:false}>,write:boolean){
  this.retryAt=Math.max(this.retryAt,Date.now()+result.retryAfterMs);
  if(result.status===401||result.status===403)this.#clear();
  this.error=result.status===429?'limited':result.status===401?'pairSession':result.status===403?'forbidden':write?'translationConsentUncertain':'unavailable';
 }
}
