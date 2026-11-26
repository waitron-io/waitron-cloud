import {bodyRefusal} from './body-refusal.ts';
import {validEmail} from './email.ts';
import {accountRequest,type ApiResult} from './api.ts';
import type {Copy} from './locale.ts';
import {remoteHostname,validRemoteView,validRemoteDns,validGuestMenuView,validVenueEmail,sameVenueDnsRecords,type GuestMenuView,type RemoteView,type RemoteDns,type RemoteKind,type VenueEmailSettings} from './remote-types.ts';
export class RemoteController {
 installationId:string|undefined;view:RemoteView|undefined;kind:RemoteKind='staff';hostname='';confirmation:{kind:RemoteKind;hostname:string;revision:number;records:[]|RemoteDns['records']}|undefined;
 venueEmailDraft='';venueDomainDraft='';
 venueEmailField:'replyTo'|'address'='replyTo';
 venueEmailResult:'saved'|'cleared'|'invalid'|'failed'|undefined;
 error:keyof Copy|undefined;notice:keyof Copy|undefined;pending=false;
 #account:string|undefined;#generation=0;#changed:()=>void;#request:typeof accountRequest;
 constructor(changed:()=>void,request:typeof accountRequest=accountRequest){this.#changed=changed;this.#request=request;}
 account(id:string|undefined){if(id!==this.#account){this.#account=id;this.close();}}
 async setGuestMenuBlocked(blocked:boolean){
  const menu=this.view?.guestMenu;if(!this.#account||!menu||this.pending||this.waiting)return;
  const generation=this.#generation;this.pending=true;this.error=undefined;this.notice=undefined;this.#changed();
  const result=await this.#request<GuestMenuView>('/guest-menu/'+(blocked?'takedown':'enable'),{venueId:menu.venueId});
  if(generation!==this.#generation)return;this.pending=false;
  if(result.ok&&validGuestMenuView(result.value)&&result.value.venueId===menu.venueId&&this.view){this.view={...this.view,guestMenu:result.value};}
  else if(!result.ok){this.#failure(result);if(result.status===0||result.status>=500)await this.#load(true);}
  else{this.view=undefined;this.error='unavailable';}
  this.#changed();
 }
 async saveVenueEmail(value:string,field:'replyTo'|'address'|'reset'='replyTo'){
  const id=this.installationId;
  if(!this.#account||!id||!this.view?.venueEmail||this.pending||this.waiting)return;
  this.venueEmailField=field==='reset'?'replyTo':field;
  if((value!==''||field==='address')&&!validEmail(value)){this.venueEmailResult='invalid';this.#changed();return;}
  const generation=this.#generation;
  this.pending=true;this.error=undefined;this.venueEmailResult=undefined;this.#changed();
  const action=field==='address'?'save-domain':field==='replyTo'&&value===''?'clear-reply':'save';
  const body=field==='address'?{installationId:id,address:value}:action==='clear-reply'?{installationId:id}:{installationId:id,replyTo:value};
  const result=await this.#request<VenueEmailSettings>(`/venue-email/${action}`,body);
  if(generation!==this.#generation)return;
  this.pending=false;
  if(result.ok&&this.view){
   this.view={...this.view,venueEmail:result.value};
   this.venueEmailDraft=result.value.replyTo??'';
   this.venueDomainDraft=result.value.domain?.address??'';
   this.venueEmailResult=field==='reset'?'cleared':'saved';
  }else if(!result.ok){
   if(result.status===401||result.status===403||result.status===429)this.#failure(result);
   else{
    this.#retryUntil=Math.max(this.#retryUntil,performance.now()+result.retryAfterMs);
    this.venueEmailResult=result.status===400?'invalid':'failed';
   }
  }
  this.#changed();
  if(result.ok)await this.#checkVenueDns();
 }
 editVenueEmail(value:string,field:'replyTo'|'address'='replyTo'){
  if(field==='replyTo')this.venueEmailDraft=value;else this.venueDomainDraft=value;this.venueEmailResult=undefined;this.error=undefined;this.#changed();
 }
 get hostnameChanged(){return !!this.view?.names&&this.hostname.trim().toLowerCase().replace(/\.$/,'')!==this.view.names[this.kind].current;}
 // Relative server waits keep their deadline across wall-clock corrections and account changes.
 #retryUntil=0;
 get retryAt(){const remaining=this.#retryUntil-performance.now();return remaining>0?Date.now()+remaining:0;}
 get waiting(){return Math.max(0,Math.ceil((this.#retryUntil-performance.now())/1000));}
 close(){this.#generation++;this.installationId=undefined;this.view=undefined;this.hostname='';this.confirmation=undefined;this.pending=false;this.error=undefined;this.notice=undefined;this.venueEmailDraft='';this.venueDomainDraft='';this.venueEmailResult=undefined;}
 async open(id:string){if(!this.#account)return;this.close();this.installationId=id;this.kind='staff';await this.load();this.#changed();}
 choose(kind:RemoteKind){if(this.pending)return;this.kind=kind;this.edit(this.view?.names?.[kind].current??'');}
 edit(value:string){this.hostname=value;this.confirmation=undefined;this.error=undefined;this.notice=undefined;this.#changed();}
 #failure(result:Extract<ApiResult<unknown>,{ok:false}>){
  this.#clearForward();
  this.#retryUntil=Math.max(this.#retryUntil,performance.now()+result.retryAfterMs);
  if(result.code==='enrollment_required'||result.code==='proof_required'){
   this.error=result.code==='enrollment_required'?'pairEnrollment':'actionProofUnavailable';return;
  }
  const cause=bodyRefusal(result);
  this.error=cause?`remoteRequest${cause}`:result.code==='remote_not_placed'?'remoteNotPlaced':result.status===429?'limited':result.status===401?'pairSession':result.status===403?(result.code==='permission_denied'?'permissionBusiness':result.code==='venue_email_connected_required'?'venueEmailConnectedRequired':result.code==='remote_plan_required'?'remotePlanRequired':result.code==='remote_setup_required'?'remoteSetupRequired':result.code==='remote_test_only'?'remoteTestOnly':result.code==='revoked'?'remoteRevoked':'forbidden'):result.code==='dns_not_verified'?'remoteDnsWait':result.code==='hostname_conflict'?'remoteNameTaken':result.status===409?'remoteConflict':result.status===400?'remoteInvalid':'unavailable';
  if(result.status===401||result.status===403){this.view=undefined;this.confirmation=undefined;this.hostname='';this.venueEmailDraft='';this.venueDomainDraft='';}
 }
 expireForward(now=Date.now()){if(this.view?.publicForward&&Date.parse(this.view.publicForward.expiresAt)<=now)this.view={...this.view,publicForward:null};}
 #clearForward(){if(this.view?.publicForward)this.view={...this.view,publicForward:null};}
 #accept(value:RemoteView){this.view={...value,publicForward:value.publicForward??null};this.expireForward();}
 async load(){return this.#load(false);}
 async #load(reconcile:boolean){
  if(!this.#account||!this.installationId||this.pending||(!reconcile&&this.waiting))return;
  this.#clearForward();const generation=this.#generation,id=this.installationId;this.pending=true;this.error=undefined;this.confirmation=undefined;this.venueEmailResult=undefined;this.#changed();
  const result=await this.#request<RemoteView>('/remote-access/status',{installationId:id});if(generation!==this.#generation)return;
  this.pending=false;
  if(result.ok&&validRemoteView(result.value)&&result.value.installationId===id){this.#accept(result.value);this.hostname=result.value.names?.[this.kind].current??'';this.venueEmailDraft=result.value.venueEmail?.replyTo??'';this.venueDomainDraft=result.value.venueEmail?.domain?.address??'';}
  else if(!result.ok)this.#failure(result);else {this.#clearForward();this.error='unavailable';}this.#changed();
  if(result.ok)await this.#checkVenueDns();
  return this.view;
 }
 async #checkVenueDns(){
  const id=this.installationId,email=this.view?.venueEmail,domain=email?.domain;
  if(!id||!email||!domain?.records.length)return;
  const result=await this.#request<VenueEmailSettings>('/venue-email/check-dns',{installationId:id});
  if(!this.view||this.view.venueEmail!==email)return;
  const checked=result.ok&&validVenueEmail(result.value)?result.value.domain:undefined;
  const matches=checked&&checked.address===domain.address&&sameVenueDnsRecords(domain.records,checked.records);
  const records=matches?checked.records:domain.records.map(record=>({...record,status:'unknown' as const}));
  this.view={...this.view,venueEmail:{...email,domain:{...domain,records}}};
  this.#changed();
 }
 async recheck(kind:RemoteKind){
  const id=this.installationId;
  if(!this.#account||!id||this.view?.revoked||!this.view?.names?.[kind].recordMoved||this.pending||this.waiting)return false;
  this.#clearForward();const generation=this.#generation;
  this.pending=true;this.error=undefined;this.notice=undefined;this.#changed();
  const result=await this.#request<RemoteView>('/remote-access/recheck',{installationId:id,kind});
  if(generation!==this.#generation)return false;
  this.pending=false;
  if(result.ok&&validRemoteView(result.value)&&result.value.installationId===id){
   this.confirmation=undefined;
   this.#accept(result.value);this.hostname=result.value.names?.[this.kind].current??'';
   this.#changed();
   await this.#checkVenueDns();
   return result.value.names?.[kind].recordMoved===false;
  }
  if(!result.ok)this.#failure(result);else this.error='unavailable';
  this.#changed();
  return false;
 }
 async preview(){
  if(!this.#account||!this.view?.names||this.view.revoked||!this.installationId||this.pending||this.waiting||!this.hostnameChanged)return;
  const hostname=this.hostname.trim().toLowerCase().replace(/\.$/,''),kind=this.kind,revision=this.view.revision,id=this.installationId,generation=this.#generation;
  this.confirmation=undefined;this.error=undefined;this.notice=undefined;
  if(!remoteHostname(hostname)){this.error='remoteInvalid';this.#changed();return;}
  this.hostname=hostname;
  if(hostname===this.view.names[kind].assigned){this.confirmation={kind,hostname,revision,records:[]};this.#changed();return;}
  this.pending=true;this.#changed();const result=await this.#request<RemoteDns>('/remote-access/dns',{installationId:id,kind,hostname});if(generation!==this.#generation)return;this.pending=false;
  if(result.ok&&validRemoteDns(result.value)&&result.value.installationId===id&&result.value.kind===kind&&result.value.hostname===hostname&&result.value.records[0]?.value===this.view?.names?.[kind].assigned)this.confirmation={kind,hostname,revision,records:result.value.records};
  else if(!result.ok)this.#failure(result);else {this.#clearForward();this.error='unavailable';}this.#changed();
 }
 async apply(){
  const change=this.confirmation,id=this.installationId;
  if(!this.#account||!change||!id||this.pending||this.waiting||this.view?.revoked)return;
  this.#clearForward();const generation=this.#generation;this.pending=true;this.error=undefined;this.notice=undefined;this.#changed();
  const result=await this.#request<RemoteView>('/remote-access/apply',{installationId:id,kind:change.kind,hostname:change.hostname,expectedRevision:String(change.revision)});if(generation!==this.#generation)return;
  this.pending=false;this.confirmation=undefined;
  if(result.ok&&validRemoteView(result.value)&&result.value.installationId===id&&result.value.names?.[change.kind].current===change.hostname){this.#accept(result.value);this.notice='remoteSaved';}
  else if(!result.ok){
   this.#failure(result);
   if(result.code==='proof_required'||result.code==='enrollment_required')this.confirmation=change;
   if(result.status===0||result.status>=500||result.status===409){
    this.view=undefined;const refreshed=await this.#load(true);if(generation!==this.#generation)return;
    if(refreshed?.names?.[change.kind].current===change.hostname)this.notice='remoteSaved';
    else if(!this.error)this.error=result.status===409?'remoteConflict':'remoteUncertain';
   }
  }else{this.view=undefined;this.error='remoteUncertain';}
  this.#changed();
  if(result.ok)await this.#checkVenueDns();
 }
}
