import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {TrafficSpool} from '../src/traffic-spool.ts';
import {signTrafficReport,type TrafficReport} from '../src/traffic-report.ts';
async function fixture(t:{after:(fn:()=>Promise<void>)=>void}){
 const directory=await realpath(await mkdtemp(join(tmpdir(),'traffic-cursor-')));t.after(()=>rm(directory,{recursive:true,force:true}));
 const spool=new TrafficSpool({directory,maxBytes:32768});const keys=generateKeyPairSync('ed25519');
 const report:TrafficReport={version:1,audience:'waitron-cloud-remote-traffic',cellId:randomUUID(),gatewayId:randomUUID(),generation:1,processId:randomUUID(),sequence:1,from:'2026-11-01T00:00:00.000Z',until:'2026-11-01T00:00:01.000Z',complete:true,entries:[]};
 const counters=new Map([['route:staff',{ingress:'10',egress:'25'}]]);
 return {directory,spool,report,counters,envelope:signTrafficReport(report,keys.privateKey)};
}
function cursor(spool:TrafficSpool){const value=spool as TrafficSpool&{cursor:()=>Promise<unknown>};assert.equal(typeof value.cursor,'function','strict sampling cursor must exist');return value.cursor();}
function gap(spool:TrafficSpool){const value=spool as TrafficSpool&{markGap:()=>Promise<void>};assert.equal(typeof value.markGap,'function','durable gap marker must exist');return value.markGap();}

test('sampling cursor distinguishes an unused spool from missing initialized state',async t=>{
 const f=await fixture(t);assert.equal(await cursor(f.spool),null);await f.spool.append(f.report,f.envelope,f.counters);await rm(join(f.directory,'checkpoint.json'));
 await assert.rejects(cursor(f.spool),/traffic_spool_unavailable/);await assert.doesNotReject(readFile(join(f.directory,'gap')));assert.equal(await readFile(join(f.directory,'gap'),'utf8'),'incomplete\n');
});
test('sampling cursor retains the saved end and independent counters after acknowledgement',async t=>{
 const f=await fixture(t);await f.spool.append(f.report,f.envelope,f.counters);await f.spool.ack(f.report.processId,1);
 assert.deepEqual(await cursor(f.spool),{processId:f.report.processId,sequence:1,until:f.report.until,counters:f.counters,complete:true});
 const saved=await cursor(f.spool) as {counters:Map<string,{ingress:string;egress:string}>};saved.counters.get('route:staff')!.ingress='999';
 assert.deepEqual((await cursor(f.spool) as typeof saved).counters,f.counters);assert.deepEqual(await f.spool.pending(),[]);
});
test('explicit sampling failure retains pending bytes and permanently marks continuity incomplete',async t=>{
 const f=await fixture(t);await f.spool.append(f.report,f.envelope,f.counters);const before=await readFile(join(f.directory,'checkpoint.json'),'utf8');
 await gap(f.spool);await gap(f.spool);await assert.doesNotReject(readFile(join(f.directory,'gap')));assert.equal(await readFile(join(f.directory,'gap'),'utf8'),'incomplete\n');assert.equal(await readFile(join(f.directory,'checkpoint.json'),'utf8'),before);
 assert.deepEqual(await f.spool.pending(),[f.envelope]);assert.equal((await cursor(f.spool) as {complete:boolean}).complete,false);assert.equal((await f.spool.restore()).complete,false);
});
test('a gap before the first sample cannot become fresh-child completeness',async t=>{
 const f=await fixture(t);await gap(f.spool);await f.spool.append(f.report,f.envelope,f.counters);assert.equal((await cursor(f.spool) as {complete:boolean}).complete,false);
});
