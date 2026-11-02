import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {chmod,mkdir,mkdtemp,readFile,readdir,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {signManifest,type ReportingGatewayManifest} from '../src/manifest.ts';
import {verifyTrafficLifecycle} from '../src/traffic-lifecycle.ts';
import {verifyTrafficReport} from '../src/traffic-report.ts';
import {TrafficChildJournal} from '../src/traffic-child-journal.ts';
import {TrafficSpool} from '../src/traffic-spool.ts';
import {TrafficSampler} from '../src/traffic-sampler.ts';
import {collectTraffic} from '../src/traffic-collector.ts';
import {serveTrafficLifetimes} from '../src/traffic-lifetime-transport.ts';

const api=await import(new URL('../src/traffic-child-process.ts',import.meta.url).href).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return undefined;});
const unavailable=/^Error: traffic_child_process_unavailable$/;
const startedAt='2026-11-02T00:00:00.000Z';
async function waitFor<T>(read:()=>Promise<T>):Promise<T>{
 const until=Date.now()+5000;
 for(;;){try{return await read();}catch(error){if(Date.now()>until)throw error;await delay(5);}}
}
async function fixture(t:{after:(fn:()=>Promise<void>)=>void;diagnostic:(message:string)=>void},ignoreTerm=false){
 const root=await realpath(await mkdtemp(join(tmpdir(),'tcp-')));
 const issuer=generateKeyPairSync('ed25519'),reporter=generateKeyPairSync('ed25519'),cellId=randomUUID(),processId=randomUUID();
 const route={installationId:randomUUID(),venueId:randomUUID(),revision:7,staffHostname:'staff.sol.example.test',publicHostname:'sol.example.test',address:'10.77.0.2',port:443,peerPublicKey:randomBytes(32).toString('base64')};
 const manifest:ReportingGatewayManifest={version:2,audience:'waitron-cloud-gateway',cellId,sequence:7,issuedAt:Date.parse(startedAt),expiresAt:Date.parse(startedAt)+600000,
  reporter:{gatewayId:randomUUID(),generation:3},routes:[route]};
 const socket=join(root,'stats.sock'),directory=join(root,'journal'),ready=join(root,'ready'),control=join(root,'control'),requests=join(root,'requests'),release=join(root,'release');
 const spool=new TrafficSpool({directory:join(root,'spool'),maxBytes:32768});
 const mapping={country:'ES' as const,environment:'test' as const,cellId,directory:join(root,'reports'),writerUid:process.geteuid!(),readerGid:process.getegid!()};
 await mkdir(mapping.directory,{mode:0o750});await chmod(mapping.directory,0o2750);await mkdir(join(root,'country'),{mode:0o700});
 const lifetimeSocket=join(root,'country','lifetime.sock');
 const csv=(ingress='10',egress='25')=>`# pxname,svname,bin,bout,type\ntraffic_user_staff_${route.installationId.replaceAll('-','')},BACKEND,${ingress},${egress},1\ntraffic_user_public_${route.installationId.replaceAll('-','')},BACKEND,0,0,1\n`;
 await writeFile(control,JSON.stringify({csv:csv()}));
 const args=[fileURLToPath(new URL('./fixtures/traffic-child.ts',import.meta.url)),JSON.stringify({socket,prepared:join(directory,'prepared.json'),ready,control,requests,release,ignoreTerm})];
 const journalOptions={directory,country:'ES' as const,environment:'test' as const,cellId,issuerKey:issuer.publicKey,reporterKey:reporter.privateKey};
 const options={...journalOptions,spool,manifest:signManifest(manifest,issuer.privateKey,Date.parse(startedAt)),processId,startedAt,predecessorId:null,
  command:process.execPath,args,socket,mapping,lifetimeSocket,now:()=>Date.parse('2026-11-02T00:00:01.000Z')};
 const children:any[]=[];
 t.after(async()=>{
  await writeFile(release,'release');
  try{for(const child of children)try{await child.stop();}catch{t.diagnostic('controller cleanup refused; reaping the recorded fixture child');}}
  finally{
   let id:{pid:number}|undefined;try{id=JSON.parse(await readFile(ready,'utf8'));}catch{}
   if(id){try{process.kill(id.pid,'SIGKILL');}catch(e){assert.equal((e as NodeJS.ErrnoException).code,'ESRCH');}
    await waitFor(async()=>assert.throws(()=>process.kill(id!.pid,0),/ESRCH/));}
   await rm(root,{recursive:true,force:true});
  }
 });
 const child=(change:Record<string,unknown>={})=>{
  assert.equal(typeof api?.TrafficChildProcess,'function','owned child process controller must exist');
  const value=new api!.TrafficChildProcess({...options,...change});children.push(value);return value;
 };
 let recorded=false;
 const identity=()=>waitFor(async()=>{const value=JSON.parse(await readFile(ready,'utf8')) as {pid:number;prepared:boolean};if(!recorded){recorded=true;t.diagnostic(`owned child PID ${value.pid}`);}return value;});
 const journal=()=>new TrafficChildJournal(journalOptions);
 return {root,issuer,reporter,cellId,processId,manifest,options,spool,mapping,socket,control,requests,release,ready,child,identity,journal,csv,lifetimeSocket};
}

