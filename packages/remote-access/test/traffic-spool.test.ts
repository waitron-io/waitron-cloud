import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtemp,readFile,writeFile,readdir,rm,symlink,chmod,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {signTrafficReport,type TrafficReport} from '../src/traffic-report.ts';

const api=await import('../src/traffic-spool.ts').catch((error:NodeJS.ErrnoException)=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return undefined;});
const keys=generateKeyPairSync('ed25519');
const report=(sequence=1):TrafficReport=>({version:1,audience:'waitron-cloud-remote-traffic',cellId:'00000000-0000-4000-8000-000000000001',gatewayId:'00000000-0000-4000-8000-000000000002',generation:1,processId:'00000000-0000-4000-8000-000000000003',sequence,from:`2026-11-01T00:00:0${sequence-1}.000Z`,until:`2026-11-01T00:00:0${sequence}.000Z`,complete:true,entries:[{installationId:'00000000-0000-4000-8000-000000000004',venueId:'00000000-0000-4000-8000-000000000005',revision:0,routeBinding:'a'.repeat(64),channel:'staff',ingress:'10',egress:'25'}]});
const counters=(ingress='9007199254740993')=>new Map([['generated:staff',{ingress,egress:'40'}]]);
function spool(directory:string,maxBytes=32768){assert.ok(api?.TrafficSpool,'TrafficSpool is implemented');return new api.TrafficSpool({directory,maxBytes});}
async function fixture(t:{after:(fn:()=>Promise<void>)=>void}){const d=await realpath(await mkdtemp(join(tmpdir(),'cloud-traffic-spool-')));t.after(()=>rm(d,{recursive:true,force:true}));return d;}

