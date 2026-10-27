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
 const calls:{path:string;body?:Record<string,unknown>}[]=[];let changed=false;
 const c=new RemoteController(()=>{},async<T>(path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{
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

for(const input of ['staff.cafe.example.', '  STAFF.Cafe.Example.  '])test(`a fully qualified name with one trailing dot previews without it: ${JSON.stringify(input)}`,async()=>{
 const calls:{path:string;body?:Record<string,unknown>}[]=[];
 const c=new RemoteController(()=>{},async<T>(path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{
  calls.push({path,body});return {ok:true,value:(path.endsWith('/status')?view:dns) as T};
 });
 c.account('owner');await c.open(id);c.edit(input);await c.preview();
 assert.equal(c.error,undefined);
 assert.equal(c.hostname,'staff.cafe.example');
 assert.deepEqual(calls,[{path:'/remote-access/status',body:{installationId:id}},{path:'/remote-access/dns',body:{installationId:id,kind:'staff',hostname:'staff.cafe.example'}}]);
 assert.deepEqual(c.confirmation,{kind:'staff',hostname:'staff.cafe.example',revision:1,records:dns.records});
});
for(const input of ['staff.cafe.example..','https://staff.cafe.example.','staff.cafe.example/path.','127.0.0.1.',['a'.repeat(63),'b'.repeat(63),'c'.repeat(63),'d'.repeat(46)].join('.')+'.'])test(`invalid remote names stay refused before DNS: ${JSON.stringify(input)}`,async()=>{
 const calls:string[]=[];
 const c=new RemoteController(()=>{},async<T>(path:string):Promise<ApiResult<T>>=>{calls.push(path);return {ok:true,value:view as T};});
 c.account('owner');await c.open(id);c.edit(input);await c.preview();
 assert.equal(c.error,'remoteInvalid');assert.equal(c.confirmation,undefined);
 assert.deepEqual(calls,['/remote-access/status']);
});

for(const kind of ['staff','public'] as const)for(const custom of [false,true])test(`unchanged ${kind} ${custom?'custom':'assigned'} names cannot be reviewed or applied`,async()=>{
 const current=custom?`${kind}.cafe.example`:view.names[kind].assigned;
 const saved={...view,names:{...view.names,[kind]:{...view.names[kind],current}}};
 const calls:string[]=[];
 const c=new RemoteController(()=>{},async<T>(path:string):Promise<ApiResult<T>>=>{
  calls.push(path);
  if(path.endsWith('/status'))return {ok:true,value:saved as T};
  if(path.endsWith('/dns'))return {ok:true,value:{installationId:id,kind,hostname:current,records:[{type:'CNAME',name:current,value:view.names[kind].assigned},{type:'CNAME',name:'_acme-challenge.'+current,value:'_acme-challenge.'+view.names[kind].assigned}]} as T};
  return {ok:true,value:saved as T};
 });
 c.account('owner');await c.open(id);c.choose(kind);
 for(const input of [current,`  ${current.toUpperCase()}.  `]){
  c.edit(input);await c.preview();
  assert.equal(c.confirmation,undefined,'an unchanged name has no change to confirm');
  await c.apply();
  assert.deepEqual(calls,['/remote-access/status'],'unchanged names cause no DNS or save request');
 }
 c.edit(current+'..');await c.preview();
 assert.equal(c.error,'remoteInvalid','two trailing dots remain malformed even on the saved name');
 assert.equal(c.confirmation,undefined);
 assert.deepEqual(calls,['/remote-access/status']);
});

test('a saved name becomes unchanged for direct controller calls',async()=>{
 let saved=view;const calls:string[]=[];
 const c=new RemoteController(()=>{},async<T>(path:string):Promise<ApiResult<T>>=>{
  calls.push(path);
  if(path.endsWith('/dns'))return {ok:true,value:dns as T};
  if(path.endsWith('/apply'))saved={...view,revision:2,names:{...view.names,staff:{...view.names.staff,current:dns.hostname}}};
  return {ok:true,value:saved as T};
 });
 c.account('owner');await c.open(id);c.edit(dns.hostname);await c.preview();await c.apply();
 assert.equal(c.view?.names?.staff.current,dns.hostname);assert.equal(c.notice,'remoteSaved');
 await c.preview();assert.equal(c.confirmation,undefined,'the saved name no longer has a change to confirm');await c.apply();
 assert.deepEqual(calls,['/remote-access/status','/remote-access/dns','/remote-access/apply']);
});

const forward=(category:unknown='upstream_transport',now=Date.now())=>({category,observedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+10000).toISOString()});
test('forward view rejects extra fields, categories and noncanonical or impossible dates',()=>{
 for(const category of [null,'upstream_non_200','upstream_timeout','upstream_response_limit','upstream_transport','forward_internal'])assert(validRemoteView({...view,publicForward:forward(category)}));
 for(const publicForward of [{...forward(),address:'private'},forward('raw error'),{...forward(),observedAt:'2026-01-01'},{...forward(),expiresAt:'not a date'},{...forward(),expiresAt:forward().observedAt},{...forward(),observedAt:'2026-02-30T00:00:00.000Z'},{...forward(),expiresAt:'2099-01-01T00:00:00.000Z'},{}])assert.equal(validRemoteView({...view,publicForward}),false,JSON.stringify(publicForward));
});
test('older server has null forwarding evidence and the controller clears evidence at expiry without a request',async()=>{
 let calls=0,reply:unknown={...view,publicForward:forward()};const c=new RemoteController(()=>{},async<T>():Promise<ApiResult<T>>=>{calls++;return {ok:true,value:reply as T};});
 c.account('owner');await c.open(id);const saved=(c.view as any).publicForward;assert(saved);c.expireForward(Date.parse(saved.expiresAt)-1);assert.deepEqual((c.view as any).publicForward,saved);c.expireForward(Date.parse(saved.expiresAt));assert.equal((c.view as any).publicForward,null);assert.equal(calls,1);
 reply=view;await c.load();assert.equal((c.view as any).publicForward,null);
 reply={...view,publicForward:forward('upstream_timeout',Date.now()-20000)};await c.load();assert.equal((c.view as any).publicForward,null);
});
test('refresh erases old evidence before drawing or awaiting the reply, including malformed and failed replies',async()=>{
 for(const reply of [{ok:true,value:{...view,publicForward:{...forward(),raw:'private'}}},{ok:true,value:{...view,installationId:other,publicForward:forward()}},{ok:false,status:503,code:'unavailable',retryAfterMs:0},{ok:false,status:401,code:'unauthenticated',retryAfterMs:0},{ok:false,status:403,code:'permission_denied',retryAfterMs:0}]){
  let finish!:(v:ApiResult<unknown>)=>void,calls=0;const draws:unknown[]=[];
  const c=new RemoteController(()=>{draws.push((c.view as any)?.publicForward??null);},<T>():Promise<ApiResult<T>>=>++calls===1?Promise.resolve({ok:true,value:{...view,publicForward:forward()} as T}):new Promise(r=>{finish=r as typeof finish;}));
  c.account('owner');await c.open(id);assert((c.view as any).publicForward);draws.length=0;const pending=c.load();assert.equal((c.view as any)?.publicForward??null,null);assert(draws.every(v=>v===null));finish(reply as ApiResult<unknown>);await pending;assert.equal((c.view as any)?.publicForward??null,null);
 }
});
test('closing, account/venue switches and signout discard in-flight private results',async()=>{
 for(const change of ['close','account','signout']){
  let finish!:(v:ApiResult<unknown>)=>void,calls=0;const c=new RemoteController(()=>{},<T>():Promise<ApiResult<T>>=>++calls===1?Promise.resolve({ok:true,value:{...view,publicForward:forward()} as T}):new Promise(r=>{finish=r as typeof finish;}));
  c.account('owner');await c.open(id);const pending=c.load();
  if(change==='close')c.close();if(change==='account')c.account('other');if(change==='signout')c.account(undefined);
  finish({ok:true,value:{...view,publicForward:forward()}});
  await pending;assert.equal(c.view,undefined);
 }
});
test('private outcome categories have string types and revoked or unplaced views cannot carry evidence',()=>{
 for(const patch of [{publicForward:forward(['upstream_transport'])},{publicForward:forward({toString:()=> 'upstream_transport'})},{revoked:true,publicForward:forward()},{names:null,publicForward:forward()}])assert.equal(validRemoteView({...view,...patch}),false);
});
test('a venue switch discards its older pending private reply',async()=>{
 const finishes:((v:ApiResult<unknown>)=>void)[]=[];
 const c=new RemoteController(()=>{},<T>():Promise<ApiResult<T>>=>new Promise(r=>finishes.push(r as any)));c.account('owner');
 const old=c.open(id),next=c.open(other);finishes[1]!({ok:true,value:{...view,installationId:other,publicForward:null}});await next;
 finishes[0]!({ok:true,value:{...view,publicForward:forward()}});await old;assert.equal(c.view?.installationId,other);assert.equal(c.view?.publicForward,null);
});
test('invalid DNS metadata clears private evidence before rendering its error',async()=>{
 const c=new RemoteController(()=>{},async<T>(path:string):Promise<ApiResult<T>>=>({ok:true,value:(path.endsWith('/status')?{...view,publicForward:forward()}:{malformed:true}) as T}));
 c.account('owner');await c.open(id);c.edit(dns.hostname);await c.preview();assert.equal(c.error,'unavailable');assert.equal(c.view?.publicForward,null);
});
test('the real API malformed-reply failure also clears private evidence during DNS preview',async()=>{
 const c=new RemoteController(()=>{},async<T>(path:string):Promise<ApiResult<T>>=>path.endsWith('/status')?{ok:true,value:{...view,publicForward:forward()} as T}:{ok:false,status:503,code:'unexpected_response',retryAfterMs:0});
 c.account('owner');await c.open(id);c.edit(dns.hostname);await c.preview();assert.equal(c.error,'unavailable');assert.equal(c.view?.publicForward,null);
});
test('a recent timestamp with a timezone offset is refused even within the valid lifetime',()=>{
 const recent=forward();assert.equal(validRemoteView({...view,publicForward:{...recent,observedAt:recent.observedAt.replace('Z','+00:00')}}),false);
});
test('apply clears private evidence before drawing or awaiting a configuration change',async()=>{
 let finish!:(v:ApiResult<unknown>)=>void;const draws:unknown[]=[];
 const c=new RemoteController(()=>{draws.push(c.view?.publicForward??null);},<T>(path:string):Promise<ApiResult<T>>=>path.endsWith('/apply')?new Promise(r=>{finish=r as typeof finish;}):Promise.resolve({ok:true,value:(path.endsWith('/dns')?dns:{...view,publicForward:forward()}) as T}));
 c.account('owner');await c.open(id);c.edit(dns.hostname);await c.preview();assert(c.confirmation);assert(c.view?.publicForward);draws.length=0;
 const applying=c.apply();assert.equal(c.view?.publicForward,null);assert(draws.every(value=>value===null));
 finish({ok:true,value:{...view,revision:2,names:{...view.names,staff:{...view.names.staff,current:dns.hostname}}}});await applying;assert.equal(c.view?.publicForward,null);assert.equal(c.notice,'remoteSaved');
});
