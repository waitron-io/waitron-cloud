import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validBillingView} from '../src/billing-types.ts';

function view(paymentMethods:unknown){return {venues:[{venueId:'11111111-1111-4111-8111-111111111111',level:'registered',trial:null,canStartTrial:true,paymentMethods}]};}
test('the trial reader accepts the optional method state without breaking the existing chooser',()=>{
 for(const methods of [{selected:null,setup:null},{selected:'card',setup:{kind:'direct_debit',state:'pending'}},
  {selected:'direct_debit',setup:{kind:'card',state:'failed'}},{selected:'card',setup:{kind:'card',state:'verified'}}])
  assert.equal(validBillingView(view(methods)),true);
});
test('the method reader refuses unknown kinds states and private provider fields',()=>{
 for(const methods of [null,{}, {selected:'cash',setup:null},{selected:null,setup:{kind:'cash',state:'pending'}},
  {selected:null,setup:{kind:'card',state:'done'}},{selected:null,setup:{kind:'card',state:'pending',checkoutId:'private'}},
  {selected:'card',setup:null,customerId:'private'}, {selected:null,setup:undefined}])assert.equal(validBillingView(view(methods)),false);
});

test('method state accepts strings only and cannot coerce arrays into an allowed kind',()=>{
 for(const methods of [{selected:['card'],setup:null},{selected:null,setup:{kind:['card'],state:'pending'}},
  {selected:null,setup:{kind:'card',state:['pending']}}])assert.equal(validBillingView(view(methods)),false);
});

