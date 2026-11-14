import assert from 'node:assert/strict';
import {test} from 'node:test';
import {RemoteController} from '../src/remote-controller.ts';
import {validRemoteView} from '../src/remote-types.ts';
import type {ApiResult} from '../src/api.ts';
import {accountRequest} from '../src/api.ts';
const id='12345678-1234-4234-8234-123456789abc',venueId='22345678-1234-4234-8234-123456789abc';
const menu={version:1,venueId,url:`https://menus.example.test/m/${venueId}`,revision:1,state:'current',publication:{bodySha256:'a'.repeat(64),defaultLanguage:'en',receivedAt:'2026-11-01T12:00:00.000Z'}};
const view={installationId:id,revision:1,revoked:false,names:null,guestMenu:menu,service:{state:'unconfigured',health:'unknown',observedAt:null,validUntil:null}};

test('the real portal decoder accepts guest sharing confirmations',async t=>{
 const previousLocation=Object.getOwnPropertyDescriptor(globalThis,'location'),previousDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'location',{configurable:true,value:{protocol:'https:'}});Object.defineProperty(globalThis,'document',{configurable:true,value:{cookie:'__Host-cloud_csrf=synthetic-proof'}});
 t.after(()=>{for(const [key,value] of [['location',previousLocation],['document',previousDocument]] as const){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}});
 let headers:Record<string,string>|undefined;
 t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{headers=init?.headers as Record<string,string>;return Response.json({...menu,state:'blocked',publication:null});});
 const result=await accountRequest('/guest-menu/takedown',{venueId});
 assert.equal(headers?.['X-CSRF-Token'],'synthetic-proof');assert.equal(result.ok,true);
});

test('guest links are validated before the portal offers them',()=>{
 assert.equal(validRemoteView(view),true);
 for(const patch of [{url:'javascript:alert(1)'},{url:'https://menus.example.test/m/'+id},{state:'unknown'},{revision:-1},{publication:{...menu.publication,defaultLanguage:'xx'}}])assert.equal(validRemoteView({...view,guestMenu:{...menu,...patch}}),false);
});
test('sharing actions bind the venue and discard a reply after the account changes',async()=>{
 const calls:{path:string;body?:Record<string,unknown>}[]=[];
 let finish:((result:ApiResult<unknown>)=>void)|undefined,hold=false;
 const c=new RemoteController(()=>{},async<T>(path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{
  calls.push({path,body});
  if(path==='/remote-access/status')return {ok:true,value:view as T};
  if(hold)return new Promise(resolve=>{finish=resolve as typeof finish;});
  return {ok:true,value:{...menu,revision:2,state:'blocked',publication:null} as T};
 });
 c.account('owner');await c.open(id);await c.setGuestMenuBlocked(true);
 assert.deepEqual(calls.at(-1),{path:'/guest-menu/takedown',body:{venueId}});
 assert.equal(c.view?.guestMenu?.state,'blocked');
 hold=true;const enabling=c.setGuestMenuBlocked(false);c.account('other');
 assert.ok(finish);finish({ok:true,value:{...menu,revision:3,state:'off',publication:null}});await enabling;
 assert.equal(c.view,undefined);
});
