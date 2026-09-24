import {accountRequest,type ApiResult} from './api.ts';
import type {Copy} from './locale.ts';
import {remoteHostname,validRemoteView,validRemoteDns,type RemoteView,type RemoteDns,type RemoteKind} from './remote-types.ts';
export class RemoteController {
 installationId:string|undefined;view:RemoteView|undefined;kind:RemoteKind='staff';hostname='';confirmation:{kind:RemoteKind;hostname:string;revision:number;records:RemoteDns['records']}|undefined;
 error:keyof Copy|undefined;notice:keyof Copy|undefined;pending=false;retryAt=0;
 #account:string|undefined;#generation=0;#changed:()=>void;#request:typeof accountRequest;
 constructor(changed:()=>void,request:typeof accountRequest=accountRequest){this.#changed=changed;this.#request=request;}
 account(id:string|undefined){if(id!==this.#account){this.#account=id;this.close();}}
 get waiting(){return Math.max(0,Math.ceil((this.retryAt-Date.now())/1000));}
 close(){this.#generation++;this.installationId=undefined;this.view=undefined;this.hostname='';this.confirmation=undefined;this.pending=false;this.error=undefined;this.notice=undefined;}
 async open(id:string){if(!this.#account)return;this.close();this.installationId=id;this.kind='staff';await this.load();this.#changed();}
 choose(kind:RemoteKind){if(this.pending)return;this.kind=kind;this.edit(this.view?.names?.[kind].current??'');}
 edit(value:string){this.hostname=value;this.confirmation=undefined;this.error=undefined;this.notice=undefined;this.#changed();}
 #failure(result:Extract<ApiResult<unknown>,{ok:false}>){
  this.retryAt=Math.max(this.retryAt,Date.now()+result.retryAfterMs);
  this.error=result.status===429?'limited':result.status===401?'pairSession':result.status===403?'forbidden':result.code==='dns_not_verified'?'remoteDnsWait':result.code==='hostname_conflict'?'remoteNameTaken':result.status===409?'remoteConflict':result.status===400?'remoteInvalid':'unavailable';
  if(result.status===401||result.status===403){this.view=undefined;this.confirmation=undefined;this.hostname='';}
 }
 async load(){
  if(!this.#account||!this.installationId||this.pending||this.waiting)return;
  const generation=this.#generation,id=this.installationId;this.pending=true;this.error=undefined;this.confirmation=undefined;this.#changed();
  const result=await this.#request<RemoteView>('/remote-access/status',{installationId:id});if(generation!==this.#generation)return;
  this.pending=false;
  if(result.ok&&validRemoteView(result.value)&&result.value.installationId===id){this.view=result.value;this.hostname=this.view.names?.[this.kind].current??'';}
  else if(!result.ok)this.#failure(result);else this.error='unavailable';this.#changed();return this.view;
 }
 async preview(){
  if(!this.#account||!this.view?.names||this.view.revoked||!this.installationId||this.pending||this.waiting)return;
  const hostname=this.hostname.trim().toLowerCase(),kind=this.kind,revision=this.view.revision,id=this.installationId,generation=this.#generation;
  this.confirmation=undefined;this.error=undefined;this.notice=undefined;
  if(!remoteHostname(hostname)){this.error='remoteInvalid';this.#changed();return;}
  this.hostname=hostname;
  if(hostname===this.view.names[kind].assigned){this.confirmation={kind,hostname,revision,records:[]};this.#changed();return;}
  this.pending=true;this.#changed();const result=await this.#request<RemoteDns>('/remote-access/dns',{installationId:id,kind,hostname});if(generation!==this.#generation)return;this.pending=false;
  if(result.ok&&validRemoteDns(result.value)&&result.value.installationId===id&&result.value.kind===kind&&result.value.hostname===hostname&&result.value.records[0]?.value===this.view?.names?.[kind].assigned)this.confirmation={kind,hostname,revision,records:result.value.records};
  else if(!result.ok)this.#failure(result);else this.error='unavailable';this.#changed();
 }
 async apply(){
  const change=this.confirmation,id=this.installationId;
  if(!this.#account||!change||!id||this.pending||this.waiting||this.view?.revoked)return;
  const generation=this.#generation;this.pending=true;this.error=undefined;this.notice=undefined;this.#changed();
  const result=await this.#request<RemoteView>('/remote-access/apply',{installationId:id,kind:change.kind,hostname:change.hostname,expectedRevision:String(change.revision)});if(generation!==this.#generation)return;
  this.pending=false;this.confirmation=undefined;
  if(result.ok&&validRemoteView(result.value)&&result.value.installationId===id&&result.value.names?.[change.kind].current===change.hostname){this.view=result.value;this.notice='remoteSaved';}
  else if(!result.ok){
   this.#failure(result);
   if(result.status===0||result.status>=500||result.status===409){
    this.view=undefined;const refreshed=await this.load();if(generation!==this.#generation)return;
    if(refreshed?.names?.[change.kind].current===change.hostname)this.notice='remoteSaved';
    else if(!this.error)this.error=result.status===409?'remoteConflict':'remoteUncertain';
   }
  }else{this.view=undefined;this.error='remoteUncertain';}
  this.#changed();
 }
}
