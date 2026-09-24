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
 const c=new AlertController(()=>{},async<T>(path:string,body?:Record<string,string>):Promise<ApiResult<T>>=>{calls.push({path,body});return mode==='ok'?{ok:true,value:{enabled:true,locale:'es'} as T}:{ok:false,status:mode==='limited'?429:503,code:'unavailable',retryAfterMs:mode==='limited'?60000:0};});
 c.account('one');await c.load();assert.equal(c.enabled,true);assert.equal(c.locale,'es');c.choose(false,'en');await c.save();assert.deepEqual(calls.at(-1),{path:'/alerts',body:{enabled:'off',locale:'en'}});
 mode='failed';await c.save();assert.equal(c.error,'alertsUncertain');assert.equal(c.saved,false);
 mode='limited';await c.load();const count=calls.length;c.account('two');await c.load();assert.equal(calls.length,count);assert(c.waiting>0);
});
test('loss of account permission clears displayed alert preferences',async()=>{
 let denied=false;
 const c=new AlertController(()=>{},async<T>():Promise<ApiResult<T>>=>denied?{ok:false,status:401,code:'unauthenticated',retryAfterMs:0}:{ok:true,value:{enabled:true,locale:'es'} as T});
 c.account('one');await c.load();denied=true;await c.load();assert.equal(c.enabled,false);assert.equal(c.loaded,false);assert.equal(c.error,'pairSession');
});
