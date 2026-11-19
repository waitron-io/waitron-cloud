import {bodyRefusal} from './body-refusal.ts';
import {accountRequest,type ApiResult} from './api.ts';
import type {Copy} from './locale.ts';
import type {AccountInstallation} from './installation-types.ts';
export class InstallationController {
 selectedOrganisation:string|undefined;
 installations:AccountInstallation[]=[];confirming:string|undefined;pending=false;loaded=false;error:keyof Copy|undefined;
 #account:string|undefined;#recovery=false;#recoveryOrganisation:string|undefined;#generation=0;#changed:()=>void;#request:typeof accountRequest;
 constructor(changed:()=>void,request:typeof accountRequest=accountRequest){this.#changed=changed;this.#request=request;}
 account(id:string|undefined){if(id!==this.#account){this.#account=id;this.#generation++;this.installations=[];this.selectedOrganisation=undefined;this.#recoveryOrganisation=undefined;this.confirming=undefined;this.pending=false;this.loaded=false;this.error=undefined;}}
 get #offered(){return this.#recovery?this.installations:this.installations.filter(i=>!i.portalRemovedAt);}
 showRecovery(recovery:boolean){
  if(recovery===this.#recovery)return;
  if(recovery&&this.#recoveryOrganisation)this.selectedOrganisation=this.#recoveryOrganisation;
  this.#recovery=recovery;
  // Keep Recovery's choice when the organisation has no venue left in the other portal lists.
  this.#recoveryOrganisation=!recovery&&!this.organisations.some(o=>o.id===this.selectedOrganisation)
    ?this.selectedOrganisation:undefined;
  this.confirming=undefined;this.#reconcile();this.#changed();
 }
 get organisations(){return [...new Map(this.#offered.map(i=>[i.organisationId,{id:i.organisationId,name:i.overview?.organisationName??i.organisationId}])).values()].sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));}
 get visible(){return this.#offered.filter(i=>i.organisationId===this.selectedOrganisation).sort((a,b)=>(a.overview?.businessName??a.legalBusinessId).localeCompare(b.overview?.businessName??b.legalBusinessId)||a.venueId.localeCompare(b.venueId));}
 selectOrganisation(id:string){if(this.pending||!this.organisations.some(o=>o.id===id))return;this.selectedOrganisation=id;if(!this.#recovery)this.#recoveryOrganisation=undefined;this.confirming=undefined;this.#changed();}
 // Relative server waits keep their deadline across wall-clock corrections and account changes.
 #retryUntil=0;
 get retryAt(){const remaining=this.#retryUntil-performance.now();return remaining>0?Date.now()+remaining:0;}
 get waiting(){return Math.max(0,Math.ceil((this.#retryUntil-performance.now())/1000));}
 #reconcile(){
  const choices=this.organisations;
  if(!choices.some(o=>o.id===this.selectedOrganisation)){
   this.selectedOrganisation=choices[0]?.id;this.confirming=undefined;
  }
  if(!this.visible.some(i=>i.installationId===this.confirming&&i.canRevoke&&!i.portalRemovedAt))this.confirming=undefined;
 }
 choose(id?:string){if(this.pending)return;this.confirming=this.installations.some(i=>i.installationId===id&&i.canRevoke&&!i.portalRemovedAt)?id:undefined;this.error=undefined;this.#changed();}
 #failure(result:Extract<ApiResult<unknown>,{ok:false}>,write=false){this.#retryUntil=Math.max(this.#retryUntil,performance.now()+result.retryAfterMs);const cause=write&&bodyRefusal(result);this.error=cause?`installationsRequest${cause}`:result.code==='guest_menu_takedown_failed'?'removeMenuTakedownFailed':result.status===429?'limited':result.status===401?'pairSession':result.status===403?(result.code==='permission_denied'?'permissionBusiness':'forbidden'):write?'removeUncertain':'unavailable';}
 async load(){
  if(!this.#account||this.pending||this.waiting)return;const generation=this.#generation;this.pending=true;this.error=undefined;this.#changed();
  const result=await this.#request<{installations:AccountInstallation[]}>('/installations');if(generation!==this.#generation)return;this.pending=false;this.loaded=true;
  if(result.ok){this.installations=result.value.installations;this.#reconcile();}else{if(result.status===401||result.status===403){this.installations=[];this.selectedOrganisation=undefined;this.#recoveryOrganisation=undefined;this.confirming=undefined;}this.#failure(result);}this.#changed();
 }
 async remove(){
  if(!this.#account||this.pending||this.waiting||!this.confirming)return;const selected=this.installations.find(i=>i.installationId===this.confirming&&i.canRevoke&&!i.portalRemovedAt);if(!selected)return;
  const generation=this.#generation;this.pending=true;this.error=undefined;this.#changed();
  const result=await this.#request<AccountInstallation>('/installations/remove',{installationId:selected.installationId});if(generation!==this.#generation)return;this.pending=false;
  if(result.ok){
   const v=result.value;
   if(!v.revokedAt||!v.portalRemovedAt||v.installationId!==selected.installationId||v.venueId!==selected.venueId
      ||v.organisationId!==selected.organisationId||v.legalBusinessId!==selected.legalBusinessId)this.error='unavailable';
   else{
    this.installations=this.installations.map(i=>i===selected?{...i,revokedAt:v.revokedAt,portalRemovedAt:v.portalRemovedAt}:i);
    this.confirming=undefined;this.#reconcile();
   }
  }
  else this.#failure(result,true);this.#changed();
 }
}
