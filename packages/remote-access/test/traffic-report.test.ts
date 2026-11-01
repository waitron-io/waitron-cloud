import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {test} from 'node:test';
import type {TrafficReport} from '../src/traffic-report.ts';

const api=await import('../src/traffic-report.ts').catch((error:NodeJS.ErrnoException)=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return undefined;});
const keys=generateKeyPairSync('ed25519'),foreign=generateKeyPairSync('ed25519');
const report=():TrafficReport=>({version:1,audience:'waitron-cloud-remote-traffic',cellId:'00000000-0000-4000-8000-000000000001',gatewayId:'00000000-0000-4000-8000-000000000002',generation:1,processId:'00000000-0000-4000-8000-000000000003',sequence:1,from:'2026-10-31T23:59:59.000Z',until:'2026-11-01T00:00:00.000Z',complete:true,entries:[{installationId:'00000000-0000-4000-8000-000000000004',venueId:'00000000-0000-4000-8000-000000000005',revision:0,routeBinding:'a'.repeat(64),channel:'staff',ingress:'10',egress:'25'}]});
const signed=(value=report())=>{assert.ok(api?.signTrafficReport,'signTrafficReport is implemented');return api.signTrafficReport(value,keys.privateKey);};
const verify=(value:unknown,key=keys.publicKey)=>{assert.ok(api?.verifyTrafficReport,'verifyTrafficReport is implemented');return api.verifyTrafficReport(value,key);};

// A distinct audience and strict aggregate-only shape prevent health/content reports becoming usage.
test('traffic report signs exact deltas and midnight belongs to the interval end day',()=>{
 const value=report();value.entries[0]!.ingress='9007199254740993';
 const envelope=signed(value);assert.deepEqual(verify(envelope),value);
 assert.equal(verify(envelope).until.slice(0,10),'2026-11-01');
 assert.deepEqual(signed({...value,entries:value.entries.map(e=>({...e}))}),envelope);
});
test('traffic signature rejects changed bytes keys audiences and noncanonical envelopes',()=>{
 const envelope=signed();assert.throws(()=>verify(envelope,foreign.publicKey),/invalid_traffic_report/);
 assert.throws(()=>verify({...envelope,payload:envelope.payload.slice(0,-1)+'A'}),/invalid_traffic_report/);
 const alteredSignature=Buffer.from(envelope.signature,'base64url');alteredSignature[0]=alteredSignature[0]!^1;
 assert.throws(()=>verify({...envelope,signature:alteredSignature.toString('base64url')}),/invalid_traffic_report/);
 assert.throws(()=>verify({...envelope,extra:true}),/invalid_traffic_report/);
 for(const value of [{...report(),audience:'waitron-cloud-public-forward-report'},{...report(),url:'/orders'}, {...report(),entries:[{...report().entries[0],headers:{cookie:'private'}}]}]){
  const payload=Buffer.from(JSON.stringify(value));
  assert.throws(()=>verify({payload:payload.toString('base64url'),signature:sign(null,payload,keys.privateKey).toString('base64url')}),/invalid_traffic_report/);
 }
 const canonical=Buffer.from(envelope.payload,'base64url').toString();
 for(const raw of [canonical.replace('waitron-cloud-remote-traffic','waitron-cloud-public-forward-report'),canonical.replace(',"version":1}',',"url":"/orders","version":1}'),canonical.replace(',"ingress":',',"headers":{"cookie":"private"},"ingress":')]){
  const payload=Buffer.from(raw);assert.notEqual(payload.toString('base64url'),envelope.payload);
  assert.throws(()=>verify({payload:payload.toString('base64url'),signature:sign(null,payload,keys.privateKey).toString('base64url')}),/invalid_traffic_report/);
 }
});
test('traffic report refuses invalid bounds timestamps identities and content before signing',()=>{
 const base=report();
 const invalid:unknown[]=[{...base,version:2},{...base,content:'secret'},{...base,complete:'true'}, {...base,cellId:'bad'}, {...base,processId:'bad'}, {...base,generation:0}, {...base,sequence:0}, {...base,sequence:9007199254740992}, {...base,until:base.from}, {...base,from:'2026-10-31T23:59:59Z'}, {...base,until:'2026-11-01T01:00:00.000+01:00'}, {...base,entries:Array(129).fill(base.entries[0])}, {...base,entries:[base.entries[0],base.entries[0]]}];
 for(const field of ['url','headers','content'])invalid.push({...base,entries:[{...base.entries[0],[field]:'x'}]});
 for(const [field,value] of [['ingress','01'],['egress','-1'],['ingress','9223372036854775808'],['egress','9223372036854775800'],['routeBinding','bad'],['revision',-1],['channel','operational'],['venueId','bad']])invalid.push({...base,entries:[{...base.entries[0],[field as string]:value}]});
 invalid.push({...base,entries:[{...base.entries[0],ingress:'0'.repeat(262144)}]});
 for(const value of invalid)assert.throws(()=>signed(value as TrafficReport),/invalid_traffic_report/);
});
test('traffic report binds both channels to the same route and allows zero coverage intervals',()=>{
 const value=report();value.entries.push({...value.entries[0]!,channel:'public',ingress:'0',egress:'0'});
 assert.deepEqual(verify(signed(value)),value);
 for(const patch of [{venueId:'00000000-0000-4000-8000-000000000006'},{revision:1},{routeBinding:'b'.repeat(64)}]){
  assert.throws(()=>signed({...value,entries:[value.entries[0]!,{...value.entries[1]!,...patch}]}),/invalid_traffic_report/);
 }
 assert.deepEqual(verify(signed({...report(),entries:[],complete:false})).entries,[]);
});
test('traffic report permits exactly sixty four routes with both channels and refuses a sixty fifth',()=>{
 const value=report();value.entries=[];
 for(let n=1;n<=64;n++)for(const channel of ['staff','public'] as const)value.entries.push({...report().entries[0]!,installationId:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,venueId:`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`,channel});
 assert.equal(verify(signed(value)).entries.length,128);
 const onePerRoute=value.entries.filter(e=>e.channel==='staff');onePerRoute.push({...report().entries[0]!,installationId:'20000000-0000-4000-8000-000000000065',venueId:'30000000-0000-4000-8000-000000000065'});
 assert.throws(()=>signed({...value,entries:onePerRoute}),/invalid_traffic_report/);
 assert.throws(()=>verify({payload:'A'.repeat(262145),signature:'A'.repeat(86)}),/invalid_traffic_report/);
});
