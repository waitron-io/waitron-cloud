import {accountRequest,type ApiResult} from './api.ts';
import type {Copy} from './locale.ts';
export type CloudActionRequest={id:string;version:number;occurrence:string;actionId:string;policy:'ask-first'|'act-and-report';cell:string;target:string;proposal:string;evidence:string;state:'pending'|'approved'|'rejected'|'superseded';effectId:string;available:false;createdAt:string;decidedAt:string|null;approvalExpiresAt:string|null;events:{kind:string;at:string;noticeStatus?:'pending'|'processing'|'sent'|'expired'|'cancelled'|'failed'|'unknown'}[]};
export type CloudActionView={actions:{id:string;policy:'ask-first'|'act-and-report';available:false}[];requests:CloudActionRequest[]};
const emptyDraft=()=>({occurrence:'',actionId:'machine_drain',cell:'',target:'',proposal:'',evidence:''});
export class CloudActionsController{
 view:CloudActionView|undefined;pending=false;loadAttempted=false;error:keyof Copy|undefined;draft=emptyDraft();
 #account:string|undefined;#generation=0;#retryUntil=0;readonly #changed:()=>void;
 constructor(changed:()=>void){this.#changed=changed;}
 account(id:string|undefined){if(id!==this.#account){this.#account=id;this.#generation++;this.view=undefined;this.pending=false;this.loadAttempted=false;this.error=undefined;this.draft=emptyDraft();}}
 get waiting(){return Math.max(0,Math.ceil((this.#retryUntil-performance.now())/1000));}
 #failure(result:Extract<ApiResult<unknown>,{ok:false}>){
  this.#retryUntil=Math.max(this.#retryUntil,performance.now()+result.retryAfterMs);
  this.error=result.status===400&&result.code==='invalid_input'?'cloudActionsInvalid':result.code==='proof_required'?'cloudActionsProofRequired':result.status===403?'cloudActionsDenied':result.status===401?'pairSession':result.status===429?'limited':'unavailable';
  if(result.status===401||result.status===403&&result.code!=='proof_required')this.view=undefined;
 }
 async load(){
  if(!this.#account||this.pending||this.waiting)return;
  const generation=this.#generation;this.view=undefined;this.pending=true;this.loadAttempted=true;this.error=undefined;this.#changed();
  const result=await accountRequest<CloudActionView>('/operator/actions');
  if(generation!==this.#generation)return;
  this.pending=false;if(result.ok)this.view=result.value;else this.#failure(result);this.#changed();
 }
 async #write(path:string,body:Record<string,unknown>){
  if(!this.#account||!this.view||this.pending||this.waiting)return;
  const generation=this.#generation;this.pending=true;this.error=undefined;this.#changed();
  const result=await accountRequest<CloudActionRequest>(path,body);
  if(generation!==this.#generation)return;this.pending=false;
  if(result.ok||result.status===0||result.status>=500||result.status===409){
   // A lost reply may already have committed; refresh persisted state rather than repeating the decision.
   await this.load();if(generation!==this.#generation)return;
   if(!result.ok&&result.status===409)this.error='cloudActionsConflict';
  }else this.#failure(result);
  this.#changed();
 }
 async propose(){await this.#write('/operator/actions/requests',{...this.draft});}
 async decide(request:CloudActionRequest,decision:'approved'|'rejected'){
  await this.#write('/operator/actions/decide',{requestId:request.id,version:request.version,decision});
 }
}
