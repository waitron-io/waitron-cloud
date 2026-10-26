import assert from 'node:assert/strict';
import {test} from 'node:test';
import {RecoveryController} from '../src/recovery-controller.ts';
import {validRecoveryView} from '../src/recovery-types.ts';
import type {ApiResult} from '../src/api.ts';
const id='12345678-1234-4234-8234-123456789abc',pointId='22345678-1234-4234-8234-123456789abc',venueId='32345678-1234-4234-8234-123456789abc';
const pending={requestId:id,state:'awaiting_owner',expiresAt:new Date(Date.now()+600000).toISOString(),operationId:null,operation:null};
const snapshotSource={kind:'snapshot',pointId} as const;
const continuousSource={kind:'continuous',recoverableAt:'2026-01-02T12:00:00.000Z',sourceNodeId:'62345678-1234-4234-8234-123456789abc'} as const;
const approved={...pending,state:'approved',operationId:id,operation:{id,pointId,venueId,source:snapshotSource,mode:'failure',status:'pending',expiresAt:new Date(Date.now()+3600000).toISOString()}};
const continuousApproved={...pending,state:'approved',operationId:id,operation:{...approved.operation,pointId:null,source:continuousSource}};
const replacement={requestId:id,pointId,venueId,source:snapshotSource,oldInstallationId:'42345678-1234-4234-8234-123456789abc',localVenueId:'52345678-1234-4234-8234-123456789abc',nodeId:'62345678-1234-4234-8234-123456789abc',environment:'test',publicKey:'MCowBQYDK2VwAyEA'+'A'.repeat(43),peerPublicKey:Buffer.alloc(32).toString('base64'),state:'awaiting_owner',expiresAt:new Date(Date.now()+3600000).toISOString(),organisationName:'Café Sol',legalBusinessName:'Sol SL',registration:null};
test('replacement view requires a restored operation and matching request, point and venue',()=>{
 const restored={...approved,operation:{...approved.operation,status:'restored'},replacement};
 assert(validRecoveryView(restored));assert(!validRecoveryView({...restored,replacement:{...replacement,pointId:id}}));
 assert(!validRecoveryView({...approved,replacement}));assert(!validRecoveryView({...pending,replacement}));
});
test('owner replacement uses a fresh confirmation bound to the displayed installation',async()=>{
 const calls:{path:string;body:Record<string,unknown>|undefined}[]=[];const ready={...approved,operation:{...approved.operation,status:'restored'},replacement};
 const c=new RecoveryController(()=>{},async<T>(path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{calls.push({path,body});return {ok:true,value:ready as T};});
 c.open(id);c.account('owner');c.code='12345678';await c.inspect();await c.replace();assert.equal(calls.length,1);
 c.confirmReplacement=true;await c.replace();assert.equal(calls[1]?.path,'/recovery/replace');assert.deepEqual(calls[1]?.body,{requestId:id,code:'12345678',oldInstallationId:replacement.oldInstallationId,oldServerUnavailable:'true',confirmReplacement:'true'});
});
test('proposal changes, account changes and uncertain writes clear replacement confirmation',async()=>{
 let proposed={...approved,operation:{...approved.operation,status:'restored'},replacement};let lose=false;const calls:string[]=[];
 const c=new RecoveryController(()=>{},async<T>(path:string):Promise<ApiResult<T>>=>{calls.push(path);return path.endsWith('/replace')&&lose?{ok:false,status:0,code:'network_error',retryAfterMs:0}:{ok:true,value:proposed as T};});
 c.open(id);c.account('owner');c.code='12345678';await c.inspect();c.confirmReplacement=true;
 proposed={...proposed,replacement:{...replacement,publicKey:'MCowBQYDK2VwAyEA'+'B'.repeat(43)}};await c.inspect();assert.equal(c.confirmReplacement,false);
 c.confirmReplacement=true;lose=true;await c.replace();assert.equal(c.confirmReplacement,false);assert.equal(c.view?.replacement?.state,'awaiting_owner');assert.deepEqual(calls.slice(-2),['/recovery/replace','/recovery/inspect']);
 c.account('other');assert.equal(c.confirmReplacement,false);
});
test('owner view validation rejects malformed or mismatched recovery bindings',()=>{assert(validRecoveryView(pending));assert(validRecoveryView(approved));assert(!validRecoveryView({...approved,operationId:pointId}));assert(!validRecoveryView({...approved,operation:{...approved.operation,status:'active'}}));});
test('owner view accepts strict continuous sources and excludes provider or tenant secrets',()=>{
 assert(validRecoveryView(continuousApproved));
 for(const operation of [
  {...continuousApproved.operation,pointId},
  {...continuousApproved.operation,source:{...continuousSource,recoverableAt:'bad'}},
  {...continuousApproved.operation,source:{...continuousSource,generation:7}},
  {...continuousApproved.operation,bucket:'private'},
 ])assert(!validRecoveryView({...continuousApproved,operation}));
 assert(!validRecoveryView({...pending,tenantId:'private'}));
});
test('lost approval replies reconcile by inspection without another grant; confirmations bind the chosen point',async()=>{
 const calls:string[]=[];let granted=false;const c=new RecoveryController(()=>{},async<T>(path:string):Promise<ApiResult<T>>=>{calls.push(path);if(path.endsWith('/approve')){granted=true;return {ok:false,status:0,code:'network_error',retryAfterMs:0};}return {ok:true,value:(granted?approved:pending) as T};});
 c.open(id);c.account('owner');c.code='12345678';await c.inspect();c.choose(venueId,pointId);await c.approve();assert.equal(calls.length,1);
 c.stopped=true;c.acceptLoss=true;await c.approve();assert.equal(c.view?.state,'approved');assert.deepEqual(calls,['/recovery/inspect','/recovery/approve','/recovery/inspect']);
 await c.approve();assert.equal(calls.length,3);
 c.choose(venueId,id);assert.equal(c.stopped,false);assert.equal(c.acceptLoss,false);
});
test('continuous approval is the default source shape and reconciles an uncertain write',async()=>{
 const calls:{path:string;body:Record<string,unknown>|undefined}[]=[];let granted=false;
 const c=new RecoveryController(()=>{},async<T>(path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{calls.push({path,body});if(path.endsWith('/approve')){granted=true;return {ok:false,status:0,code:'network_error',retryAfterMs:0};}return {ok:true,value:(granted?continuousApproved:pending) as T};});
 c.open(id);c.account('owner');c.code='12345678';await c.inspect();c.chooseContinuous(venueId);c.stopped=true;c.acceptLoss=true;await c.approve();
 assert.equal(c.view?.operation?.source.kind,'continuous');assert.equal(c.uncertain,false);
 assert.deepEqual(calls[1],{path:'/recovery/approve',body:{requestId:id,code:'12345678',source:'continuous',venueId,oldServerUnavailable:'true',acceptDataLoss:'true'}});
});
test('snapshot fallback approval names its source and selected point explicitly',async()=>{
 const calls:{path:string;body:Record<string,unknown>|undefined}[]=[];
 const c=new RecoveryController(()=>{},async<T>(path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{calls.push({path,body});return {ok:true,value:(path.endsWith('/approve')?approved:pending) as T};});
 c.open(id);c.account('owner');c.code='12345678';await c.inspect();c.choose(venueId,pointId);c.stopped=true;c.acceptLoss=true;await c.approve();
 assert.deepEqual(calls[1],{path:'/recovery/approve',body:{requestId:id,code:'12345678',source:'snapshot',pointId,oldServerUnavailable:'true',acceptDataLoss:'true'}});
});
test('account reset discards delayed inspection and clears matching code',async()=>{
 let finish!:(r:ApiResult<unknown>)=>void;const c=new RecoveryController(()=>{},<T>()=>new Promise<ApiResult<T>>(r=>{finish=r as typeof finish;}));c.open(id);c.account('a');c.code='12345678';const load=c.inspect();c.account('b');finish({ok:true,value:approved});await load;assert.equal(c.view,undefined);assert.equal(c.code,'');
});
test('unconfirmed write locks approval until inspection, permission failure clears details and cooldown survives reset',async()=>{
 let mode='ok';const c=new RecoveryController(()=>{},async<T>():Promise<ApiResult<T>>=>mode==='ok'?{ok:true,value:pending as T}:mode==='lost'?{ok:false,status:0,code:'network_error',retryAfterMs:0}:{ok:false,status:403,code:'forbidden',retryAfterMs:60000});c.open(id);c.account('a');c.code='12345678';await c.inspect();c.choose(venueId,pointId);c.stopped=true;c.acceptLoss=true;mode='lost';await c.approve();assert(c.uncertain);mode='ok';await c.inspect();assert(!c.uncertain);mode='forbidden';await c.inspect();assert.equal(c.view,undefined);c.account('b');assert(c.waiting>0);
});
test('a pending approval expires in the open page and permission failure drops its confirmation',async()=>{
 const c=new RecoveryController(()=>{},async<T>():Promise<ApiResult<T>>=>({ok:false,status:403,code:'forbidden',retryAfterMs:0}));c.open(id);c.account('a');c.code='12345678';c.view={...pending,expiresAt:new Date(Date.now()-1).toISOString()} as typeof c.view;c.choose(venueId,pointId);c.stopped=true;c.acceptLoss=true;await c.approve();assert.equal(c.error,undefined);
 await c.inspect();assert.equal(c.view,undefined);assert.equal(c.stopped,false);assert.equal(c.acceptLoss,false);
});
for(const field of ['pointId','venueId'] as const)test(`a successful approval reply naming a different ${field} is rejected and reconciled`,async()=>{
 let reads=0;const calls:string[]=[];const c=new RecoveryController(()=>{},async<T>(path:string):Promise<ApiResult<T>>=>{calls.push(path);if(path.endsWith('/approve'))return {ok:true,value:{...approved,operation:{...approved.operation,[field]:id}} as T};if(reads++===0)return {ok:true,value:pending as T};return {ok:false,status:0,code:'network_error',retryAfterMs:0};});
 c.open(id);c.account('owner');c.code='12345678';await c.inspect();c.choose(venueId,pointId);c.stopped=true;c.acceptLoss=true;await c.approve();assert.equal(c.view?.state,'awaiting_owner');assert(c.uncertain);assert.deepEqual(calls,['/recovery/inspect','/recovery/approve','/recovery/inspect']);
});

for(const action of ['approve','close','replace'] as const)for(const {status,code,error}of [
 {status:429,code:'rate_limited',error:'limited'},
 {status:400,code:'invalid_input',error:'recoveryInput'},
 {status:410,code:'link_unavailable',error:'recoveryExpired'},
 {status:401,code:'unauthenticated',error:'pairSession'},
 {status:403,code:'forbidden',error:'forbidden'},
])test(`definite ${status} refusal of recovery ${action} keeps its error without another inspection`,async()=>{
 const calls:string[]=[];
 const view=action==='approve'?pending:{...approved,operation:{...approved.operation,status:'restored'},replacement};
 const c=new RecoveryController(()=>{},async<T>(path:string):Promise<ApiResult<T>>=>{
  calls.push(path);return path.endsWith('/inspect')?{ok:true,value:view as T}:{ok:false,status,code,retryAfterMs:status===429?60000:0};
 });
 c.open(id);c.account('owner');c.code='12345678';await c.inspect();c.choose(venueId,pointId);c.stopped=true;c.acceptLoss=true;c.confirmReplacement=true;
 await c[action]();
 assert.equal(c.error,error);assert.equal(c.uncertain,false);assert.equal(c.pending,false);
 assert.deepEqual(calls,['/recovery/inspect','/recovery/'+action]);
 if(status===429)assert.ok(c.waiting>0);
 if(status===401||status===403){assert.equal(c.view,undefined);assert.equal(c.confirmReplacement,false);assert.equal(c.stopped,false);assert.equal(c.acceptLoss,false);}
});

for(const action of ['inspect','approve','close','replace'] as const)test(`recovery ${action} trims outer code whitespace and preserves leading zeroes`,async()=>{
 const calls:{path:string;body:Record<string,unknown>|undefined}[]=[];
 const ready={...approved,operation:{...approved.operation,status:'restored'},replacement};
 const c=new RecoveryController(()=>{},async<T>(path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{calls.push({path,body});return {ok:true,value:(path.endsWith('/inspect')&&action==='approve'?pending:ready) as T};});
 c.open(id);c.account('owner');c.code='12345678';if(action!=='inspect')await c.inspect();c.choose(venueId,pointId);c.stopped=true;c.acceptLoss=true;c.confirmReplacement=true;
 c.code=' \t00123456\n ';await c[action]();
 assert.equal(c.code,'00123456');const sent=calls.find(call=>call.path==='/recovery/'+action&&call.body?.code==='00123456');assert.ok(sent);
});

for(const action of ['approve','close','replace'] as const)for(const result of [
 {ok:false,status:0,code:'network_error',retryAfterMs:0},
 {ok:false,status:500,code:'temporarily_unavailable',retryAfterMs:0},
 {ok:false,status:400,code:'unexpected_response',retryAfterMs:0},
] as const)test(`uncertain recovery ${action} ${result.status}/${result.code} still reconciles without repeating the write`,async()=>{
 const calls:string[]=[];let reads=0;
 const ready={...approved,operation:{...approved.operation,status:'restored'},replacement};
 const c=new RecoveryController(()=>{},async<T>(path:string):Promise<ApiResult<T>>=>{
  calls.push(path);if(!path.endsWith('/inspect'))return result;
  return reads++===0?{ok:true,value:(action==='approve'?pending:ready) as T}:{ok:false,status:0,code:'network_error',retryAfterMs:0};
 });
 c.open(id);c.account('owner');c.code='12345678';await c.inspect();c.choose(venueId,pointId);c.stopped=true;c.acceptLoss=true;c.confirmReplacement=true;await c[action]();
 assert.equal(c.uncertain,true);assert.equal(c.confirmReplacement,false);assert.deepEqual(calls,['/recovery/inspect','/recovery/'+action,'/recovery/inspect']);
});

for(const code of ['12 345678','123456789','1234567','abcdefgh',''])test(`recovery still refuses malformed matching code ${JSON.stringify(code)} locally`,async()=>{
 let calls=0;const c=new RecoveryController(()=>{},async<T>():Promise<ApiResult<T>>=>{calls++;return {ok:true,value:pending as T};});
 c.open(id);c.account('owner');c.code=code;await c.inspect();assert.equal(calls,0);assert.equal(c.error,'pairCodeError');assert.equal(c.view,undefined);
});
