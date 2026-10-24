import {accountRequest} from './api.ts';
import type {Copy} from './locale.ts';
import type {RecoveryView} from './recovery-types.ts';
export class RecoveryController {
 requestId:string|undefined;code='';view:RecoveryView|undefined;venueId:string|undefined;pointId:string|undefined;source:'continuous'|'snapshot'|undefined;
 stopped=false;acceptLoss=false;uncertain=false;pending=false;retryAt=0;error:keyof Copy|undefined;
 #confirmedReplacement:string|undefined;
 #account:string|undefined;#generation=0;#changed:()=>void;#request:typeof accountRequest;
 constructor(changed:()=>void,request:typeof accountRequest=accountRequest){this.#changed=changed;this.#request=request;}
 #clear(){this.#generation++;this.code='';this.view=undefined;this.venueId=undefined;this.pointId=undefined;this.source=undefined;this.stopped=false;this.acceptLoss=false;this.#confirmedReplacement=undefined;this.uncertain=false;this.pending=false;this.error=undefined;}
 open(id:string|undefined){if(id!==this.requestId){this.#clear();this.requestId=id;}}
 account(id:string|undefined){if(id!==this.#account){this.#clear();this.#account=id;}}
 choose(venueId:string|undefined,pointId:string|undefined){this.#choose(venueId,pointId?'snapshot':undefined,pointId);}
 chooseContinuous(venueId:string|undefined){this.#choose(venueId,venueId?'continuous':undefined,undefined);}
 #choose(venueId:string|undefined,source:'continuous'|'snapshot'|undefined,pointId:string|undefined){if(venueId!==this.venueId||pointId!==this.pointId||source!==this.source){this.venueId=venueId;this.pointId=pointId;this.source=source;this.stopped=false;this.acceptLoss=false;}}
 get waiting(){return Math.max(0,Math.ceil((this.retryAt-Date.now())/1000));}
 inspect(){return this.#exchange('inspect');}
 approve(){return this.#exchange('approve');}
 close(){return this.#exchange('close');}
 get confirmReplacement(){return !!this.#confirmedReplacement&&this.#confirmedReplacement===this.#proposal();}
 set confirmReplacement(value:boolean){this.#confirmedReplacement=value?this.#proposal():undefined;}
 #proposal(){const r=this.view?.replacement;return r?.state==='awaiting_owner'?JSON.stringify(r):undefined;}
 replace(){return this.#exchange('replace');}
 async #exchange(action:'inspect'|'approve'|'close'|'replace'){
  if(!this.#account||!this.requestId||this.pending||this.waiting)return;
  this.code=this.code.trim();
  if(!/^\d{8}$/.test(this.code)){this.error='pairCodeError';this.#changed();return;}
  if(action==='approve'&&(this.uncertain||this.view?.state!=='awaiting_owner'||!this.venueId||!this.source||(this.source==='snapshot'&&!this.pointId)||!this.stopped||!this.acceptLoss||Date.parse(this.view.expiresAt)<=Date.now()))return;
  if(action==='close'&&!this.view?.operation)return;
  const replacement=this.view?.replacement;
  if(action==='replace'&&(this.uncertain||!this.confirmReplacement||!replacement||replacement.state!=='awaiting_owner'||this.view?.operation?.status!=='restored'||Date.parse(replacement.expiresAt)<=Date.now()||Date.parse(this.view.operation.expiresAt)<=Date.now()))return;
  const body:Record<string,string>={requestId:this.requestId,code:this.code};if(action==='approve')Object.assign(body,this.source==='continuous'?{source:'continuous',venueId:this.venueId}:{source:'snapshot',pointId:this.pointId},{oldServerUnavailable:'true',acceptDataLoss:'true'});
  if(action==='replace')Object.assign(body,{oldInstallationId:replacement!.oldInstallationId,oldServerUnavailable:'true',confirmReplacement:'true'});
  const generation=this.#generation,point=this.pointId,venue=this.venueId,source=this.source,proposal=this.#proposal();this.pending=true;this.error=undefined;this.#changed();
  const result=await this.#request<RecoveryView>('/recovery/'+action,body);if(generation!==this.#generation)return;this.pending=false;
  const returned=result.ok?result.value.operation:null;
  if(result.ok&&result.value.requestId===this.requestId&&(action!=='approve'||(!!returned&&returned.venueId===venue&&returned.source.kind===source&&(source==='continuous'?returned.pointId===null:returned.pointId===point)))&&(action!=='replace'||(result.value.replacement?.state==='complete'&&replacement&&result.value.replacement.oldInstallationId===replacement.oldInstallationId&&result.value.replacement.publicKey===replacement.publicKey&&result.value.replacement.peerPublicKey===replacement.peerPublicKey&&result.value.replacement.localVenueId===replacement.localVenueId&&result.value.replacement.nodeId===replacement.nodeId))){this.view=result.value;if(this.#proposal()!==proposal)this.#confirmedReplacement=undefined;this.uncertain=false;}
  else{
   if(!result.ok){this.retryAt=Math.max(this.retryAt,Date.now()+result.retryAfterMs);this.error=result.status===429?'limited':result.status===401?'pairSession':result.status===403?'forbidden':result.status===410?'recoveryExpired':'unavailable';if(result.status===401||result.status===403){this.view=undefined;this.#confirmedReplacement=undefined;this.choose(undefined,undefined);}}
   else this.error='unavailable';
   if(action!=='inspect'&&(result.ok||result.status===0||result.status>=500||result.code==='unexpected_response')){this.#confirmedReplacement=undefined;this.uncertain=true;this.error='recoveryUncertain';this.#changed();await this.inspect();}
  }
  this.#changed();
 }
}
