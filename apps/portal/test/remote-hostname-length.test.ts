import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {ApiResult} from '../src/api.ts';
import {RemoteController} from '../src/remote-controller.ts';
import {remoteHostname,type RemoteView} from '../src/remote-types.ts';

const hostname=(length:number)=>['a'.repeat(63),'b'.repeat(63),'c'.repeat(63),'d'.repeat(length-192)].join('.');
const installationId='12345678-1234-4234-8234-123456789abc';
const view:RemoteView={installationId,revision:1,revoked:false,names:{staff:{assigned:'staff.venue.example',current:'staff.venue.example'},public:{assigned:'venue.example',current:'venue.example'}},service:{state:'provisioning',health:'unknown',observedAt:null,validUntil:null}};

for(const kind of ['staff','public'] as const){
 test(`the portal refuses oversized ${kind} names before requesting DNS instructions`,async()=>{
  const requests:string[]=[];
  const controller=new RemoteController(()=>{},async<T>(path:string):Promise<ApiResult<T>>=>{
   requests.push(path);
   return path.endsWith('/status')?{ok:true,value:view as T}:{ok:false,status:400,code:'invalid_hostname',retryAfterMs:0};
  });
  controller.account('owner');await controller.open(installationId);controller.choose(kind);
  for(const length of [238,253]){
   controller.edit(hostname(length));await controller.preview();
   assert.equal(controller.error,'remoteInvalid');
   assert.equal(controller.confirmation,undefined);
  }
  assert.deepEqual(requests,['/remote-access/status']);
 });
 test(`the portal can review a 237-character ${kind} name with its full certificate record`,async()=>{
  const name=hostname(237),assigned=view.names![kind].assigned;
  const records=[{type:'CNAME' as const,name,value:assigned},{type:'CNAME' as const,name:'_acme-challenge.'+name,value:'_acme-challenge.'+assigned}];
  const controller=new RemoteController(()=>{},async<T>(path:string):Promise<ApiResult<T>>=>({ok:true,value:(path.endsWith('/status')?view:{installationId,kind,hostname:name,records}) as T}));
  controller.account('owner');await controller.open(installationId);controller.choose(kind);
  controller.edit(name);await controller.preview();
  assert.equal(controller.error,undefined);
  assert.deepEqual(controller.confirmation,{kind,hostname:name,revision:1,records});
  assert.equal(controller.confirmation!.records[1]!.name.length,253);
 });
}

test('remote hostname validation preserves label and address restrictions at the certificate limit',()=>{
 assert.equal(remoteHostname(hostname(237)),true);
 for(const invalid of [hostname(238),hostname(253),'a'.repeat(64)+'.example','127.0.0.1','*.cafe.example','-staff.cafe.example'])assert.equal(remoteHostname(invalid),false);
});
