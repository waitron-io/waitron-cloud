import assert from 'node:assert/strict';
import {test} from 'node:test';
import {RemoteController} from '../src/remote-controller.ts';
import type {ApiResult} from '../src/api.ts';
import {accountRequest} from '../src/api.ts';
import type {RemoteView} from '../src/remote-types.ts';
const id='20000000-0000-4000-8000-000000000001';
const view:RemoteView={installationId:id,revision:1,revoked:false,names:{staff:{assigned:'staff.venue.example',current:'staff.venue.example'},public:{assigned:'venue.example',current:'venue.example'}},service:{state:'provisioning',health:'unknown',observedAt:null,validUntil:null}};
for(const [code,expected] of [['remote_plan_required','remotePlanRequired'],['remote_setup_required','remoteSetupRequired'],['remote_test_only','remoteTestOnly'],['revoked','remoteRevoked']] as const)
 for(const action of ['load','preview','apply'] as const)test(`${action}: ${code} explains the refusal and clears private setup`,async()=>{
  const calls:string[]=[];
  const c=new RemoteController(()=>{},async<T>(path:string):Promise<ApiResult<T>>=>{calls.push(path);return {ok:false,status:403,code,retryAfterMs:0};});
  c.account('owner');c.installationId=id;c.view=view;c.hostname='staff.cafe.example';c.confirmation={kind:'staff',hostname:c.hostname,revision:1,records:[]};
  await c[action]();assert.equal(c.error,expected);assert.equal(c.pending,false);assert.equal(c.view,undefined);assert.equal(c.hostname,'');assert.equal(c.confirmation,undefined);
  assert.deepEqual(calls,['/remote-access/'+(action==='load'?'status':action==='preview'?'dns':'apply')]);
  await c.preview();await c.apply();assert.equal(calls.length,1,'refusal cannot reuse a reviewed change');
 });
for(const status of [400,401,429,503])test(`${status}: a known remote code cannot override the response status`,async()=>{
 const c=new RemoteController(()=>{},async<T>():Promise<ApiResult<T>>=>({ok:false,status,code:'remote_plan_required',retryAfterMs:0}));c.account('owner');c.installationId=id;await c.load();
 assert.equal(c.error,status===400?'remoteInvalid':status===401?'pairSession':status===429?'limited':'unavailable');
});
for(const code of ['remote_plan_required','remote_setup_required','remote_test_only','revoked'])for(const status of [400,401,403,429,503])
 test(`API ${status}/${code}: only remote 403 replies expose a specific remote cause`,async t=>{
  const priorLocation=Object.getOwnPropertyDescriptor(globalThis,'location'),priorDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'location',{configurable:true,value:{protocol:'https:'}});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{cookie:'__Host-cloud_csrf=browser-proof'}});
  t.after(()=>{for(const [key,prior] of [['location',priorLocation],['document',priorDocument]] as const){if(prior)Object.defineProperty(globalThis,key,prior);else Reflect.deleteProperty(globalThis,key);}});
  t.mock.method(globalThis,'fetch',async()=>Response.json({error:code},{status}));
  for(const path of ['/remote-access/status','/remote-access/dns','/remote-access/apply','/remote-access/unknown','/pairing/approve','/installations/revoke']){
   assert.deepEqual(await accountRequest(path),{ok:false,status,code:status===403&&['/remote-access/status','/remote-access/dns','/remote-access/apply'].includes(path)?code:'unexpected_response',retryAfterMs:0});
  }
 });
