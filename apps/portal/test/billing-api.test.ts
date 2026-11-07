import assert from 'node:assert/strict';
import {test} from 'node:test';
import {accountRequest} from '../src/api.ts';

const venueId='11111111-1111-4111-8111-111111111111';
test('billing reads and trial writes send browser proof and accept only complete venue views',async t=>{
 const prior=['location','document'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
 Object.defineProperty(globalThis,'location',{configurable:true,value:{protocol:'https:'}});
 Object.defineProperty(globalThis,'document',{configurable:true,value:{cookie:'__Host-cloud_csrf=proof'}});
 t.after(()=>{for(const [key,value] of prior){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}});
 const venue={venueId,level:'registered',trial:null,canStartTrial:true};
 let value:unknown={venues:[venue]},status=200;const calls:{url:unknown;init:RequestInit|undefined}[]=[];
 t.mock.method(globalThis,'fetch',async(url:unknown,init?:RequestInit)=>{calls.push({url,init});return Response.json(value,{status});});
 assert.deepEqual(await accountRequest('/billing/read',{}),{ok:true,value:{venues:[venue]}});
 assert.equal(calls[0]!.url,'/api/account/billing/read');assert.equal(calls[0]!.init?.method,'POST');
 assert.equal((calls[0]!.init?.headers as Record<string,string>)['X-CSRF-Token'],'proof');
 const active={...venue,level:'connected',canStartTrial:false,trial:{level:'connected',startedOn:'2026-11-07',endsOn:'2026-12-07',state:'active',extended:false}};
 value={venues:[active]};assert.equal((await accountRequest('/billing/start-trial',{venueId})).ok,true);
 assert.deepEqual(JSON.parse(String(calls.at(-1)!.init?.body)),{venueId});
 value={venues:[{...venue,level:'hosted',canStartTrial:false}]};assert.equal((await accountRequest('/billing/read',{})).ok,true);
 for(const bad of [{...venue,venueId:'foreign'}, {...venue,canStartTrial:'yes'}, {...venue,level:'other'}, {...active,trial:{...active.trial,endsOn:'2026-02-30'}}, {...active,trial:{...active.trial,endsOn:'2026-11-07'}}]){
  value={venues:[bad]};assert.equal((await accountRequest('/billing/read',{})).ok,false);
 }
 value={venues:[venue,venue]};assert.equal((await accountRequest('/billing/read',{})).ok,false);
 value={error:'conflict',venues:[active]};status=409;
 assert.deepEqual(await accountRequest('/billing/start-trial',{venueId}),{ok:false,status:409,code:'conflict',retryAfterMs:0});
});

test('billing retry delays subtract time spent reading the response body',async t=>{
 let elapsed=0;t.mock.method(performance,'now',()=>elapsed);
 const prior=['location','document'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
 Object.defineProperty(globalThis,'location',{configurable:true,value:{protocol:'https:'}});
 Object.defineProperty(globalThis,'document',{configurable:true,value:{cookie:''}});
 t.after(()=>{for(const [key,value] of prior){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}});
 const response=new Response(null,{status:429,headers:{'retry-after':'10'}});
 t.mock.method(response,'json',async()=>{elapsed=4000;return {error:'rate_limited'};});
 t.mock.method(globalThis,'fetch',async()=>response);
 assert.deepEqual(await accountRequest('/billing/read',{}),{ok:false,status:429,code:'rate_limited',retryAfterMs:6000});
});
