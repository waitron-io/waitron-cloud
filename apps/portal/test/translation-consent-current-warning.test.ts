import assert from 'node:assert/strict';
import {test} from 'node:test';
import {TranslationConsentController} from '../src/translation-consent-controller.ts';

const venueId='12345678-1234-4234-8234-123456789abc';
const choices={consents:[{venueId,consented:false,consentedAt:null}]};
const staleReplies=[
 {name:'agreement',reply:()=>Response.json({consents:[{venueId,consented:true,consentedAt:'2026-10-14T10:00:00.000Z'}]})},
 {name:'expired session',reply:()=>Response.json({error:'unauthenticated'},{status:401})},
 {name:'longer retry',reply:()=>Response.json({error:'rate_limited'},{status:429,headers:{'Retry-After':'90'}})},
 {name:'lost connection',reply:():Response=>{throw new TypeError('controlled lost reply');}},
];
for(const action of ['load','agree','withdraw'] as const)for(const old of staleReplies)
for(const destination of ['other account','original account after sign-out'] as const)
for(const warning of ['uncertain write','retry wait'] as const)
test(`late ${action} ${old.name} preserves current ${warning} for ${destination}`,async t=>{
 for(const [key,value] of [['location',{protocol:'https:'}],['document',{cookie:'__Host-cloud_csrf=consent-current-proof'}]] as const){
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,key);
  Object.defineProperty(globalThis,key,{configurable:true,value});
  t.after(()=>{if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);});
 }
 t.mock.method(Date,'now',()=>100000);t.mock.method(performance,'now',()=>0);
 let finish!:(response:Response)=>void,fail!:(error:unknown)=>void,calls=0,changes=0;
 t.mock.method(globalThis,'fetch',async(url:unknown,init?:RequestInit)=>{
  assert.equal(url,'/api/account/translation-consent');calls++;
  if(calls===2)return new Promise<Response>((resolve,reject)=>{finish=resolve;fail=reject;});
  if(calls===4){
   assert.equal(init?.method,'POST');
   assert.equal(new Headers(init?.headers).get('X-CSRF-Token'),'consent-current-proof');
   assert.deepEqual(JSON.parse(String(init?.body)),{venueId,choice:'withdraw'});
   return Response.json({error:warning==='retry wait'?'rate_limited':'temporarily_unavailable'},
    {status:warning==='retry wait'?429:503,headers:warning==='retry wait'?{'Retry-After':'7'}:{}});
  }
  return Response.json(choices);
 });
 const controller=new TranslationConsentController(()=>{changes++;});
 controller.account('original');await controller.load();
 const pending=action==='load'?controller.load():controller[action](venueId);
 assert.equal(controller.pending,true);
 controller.account(destination==='other account'?'other':undefined);
 if(destination==='original account after sign-out')controller.account('original');
 await controller.load();await controller.withdraw(venueId);
 assert.equal(controller.error,warning==='retry wait'?'limited':'translationConsentUncertain');
 assert.equal(controller.errorVenueId,venueId);assert.equal(controller.waiting,warning==='retry wait'?7:0);
 const snapshot=()=>({consents:structuredClone(controller.consents),loaded:controller.loaded,pending:controller.pending,
  error:controller.error,errorVenueId:controller.errorVenueId,loadAttempted:controller.loadAttempted,retryAt:controller.retryAt,waiting:controller.waiting});
 const before=snapshot(),beforeChanges=changes;
 try{finish(old.reply());}catch(error){fail(error);}
 await pending;
 assert.deepEqual(snapshot(),before,'a stale reply must leave the current warning and exact retry deadline intact');
 assert.equal(changes,beforeChanges,'a stale reply must not publish current account state');
 assert.equal(calls,4,'neither the late reply nor current warning sends an automatic retry');
});
