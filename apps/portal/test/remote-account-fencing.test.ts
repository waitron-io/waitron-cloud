import assert from 'node:assert/strict';
import {test} from 'node:test';
import {RemoteController} from '../src/remote-controller.ts';
import type {ApiResult} from '../src/api.ts';
import type {RemoteDns,RemoteView} from '../src/remote-types.ts';

const first='12345678-1234-4234-8234-123456789abc';
const second='22345678-1234-4234-8234-123456789abc';
const view=(installationId=first):RemoteView=>({
 installationId,revision:1,revoked:false,
 names:{staff:{assigned:'staff.venue.example',current:'staff.venue.example'},public:{assigned:'venue.example',current:'venue.example'}},
 service:{state:'provisioning',health:'unknown',observedAt:null,validUntil:null},publicForward:null,
});
const dns:RemoteDns={installationId:first,kind:'staff',hostname:'staff.cafe.example',records:[
 {type:'CNAME',name:'staff.cafe.example',value:'staff.venue.example'},
 {type:'CNAME',name:'_acme-challenge.staff.cafe.example',value:'_acme-challenge.staff.venue.example'},
]};
const saved:RemoteView={...view(),revision:2,names:{...view().names!,staff:{assigned:'staff.venue.example',current:dns.hostname}}};

function deferred(){
 let finish!:(result:ApiResult<unknown>)=>void;
 const promise=new Promise<ApiResult<unknown>>(resolve=>{finish=resolve;});
 return {promise,finish};
}
function harness(){
 const replies:Array<ApiResult<unknown>|Promise<ApiResult<unknown>>>=[];
 const calls:Array<{path:string;body:unknown}>=[];
 let notifications=0;
 const c=new RemoteController(()=>{notifications++;},async<T>(path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{
  calls.push({path,body:structuredClone(body)});
  assert(replies.length,'a discarded reply must not start another request');
  return await replies.shift()! as ApiResult<T>;
 });
 const state=()=>structuredClone({installationId:c.installationId,view:c.view,kind:c.kind,hostname:c.hostname,
  confirmation:c.confirmation,error:c.error,notice:c.notice,pending:c.pending,retryAt:c.retryAt,notifications,calls});
 return {c,replies,calls,state};
}
const failures={
 lost:{ok:false,status:0,code:'network_error',retryAfterMs:7_000},
 unauthorized:{ok:false,status:401,code:'unauthenticated',retryAfterMs:11_000},
 forbidden:{ok:false,status:403,code:'permission_denied',retryAfterMs:13_000},
 limited:{ok:false,status:429,code:'rate_limited',retryAfterMs:17_000},
 unavailable:{ok:false,status:503,code:'temporarily_unavailable',retryAfterMs:19_000},
 conflict:{ok:false,status:409,code:'revision_conflict',retryAfterMs:0},
} as const;
const outcomes=['success','malformed','mismatched',...Object.keys(failures) as Array<keyof typeof failures>] as const;
const boundaries=['preview','save','reconcile'] as const;
type Boundary=typeof boundaries[number];

async function begin(h:ReturnType<typeof harness>,boundary:Boundary,reply:ReturnType<typeof deferred>){
 const {c,replies,calls}=h;
 c.account('owner');replies.push({ok:true,value:view()});await c.open(first);
 c.edit(dns.hostname);
 if(boundary==='preview'){
  replies.push(reply.promise);const operation=c.preview();
  assert.deepEqual(calls.at(-1),{path:'/remote-access/dns',body:{installationId:first,kind:'staff',hostname:'staff.cafe.example'}});
  return {operation};
 }
 replies.push({ok:true,value:dns});await c.preview();
 assert.equal(c.confirmation?.hostname,'staff.cafe.example');
 if(boundary==='reconcile')replies.push({...failures.lost,retryAfterMs:0});
 replies.push(reply.promise);
 const operation=c.apply();
 if(boundary==='reconcile'){
  // The lost save must reach its status read before the account or venue changes.
  await Promise.resolve();await Promise.resolve();
  assert.deepEqual(calls.at(-1),{path:'/remote-access/status',body:{installationId:first}});
  assert.equal(c.view,undefined);
 }else assert.deepEqual(calls.at(-1),{path:'/remote-access/apply',body:{installationId:first,kind:'staff',hostname:'staff.cafe.example',expectedRevision:'1'}});
 assert.equal(c.pending,true);
 return {operation};
}
function oldResult(boundary:Boundary,outcome:typeof outcomes[number]):ApiResult<unknown>{
 if(outcome==='malformed')return {ok:true,value:{installationId:first}};
 if(outcome==='mismatched')return {ok:true,value:{...(boundary==='preview'?dns:saved),installationId:second}};
 if(outcome==='success')return {ok:true,value:boundary==='preview'?dns:saved};
 return failures[outcome];
}

for(const boundary of boundaries)for(const change of ['account','account-return','venue','reopen'] as const){
 for(const newer of ['pending','reviewed'] as const)for(const outcome of outcomes){
  test(`old remote ${boundary} ${outcome} cannot change ${change} with ${newer} work`,{timeout:5_000},async()=>{
   const h=harness(),{c,replies,state}=h,old=deferred(),current=deferred();
   const {operation}=await begin(h,boundary,old);
   if(change.startsWith('account')){c.account('different');if(change==='account-return')c.account('owner');}
   else if(change==='reopen')c.close();
   const installationId=change==='venue'?second:first;
   replies.push(current.promise);const opening=c.open(installationId);
   assert.equal(c.pending,true);assert.equal(c.view,undefined);assert.equal(c.confirmation,undefined);assert.equal(c.hostname,'');
   const review=async()=>{
    current.finish({ok:true,value:view(installationId)});await opening;
    c.choose('public');c.edit('current.cafe.example');
    replies.push({ok:true,value:{installationId,kind:'public',hostname:'current.cafe.example',records:[
     {type:'CNAME',name:'current.cafe.example',value:'venue.example'},
     {type:'CNAME',name:'_acme-challenge.current.cafe.example',value:'_acme-challenge.venue.example'},
    ]}});
    await c.preview();assert.equal(c.confirmation?.hostname,'current.cafe.example');
    assert.equal(c.view?.installationId,installationId);assert.equal(c.pending,false);
   };
   if(newer==='reviewed')await review();
   const before=state();old.finish(oldResult(boundary,outcome));await operation;
   assert.deepEqual(state(),before,'an old reply must preserve the current selection, review, feedback, cooldown and notifications');
   if(newer==='pending')await review();
  });
 }
}
for(const boundary of boundaries)for(const outcome of outcomes){
 test(`signed-out remote setup ignores old ${boundary} ${outcome}`,{timeout:5_000},async()=>{
  const h=harness(),{c,state,calls}=h,old=deferred();
  const {operation}=await begin(h,boundary,old);c.account(undefined);
  assert.equal(c.installationId,undefined);assert.equal(c.view,undefined);assert.equal(c.confirmation,undefined);
  assert.equal(c.hostname,'');assert.equal(c.pending,false);assert.equal(c.error,undefined);assert.equal(c.notice,undefined);
  const before=state();old.finish(oldResult(boundary,outcome));await operation;
  assert.deepEqual(state(),before);const count=calls.length;
  await c.open(first);await c.preview();await c.apply();assert.equal(calls.length,count);
 });
}
for(const boundary of boundaries){
 test(`same account keeps its remote ${boundary} reply valid`,{timeout:5_000},async()=>{
  const h=harness(),{c}=h,reply=deferred();const {operation}=await begin(h,boundary,reply);
  c.account('owner');assert.equal(c.pending,true);
  reply.finish(oldResult(boundary,'success'));await operation;
  assert.equal(c.pending,false);assert.equal(c.installationId,first);
  if(boundary==='preview')assert.deepEqual(c.confirmation,{kind:'staff',hostname:'staff.cafe.example',revision:1,records:dns.records});
  else{assert.deepEqual(c.view,saved);assert.equal(c.notice,'remoteSaved');assert.equal(c.confirmation,undefined);}
 });
}
