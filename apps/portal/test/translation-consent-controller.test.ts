import assert from 'node:assert/strict';
import {test} from 'node:test';
import {TranslationConsentController} from '../src/translation-consent-controller.ts';
import type {ApiResult} from '../src/api.ts';
const venueId='12345678-1234-4234-8234-123456789abc';
const listed=(consented:boolean)=>({ok:true as const,value:{consents:[{venueId,consented,consentedAt:consented?'2026-10-14T10:00:00.000Z':null}]}});
test('an account change fences a pending reply and clears what is shown',async()=>{
 let finish!:(v:ApiResult<unknown>)=>void;
 const c=new TranslationConsentController(()=>{},<T>()=>new Promise<ApiResult<T>>(r=>{finish=r as typeof finish;}));
 c.account('one');const loading=c.load();c.account('two');finish(listed(true) as ApiResult<unknown>);await loading;
 assert.equal(c.consented(venueId),false);assert.equal(c.loaded,false);assert.equal(c.pending,false);
});
test('agree and withdraw send the contract bodies and show the answer',async()=>{
 const calls:{path:string;body?:Record<string,unknown>}[]=[];let on=false;
 const c=new TranslationConsentController(()=>{},async<T>(path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{
  calls.push({path,...(body?{body}:{})});if(body)on=body.choice==='agree';return listed(on) as ApiResult<T>;});
 c.account('one');await c.load();assert.equal(c.consented(venueId),false);
 await c.agree(venueId);
 assert.deepEqual(calls.at(-1),{path:'/translation-consent',body:{venueId,choice:'agree',consentVersion:'providers-2026-10-14'}});
 assert.equal(c.consented(venueId),true);
 await c.withdraw(venueId);
 assert.deepEqual(calls.at(-1),{path:'/translation-consent',body:{venueId,choice:'withdraw'}});
 assert.equal(c.consented(venueId),false);
});
test('an unanswered agree is reported as uncertain, a refused session clears the choice, and a limit is kept across accounts',async()=>{
 let mode='ok';
 const c=new TranslationConsentController(()=>{},async<T>():Promise<ApiResult<T>>=>mode==='ok'?listed(true) as ApiResult<T>
  :{ok:false,status:mode==='expired'?401:mode==='limited'?429:503,code:'x',retryAfterMs:mode==='limited'?60000:0});
 c.account('one');await c.load();assert.equal(c.consented(venueId),true);
 mode='down';await c.agree(venueId);assert.equal(c.error,'translationConsentUncertain');assert.equal(c.consented(venueId),true);
 mode='expired';await c.load();assert.equal(c.error,'pairSession');assert.equal(c.consented(venueId),false);assert.equal(c.loaded,false);
 mode='limited';await c.load();assert.equal(c.error,'limited');c.account('two');mode='ok';await c.load();assert.equal(c.loaded,false);assert.ok(c.waiting>0);
});
test('anonymous, duplicate and cooling-down requests do not dispatch',async()=>{
 let finish!:(v:ApiResult<unknown>)=>void;let calls=0,delay=false;
 const c=new TranslationConsentController(()=>{},<T>()=>{calls++;return !delay||calls>1?Promise.resolve(listed(false) as ApiResult<T>):new Promise<ApiResult<T>>(r=>{finish=r as typeof finish;});});
 await c.load();await c.agree(venueId);await c.withdraw(venueId);assert.equal(calls,0);
 delay=true;c.account('one');const load=c.load();assert.equal(c.pending,true);
 await c.agree(venueId);await c.withdraw(venueId);await c.load();assert.equal(calls,1);
 finish({ok:false,status:429,code:'rate_limited',retryAfterMs:60000});await load;
 c.account('two');await c.agree(venueId);await c.withdraw(venueId);await c.load();assert.equal(calls,1);assert.ok(c.waiting>0);
});
for(const action of ['agree','withdraw'] as const)test(`a late ${action} reply cannot overwrite another account's loaded choices`,async()=>{
 let finish!:(v:ApiResult<unknown>)=>void,delay=false;
 const c=new TranslationConsentController(()=>{},<T>()=>delay?new Promise<ApiResult<T>>(r=>{finish=r as typeof finish;}):Promise.resolve(listed(false) as ApiResult<T>));
 c.account('one');await c.load();delay=true;const writing=c[action](venueId);
 c.account('two');delay=false;await c.load();assert.equal(c.loaded,true);
 finish(listed(true));await writing;assert.equal(c.consented(venueId),false);assert.equal(c.pending,false);
});
for(const status of [401,403])test(`${status} on a write clears the visible consent and loaded authority`,async()=>{
 let denied=false;
 const c=new TranslationConsentController(()=>{},async<T>():Promise<ApiResult<T>>=>denied?{ok:false,status,code:'forbidden',retryAfterMs:0}:listed(true) as ApiResult<T>);
 c.account('one');await c.load();denied=true;await c.withdraw(venueId);
 assert.equal(c.consented(venueId),false);assert.equal(c.loaded,false);assert.equal(c.error,status===401?'pairSession':'forbidden');
});
test('same account keeps its loaded choices while sign-out clears them',async()=>{
 const c=new TranslationConsentController(()=>{},async<T>()=>listed(true) as ApiResult<T>);
 c.account('one');await c.load();c.account('one');assert.equal(c.loaded,true);assert.equal(c.consented(venueId),true);
 c.account(undefined);assert.deepEqual(c.consents,[]);assert.equal(c.loaded,false);assert.equal(c.error,undefined);
});
