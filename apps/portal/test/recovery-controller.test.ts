import assert from 'node:assert/strict';
import {test} from 'node:test';
import {RecoveryController} from '../src/recovery-controller.ts';
import {validRecoveryView} from '../src/recovery-types.ts';
import type {ApiResult} from '../src/api.ts';
const id='12345678-1234-4234-8234-123456789abc',pointId='22345678-1234-4234-8234-123456789abc',venueId='32345678-1234-4234-8234-123456789abc';
const pending={requestId:id,state:'awaiting_owner',expiresAt:new Date(Date.now()+600000).toISOString(),operationId:null,operation:null};
const approved={...pending,state:'approved',operationId:id,operation:{id,pointId,venueId,mode:'failure',status:'pending',expiresAt:new Date(Date.now()+3600000).toISOString()}};
test('owner view validation rejects malformed or mismatched recovery bindings',()=>{assert(validRecoveryView(pending));assert(validRecoveryView(approved));assert(!validRecoveryView({...approved,operationId:pointId}));assert(!validRecoveryView({...approved,operation:{...approved.operation,status:'active'}}));});
test('lost approval replies reconcile by inspection without another grant; confirmations bind the chosen point',async()=>{
 const calls:string[]=[];let granted=false;const c=new RecoveryController(()=>{},async<T>(path:string):Promise<ApiResult<T>>=>{calls.push(path);if(path.endsWith('/approve')){granted=true;return {ok:false,status:0,code:'network_error',retryAfterMs:0};}return {ok:true,value:(granted?approved:pending) as T};});
 c.open(id);c.account('owner');c.code='12345678';await c.inspect();c.choose(venueId,pointId);await c.approve();assert.equal(calls.length,1);
 c.stopped=true;c.acceptLoss=true;await c.approve();assert.equal(c.view?.state,'approved');assert.deepEqual(calls,['/recovery/inspect','/recovery/approve','/recovery/inspect']);
 await c.approve();assert.equal(calls.length,3);
 c.choose(venueId,id);assert.equal(c.stopped,false);assert.equal(c.acceptLoss,false);
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
