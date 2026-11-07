import {accountRequest,type ApiResult} from './api.ts';
import type {Copy} from './locale.ts';
import type {BillingVenue,BillingView} from './billing-types.ts';

export class BillingController{
 venues:BillingVenue[]=[];selected:string|undefined;pending=false;loaded=false;loadAttempted=false;error:keyof Copy|undefined;
 #account:string|undefined;#generation=0;#retryUntil=0;readonly #changed:()=>void;readonly #request:typeof accountRequest;
 constructor(changed:()=>void,request:typeof accountRequest=accountRequest){this.#changed=changed;this.#request=request;}
 account(id:string|undefined){if(id!==this.#account){this.#account=id;this.#generation++;this.venues=[];this.selected=undefined;this.loaded=false;this.loadAttempted=false;this.pending=false;this.error=undefined;}}
 select(id:string){if(id!==this.selected&&this.venues.some(venue=>venue.venueId===id)){this.selected=id;this.#generation++;this.pending=false;this.error=undefined;this.#changed();}}
 get venue(){return this.venues.find(venue=>venue.venueId===this.selected);}
 get waiting(){return Math.max(0,Math.ceil((this.#retryUntil-performance.now())/1000));}
 async load(){
  if(!this.#account||this.pending||this.waiting)return;
  const generation=this.#generation;this.pending=true;this.loadAttempted=true;this.error=undefined;this.#changed();
  const result=await this.#request<BillingView>('/billing/read',{});
  if(generation!==this.#generation)return;
  this.pending=false;
  if(result.ok)this.#apply(result.value);else this.#failure(result);
  this.#changed();
 }
 async start(){
  if(!this.#account||!this.venue?.canStartTrial||this.pending||this.waiting)return;
  const generation=this.#generation,venueId=this.venue.venueId;this.pending=true;this.error=undefined;this.#changed();
  const result=await this.#request<BillingView>('/billing/start-trial',{venueId});
  if(generation!==this.#generation)return;
  this.pending=false;
  if(!result.ok)this.#retryUntil=Math.max(this.#retryUntil,performance.now()+result.retryAfterMs);
  if(result.ok)this.#apply(result.value);
  else if(result.code==='conflict'||result.status===0||result.status>=500){
   // A lost write reply may have committed. Read the current choice before offering another action.
   this.venues=[];this.loaded=false;await this.load();
   if(generation!==this.#generation)return;
   if(!this.error)this.error=result.code==='conflict'?'billingChanged':'billingUncertain';
  }else this.#failure(result);
  this.#changed();
 }
 #apply(view:BillingView){this.venues=view.venues;this.loaded=true;if(!this.venues.some(venue=>venue.venueId===this.selected))this.selected=this.venues[0]?.venueId;}
 #failure(result:Extract<ApiResult<unknown>,{ok:false}>){
  this.#retryUntil=Math.max(this.#retryUntil,performance.now()+result.retryAfterMs);
  if(result.status===401||result.status===403){this.venues=[];this.selected=undefined;this.loaded=false;}
  // The optional trial feature is absent on ordinary accounts and servers.
  if(result.status===503&&!this.loaded&&result.code==='temporarily_unavailable')return;
  this.error=result.status===429?'limited':result.status===401?'pairSession':result.status===403?(result.code==='permission_denied'?'permissionBusiness':'forbidden'):'unavailable';
 }
}