// Lost acknowledgements must replay the original signed identity, not newly sample cumulative bytes.
test('traffic spool retries original bytes and checkpoint after lost reply and restart',async t=>{
 const d=await fixture(t),a=spool(d),r=report(),e=signTrafficReport(r,keys.privateKey);
 await a.append(r,e,counters());const b=spool(d);
 assert.deepEqual(await b.pending(),[e]);
 assert.deepEqual(await b.restore(),{processId:r.processId,sequence:1,counters:counters(),complete:true});
 await b.append(r,e,counters());assert.deepEqual(await a.pending(),[e]);
 await b.ack(r.processId,1);await a.ack(r.processId,1);assert.deepEqual(await b.pending(),[]);
 assert.deepEqual(await b.restore(),{processId:r.processId,sequence:1,counters:counters(),complete:true});
});
test('traffic spool preserves unacknowledged envelopes at full capacity',async t=>{
 const d=await fixture(t),a=spool(d,2048),r=report(),e=signTrafficReport(r,keys.privateKey);
 await a.append(r,e,counters());
 const next=report(2),nextEnvelope=signTrafficReport(next,keys.privateKey);
 await assert.rejects(a.append(next,nextEnvelope,counters('9007199254740994')),/traffic_spool_unavailable/);
 assert.deepEqual(await spool(d,2048).pending(),[e]);assert.equal((await a.restore()).complete,false);
 assert.equal((await a.restore()).sequence,1);
});
test('traffic spool refuses changed retries unknown processes and skipped sequence without advancing',async t=>{
 const d=await fixture(t),a=spool(d),r=report(),e=signTrafficReport(r,keys.privateKey);await a.append(r,e,counters());
 const changed={...r,complete:false},old={...report(2),processId:'00000000-0000-4000-8000-000000000009'};
 for(const bad of [changed,old,report(3)])await assert.rejects(a.append(bad,signTrafficReport(bad,keys.privateKey),counters()),/traffic_spool_unavailable/);
 await assert.rejects(a.ack(old.processId,1),/traffic_spool_unavailable/);await assert.rejects(a.ack(r.processId,2),/traffic_spool_unavailable/);
 assert.deepEqual(await a.pending(),[e]);assert.equal((await a.restore()).sequence,1);assert.equal((await a.restore()).complete,false);
});
test('traffic spool missing checkpoint and lost final or interval sample cannot prove complete coverage',async t=>{
 const d=await fixture(t),a=spool(d);assert.equal((await a.restore()).complete,false);
 const r=report();await a.append(r,signTrafficReport(r,keys.privateKey),counters());
 const next={...report(2),from:'2026-11-01T00:00:01.500Z'};await a.append(next,signTrafficReport(next,keys.privateKey),counters('9007199254740994'));
 assert.equal((await spool(d).restore()).complete,false);
 await writeFile(join(d,'gap'),'incomplete\n',{mode:0o600});assert.equal((await spool(d).restore()).complete,false);
 await rm(join(d,'checkpoint.json'));assert.equal((await a.restore()).complete,false);
});
test('traffic spool interrupted checkpoint keeps committed retry and records a durable gap',async t=>{
 const d=await fixture(t),a=spool(d),r=report(),e=signTrafficReport(r,keys.privateKey);await a.append(r,e,counters());
 await writeFile(join(d,'checkpoint.tmp'),'{"unfinished":',{mode:0o600});
 assert.equal((await spool(d).restore()).complete,false);assert.deepEqual(await spool(d).pending(),[e]);
 assert.equal((await spool(d).restore()).sequence,1);assert.ok((await readdir(d)).includes('gap'));
});
test('traffic spool recovers a dead owned writer lease but refuses a live competing writer',async t=>{
 const d=await fixture(t),a=spool(d),r=report(),e=signTrafficReport(r,keys.privateKey);await a.append(r,e,counters());
 await writeFile(join(d,'lease.json'),JSON.stringify({pid:process.pid,owner:'live'}),{mode:0o600});
 await assert.rejects(a.ack(r.processId,1),/traffic_spool_unavailable/);assert.deepEqual(JSON.parse(await readFile(join(d,'lease.json'),'utf8')),{pid:process.pid,owner:'live'});
 const child=spawnSync(process.execPath,['-e','process.exit(0)']);assert.equal(child.status,0);
 await writeFile(join(d,'lease.json'),JSON.stringify({pid:child.pid,owner:'dead'}),{mode:0o600});
 assert.deepEqual(await a.pending(),[e]);assert.equal((await a.restore()).complete,false);
 await a.ack(r.processId,1);assert.deepEqual(await a.pending(),[]);assert.equal((await a.restore()).complete,false);
});
test('traffic spool rejects mismatched signed payload malformed counters and unsafe files',async t=>{
 const d=await fixture(t),a=spool(d),r=report(),e=signTrafficReport(r,keys.privateKey);
 await assert.rejects(a.append({...r,complete:false},e,counters()),/traffic_spool_unavailable/);
 await assert.rejects(a.append(r,e,counters('01')),/traffic_spool_unavailable/);
 assert.deepEqual(await a.pending(),[]);
 const outside=join(await fixture(t),'outside');await writeFile(outside,'unchanged');
 await symlink(outside,join(d,'checkpoint.json'));assert.equal((await a.restore()).complete,false);
 await assert.rejects(a.append(r,e,counters()),/traffic_spool_unavailable/);assert.equal(await readFile(outside,'utf8'),'unchanged');
 await rm(join(d,'checkpoint.json'));await chmod(d,0o755);await assert.rejects(a.pending(),/traffic_spool_unavailable/);
});
test('traffic spool survives a complete pending checkpoint interrupted before publication',async t=>{
 const d=await fixture(t),a=spool(d),r=report(),e=signTrafficReport(r,keys.privateKey);await a.append(r,e,counters());
 const checkpoint=await readFile(join(d,'checkpoint.json'));await writeFile(join(d,'checkpoint.tmp'),checkpoint,{mode:0o600});
 await rm(join(d,'checkpoint.json'));
 assert.equal((await spool(d).restore()).complete,false);assert.deepEqual(await spool(d).pending(),[e]);
 assert.deepEqual((await a.restore()).counters,counters());
});
test('traffic spool lost committed checkpoint cannot restart the old stream as new',async t=>{
 const d=await fixture(t),a=spool(d),r=report(),e=signTrafficReport(r,keys.privateKey);await a.append(r,e,counters());
 await rm(join(d,'checkpoint.json'));assert.equal((await a.restore()).complete,false);
 await assert.rejects(a.append(r,e,counters()),/traffic_spool_unavailable/);
 assert.ok((await readdir(d)).includes('gap'));
});
test('traffic spool replays identical envelopes after writer termination at either atomic rename boundary',async t=>{
 for(const stage of ['before','after']){
  const d=await fixture(t),r=report(),e=signTrafficReport(r,keys.privateKey);
  const script=`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
   const rename=fs.promises.rename;fs.promises.rename=async(from,to)=>{if(String(from).endsWith('/checkpoint.tmp')){if(process.argv[2]==='before')process.exit(91);await rename(from,to);process.exit(92);}return rename(from,to);};syncBuiltinESMExports();
   const {TrafficSpool}=await import(process.argv[3]);const envelope=JSON.parse(process.argv[4]);
   await new TrafficSpool({directory:process.argv[1],maxBytes:32768}).append(JSON.parse(Buffer.from(envelope.payload,'base64url')),envelope,new Map([['generated:staff',{ingress:'9007199254740993',egress:'40'}]]));`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script,d,stage,new URL('../src/traffic-spool.ts',import.meta.url).href,JSON.stringify(e)],{encoding:'utf8',timeout:10000});
  assert.equal(child.status,stage==='before'?91:92,child.stderr);
  const restored=await spool(d).restore();assert.equal(restored.complete,false);assert.equal(restored.processId,r.processId);assert.equal(restored.sequence,1);assert.deepEqual(restored.counters,counters());
  assert.deepEqual(await spool(d).pending(),[e]);await spool(d).ack(r.processId,1);assert.deepEqual(await spool(d).pending(),[]);
 }
});
test('traffic spool never acknowledges sync failure and recovery syncs before publication',async t=>{
 for(const stage of ['checkpoint','directory','recovery']){
  const d=await fixture(t),r=report(),e=signTrafficReport(r,keys.privateKey);
  if(stage==='recovery'){
   await spool(d).append(r,e,counters());const state=await readFile(join(d,'checkpoint.json'));
   await writeFile(join(d,'checkpoint.tmp'),state,{mode:0o600});await rm(join(d,'checkpoint.json'));
  }
  const script=`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
   const original=fs.promises.open;fs.promises.open=async(path,...args)=>{const h=await original(path,...args);if(process.argv[2]==='directory'?String(path)===process.argv[1]:String(path).endsWith('/checkpoint.tmp'))h.sync=async()=>{throw Error('simulated_sync_failure');};return h;};syncBuiltinESMExports();
   const {TrafficSpool}=await import(process.argv[3]);const spool=new TrafficSpool({directory:process.argv[1],maxBytes:32768});
   if(process.argv[2]==='recovery'){const state=await spool.restore();console.log(JSON.stringify({sequence:state.sequence,complete:state.complete}));}
   else{const envelope=JSON.parse(process.argv[4]);try{await spool.append(JSON.parse(Buffer.from(envelope.payload,'base64url')),envelope,new Map([['generated:staff',{ingress:'9007199254740993',egress:'40'}]]));console.log('acknowledged');}catch{console.log('refused');}}`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script,d,stage,new URL('../src/traffic-spool.ts',import.meta.url).href,JSON.stringify(e)],{encoding:'utf8',timeout:10000});
  assert.equal(child.status,0,child.stderr);
  if(stage==='recovery')assert.deepEqual(JSON.parse(child.stdout),{sequence:0,complete:false});else assert.equal(child.stdout.trim(),'refused');
  assert.equal((await spool(d).restore()).complete,false);
 }
});
test('traffic spool never reads a valid checkpoint through a symlink or hard link',async t=>{
 const {link}=await import('node:fs/promises');
 for(const hard of [false,true]){
  const d=await fixture(t),a=spool(d),r=report(),e=signTrafficReport(r,keys.privateKey);await a.append(r,e,counters());
  const bytes=await readFile(join(d,'checkpoint.json'),'utf8'),outside=join(await fixture(t),'outside');await writeFile(outside,bytes,{mode:0o600});
  await rm(join(d,'checkpoint.json'));if(hard)await link(outside,join(d,'checkpoint.json'));else await symlink(outside,join(d,'checkpoint.json'));
  assert.equal((await a.restore()).complete,false);await assert.rejects(a.ack(r.processId,1),/traffic_spool_unavailable/);
  assert.equal(await readFile(outside,'utf8'),bytes);
 }
});