// Starting before preparation, adopting saved identities, or sampling outside ownership must break these checks.
test('owned spawn observes the signed preparation before its first instruction',async t=>{
 const f=await fixture(t),child=f.child();await child.start();const id=await f.identity();
 assert.equal(id.prepared,true);assert.equal(child.running,true);
 const saved=await f.journal().restore();assert.ok(saved);assert.equal(verifyTrafficLifecycle(saved.start,f.reporter.publicKey).processId,f.processId);assert.equal(saved.end,null);
 assert.equal(await readFile(join(f.root,'journal','spawn.claim'),'utf8'),createHash('sha256').update(JSON.stringify(saved.start)).digest('hex')+'\n');
 await child.stop();assert.equal(child.running,false);assert.throws(()=>process.kill(id.pid,0),/ESRCH/);assert.equal((await f.journal().restore())?.end,null);
 assert.equal((await f.spool.restore()).complete,false);assert.equal(await readFile(join(f.root,'spool','gap'),'utf8'),'incomplete\n');
});

test('private child statistics produce exact signed user deltas',async t=>{
 const f=await fixture(t);let n=0;const child=f.child({now:()=>Date.parse(startedAt)+1000*++n});await child.start();await f.identity();
 await child.sample();await writeFile(f.control,JSON.stringify({csv:f.csv('20','50')}));await child.sample();
 const reports=(await f.spool.pending()).map(e=>verifyTrafficReport(e,f.reporter.publicKey));
 assert.deepEqual(reports.map(r=>[r.sequence,r.from,r.until,r.complete,r.entries[0]?.ingress,r.entries[0]?.egress]),[
  [1,startedAt,'2026-11-02T00:00:01.000Z',true,'10','25'],[2,'2026-11-02T00:00:01.000Z','2026-11-02T00:00:02.000Z',true,'10','25']]);
});

test('sampling before spawn cannot turn an unrelated socket into a fresh child',async t=>{
 const f=await fixture(t),child=f.child();await assert.rejects(child.sample(),unavailable);assert.deepEqual(await f.spool.pending(),[]);
});

for(const action of ['same-instance','new-instance','stopped-instance'])test(`saved lifetime refuses ${action} spawn without adopting a PID`,async t=>{
 const f=await fixture(t),child=f.child();await child.start();const id=await f.identity();
 if(action==='stopped-instance')await child.stop();
 await assert.rejects((action==='new-instance'?f.child():child).start(),unavailable);
 if(action!=='stopped-instance')assert.doesNotThrow(()=>process.kill(id.pid,0));
 assert.equal((await f.journal().restore())?.end,null);
});

test('prepared but unspawned lifetime is never adopted on restart',async t=>{
 const f=await fixture(t);await f.journal().prepare({manifest:f.options.manifest,processId:f.processId,startedAt,predecessorId:null});
 const child=f.child();await assert.rejects(child.start(),unavailable);assert.equal(child.running,false);await assert.rejects(readFile(f.ready),/ENOENT/);
});

test('spawn refusal retains signed start and never fabricates an end',async t=>{
 const f=await fixture(t),child=f.child({command:join(f.root,'absent')});await assert.rejects(child.start(),unavailable);
 assert.equal(child.running,false);assert.equal((await f.journal().restore())?.end,null);assert.equal((await f.journal().pending()).length,1);
});

test('forged authority refuses before a process or lifetime is created',async t=>{
 const f=await fixture(t);await assert.rejects(async()=>f.child({manifest:{...f.options.manifest,signature:'A'.repeat(86)}}).start(),unavailable);
 await assert.rejects(readFile(f.ready),/ENOENT/);assert.equal(await f.journal().restore(),undefined);
});

test('existing spool cannot be labelled a newly spawned complete history',async t=>{
 const f=await fixture(t);await f.spool.markGap();const child=f.child();await assert.rejects(child.start(),unavailable);
 await assert.rejects(readFile(f.ready),/ENOENT/);assert.equal(await f.journal().restore(),undefined);
});

test('child crash preserves an unclosed lifetime and rejects further sampling',async t=>{
 const f=await fixture(t),child=f.child();await child.start();const id=await f.identity();await child.sample();process.kill(id.pid,'SIGKILL');
 await waitFor(async()=>{assert.equal(child.running,false);await assert.doesNotReject(readFile(join(f.root,'spool','gap')));});
 await assert.rejects(child.sample(),unavailable);assert.equal((await f.journal().restore())?.end,null);assert.equal((await f.spool.restore()).complete,false);
});

