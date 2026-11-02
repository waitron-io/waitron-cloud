import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {TrafficSpool} from '../src/traffic-spool.ts';
import {signManifest,type ReportingGatewayManifest} from '../src/manifest.ts';
import {verifyTrafficReport} from '../src/traffic-report.ts';

const api=await import(new URL('../src/traffic-sampler.ts',import.meta.url).href).catch((error:NodeJS.ErrnoException)=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return undefined;});
const startedAt='2026-11-01T23:59:59.000Z',first='2026-11-02T00:00:00.000Z',second='2026-11-02T00:00:01.000Z';
async function fixture(t:{after:(fn:()=>Promise<void>)=>void},fresh=true){
 const directory=await realpath(await mkdtemp(join(tmpdir(),'traffic-sampler-')));t.after(()=>rm(directory,{recursive:true,force:true}));
 const issuer=generateKeyPairSync('ed25519'),keys=generateKeyPairSync('ed25519'),cellId=randomUUID(),processId=randomUUID();
 const route={installationId:randomUUID(),venueId:randomUUID(),revision:7,staffHostname:'staff.sol.example.test',publicHostname:'sol.example.test',address:'10.77.0.2',port:443,peerPublicKey:randomBytes(32).toString('base64')};
 const manifest:ReportingGatewayManifest={version:2,audience:'waitron-cloud-gateway',cellId,sequence:1,issuedAt:Date.parse(startedAt),expiresAt:Date.parse(startedAt)+600000,reporter:{gatewayId:randomUUID(),generation:2},routes:[route]};
 const spool=new TrafficSpool({directory,maxBytes:32768});
 const options={spool,envelope:signManifest(manifest,issuer.privateKey,Date.parse(startedAt)),issuerKey:issuer.publicKey,cellId,processId,startedAt,key:keys.privateKey,fresh};
 const sampler=(change:Record<string,unknown>={})=>{assert.equal(typeof api?.TrafficSampler,'function','TrafficSampler must exist');return new api!.TrafficSampler({...options,...change});};
 const csv=(ingress='10',egress='25',publicIngress='0',publicEgress='0')=>`# svname,bout,pxname,bin,type\nBACKEND,${egress},traffic_user_staff_${route.installationId.replaceAll('-','')},${ingress},1\nBACKEND,${publicEgress},traffic_user_public_${route.installationId.replaceAll('-','')},${publicIngress},1\nBACKEND,999,traffic_ops_staff_${route.installationId.replaceAll('-','')},999,1\nBACKEND,999,public_gate,999,1\nFRONTEND,999,traffic_user_staff_${route.installationId.replaceAll('-','')},999,0`;
 return {directory,keys,issuer,manifest,spool,options,sampler,csv,route,processId};
}

test('fresh child counts only mapped outer user backends and attributes the whole interval to its end',async t=>{
 const f=await fixture(t);await f.sampler().sample(f.csv(),first);
 const pending=await f.spool.pending();assert.equal(pending.length,1);const report=verifyTrafficReport(pending[0],f.keys.publicKey);
 assert.equal(report.processId,f.processId);assert.equal(report.generation,2);assert.equal(report.sequence,1);assert.equal(report.from,startedAt);assert.equal(report.until,first);assert.equal(report.complete,true);
 assert.deepEqual(report.entries.map(e=>({channel:e.channel,ingress:e.ingress,egress:e.egress,revision:e.revision,venueId:e.venueId})),[
  {channel:'staff',ingress:'10',egress:'25',revision:7,venueId:f.route.venueId},{channel:'public',ingress:'0',egress:'0',revision:7,venueId:f.route.venueId}]);
});

test('restart resumes the saved end and exact bigint counters after every envelope was acknowledged',async t=>{
 const f=await fixture(t);await f.sampler().sample(f.csv('9007199254740993','25'),first);await f.spool.ack(f.processId,1);
 await f.sampler({fresh:false}).sample(f.csv('9007199254741003','50','3','4'),second);
 const reports=await f.spool.pending();assert.equal(reports.length,1);const r=verifyTrafficReport(reports[0],f.keys.publicKey);
 assert.equal(r.sequence,2);assert.equal(r.from,first);assert.equal(r.until,second);assert.equal(r.complete,true);
 assert.deepEqual(r.entries.map(e=>[e.ingress,e.egress]),[['10','25'],['3','4']]);
});

