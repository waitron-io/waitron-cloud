import {accountRequest,type ApiResult} from './api.ts';
import type {Copy} from './locale.ts';
import {validDiagnosticExport,type DiagnosticExport} from './diagnostic-types.ts';

type Saver=(value:DiagnosticExport,name:string)=>void;
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
function browserSave(value:DiagnosticExport,name:string){
 const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'})),link=document.createElement('a');
 try{link.href=url;link.download=name;link.click();}finally{URL.revokeObjectURL(url);}
}
export class DiagnosticController{
 pending=false;selected:string|undefined;error:keyof Copy|undefined;retryAt=0;
 #account:string|undefined;#generation=0;readonly #changed:()=>void;readonly #request:typeof accountRequest;readonly #save:Saver;
 constructor(changed:()=>void,request:typeof accountRequest=accountRequest,save:Saver=browserSave){this.#changed=changed;this.#request=request;this.#save=save;}
 account(id:string|undefined){if(id!==this.#account){this.#account=id;this.#generation++;this.pending=false;this.selected=undefined;this.error=undefined;}}
 get waiting(){return Math.max(0,Math.ceil((this.retryAt-Date.now())/1000));}
 async download(installationId:string){
  if(!this.#account||this.pending||this.waiting||!uuid.test(installationId))return;const generation=this.#generation;
  this.pending=true;this.selected=installationId;this.error=undefined;this.#changed();
  const result:ApiResult<DiagnosticExport>=await this.#request('/diagnostics/read',{installationId});if(generation!==this.#generation)return;
  this.pending=false;this.selected=undefined;
  if(result.ok&&validDiagnosticExport(result.value)&&result.value.installation.installationId===installationId){
   const stamp=result.value.generatedAt.replaceAll('-','').replaceAll(':','').replace(/\.\d{3}Z$/,'Z');
   this.#save(result.value,`waitron-cloud-diagnostic-${result.value.installation.venueId.slice(0,8)}-${stamp}.json`);
  }else if(result.ok)this.error='diagnosticUnavailable';else this.#failure(result);
  this.#changed();
 }
 #failure(result:Extract<ApiResult<unknown>,{ok:false}>){
  this.retryAt=Math.max(this.retryAt,Date.now()+result.retryAfterMs);
  this.error=result.status===429?'limited':result.status===401?'pairSession':result.status===403?'forbidden':'diagnosticUnavailable';
 }
}
