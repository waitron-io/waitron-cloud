import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {chmod,link,mkdir,mkdtemp,readFile,readdir,realpath,rename,rm,symlink,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {test,type TestContext} from 'node:test';
import {TrafficSpool} from '../src/traffic-spool.ts';
import {collectTraffic} from '../src/traffic-collector.ts';
import {signTrafficReport,type TrafficReport} from '../src/traffic-report.ts';
import type {TrafficMapping} from '../src/traffic-coverage.ts';

const keys=generateKeyPairSync('ed25519');
const refused=/^Error: traffic_spool_unavailable$/;
async function fixture(t:TestContext){
 const root=await realpath(await mkdtemp(join(tmpdir(),'cloud-traffic-export-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const directory=join(root,'collector'),privateDirectory=join(root,'spool');await mkdir(directory,{mode:0o2750});await chmod(directory,0o2750);
 const mapping:TrafficMapping={country:'ES',environment:'test',cellId:randomUUID(),directory,writerUid:process.geteuid!(),readerGid:process.getegid!()};
 const report:TrafficReport={version:1,audience:'waitron-cloud-remote-traffic',cellId:mapping.cellId,gatewayId:randomUUID(),generation:1,processId:randomUUID(),sequence:1,
  from:'2026-11-01T00:00:00.000Z',until:'2026-11-01T00:00:01.000Z',complete:true,entries:[]};
 const envelope=signTrafficReport(report,keys.privateKey),text=JSON.stringify(envelope),file=join(directory,`${report.processId}.1.json`);
 const counters=new Map([['generated:staff',{ingress:'9007199254740993',egress:'25'}]]);
 const spool=new TrafficSpool({directory:privateDirectory,maxBytes:32768});await spool.append(report,envelope,counters);
 return {root,mapping,report,envelope,text,file,counters,spool,privateDirectory};
}
function transfer(spool:TrafficSpool,mapping:TrafficMapping){
 assert.equal(typeof spool.transfer,'function','exporter must retain signed bytes until a durably published report is acknowledged');
 return spool.transfer(mapping);
}
const answer=(r:TrafficReport)=>({state:'accepted' as const,processId:r.processId,sequence:r.sequence});

// Removing the durable-publication gate must lose the original pending report before the collector sees it.
test('exporter publishes exact private bytes before waiting for the country acknowledgement',async t=>{
 const f=await fixture(t);await assert.doesNotReject(transfer(f.spool,f.mapping));
 assert.equal(await readFile(f.file,'utf8').catch(()=>null),f.text);assert.deepEqual(await f.spool.pending(),[f.envelope]);
 await transfer(f.spool,f.mapping);assert.equal(await readFile(f.file,'utf8'),f.text);
 await collectTraffic(f.mapping,{async record(){return answer(f.report);}});
 await transfer(new TrafficSpool({directory:f.privateDirectory,maxBytes:32768}),f.mapping);
 assert.deepEqual(await f.spool.pending(),[]);assert.deepEqual(await readdir(f.mapping.directory),[]);
 assert.deepEqual(await f.spool.restore(),{processId:f.report.processId,sequence:1,counters:f.counters,complete:true});
});
test('exporter never treats a never-published missing file as an acknowledgement after restart',async t=>{
 const f=await fixture(t);await transfer(new TrafficSpool({directory:f.privateDirectory,maxBytes:32768}),f.mapping);
 assert.deepEqual(await f.spool.pending(),[f.envelope]);assert.equal(await readFile(f.file,'utf8').catch(()=>null),f.text);
});
test('exporter retains the original envelope through a lost country reply then advances in numeric order',async t=>{
 const f=await fixture(t),second={...f.report,sequence:2,from:f.report.until,until:'2026-11-01T00:00:02.000Z'},e2=signTrafficReport(second,keys.privateKey);
 await f.spool.append(second,e2,f.counters);await transfer(f.spool,f.mapping);
 await assert.rejects(collectTraffic(f.mapping,{async record(){throw Error('private-database-canary');}}),/^Error: traffic_collection_unavailable$/);
 await transfer(f.spool,f.mapping);assert.equal(await readFile(f.file,'utf8'),f.text);assert.deepEqual(await f.spool.pending(),[f.envelope,e2]);
 await assert.rejects(collectTraffic(f.mapping,{async record(_m,envelope){const r=JSON.parse(Buffer.from((envelope as {payload:string}).payload,'base64url').toString());if(r.sequence===2)throw Error('next-country-report-refused');return {...answer(f.report),state:'replay'};}}),/^Error: traffic_collection_unavailable$/);await transfer(f.spool,f.mapping);
 assert.deepEqual(await f.spool.pending(),[e2]);assert.equal(await readFile(join(f.mapping.directory,`${f.report.processId}.2.json`),'utf8'),JSON.stringify(e2));
 await collectTraffic(f.mapping,{async record(){return answer(second);}});await transfer(f.spool,f.mapping);assert.deepEqual(await f.spool.pending(),[]);
});
test('exporter refuses changed collector bytes without overwriting or acknowledging them',async t=>{
 const f=await fixture(t);await transfer(f.spool,f.mapping);
 const changed=JSON.parse(f.text);changed.signature=(changed.signature[0]==='A'?'B':'A')+changed.signature.slice(1);const replacement=JSON.stringify(changed);
 assert.equal(Buffer.byteLength(replacement),Buffer.byteLength(f.text));await writeFile(f.file,replacement);
 await assert.rejects(transfer(f.spool,f.mapping),refused);assert.equal(await readFile(f.file,'utf8'),replacement);assert.deepEqual(await f.spool.pending(),[f.envelope]);
 assert.equal((await f.spool.restore()).complete,false);
});
for(const fault of ['non-test','foreign-cell','foreign-owner','foreign-group','directory-mode','directory-symlink','parent-symlink','directory-replaced','mapping-changed','file-mode','file-symlink','file-hard-link'] as const){
 test(`exporter refuses ${fault} without losing signed retries`,async t=>{
  const f=await fixture(t);let mapping={...f.mapping};
  if(fault==='directory-replaced'||fault==='mapping-changed'||fault.startsWith('file-'))await transfer(f.spool,f.mapping);
  if(fault==='non-test')mapping.environment='production' as 'test';
  if(fault==='foreign-cell')mapping.cellId=randomUUID();
  if(fault==='foreign-owner')mapping.writerUid++;
  if(fault==='foreign-group')mapping.readerGid++;
  if(fault==='directory-mode')await chmod(mapping.directory,0o750);
  if(fault==='directory-symlink'){await rename(mapping.directory,mapping.directory+'-held');await symlink(mapping.directory+'-held',mapping.directory);}
  if(fault==='parent-symlink'){const alias=join(f.root,'alias');await symlink(dirname(mapping.directory),alias);mapping.directory=join(alias,'collector');}
  if(fault==='directory-replaced'){await rename(mapping.directory,mapping.directory+'-held');await mkdir(mapping.directory);await chmod(mapping.directory,0o2750);}
  if(fault==='mapping-changed'){mapping.directory=join(f.root,'other');await mkdir(mapping.directory);await chmod(mapping.directory,0o2750);}
  if(fault==='file-mode')await chmod(f.file,0o644);
  if(fault==='file-symlink'){await rename(f.file,join(f.root,'held'));await symlink(join(f.root,'held'),f.file);}
  if(fault==='file-hard-link')await link(f.file,join(f.root,'held'));
  await assert.rejects(transfer(f.spool,mapping),refused);assert.deepEqual(await f.spool.pending(),[f.envelope]);
 });
}

// Real process exits at each write boundary exercise recovery rather than a mocked spool acknowledgement.
for(const boundary of ['before-export','after-export','before-marker','after-marker','after-ack'] as const){
 test(`exporter restart at ${boundary} preserves replay or the committed acknowledgement`,async t=>{
  const f=await fixture(t);assert.equal(typeof f.spool.transfer,'function','exporter transfer must be implemented');
  if(boundary==='after-ack'){await transfer(f.spool,f.mapping);await collectTraffic(f.mapping,{async record(){return answer(f.report);}});}
  const script=`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
   const rename=fs.promises.rename;fs.promises.rename=async(from,to)=>{
    const stage=process.argv[3],destination=String(to);
    if(destination===process.argv[2]){if(stage==='before-export')process.exit(91);await rename(from,to);if(stage==='after-export')process.exit(92);return;}
    if(destination.endsWith('/delivery.json')){if(stage==='before-marker')process.exit(93);await rename(from,to);if(stage==='after-marker')process.exit(94);return;}
    await rename(from,to);if(stage==='after-ack'&&destination.endsWith('/checkpoint.json'))process.exit(95);
   };syncBuiltinESMExports();const {TrafficSpool}=await import(process.argv[4]);
   await new TrafficSpool({directory:process.argv[1],maxBytes:32768}).transfer(JSON.parse(process.argv[5]));`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script,f.privateDirectory,f.file,boundary,new URL('../src/traffic-spool.ts',import.meta.url).href,JSON.stringify(f.mapping)],{encoding:'utf8',timeout:10000});
  assert.equal(child.status,{'before-export':91,'after-export':92,'before-marker':93,'after-marker':94,'after-ack':95}[boundary],child.stderr);
  const restarted=new TrafficSpool({directory:f.privateDirectory,maxBytes:32768});
  if(boundary==='after-export'||boundary==='before-marker')await collectTraffic(f.mapping,{async record(){return answer(f.report);}});
  await transfer(restarted,f.mapping);
  if(boundary==='after-ack'){assert.deepEqual(await restarted.pending(),[]);assert.deepEqual(await readdir(f.mapping.directory),[]);}
  else{assert.deepEqual(await restarted.pending(),[f.envelope]);assert.equal(await readFile(f.file,'utf8').catch(()=>null),f.text);
   await collectTraffic(f.mapping,{async record(){return {...answer(f.report),state:'replay'};}});await transfer(restarted,f.mapping);assert.deepEqual(await restarted.pending(),[]);}
  assert.equal((await restarted.restore()).complete,false);
 });
}

for(const fault of ['export-write','export-file-sync','adopted-file-sync','export-directory-sync','marker-file-sync','acknowledgement-checkpoint-sync','acknowledgement-directory-sync'] as const){
 test(`exporter ${fault} failure retains the country retry`,async t=>{
  const f=await fixture(t);assert.equal(typeof f.spool.transfer,'function');
  if(fault==='adopted-file-sync'){await writeFile(f.file,f.text,{mode:0o640});await chmod(f.file,0o640);}
  if(fault.startsWith('acknowledgement-')){await transfer(f.spool,f.mapping);await collectTraffic(f.mapping,{async record(){return answer(f.report);}});}
  const script=`import fs from 'node:fs';import assert from 'node:assert/strict';import {syncBuiltinESMExports} from 'node:module';
   const original=fs.promises.open;let reached=false;fs.promises.open=async(path,...args)=>{
    const h=await original(path,...args),kind=process.argv[3],p=String(path);
    if(kind==='export-write'&&p.endsWith('/outgoing.tmp'))h.writeFile=async()=>{reached=true;throw Error('private-canary');};
    if(kind==='export-file-sync'&&p.endsWith('/outgoing.tmp')||kind==='adopted-file-sync'&&p.endsWith('.json')&&!p.startsWith(process.argv[1]+'/')||kind==='export-directory-sync'&&p===process.argv[2]
     ||kind==='marker-file-sync'&&p.endsWith('/delivery.tmp')||kind==='acknowledgement-checkpoint-sync'&&p.endsWith('/checkpoint.tmp')
     ||kind==='acknowledgement-directory-sync'&&p===process.argv[2])h.sync=async()=>{reached=true;throw Error('private-canary');};return h;
   };syncBuiltinESMExports();const {TrafficSpool}=await import(process.argv[4]);
   await assert.rejects(new TrafficSpool({directory:process.argv[1],maxBytes:32768}).transfer(JSON.parse(process.argv[5])),/^Error: traffic_spool_unavailable$/);
   assert.equal(reached,true);`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script,f.privateDirectory,f.mapping.directory,fault,new URL('../src/traffic-spool.ts',import.meta.url).href,JSON.stringify(f.mapping)],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);
  if(fault==='acknowledgement-checkpoint-sync'){
   assert.deepEqual(JSON.parse(await readFile(join(f.privateDirectory,'checkpoint.json'),'utf8')).pending,[f.envelope]);
   assert.deepEqual(await f.spool.pending(),[]);assert.equal((await f.spool.restore()).complete,false);
  }else assert.deepEqual(await f.spool.pending(),[f.envelope]);
  await transfer(f.spool,f.mapping);
  // An uncertain checkpoint fsync may still be recovered, but only after the country has already committed.
  if(fault==='acknowledgement-checkpoint-sync'||fault==='acknowledgement-directory-sync')assert.deepEqual(await f.spool.pending(),[]);
  else{assert.deepEqual(await f.spool.pending(),[f.envelope]);assert.equal(await readFile(f.file,'utf8').catch(()=>null),f.text);}
 });
}
test('exporter snapshots the mapped directory before callers can change their configuration',async t=>{
 const f=await fixture(t),mapping={...f.mapping},pending=transfer(f.spool,mapping);mapping.directory=join(f.root,'private-canary');mapping.cellId=randomUUID();
 await assert.doesNotReject(pending);assert.equal(await readFile(f.file,'utf8').catch(()=>null),f.text);assert.deepEqual(await f.spool.pending(),[f.envelope]);
});
for(const fault of ['marker-symlink','marker-hard-link','marker-mode','marker-digest','marker-sequence','marker-mapping'] as const){
 test(`exporter ${fault} cannot turn a removed file into a country acknowledgement`,async t=>{
  const f=await fixture(t);await transfer(f.spool,f.mapping);await collectTraffic(f.mapping,{async record(){return answer(f.report);}});
  const marker=join(f.privateDirectory,'delivery.json'),held=join(f.root,'held');
  if(fault==='marker-symlink'){await rename(marker,held);await symlink(held,marker);}
  if(fault==='marker-hard-link')await link(marker,held);
  if(fault==='marker-mode')await chmod(marker,0o644);
  if(fault==='marker-digest'||fault==='marker-sequence'||fault==='marker-mapping'){
   const value=JSON.parse(await readFile(marker,'utf8'));
   if(fault==='marker-digest')value.receipts[0].digest='0'.repeat(64);
   if(fault==='marker-sequence')value.receipts[0].sequence=2;
   if(fault==='marker-mapping')value.mapping.cellId=randomUUID();
   await writeFile(marker,JSON.stringify(value));
  }
  await assert.rejects(transfer(f.spool,f.mapping),refused);assert.deepEqual(await f.spool.pending(),[f.envelope]);
 });
}