test('unknown child establishes an incomplete zero baseline rather than counting historical bytes',async t=>{
 const f=await fixture(t,false),sampler=f.sampler();await sampler.sample(f.csv('100','200'),first);await sampler.sample(f.csv('110','225'),second);
 const reports=(await f.spool.pending()).map(e=>verifyTrafficReport(e,f.keys.publicKey));assert.deepEqual(reports.map(r=>r.complete),[false,false]);
 assert.deepEqual(reports.map(r=>r.entries.map(e=>[e.ingress,e.egress])),[[['0','0'],['0','0']],[['10','25'],['0','0']]]);
});

test('concurrent sampler calls commit ordered intervals without sharing a stale baseline',async t=>{
 const f=await fixture(t),sampler=f.sampler();await assert.doesNotReject(Promise.all([sampler.sample(f.csv(),first),sampler.sample(f.csv('20','50'),second)]));
 const reports=(await f.spool.pending()).map(e=>verifyTrafficReport(e,f.keys.publicKey));assert.deepEqual(reports.map(r=>[r.sequence,r.from,r.until]),[[1,startedAt,first],[2,first,second]]);
 assert.deepEqual(reports.map(r=>r.entries[0]?.ingress),['10','10']);assert.equal((await f.spool.restore()).complete,true);
});

for(const fault of ['missing','duplicate','reset','overflow','invalid','clock','same-time'])test(`sampler ${fault} refuses without advancing and leaves a durable gap`,async t=>{
 const f=await fixture(t),sampler=f.sampler();await sampler.sample(f.csv(),first);const before=await readFile(join(f.directory,'checkpoint.json'),'utf8');
 let csv=f.csv('20','50'),until=second;
 if(fault==='missing')csv=csv.split('\n').filter(line=>!line.includes('traffic_user_public_')).join('\n');
 if(fault==='duplicate')csv+='\n'+csv.split('\n')[1];
 if(fault==='reset')csv=f.csv('9','25');
 if(fault==='overflow')csv=f.csv('9223372036854775818','25');
 if(fault==='invalid')csv=f.csv('x','25');
 if(fault==='clock')until=startedAt;
 if(fault==='same-time')until=first;
 await assert.rejects(sampler.sample(csv,until),/^Error: traffic_sampling_unavailable$/);
 assert.equal(await readFile(join(f.directory,'checkpoint.json'),'utf8'),before);await assert.doesNotReject(readFile(join(f.directory,'gap')));assert.equal(await readFile(join(f.directory,'gap'),'utf8'),'incomplete\n');assert.equal((await f.spool.restore()).complete,false);
 await f.sampler({fresh:false}).sample(f.csv('30','60'),'2026-11-02T00:00:02.000Z');
 assert.equal(verifyTrafficReport((await f.spool.pending())[1],f.keys.publicKey).complete,false);
});

test('sampler refuses a foreign child cursor and preserves its pending envelopes',async t=>{
 const f=await fixture(t);await f.sampler().sample(f.csv(),first);const pending=await f.spool.pending();
 await assert.rejects(f.sampler({processId:randomUUID()}).sample(f.csv('20','50'),second),/^Error: traffic_sampling_unavailable$/);
 assert.deepEqual(await f.spool.pending(),pending);assert.equal((await f.spool.restore()).complete,false);
});

test('sampler never converts a lost initialized checkpoint into a fresh zero baseline',async t=>{
 const f=await fixture(t);await f.sampler().sample(f.csv(),first);await rm(join(f.directory,'checkpoint.json'));
 await assert.rejects(f.sampler().sample(f.csv('20','50'),second),/^Error: traffic_sampling_unavailable$/);
 await assert.rejects(readFile(join(f.directory,'checkpoint.json')),/ENOENT/);await assert.doesNotReject(readFile(join(f.directory,'gap')));assert.equal(await readFile(join(f.directory,'gap'),'utf8'),'incomplete\n');
});

