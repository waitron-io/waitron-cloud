import {accountRequest} from './api.ts';
import type {Copy} from './locale.ts';
export type CloudActionView={actions:{id:string;policy:'ask-first'|'act-and-report';available:false}[]};

export class CloudActionsController{
 view:CloudActionView|undefined;pending=false;loadAttempted=false;error:keyof Copy|undefined;
 #account:string|undefined;#generation=0;#retryUntil=0;readonly #changed:()=>void;
 constructor(changed:()=>void){this.#changed=changed;}
 account(id:string|undefined){if(id!==this.#account){this.#account=id;this.#generation++;this.view=undefined;this.pending=false;this.loadAttempted=false;this.error=undefined;}}
 get waiting(){return Math.max(0,Math.ceil((this.#retryUntil-performance.now())/1000));}
 async load(){
  if(!this.#account||this.pending||this.waiting)return;
  const generation=this.#generation;this.view=undefined;this.pending=true;this.loadAttempted=true;this.error=undefined;this.#changed();
  const result=await accountRequest<CloudActionView>('/operator/actions');
  if(generation!==this.#generation)return;
  this.pending=false;
  if(result.ok)this.view=result.value;
  else{
   this.#retryUntil=Math.max(this.#retryUntil,performance.now()+result.retryAfterMs);
   this.error=result.status===403?'cloudActionsDenied':result.status===401?'pairSession':result.status===429?'limited':'unavailable';
  }
  this.#changed();
 }
}
