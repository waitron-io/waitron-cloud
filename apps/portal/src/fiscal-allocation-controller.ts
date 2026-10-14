import {accountRequest,type ApiResult} from './api.ts';
import type {Copy} from './locale.ts';
import {validReserve,validAllocationReceipt,validAllocationPage,validAllocationStatus,validPaperImport,validPaperHistory,manualPacket,same,type AllocationReceipt,type AllocationPage,type PaperImportResult,type ReserveInput,type ConsumeInput,type PaperHistoryInput} from './fiscal-allocation-types.ts';
type Pending={action:'reserve';input:ReserveInput}|{action:'consume';input:ConsumeInput}|{action:'import-paper';input:PaperHistoryInput};
export class FiscalAllocationController{
 paperText='';fieldErrors=new Set<string>();
 venueId:string|undefined;selection:ReserveInput|undefined;receipt:AllocationReceipt|undefined;page:AllocationPage|undefined;imported:PaperImportResult|undefined;
 oldMachineOffline=false;oldMachineAbsent=false;noParallelRecovery=false;uncertain=false;pending=false;retryAt=0;error:keyof Copy|undefined;pendingRequest:Pending|undefined;
 #submittedReserve:ReserveInput|undefined;canRetryPending=false;
 #account:string|undefined;#generation=0;#changed:()=>void;#request:typeof accountRequest;
 constructor(changed:()=>void,request:typeof accountRequest=accountRequest){this.#changed=changed;this.#request=request;}
 #clear(){this.#generation++;this.#submittedReserve=undefined;this.canRetryPending=false;this.paperText='';this.fieldErrors.clear();this.selection=undefined;this.receipt=undefined;this.page=undefined;this.imported=undefined;this.pendingRequest=undefined;this.uncertain=false;this.pending=false;this.error=undefined;this.#confirmations();}
 #confirmations(){this.oldMachineOffline=false;this.oldMachineAbsent=false;this.noParallelRecovery=false;}
 account(id:string|undefined){if(id!==this.#account){this.#clear();this.#account=id;}}
 open(venue:string|undefined){if(venue!==this.venueId){this.#clear();this.venueId=venue;}}
 start(environment:'preproduction'|'production',reuse=false){if(!this.venueId||this.uncertain||this.pending)return;const previous=reuse?this.selection:undefined;this.choose(previous?{...previous,operationId:crypto.randomUUID()}:{version:1,operationId:crypto.randomUUID(),venueId:this.venueId,scope:{taxpayerNif:'',softwareId:'',environment},bases:[{code:'',purpose:'standard'}],binding:{eventId:crypto.randomUUID(),operatorId:'',sourceId:'',targetNodeId:'',incidentEvidence:''},mode:'recovery'});this.receipt=undefined;this.imported=undefined;this.error=undefined;}
 choose(input:ReserveInput){if(this.pending||this.uncertain)return;if(!same(this.selection,input)){this.#generation++;this.selection=structuredClone(input);if(this.#submittedReserve?.operationId===input.operationId&&!same(this.#submittedReserve,input))this.selection={...this.selection,operationId:crypto.randomUUID()};this.receipt=undefined;this.#confirmations();}}
 fence(){this.#clear();this.venueId=undefined;}
 inspect(receipt:AllocationReceipt){if(this.uncertain||this.pending||!this.#matches(receipt,false))return;this.receipt=structuredClone(receipt);this.selection={version:1,operationId:crypto.randomUUID(),venueId:receipt.payload.venueId,scope:{taxpayerNif:receipt.payload.allocation.taxpayerNif,softwareId:receipt.payload.allocation.softwareId,environment:receipt.payload.allocation.environment},bases:receipt.payload.allocation.series.map(s=>({code:s.code.slice(0,-receipt.payload.allocation.installationIdentity.length-1),purpose:s.purpose})),binding:receipt.payload.binding,mode:receipt.payload.mode};this.#confirmations();this.#changed();}
 get waiting(){return Math.max(0,Math.ceil((this.retryAt-Date.now())/1000));}
 get packet(){return !this.uncertain&&this.receipt?.payload.state==='consumed'?manualPacket(this.receipt):undefined;}
 #available(){return !!this.#account&&!!this.venueId&&!this.pending&&!this.waiting;}
 #matches(r:unknown,currentActor=true):r is AllocationReceipt{return validAllocationReceipt(r)&&r.payload.venueId===this.venueId&&(!currentActor||r.payload.cloudAccountId===this.#account);}
 #failure(r:Extract<ApiResult<unknown>,{ok:false}>){this.retryAt=Math.max(this.retryAt,Date.now()+r.retryAfterMs);this.error=r.status===429?'limited':r.status===401?'pairSession':r.status===403?'forbidden':r.code==='entitlement_unavailable'?'fiscalEntitlement':r.code==='custody_unavailable'?'fiscalCustody':r.code==='continuity_unavailable'?'fiscalContinuity':r.code==='binding_conflict'?'fiscalConflict':r.code==='space_exhausted'?'fiscalExhausted':r.code==='reservation_untrusted'?'fiscalTrust':r.code==='invalid_input'?'fiscalInvalid':'unavailable';
  if(r.status===401||r.status===403){this.receipt=undefined;this.page=undefined;this.imported=undefined;this.#confirmations();}
 }
 async reserve(input:ReserveInput){
  if(!this.#available()||this.uncertain)return;
  if(!validReserve(input)||input.venueId!==this.venueId){this.error='fiscalInvalid';this.#changed();return;}
  if(!same(this.selection,input))this.choose(input);
  await this.#write({action:'reserve',input:structuredClone(this.selection!)});
 }
 async consume(input:ConsumeInput){
  if(!this.#available()||this.uncertain||this.receipt?.payload.state!=='reserved')return;
  const p=this.receipt.payload;
  if(input.allocationId!==p.allocation.allocationId||!same(input.binding,p.binding)||!this.noParallelRecovery||!input.noParallelRecovery||(p.mode==='recovery'&&(!this.oldMachineOffline||!input.oldMachineOffline||input.oldMachineAbsent))||(p.mode==='initial-setup'&&(!this.oldMachineAbsent||!input.oldMachineAbsent)))return;
  await this.#write({action:'consume',input:structuredClone(input)});
 }
 async importPaper(input:PaperHistoryInput){
  if(!this.#available()||this.uncertain)return;
  if(!validPaperHistory(input)||input.venueId!==this.venueId){this.error='fiscalInvalid';this.#changed();return;}
  await this.#write({action:'import-paper',input:structuredClone(input)});
 }
 #result(value:unknown,request:Pending):boolean{
  if(request.action==='import-paper'){if(!validPaperImport(value))return false;this.imported=value;return true;}
  if(!this.#matches(value)||!same(value.payload.binding,request.input.binding))return false;
  const p=value.payload;
  if(request.action==='reserve'){
   const i=request.input,e=p.allocation.reservationEvidence as {reservationId:string};if(e.reservationId!==i.operationId||p.state!=='reserved'||p.mode!==i.mode||!same(i.scope,{taxpayerNif:p.allocation.taxpayerNif,softwareId:p.allocation.softwareId,environment:p.allocation.environment})||!same(p.allocation.series,i.bases.map(s=>({code:s.code+'-'+p.allocation.installationIdentity,purpose:s.purpose}))))return false;
  }else{
   const i=request.input,approval={version:1,...i.binding,oldMachineOffline:i.oldMachineOffline,oldMachineAbsent:i.oldMachineAbsent,noParallelRecovery:i.noParallelRecovery,confirmedAt:i.confirmedAt};
   if(p.state!=='consumed'||p.allocation.allocationId!==i.allocationId||!this.receipt||!same(p.allocation,this.receipt.payload.allocation)||!same(p.approval,approval))return false;
  }
  this.receipt=value;return true;
 }
 async #write(request:Pending){
  this.canRetryPending=false;if(request.action==='reserve')this.#submittedReserve=request.input;
  const generation=this.#generation;this.pendingRequest=request;this.pending=true;this.error=undefined;this.#changed();
  const result=await this.#request<unknown>('/fiscal-allocations/'+request.action,{...request.input});if(generation!==this.#generation)return;this.pending=false;this.#confirmations();
  if(result.ok&&this.#result(result.value,request)){this.pendingRequest=undefined;this.uncertain=false;}
  else{
   if(!result.ok)this.#failure(result);else this.error='fiscalUncertain';
   this.uncertain=result.ok||result.status===0||result.code==='unexpected_response'||result.code==='history_uncertain'||(result.status>=500&&!['entitlement_unavailable','custody_unavailable','continuity_unavailable'].includes(result.code));
   if(this.uncertain){if(result.ok||!['space_exhausted','reservation_untrusted'].includes(result.code))this.error='fiscalUncertain';}else this.pendingRequest=undefined;
  }
  this.#changed();
 }
 async reconcile(){
  if(!this.#available()||!this.pendingRequest)return;const request=this.pendingRequest,generation=this.#generation;this.pending=true;this.#changed();
  const result=await this.#request<unknown>('/fiscal-allocations/status',{version:1,venueId:this.venueId,operationId:request.input.operationId});if(generation!==this.#generation)return;this.pending=false;
  if(result.ok&&validAllocationStatus(result.value)&&result.value.state==='recorded'&&result.value.receipt&&this.#result(result.value.receipt,request)){this.uncertain=false;this.pendingRequest=undefined;this.error=undefined;}
  else if(result.ok&&validAllocationStatus(result.value)&&result.value.state==='recorded'&&result.value.receipt===null&&request.action==='import-paper'){
   this.uncertain=false;this.pendingRequest=undefined;await this.#write(request);return;
  }else{if(!result.ok)this.#failure(result);this.uncertain=true;this.canRetryPending=result.ok&&validAllocationStatus(result.value)&&result.value.state==='unknown';if(result.ok&&!['fiscalExhausted','fiscalTrust'].includes(this.error??''))this.error='fiscalUncertain';}
  this.#changed();
 }
 async retryPending(){if(!this.#available()||!this.uncertain||!this.canRetryPending||!this.pendingRequest)return;await this.#write(this.pendingRequest);}
 async load(cursor:string|null){
  if(!this.#available())return;const generation=this.#generation;this.pending=true;if(!this.uncertain)this.error=undefined;this.#changed();
  const result=await this.#request<unknown>('/fiscal-allocations/list',{version:1,venueId:this.venueId,cursor,limit:50});if(generation!==this.#generation)return;this.pending=false;
  if(result.ok&&validAllocationPage(result.value)&&result.value.items.every(r=>this.#matches(r,false)))this.page=result.value;
  else if(!result.ok)this.#failure(result);else this.error='unavailable';this.#changed();
 }
}
