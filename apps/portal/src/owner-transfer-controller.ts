import {accountRequest} from './api.ts';
import {validEmail} from './email.ts';
import type {Copy,Locale} from './locale.ts';
import type {OwnerTransferList} from './owner-transfer-types.ts';
export class OwnerTransferController {
 data:OwnerTransferList={organisations:[],offers:[]};organisationId='';email='';pending=false;loadAttempted=false;error:keyof Copy|undefined;
 #account:string|undefined;#generation=0;#retryUntil=0;
 readonly changed:()=>void;readonly request:typeof accountRequest;
 constructor(changed:()=>void,request:typeof accountRequest=accountRequest){this.changed=changed;this.request=request;}
 get waiting(){return Math.max(0,Math.ceil((this.#retryUntil-performance.now())/1000));}
 account(id:string|undefined){if(id===this.#account)return;this.#account=id;this.#generation++;this.data={organisations:[],offers:[]};this.email='';this.organisationId='';this.pending=false;this.loadAttempted=false;this.error=undefined;}
 async #read(generation:number){
  const result=await this.request<OwnerTransferList>('/owner-transfers');if(generation!==this.#generation)return false;
  if(result.ok){this.data=result.value;if(!this.data.organisations.some(o=>o.id===this.organisationId))this.organisationId=this.data.organisations[0]?.id??'';return true;}
  this.#failure(result);if(result.status===401||result.status===403)this.data={organisations:[],offers:[]};return false;
 }
 #failure(result:Extract<Awaited<ReturnType<typeof accountRequest>>,{ok:false}>){
  this.#retryUntil=Math.max(this.#retryUntil,performance.now()+result.retryAfterMs);
  this.error=result.code==='proof_required'?'actionProofUnavailable':result.code==='enrollment_required'?'pairEnrollment':result.code==='recovery_in_progress'?'transferRecovery':result.code==='transfer_pending'?'transferPendingHelp':result.status===429?'limited':result.status===403?'forbidden':result.status===404?'transferUnavailable':'transferUncertain';
 }
 async load(){
  if(!this.#account||this.pending||this.waiting)return;const generation=this.#generation;this.loadAttempted=true;this.pending=true;this.error=undefined;this.changed();
  await this.#read(generation);if(generation!==this.#generation)return;this.pending=false;this.changed();
 }
 async act(action:'create'|'accept'|'cancel',locale:Locale,id?:string){
  if(!this.#account||this.pending||this.waiting)return false;
  if(action==='create'&&(!this.organisationId||!validEmail(this.email))){this.error='emailError';this.changed();return false;}
  const generation=this.#generation,organisationId=this.organisationId,email=this.email.trim().toLowerCase();this.pending=true;this.error=undefined;this.changed();
  const result=await this.request(`/owner-transfers/${action}`,action==='create'?{organisationId,email,locale}:{id});
  if(generation!==this.#generation)return false;
  if(!result.ok)this.#failure(result);
  const listed=await this.#read(generation);if(generation!==this.#generation)return false;
  const saved=this.data.offers.find(offer=>action==='create'?offer.organisationId===organisationId&&offer.recipientEmail===email&&offer.state==='pending':offer.id===id);
  const settled=listed&&!!saved&&(action==='create'||saved.state!=='pending');
  if(settled&&(result.ok||!result.ok&&result.status===0))this.error=undefined;
  if(result.ok&&!listed)this.error='transferUncertain';
  if(result.ok&&action==='create')this.email='';
  this.pending=false;this.changed();return result.ok||settled;
 }
}
