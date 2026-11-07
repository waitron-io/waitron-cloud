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
