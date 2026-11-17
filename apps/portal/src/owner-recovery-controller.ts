import {accountRequest,type ApiResult} from './api.ts';
import type {Copy,Locale} from './locale.ts';
type State='choose'|'pending'|'approved'|'refused';
export interface OwnerRecoveryView {requestId:string;state:State;venues?:{installationId:string;venueId:string;organisationName:string;businessName:string}[];request?:{accountId:string}}
export function validOwnerRecoveryResult(path:string,value:unknown):boolean {
 if(!value||typeof value!=='object')return false;const v=value as Record<string,unknown>;
 if(path.endsWith('/complete'))return typeof v.accountId==='string'&&v.enrollmentRequired===true;
 if(path.endsWith('/select'))return ['requestId','accountId','email','organisationId','legalBusinessId','venueId','installationId','publicKey','environment','countryCode','expiresAt'].every(k=>typeof v[k]==='string'&&v[k]!=='' )&&Number.isFinite(Date.parse(String(v.expiresAt)));
 if(typeof v.requestId!=='string'||!['choose','pending','approved','refused'].includes(String(v.state)))return false;
 return path.endsWith('/status')||Array.isArray(v.venues)&&v.venues.every((venue:unknown)=>!!venue&&typeof venue==='object'&&['installationId','venueId','organisationName','businessName'].every(k=>typeof (venue as Record<string,unknown>)[k]==='string'));
}
export class OwnerRecoveryController {
 stage:'idle'|State='idle';venues:NonNullable<OwnerRecoveryView['venues']>=[];installationId='';password='';pending=false;error:keyof Copy|undefined;
 #token='';#accountId='';#generation=0;#retryUntil=0;
 readonly changed:()=>void;readonly completed:(accountId:string)=>Promise<boolean>;readonly request:typeof accountRequest;
 constructor(changed:()=>void,completed:(accountId:string)=>Promise<boolean>,request:typeof accountRequest=accountRequest){this.changed=changed;this.completed=completed;this.request=request;}
 get waiting(){return Math.max(0,Math.ceil((this.#retryUntil-performance.now())/1000));}
 open(token?:string){this.#generation++;this.#token=token??'';this.#accountId='';this.stage='idle';this.venues=[];this.installationId='';this.password='';this.pending=false;this.error=undefined;}
 async act(action:'begin'|'select'|'status'|'complete',locale:Locale='en'){
  if(!this.#token||this.pending||this.waiting)return;
  if(action==='select'&&!this.installationId)return;
  if(action==='complete'&&([...this.password].length<15||new TextEncoder().encode(this.password).length>1024)){this.error='passwordHelp';this.changed();return;}
  const generation=this.#generation,body:Record<string,unknown>={token:this.#token};
  if(action==='select')body.installationId=this.installationId;
  if(action==='complete'){body.password=this.password;body.locale=locale;}
  if(action==='begin')this.stage='choose';
  this.pending=true;this.error=undefined;this.changed();
  const result=await this.request<OwnerRecoveryView&{accountId?:string}>(`/owner-recovery/${action}`,body);
  if(generation!==this.#generation)return;
  if(action==='complete'){
   this.password='';if((result.ok||result.status===0)&&await this.completed(result.ok?result.value.accountId!:this.#accountId))return;
  }
  if(result.ok){
   if(action==='select'){this.stage='pending';this.#accountId=result.value.accountId!;}
   else if(action!=='complete'){this.stage=result.value.state;if(result.value.venues)this.venues=result.value.venues;if(result.value.request)this.#accountId=result.value.request.accountId;this.installationId=this.installationId||this.venues[0]?.installationId||'';}
   else this.error='ownerRecoveryUncertain';
  }else this.#failure(result);
  this.pending=false;this.changed();
 }
 #failure(result:Extract<ApiResult<unknown>,{ok:false}>){
  this.#retryUntil=Math.max(this.#retryUntil,performance.now()+result.retryAfterMs);
  this.error=result.code==='recovery_scope_limited'?'ownerRecoveryScope':result.code==='password_compromised'?'passwordCompromised':result.status===429?'limited':result.status===0?'ownerRecoveryUncertain':'ownerRecoveryUnavailable';
 }
 submit(locale:Locale){return this.act(this.stage==='choose'?'select':this.stage==='approved'?'complete':'status',locale);}
}
