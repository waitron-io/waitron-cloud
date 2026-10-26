import assert from 'node:assert/strict';
import {test} from 'node:test';
import {accountRequest} from '../src/api.ts';
import {RecoveryController} from '../src/recovery-controller.ts';
import type {RecoveryView} from '../src/recovery-types.ts';

const id='12345678-1234-4234-8234-123456789abc',pointId='22345678-1234-4234-8234-123456789abc',venueId='32345678-1234-4234-8234-123456789abc';
const expiresAt='2099-01-01T00:00:00.000Z';
const pending:RecoveryView={requestId:id,state:'awaiting_owner',expiresAt,operationId:null,operation:null};
const ready:RecoveryView={...pending,state:'approved',operationId:id,operation:{id,pointId,venueId,source:{kind:'snapshot',pointId},mode:'failure',status:'restored',expiresAt},
 replacement:{requestId:id,pointId,venueId,source:{kind:'snapshot',pointId},oldInstallationId:'42345678-1234-4234-8234-123456789abc',localVenueId:'52345678-1234-4234-8234-123456789abc',nodeId:'62345678-1234-4234-8234-123456789abc',environment:'test',publicKey:'MCowBQYDK2VwAyEA'+'A'.repeat(43),peerPublicKey:Buffer.alloc(32).toString('base64'),state:'awaiting_owner',expiresAt,organisationName:'Café Sol',legalBusinessName:'Sol SL',registration:null}};
const refusals=[
 {status:400,code:'confirmation_required',error:'recoveryConfirmation'},
 {status:400,code:'unverified',error:'recoveryUnverified'},
 {status:400,code:'invalid_input',error:'recoveryInput'},
 {status:409,code:'target_not_fresh',error:'recoveryFreshTarget'},
 {status:409,code:'recovery_active',error:'recoveryActive'},
 {status:409,code:'conflict',error:'recoveryConflict'},
 {status:409,code:'approval_required',error:'recoveryApprovalRequired'},
] as const;

// Dropping a refusal code or treating it as a transport failure loses the way forward.
for(const action of ['inspect','approve','close','replace'] as const)for(const {status,code,error}of refusals)test(`recovery ${action}: real API preserves ${status}/${code} and gives specific guidance without repeating a write`,async t=>{
 const previous=['location','document'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
 Object.defineProperty(globalThis,'location',{configurable:true,value:{protocol:'https:'}});
 Object.defineProperty(globalThis,'document',{configurable:true,value:{cookie:'__Host-cloud_csrf=browser-proof'}});
 t.after(()=>{for(const [key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}});
 const calls:{url:unknown;options?:RequestInit}[]=[];
 t.mock.method(globalThis,'fetch',async(url:unknown,options?:RequestInit)=>{calls.push({url,options});return Response.json({error:code},{status});});
 const c=new RecoveryController(()=>{});c.open(id);c.account('owner');c.code=' 00123456 ';c.view=action==='approve'?pending:ready;
 c.choose(venueId,pointId);c.stopped=true;c.acceptLoss=true;c.confirmReplacement=true;
 await c[action]();
 assert.equal(c.error,code==='confirmation_required'&&action==='replace'?'recoveryReplacementConfirmation':error);
 assert.equal(c.uncertain,false);assert.equal(c.pending,false);assert.equal(c.view?.state,action==='approve'?'awaiting_owner':'approved');
 assert.equal(calls.length,1);assert.equal(calls[0]!.url,'/api/account/recovery/'+action);
 assert.equal(calls[0]!.options?.method,'POST');assert.equal(calls[0]!.options?.credentials,'same-origin');
 assert.equal((calls[0]!.options?.headers as Record<string,string>)['X-CSRF-Token'],'browser-proof');
 const body={requestId:id,code:'00123456',...(action==='approve'?{source:'snapshot',pointId,oldServerUnavailable:'true',acceptDataLoss:'true'}:action==='replace'?{oldInstallationId:ready.replacement!.oldInstallationId,oldServerUnavailable:'true',confirmReplacement:'true'}:{})};
 assert.deepEqual(JSON.parse(String(calls[0]!.options?.body)),body);
});

// A known recovery code on the wrong status or another route is still untrusted.
for(const {path,status,code}of [
 {path:'/recovery/approve',status:400,code:'conflict'},
 {path:'/recovery/approve',status:409,code:'unverified'},
 {path:'/recovery/approve',status:503,code:'recovery_active'},
 {path:'/recovery/approve',status:409,code:'private_unknown_reason'},
 {path:'/remote-access/apply',status:409,code:'recovery_active'},
])test(`API refuses mismatched recovery classification ${path}/${status}/${code}`,async t=>{
 const previous=['location','document'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
 Object.defineProperty(globalThis,'location',{configurable:true,value:{protocol:'https:'}});Object.defineProperty(globalThis,'document',{configurable:true,value:{cookie:''}});
 t.after(()=>{for(const [key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}});
 t.mock.method(globalThis,'fetch',async()=>Response.json({error:code},{status}));
 assert.deepEqual(await accountRequest(path,{}),{ok:false,status,code:'unexpected_response',retryAfterMs:0});
});

for(const action of ['approve','close','replace'] as const)for(const status of [0,400,409,503])test(`recovery ${action}: uncertain ${status} write still checks its request and never repeats the write`,async()=>{
 const calls:string[]=[];
 const c=new RecoveryController(()=>{},async<T>(path:string)=>{calls.push(path);return path.endsWith('/inspect')?{ok:true as const,value:ready as T}:{ok:false as const,status,code:status===0?'network_error':status===503?'temporarily_unavailable':'unexpected_response',retryAfterMs:0};});
 c.open(id);c.account('owner');c.code='00123456';c.view=action==='approve'?pending:ready;c.choose(venueId,pointId);c.stopped=true;c.acceptLoss=true;c.confirmReplacement=true;
 await c[action]();assert.deepEqual(calls,['/recovery/'+action,'/recovery/inspect']);assert.equal(c.view?.operation?.status,'restored');assert.equal(c.uncertain,false);assert.equal(c.confirmReplacement,false);
});