// One report per collector poll cannot drain a one-second sampler; queued reports must be independently publishable.
test('exporter publishes every pending interval before the collector acknowledges the first',async t=>{
 const f=await fixture(t),second={...f.report,sequence:2,from:f.report.until,until:'2026-11-01T00:00:02.000Z'},e2=signTrafficReport(second,keys.privateKey);
 await f.spool.append(second,e2,f.counters);await transfer(f.spool,f.mapping);
 assert.equal(await readFile(f.file,'utf8').catch(()=>null),f.text);
 assert.equal(await readFile(join(f.mapping.directory,`${f.report.processId}.2.json`),'utf8').catch(()=>null),JSON.stringify(e2));
 assert.deepEqual(await f.spool.pending(),[f.envelope,e2]);
 await collectTraffic(f.mapping,{async record(_m,envelope){const r=JSON.parse(Buffer.from((envelope as {payload:string}).payload,'base64url').toString());return answer(r);}});
 await transfer(f.spool,f.mapping);assert.deepEqual(await f.spool.pending(),[]);assert.deepEqual(await readdir(f.mapping.directory),[]);
});
test('exporter keeps overflow pending within the collectors 4096-file bound and uses the next free slot',async t=>{
 const f=await fixture(t),other=randomUUID();
 for(let n=1;n<=4096;n++)await writeFile(join(f.mapping.directory,`${other}.${n}.json`),'',{mode:0o640});
 await transfer(f.spool,f.mapping);
 assert.equal(await readFile(f.file,'utf8').catch(()=>null),null);assert.equal((await readdir(f.mapping.directory)).length,4096);assert.deepEqual(await f.spool.pending(),[f.envelope]);
 await rm(join(f.mapping.directory,`${other}.1.json`));await transfer(f.spool,f.mapping);
 assert.equal(await readFile(f.file,'utf8').catch(()=>null),f.text);assert.equal((await readdir(f.mapping.directory)).length,4096);assert.deepEqual(await f.spool.pending(),[f.envelope]);
});