test('owned shutdown escalates a child that ignores TERM and is idempotent',async t=>{
 const f=await fixture(t,true),child=f.child();await child.start();const id=await f.identity();await Promise.all([child.stop(),child.stop()]);
 assert.throws(()=>process.kill(id.pid,0),/ESRCH/);await assert.rejects(child.sample(),unavailable);assert.equal((await f.journal().restore())?.end,null);
});

test('unavailable country retains exact lifetime before later report publication',async t=>{
 const f=await fixture(t),child=f.child();await child.start();await f.identity();await child.sample();
 const original=(await f.journal().pending())[0];await assert.rejects(child.flush(),unavailable);assert.deepEqual(await f.journal().pending(),[original]);
 const received:unknown[]=[];
 const server=await serveTrafficLifetimes({socket:f.lifetimeSocket,mappings:[f.mapping],store:{async recordLifecycle(_mapping,envelope){received.push(envelope);}}});
 try{
  await child.flush();assert.deepEqual(received,[original]);assert.deepEqual(await f.journal().pending(),[]);
  const accepted:unknown[]=[];
  await collectTraffic(f.mapping,{async record(_mapping,envelope){accepted.push(envelope);return {state:'accepted' as const,processId:f.processId,sequence:1};}});
  assert.equal(accepted.length,1);assert.equal(verifyTrafficReport(accepted[0],f.reporter.publicKey).entries[0]?.ingress,'10');
  await child.flush();assert.deepEqual(await f.spool.pending(),[]);assert.deepEqual(received,[original]);
 }finally{await server.close();}
});

test('held socket read serializes report transfer and a second sample',async t=>{
 const f=await fixture(t);let n=0;const child=f.child({now:()=>Date.parse(startedAt)+1000*++n});await child.start();await f.identity();
 await writeFile(f.control,JSON.stringify({csv:f.csv(),hold:true}));
 const sampled=child.sample();await waitFor(()=>readFile(f.requests));
 let calls=0;const server=await serveTrafficLifetimes({socket:f.lifetimeSocket,mappings:[f.mapping],store:{async recordLifecycle(){calls++;}}});
 const flushed=child.flush(),second=child.sample();
 try{
  await delay(100);assert.equal(calls,0);assert.equal(await readFile(f.requests,'utf8'),'sample\n');
 }finally{await writeFile(f.release,'release');await Promise.allSettled([sampled,flushed,second]);await server.close();}
 assert.equal(calls,1);assert.equal((await f.spool.cursor())?.sequence,2);
});

test('stop refuses new samples while a held read drains, then reaps only its child',async t=>{
 const f=await fixture(t),child=f.child();await child.start();const id=await f.identity();
 await writeFile(f.control,JSON.stringify({csv:f.csv(),hold:true}));const sampled=child.sample();await waitFor(()=>readFile(f.requests));
 const stopped=child.stop();const refused=assert.rejects(child.sample(),unavailable);
 try{await delay(50);assert.doesNotThrow(()=>process.kill(id.pid,0));}finally{await writeFile(f.release,'release');await Promise.all([sampled,stopped,refused]);}
 assert.throws(()=>process.kill(id.pid,0),/ESRCH/);assert.equal((await f.journal().restore())?.end,null);
});

test('child exiting during a held sample never leaves complete coverage',async t=>{
 const f=await fixture(t),child=f.child();await child.start();const id=await f.identity();
 await writeFile(f.control,JSON.stringify({csv:f.csv(),hold:true}));const sampled=child.sample();const refused=assert.rejects(sampled,unavailable);
 await waitFor(()=>readFile(f.requests));process.kill(id.pid,'SIGKILL');await refused;await child.stop();
 assert.equal((await f.spool.restore()).complete,false);assert.equal((await f.journal().restore())?.end,null);
});

test('stop drains the exit-triggered gap write before returning ownership',async t=>{
 const f=await fixture(t),child=f.child();await child.start();await f.identity();
 const realMarkGap=f.spool.markGap.bind(f.spool);let calls=0,enter!:()=>void,release!:()=>void;
 const entered=new Promise<void>(r=>{enter=r;}),gate=new Promise<void>(r=>{release=r;});
 f.spool.markGap=async()=>{if(++calls===2){enter();await gate;}await realMarkGap();};
 let completed=false;const stopped=child.stop().then(()=>{completed=true;});
 try{await entered;await delay(50);assert.equal(completed,false,'shutdown must drain its queued exit write');}
 finally{release();await stopped;}
 assert.equal(await readFile(join(f.root,'spool','gap'),'utf8'),'incomplete\n');
});

