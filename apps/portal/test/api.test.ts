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

test('authenticator responses use exact unions and matching status codes; management alone carries CSRF',async t=>{
  const priorLocation=Object.getOwnPropertyDescriptor(globalThis,'location'),priorDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'location',{configurable:true,value:{protocol:'https:'}});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{cookie:'__Host-cloud_csrf=browser-proof'}});
  t.after(()=>{for(const [key,prior] of [['location',priorLocation],['document',priorDocument]] as const){if(prior)Object.defineProperty(globalThis,key,prior);else Reflect.deleteProperty(globalThis,key);}});
  const token='A'.repeat(43),expiresAt='2030-01-01T00:00:00.000Z';
  const challenge={factorRequired:true,challengeToken:token,expiresAt};
  let value:unknown=challenge,status=202,options:RequestInit|undefined;
  t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{options=init;return status===204?new Response(null,{status}):Response.json(value,{status});});
  assert.equal((await accountRequest('/login',{email:'owner@example.test',password:'current'})).ok,true);
  assert.equal((options?.headers as Record<string,string>)['X-CSRF-Token'],undefined);
  for(const bad of [{...challenge,accountId:'owner'},{...challenge,factorRequired:false},{...challenge,challengeToken:'x'},{...challenge,expiresAt:'bad'}]){value=bad;assert.equal((await accountRequest('/login',{})).ok,false);}
  value=challenge;assert.equal((await accountRequest('/login/factor',{})).ok,false);status=200;assert.equal((await accountRequest('/login',{})).ok,false);
  value={accountId:'owner'};status=202;assert.equal((await accountRequest('/login',{})).ok,false);
  status=200;assert.equal((await accountRequest('/login/factor',{})).ok,true);
  assert.equal((options?.headers as Record<string,string>)['X-CSRF-Token'],undefined);
  value={active:true,version:1,recoveryCodesRemaining:10,available:true};assert.equal((await accountRequest('/authenticator')).ok,true);
  for(const bad of [{active:true,version:0,recoveryCodesRemaining:10,available:true},{active:true,version:1,recoveryCodesRemaining:11,available:true},{active:true,version:1,recoveryCodesRemaining:10,available:true,secret:'private'}]){value=bad;assert.equal((await accountRequest('/authenticator')).ok,false);}
  const begin={pendingToken:token,secret:'JBSWY3DPEHPK3PXP',uri:'otpauth://totp/Cloud?secret=JBSWY3DPEHPK3PXP',expiresAt};
  value=begin;assert.equal((await accountRequest('/authenticator/begin',{password:'current'})).ok,true);
  assert.equal((options?.headers as Record<string,string>)['X-CSRF-Token'],'browser-proof');
  for(const bad of [{...begin,pendingToken:'x'},{...begin,expiresAt:'bad'}]){value=bad;assert.equal((await accountRequest('/authenticator/begin',{})).ok,false);}
  for(const uri of ['https://totp/Cloud?secret=JBSWY3DPEHPK3PXP','otpauth://hotp/Cloud?secret=JBSWY3DPEHPK3PXP','otpauth://totp/Cloud?secret=OTHER','otpauth://user@totp/Cloud?secret=JBSWY3DPEHPK3PXP','otpauth://totp/Cloud?secret=JBSWY3DPEHPK3PXP#extra']){value={...begin,uri};assert.equal((await accountRequest('/authenticator/begin',{})).ok,false);}
  const codes=Array.from({length:10},(_,i)=>i.toString(16).padStart(32,'0').toUpperCase());
  value={status:'changed',active:true,recoveryCodes:codes};assert.equal((await accountRequest('/authenticator/activate',{})).ok,true);assert.equal((await accountRequest('/authenticator/regenerate',{})).ok,true);
  value={status:'changed',active:true,recoveryCodes:[...codes.slice(1),codes[1]]};assert.equal((await accountRequest('/authenticator/activate',{})).ok,false);
  value={status:'changed',active:true,recoveryCodes:[...codes.slice(1),'not-a-code']};assert.equal((await accountRequest('/authenticator/activate',{})).ok,false);
  value={status:'changed',active:false};assert.equal((await accountRequest('/authenticator/remove',{})).ok,true);
  status=204;assert.equal((await accountRequest('/authenticator/cancel',{pendingToken:token})).ok,true);
});

test('translation consent accepts complete venue choices and refuses malformed or contradictory replies',async t=>{
 const venueId='12345678-1234-4234-8234-123456789abc';
 const choice={venueId,consented:true,consentedAt:'2026-10-14T10:00:00.000Z'};
 let value:unknown={consents:[choice]},status=200;
 t.mock.method(globalThis,'fetch',async()=>Response.json(value,{status}));
 assert.deepEqual(await accountRequest('/translation-consent'),{ok:true,value:{consents:[choice]}});
 for(const valid of [{consents:[]},{consents:[{venueId,consented:false,consentedAt:null}]}]){
  value=valid;assert.equal((await accountRequest('/translation-consent')).ok,true);
 }
 for(const invalid of [null,{},[],{consents:{}},{consents:[null]},
  {consents:[{...choice,venueId:'bad'}]},{consents:[{...choice,consented:'yes'}]},
  {consents:[{...choice,consentedAt:null}]},{consents:[{...choice,consentedAt:'bad'}]},
  {consents:[{...choice,consented:false}]},{consents:[choice,choice]}]){
  value=invalid;assert.deepEqual(await accountRequest('/translation-consent'),{ok:false,status:503,code:'unexpected_response',retryAfterMs:0});
 }
 value={consents:[choice]};status=202;assert.equal((await accountRequest('/translation-consent')).ok,false);
});

test('translation consent writes carry the unique browser token and never retry',async t=>{
 const priorLocation=Object.getOwnPropertyDescriptor(globalThis,'location'),priorDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
 const document={cookie:'__Host-cloud_csrf=browser-proof'};
 Object.defineProperty(globalThis,'location',{configurable:true,value:{protocol:'https:'}});
 Object.defineProperty(globalThis,'document',{configurable:true,value:document});
 t.after(()=>{for(const [key,prior] of [['location',priorLocation],['document',priorDocument]] as const){if(prior)Object.defineProperty(globalThis,key,prior);else Reflect.deleteProperty(globalThis,key);}});
 let options:RequestInit|undefined,calls=0;
 t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{calls++;options=init;return Response.json({consents:[]});});
 const body={venueId:'12345678-1234-4234-8234-123456789abc',choice:'agree',consentVersion:'providers-2026-10-14'};
 await accountRequest('/translation-consent',body);
 assert.equal((options?.headers as Record<string,string>)['X-CSRF-Token'],'browser-proof');
 assert.equal(options?.method,'POST');assert.equal(options?.body,JSON.stringify(body));assert.equal(options?.credentials,'same-origin');assert.equal(calls,1);
 document.cookie='__Host-cloud_csrf=one; __Host-cloud_csrf=two';await accountRequest('/translation-consent',body);
 assert.equal((options?.headers as Record<string,string>)['X-CSRF-Token'],'');
 await accountRequest('/translation-consent');assert.equal((options?.headers as Record<string,string>)['X-CSRF-Token'],undefined);assert.equal(options?.method,'GET');
});
