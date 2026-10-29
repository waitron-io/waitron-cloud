import assert from 'node:assert/strict';
import {test} from 'node:test';

const api=await import('../src/traffic-counters.ts').catch((error:NodeJS.ErrnoException)=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return undefined;});
const delta=(a:{ingress:string;egress:string},b:{ingress:string;egress:string})=>{assert.ok(api?.trafficDelta,'trafficDelta is implemented');return api.trafficDelta(a,b);};
const read=(csv:string,backends=new Map([['user_a','route:staff'],['user_b','route:public']]))=>{assert.ok(api?.readTrafficCounters,'readTrafficCounters is implemented');return api.readTrafficCounters(csv,backends);};
const csv='# pxname,svname,bout,bin,\nuser_a,BACKEND,40,100,\nuser_a,server1,999,999,\nuser_b,BACKEND,65,110,\nother,BACKEND,999,999,\n';

// Number conversion, repeated cumulative totals and inferred reset deltas all mismeasure usage.
test('traffic counters are exact deltas and equal snapshots add zero',()=>{
 assert.deepEqual(delta({ingress:'100',egress:'40'},{ingress:'110',egress:'65'}),{ingress:10n,egress:25n});
 assert.deepEqual(delta({ingress:'0',egress:'0'},{ingress:'9007199254740993',egress:'0'}),{ingress:9007199254740993n,egress:0n});
 assert.deepEqual(delta({ingress:'18446744073709551615',egress:'40'},{ingress:'18446744073709551615',egress:'40'}),{ingress:0n,egress:0n});
 assert.deepEqual(delta({ingress:'0',egress:'0'},{ingress:'9223372036854775807',egress:'0'}),{ingress:9223372036854775807n,egress:0n});
});
test('traffic decreases wraps and signed bigint overflow refuse fabricated deltas',()=>{
 for(const [a,b] of [
  [{ingress:'100',egress:'40'},{ingress:'99',egress:'50'}],
  [{ingress:'100',egress:'40'},{ingress:'110',egress:'39'}],
  [{ingress:'18446744073709551615',egress:'0'},{ingress:'0',egress:'0'}],
  [{ingress:'0',egress:'0'},{ingress:'9223372036854775807',egress:'1'}]
 ] as const)assert.throws(()=>delta(a,b),/invalid_traffic_counters/);
});
test('traffic counters reject noncanonical and out of range cumulative quantities',()=>{
 for(const bad of ['01','-1','+1','1.0','1e3',' 1','1\n','18446744073709551616','']){
  assert.throws(()=>delta({ingress:bad,egress:'0'},{ingress:'1',egress:'0'}),/invalid_traffic_counters/);
  assert.throws(()=>delta({ingress:'0',egress:'0'},{ingress:'1',egress:bad}),/invalid_traffic_counters/);
 }
});
test('traffic CSV selects only mapped BACKEND rows by named columns',()=>{
 assert.deepEqual([...read(csv)], [['route:staff',{ingress:'100',egress:'40'}],['route:public',{ingress:'110',egress:'65'}]]);
});
test('traffic CSV missing duplicate malformed and ambiguous rows cannot prove zero use',()=>{
 for(const bad of [csv.replace('user_b,BACKEND,65,110,\n',''),csv+'user_a,BACKEND,40,100,\n',csv.replace('bout,bin','bout,bout'),csv.replace('40,100','40,no'),csv.replace('40,100','40,01'),csv.replace('40,100','40,18446744073709551616')]){
  assert.throws(()=>read(bad),/invalid_traffic_counters/);
 }
 assert.throws(()=>read(csv,new Map([['user_a','same'],['user_b','same']])),/invalid_traffic_counters/);
});
