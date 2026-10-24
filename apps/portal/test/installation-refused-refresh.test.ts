import assert from 'node:assert/strict';
import {test} from 'node:test';
import {InstallationController} from '../src/installation-controller.ts';
import type {ApiResult} from '../src/api.ts';

const id='12345678-1234-4234-8234-123456789abc';
const view={installationId:id,venueId:id,organisationId:id,legalBusinessId:id,environment:'test',revision:0,revokedAt:null,lastContactAt:null,leaseExpiresAt:null,services:[],canRevoke:true};

for(const status of [401,403,0,429,503])test(`refresh ${status}: refused access clears rows and stop actions; temporary failures retain them`,async()=>{
 let failure=false;const writes:unknown[]=[];
 const controller=new InstallationController(()=>{},async<T>(path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{
  if(body)writes.push(body);
  assert.equal(path,'/installations');
  return failure?{ok:false,status,code:status===401?'session_invalid':status===403?'forbidden':'temporarily_unavailable',retryAfterMs:0}:{ok:true,value:{installations:[view]} as T};
 });
 controller.account('owner');await controller.load();controller.choose(id);
 assert.equal(controller.visible.length,1);assert.equal(controller.confirming,id);
 failure=true;await controller.load();
 assert.equal(controller.pending,false);assert.equal(controller.loaded,true);
 assert.equal(controller.error,status===401?'pairSession':status===403?'forbidden':status===429?'limited':'unavailable');
 if(status===401||status===403){
  assert.deepEqual(controller.installations,[]);assert.deepEqual(controller.visible,[]);assert.deepEqual(controller.organisations,[]);
  assert.equal(controller.selectedOrganisation,undefined);assert.equal(controller.confirming,undefined);
  controller.choose(id);await controller.revoke();assert.deepEqual(writes,[]);
  failure=false;await controller.load();assert.equal(controller.error,undefined);assert.equal(controller.visible.length,1);
  assert.equal(controller.selectedOrganisation,id);assert.equal(controller.confirming,undefined);
 }else{
  assert.deepEqual(controller.installations,[view]);assert.deepEqual(controller.visible,[view]);
  assert.equal(controller.selectedOrganisation,id);assert.equal(controller.confirming,id);
 }
});
