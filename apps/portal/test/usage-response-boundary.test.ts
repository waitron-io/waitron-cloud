import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {UsageController} from '../src/usage-controller.ts';
import type {UsageSummary} from '../src/usage-types.ts';

const organisationId='12345678-1234-4234-8234-123456789abc';
const otherOrganisation='22345678-1234-4234-8234-123456789abc';
function summary():UsageSummary{
 return {version:1,organisationId,
  storage:{currentBytes:'-9007199254740993',addedBytes:'9007199254740994',removedBytes:'18014398509481987'},
  transfer:{uploadedBytes:'1536',restoredBytes:'2048'},
  operations:{installationCompleted:'3',monitoringProbes:'4'},
  messages:{sent:'5',failed:'6',expired:'7',cancelled:'8'},
  latestEventAt:'2026-10-28T09:00:00.000Z',measuredThrough:'2026-10-28T09:05:00.000Z'};
}

function harness(t:TestContext){
 for(const [name,value] of [['location',{protocol:'https:'}],['document',{cookie:'__Host-cloud_csrf=usage-proof'}]] as const){
  const previous=Object.getOwnPropertyDescriptor(globalThis,name);
  Object.defineProperty(globalThis,name,{configurable:true,value});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,name,previous);else Reflect.deleteProperty(globalThis,name);});
 }
 let reply:unknown=summary();
 const calls:Array<{url:unknown;init:RequestInit|undefined}>=[];
 t.mock.method(globalThis,'fetch',async(url:unknown,init?:RequestInit)=>{
  calls.push({url,init});return Response.json(reply);
 });
 let notifications=0;
 const controller=new UsageController(()=>{notifications++;});
 controller.account('owner');controller.organisation(organisationId);
 return {controller,calls,respond(value:unknown){reply=value;},notifications:()=>notifications};
}

type InvalidCase={name:string;change:(value:Record<string,any>)=>void};
const invalid:InvalidCase[]=[
 {name:'another organisation',change:v=>{v.organisationId=otherOrganisation;}},
 {name:'unknown version',change:v=>{v.version=2;}},
 {name:'missing freshness field',change:v=>{delete v.measuredThrough;}},
 {name:'extra private field',change:v=>{v.providerCredential='private-response-detail';}},
 {name:'extra storage field',change:v=>{v.storage.providerObject='private-response-detail';}},
 {name:'missing operation count',change:v=>{delete v.operations.monitoringProbes;}},
 {name:'array of message counts',change:v=>{v.messages=[];}},
 {name:'negative transfer count',change:v=>{v.transfer.uploadedBytes='-1';}},
 {name:'leading-zero count',change:v=>{v.messages.sent='05';}},
 {name:'fractional count',change:v=>{v.messages.failed='1.5';}},
 {name:'exponential count',change:v=>{v.operations.monitoringProbes='1e3';}},
 {name:'whitespace in count',change:v=>{v.messages.expired=' 7';}},
 {name:'invalid event timestamp',change:v=>{v.latestEventAt='not-a-date';}},
 {name:'noncanonical measurement timestamp',change:v=>{v.measuredThrough='2026-10-28T10:05:00+01:00';}},
];
for(const [group,keys] of [
 ['storage',['currentBytes','addedBytes','removedBytes']],
 ['transfer',['uploadedBytes','restoredBytes']],
 ['operations',['installationCompleted','monitoringProbes']],
 ['messages',['sent','failed','expired','cancelled']],
] as const)for(const key of keys){
 invalid.push({name:`numeric ${group}.${key}`,change:v=>{v[group][key]=9007199254740992;}});
}

for(const entry of invalid)test(`usage HTTP ${entry.name} cannot replace earlier selected totals`,async t=>{
 const {controller:c,calls,respond,notifications}=harness(t);
 await c.load();const earlier=c.summary;
 assert.deepEqual(earlier,summary());assert.equal(c.loaded,true);
 const bad=summary();entry.change(bad);respond(bad);c.refresh();
 const before=notifications();await c.load();
 assert.equal(c.summary,earlier,'a refused response must preserve the previously measured totals');
 assert.equal(c.error,'unavailable');assert.equal(c.loaded,false);assert.equal(c.pending,false);assert.equal(c.waiting,0);
 assert.equal(notifications(),before+2,'the read must publish its pending and refused states');
 assert.equal(calls.length,2,'a refused response must not automatically repeat the read');
 const replacement:UsageSummary={...summary(),storage:{currentBytes:'42',addedBytes:'43',removedBytes:'1'},latestEventAt:null,measuredThrough:null};
 respond(replacement);await c.load();
 assert.deepEqual(c.summary,replacement);assert.equal(c.loaded,true);assert.equal(c.pending,false);assert.equal(c.error,undefined);
 assert.equal(calls.length,3,'a valid explicit retry must still complete');
});

test('usage HTTP rejects a foreign organisation on the first read without exposing its totals',async t=>{
 const {controller:c,respond,calls}=harness(t);
 respond({...summary(),organisationId:otherOrganisation});await c.load();
 assert.equal(c.summary,undefined);assert.equal(c.loaded,false);assert.equal(c.pending,false);assert.equal(c.error,'unavailable');
 assert.equal(calls.length,1);
});

test('usage HTTP keeps exact signed bytes, decimal counts and freshness through the real parser',async t=>{
 const {controller:c,calls}=harness(t);await c.load();await c.load();
 assert.deepEqual(c.summary,{
  version:1,organisationId,
  storage:{currentBytes:'-9007199254740993',addedBytes:'9007199254740994',removedBytes:'18014398509481987'},
  transfer:{uploadedBytes:'1536',restoredBytes:'2048'},operations:{installationCompleted:'3',monitoringProbes:'4'},
  messages:{sent:'5',failed:'6',expired:'7',cancelled:'8'},
  latestEventAt:'2026-10-28T09:00:00.000Z',measuredThrough:'2026-10-28T09:05:00.000Z',
 });
 assert.equal(c.loaded,true);assert.equal(c.pending,false);assert.equal(c.error,undefined);assert.equal(calls.length,1);
 assert.equal(calls[0]!.url,'/api/account/usage/read');
 assert.equal(calls[0]!.init?.method,'POST');
 assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)),{organisationId});
 assert.equal(new Headers(calls[0]!.init?.headers).get('X-CSRF-Token'),'usage-proof');
});
