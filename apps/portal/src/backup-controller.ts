import {accountRequest} from './api.ts';
import type {Copy} from './locale.ts';
import type {BackupPage} from './backup-types.ts';
export class BackupController {
 venueId:string|undefined;page:BackupPage|undefined;selected:string|undefined;selectedSource:'continuous'|'snapshot'|undefined;error:keyof Copy|undefined;pending=false;retryAt=0;
 #account:string|undefined;#generation=0;#changed:()=>void;#request:typeof accountRequest;
 constructor(changed:()=>void,request:typeof accountRequest=accountRequest){this.#changed=changed;this.#request=request;}
 account(id:string|undefined){if(id!==this.#account){this.#account=id;this.close();}}
 get waiting(){return Math.max(0,Math.ceil((this.retryAt-Date.now())/1000));}
 async open(venueId:string){if(!this.#account)return;this.close();this.venueId=venueId;await this.load();this.#changed();}
 close(){this.#generation++;this.venueId=undefined;this.page=undefined;this.selected=undefined;this.selectedSource=undefined;this.pending=false;this.error=undefined;}
 selectContinuous(){if(this.page?.continuousRecovery){this.selectedSource='continuous';this.#changed();}}
 select(id:string){if(this.page?.points.some(p=>p.id===id)){this.selected=id;this.selectedSource='snapshot';this.#changed();}}
 async load(next=false){
  if(!this.#account||!this.venueId||this.pending||this.waiting||(next&&!this.page?.nextCursor))return;
  const generation=this.#generation,venueId=this.venueId;this.pending=true;this.error=undefined;this.#changed();
  const result=await this.#request<BackupPage>('/backups/list',{venueId,...(next?{cursor:this.page!.nextCursor!}:{})});
  if(generation!==this.#generation)return;this.pending=false;
  if(result.ok&&result.value.venueId===venueId){
   const previousSource=this.selectedSource,previousPoint=this.selected;this.page=result.value;this.selected=this.page.points.some(p=>p.id===previousPoint)?previousPoint:this.page.points.find(p=>p.id===this.page!.defaultPointId)?.id??this.page.points[0]?.id;
   this.selectedSource=previousSource==='snapshot'&&this.selected?'snapshot':this.page.continuousRecovery?'continuous':this.selected?'snapshot':undefined;
  }else if(!result.ok){
   this.retryAt=Math.max(this.retryAt,Date.now()+result.retryAfterMs);
   this.error=result.status===429?'limited':result.status===401?'pairSession':result.status===403?(result.code==='permission_denied'?'permissionBusiness':'forbidden'):'unavailable';
   if(result.status===401||result.status===403){this.page=undefined;this.selected=undefined;this.selectedSource=undefined;}
  }else this.error='unavailable';
  this.#changed();
 }
}
