import assert from 'node:assert/strict';
import {test} from 'node:test';
import {InstallationController} from '../src/installation-controller.ts';
import {validInstallation, type AccountInstallation} from '../src/installation-types.ts';
import type {ApiResult, accountRequest} from '../src/api.ts';

const first='12345678-1234-4234-8234-123456789abc';
const second='22345678-1234-4234-8234-123456789abc';
const stoppedAt='2026-10-28T06:00:00.000Z';
function installation(id:string,name:string):AccountInstallation {
 return {installationId:id,venueId:id,organisationId:id,legalBusinessId:id,
  environment:'test',revision:2,revokedAt:null,lastContactAt:null,leaseExpiresAt:null,canRevoke:true,
  overview:{organisationName:name,businessName:name+' SL',countryCode:'ES',latestSnapshotAt:null,verifiedSnapshotAt:null},
  services:[
   {service:'remote_access',state:'ready',health:'healthy',failure:null,observedAt:null},
   {service:'continuous_backup',state:'unconfigured',health:'unknown',failure:null,observedAt:null},
   {service:'retained_snapshots',state:'unconfigured',health:'unknown',failure:null,observedAt:null},
  ]};
}
const oldRow=installation(first,'Sol'),newRow=installation(second,'Luna');
const failures=[
 {name:'lost reply',ok:false,status:0,code:'network_error',retryAfterMs:0},
 {name:'expired session',ok:false,status:401,code:'session_expired',retryAfterMs:60_000},
 {name:'removed permission',ok:false,status:403,code:'permission_denied',retryAfterMs:60_000},
 {name:'rate limit',ok:false,status:429,code:'rate_limited',retryAfterMs:60_000},
 {name:'temporary refusal',ok:false,status:503,code:'temporarily_unavailable',retryAfterMs:60_000},
] as const;
type Operation='list'|'stop';
function reply(operation:Operation,row:AccountInstallation):ApiResult<unknown> {
 return {ok:true,value:operation==='list'?{installations:[row]}:{...row,revokedAt:stoppedAt}};
}
function harness() {
 const requests:Array<{path:string;body?:Record<string,unknown>;finish:(result:ApiResult<unknown>)=>void}>=[];
 let changes=0;
 const request:typeof accountRequest=<T>(path:string,body?:Record<string,unknown>)=>new Promise<ApiResult<T>>(resolve=>{
  requests.push({path,body,finish:result=>resolve(result as ApiResult<T>)});
 });
 const controller=new InstallationController(()=>{changes++;},request);
 return {controller,requests,changes:()=>changes};
}
function state(h:ReturnType<typeof harness>) {
 const c=h.controller;
 return structuredClone({rows:c.installations,visible:c.visible,organisations:c.organisations,
  selected:c.selectedOrganisation,confirming:c.confirming,pending:c.pending,loaded:c.loaded,
  error:c.error,retryAt:c.retryAt,changes:h.changes()});
}
async function populate(h:ReturnType<typeof harness>,row:AccountInstallation) {
 const count=h.requests.length,p=h.controller.load();
 assert.equal(h.requests.length,count+1);
 const call=h.requests[count]!;assert.equal(call.path,'/installations');assert.equal(call.body,undefined);
 call.finish({ok:true,value:{installations:[row]}});await p;
 assert.deepEqual(h.controller.visible,[row]);
 h.controller.choose(row.installationId);assert.equal(h.controller.confirming,row.installationId);
}
function begin(h:ReturnType<typeof harness>,operation:Operation,row:AccountInstallation) {
 const count=h.requests.length,promise=operation==='list'?h.controller.load():h.controller.revoke();
 assert.equal(h.requests.length,count+1);
 const call=h.requests[count]!;
 assert.equal(call.path,operation==='list'?'/installations':'/installations/revoke');
 assert.deepEqual(call.body,operation==='list'?undefined:{installationId:row.installationId});
 assert.equal(h.controller.pending,true);
 return {promise,finish:call.finish};
}

