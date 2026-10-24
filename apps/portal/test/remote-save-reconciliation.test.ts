import assert from 'node:assert/strict';
import {test} from 'node:test';
import {RemoteController} from '../src/remote-controller.ts';
import type {ApiResult} from '../src/api.ts';

const id='12345678-1234-4234-8234-123456789abc';
const assigned='staff.venue.example',hostname='staff.cafe.example';
const original={installationId:id,revision:1,revoked:false,names:{staff:{assigned,current:assigned},public:{assigned:'venue.example',current:'venue.example'}},service:{state:'provisioning',health:'unknown',observedAt:null,validUntil:null}};
const dns={installationId:id,kind:'staff',hostname,records:[{type:'CNAME',name:hostname,value:assigned},{type:'CNAME',name:'_acme-challenge.staff.cafe.example',value:'_acme-challenge.staff.venue.example'}]};

for(const committed of [true,false])test(`a 503 save with Retry-After re-reads once when the name ${committed?'was':'was not'} saved`,async t=>{
 let now=1_800_000_000_000;t.mock.method(Date,'now',()=>now);
 let saves=0,current=original;const calls:Array<{path:string;body?:Record<string,unknown>}>=[];
 const controller=new RemoteController(()=>{},async<T>(path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{
  calls.push({path,body});
  if(path.endsWith('/dns'))return {ok:true,value:dns as T};
  if(path.endsWith('/apply')){
   saves++;
   current={...original,revision:saves+1,names:{...original.names,staff:{assigned,current:saves===1?(committed?hostname:assigned):assigned}}};
   return saves===1?{ok:false,status:503,code:'unavailable',retryAfterMs:1000}:{ok:true,value:current as T};
  }
  assert.equal(path,'/remote-access/status');return {ok:true,value:current as T};
 });
 controller.account('owner');await controller.open(id);controller.edit(hostname);await controller.preview();await controller.apply();
 assert.deepEqual(calls.map(c=>c.path),['/remote-access/status','/remote-access/dns','/remote-access/apply','/remote-access/status']);
 assert.equal(controller.view?.names?.staff.current,committed?hostname:assigned);
 assert.equal(controller.notice,committed?'remoteSaved':undefined);assert.equal(controller.error,committed?undefined:'remoteUncertain');
 assert.equal(controller.confirmation,undefined);assert.equal(controller.waiting,1);
 assert.deepEqual(calls[2]!.body,{installationId:id,kind:'staff',hostname,expectedRevision:'1'});
 controller.edit(assigned);await controller.preview();await controller.apply();await controller.load();assert.equal(calls.length,4);
 now+=999;await controller.preview();await controller.load();assert.equal(calls.length,4);
 now++;await controller.preview();assert.equal(controller.confirmation?.hostname,assigned);await controller.apply();
 assert.equal(saves,2);assert.equal(calls.length,5);assert.equal(controller.notice,'remoteSaved');assert.equal(controller.view?.names?.staff.current,assigned);
});

test('a refused reconciliation read extends the wait without another read or save',async t=>{
 t.mock.method(Date,'now',()=>1_800_000_000_000);let reads=0,saves=0;
 const controller=new RemoteController(()=>{},async<T>(path:string):Promise<ApiResult<T>>=>{
  if(path.endsWith('/dns'))return {ok:true,value:dns as T};
  if(path.endsWith('/apply')){saves++;return {ok:false,status:503,code:'unavailable',retryAfterMs:1000};}
  reads++;return reads===1?{ok:true,value:original as T}:{ok:false,status:429,code:'rate_limited',retryAfterMs:60_000};
 });
 controller.account('owner');await controller.open(id);controller.edit(hostname);await controller.preview();await controller.apply();
 assert.equal(reads,2);assert.equal(saves,1);assert.equal(controller.waiting,60);assert.equal(controller.view,undefined);assert.equal(controller.error,'limited');
 await controller.load();await controller.apply();assert.equal(reads,2);assert.equal(saves,1);
});
