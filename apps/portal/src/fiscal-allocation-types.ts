import type {AllocationReceipt,AllocationPage,StatusResult,PaperImportResult,PaperHistoryInput,ReserveInput,ConsumeInput} from '../../../packages/fiscal-allocation/src/types.ts';
export type {AllocationReceipt,AllocationPage,StatusResult,PaperImportResult,PaperHistoryInput,ReserveInput,ConsumeInput};
type Obj=Record<string,unknown>;
const object=(v:unknown):v is Obj=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v:unknown,keys:string[]):v is Obj=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const text=(v:unknown,max=256):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const digest=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const decimal=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(v);
const date=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const bounded=(v:unknown,max:number)=>new TextEncoder().encode(JSON.stringify(v)).length<=max;
const encoded=(v:unknown,size?:number):v is string=>{
 if(typeof v!=='string'||!v||!/^[A-Za-z0-9_-]+$/.test(v))return false;
 try{const raw=atob(v.replace(/-/g,'+').replace(/_/g,'/'));return (size===undefined||raw.length===size)&&btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')===v;}catch{return false;}
};
const scope=(v:unknown):v is Obj=>exact(v,['taxpayerNif','softwareId','environment'])&&typeof v.taxpayerNif==='string'&&/^[A-Z0-9]{9}$/.test(v.taxpayerNif)&&typeof v.softwareId==='string'&&/^[A-Z0-9]{2}$/.test(v.softwareId)&&['preproduction','production'].includes(String(v.environment));
const bindingKeys=['eventId','operatorId','sourceId','targetNodeId','incidentEvidence'];
const binding=(v:unknown):v is Obj=>exact(v,bindingKeys)&&bindingKeys.filter(k=>k!=='operatorId').every(k=>text(v[k]))&&(text(v.operatorId)||(exact(v.operatorId,['kind','nodeId','eventId'])&&v.operatorId.kind==='recovery-key'&&text(v.operatorId.nodeId)&&text(v.operatorId.eventId)&&v.operatorId.nodeId===v.targetNodeId&&v.operatorId.eventId===v.eventId));
export function same(a:unknown,b:unknown):boolean{return canonical(a)===canonical(b);}
function canonical(v:unknown):string{
 if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
 if(object(v))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
 return JSON.stringify(v);
}
function series(v:unknown,identity?:string):boolean{
 if(!Array.isArray(v)||v.length<1||v.length>20)return false;
 const codes=new Set<string>();
 for(const s of v){if(!exact(s,['code','purpose'])||!text(s.code,49)||!['standard','full','rectificative'].includes(String(s.purpose))||codes.has(s.code))return false;
  const suffix=identity?'-'+identity:'';if(suffix&&!s.code.endsWith(suffix))return false;
  const base=suffix?s.code.slice(0,-suffix.length):s.code;if(!/^[A-Za-z0-9/_.-]{1,21}$/.test(base))return false;codes.add(s.code);
 }
 return v.some(s=>s.purpose==='standard');
}
function allocation(v:unknown,paper=false):v is Obj{
 const keys=['version','allocationId','taxpayerNif','softwareId','environment','installationIdentity','series','source','issuedAt',...(paper?[]:['reservationEvidence'])];
 if(!exact(v,keys)||v.version!==1||!uuid(v.allocationId)||!scope({taxpayerNif:v.taxpayerNif,softwareId:v.softwareId,environment:v.environment})||!date(v.issuedAt)||typeof v.installationIdentity!=='string')return false;
 const identity=v.installationIdentity;
 if(paper? !/^[SP][0-9]{6}$/.test(identity)||identity.slice(1)==='000000'||v.source!==(identity[0]==='S'?'initial-paper':'paper') : !/^C[0-9]{6}$/.test(identity)||identity.slice(1)==='000000'||v.source!=='cloud')return false;
 if(!series(v.series,identity))return false;
 if(!paper){const e=v.reservationEvidence;if(!exact(e,['kind','authorityId','reservationId','reservationSequence'])||e.kind!=='cloud'||!text(e.authorityId)||!uuid(e.reservationId)||!decimal(e.reservationSequence))return false;}
 return true;
}
// Browser checks exclude malformed evidence; the local recovery verifier supplies cryptographic authority.
export function validAllocationReceipt(v:unknown):v is AllocationReceipt{
 if(!exact(v,['payload','keyId','signature'])||!digest(v.keyId)||!encoded(v.signature,64))return false;
 const p=v.payload;
 if(!exact(p,['version','issuer','receiptId','state','allocation','binding','mode','approval','cloudAccountId','venueId','custodyVersion','entitlementVersion','continuity','recordedAt'])||p.version!==1||!text(p.issuer)||!uuid(p.receiptId)||!['reserved','consumed','abandoned'].includes(String(p.state))||!allocation(p.allocation)||!binding(p.binding)||!['initial-setup','recovery'].includes(String(p.mode))||!uuid(p.cloudAccountId)||!uuid(p.venueId)||!text(p.custodyVersion)||!text(p.entitlementVersion)||!date(p.recordedAt))return false;
 const w=p.continuity,a=p.allocation,e=a.reservationEvidence;
 if(!exact(w,['authorityId','scope','sequence','cHighWater','historyDigest','writerFence','requestNonce','observedAt','keyId','signature'])||!text(w.authorityId)||!scope(w.scope)||!decimal(w.sequence)||!Number.isSafeInteger(w.cHighWater)||Number(w.cHighWater)<Number((a.installationIdentity as string).slice(1))||Number(w.cHighWater)>999999||!digest(w.historyDigest)||!decimal(w.writerFence)||!text(w.requestNonce)||!date(w.observedAt)||!digest(w.keyId)||!encoded(w.signature,64)||!same(w.scope,{taxpayerNif:a.taxpayerNif,softwareId:a.softwareId,environment:a.environment})||!object(e)||e.authorityId!==w.authorityId||!decimal(e.reservationSequence)||BigInt(e.reservationSequence)>BigInt(w.sequence))return false;
 if(p.state==='consumed'){
  const approval=p.approval;if(!exact(approval,['version',...bindingKeys,'oldMachineOffline','oldMachineAbsent','noParallelRecovery','confirmedAt'])||approval.version!==1||!bindingKeys.every(k=>same(approval[k],(p.binding as Obj)[k]))||typeof approval.oldMachineOffline!=='boolean'||typeof approval.oldMachineAbsent!=='boolean'||approval.noParallelRecovery!==true||!date(approval.confirmedAt)||(p.mode==='recovery'&&(!approval.oldMachineOffline||approval.oldMachineAbsent))||(p.mode==='initial-setup'&&!approval.oldMachineAbsent))return false;
 }else if(p.approval!==null)return false;
 return bounded(v,12288)&&new TextEncoder().encode(packet(v)).length<=12288;
}
export function validAllocationPage(v:unknown):v is AllocationPage{return exact(v,['version','items','nextCursor'])&&v.version===1&&Array.isArray(v.items)&&v.items.length<=50&&v.items.every(validAllocationReceipt)&&(v.nextCursor===null||text(v.nextCursor,4096))&&bounded(v,262144);}
export function validAllocationStatus(v:unknown):v is StatusResult{return exact(v,['version','state','receipt'])&&v.version===1&&['recorded','unknown','uncertain'].includes(String(v.state))&&(v.receipt===null||(v.state==='recorded'&&validAllocationReceipt(v.receipt)));}
export function validPaperImport(v:unknown):v is PaperImportResult{return exact(v,['version','importId','acceptedRevision','historyDigest'])&&v.version===1&&uuid(v.importId)&&decimal(v.acceptedRevision)&&digest(v.historyDigest);}
export function validReserve(v:unknown):v is ReserveInput{return exact(v,['version','operationId','venueId','scope','bases','binding','mode'])&&v.version===1&&uuid(v.operationId)&&uuid(v.venueId)&&scope(v.scope)&&series(v.bases)&&binding(v.binding)&&['initial-setup','recovery'].includes(String(v.mode))&&bounded(v,16384);}
export function validPaperHistory(v:unknown):v is PaperHistoryInput{
 if(!exact(v,['version','operationId','venueId','scope','custodyVersion','registerRevision','previousDigest','block','consumptions','transfers'])||v.version!==1||!uuid(v.operationId)||!uuid(v.venueId)||!scope(v.scope)||!text(v.custodyVersion)||!decimal(v.registerRevision)||!digest(v.previousDigest)||!Array.isArray(v.consumptions)||v.consumptions.length>20||!Array.isArray(v.transfers)||v.transfers.length>20||!bounded(v,16384))return false;
 const b=v.block;if(!exact(b,['payload','signature'])||!encoded(b.signature,64))return false;
 const p=b.payload;if(!exact(p,['version','custodianId','generationId','blockId','packVersion','recipientVenueId','allocations'])||p.version!==1||p.packVersion!==1||!text(p.custodianId)||!text(p.generationId)||!text(p.blockId)||!uuid(p.recipientVenueId)||!Array.isArray(p.allocations)||!p.allocations.length||p.allocations.length>20)return false;
 for(const a of p.allocations)if(!allocation(a,true)||!same(v.scope,{taxpayerNif:a.taxpayerNif,softwareId:a.softwareId,environment:a.environment}))return false;
 if(new Set(p.allocations.map(a=>a.allocationId)).size!==p.allocations.length||new Set(p.allocations.map(a=>a.installationIdentity)).size!==p.allocations.length)return false;
 for(const c of v.consumptions){if(!exact(c,['payload','signature'])||!encoded(c.signature,64))return false;const x=c.payload;if(!exact(x,['version','custodianId','blockDigest','allocationId',...bindingKeys,'consumedAt'])||x.version!==1||!text(x.custodianId)||!digest(x.blockDigest)||!uuid(x.allocationId)||!binding(Object.fromEntries(bindingKeys.map(k=>[k,x[k]])))||!date(x.consumedAt))return false;}
 for(const t of v.transfers){if(!exact(t,['payload','keyId','signature'])||!digest(t.keyId)||!encoded(t.signature,64))return false;const x=t.payload;if(!exact(x,['version','custodianId','blockDigest','allocationIds','fromVenueId','toVenueId','registerRevision','previousDigest','transferredAt'])||x.version!==1||!text(x.custodianId)||!digest(x.blockDigest)||!Array.isArray(x.allocationIds)||!x.allocationIds.length||x.allocationIds.length>20||!x.allocationIds.every(uuid)||new Set(x.allocationIds).size!==x.allocationIds.length||!uuid(x.fromVenueId)||!uuid(x.toVenueId)||!decimal(x.registerRevision)||!digest(x.previousDigest)||!date(x.transferredAt))return false;}
 return true;
}
const prefix='WAITRON-FISCAL-ALLOCATION-1:';
function packet(v:unknown):string{const bytes=new TextEncoder().encode(canonical(v));return prefix+btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
export function manualPacket(v:AllocationReceipt):string{if(!validAllocationReceipt(v))throw Error('invalid receipt');return packet(v);}
export function readManualPacket(value:string):AllocationReceipt|undefined{
 try{if(new TextEncoder().encode(value).length>12288||!value.startsWith(prefix))return;const raw=value.slice(prefix.length);if(!encoded(raw))return;
 const receipt:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(raw.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))));return validAllocationReceipt(receipt)&&manualPacket(receipt)===value?receipt:undefined;
 }catch{return;}
}
