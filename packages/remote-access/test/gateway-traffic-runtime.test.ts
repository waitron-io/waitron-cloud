import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {chmod,chown,cp,lstat,mkdir,mkdtemp,open,readFile,readdir,realpath,rename,rm,symlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {signManifest,type ReportingGatewayManifest} from '../src/manifest.ts';
import {TrafficChildJournal} from '../src/traffic-child-journal.ts';
import {TrafficSpool} from '../src/traffic-spool.ts';
import {TrafficChildProcess} from '../src/traffic-child-process.ts';
import {verifyTrafficLifecycle} from '../src/traffic-lifecycle.ts';
import {verifyTrafficReport} from '../src/traffic-report.ts';
import {serveTrafficLifetimes} from '../src/traffic-lifetime-transport.ts';

const api=await import(new URL('../src/gateway-traffic-runtime.ts',import.meta.url).href).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return undefined;});
const unavailable=/^Error: gateway_traffic_unavailable$/;
const startedAt='2026-11-02T00:00:00.000Z';
async function waitFor<T>(read:()=>Promise<T>):Promise<T>{
 const deadline=Date.now()+5000;
 for(;;){try{return await read();}catch(e){if(Date.now()>deadline)throw e;await delay(5);}}
}
async function fixture(t:{after:(fn:()=>Promise<void>)=>void;diagnostic:(message:string)=>void}){
 const root=await realpath(await mkdtemp('/tmp/gts-')),directory=join(root,'state');await mkdir(directory,{mode:0o700});
 const issuer=generateKeyPairSync('ed25519'),reporter=generateKeyPairSync('ed25519'),cellId=randomUUID();
 const mapping={country:'ES' as const,environment:'test' as const,cellId,directory:join(root,'reports'),writerUid:process.geteuid!(),readerGid:process.getegid!()};
 await mkdir(mapping.directory,{mode:0o700});await chown(mapping.directory,mapping.writerUid,mapping.readerGid);await chmod(mapping.directory,0o2750);await mkdir(join(root,'country'),{mode:0o700});
 const lifetimeSocket=join(root,'country','life.sock'),options={directory,lifetimeSocket,mapping,maxBytes:32768,reporterKey:reporter.privateKey};
 const route={installationId:randomUUID(),venueId:randomUUID(),revision:7,staffHostname:'staff.sol.example.test',publicHostname:'sol.example.test',address:'10.77.0.2',port:443,peerPublicKey:randomBytes(32).toString('base64')};
 const manifest:ReportingGatewayManifest={version:2,audience:'waitron-cloud-gateway',cellId,sequence:7,issuedAt:Date.parse(startedAt),expiresAt:Date.parse(startedAt)+600000,
  reporter:{gatewayId:randomUUID(),generation:3},routes:[route]};
 const envelope=signManifest(manifest,issuer.privateKey,Date.parse(startedAt)),runtimes:any[]=[],pids:number[]=[];
 let now=Date.parse(startedAt)+1000;
 const runtime=()=>{assert.equal(typeof api?.GatewayTrafficRuntime,'function','gateway traffic supervisor must exist');const value=new api!.GatewayTrafficRuntime(options,issuer.publicKey,()=>now);runtimes.push(value);return value;};
 const child=async()=>{
  const processId=randomUUID(),home=join(directory,processId),socket=join(root,processId+'.sock'),ready=join(root,processId+'.ready'),control=join(root,processId+'.control'),requests=join(root,processId+'.requests'),release=join(root,processId+'.release');
  const csv=(ingress='10',egress='25')=>`# pxname,svname,bin,bout,type\ntraffic_user_staff_${route.installationId.replaceAll('-','')},BACKEND,${ingress},${egress},1\ntraffic_user_public_${route.installationId.replaceAll('-','')},BACKEND,0,0,1\n`;
  await writeFile(control,JSON.stringify({csv:csv()}));
  const args=[fileURLToPath(new URL('./fixtures/traffic-child.ts',import.meta.url)),JSON.stringify({socket,prepared:join(home,'journal','prepared.json'),ready,control,requests,release})];
  const journal=()=>new TrafficChildJournal({directory:join(home,'journal'),country:'ES',environment:'test',cellId,issuerKey:issuer.publicKey,reporterKey:reporter.privateKey});
  const spool=()=>new TrafficSpool({directory:join(home,'spool'),maxBytes:32768});
  const identity=()=>waitFor(async()=>{const id=JSON.parse(await readFile(ready,'utf8')) as {pid:number;prepared:boolean};if(!pids.includes(id.pid)){pids.push(id.pid);t.diagnostic(`owned child PID ${id.pid}`);}return id;});
  return {processId,home,socket,ready,control,requests,release,csv,journal,spool,identity,start:{manifest:envelope,processId,startedAt,predecessorId:null as string|null,socket,command:process.execPath,args}};
 };
 t.after(async()=>{
  for(const name of await readdir(root))if(name.endsWith('.control'))await writeFile(join(root,name.replace('.control','.release')),'release');
  try{for(const r of runtimes)try{await r.stop();}catch{t.diagnostic('supervisor cleanup refused');}}
  finally{
   for(const name of await readdir(root))if(name.endsWith('.ready')){const id=JSON.parse(await readFile(join(root,name),'utf8'));if(!pids.includes(id.pid))pids.push(id.pid);}
   for(const pid of pids){try{process.kill(pid,'SIGKILL');}catch(e){assert.equal((e as NodeJS.ErrnoException).code,'ESRCH');}await waitFor(async()=>assert.throws(()=>process.kill(pid,0),/ESRCH/));}
   await rm(root,{recursive:true,force:true});
  }
 });
 return {root,directory,issuer,reporter,cellId,mapping,lifetimeSocket,options,runtime,child,envelope,setNow:(value:number)=>{now=value;}};
}

