import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {ApiResult,accountRequest} from '../src/api.ts';
import {BillingController} from '../src/billing-controller.ts';
import type {BillingView} from '../src/billing-types.ts';

const first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
const view:BillingView={venues:[first,second].map(venueId=>({venueId,level:'registered',trial:null,canStartTrial:true}))};
async function controller(request:typeof accountRequest){return new BillingController(()=>{},request);}
test('billing chooser loads without installations and starts only the selected eligible venue',async()=>{
 const calls:unknown[]=[];
 const c=await controller(async<T>(path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{
  calls.push({path,body});return {ok:true,value:view as T};
 });
 await c.load();assert.equal(calls.length,0);c.account('owner');await c.load();
 assert.equal(c.selected,first);c.select(second);assert.equal(c.selected,second);
 await c.start();assert.deepEqual(calls,[{path:'/billing/read',body:{}},{path:'/billing/start-trial',body:{venueId:second}}]);
});
for(const boundary of ['account','venue','signout'] as const)for(const success of [true,false])test(`late billing ${success?'success':'failure'} is fenced after ${boundary} changes`,async()=>{
 let finish!:(value:ApiResult<BillingView>)=>void,count=0;
 const c=await controller(<T>():Promise<ApiResult<T>>=>++count===1?Promise.resolve({ok:true,value:view as T}):new Promise(resolve=>{finish=resolve as typeof finish;}));
 c.account('owner');await c.load();const pending=c.start();
 if(boundary==='venue')c.select(second);else c.account(boundary==='account'?'other':undefined);
 finish(success?{ok:true,value:{venues:[{...view.venues[0]!,level:'connected',canStartTrial:false}]}}:{ok:false,status:403,code:'permission_denied',retryAfterMs:90000});await pending;
 assert.equal(c.pending,false);assert.equal(c.error,undefined);assert.equal(c.waiting,0);
 assert.equal(c.selected,boundary==='venue'?second:undefined);
 assert.deepEqual(c.venues,boundary==='venue'?view.venues:[]);
});
test('uncertain or conflicting billing writes reload once without replaying the write',async()=>{
 for(const code of ['network_error','conflict']){
  const calls:string[]=[];const c=await controller(async<T>(path:string):Promise<ApiResult<T>>=>{
   calls.push(path);return path.endsWith('start-trial')?{ok:false,status:code==='conflict'?409:0,code,retryAfterMs:0}:{ok:true,value:view as T};
  });c.account('owner');await c.load();await c.start();
  assert.deepEqual(calls,['/billing/read','/billing/start-trial','/billing/read']);assert.equal(c.error,code==='conflict'?'billingChanged':'billingUncertain');
 }
});
test('billing eligibility and elapsed retry delay prevent duplicate actions',async t=>{
 let now=0;t.mock.method(performance,'now',()=>now);let calls=0,mode='eligible';
 const c=await controller(async<T>():Promise<ApiResult<T>>=>{
  calls++;return mode==='limited'?{ok:false,status:429,code:'rate_limited',retryAfterMs:5000}:{ok:true,value:{venues:[{...view.venues[0]!,canStartTrial:mode==='eligible'}]} as T};
 });c.account('owner');await c.load();mode='limited';await c.start();assert.equal(c.error,'limited');
 const count=calls;await c.start();await c.load();assert.equal(calls,count);assert.equal(c.waiting,5);
 now=5000;mode='ineligible';await c.load();await c.start();assert.equal(calls,count+1);
});

test('an uncertain billing write honors the server wait before refreshing or writing again',async t=>{
 let now=0;t.mock.method(performance,'now',()=>now);const calls:string[]=[];
 const c=await controller(async<T>(path:string):Promise<ApiResult<T>>=>{
  calls.push(path);return path.endsWith('start-trial')?{ok:false,status:503,code:'temporarily_unavailable',retryAfterMs:5000}:{ok:true,value:view as T};
 });c.account('owner');await c.load();await c.start();
 assert.equal(c.waiting,5);assert.deepEqual(calls,['/billing/read','/billing/start-trial']);assert.deepEqual(c.venues,[]);
 await c.load();await c.start();assert.equal(calls.length,2);
 now=5000;await c.load();assert.deepEqual(calls,['/billing/read','/billing/start-trial','/billing/read']);assert.equal(c.loaded,true);
});

test('ordinary accounts see no trial error panel but an established owner sees lost authority',async()=>{
 let allowed=false;
 const c=await controller(async<T>():Promise<ApiResult<T>>=>allowed?{ok:true,value:view as T}:{ok:false,status:403,code:'permission_denied',retryAfterMs:0});
 c.account('ordinary');await c.load();assert.equal(c.error,undefined);assert.equal(c.loaded,false);assert.deepEqual(c.venues,[]);
 allowed=true;c.account('synthetic');await c.load();assert.equal(c.loaded,true);
 allowed=false;await c.load();assert.equal(c.error,'permissionBusiness');assert.equal(c.loaded,false);assert.deepEqual(c.venues,[]);
});

for(const boundary of ['account','venue','signout'] as const)for(const success of [true,false])test(`late billing read ${success?'success':'failure'} is fenced after ${boundary} changes`,async()=>{
 let finish!:(value:ApiResult<BillingView>)=>void,count=0;
 const c=await controller(<T>():Promise<ApiResult<T>>=>++count===1?Promise.resolve({ok:true,value:view as T}):new Promise(resolve=>{finish=resolve as typeof finish;}));
 c.account('owner');await c.load();const pending=c.load();
 if(boundary==='venue')c.select(second);else c.account(boundary==='account'?'other':undefined);
 finish(success?{ok:true,value:{venues:[{...view.venues[0]!,level:'connected',canStartTrial:false}]}}:{ok:false,status:403,code:'permission_denied',retryAfterMs:90000});await pending;
 assert.equal(c.pending,false);assert.equal(c.error,undefined);assert.equal(c.waiting,0);
 assert.equal(c.selected,boundary==='venue'?second:undefined);assert.deepEqual(c.venues,boundary==='venue'?view.venues:[]);
});

for(const boundary of ['account','signout'] as const)for(const code of ['network_error','conflict'])test(`late billing ${code} reconciliation is fenced after ${boundary} changes`,async()=>{
 let finish!:(value:ApiResult<BillingView>)=>void,count=0,ready!:()=>void;const reading=new Promise<void>(resolve=>{ready=resolve;});
 const c=await controller(<T>():Promise<ApiResult<T>>=>{
  count++;if(count===1)return Promise.resolve({ok:true,value:view as T});
  if(count===2)return Promise.resolve({ok:false,status:code==='conflict'?409:0,code,retryAfterMs:0});
  return new Promise(resolve=>{finish=resolve as typeof finish;ready();});
 });
 c.account('owner');await c.load();const pending=c.start();await reading;
 c.account(boundary==='account'?'other':undefined);
 finish({ok:true,value:{venues:[{...view.venues[0]!,level:'connected',canStartTrial:false}]}});await pending;
 assert.equal(c.pending,false);assert.equal(c.error,undefined);assert.equal(c.waiting,0);
 assert.equal(c.selected,undefined);assert.deepEqual(c.venues,[]);
});

const taxProfile={legalName:'Synthetic business',address:'Synthetic street 1',taxNumber:'TEST-123'};
const taxView={venues:view.venues.map(venue=>({...venue,taxProfile}))};
test('tax drafts survive venue changes and reads but clear on account loss and navigation fencing',async()=>{
 const c=await controller(async<T>():Promise<ApiResult<T>>=>({ok:true,value:taxView as T}));
 c.account('owner');await c.load();assert.deepEqual(c.taxDraft,taxProfile);
 c.editTax('legalName','Unsaved first');assert.equal(taxView.venues[0]!.taxProfile.legalName,'Synthetic business');c.select(second);c.editTax('address','Unsaved second');c.select(first);
 await c.load();assert.equal(c.taxDraft?.legalName,'Unsaved first');c.select(second);assert.equal(c.taxDraft?.address,'Unsaved second');
 c.fence();assert.deepEqual(c.taxDraft,taxProfile);c.account(undefined);assert.equal(c.taxDraft,undefined);
});
test('tax validation runs on save and a confirmed reply updates the retained draft',async()=>{
 const calls:{path:string;body:unknown}[]=[];
 const c=await controller(async<T>(path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{
  calls.push({path,body});return {ok:true,value:taxView as T};
 });c.account('owner');await c.load();c.editTax('legalName','');await c.saveTax();
 assert.equal(c.taxInvalid,'legalName');assert.equal(calls.length,1);
 c.editTax('legalName',' Synthetic business ');assert.equal(c.taxInvalid,undefined);await c.saveTax();
 assert.deepEqual(calls[1],{path:'/billing/tax/save',body:{venueId:first,...taxProfile,legalName:' Synthetic business '}});
 assert.deepEqual(c.taxDraft,taxProfile);assert.equal(c.taxSaved,true);
});
for(const status of [0,400])test('tax draft survives '+(status?'a correction response':'an uncertain save read without replay'),async()=>{
 const calls:string[]=[];
 const c=await controller(async<T>(path:string):Promise<ApiResult<T>>=>{
  calls.push(path);return path.endsWith('/save')?{ok:false,status,code:status?'invalid_input':'network_error',retryAfterMs:0}:{ok:true,value:taxView as T};
 });c.account('owner');await c.load();c.editTax('address','Unsaved address');await c.saveTax();
 assert.equal(c.taxDraft?.address,'Unsaved address');assert.equal(c.error,status?'billingTaxInvalid':'billingTaxUncertain');
 assert.deepEqual(calls,status?['/billing/read','/billing/tax/save']:['/billing/read','/billing/tax/save','/billing/read']);
});
for(const boundary of ['account','venue','pagehide'] as const)test('late tax save cannot replace state after '+boundary,async()=>{
 let finish!:(value:ApiResult<BillingView>)=>void,count=0;
 const c=await controller(<T>():Promise<ApiResult<T>>=>++count===1?Promise.resolve({ok:true,value:taxView as T}):new Promise(resolve=>{finish=resolve as typeof finish;}));
 c.account('owner');await c.load();c.editTax('legalName','Unsaved first');const pending=c.saveTax();
 if(boundary==='venue')c.select(second);else c.account(boundary==='account'?'another-owner':undefined);
 finish({ok:true,value:{venues:[{...taxView.venues[0]!,taxProfile:{...taxProfile,legalName:'Late saved'}}]}});await pending;
 assert.equal(c.pending,false);assert.equal(c.error,undefined);assert.equal(c.taxSaved,false);
 assert.equal(c.selected,boundary==='venue'?second:undefined);assert.equal(c.taxDraft?.legalName,boundary==='venue'?'Synthetic business':undefined);
});