// Removing either generation guard must let an old reply alter current state or feedback.
for(const operation of ['list','stop'] as const) {
 const results=[{name:'success',result:reply(operation,oldRow)},...failures.map(({name,...result})=>({name,result}))];
 for(const {name,result} of results)for(const transition of ['other account','away and back'] as const)for(const phase of ['pending','complete'] as const) {
  test(`${operation} ${name} after ${transition} preserves the ${phase} current request`,async()=>{
   assert.equal(validInstallation(oldRow),true);assert.equal(validInstallation(newRow),true);
   const h=harness(),c=h.controller;c.account('sol-owner');await populate(h,oldRow);
   const old=begin(h,operation,oldRow);
   c.account('luna-owner');if(transition==='away and back')c.account('sol-owner');
   assert.deepEqual(c.installations,[]);assert.equal(c.confirming,undefined);
   const currentRow=transition==='away and back'?{...oldRow,revision:9}:newRow;
   await populate(h,currentRow);
   const current=begin(h,operation,currentRow);
   if(phase==='complete'){current.finish(reply(operation,currentRow));await current.promise;}
   const before=state(h);old.finish(result);await old.promise;
   assert.deepEqual(state(h),before,'old reply must not alter current data, confirmation, feedback, cooldown or pending work');
   if(phase==='pending'){current.finish(reply(operation,currentRow));await current.promise;}
   assert.equal(c.pending,false);assert.equal(c.error,undefined);assert.equal(c.retryAt,0);
   assert.equal(c.selectedOrganisation,currentRow.organisationId);
   assert.deepEqual(c.visible,[operation==='stop'?{...currentRow,revokedAt:stoppedAt}:currentRow]);
   assert.equal(c.confirming,operation==='stop'?undefined:currentRow.installationId);
  });
 }
 for(const {name,result} of results)test(`${operation} ${name} after sign-out cannot restore private rows or stop confirmation`,async()=>{
  const h=harness(),c=h.controller;c.account('sol-owner');await populate(h,oldRow);
  const old=begin(h,operation,oldRow);c.account(undefined);
  assert.deepEqual(c.installations,[]);assert.deepEqual(c.visible,[]);assert.deepEqual(c.organisations,[]);
  assert.equal(c.selectedOrganisation,undefined);assert.equal(c.confirming,undefined);
  assert.equal(c.pending,false);assert.equal(c.loaded,false);assert.equal(c.error,undefined);
  const before=state(h),count=h.requests.length;old.finish(result);await old.promise;
  assert.deepEqual(state(h),before);
  c.choose(first);await c.load();await c.revoke();assert.equal(h.requests.length,count);
  c.account('luna-owner');await populate(h,newRow);
  const stop=begin(h,'stop',newRow);stop.finish(reply('stop',newRow));await stop.promise;
  assert.deepEqual(c.visible,[{...newRow,revokedAt:stoppedAt}]);
 });
 test(`${operation} selecting the same account retains the pending request and accepts its reply`,async()=>{
  const h=harness(),c=h.controller;c.account('sol-owner');await populate(h,oldRow);
  const current=begin(h,operation,oldRow),before=state(h);c.account('sol-owner');
  assert.deepEqual(state(h),before);
  current.finish(reply(operation,oldRow));await current.promise;
  assert.equal(c.pending,false);assert.equal(c.error,undefined);
  assert.deepEqual(c.visible,[operation==='stop'?{...oldRow,revokedAt:stoppedAt}:oldRow]);
 });
}

test('changing account clears loaded private choices and feedback without waiting for another read',async()=>{
 const h=harness(),c=h.controller;c.account('sol-owner');await populate(h,oldRow);
 const refresh=begin(h,'list',oldRow);
 refresh.finish({ok:false,status:503,code:'temporarily_unavailable',retryAfterMs:0});await refresh.promise;
 assert.equal(c.error,'unavailable');assert.equal(c.loaded,true);assert.equal(c.confirming,first);
 c.account('luna-owner');
 assert.deepEqual(c.installations,[]);assert.deepEqual(c.visible,[]);assert.deepEqual(c.organisations,[]);
 assert.equal(c.selectedOrganisation,undefined);assert.equal(c.confirming,undefined);
 assert.equal(c.pending,false);assert.equal(c.loaded,false);assert.equal(c.error,undefined);
 await populate(h,newRow);assert.equal(c.error,undefined);
});