import {accountRequest,type ApiResult} from '../src/api.ts';
import {BillingController} from '../src/billing-controller.ts';
import type {BillingView} from '../src/billing-types.ts';
const first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
const methodsView:BillingView={venues:[first,second].map(venueId=>({venueId,level:'registered',trial:null,canStartTrial:true,paymentMethods:{selected:null,setup:null}}))};
const failure={ok:false,status:503,code:'temporarily_unavailable',retryAfterMs:0} as const;
function harness(){
 const replies:Array<ApiResult<unknown>|Promise<ApiResult<unknown>>>=[],calls:Array<{path:string;body:unknown}>=[],redirects:string[]=[];
 const c=new BillingController(()=>{},async<T>(path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{calls.push({path,body});assert.ok(replies.length,'no automatic write retry');return await replies.shift()! as ApiResult<T>;},url=>redirects.push(url));
 c.account('owner');return {c,replies,calls,redirects};
}
async function ready(h:ReturnType<typeof harness>){h.replies.push({ok:true,value:structuredClone(methodsView)});await h.c.load();}
function deferred(){let finish!:(value:ApiResult<unknown>)=>void;const promise=new Promise<ApiResult<unknown>>(resolve=>{finish=resolve;});return {promise,finish};}

test('payment writes send browser proof and reject malformed or unsafe provider presentations',async t=>{
 const prior=['location','document'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
 Object.defineProperty(globalThis,'location',{configurable:true,value:{protocol:'https:'}});Object.defineProperty(globalThis,'document',{configurable:true,value:{cookie:'__Host-cloud_csrf=proof'}});
 t.after(()=>{for(const [key,value] of prior){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}});
 let value:unknown={checkoutId:'checkout-synthetic'},status=200;
 const calls:RequestInit[]=[];t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{calls.push(init!);return Response.json(value,{status});});
 for(const valid of [{checkoutId:'checkout-synthetic'},{url:'https://checkout.stripe.com/c/pay/synthetic'}]){value=valid;assert.deepEqual(await accountRequest('/billing/method/start',{venueId:first,kind:'card'}),{ok:true,value:valid});}
 assert.equal((calls[0]!.headers as Record<string,string>)['X-CSRF-Token'],'proof');assert.equal(calls[0]!.credentials,'same-origin');
 for(const bad of [{},{checkoutId:''},{checkoutId:'x',url:'https://checkout.stripe.com/'},{checkoutId:'x',token:'private'},{url:'javascript:alert(1)'},{url:'https://checkout.stripe.com.evil.test/'},{url:'https://user@checkout.stripe.com/'},{url:'http://checkout.stripe.com/'},{url:'https://checkout.stripe.com:444/'},[]]){value=bad;assert.equal((await accountRequest('/billing/method/start',{venueId:first,kind:'card'})).ok,false);}
 for(const state of ['pending','failed','verified']){value={state};assert.deepEqual(await accountRequest('/billing/method/verify',{venueId:first}),{ok:true,value:{state}});}
 for(const bad of [{state:'done'},{state:['pending']},{state:'verified',token:'private'}]){value=bad;assert.equal((await accountRequest('/billing/method/verify',{venueId:first})).ok,false);}
 status=409;value={error:'conflict'};assert.deepEqual(await accountRequest('/billing/method/verify',{venueId:first}),{ok:false,status:409,code:'conflict',retryAfterMs:0});
});

test('card setup and manual verification preserve the selected method until the server confirms selection',async()=>{
 const h=harness();await ready(h);h.c.select(second);
 h.replies.push({ok:true,value:{checkoutId:'card-checkout'}});await h.c.startMethod('card');
 assert.equal(h.c.methodCheckout,'card-checkout');assert.deepEqual(h.calls.at(-1),{path:'/billing/method/start',body:{venueId:second,kind:'card'}});
 h.replies.push({ok:true,value:{state:'pending'}});await h.c.verifyMethod();assert.equal(h.c.methodState,'pending');assert.equal(h.c.methodCheckout,'card-checkout');
 h.replies.push({ok:true,value:{state:'verified'}},{ok:true,value:{venues:methodsView.venues.map(v=>({...v,paymentMethods:{selected:'card',setup:{kind:'card',state:'verified'}}}))}});
 await h.c.verifyMethod();assert.equal(h.c.methodCheckout,undefined);assert.equal(h.c.venue?.paymentMethods?.selected,'card');
 assert.deepEqual(h.calls.slice(-2),[{path:'/billing/method/verify',body:{venueId:second}},{path:'/billing/read',body:{}}]);
});

test('direct debit starts only a validated Stripe redirect and no stored reference is sent for verification',async()=>{
 const h=harness();await ready(h);h.replies.push({ok:true,value:{url:'https://checkout.stripe.com/c/pay/synthetic'}});await h.c.startMethod('direct_debit');
 assert.deepEqual(h.redirects,['https://checkout.stripe.com/c/pay/synthetic']);assert.equal(h.c.methodCheckout,undefined);
 h.replies.push({ok:true,value:{state:'failed'}});await h.c.verifyMethod();assert.equal(h.c.methodState,'failed');assert.deepEqual(h.calls.at(-1),{path:'/billing/method/verify',body:{venueId:first}});
});

for(const action of ['startMethod','verifyMethod'] as const)for(const boundary of ['account','venue','signout','account-return'] as const)for(const success of [true,false])test(`late payment ${action} ${success} is discarded after ${boundary}`,async()=>{
 const h=harness();await ready(h);const old=deferred();h.replies.push(old.promise);const operation=action==='startMethod'?h.c.startMethod('card'):h.c.verifyMethod();
 if(boundary==='venue')h.c.select(second);else {h.c.account(boundary==='signout'?undefined:'other');if(boundary==='account-return')h.c.account('owner');}
 old.finish(success?{ok:true,value:action==='startMethod'?{checkoutId:'old-checkout'}:{state:'verified'}}:{...failure,retryAfterMs:9000});await operation;
 assert.equal(h.c.pending,false);assert.equal(h.c.error,undefined);assert.equal(h.c.waiting,0);assert.equal(h.c.methodCheckout,undefined);assert.equal(h.c.methodState,undefined);assert.deepEqual(h.redirects,[]);assert.equal(h.calls.length,2);
});

test('payment failure keeps the old method and never repeats an uncertain start',async()=>{
 const h=harness();await ready(h);h.c.venue!.paymentMethods!.selected='direct_debit';h.replies.push(failure);await h.c.startMethod('card');
 assert.equal(h.c.venue?.paymentMethods?.selected,'direct_debit');assert.equal(h.c.error,'billingMethodUncertain');assert.equal(h.calls.length,2);assert.equal(h.c.pending,false);
 h.replies.push({ok:true,value:{checkoutId:'card-checkout'}});await h.c.startMethod('card');h.replies.push({ok:true,value:{state:'failed'}});await h.c.verifyMethod();
 assert.equal(h.c.venue?.paymentMethods?.selected,'direct_debit');assert.equal(h.c.methodState,'failed');assert.equal(h.c.methodCheckout,undefined);
});

test('payment controls refuse ordinary venues and respect rate limits and in-flight actions',async t=>{
 let now=0;t.mock.method(performance,'now',()=>now);const h=harness();await ready(h);
 delete h.c.venue!.paymentMethods;await h.c.startMethod('card');await h.c.verifyMethod();assert.equal(h.calls.length,1);
 h.c.venue!.paymentMethods={selected:null,setup:null};const old=deferred();h.replies.push(old.promise);const operation=h.c.startMethod('card');await h.c.startMethod('direct_debit');await h.c.verifyMethod();assert.equal(h.calls.length,2);
 old.finish({ok:false,status:429,code:'rate_limited',retryAfterMs:5000});await operation;await h.c.startMethod('card');await h.c.verifyMethod();assert.equal(h.calls.length,2);assert.equal(h.c.waiting,5);
 now=5000;h.replies.push({ok:true,value:{state:'pending'}});await h.c.verifyMethod();assert.equal(h.calls.length,3);
});

test('refresh and lost permission discard a displayed checkout before any new presentation',async()=>{
 const h=harness();await ready(h);h.replies.push({ok:true,value:{checkoutId:'old-checkout'}});await h.c.startMethod('card');
 const read=deferred();h.replies.push(read.promise);const loading=h.c.load();assert.equal(h.c.methodCheckout,undefined);
 read.finish({ok:false,status:403,code:'permission_denied',retryAfterMs:0});await loading;assert.equal(h.c.methodState,undefined);assert.equal(h.c.loaded,false);
});
for(const bad of [{url:'https://evil.test/'},{url:'https://user@checkout.stripe.com/'},{checkoutId:'wrong-kind'}])test(`direct debit rejects an invalid presentation ${JSON.stringify(bad)}`,async()=>{
 const h=harness();await ready(h);h.replies.push({ok:true,value:bad});await h.c.startMethod('direct_debit');assert.deepEqual(h.redirects,[]);assert.equal(h.c.error,'billingMethodUncertain');
});
test('a Stripe reply after signout cannot navigate the next account',async()=>{
 const h=harness();await ready(h);const old=deferred();h.replies.push(old.promise);const operation=h.c.startMethod('direct_debit');h.c.account(undefined);
 old.finish({ok:true,value:{url:'https://checkout.stripe.com/c/pay/old'}});await operation;assert.deepEqual(h.redirects,[]);
});

test('leaving the account fences late method presentations without clearing the saved venue',async()=>{
 const h=harness();await ready(h);const old=deferred();h.replies.push(old.promise);const operation=h.c.startMethod('direct_debit');h.c.fence();
 old.finish({ok:true,value:{url:'https://checkout.stripe.com/c/pay/old'}});await operation;assert.deepEqual(h.redirects,[]);assert.equal(h.c.methodCheckout,undefined);assert.equal(h.c.pending,false);assert.equal(h.c.venue?.venueId,first);
});