test('concurrent controllers for the same prepared identity can spawn only once',async t=>{
 const f=await fixture(t),one=f.child(),two=f.child();
 const cursor=f.spool.cursor.bind(f.spool);let checked=Promise.resolve();
 f.spool.cursor=()=>{const value=checked.then(cursor);checked=value.then(()=>{});return value;};
 const original=TrafficChildJournal.prototype.prepare,restore=TrafficChildJournal.prototype.restore;
 let loaded!:()=>void,reads=0;const allLoaded=new Promise<void>(r=>{loaded=r;});
 TrafficChildJournal.prototype.restore=async function(){const value=await restore.call(this);if(++reads===2)loaded();await allLoaded;return value;};
 let ready!:()=>void,previous=Promise.resolve();const both=new Promise<void>(r=>{ready=r;});let count=0;
 TrafficChildJournal.prototype.prepare=async function(input){
  const prepared=previous.then(()=>original.call(this,input));previous=prepared.then(()=>{});
  const value=await prepared;if(++count===2)ready();await both;return value;
 };
 let results:PromiseSettledResult<void>[];
 try{results=await Promise.allSettled([one.start(),two.start()]);}finally{TrafficChildJournal.prototype.prepare=original;TrafficChildJournal.prototype.restore=restore;}
 assert.deepEqual(results!.map(r=>r.status).sort(),['fulfilled','rejected']);
 const id=await f.identity();assert.doesNotThrow(()=>process.kill(id.pid,0));
});

test('a recovered controller can deliver saved bytes but cannot stop the original live child',async t=>{
 const f=await fixture(t),owner=f.child();await owner.start();const id=await f.identity();await owner.sample();
 const recovered=f.child();await recovered.stop();assert.doesNotThrow(()=>process.kill(id.pid,0));assert.equal(owner.running,true);
 let calls=0;const server=await serveTrafficLifetimes({socket:f.lifetimeSocket,mappings:[f.mapping],store:{async recordLifecycle(){calls++;}}});
 try{await recovered.flush();assert.equal(calls,1);assert.equal((await readdir(f.mapping.directory)).length,1);assert.deepEqual(await f.journal().pending(),[]);}
 finally{await server.close();}
});

test('a held country acknowledgement keeps reports private and serializes later sampling',async t=>{
 const f=await fixture(t);let n=0;const child=f.child({now:()=>Date.parse(startedAt)+1000*++n});await child.start();await f.identity();await child.sample();
 const initialRequests=await readFile(f.requests,'utf8');let release!:()=>void,enter!:()=>void;
 const gate=new Promise<void>(r=>{release=r;}),entered=new Promise<void>(r=>{enter=r;});
 const server=await serveTrafficLifetimes({socket:f.lifetimeSocket,mappings:[f.mapping],store:{async recordLifecycle(){enter();await gate;}}});
 const flushed=child.flush();await entered;const sampled=child.sample();
 try{
  await delay(100);assert.deepEqual(await readdir(f.mapping.directory),[]);assert.equal(await readFile(f.requests,'utf8'),initialRequests);
  assert.equal((await f.journal().pending()).length,1);
 }finally{release();await Promise.all([flushed,sampled]);await server.close();}
 assert.equal((await readdir(f.mapping.directory)).length,1);assert.equal((await f.spool.cursor())?.sequence,2);
});

for(const change of [{mapping:{cellId:randomUUID()}},{country:'FR'},{environment:'production'}])test(`controller refuses foreign binding ${Object.keys(change)[0]}`,async t=>{
 const f=await fixture(t),options='mapping'in change?{mapping:{...f.mapping,...change.mapping}}:change;
 assert.equal(typeof api?.TrafficChildProcess,'function');assert.throws(()=>f.child(options),unavailable);
 await assert.rejects(readFile(f.ready),/ENOENT/);assert.equal(await f.journal().restore(),undefined);
});

test('a pre-existing statistics path refuses before child preparation or spawn',async t=>{
 const f=await fixture(t);await writeFile(f.socket,'unowned path');const child=f.child();
 await assert.rejects(child.start(),unavailable);await assert.rejects(readFile(f.ready),/ENOENT/);assert.equal(await f.journal().restore(),undefined);
 assert.equal(await readFile(f.socket,'utf8'),'unowned path');
});

test('exit after a successful socket reply refuses the sample and marks a gap',async t=>{
 const f=await fixture(t),child=f.child();await child.start();const id=await f.identity();
 const original=TrafficSampler.prototype.sampleSocket;
 TrafficSampler.prototype.sampleSocket=async function(...args){await original.apply(this,args);process.kill(id.pid,'SIGKILL');await waitFor(async()=>assert.equal(child.running,false));};
 try{await assert.rejects(child.sample(),unavailable);}finally{TrafficSampler.prototype.sampleSocket=original;}
 await child.stop();assert.equal((await f.spool.restore()).complete,false);assert.equal((await f.journal().restore())?.end,null);
});
