import {accountRequest,type ApiResult} from './api.ts';
import type {Copy} from './locale.ts';
import {validMethodPresentation,validMethodResult,type BillingVenue,type BillingView,type MethodPresentation,type MethodState} from './billing-types.ts';

export class BillingController{
 venues:BillingVenue[]=[];selected:string|undefined;pending=false;loaded=false;loadAttempted=false;error:keyof Copy|undefined;
 methodCheckout:string|undefined;methodState:MethodState|undefined;
 #account:string|undefined;#generation=0;#retryUntil=0;readonly #changed:()=>void;readonly #request:typeof accountRequest;
 readonly #redirect:(url:string)=>void;
 constructor(changed:()=>void,request:typeof accountRequest=accountRequest,redirect:(url:string)=>void=url=>location.assign(url)){this.#changed=changed;this.#request=request;this.#redirect=redirect;}
 account(id:string|undefined){if(id!==this.#account){this.#account=id;this.#generation++;this.venues=[];this.selected=undefined;this.loaded=false;this.loadAttempted=false;this.pending=false;this.error=undefined;this.#clearMethod();}}
 select(id:string){if(id!==this.selected&&this.venues.some(venue=>venue.venueId===id)){this.selected=id;this.#generation++;this.pending=false;this.error=undefined;this.#clearMethod();this.#changed();}}
 get venue(){return this.venues.find(venue=>venue.venueId===this.selected);}
 fence(){this.#generation++;this.pending=false;this.error=undefined;this.#clearMethod();}
 get waiting(){return Math.max(0,Math.ceil((this.#retryUntil-performance.now())/1000));}
 async load(){
  if(!this.#account||this.pending||this.waiting)return;
  const generation=this.#generation;this.#clearMethod();this.pending=true;this.loadAttempted=true;this.error=undefined;this.#changed();
  const result=await this.#request<BillingView>('/billing/read',{});
  if(generation!==this.#generation)return;
  this.pending=false;
  if(result.ok)this.#apply(result.value);else this.#failure(result,!this.loaded);
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
 async startMethod(kind:'card'|'direct_debit'){
  if(!this.#account||!this.venue?.paymentMethods||this.pending||this.waiting)return;
  const generation=this.#generation,venueId=this.venue.venueId;
  this.#clearMethod();this.pending=true;this.error=undefined;this.#changed();
  const result=await this.#request<MethodPresentation>('/billing/method/start',{venueId,kind});
  if(generation!==this.#generation)return;
  this.pending=false;
  if(result.ok&&validMethodPresentation(result.value)&&(kind==='card'?'checkoutId' in result.value:'url' in result.value)){
   this.methodState='pending';
   if('checkoutId' in result.value)this.methodCheckout=result.value.checkoutId;
   else this.#redirect(result.value.url);
  }else if(!result.ok)this.#methodFailure(result);
  else this.error='billingMethodUncertain';
  this.#changed();
 }
 async verifyMethod(){
  if(!this.#account||!this.venue?.paymentMethods||this.pending||this.waiting)return;
  const generation=this.#generation,venueId=this.venue.venueId;
  this.pending=true;this.error=undefined;this.#changed();
  const result=await this.#request<{state:MethodState}>('/billing/method/verify',{venueId});
  if(generation!==this.#generation)return;
  this.pending=false;
  if(result.ok&&validMethodResult(result.value)){
   this.methodState=result.value.state;
   if(result.value.state!=='pending')this.methodCheckout=undefined;
   if(result.value.state==='verified')await this.load();
  }else if(!result.ok)this.#methodFailure(result);
  else this.error='billingMethodUncertain';
  if(generation!==this.#generation)return;
  this.#changed();
 }
 #clearMethod(){this.methodCheckout=undefined;this.methodState=undefined;}
 #methodFailure(result:Extract<ApiResult<unknown>,{ok:false}>){
  this.#retryUntil=Math.max(this.#retryUntil,performance.now()+result.retryAfterMs);
  if(result.status===401||result.status===403){this.#clearMethod();this.#failure(result);}
  else this.error=result.status===429?'limited':result.status===409?'billingMethodChanged':'billingMethodUncertain';
 }
 #apply(view:BillingView){this.venues=view.venues;this.loaded=true;if(!this.venues.some(venue=>venue.venueId===this.selected))this.selected=this.venues[0]?.venueId;}
 #failure(result:Extract<ApiResult<unknown>,{ok:false}>,initialRead=false){
  this.#retryUntil=Math.max(this.#retryUntil,performance.now()+result.retryAfterMs);
  if(result.status===401||result.status===403){this.venues=[];this.selected=undefined;this.loaded=false;}
  // Discovery grants no authority; a first policy refusal keeps the optional panel absent.
  if(initialRead&&result.status===403&&result.code==='permission_denied')return;
  if(result.status===503&&!this.loaded&&result.code==='temporarily_unavailable')return;
  this.error=result.status===429?'limited':result.status===401?'pairSession':result.status===403?(result.code==='permission_denied'?'permissionBusiness':'forbidden'):'unavailable';
 }
}
