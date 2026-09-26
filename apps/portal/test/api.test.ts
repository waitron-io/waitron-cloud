import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountRequest } from '../src/api.ts';
test('account requests never retry writes and distinguish transport failures', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('private network detail'); });
  assert.deepEqual(await accountRequest('/signup/request', {email: 'owner@example.test',locale:'es'}),
    {ok:false,status:0,code:'network_error',retryAfterMs:0});
  assert.equal(calls, 1);
});
test('account requests validate success bodies and honor both Retry-After forms', async t => {
  const replies = [new Response('{}'), new Response('{"error":"rate_limited"}', {status:429,headers:{'retry-after':'90'}}),
    new Response('{"error":"temporarily_unavailable"}', {status:503,headers:{'retry-after':new Date(Date.now()+60_000).toUTCString()}})];
  t.mock.method(globalThis, 'fetch', async () => replies.shift()!);
  assert.equal((await accountRequest('/session')).ok, false);
  const limited = await accountRequest('/signup/request', {email:'owner@example.test'});
  assert.deepEqual(limited, {ok:false,status:429,code:'rate_limited',retryAfterMs:90_000});
  const unavailable = await accountRequest('/session');
  assert.ok(!unavailable.ok && unavailable.retryAfterMs > 58_000);
});
test('pairing reads validate named businesses and writes carry CSRF and bound views',async t=>{
  const org='12345678-1234-4234-8234-123456789abc',business='22345678-1234-4234-8234-123456789abc';
  const view={requestId:org,localVenueId:business,environment:'test',expiresAt:new Date().toISOString(),state:'awaiting_cloud'};
  const priorLocation=Object.getOwnPropertyDescriptor(globalThis,'location'),priorDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'location',{configurable:true,value:{protocol:'https:'}});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{cookie:'__Host-cloud_csrf=browser-proof'}});
  t.after(()=>{for(const [key,prior] of [['location',priorLocation],['document',priorDocument]] as const) {if(prior)Object.defineProperty(globalThis,key,prior);else Reflect.deleteProperty(globalThis,key);}});
  let response:unknown={businesses:[{organisationId:org,legalBusinessId:business,organisationName:'Café Sol',legalBusinessName:'Sol SL',countryCode:'ES'}]};
  let options:RequestInit|undefined;
  t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{options=init;return Response.json(response);});
  assert.equal((await accountRequest('/pairing/businesses')).ok,true);
  response={businesses:[{organisationId:org,legalBusinessId:business,organisationName:'',legalBusinessName:'Sol SL',countryCode:'ES'}]};
  assert.equal((await accountRequest('/pairing/businesses')).ok,false);
  response=view;assert.equal((await accountRequest('/pairing/inspect',{requestId:org,code:'12345678'})).ok,true);
  assert.equal((options?.headers as Record<string,string>)['X-CSRF-Token'],'browser-proof');
  for(const bad of [{...view,state:'other'},{...view,localVenueId:'x'},{...view,state:'awaiting_local'},{...view,environment:'preproduction'},{...view,expiresAt:'not-a-date'}]){
    response=bad;assert.equal((await accountRequest('/pairing/approve',{})).ok,false);
  }
  response={...view,state:'awaiting_local',organisationId:org,legalBusinessId:business,organisationName:'Café Sol',legalBusinessName:'Sol SL'};
  assert.equal((await accountRequest('/pairing/approve',{})).ok,true);
});

test('passkey requests validate nested ceremony replies and carry CSRF only for account management', async t => {
  const priorLocation=Object.getOwnPropertyDescriptor(globalThis,'location'),priorDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'location',{configurable:true,value:{protocol:'https:'}});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{cookie:'__Host-cloud_csrf=browser-proof'}});
  t.after(()=>{for(const [key,prior] of [['location',priorLocation],['document',priorDocument]] as const) {if(prior)Object.defineProperty(globalThis,key,prior);else Reflect.deleteProperty(globalThis,key);}});
  const ceremonyId='12345678-1234-4234-8234-123456789abc';
  let response:unknown={ceremonyId,options:{challenge:'challenge',rpId:'cloud.example.test',userVerification:'required'}};
  const requests:RequestInit[]=[];
  t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{requests.push(init!);return Response.json(response);});
  assert.equal((await accountRequest('/passkeys/authentication/options',{})).ok,true);
  assert.equal((requests.at(-1)?.headers as Record<string,string>)['X-CSRF-Token'],undefined);
  response={ceremonyId,options:{challenge:'challenge'}};
  assert.equal((await accountRequest('/passkeys/registration/options',{password:'secret'})).ok,false);
  response={ceremonyId,options:{challenge:'challenge',rp:{id:'cloud.example.test',name:'Waitron Cloud'},user:{id:'user',name:'owner@example.test',displayName:'owner@example.test'},pubKeyCredParams:[{type:'public-key',alg:-7}]}};
  assert.equal((await accountRequest('/passkeys/registration/options',{password:'secret'})).ok,true);
  assert.equal((requests.at(-1)?.headers as Record<string,string>)['X-CSRF-Token'],'browser-proof');
  response={id:ceremonyId,createdAt:new Date().toISOString(),lastUsedAt:null};
  assert.equal((await accountRequest('/passkeys/registration/verify',{ceremonyId,response:{id:'credential'}})).ok,true);
  assert.deepEqual(JSON.parse(String(requests.at(-1)?.body)),{ceremonyId,response:{id:'credential'}});
  response={passkeys:[{id:ceremonyId,createdAt:'not-a-date',lastUsedAt:null}]};
  assert.equal((await accountRequest('/passkeys')).ok,false);
});

test('account security requests validate session summaries and send CSRF on revoke', async t => {
  const priorLocation=Object.getOwnPropertyDescriptor(globalThis,'location'),priorDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'location',{configurable:true,value:{protocol:'https:'}});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{cookie:'__Host-cloud_csrf=browser-proof'}});
  t.after(()=>{for(const [key,prior] of [['location',priorLocation],['document',priorDocument]] as const) {if(prior)Object.defineProperty(globalThis,key,prior);else Reflect.deleteProperty(globalThis,key);}});
  const id='12345678-1234-4234-8234-123456789abc';
  const summary={id,createdAt:'2026-09-26T00:00:00.000Z',lastUsedAt:'2026-09-26T00:20:00.000Z',expiresAt:'2026-09-26T00:50:00.000Z',current:true};
  let response=new Response(JSON.stringify({sessions:[summary]}),{headers:{'content-type':'application/json'}});
  let options:RequestInit|undefined;
  t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{options=init;return response;});
  assert.equal((await accountRequest('/sessions')).ok,true);
  response=Response.json({sessions:[summary,...Array.from({length:100},(_,index)=>({...summary,
    id:`12345678-1234-4234-8234-${String(index+1).padStart(12,'0')}`,current:false}))]});
  assert.equal((await accountRequest('/sessions')).ok,true);
  response=Response.json({sessions:[{...summary,current:'yes'}]});
  assert.equal((await accountRequest('/sessions')).ok,false);
  response=new Response(null,{status:204});
  assert.equal((await accountRequest('/sessions/revoke',{id})).ok,true);
  assert.equal((options?.headers as Record<string,string>)['X-CSRF-Token'],'browser-proof');
});
