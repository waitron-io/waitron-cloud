import {bodyRefusal} from './body-refusal.ts';
import {accountRequest} from './api.ts';
import {downloadDatabase} from './backup-database-download.ts';
import type {Copy} from './locale.ts';
import type {BackupDownload,BackupPage} from './backup-types.ts';
const downloadExtension = {'download':'backup.enc','download-key':'key','download-manifest':'manifest.json'};
export class BackupController {
 venueId:string|undefined;page:BackupPage|undefined;selected:string|undefined;selectedSource:'continuous'|'snapshot'|undefined;pending=false;
 downloadProof=false;downloadError:keyof Copy|undefined;
 #listError:keyof Copy|undefined;
 #download:AbortController|undefined;
 // Relative retry waits use elapsed time; retryAt projects the remainder for the shared wall-clock countdown.
 #retryUntil=0;#account:string|undefined;#generation=0;#changed:()=>void;#request:typeof accountRequest;
 constructor(changed:()=>void,request:typeof accountRequest=accountRequest){this.#changed=changed;this.#request=request;}
 account(id:string|undefined){if(id!==this.#account){this.#account=id;this.close();}}
 get retryAt(){const remaining=this.#retryUntil-performance.now();return remaining>0?Date.now()+remaining:0;}
 get waiting(){return Math.max(0,Math.ceil((this.#retryUntil-performance.now())/1000));}
 async open(venueId:string){if(!this.#account)return;this.close();this.venueId=venueId;await this.load();this.#changed();}
 close(){this.cancelDownload();this.#generation++;this.venueId=undefined;this.page=undefined;this.selected=undefined;this.selectedSource=undefined;this.pending=false;this.#listError=undefined;}
 cancelDownload(){
  this.downloadError=undefined;
  this.#download?.abort();this.#download=undefined;this.downloadProof=false;
 }
 get downloading(){return !!this.#download;}
 get error(){return this.downloadError??this.#listError;}
 get downloadable(){return this.page?.exitDownloadAvailable===true&&this.page.points.some(point=>point.id===this.selected&&point.verification==='verified');}
 selectContinuous(){if(this.page?.continuousRecovery){this.cancelDownload();this.selectedSource='continuous';this.#changed();}}
 select(id:string){if(this.page?.points.some(p=>p.id===id)){
  if(this.selected!==id)this.cancelDownload();
  this.selected=id;this.selectedSource='snapshot';this.#changed();
 }}
 async download(action:BackupDownload){
  const venueId=this.venueId,pointId=this.selected;
  if(!this.#account||!venueId||!pointId||!this.downloadable||this.pending||this.#download||this.waiting)return;
  const transfer=new AbortController();this.#download=transfer;this.downloadError=undefined;this.#listError=undefined;this.#changed();
  try{
   const result=await (action==='download-database'?downloadDatabase(venueId,pointId,transfer.signal)
    :this.#request<Blob>(`/backups/${action}`,{venueId,pointId},transfer.signal));
   if(transfer.signal.aborted)return;
   if(result.ok){
    if(action==='download-database'||!result.value)return;
    const url=URL.createObjectURL(result.value),link=document.createElement('a');
    try{link.href=url;link.download=`waitron-backup-${pointId}.${downloadExtension[action]}`;link.click();}finally{URL.revokeObjectURL(url);}
   }else{
    this.#retryUntil=Math.max(this.#retryUntil,performance.now()+result.retryAfterMs);
    if(result.status===401||result.code==='permission_denied'){this.page=undefined;this.selected=undefined;this.selectedSource=undefined;}
    this.downloadError=result.code==='proof_required'?'snapshotDownloadProof':result.code==='enrollment_required'?'pairEnrollment':
     result.status===429?'limited':result.status===401?'pairSession':result.status===403?(result.code==='permission_denied'?'permissionBusiness':'forbidden'):
     result.code==='download_too_large'?'snapshotDownloadTooLarge':
     action==='download-database'?'snapshotDatabaseOpenFailed':'snapshotDownloadUnavailable';
    this.downloadProof=result.code==='proof_required'||result.code==='enrollment_required';
   }
  }finally{if(this.#download===transfer){this.#download=undefined;this.#changed();}}
 }
 async load(next=false){
  if(!this.#account||!this.venueId||this.pending||this.waiting||(next&&!this.page?.nextCursor))return;
  this.cancelDownload();
  const generation=this.#generation,venueId=this.venueId;this.pending=true;this.#listError=undefined;this.#changed();
  const result=await this.#request<BackupPage>('/backups/list',{venueId,...(next?{cursor:this.page!.nextCursor!}:{})});
  if(generation!==this.#generation)return;this.pending=false;
  if(result.ok&&result.value.venueId===venueId){
   const previousSource=this.selectedSource,previousPoint=this.selected;this.page=result.value;this.selected=this.page.points.some(p=>p.id===previousPoint)?previousPoint:this.page.points.find(p=>p.id===this.page!.defaultPointId)?.id??this.page.points[0]?.id;
   this.selectedSource=previousSource==='snapshot'&&this.selected?'snapshot':this.page.continuousRecovery?'continuous':this.selected?'snapshot':undefined;
  }else if(!result.ok){
   this.#retryUntil=Math.max(this.#retryUntil,performance.now()+result.retryAfterMs);
   const cause=bodyRefusal(result);
   this.#listError=cause?`snapshotsRequest${cause}`:result.status===429?'limited':result.status===401?'pairSession':result.status===403?(result.code==='permission_denied'?'permissionBusiness':'forbidden'):'unavailable';
   if(result.status===401||result.status===403){this.page=undefined;this.selected=undefined;this.selectedSource=undefined;}
  }else this.#listError='unavailable';
  this.#changed();
 }
}
