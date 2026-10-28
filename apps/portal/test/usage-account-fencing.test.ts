import assert from 'node:assert/strict';
import {test} from 'node:test';
import {UsageController} from '../src/usage-controller.ts';
import type {ApiResult} from '../src/api.ts';
import type {UsageSummary} from '../src/usage-types.ts';

const first='12345678-1234-4234-8234-123456789abc';
const second='22345678-1234-4234-8234-123456789abc';
const summary=(organisationId:string,currentBytes:string):UsageSummary=>({
 version:1,organisationId,
 storage:{currentBytes,addedBytes:'9007199254740994',removedBytes:'1'},
 transfer:{uploadedBytes:'1536',restoredBytes:'2048'},
 operations:{installationCompleted:'3',monitoringProbes:'4'},
 messages:{sent:'5',failed:'6',expired:'7',cancelled:'8'},
 latestEventAt:'2026-09-26T12:00:00.000Z',measuredThrough:'2026-09-26T12:05:00.000Z',
});

function harness(){
 const requests:Array<{path:string;body:Record<string,unknown>|undefined;finish:(result:ApiResult<UsageSummary>)=>void}>=[];
 let notifications=0;
 const controller=new UsageController(()=>{notifications++;},<T>(path:string,body?:Record<string,unknown>)=>
  new Promise<ApiResult<T>>(resolve=>requests.push({path,body,finish:result=>resolve(result as ApiResult<T>)})));
 const state=()=>({organisationId:controller.organisationId,summary:controller.summary,pending:controller.pending,
  loaded:controller.loaded,error:controller.error,retryAt:controller.retryAt,notifications});
 return {controller,requests,state};
}

const oldReplies=[
 {name:'totals',result:{ok:true,value:summary(first,'9007199254740993')}},
 {name:'permission refusal',result:{ok:false,status:403,code:'permission_denied',retryAfterMs:0}},
 {name:'rate limit',result:{ok:false,status:429,code:'rate_limited',retryAfterMs:60_000}},
] satisfies Array<{name:string;result:ApiResult<UsageSummary>}>;

const changes=[
 {name:'another account',organisationId:first,apply(c:UsageController){c.account('second-owner');c.organisation(first);}},
 {name:'account switched away and back',organisationId:first,apply(c:UsageController){c.account('second-owner');c.account('first-owner');c.organisation(first);}},
 {name:'another organisation',organisationId:second,apply(c:UsageController){c.organisation(second);}},
 {name:'organisation switched away and back',organisationId:first,apply(c:UsageController){c.organisation(second);c.organisation(first);}},
];

for(const change of changes)for(const old of oldReplies)for(const timing of ['pending','complete'] as const){
 test(`old usage ${old.name} cannot change ${change.name} with its read ${timing}`,async()=>{
  const {controller:c,requests,state}=harness();
  c.account('first-owner');c.organisation(first);
  const initial=c.load();requests[0]!.finish({ok:true,value:summary(first,'9007199254740993')});await initial;
  assert.equal(c.summary?.storage.currentBytes,'9007199254740993');
  c.refresh();const delayed=c.load();
  change.apply(c);
  assert.equal(c.summary,undefined);assert.equal(c.loaded,false);assert.equal(c.pending,false);assert.equal(c.error,undefined);
  const current=c.load();
  assert.equal(c.pending,true);assert.equal(requests.length,3);
  assert.deepEqual(requests.map(({path,body})=>({path,body})),[
   {path:'/usage/read',body:{organisationId:first}},
   {path:'/usage/read',body:{organisationId:first}},
   {path:'/usage/read',body:{organisationId:change.organisationId}},
  ]);
  if(timing==='complete'){requests[2]!.finish({ok:true,value:summary(change.organisationId,'42')});await current;}
  const before=state();
  requests[1]!.finish(old.result);await delayed;
  assert.deepEqual(state(),before,'a reply from the previous selection must not publish totals, errors, cooldowns or notifications');
  await c.load();assert.equal(requests.length,3,'a stale reply must not allow a duplicate read');
  if(timing==='pending'){requests[2]!.finish({ok:true,value:summary(change.organisationId,'42')});await current;}
  const completed=state();
  assert.equal(completed.summary?.organisationId,change.organisationId);assert.equal(completed.summary?.storage.currentBytes,'42');
  assert.equal(c.loaded,true);assert.equal(c.pending,false);assert.equal(c.error,undefined);assert.equal(c.retryAt,0);
 });
}

for(const old of oldReplies){
 test(`signed-out usage ignores delayed ${old.name}`,async()=>{
  const {controller:c,requests,state}=harness();
  c.account('first-owner');c.organisation(first);
  const initial=c.load();requests[0]!.finish({ok:true,value:summary(first,'9007199254740993')});await initial;
  c.refresh();const delayed=c.load();c.account(undefined);
  assert.equal(c.organisationId,undefined);assert.equal(c.summary,undefined);assert.equal(c.pending,false);assert.equal(c.loaded,false);
  const before=state();requests[1]!.finish(old.result);await delayed;
  assert.deepEqual(state(),before);await c.load();assert.equal(requests.length,2);
 });
}

test('selecting the same account and organisation keeps its pending usage read valid',async()=>{
 const {controller:c,requests}=harness();
 c.account('first-owner');c.organisation(first);const pending=c.load();
 c.account('first-owner');c.organisation(first);assert.equal(c.pending,true);
 await c.load();assert.equal(requests.length,1);
 requests[0]!.finish({ok:true,value:summary(first,'9007199254740993')});await pending;
 assert.equal(c.summary?.storage.currentBytes,'9007199254740993');assert.equal(c.loaded,true);assert.equal(c.pending,false);
});
