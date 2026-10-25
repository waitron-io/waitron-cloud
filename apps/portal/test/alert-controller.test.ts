import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AlertController} from '../src/alert-controller.ts';
import type {ApiResult} from '../src/api.ts';
test('account changes fence pending preference replies and clear private choices',async()=>{
 let finish!:(v:ApiResult<unknown>)=>void;
 const c=new AlertController(()=>{},<T>()=>new Promise<ApiResult<T>>(r=>{finish=r as typeof finish;}));
 c.account('one');const loading=c.load();c.account('two');finish({ok:true,value:{enabled:true,locale:'es'}});await loading;
 assert.equal(c.enabled,false);assert.equal(c.loaded,false);assert.equal(c.pending,false);
});
test('preferences survive a reload, report uncertain writes and preserve retry delays across accounts',async()=>{
 let mode='ok';const calls:unknown[]=[];
 const c=new AlertController(()=>{},async<T>(path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{calls.push({path,body});return mode==='ok'?{ok:true,value:{enabled:true,locale:'es'} as T}:{ok:false,status:mode==='limited'?429:503,code:'unavailable',retryAfterMs:mode==='limited'?60000:0};});
 c.account('one');await c.load();assert.equal(c.enabled,true);assert.equal(c.locale,'es');c.choose(false,'en');await c.save();assert.deepEqual(calls.at(-1),{path:'/alerts',body:{enabled:'off',locale:'en'}});
 mode='failed';c.choose(false,'en');await c.save();assert.equal(c.error,'alertsUncertain');assert.equal(c.saved,false);
 mode='limited';await c.load();const count=calls.length;c.account('two');await c.load();assert.equal(calls.length,count);assert(c.waiting>0);
});
test('loss of account permission clears displayed alert preferences',async()=>{
 let denied=false;
 const c=new AlertController(()=>{},async<T>():Promise<ApiResult<T>>=>denied?{ok:false,status:401,code:'unauthenticated',retryAfterMs:0}:{ok:true,value:{enabled:true,locale:'es'} as T});
 c.account('one');await c.load();denied=true;await c.load();assert.equal(c.enabled,false);assert.equal(c.loaded,false);assert.equal(c.error,'pairSession');
});


test('unchanged alert choices never send a save, including before loading and after reverting either field',async()=>{
 const writes:unknown[]=[];
 const c=new AlertController(()=>{},async<T>(_path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{
  if(body)writes.push(body);
  return {ok:true,value:{enabled:true,locale:'es'} as T};
 });
 c.account('one');await c.save();assert.equal(writes.length,0);
 await c.load();await c.save();assert.equal(writes.length,0);assert.equal(c.saved,false);
 c.choose(false,'es');c.choose(true,'es');await c.save();assert.equal(writes.length,0);
 c.choose(true,'en');c.choose(true,'es');await c.save();assert.equal(writes.length,0);
 c.choose(false,'en');await c.save();assert.deepEqual(writes,[{enabled:'off',locale:'en'}]);
 assert.equal(c.enabled,true);assert.equal(c.locale,'es');assert.equal(c.saved,true);
 await c.save();assert.equal(writes.length,1,'compare against the server reply, not the submitted draft');
});

for(const status of [0,503])test(`uncertain alert save (${status}) remains retryable even after returning to the last confirmed choice`,async()=>{
 let failed=false;const writes:unknown[]=[];
 const c=new AlertController(()=>{},async<T>(_path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{
  if(body){writes.push(body);if(failed)return {ok:false,status,code:'unavailable',retryAfterMs:0};}
  return {ok:true,value:{enabled:true,locale:'es'} as T};
 });
 c.account('one');await c.load();c.choose(false,'en');failed=true;await c.save();
 assert.equal(c.error,'alertsUncertain');assert.equal(c.saved,false);
 c.choose(true,'es');await c.save();assert.equal(writes.length,2,'an unknown server outcome still needs saving');
 failed=false;await c.save();assert.equal(writes.length,3);assert.equal(c.saved,true);
 await c.save();assert.equal(writes.length,3,'a confirmed retry restores the unchanged guard');
});

for(const status of [401,403])test(`alert ${status} clears the draft and prevents saving until a new account load`,async()=>{
 let denied=false;const writes:unknown[]=[];
 const c=new AlertController(()=>{},async<T>(_path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{
  if(body)writes.push(body);
  return denied?{ok:false,status,code:'forbidden',retryAfterMs:0}:{ok:true,value:{enabled:true,locale:'es'} as T};
 });
 c.account('one');await c.load();c.choose(false,'en');denied=true;await c.save();
 assert.equal(c.loaded,false);assert.equal(c.enabled,false);assert.equal(c.locale,'en');
 assert.equal(c.error,status===401?'pairSession':'forbidden');await c.save();assert.equal(writes.length,1);
 denied=false;c.account('two');await c.load();await c.save();assert.equal(writes.length,1);
});

test('alert save keeps pending and 429 gates and resumes a changed choice when the wait ends',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:100000});
 let finish!:(value:ApiResult<unknown>)=>void;let writes=0;
 const c=new AlertController(()=>{},<T>(_path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{
  if(!body)return Promise.resolve({ok:true,value:{enabled:true,locale:'es'} as T});
  writes++;if(writes>2)return Promise.resolve({ok:true,value:{enabled:false,locale:'en'} as T});
  return new Promise(resolve=>{finish=resolve as typeof finish;});
 });
 c.account('one');await c.load();c.choose(false,'en');const saving=c.save();
 await c.save();c.choose(true,'es');assert.equal(writes,1);assert.equal(c.enabled,false);assert.equal(c.locale,'en');
 finish({ok:false,status:429,code:'rate_limited',retryAfterMs:60000});await saving;
 assert.equal(c.error,'limited');await c.save();assert.equal(writes,1);assert.equal(c.waiting,60);
 t.mock.timers.tick(60000);const retry=c.save();assert.equal(writes,2);
 finish({ok:true,value:{enabled:false,locale:'en'}});await retry;await c.save();assert.equal(writes,2);
});
