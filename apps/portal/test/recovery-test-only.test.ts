import assert from 'node:assert/strict';
import {test} from 'node:test';
import {RecoveryController} from '../src/recovery-controller.ts';
import {accountRequest,type ApiResult} from '../src/api.ts';
import type {RecoveryView} from '../src/recovery-types.ts';

const id='12345678-1234-4234-8234-123456789abc',pointId='22345678-1234-4234-8234-123456789abc',venueId='32345678-1234-4234-8234-123456789abc';
const expiresAt=new Date(Date.now()+3600000).toISOString();
const ready:RecoveryView={requestId:id,state:'approved',expiresAt,operationId:id,
 operation:{id,pointId,venueId,source:{kind:'snapshot',pointId},mode:'failure',status:'restored',expiresAt},
 replacement:{requestId:id,pointId,venueId,source:{kind:'snapshot',pointId},oldInstallationId:'42345678-1234-4234-8234-123456789abc',localVenueId:'52345678-1234-4234-8234-123456789abc',nodeId:'62345678-1234-4234-8234-123456789abc',environment:'test',publicKey:'MCowBQYDK2VwAyEA'+'A'.repeat(43),peerPublicKey:Buffer.alloc(32).toString('base64'),state:'awaiting_owner',expiresAt,organisationName:'Café Sol',legalBusinessName:'Sol SL',registration:null}};

for(const action of ['inspect','approve','close','replace'] as const)for(const code of ['local_integration_only','permission_denied','forbidden'])test(`recovery ${action} distinguishes ${code} without retaining authority or repeating a write`,async()=>{
 const calls:{path:string;body:Record<string,unknown>|undefined}[]=[];
 const c=new RecoveryController(()=>{},async<T>(path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{calls.push({path,body});return {ok:false,status:403,code,retryAfterMs:0};});
 c.open(id);c.account('owner');c.code='00123456';
 c.view=action==='approve'?{requestId:id,state:'awaiting_owner',expiresAt,operationId:null,operation:null}:ready;
 c.choose(venueId,pointId);c.stopped=true;c.acceptLoss=true;c.confirmReplacement=true;
 await c[action]();
 assert.equal(c.error,code==='local_integration_only'?'recoveryTestOnly':'forbidden');
 assert.equal(c.view,undefined);assert.equal(c.venueId,undefined);assert.equal(c.pointId,undefined);assert.equal(c.source,undefined);
 assert.equal(c.stopped,false);assert.equal(c.acceptLoss,false);assert.equal(c.confirmReplacement,false);assert.equal(c.uncertain,false);assert.equal(c.pending,false);
 assert.deepEqual(calls.map(call=>call.path),['/recovery/'+action]);
 assert.equal(calls[0]!.body?.code,'00123456');
 if(action==='approve')assert.deepEqual(calls[0]!.body,{requestId:id,code:'00123456',source:'snapshot',pointId,oldServerUnavailable:'true',acceptDataLoss:'true'});
 if(action==='replace')assert.deepEqual(calls[0]!.body,{requestId:id,code:'00123456',oldInstallationId:ready.replacement!.oldInstallationId,oldServerUnavailable:'true',confirmReplacement:'true'});
});

for(const code of ['local_integration_only','unknown_private_reason'])test(`real recovery API preserves only a recognised refusal: ${code}`,async t=>{
 const priorLocation=Object.getOwnPropertyDescriptor(globalThis,'location'),priorDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'location',{configurable:true,value:{protocol:'https:'}});
 Object.defineProperty(globalThis,'document',{configurable:true,value:{cookie:'__Host-cloud_csrf=browser-proof'}});
 t.after(()=>{for(const [key,prior]of [['location',priorLocation],['document',priorDocument]]as const){if(prior)Object.defineProperty(globalThis,key,prior);else Reflect.deleteProperty(globalThis,key);}});
 const calls:{url:unknown;options:RequestInit|undefined}[]=[];
 t.mock.method(globalThis,'fetch',async(url:unknown,options?:RequestInit)=>{calls.push({url,options});return Response.json({error:code},{status:403});});
 const result=await accountRequest('/recovery/close',{requestId:id,code:'00123456'});
 assert.deepEqual(result,{ok:false,status:403,code:code==='local_integration_only'?code:'unexpected_response',retryAfterMs:0});
 assert.equal(calls.length,1);assert.equal(calls[0]!.url,'/api/account/recovery/close');
 assert.equal(calls[0]!.options?.method,'POST');assert.equal(calls[0]!.options?.credentials,'same-origin');
 assert.equal((calls[0]!.options?.headers as Record<string,string>)['X-CSRF-Token'],'browser-proof');
 assert.deepEqual(JSON.parse(String(calls[0]!.options?.body)),{requestId:id,code:'00123456'});
});

for(const {status,code,error,reconcile}of [
 {status:400,code:'local_integration_only',error:'unavailable',reconcile:false},
 {status:401,code:'local_integration_only',error:'pairSession',reconcile:false},
 {status:429,code:'local_integration_only',error:'limited',reconcile:false},
 {status:503,code:'local_integration_only',error:'unavailable',reconcile:true},
 {status:0,code:'network_error',error:'unavailable',reconcile:true},
])test(`test-only code does not override ${status} handling or uncertain recovery reconciliation`,async()=>{
 const calls:string[]=[];
 const c=new RecoveryController(()=>{},async<T>(path:string):Promise<ApiResult<T>>=>{calls.push(path);return {ok:false,status,code,retryAfterMs:status===429?60000:0};});
 c.open(id);c.account('owner');c.code='00123456';c.view=ready;
 await c.close();
 assert.equal(c.error,error);assert.equal(c.uncertain,reconcile);
 assert.deepEqual(calls,reconcile?['/recovery/close','/recovery/inspect']:['/recovery/close']);
 if(status===429){assert.ok(c.waiting>0);await c.close();assert.deepEqual(calls,['/recovery/close']);}
});

for(const status of [400,409,503])test(`real API keeps an unexpected ${status} test-only write subject to reconciliation`,async t=>{
 const priorLocation=Object.getOwnPropertyDescriptor(globalThis,'location'),priorDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'location',{configurable:true,value:{protocol:'https:'}});
 Object.defineProperty(globalThis,'document',{configurable:true,value:{cookie:'__Host-cloud_csrf=browser-proof'}});
 t.after(()=>{for(const [key,prior]of [['location',priorLocation],['document',priorDocument]]as const){if(prior)Object.defineProperty(globalThis,key,prior);else Reflect.deleteProperty(globalThis,key);}});
 const calls:unknown[]=[];
 t.mock.method(globalThis,'fetch',async(url:unknown)=>{calls.push(url);return Response.json({error:'local_integration_only'},{status});});
 const c=new RecoveryController(()=>{});c.open(id);c.account('owner');c.code='00123456';c.view=ready;
 await c.close();
 assert.equal(c.uncertain,true);assert.equal(c.error,'unavailable');assert.equal(c.confirmReplacement,false);
 assert.deepEqual(calls,['/api/account/recovery/close','/api/account/recovery/inspect']);
});
for(const path of ['/session','/authenticator'])test(`test-only recognition does not change ${path} refusals`,async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({error:'local_integration_only'},{status:403}));
 assert.deepEqual(await accountRequest(path),{ok:false,status:403,code:'unexpected_response',retryAfterMs:0});
});
