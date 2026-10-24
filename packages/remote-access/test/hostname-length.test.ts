import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import type {Pool} from 'pg';
import {dnsInstructions} from '../src/certificates.ts';
import {isHostname} from '../src/manifest.ts';
import {RemoteAccessStore} from '../src/placement.ts';

const hostname=(length:number)=>['a'.repeat(63),'b'.repeat(63),'c'.repeat(63),'d'.repeat(length-192)].join('.');
const installationId='12345678-1234-4234-8234-123456789abc';
const venueId='22345678-1234-4234-8234-123456789abc';
const assigned=`staff-v-${venueId}.example.test`;

test('DNS instructions leave room for the certificate challenge label on both record names',()=>{
 const longest=hostname(237);
 assert.equal(longest.length,237);
 const records=dnsInstructions(longest,assigned);
 assert.deepEqual(records,[{type:'CNAME',name:longest,value:assigned},{type:'CNAME',name:'_acme-challenge.'+longest,value:'_acme-challenge.'+assigned}]);
 assert.equal(records[1]!.name.length,253);
 assert.equal(dnsInstructions('staff.cafe.example',longest)[1]!.value.length,253);
 for(const length of [238,253]){
  const tooLong=hostname(length);
  assert.equal(tooLong.length,length);
  assert.equal(isHostname(tooLong),true);
  assert.throws(()=>dnsInstructions(tooLong,assigned),/invalid_hostname/);
  assert.throws(()=>dnsInstructions('staff.cafe.example',tooLong),/invalid_hostname/);
 }
});

function store(){
 const client=Object.assign(new EventEmitter(),{
  async query(sql:string,values?:unknown[]){
   if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[],rowCount:0};
   assert.ok(sql.startsWith('SELECT p.venue_id,c.suffix,i.revoked_at FROM remote_placements'));
   assert.deepEqual(values,[installationId]);
   return {rows:[{venue_id:venueId,suffix:'example.test',revoked_at:null}],rowCount:1};
  },
  release(){},
 });
 const pool={async connect(){return client;},async query(sql:string){
  assert.ok(sql.startsWith('SELECT id FROM remote_cells'));
  return {rows:[],rowCount:0};
 }};
 return new RemoteAccessStore(pool as unknown as Pool);
}

for(const kind of ['staff','public'] as const){
 test(`saving a ${kind} name refuses an oversized certificate record before DNS resolution`,async()=>{
  for(const length of [238,253]){
   await assert.rejects(store().setHostname(installationId,kind,hostname(length),1,async()=>{
    assert.fail('an oversized hostname must not reach DNS');
   }),/^Error: invalid_hostname$/);
  }
 });
 test(`saving a 237-character ${kind} name reaches DNS verification`,async()=>{
  const name=hostname(237);let queried:string|undefined;
  await assert.rejects(store().setHostname(installationId,kind,name,1,async record=>{
   queried=record;return [];
  }),/^Error: dns_not_verified$/);
  assert.equal(queried,name);
 });
}
