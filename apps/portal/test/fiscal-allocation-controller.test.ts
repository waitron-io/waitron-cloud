import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {FiscalAllocationController} from '../src/fiscal-allocation-controller.ts';
import {validAllocationReceipt,validAllocationPage,validAllocationStatus,validPaperImport,manualPacket,readManualPacket} from '../src/fiscal-allocation-types.ts';
import {payload,key,reserve,venueId,accountId,binding} from '../../../packages/fiscal-allocation/test/fixtures.ts';
import {signReceipt,encodeReceipt} from '../../../packages/fiscal-allocation/src/evidence.ts';
import type {ApiResult} from '../src/api.ts';
const signer=key();
const reserved=signReceipt(payload(),signer);
const consumed=signReceipt({...payload(),state:'consumed',approval:{version:1,...binding,oldMachineOffline:true,oldMachineAbsent:false,noParallelRecovery:true,confirmedAt:'2026-10-13T10:00:00.000Z'}},signer);
const consumeInput=()=>({version:1 as const,operationId:randomUUID(),allocationId:consumed.payload.allocation.allocationId,binding:{...binding},oldMachineOffline:true,oldMachineAbsent:false,noParallelRecovery:true,confirmedAt:'2026-10-13T10:00:00.000Z'});
const fail={ok:false as const,status:0,code:'network_error',retryAfterMs:0};
function controller(run:(path:string,body?:Record<string,unknown>)=>Promise<ApiResult<unknown>>){const c=new FiscalAllocationController(()=>{},async<T>(p:string,b?:Record<string,unknown>)=>await run(p,b) as ApiResult<T>);c.account(accountId);c.open(venueId);return c;}
function ready(c:FiscalAllocationController){c.choose(reserve());c.receipt=reserved;c.oldMachineOffline=true;c.noParallelRecovery=true;}