test('sampler snapshots mutable input and refuses changed route counters on restart',async t=>{
 const f=await fixture(t),sampler=f.sampler();f.manifest.routes.length=0;await sampler.sample(f.csv(),first);
 const r=verifyTrafficReport((await f.spool.pending())[0],f.keys.publicKey);assert.equal(r.entries.length,2);
 const state=JSON.parse(await readFile(join(f.directory,'checkpoint.json'),'utf8'));state.counters[0][0]='foreign:staff';await writeFile(join(f.directory,'checkpoint.json'),JSON.stringify(state));
 await assert.rejects(f.sampler().sample(f.csv('20','50'),second),/^Error: traffic_sampling_unavailable$/);assert.equal((await f.spool.restore()).complete,false);
});

for(const fault of ['forged','foreign','legacy','expired','public-key','process','date','fresh-flag'])test(`sampler construction rejects ${fault}`,async t=>{
 const f=await fixture(t);let change:Record<string,unknown>={};
 if(fault==='forged')change={envelope:{...f.options.envelope,signature:'A'.repeat(86)}};
 if(fault==='foreign')change={cellId:randomUUID()};
 if(fault==='legacy'){
  const {reporter:_,...m}=f.manifest;const {revision:__,...r}=f.route;
  change={envelope:signManifest({...m,version:1,routes:[r]},f.issuer.privateKey,Date.parse(startedAt))};
 }
 if(fault==='expired')change={startedAt:'2026-11-02T00:10:00.000Z'};
 if(fault==='public-key')change={key:f.keys.publicKey};
 if(fault==='process')change={processId:'not-a-uuid'};
 if(fault==='date')change={startedAt:'2026-11-01'};
 if(fault==='fresh-flag')change={fresh:'true'};
 assert.equal(typeof api?.TrafficSampler,'function','TrafficSampler must exist');assert.throws(()=>f.sampler(change),/^Error: traffic_sampling_unavailable$/);assert.deepEqual(await f.spool.pending(),[]);
});

test('unchanged cumulative counters emit a complete zero interval',async t=>{
 const f=await fixture(t),sampler=f.sampler();await sampler.sample(f.csv(),first);await sampler.sample(f.csv(),second);
 const r=verifyTrafficReport((await f.spool.pending())[1],f.keys.publicKey);assert.equal(r.complete,true);assert.deepEqual(r.entries.map(e=>[e.ingress,e.egress]),[['0','0'],['0','0']]);
});

test('empty signed routes emit a signed empty receipt instead of inventing venue usage',async t=>{
 const f=await fixture(t);const manifest={...f.manifest,routes:[]},envelope=signManifest(manifest,f.issuer.privateKey,Date.parse(startedAt));
 await f.sampler({envelope}).sample('# pxname,svname,bin,bout\n',first);
 const r=verifyTrafficReport((await f.spool.pending())[0],f.keys.publicKey);assert.deepEqual(r.entries,[]);assert.equal(r.complete,true);
});

test('full spool refuses the next sample without advancing or dropping pending signed bytes',async t=>{
 const f=await fixture(t),spool=new TrafficSpool({directory:f.directory,maxBytes:2048}),sampler=f.sampler({spool});await sampler.sample(f.csv(),first);
 const before=await readFile(join(f.directory,'checkpoint.json'),'utf8'),pending=await spool.pending();
 await assert.rejects(sampler.sample(f.csv('20','50'),second),/^Error: traffic_sampling_unavailable$/);
 assert.equal(await readFile(join(f.directory,'checkpoint.json'),'utf8'),before);assert.deepEqual(await spool.pending(),pending);assert.equal((await spool.restore()).complete,false);
});

