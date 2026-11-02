import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {chmod,link,mkdir,mkdtemp,readFile,realpath,rename,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {signManifest,type ReportingGatewayManifest,type ManifestEnvelope} from '../src/manifest.ts';
import {signTrafficLifecycle,trafficManifestDigest,verifyTrafficLifecycle} from '../src/traffic-lifecycle.ts';
import {TrafficSpool} from '../src/traffic-spool.ts';
import {signTrafficReport,type TrafficReport} from '../src/traffic-report.ts';

const api=await import(new URL('../src/traffic-child-journal.ts',import.meta.url).href).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return undefined;});
const startedAt='2026-11-02T00:00:00.000Z',until='2026-11-02T00:00:01.000Z';
const unavailable=/^Error: traffic_child_journal_unavailable$/;
async function fixture(t:{after:(fn:()=>Promise<void>)=>void}){
 const root=await realpath(await mkdtemp(join(tmpdir(),'traffic-child-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const issuer=generateKeyPairSync('ed25519'),reporter=generateKeyPairSync('ed25519'),cellId=randomUUID(),processId=randomUUID();
 const manifest:ReportingGatewayManifest={version:2,audience:'waitron-cloud-gateway',cellId,sequence:7,issuedAt:Date.parse(startedAt),expiresAt:Date.parse(startedAt)+600000,
  reporter:{gatewayId:randomUUID(),generation:3},routes:[]};
 const directory=join(root,'journal'),spool=new TrafficSpool({directory:join(root,'spool'),maxBytes:32768});
 const options={directory,country:'ES',environment:'test',cellId,issuerKey:issuer.publicKey,reporterKey:reporter.privateKey};
 const journal=(change:Record<string,unknown>={})=>{assert.equal(typeof api?.TrafficChildJournal,'function','durable child journal must exist');return new api!.TrafficChildJournal({...options,...change});};
 const input:{manifest:ManifestEnvelope;processId:string;startedAt:string;predecessorId:string|null}={manifest:signManifest(manifest,issuer.privateKey,Date.parse(startedAt)),processId,startedAt,predecessorId:null};
 const append=async(change:Partial<TrafficReport>={})=>{
  const report:TrafficReport={version:1,audience:'waitron-cloud-remote-traffic',cellId,gatewayId:manifest.reporter.gatewayId,generation:3,processId,sequence:1,from:startedAt,until,complete:true,entries:[],...change};
  await spool.append(report,signTrafficReport(report,reporter.privateKey),new Map());
 };
 return {root,directory,issuer,reporter,manifest,options,journal,input,processId,cellId,spool,append};
}

// Losing preparation, closing without final coverage, or acknowledging before commit must fail these checks.
test('preparation persists authenticated manifest and exact signed start before returning',async t=>{
 const f=await fixture(t),journal=f.journal(),envelope=await journal.prepare(f.input);
 const start=verifyTrafficLifecycle(envelope,f.reporter.publicKey);
 assert.deepEqual(start,{version:1,audience:'waitron-cloud-remote-traffic-lifecycle',kind:'start',cellId:f.cellId,gatewayId:f.manifest.reporter.gatewayId,generation:3,
  processId:f.processId,manifestDigest:trafficManifestDigest(f.manifest),startedAt,predecessorId:null,endedAt:null,finalSequence:null});
 const saved=JSON.parse(await readFile(join(f.directory,'prepared.json'),'utf8'));
 assert.deepEqual(saved,{version:1,manifest:f.input.manifest,start:envelope});
 assert.deepEqual(await f.journal().pending(),[envelope]);
 assert.deepEqual(await f.journal().prepare(f.input),envelope);
});

test('unknown or crashed child remains unclosed across recovery',async t=>{
 const f=await fixture(t),start=await f.journal().prepare(f.input);
 assert.deepEqual(await f.journal().restore(),{manifest:f.input.manifest,start,end:null});
 await assert.rejects(f.journal().finish(f.spool,until),unavailable);
 assert.deepEqual(await f.journal().pending(),[start]);
 await assert.rejects(readFile(join(f.directory,'end.json')),/ENOENT/);
});

test('complete saved final sample binds signed end and exact retries survive acknowledgement',async t=>{
 const f=await fixture(t),journal=f.journal(),start=await journal.prepare(f.input);await f.append();
 const end=await journal.finish(f.spool,until),value=verifyTrafficLifecycle(end,f.reporter.publicKey);
 assert.equal(value.kind,'end');assert.equal(value.endedAt,until);assert.equal(value.finalSequence,1);assert.equal(value.processId,f.processId);
 assert.deepEqual(await f.journal().pending(),[start,end]);
 await journal.flush(async(envelope:unknown)=>{verifyTrafficLifecycle(envelope,f.reporter.publicKey);});
 assert.deepEqual(await f.journal().pending(),[]);assert.deepEqual(await f.journal().finish(f.spool,until),end);
 assert.deepEqual(await f.journal().restore(),{manifest:f.input.manifest,start,end});
});

test('lost country reply retains identical bytes and never delivers end ahead of start',async t=>{
 const f=await fixture(t),journal=f.journal(),start=await journal.prepare(f.input);await f.append();const end=await journal.finish(f.spool,until);
 const committed:string[]=[];let lost=true;
 const country=async(envelope:{payload:string;signature:string})=>{
  const value=verifyTrafficLifecycle(envelope,f.reporter.publicKey);committed.push(value.kind);
  if(lost){lost=false;throw new Error('lost acknowledgement');}
 };
 await assert.rejects(journal.flush(country),unavailable);assert.deepEqual(committed,['start']);assert.deepEqual(await f.journal().pending(),[start,end]);
 await f.journal().flush(country);assert.deepEqual(committed,['start','start','end']);assert.deepEqual(await journal.pending(),[]);
});

test('failed end receipt preserves its retry while an accepted start stays acknowledged',async t=>{
 const f=await fixture(t),journal=f.journal();await journal.prepare(f.input);await f.append();const end=await journal.finish(f.spool,until);
 await assert.rejects(journal.flush(async(e:unknown)=>{if(verifyTrafficLifecycle(e,f.reporter.publicKey).kind==='end')throw new Error('rollback');}),unavailable);
 assert.deepEqual(await f.journal().pending(),[end]);
});

test('overlapping flush calls serialize durable acknowledgements',async t=>{
 const f=await fixture(t),journal=f.journal();await journal.prepare(f.input);let release!:()=>void,entered!:()=>void;
 let secondEntered!:()=>void;const concurrent=new Promise<void>(r=>{secondEntered=r;});
 const waiting=new Promise<void>(r=>{release=r;}),began=new Promise<void>(r=>{entered=r;});let calls=0;
 const country=async()=>{calls++;entered();if(calls>1)secondEntered();await waiting;};
 const first=journal.flush(country);await began;const second=journal.flush(country);
 try{await Promise.race([concurrent,new Promise<void>(r=>setTimeout(r,200))]);assert.equal(calls,1);}
 finally{release();await Promise.all([first,second]);}
 assert.equal(calls,1);assert.deepEqual(await journal.pending(),[]);
});

for(const fault of ['gap','foreign-process','foreign-reporter','foreign-cell','foreign-generation','wrong-key','wrong-boundary','incomplete','already-acknowledged','advanced-cursor','advanced-sequence','before-start'])test(`final ${fault} never closes the child`,async t=>{
 const f=await fixture(t),journal=f.journal();await journal.prepare(f.input);
 if(fault==='wrong-key'){
  const report:TrafficReport={version:1,audience:'waitron-cloud-remote-traffic',cellId:f.cellId,gatewayId:f.manifest.reporter.gatewayId,generation:3,processId:f.processId,sequence:1,from:startedAt,until,complete:true,entries:[]};
  await f.spool.append(report,signTrafficReport(report,generateKeyPairSync('ed25519').privateKey),new Map());
 }else await f.append(fault==='foreign-process'?{processId:randomUUID()}:fault==='foreign-reporter'?{gatewayId:randomUUID()}:fault==='foreign-cell'?{cellId:randomUUID()}:fault==='foreign-generation'?{generation:4}:fault==='incomplete'?{complete:false}:fault==='before-start'?{from:'2026-11-01T23:59:59.000Z'}:{});
 if(fault==='gap')await f.spool.markGap();
 if(fault==='already-acknowledged')await f.spool.ack(f.processId,1);
 if(fault==='advanced-cursor'||fault==='advanced-sequence'){
  const path=join(f.root,'spool','checkpoint.json'),state=JSON.parse(await readFile(path,'utf8'));
  if(fault==='advanced-cursor')state.until='2026-11-02T00:00:02.000Z';else state.sequence=2;
  await writeFile(path,JSON.stringify(state));
 }
 await assert.rejects(journal.finish(f.spool,['wrong-boundary','advanced-cursor'].includes(fault)?'2026-11-02T00:00:02.000Z':until),unavailable);
 await assert.rejects(readFile(join(f.directory,'end.json')),/ENOENT/);
});

for(const fault of ['process','predecessor','time','forged','foreign-cell','legacy','expired','issuer-as-reporter','production'])test(`preparation rejects ${fault} without a child record`,async t=>{
 const f=await fixture(t);let input={...f.input},options:Record<string,unknown>={};
 if(fault==='process')input.processId='bad';
 if(fault==='predecessor')input={...input,predecessorId:f.processId};
 if(fault==='time')input.startedAt='2026-11-02';
 if(fault==='forged')input.manifest={...input.manifest,signature:'A'.repeat(86)};
 if(fault==='foreign-cell')options={cellId:randomUUID()};
 if(fault==='legacy'){
  const {reporter:_,...value}=f.manifest;input.manifest=signManifest({...value,version:1},f.issuer.privateKey,Date.parse(startedAt));
 }
 if(fault==='expired')input.startedAt='2026-11-02T00:10:00.000Z';
 if(fault==='issuer-as-reporter')options={reporterKey:f.issuer.privateKey};
 if(fault==='production')options={environment:'production'};
 assert.equal(typeof api?.TrafficChildJournal,'function','durable child journal must exist');
 await assert.rejects(async()=>f.journal(options).prepare(input),unavailable);
 await assert.rejects(readFile(join(f.directory,'prepared.json')),/ENOENT/);
});

test('changed process or manifest cannot overwrite an existing prepared lifetime',async t=>{
 const f=await fixture(t),journal=f.journal();await journal.prepare(f.input);const before=await readFile(join(f.directory,'prepared.json'),'utf8');
 for(const input of [{...f.input,processId:randomUUID()},{...f.input,predecessorId:randomUUID()},
  {...f.input,manifest:signManifest({...f.manifest,sequence:8},f.issuer.privateKey,Date.parse(startedAt))}])await assert.rejects(journal.prepare(input),unavailable);
 assert.equal(await readFile(join(f.directory,'prepared.json'),'utf8'),before);
});

for(const fault of ['forged-start','changed-manifest','changed-binding','changed-end','invalid-json','version','partial','oversize','ack','end-ack','orphan-end'])test(`recovery refuses ${fault} instead of inventing a lifetime`,async t=>{
 const f=await fixture(t),journal=f.journal();await journal.prepare(f.input);
 const file=join(f.directory,'prepared.json'),saved=JSON.parse(await readFile(file,'utf8'));
 if(fault==='forged-start')saved.start.signature='A'.repeat(86);
 if(fault==='changed-manifest')saved.manifest=signManifest({...f.manifest,sequence:8},f.issuer.privateKey,Date.parse(startedAt));
 if(fault==='changed-binding')saved.start=signTrafficLifecycle({...verifyTrafficLifecycle(saved.start,f.reporter.publicKey),gatewayId:randomUUID()},f.reporter.privateKey);
 if(fault==='version')saved.version=2;
 if(fault==='changed-end'){
  await f.append();await journal.finish(f.spool,until);
  const end=JSON.parse(await readFile(join(f.directory,'end.json'),'utf8'));
  await writeFile(join(f.directory,'end.json'),JSON.stringify(signTrafficLifecycle({...verifyTrafficLifecycle(end,f.reporter.publicKey),predecessorId:randomUUID()},f.reporter.privateKey)));
 }else if(fault==='ack')await writeFile(join(f.directory,'start.ack'),'wrong',{mode:0o600});
 else if(fault==='end-ack')await writeFile(join(f.directory,'end.ack'),'wrong',{mode:0o600});
 else if(fault==='orphan-end'){await f.append();await journal.finish(f.spool,until);await rm(file);}
 else await writeFile(file,fault==='invalid-json'?'{}':fault==='partial'?'{':fault==='oversize'?JSON.stringify(saved)+' '.repeat(131073-JSON.stringify(saved).length):JSON.stringify(saved));
 await assert.rejects(journal.pending(),unavailable);
});

for(const fault of ['directory-mode','file-mode','symlink-directory','parent-symlink','symlink-file','hardlink','file-directory'])test(`private journal refuses ${fault}`,async t=>{
 const f=await fixture(t),journal=f.journal();await journal.prepare(f.input);const file=join(f.directory,'prepared.json');
 if(fault==='directory-mode')await chmod(f.directory,0o755);
 if(fault==='file-mode')await chmod(file,0o644);
 if(fault==='symlink-directory'){const alias=join(f.root,'alias');await symlink(f.directory,alias);await assert.rejects(f.journal({directory:alias}).pending(),unavailable);return;}
 if(fault==='parent-symlink'){const alias=join(f.root,'alias');await symlink(f.root,alias);await assert.rejects(f.journal({directory:join(alias,'journal')}).pending(),unavailable);return;}
 if(fault==='symlink-file'){const text=await readFile(file);await rm(file);await writeFile(join(f.root,'outside'),text,{mode:0o600});await symlink(join(f.root,'outside'),file);}
 if(fault==='hardlink')await link(file,join(f.root,'linked'));
 if(fault==='file-directory'){await rm(file);await mkdir(file,{mode:0o700});}
 await assert.rejects(journal.pending(),unavailable);
});

for(const fault of ['replacement-directory','replacement-lifetime'])test(`country acknowledgement refuses ${fault}`,async t=>{
 const f=await fixture(t),journal=f.journal();await journal.prepare(f.input);
 await assert.rejects(journal.flush(async()=>{
  if(fault==='replacement-directory'){
   await rename(f.directory,join(f.root,'old'));await mkdir(f.directory,{mode:0o700});
   await writeFile(join(f.directory,'prepared.json'),await readFile(join(f.root,'old','prepared.json')),{mode:0o600});
  }else{
   const saved=JSON.parse(await readFile(join(f.directory,'prepared.json'),'utf8'));
   saved.start=signTrafficLifecycle({...verifyTrafficLifecycle(saved.start,f.reporter.publicKey),processId:randomUUID()},f.reporter.privateKey);
   await writeFile(join(f.directory,'prepared.json'),JSON.stringify(saved));
  }
 }),unavailable);
 await assert.rejects(readFile(join(f.directory,'start.ack')),/ENOENT/);
});

test('expired saved authority permits exact recovery but never a new child boundary',async t=>{
 const f=await fixture(t),journal=f.journal(),start=await journal.prepare(f.input);
 assert.deepEqual((await f.journal().restore())?.start,start);
 await assert.rejects(journal.prepare({...f.input,startedAt:'2026-11-02T00:10:00.000Z'}),unavailable);
 assert.deepEqual(await journal.pending(),[start]);
});
