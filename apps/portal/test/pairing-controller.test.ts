import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PairingController} from '../src/pairing-controller.ts';
import type {ApiResult} from '../src/api.ts';
const requestId='12345678-1234-4234-8234-123456789abc';
const business={organisationId:requestId,legalBusinessId:'22345678-1234-4234-8234-123456789abc',organisationName:'Café Sol',legalBusinessName:'Sol SL',countryCode:'ES'};
const view={requestId,localVenueId:'32345678-1234-4234-8234-123456789abc',environment:'test',expiresAt:new Date(Date.now()+600000).toISOString(),state:'awaiting_cloud'};
test('inspection never approves; approval uses only an offered business and stays recoverable after a lost reply',async()=>{
  const calls:{path:string;body?:Record<string,string>}[]=[];let lose=false;
  const controller=new PairingController(()=>{},async<T>(path:string,body?:Record<string,string>):Promise<ApiResult<T>>=>{
    calls.push({path,body});
    return lose?{ok:false,status:0,code:'network_error',retryAfterMs:0}:{ok:true,value:(path.endsWith('businesses')?{businesses:[business]}:path.endsWith('inspect')?view:{...view,...business,state:'awaiting_local'}) as T};
  });
  controller.open(requestId);controller.account('account');await controller.load();
  assert.equal(controller.selected,business.legalBusinessId);controller.code='12345678';
  await controller.inspect();assert.equal(controller.view?.localVenueId,view.localVenueId);assert.equal(calls.filter(c=>c.path.endsWith('approve')).length,0);
  controller.selected='not-offered';await controller.approve();assert.equal(calls.filter(c=>c.path.endsWith('approve')).length,0);
  controller.selected=business.legalBusinessId;lose=true;await controller.approve();assert.equal(controller.error,'pairUncertain');assert.equal(controller.code,'12345678');
  lose=false;await controller.approve();assert.equal(controller.view?.state,'awaiting_local');
  assert.deepEqual(calls.at(-1)?.body,{requestId,code:'12345678',organisationId:business.organisationId,legalBusinessId:business.legalBusinessId});
});
test('an account change clears private choices and fences delayed replies while preserving the pending request',async()=>{
  let release!:(value:ApiResult<unknown>)=>void;
  const controller=new PairingController(()=>{},<T>()=>new Promise<ApiResult<T>>(resolve=>{release=resolve as typeof release;}));
  controller.open(requestId);controller.account('first');const loading=controller.load();
  controller.code='12345678';controller.account(undefined);assert.equal(controller.code,'');assert.equal(controller.requestId,requestId);
  controller.account('second');release({ok:true,value:{businesses:[business]}});await loading;
  assert.deepEqual(controller.businesses,[]);assert.equal(controller.pending,false);
});
test('rate limits prevent writes, invalid code is local, and a mismatched reply never becomes confirmable',async()=>{
  let calls=0;let limited=true;
  const controller=new PairingController(()=>{},async<T>():Promise<ApiResult<T>>=>{calls++;return limited?{ok:false,status:429,code:'rate_limited',retryAfterMs:60000}:{ok:true,value:{...view,requestId:business.legalBusinessId} as T};});
  controller.open(requestId);controller.account('first');controller.code='bad';await controller.inspect();assert.equal(calls,0);assert.equal(controller.codeError,true);
  controller.code='12345678';await controller.inspect();assert.equal(controller.error,'limited');await controller.inspect();assert.equal(calls,1);
  controller.retryAt=0;limited=false;await controller.inspect();assert.equal(controller.error,'unavailable');assert.equal(controller.view,undefined);
});