test('a failure before any sample leaves the child unable to claim a fresh complete history',async t=>{
 const f=await fixture(t),sampler=f.sampler();await assert.rejects(sampler.sample('malformed',first),/^Error: traffic_sampling_unavailable$/);
 await assert.rejects(f.sampler().sample(f.csv(),second),/^Error: traffic_sampling_unavailable$/);assert.deepEqual(await f.spool.pending(),[]);await assert.doesNotReject(readFile(join(f.directory,'gap')));assert.equal(await readFile(join(f.directory,'gap'),'utf8'),'incomplete\n');
});

test('sampler refuses a cursor with an extra unmapped counter rather than losing its binding',async t=>{
 const f=await fixture(t);await f.sampler().sample(f.csv(),first);const state=JSON.parse(await readFile(join(f.directory,'checkpoint.json'),'utf8'));state.counters.push(['foreign:staff',{ingress:'0',egress:'0'}]);await writeFile(join(f.directory,'checkpoint.json'),JSON.stringify(state));
 const before=await readFile(join(f.directory,'checkpoint.json'),'utf8');await assert.rejects(f.sampler().sample(f.csv('20','50'),second),/^Error: traffic_sampling_unavailable$/);
 assert.equal(await readFile(join(f.directory,'checkpoint.json'),'utf8'),before);
});

test('sampler cannot adopt saved intervals from before the recorded child start',async t=>{
 const f=await fixture(t);await f.sampler().sample(f.csv(),first);
 await assert.rejects(f.sampler({startedAt:second}).sample(f.csv('20','50'),'2026-11-02T00:00:02.000Z'),/^Error: traffic_sampling_unavailable$/);
 assert.equal((await f.spool.pending()).length,1);
});

async function socketFixture(t:{after:(fn:()=>Promise<void>)=>void},f:Awaited<ReturnType<typeof fixture>>,responses:string[]){
 const {createServer}=await import('node:net'),{chmod}=await import('node:fs/promises');let requests=0;
 const path=join(f.directory,'stats.sock'),server=createServer(socket=>socket.on('data',data=>{assert.equal(data.toString(),'show stat\n');const response=responses[requests++];assert.ok(response!==undefined,'fixture must provide every socket reply');socket.end(response);}));
 await new Promise<void>(resolve=>server.listen(path,resolve));await chmod(path,0o600);t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
 return {path,requests:()=>requests};
}

test('socket sampling signs real private replies using the clock after each completed read',async t=>{
 const f=await fixture(t),server=await socketFixture(t,f,[f.csv(),f.csv('20','50')]),sampler=f.sampler();
 assert.equal(typeof sampler.sampleSocket,'function','sampler must consume the private socket');
 let clockCalls=0;const clock=()=>{clockCalls++;assert.equal(server.requests(),clockCalls,'interval end must be observed after this reply');return Date.parse(clockCalls===1?first:second);};
 await assert.doesNotReject(Promise.all([sampler.sampleSocket(server.path,clock),sampler.sampleSocket(server.path,clock)]));
 const reports=(await f.spool.pending()).map(e=>verifyTrafficReport(e,f.keys.publicKey));
 assert.deepEqual(reports.map(r=>[r.sequence,r.from,r.until,r.entries[0]?.ingress]),[[1,startedAt,first,'10'],[2,first,second,'10']]);
});

test('socket failure preserves the cursor and marks future sampling incomplete',async t=>{
 const f=await fixture(t),sampler=f.sampler();await sampler.sample(f.csv(),first);const before=await readFile(join(f.directory,'checkpoint.json'),'utf8');
 assert.equal(typeof sampler.sampleSocket,'function','sampler must record failed socket reads');
 await assert.rejects(sampler.sampleSocket(join(f.directory,'absent.sock'),()=>Date.parse(second)),/^Error: traffic_sampling_unavailable$/);
 assert.equal(await readFile(join(f.directory,'checkpoint.json'),'utf8'),before);assert.equal((await f.spool.restore()).complete,false);
 await sampler.sample(f.csv('20','50'),second);assert.equal(verifyTrafficReport((await f.spool.pending())[1],f.keys.publicKey).complete,false);
});
