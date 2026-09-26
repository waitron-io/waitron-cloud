import assert from 'node:assert/strict';
import {test} from 'node:test';
import {UsageController} from '../src/usage-controller.ts';
import type {ApiResult} from '../src/api.ts';
import type {UsageSummary} from '../src/usage-types.ts';

const first='12345678-1234-4234-8234-123456789abc';
const second='22345678-1234-4234-8234-123456789abc';
const summary=(organisationId=first):UsageSummary=>({
 version:1,organisationId,
 storage:{currentBytes:'9007199254740993',addedBytes:'9007199254740994',removedBytes:'1'},
 transfer:{uploadedBytes:'1536',restoredBytes:'2048'},
 operations:{installationCompleted:'3',monitoringProbes:'4'},
 messages:{sent:'5',failed:'6',expired:'7',cancelled:'8'},
 latestEventAt:'2026-09-26T12:00:00.000Z',measuredThrough:'2026-09-26T12:05:00.000Z',
});

test('loads each selected organisation once and preserves decimal strings exactly',async()=>{
 const calls:unknown[]=[];
 const controller=new UsageController(()=>{},async<T>(path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{
  calls.push({path,body});return {ok:true,value:summary(String(body?.organisationId)) as T};
 });
 controller.account('owner');controller.organisation(first);await controller.load();await controller.load();
 assert.deepEqual(calls,[{path:'/usage/read',body:{organisationId:first}}]);
 assert.equal(controller.summary?.storage.currentBytes,'9007199254740993');
 controller.organisation(second);await controller.load();await controller.load();
 assert.equal(calls.length,2);assert.equal(controller.summary?.organisationId,second);
});

test('account and organisation changes fence delayed replies and clear private totals',async()=>{
 let finish!:(value:ApiResult<UsageSummary>)=>void;
 const controller=new UsageController(()=>{},<T>()=>new Promise<ApiResult<T>>(resolve=>{finish=resolve as (value:ApiResult<UsageSummary>)=>void;}));
 controller.account('owner');controller.organisation(first);const firstLoad=controller.load();
 controller.organisation(second);finish({ok:true,value:summary(first)});await firstLoad;
 assert.equal(controller.summary,undefined);assert.equal(controller.pending,false);
 const secondLoad=controller.load();controller.account(undefined);finish({ok:true,value:summary(second)});await secondLoad;
 assert.equal(controller.summary,undefined);assert.equal(controller.organisationId,undefined);
});

test('retry-after blocks repeated reads and an ownership failure clears totals',async()=>{
 let calls=0,mode:'ok'|'limited'|'denied'='ok';
 const controller=new UsageController(()=>{},async<T>():Promise<ApiResult<T>>=>{
  calls++;
  if(mode==='limited')return {ok:false,status:429,code:'rate_limited',retryAfterMs:60_000};
  if(mode==='denied')return {ok:false,status:403,code:'forbidden',retryAfterMs:0};
  return {ok:true,value:summary() as T};
 });
 controller.account('owner');controller.organisation(first);await controller.load();assert(controller.summary);
 controller.refresh();mode='limited';await controller.load();assert.equal(controller.error,'limited');const limitedCalls=calls;
 await controller.load();assert.equal(calls,limitedCalls);assert(controller.waiting>0);
 controller.retryAt=0;mode='denied';await controller.load();assert.equal(controller.error,'forbidden');assert.equal(controller.summary,undefined);
});
