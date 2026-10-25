import {accountRequest,type ApiResult} from './api.ts';
import type {Copy,Locale} from './locale.ts';
export interface AlertPreferences {enabled:boolean;locale:Locale;}
export class AlertController {
 enabled=false;locale:Locale='en';loaded=false;pending=false;saved=false;error:keyof Copy|undefined;retryAt=0;
 #confirmed:AlertPreferences|undefined;#account:string|undefined;#generation=0;readonly #changed:()=>void;readonly #request:typeof accountRequest;
 constructor(changed:()=>void,request:typeof accountRequest=accountRequest){this.#changed=changed;this.#request=request;}
 account(id:string|undefined){if(this.#account!==id){this.#account=id;this.#generation++;this.#clear();this.pending=false;this.error=undefined;}}
 #clear(){this.#confirmed=undefined;this.enabled=false;this.locale='en';this.loaded=false;this.saved=false;}
 get dirty(){return this.loaded&&(!this.#confirmed||this.enabled!==this.#confirmed.enabled||this.locale!==this.#confirmed.locale);}
 get waiting(){return Math.max(0,Math.ceil((this.retryAt-Date.now())/1000));}
 choose(enabled:boolean,locale:Locale){if(this.pending||!this.loaded)return;this.enabled=enabled;this.locale=locale;this.saved=false;this.error=undefined;this.#changed();}
 async load(){await this.#perform(false);}
 async save(){if(this.dirty)await this.#perform(true);}
 async #perform(write:boolean){
  if(!this.#account||this.pending||this.waiting)return;
  const generation=this.#generation;this.pending=true;this.error=undefined;this.saved=false;this.#changed();
  const result=await this.#request<AlertPreferences>('/alerts',write?{enabled:this.enabled?'on':'off',locale:this.locale}:undefined);
  if(generation!==this.#generation)return;this.pending=false;
  if(result.ok){this.#confirmed={...result.value};this.enabled=result.value.enabled;this.locale=result.value.locale;this.loaded=true;this.saved=write;}
  else this.#failure(result,write);
  this.#changed();
 }
 #failure(result:Extract<ApiResult<unknown>,{ok:false}>,write:boolean){
  this.retryAt=Math.max(this.retryAt,Date.now()+result.retryAfterMs);
  if(result.status===401||result.status===403)this.#clear();
  this.error=result.status===429?'limited':result.status===401?'pairSession':result.status===403?'forbidden':write?'alertsUncertain':'unavailable';
  // An unconfirmed write may have changed the server, even if the draft is later reverted.
  if(this.error==='alertsUncertain')this.#confirmed=undefined;
 }
}
