import {accountRequest,type ApiResult} from './api.ts';
import type {Copy} from './locale.ts';
import type {AccountInstallation} from './installation-types.ts';
export class InstallationController {
 selectedOrganisation:string|undefined;
 installations:AccountInstallation[]=[];confirming:string|undefined;pending=false;loaded=false;error:keyof Copy|undefined;retryAt=0;
 #account:string|undefined;#generation=0;#changed:()=>void;#request:typeof accountRequest;
 constructor(changed:()=>void,request:typeof accountRequest=accountRequest){this.#changed=changed;this.#request=request;}
 account(id:string|undefined){if(id!==this.#account){this.#account=id;this.#generation++;this.installations=[];this.selectedOrganisation=undefined;this.confirming=undefined;this.pending=false;this.loaded=false;this.error=undefined;}}
 get organisations(){return [...new Map(this.installations.map(i=>[i.organisationId,{id:i.organisationId,name:i.overview?.organisationName??i.organisationId}])).values()].sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));}
 get visible(){return this.installations.filter(i=>i.organisationId===this.selectedOrganisation).sort((a,b)=>(a.overview?.businessName??a.legalBusinessId).localeCompare(b.overview?.businessName??b.legalBusinessId)||a.venueId.localeCompare(b.venueId));}
 selectOrganisation(id:string){if(this.pending||!this.organisations.some(o=>o.id===id))return;this.selectedOrganisation=id;this.confirming=undefined;this.#changed();}
 get waiting(){return Math.max(0,Math.ceil((this.retryAt-Date.now())/1000));}
 choose(id?:string){if(this.pending)return;this.confirming=this.installations.some(i=>i.installationId===id&&i.canRevoke&&!i.revokedAt)?id:undefined;this.error=undefined;this.#changed();}
 #failure(result:Extract<ApiResult<unknown>,{ok:false}>,write=false){this.retryAt=Math.max(this.retryAt,Date.now()+result.retryAfterMs);this.error=result.status===429?'limited':result.status===401?'pairSession':result.status===403?'forbidden':write?'stopUncertain':'unavailable';}
 async load(){
  if(!this.#account||this.pending||this.waiting)return;const generation=this.#generation;this.pending=true;this.error=undefined;this.#changed();
  const result=await this.#request<{installations:AccountInstallation[]}>('/installations');if(generation!==this.#generation)return;this.pending=false;this.loaded=true;
  if(result.ok){this.installations=result.value.installations;if(!this.organisations.some(o=>o.id===this.selectedOrganisation)){this.selectedOrganisation=this.organisations[0]?.id;this.confirming=undefined;}if(!this.visible.some(i=>i.installationId===this.confirming&&i.canRevoke&&!i.revokedAt))this.confirming=undefined;}else{if(result.status===401||result.status===403){this.installations=[];this.selectedOrganisation=undefined;this.confirming=undefined;}this.#failure(result);}this.#changed();
 }
 async revoke(){
  if(!this.#account||this.pending||this.waiting||!this.confirming)return;const selected=this.installations.find(i=>i.installationId===this.confirming&&i.canRevoke&&!i.revokedAt);if(!selected)return;
  const generation=this.#generation;this.pending=true;this.error=undefined;this.#changed();
  const result=await this.#request<AccountInstallation>('/installations/revoke',{installationId:selected.installationId});if(generation!==this.#generation)return;this.pending=false;
  if(result.ok){const v=result.value;if(!v.revokedAt||['installationId','venueId','organisationId','legalBusinessId'].some(k=>v[k as keyof AccountInstallation]!==selected[k as keyof AccountInstallation]))this.error='unavailable';else{this.installations=this.installations.map(i=>i===selected?{...v,canRevoke:selected.canRevoke,...(selected.overview?{overview:selected.overview}:{})}:i);this.confirming=undefined;}}
  else this.#failure(result,true);this.#changed();
 }
}