test('strict receipts reject added secrets, malformed purposes, scope and approval substitutions',()=>{
 assert(validAllocationReceipt(reserved));assert(validAllocationReceipt(consumed));
 for(const bad of [
 {...reserved,privateKey:'secret'},
 {...reserved,payload:{...reserved.payload,scope:'extra'}},
 {...reserved,payload:{...reserved.payload,allocation:{...reserved.payload.allocation,series:[{code:'FF-C000042',purpose:'other'}]}}},
 {...reserved,payload:{...reserved.payload,continuity:{...reserved.payload.continuity,scope:{...reserved.payload.continuity.scope,environment:'production'}}}},
 {...consumed,payload:{...consumed.payload,approval:{...consumed.payload.approval,operatorId:'other'}}},
 {...consumed,payload:{...consumed.payload,approval:null}},
 {...reserved,signature:'bad'},
 ])assert.equal(validAllocationReceipt(bad),false);
 assert(validAllocationPage({version:1,items:[consumed],nextCursor:null}));
 assert(!validAllocationPage({version:1,items:[consumed],nextCursor:null,secret:'extra'}));
 assert(validAllocationStatus({version:1,state:'recorded',receipt:consumed}));
 assert(!validAllocationStatus({version:1,state:'unknown',receipt:consumed}));
 assert(validPaperImport({version:1,importId:venueId,acceptedRevision:'3',historyDigest:'a'.repeat(64)}));
});
test('manual packet preserves every signed byte and rejects corrupted or noncanonical input',()=>{
 assert.equal(manualPacket(consumed),encodeReceipt(consumed));
 assert.deepEqual(readManualPacket(manualPacket(consumed)),consumed);
 for(const bad of [manualPacket(consumed)+'=', ' '+manualPacket(consumed),manualPacket(consumed).replace('WAITRON','OTHER'),'WAITRON-FISCAL-ALLOCATION-1:'+Buffer.from(JSON.stringify(consumed)).toString('base64url')])assert.equal(readManualPacket(bad),undefined);
});
for(const action of ['reserve','consume'] as const)test(`lost ${action} reply retains original operation and resolves only through status`,async()=>{
 const calls:{path:string;body?:Record<string,unknown>}[]=[];
 const c=controller(async(path,body)=>{calls.push({path,body});return path.endsWith('/status')?{ok:true,value:{version:1,state:'recorded',receipt:action==='reserve'?reserved:consumed}}:fail;});
 ready(c);const input=action==='reserve'?reserve():consumeInput();await c[action](input as never);
 assert(c.uncertain);assert.equal(c.pendingRequest?.input.operationId,input.operationId);
 await c[action](input as never);assert.equal(calls.length,1);
 await c.reconcile();assert.equal(c.uncertain,false);assert.deepEqual(c.receipt,action==='reserve'?reserved:consumed);
 assert.deepEqual(calls[1],{path:'/fiscal-allocations/status',body:{version:1,venueId,operationId:input.operationId}});
});
test('unknown status never clears an uncertain consumed name or permits a second operation',async()=>{
 const calls:string[]=[];const c=controller(async p=>{calls.push(p);return p.endsWith('/status')?{ok:true,value:{version:1,state:'unknown',receipt:null}}:fail;});ready(c);
 await c.consume(consumeInput());await c.reconcile();await c.reserve(reserve());assert(c.uncertain);assert.equal(calls.length,2);assert.equal(c.packet,undefined);
});
for(const reset of ['account','route'] as const)test(`delayed receipt after ${reset} change cannot expose the old account`,async()=>{
 let finish!:(r:ApiResult<unknown>)=>void;const c=controller(()=>new Promise(r=>{finish=r;}));c.choose(reserve());const writing=c.reserve(reserve());
 if(reset==='account')c.account(randomUUID());else c.open(randomUUID());finish({ok:true,value:reserved});await writing;assert.equal(c.receipt,undefined);assert.equal(c.pendingRequest,undefined);assert.equal(c.oldMachineOffline,false);assert.equal(c.uncertain,false);assert.equal(c.pending,false);
});
test('selection changes reset all consumption confirmations and reserved evidence has no usable packet',async()=>{
 const calls:string[]=[];const c=controller(async p=>{calls.push(p);return {ok:true,value:consumed};});ready(c);assert.equal(c.packet,undefined);
 c.choose({...reserve(),binding:{...binding,targetNodeId:'different'}});assert.equal(c.oldMachineOffline,false);assert.equal(c.noParallelRecovery,false);assert.equal(c.receipt,undefined);
 await c.consume(consumeInput());assert.equal(calls.length,0);
});
test('consume refuses altered binding, missing isolation, parallel recovery and setup absence',async()=>{
 const calls:string[]=[];const c=controller(async p=>{calls.push(p);return {ok:true,value:consumed};});ready(c);
 for(const input of [{...consumeInput(),binding:{...binding,operatorId:'other'}},{...consumeInput(),oldMachineOffline:false},{...consumeInput(),noParallelRecovery:false},{...consumeInput(),oldMachineAbsent:true}])await c.consume(input);
 assert.equal(calls.length,0);c.oldMachineOffline=false;await c.consume(consumeInput());assert.equal(calls.length,0);
});
test('receipt from another venue, account or frozen series cannot become a consumed packet',async()=>{
 for(const change of [{venueId:randomUUID()},{cloudAccountId:randomUUID()},{binding:{...binding,eventId:'other'}},{allocation:{...reserved.payload.allocation,series:[{code:'A-C000042',purpose:'standard' as const}]}}]){
 const c=controller(async()=>({ok:true,value:signReceipt({...consumed.payload,...change,approval:{...consumed.payload.approval!,...('binding' in change?change.binding:{})}},signer)}));ready(c);await c.consume(consumeInput());assert(c.uncertain);assert.equal(c.packet,undefined);
 }
});
test('ended entitlement keeps bounded retained history and downloads while new reservation is refused',async()=>{
 const calls:{path:string;body?:Record<string,unknown>}[]=[];const c=controller(async(p,b)=>{calls.push({path:p,body:b});return p.endsWith('/list')?{ok:true,value:{version:1,items:[consumed],nextCursor:'next'}}:{ok:false,status:503,code:'entitlement_unavailable',retryAfterMs:0};});
 await c.load(null);assert.deepEqual(c.page?.items,[consumed]);c.inspect(consumed);assert.equal(c.packet,encodeReceipt(consumed));await c.reserve(reserve());assert.equal(c.error,'fiscalEntitlement');assert.deepEqual(c.page?.items,[consumed]);await c.load('next');assert.deepEqual(calls.at(-1)?.body,{version:1,venueId,cursor:'next',limit:50});
});
for(const code of ['custody_unavailable','continuity_unavailable'] as const)test(`${code} explains refusal and allows explicit retry`,async()=>{
 let refuse=true;const c=controller(async()=>refuse?{ok:false,status:503,code,retryAfterMs:0}:{ok:true,value:reserved});c.choose(reserve());await c.reserve(reserve());assert.equal(c.error,code==='custody_unavailable'?'fiscalCustody':'fiscalContinuity');refuse=false;await c.reserve(reserve());assert.deepEqual(c.receipt,reserved);
});
test('paper import sends the complete existing signed block without any name reservation',async()=>{
 const calls:{path:string;body?:Record<string,unknown>}[]=[];const c=controller(async(p,b)=>{calls.push({path:p,body:b});return {ok:true,value:{version:1,importId:venueId,acceptedRevision:'1',historyDigest:'a'.repeat(64)}};});
 const input={version:1 as const,operationId:randomUUID(),venueId,scope:reserve().scope,custodyVersion:'custody-1',registerRevision:'1',previousDigest:'0'.repeat(64),block:{payload:{version:1 as const,custodianId:'custodian-1',generationId:'g',blockId:'b',packVersion:1 as const,recipientVenueId:venueId,allocations:[{...reserved.payload.allocation,source:'paper' as const,installationIdentity:'P000042',series:[{code:'A-P000042',purpose:'standard' as const}]}]},signature:reserved.signature},consumptions:[],transfers:[]};
 const {reservationEvidence,...allocation}=input.block.payload.allocations[0]!;input.block.payload.allocations=[allocation as typeof input.block.payload.allocations[0]];
 await c.importPaper(input);assert.equal(calls.length,1);assert.equal(calls[0]?.path,'/fiscal-allocations/import-paper');assert.deepEqual(calls[0]?.body,input);assert.equal(c.receipt,undefined);assert.equal(c.imported?.acceptedRevision,'1');
});
test('retry deadline survives account changes and permission loss erases signed evidence',async()=>{
 const c=controller(async()=>({ok:false,status:403,code:'permission_denied',retryAfterMs:60000}));ready(c);await c.load(null);assert.equal(c.receipt,undefined);assert.equal(c.page,undefined);c.account(randomUUID());assert(c.waiting>0);
});
test('real account client carries CSRF and validates all fiscal route result shapes',async t=>{
 const {accountRequest}=await import('../src/api.ts');
 const oldLocation=Object.getOwnPropertyDescriptor(globalThis,'location'),oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'location',{configurable:true,value:{protocol:'https:'}});Object.defineProperty(globalThis,'document',{configurable:true,value:{cookie:'__Host-cloud_csrf=fiscal-proof'}});
 t.after(()=>{for(const [name,old] of [['location',oldLocation],['document',oldDocument]] as const){if(old)Object.defineProperty(globalThis,name,old);else Reflect.deleteProperty(globalThis,name);}});
 let value:unknown=reserved;let request:RequestInit|undefined;
 t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{request=init;return Response.json(value);});
 for(const [suffix,response] of [['reserve',reserved],['consume',consumed],['status',{version:1,state:'recorded',receipt:consumed}],['list',{version:1,items:[consumed],nextCursor:null}],['import-paper',{version:1,importId:venueId,acceptedRevision:'1',historyDigest:'a'.repeat(64)}]] as const){value=response;assert.equal((await accountRequest('/fiscal-allocations/'+suffix,{version:1})).ok,true);assert.equal((request?.headers as Record<string,string>)['X-CSRF-Token'],'fiscal-proof');value={...response,privateKey:'secret'};assert.equal((await accountRequest('/fiscal-allocations/'+suffix,{})).ok,false);}
});
test('a current authorized owner can inspect retained receipts recorded by an earlier owner',async()=>{
 const c=controller(async()=>({ok:true,value:{version:1,items:[consumed],nextCursor:null}}));c.account('20000000-0000-4000-8000-000000000006');await c.load(null);assert.equal(c.page?.items.length,1);c.inspect(consumed);assert.equal(c.packet,encodeReceipt(consumed));
});
test('paper shape checks reject secret fields, altered scopes, duplicated names and malformed signed histories',async()=>{
 const paper={version:1 as const,operationId:randomUUID(),venueId,scope:reserve().scope,custodyVersion:'custody-1',registerRevision:'1',previousDigest:'0'.repeat(64),block:{payload:{version:1 as const,custodianId:'custodian-1',generationId:'g',blockId:'b',packVersion:1 as const,recipientVenueId:venueId,allocations:[{version:1 as const,allocationId:venueId,...reserve().scope,installationIdentity:'P000042',series:[{code:'A-P000042',purpose:'standard' as const}],source:'paper' as const,issuedAt:'2026-10-13T10:00:00.000Z'}]},signature:reserved.signature},consumptions:[],transfers:[]};
 const c=controller(async()=>{assert.fail('invalid paper must not reach transport');});
 await Promise.all([
 {...paper,privateKey:'secret'},
 {...paper,scope:{...paper.scope,environment:'production'}},
 {...paper,block:{...paper.block,payload:{...paper.block.payload,allocations:[...paper.block.payload.allocations,...paper.block.payload.allocations]}}},
 {...paper,consumptions:[{payload:{version:1},signature:reserved.signature}]},
 {...paper,transfers:[{payload:{version:1},keyId:reserved.keyId,signature:reserved.signature}]},
 ].map(async value=>{await c.importPaper(value as never);assert.equal(c.error,'fiscalInvalid');}));
});
test('initial setup consumes only after an explicit absence and no-parallel confirmation',async()=>{
 const r=signReceipt({...payload(),mode:'initial-setup'},signer);
 const input={...consumeInput(),oldMachineOffline:false,oldMachineAbsent:true};
 const result=signReceipt({...r.payload,state:'consumed',approval:{version:1,...binding,oldMachineOffline:false,oldMachineAbsent:true,noParallelRecovery:true,confirmedAt:input.confirmedAt}},signer);
 const c=controller(async()=>({ok:true,value:result}));c.choose({...reserve(),mode:'initial-setup'});c.receipt=r;c.noParallelRecovery=true;
 await c.consume(input);assert.equal(c.receipt.payload.state,'reserved');c.oldMachineAbsent=true;await c.consume(input);assert.equal(c.receipt.payload.state,'consumed');assert.equal(c.packet,encodeReceipt(result));
});
test('a generic server failure after a write keeps its operation uncertain until status',async()=>{
 const c=controller(async()=>({ok:false,status:503,code:'temporarily_unavailable',retryAfterMs:0}));c.choose(reserve());await c.reserve(reserve());assert(c.uncertain);assert.equal(c.pendingRequest?.input.operationId,reserve().operationId);
});
test('a reservation receipt must name the submitted operation before the controller accepts it',async()=>{
 const wrong=signReceipt({...reserved.payload,allocation:{...reserved.payload.allocation,reservationEvidence:{kind:'cloud',authorityId:'fixture-authority',reservationId:randomUUID(),reservationSequence:'42'}}},signer);
 const c=controller(async()=>({ok:true,value:wrong}));c.choose(reserve());await c.reserve(reserve());assert(c.uncertain);assert.equal(c.receipt,undefined);
});
test('editing a definitely refused reservation uses a fresh operation but keeps unchanged retries exact',async()=>{
 const calls:Record<string,unknown>[]=[];const c=controller(async(p,b)=>{assert(p.endsWith('/reserve'));calls.push(structuredClone(b!));return {ok:false,status:503,code:'continuity_unavailable',retryAfterMs:0};});
 c.choose(reserve());await c.reserve(reserve());await c.reserve(reserve());assert.equal(calls[0]?.operationId,calls[1]?.operationId);
 c.choose({...reserve(),binding:{...binding,operatorId:'corrected-operator'}});await c.reserve(c.selection!);assert.notEqual(calls[2]?.operationId,calls[0]?.operationId);assert.deepEqual(calls[2]?.binding,{...binding,operatorId:'corrected-operator'});
});
for(const action of ['reserve','consume'] as const)test(`unknown ${action} status permits only an explicit identical resend`,async()=>{
 const calls:{path:string;body?:Record<string,unknown>}[]=[];let delivered=false;
 const c=controller(async(p,b)=>{calls.push({path:p,body:structuredClone(b)});if(p.endsWith('/status'))return {ok:true,value:{version:1,state:'unknown',receipt:null}};if(!delivered){delivered=true;return fail;}return {ok:true,value:action==='reserve'?reserved:consumed};});ready(c);const input=action==='reserve'?reserve():consumeInput();await c[action](input as never);assert.equal(c.canRetryPending,false);await c.retryPending();assert.equal(calls.length,1);await c.reconcile();assert(c.uncertain);assert(c.canRetryPending);await c.retryPending();assert.deepEqual(calls[2],calls[0]);assert.equal(c.uncertain,false);assert.equal(c.receipt?.payload.state,action==='reserve'?'reserved':'consumed');
});
for(const code of ['space_exhausted','allocation_unavailable','reservation_untrusted'])test(`${code} retains its exact pending operation for status and an identical resend`,async()=>{
 const c=controller(async()=>({ok:false,status:503,code,retryAfterMs:0}));c.choose(reserve());await c.reserve(reserve());assert(c.uncertain);assert.equal(c.pendingRequest?.input.operationId,reserve().operationId);assert.equal(c.canRetryPending,false);
});
test('reading history cannot hide the warning while a write outcome is uncertain',async()=>{
 const c=controller(async p=>p.endsWith('/list')?{ok:true,value:{version:1,items:[],nextCursor:null}}:fail);c.choose(reserve());await c.reserve(reserve());await c.load(null);assert(c.uncertain);assert.equal(c.error,'fiscalUncertain');
});
test('the actual account client refuses unexpected installation environments before venue selection',async t=>{
 const {accountRequest}=await import('../src/api.ts');
 const installation={installationId:venueId,venueId,organisationId:venueId,legalBusinessId:venueId,environment:'test',revision:0,revokedAt:null,lastContactAt:null,leaseExpiresAt:null,canRevoke:true,services:['continuous_backup','remote_access','retained_snapshots'].map(service=>({service,state:'unconfigured',health:'unknown',failure:null,observedAt:null}))};
 let environment='test';t.mock.method(globalThis,'fetch',async()=>Response.json({installations:[{...installation,environment}]}));
 assert.equal((await accountRequest('/installations')).ok,true);environment='staging';assert.equal((await accountRequest('/installations')).ok,false);environment='production';assert.equal((await accountRequest('/installations')).ok,true);
});
for(const [code,guidance] of [['space_exhausted','fiscalExhausted'],['reservation_untrusted','fiscalTrust']] as const){
 test(`${code} gives custodian guidance while preserving the uncertain write and exact retry`,async()=>{
  const calls:{path:string;body?:Record<string,unknown>}[]=[];
  const c=controller(async(path,body)=>{calls.push({path,body:structuredClone(body)});return path.endsWith('/status')?{ok:true,value:{version:1,state:'unknown',receipt:null}}:{ok:false,status:503,code,retryAfterMs:0};});
  c.choose(reserve());await c.reserve(reserve());
  assert.equal(c.error,guidance);assert(c.uncertain);assert.equal(c.canRetryPending,false);assert.equal(c.packet,undefined);
  const original=structuredClone(c.pendingRequest);await c.reserve({...reserve(),operationId:randomUUID()});await c.retryPending();assert.equal(calls.length,1);assert.deepEqual(c.pendingRequest,original);
  await c.reconcile();assert(c.uncertain);assert(c.canRetryPending);await c.retryPending();assert.deepEqual(calls[2],calls[0]);assert.equal(c.error,guidance);assert(c.uncertain);
 });
 test(`${code} on a read does not suggest a temporary outage or discard the pending write`,async()=>{
  const c=controller(async path=>path.endsWith('/list')?{ok:false,status:503,code,retryAfterMs:0}:fail);
  c.choose(reserve());await c.reserve(reserve());const original=structuredClone(c.pendingRequest);await c.load(null);
  assert.equal(c.error,guidance);assert(c.uncertain);assert.deepEqual(c.pendingRequest,original);assert.equal(c.canRetryPending,false);
 });
}
