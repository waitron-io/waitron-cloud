import assert from 'node:assert/strict';
import {test} from 'node:test';
import {RemoteController} from '../src/remote-controller.ts';
import {validRemoteView,validRemoteDns} from '../src/remote-types.ts';
import type {ApiResult} from '../src/api.ts';
const id='12345678-1234-4234-8234-123456789abc',other='22345678-1234-4234-8234-123456789abc';
const view={installationId:id,revision:1,revoked:false,names:{staff:{assigned:'staff.venue.example',current:'staff.venue.example'},public:{assigned:'venue.example',current:'venue.example'}},service:{state:'provisioning',health:'unknown',observedAt:null,validUntil:null}};
const dns={installationId:id,kind:'staff',hostname:'staff.cafe.example',records:[{type:'CNAME',name:'staff.cafe.example',value:'staff.venue.example'},{type:'CNAME',name:'_acme-challenge.staff.cafe.example',value:'_acme-challenge.staff.venue.example'}]};
test('remote views validate display fields and DNS records before rendering',()=>{
 assert(validRemoteView(view));assert(validRemoteView({...view,names:null}));assert(validRemoteDns(dns));
 for(const patch of [{revision:-1},{names:{...view.names,staff:{assigned:'javascript:alert(1)',current:'bad'}}},{service:{state:'ready',health:'ok',observedAt:null}}])assert.equal(validRemoteView({...view,...patch}),false);
 for(const patch of [{records:[]},{hostname:'bad'},{records:[{...dns.records[0],type:'TXT'},dns.records[1]]}])assert.equal(validRemoteDns({...dns,...patch}),false);
});
test('account and venue changes discard delayed setup replies',async()=>{
 let finish!:(v:ApiResult<unknown>)=>void;const c=new RemoteController(()=>{},<T>()=>new Promise<ApiResult<T>>(r=>{finish=r as typeof finish;}));c.account('owner');const opening=c.open(id);c.account('other');finish({ok:true,value:view});await opening;assert.equal(c.view,undefined);
 const next=c.open(other);finish({ok:true,value:view});await next;assert.equal(c.view,undefined);assert.equal(c.error,'unavailable');
});
test('apply requires the reviewed name and revision; uncertain writes reconcile without replay',async()=>{
 const calls:{path:string;body?:Record<string,string>}[]=[];let changed=false;
 const c=new RemoteController(()=>{},async<T>(path:string,body?:Record<string,string>):Promise<ApiResult<T>>=>{
  calls.push({path,body});if(path.endsWith('/dns'))return {ok:true,value:dns as T};
  if(path.endsWith('/apply')){changed=true;return {ok:false,status:0,code:'network_error',retryAfterMs:0};}
  return {ok:true,value:(changed?{...view,revision:2,names:{...view.names,staff:{...view.names.staff,current:dns.hostname}}}:view) as T};
 });c.account('owner');await c.open(id);c.edit(dns.hostname);await c.apply();assert.equal(calls.length,1);
 await c.preview();assert.equal(c.confirmation?.hostname,dns.hostname);c.edit('different.example');await c.apply();assert.equal(calls.filter(v=>v.path.endsWith('/apply')).length,0);
 c.edit(dns.hostname);await c.preview();await c.apply();assert.equal(c.view?.names?.staff.current,dns.hostname);assert.equal(calls.filter(v=>v.path.endsWith('/apply')).length,1);assert.deepEqual(calls.find(v=>v.path.endsWith('/apply'))!.body,{installationId:id,kind:'staff',hostname:dns.hostname,expectedRevision:'1'});assert.equal(c.confirmation,undefined);
});
test('permission failure clears setup; rate cooldown survives closing and reopening',async()=>{
 let mode='ok',calls=0;const c=new RemoteController(()=>{},async<T>():Promise<ApiResult<T>>=>{calls++;return mode==='ok'?{ok:true,value:view as T}:{ok:false,status:mode==='limited'?429:403,code:'forbidden',retryAfterMs:mode==='limited'?60000:0};});
 c.account('owner');await c.open(id);mode='forbidden';await c.load();assert.equal(c.view,undefined);
 mode='limited';await c.load();c.close();await c.open(id);assert.equal(calls,3);assert(c.waiting>0);
});
test('remote readiness expires with its lease even when the observation is still recent',async()=>{
 const {remoteReady}=await import('../src/remote-types.ts');
 const now=Date.now(),ready={...view,service:{state:'ready',health:'healthy',observedAt:new Date(now).toISOString(),validUntil:new Date(now+1000).toISOString()}};
 assert(validRemoteView(ready));assert.equal(remoteReady(ready,now),true);assert.equal(remoteReady(ready,now+1001),false);
 assert.equal(remoteReady({...ready,revoked:true},now),false);assert.equal(remoteReady({...ready,service:{...ready.service,state:'provisioning'}},now),false);
});
test('a placement removed while editing reports the missing gateway',async()=>{
 const c=new RemoteController(()=>{},async<T>(path:string):Promise<ApiResult<T>>=>path.endsWith('/status')?{ok:true,value:view as T}:{ok:false,status:409,code:'remote_not_placed',retryAfterMs:0});c.account('owner');await c.open(id);c.edit(dns.hostname);await c.preview();assert.equal(c.error,'remoteNotPlaced');
});