// Reintroducing a database import into the gateway's dependency graph must break the source-only launch.
test('owned child reporter loads in the source-only gateway image',async t=>{
 const root=await realpath(await mkdtemp('/tmp/gti-'));t.after(()=>rm(root,{recursive:true,force:true}));await cp(new URL('../src',import.meta.url),join(root,'src'),{recursive:true});
 const result=spawnSync(process.execPath,['--input-type=module','-e',`const m=await import(${JSON.stringify(join(root,'src/traffic-child-process.ts'))});if(typeof m.TrafficChildProcess!=='function')throw Error('missing child');`],{encoding:'utf8',timeout:10000,env:{PATH:process.env.PATH}});
 assert.equal(result.status,0,result.stderr);
});

// Missing orchestration, sampling a stopped child, lost retries or an omitted stop must break these real-process checks.
test('gateway supervisor starts a durably prepared child and samples exact signed bytes',async t=>{
 const f=await fixture(t),runtime=f.runtime(),c=await f.child();await runtime.recover();await runtime.start(c.start);assert.ok(runtime.pid(c.processId),'successful spawn must capture a live owned handle');const id=await c.identity();
 assert.equal(id.prepared,true);assert.equal(runtime.pid(c.processId),id.pid);await assert.rejects(runtime.tick(),unavailable);
 const reports=(await c.spool().pending()).map(e=>verifyTrafficReport(e,f.reporter.publicKey));
 assert.deepEqual(reports.map(r=>[r.sequence,r.complete,r.entries[0]?.ingress,r.entries[0]?.egress]),[[1,true,'10','25']]);
 await runtime.stop();assert.equal(runtime.pid(c.processId),undefined);assert.throws(()=>process.kill(id.pid,0),/ESRCH/);assert.equal((await c.journal().restore())?.end,null);
});
test('unavailable country retains exact start and reports until durable delivery',async t=>{
 const f=await fixture(t),runtime=f.runtime(),c=await f.child();await runtime.recover();await runtime.start(c.start);await c.identity();await assert.rejects(runtime.tick(),unavailable);
 const saved=await c.journal().pending(),reports=await c.spool().pending(),received:unknown[]=[];
 const server=await serveTrafficLifetimes({socket:f.lifetimeSocket,mappings:[f.mapping],store:{async recordLifecycle(_m,e){received.push(e);}}});
 try{
  f.setNow(Date.parse(startedAt)+2000);await runtime.tick();assert.deepEqual(received,saved);
  assert.deepEqual(await c.journal().pending(),[]);assert.equal(verifyTrafficReport(JSON.parse(await readFile(join(f.mapping.directory,c.processId+'.1.json'),'utf8')),f.reporter.publicKey).entries[0]?.egress,'25');
  assert.deepEqual(JSON.parse(await readFile(join(f.mapping.directory,c.processId+'.1.json'),'utf8')),reports[0]);
 }finally{await server.close();}
});
test('reload samples both owned children without losing predecessor identity',async t=>{
 const f=await fixture(t),runtime=f.runtime(),one=await f.child(),two=await f.child();await runtime.recover();await runtime.start(one.start);await one.identity();
 await runtime.start({...two.start,predecessorId:one.processId});await two.identity();await assert.rejects(runtime.tick(),unavailable);
 for(const c of [one,two])assert.equal((await c.spool().cursor())?.sequence,1);
 const start=verifyTrafficLifecycle((await two.journal().restore())!.start,f.reporter.publicKey);assert.equal(start.predecessorId,one.processId);
});
test('one crashed child cannot prevent sampling its live successor',async t=>{
 const f=await fixture(t),runtime=f.runtime(),one=await f.child(),two=await f.child();await runtime.recover();await runtime.start(one.start);const id=await one.identity();await runtime.start({...two.start,predecessorId:one.processId});await two.identity();
 process.kill(id.pid,'SIGKILL');await waitFor(async()=>assert.equal(runtime.pid(one.processId),undefined));await assert.rejects(runtime.tick(),unavailable);
 assert.equal((await two.spool().cursor())?.sequence,1);assert.equal((await one.journal().restore())?.end,null);
});
test('recovery delivers retained bytes without adopting or signalling a live saved child',async t=>{
 const f=await fixture(t),owner=f.runtime(),c=await f.child();await owner.recover();await owner.start(c.start);const id=await c.identity();await assert.rejects(owner.tick(),unavailable);
 const recovered=f.runtime();await recovered.recover();assert.equal(recovered.pid(c.processId),undefined);await recovered.stop();assert.doesNotThrow(()=>process.kill(id.pid,0));
 assert.equal((await c.spool().restore()).complete,false);assert.equal((await c.journal().restore())?.end,null);
});
test('recovered exact retries are published even though sampling authority is absent',async t=>{
 const f=await fixture(t),owner=f.runtime(),c=await f.child();await owner.recover();await owner.start(c.start);await c.identity();await assert.rejects(owner.tick(),unavailable);await owner.stop();
 const before=await c.spool().pending(),received:unknown[]=[];const recovered=f.runtime();await recovered.recover();
 const server=await serveTrafficLifetimes({socket:f.lifetimeSocket,mappings:[f.mapping],store:{async recordLifecycle(_m,e){received.push(e);}}});
 try{await recovered.tick();assert.equal(received.length,1);await assert.doesNotReject(async()=>assert.deepEqual(JSON.parse(await readFile(join(f.mapping.directory,c.processId+'.1.json'),'utf8')),before[0]));assert.equal((await c.journal().restore())?.end,null);}
 finally{await server.close();}
});
test('serialized tick drains a held sample before stop and refuses later starts',async t=>{
 const f=await fixture(t),runtime=f.runtime(),c=await f.child();await runtime.recover();await runtime.start(c.start);const id=await c.identity();await writeFile(c.control,JSON.stringify({csv:c.csv(),hold:true}));
 const sampled=assert.rejects(runtime.tick(),unavailable);await waitFor(()=>readFile(c.requests));let stopped=false;const stop=runtime.stop().then(()=>{stopped=true;});
 try{await delay(50);assert.equal(stopped,false);assert.doesNotThrow(()=>process.kill(id.pid,0));}
 finally{await writeFile(c.release,'release');await Promise.all([sampled,stop]);}
 await assert.rejects(runtime.start((await f.child()).start),unavailable);await assert.rejects(runtime.tick(),unavailable);assert.throws(()=>process.kill(id.pid,0),/ESRCH/);
});
test('supervisor refuses duplicate and foreign starts without spawning them',async t=>{
 const f=await fixture(t),runtime=f.runtime(),c=await f.child();await runtime.recover();await runtime.start(c.start);const id=await c.identity();await assert.rejects(runtime.start(c.start),unavailable);
 const other=await f.child();await assert.rejects(runtime.start({...other.start,manifest:{...f.envelope,signature:'A'.repeat(86)}}),unavailable);await assert.rejects(readFile(other.ready),/ENOENT/);assert.equal(runtime.pid(c.processId),id.pid);
});
test('refused forged authority leaves no false retained process directory',async t=>{
 const f=await fixture(t),runtime=f.runtime(),c=await f.child();await runtime.recover();await assert.rejects(runtime.start({...c.start,manifest:{...f.envelope,signature:'A'.repeat(86)}}),unavailable);
 assert.deepEqual(await readdir(f.directory),[]);await assert.rejects(readFile(c.ready),/ENOENT/);
});
test('supervisor refuses spawn before recovery has checked retained state',async t=>{
 const f=await fixture(t),runtime=f.runtime(),c=await f.child();await assert.rejects(runtime.start(c.start),unavailable);await assert.rejects(readFile(c.ready),/ENOENT/);
});
for(const unsafe of ['unknown-name','symlink','public-mode','missing-journal'] as const)test(`retained state refuses ${unsafe} without adopting any child`,async t=>{
 const f=await fixture(t),runtime=f.runtime();
 if(unsafe==='unknown-name')await writeFile(join(f.directory,'unknown'),'uncertain');
 if(unsafe==='symlink')await symlink(f.root,join(f.directory,randomUUID()));
 if(unsafe==='public-mode')await chmod(f.directory,0o755);
 if(unsafe==='missing-journal')await mkdir(join(f.directory,randomUUID()),{mode:0o700});
 await assert.rejects(runtime.recover(),unavailable);await assert.rejects(runtime.start((await f.child()).start),unavailable);
});
test('replacing the private state root refuses a new spawn while shutdown still reaps owned handles',async t=>{
 const f=await fixture(t),runtime=f.runtime(),one=await f.child(),two=await f.child();await runtime.recover();await runtime.start(one.start);const id=await one.identity();
 const previous=f.directory+'-previous';await rename(f.directory,previous);await mkdir(f.directory,{mode:0o700});
 try{await assert.rejects(runtime.start(two.start),unavailable);await assert.rejects(runtime.tick(),unavailable);}
 finally{await rm(f.directory,{recursive:true});await rename(previous,f.directory);try{await runtime.stop();}catch{t.diagnostic('replaced-state cleanup refused after reaping captured handles');}}
 assert.throws(()=>process.kill(id.pid,0),/ESRCH/);await assert.rejects(readFile(two.ready),/ENOENT/);
});
test('retained-state exhaustion refuses the next process without deleting any evidence',async t=>{
 const f=await fixture(t);
 for(let i=0;i<128;i++){
  const c=await f.child();await mkdir(c.home,{mode:0o700});await mkdir(join(c.home,'spool'),{mode:0o700});
  await c.journal().prepare({manifest:f.envelope,processId:c.processId,startedAt,predecessorId:null});
 }
 const runtime=f.runtime();await runtime.recover();const next=await f.child();await assert.rejects(runtime.start(next.start),unavailable);
 assert.equal((await readdir(f.directory)).length,128);await assert.rejects(readFile(next.ready),/ENOENT/);
 await mkdir(next.home,{mode:0o700});await mkdir(join(next.home,'spool'),{mode:0o700});
 await next.journal().prepare({manifest:f.envelope,processId:next.processId,startedAt,predecessorId:null});await assert.rejects(f.runtime().recover(),unavailable);
});
test('a saved lifetime cannot be recovered under a different process directory',async t=>{
 const f=await fixture(t),owner=f.runtime(),c=await f.child();await owner.recover();await owner.start(c.start);await c.identity();await owner.stop();
 await rename(c.home,join(f.directory,randomUUID()));await assert.rejects(f.runtime().recover(),unavailable);
});
test('failed launch retains its signed start for recovery without inventing a process handle',async t=>{
 const f=await fixture(t),runtime=f.runtime(),c=await f.child();await runtime.recover();await assert.rejects(runtime.start({...c.start,command:join(f.root,'missing-command')}),unavailable);
 assert.equal(runtime.pid(c.processId),undefined);const saved=await c.journal().restore();assert.ok(saved);assert.equal(saved.end,null);
 assert.equal(verifyTrafficLifecycle(saved.start,f.reporter.publicKey).processId,c.processId);await f.runtime().recover();
});
test('failed launch drains the queued durable gap before returning to recovery',async t=>{
 const f=await fixture(t),runtime=f.runtime(),c=await f.child();await runtime.recover();
 let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>{enter=r;}),gate=new Promise<void>(r=>{release=r;});
 const original=TrafficSpool.prototype.markGap;let first=true;
 const hook=t.mock.method(TrafficSpool.prototype,'markGap',async function(this:TrafficSpool){if(first){first=false;enter();await gate;}await original.call(this);});
 let returned=false;const started=assert.rejects(runtime.start({...c.start,command:join(f.root,'missing-command')}),unavailable).then(()=>{returned=true;});
 try{await entered;await delay(50);assert.equal(returned,false,'recovery must not race an uncollected failed-spawn gap write');}
 finally{release();await started;hook.mock.restore();}
 await assert.doesNotReject(f.runtime().recover());
});
test('new child directories reach durable storage before the child can spawn',async t=>{
 const f=await fixture(t),runtime=f.runtime(),c=await f.child();await runtime.recover();
 const handle=await open(f.directory,'r'),prototype=Object.getPrototypeOf(handle),originalSync=prototype.sync;await handle.close();
 const synced=new Set<string>();let beforeSpawn:string[]=[];
 const syncHook=t.mock.method(prototype,'sync',async function(this:any){
  await originalSync.call(this);const current=await this.stat();
  for(const path of [f.directory,c.home]){let s;try{s=await lstat(path);}catch{continue;}if(s.dev===current.dev&&s.ino===current.ino)synced.add(path);}
 });
 const originalStart=TrafficChildProcess.prototype.start;
 const startHook=t.mock.method(TrafficChildProcess.prototype,'start',function(this:TrafficChildProcess){beforeSpawn=[...synced].sort();return originalStart.call(this);});
 try{await runtime.start(c.start);await c.identity();assert.deepEqual(beforeSpawn,[f.directory,c.home].sort());}
 finally{syncHook.mock.restore();startHook.mock.restore();}
});
