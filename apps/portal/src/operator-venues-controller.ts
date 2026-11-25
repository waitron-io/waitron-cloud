import {accountRequest,type ApiResult,type OperatorVenue,type OperatorVenueSearch} from './api.ts';
import type {Copy} from './locale.ts';

export class OperatorVenuesController {
 venue:OperatorVenue|undefined;
 results:OperatorVenueSearch|undefined;
 error:keyof Copy|undefined;
 pending=false;
 #account:string|undefined;
 #generation=0;
 #retryUntil=0;
 readonly #changed:()=>void;
 constructor(changed:()=>void){this.#changed=changed;}

 account(id:string|undefined){
  if(id===this.#account)return;
  this.#account=id;this.#generation++;this.venue=undefined;this.results=undefined;this.error=undefined;this.pending=false;
 }
 get waiting(){return Math.max(0,Math.ceil((this.#retryUntil-performance.now())/1000));}
 select(venue:OperatorVenue){this.venue=venue;this.results=undefined;this.error=undefined;this.#changed();}

 async #run(work:(current:()=>boolean)=>Promise<void>){
  if(!this.#account||this.pending||this.waiting)return;
  const generation=this.#generation,current=()=>generation===this.#generation;
  this.pending=true;this.error=undefined;this.#changed();
  try{await work(current);}
  finally{if(current()){this.pending=false;this.#changed();}}
 }
 #failure(reply:Extract<ApiResult<unknown>,{ok:false}>){
  this.#retryUntil=Math.max(this.#retryUntil,performance.now()+reply.retryAfterMs);
  this.error=reply.code==='proof_required'?'cloudActionsProofRequired':reply.status===403?'cloudActionsDenied':
   reply.status===401?'pairSession':reply.status===404?'linkUnavailable':reply.status===429?'limited':
   reply.status===400?'operatorVenueSearchHint':'unavailable';
  if(reply.status===401||reply.status===403&&reply.code!=='proof_required'){this.venue=undefined;this.results=undefined;}
 }
 async search(query:string){
  await this.#run(async current=>{
   this.results=undefined;
   const reply=await accountRequest<OperatorVenueSearch>('/operator/venues/read',{query});
   if(!current())return;
   if(reply.ok)this.results=reply.value;else this.#failure(reply);
  });
 }
 async #read(venueId:string,current:()=>boolean){
  const reply=await accountRequest<OperatorVenueSearch>('/operator/venues/read',{venueId});
  if(!current())return;
  this.venue=undefined;
  if(!reply.ok){this.#failure(reply);return;}
  const [venue]=reply.value.venues;
  if(venue?.id===venueId&&reply.value.venues.length===1)this.venue=venue;
  else this.error='unavailable';
 }
 async read(venueId:string){await this.#run(current=>this.#read(venueId,current));}
 async set(venue:OperatorVenue){
  if(this.venue!==venue)return;
  const stopped=!venue.stopped;
  await this.#run(async current=>{
   const reply=await accountRequest<OperatorVenue>('/operator/venues/address-lookup',{venueId:venue.id,stopped});
   if(!current())return;
   if(reply.ok&&reply.value.id===venue.id&&reply.value.stopped===stopped){this.venue=reply.value;return;}
   if(!reply.ok&&reply.status>0&&reply.status<500){this.#failure(reply);return;}
   // A missing reply can follow a committed switch. Read the stored state before offering another action.
   await this.#read(venue.id,current);
   if(current()&&this.venue?.stopped!==stopped)this.error??='unavailable';
  });
 }
}
