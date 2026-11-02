import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {chmod,chown,mkdir,mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {signManifest,type ReportingGatewayManifest} from '../src/manifest.ts';
import {GatewayTrafficRuntime} from '../src/gateway-traffic-runtime.ts';
import {TrafficChildJournal} from '../src/traffic-child-journal.ts';
import {serveTrafficLifetimes} from '../src/traffic-lifetime-transport.ts';

async function waitFor<T>(read:()=>Promise<T>):Promise<T>{
 const deadline=Date.now()+5000;
 for(;;){try{return await read();}catch(e){if(Date.now()>deadline)throw e;await delay(5);}}
}
async function fixture(t:{after:(fn:()=>Promise<void>)=>void;diagnostic:(s:string)=>void}){
 const root=await realpath(await mkdtemp('/tmp/gtw-')),directory=join(root,'state'),reports=join(root,'reports');
 await mkdir(directory,{mode:0o700});await mkdir(reports,{mode:0o700});await chown(reports,process.geteuid!(),process.getegid!());await chmod(reports,0o2750);await mkdir(join(root,'country'),{mode:0o700});
 const issuer=generateKeyPairSync('ed25519'),reporter=generateKeyPairSync('ed25519'),cellId=randomUUID();
 const route={installationId:randomUUID(),venueId:randomUUID(),revision:1,staffHostname:'staff.sol.example.test',publicHostname:'sol.example.test',address:'10.77.0.2',port:443,peerPublicKey:randomBytes(32).toString('base64')};
 const began=Date.parse('2026-11-02T00:00:00.000Z');let now=began+1000;
 const manifest:ReportingGatewayManifest={version:2,audience:'waitron-cloud-gateway',cellId,sequence:1,issuedAt:began,expiresAt:began+60000,reporter:{gatewayId:randomUUID(),generation:1},routes:[route]};
 const mapping={country:'ES' as const,environment:'test' as const,cellId,directory:reports,writerUid:process.geteuid!(),readerGid:process.getegid!()},lifetimeSocket=join(root,'country','life.sock');
 const runtime=new GatewayTrafficRuntime({directory,mapping,lifetimeSocket,maxBytes:32768,reporterKey:reporter.privateKey},issuer.publicKey,()=>now);
 const pids:number[]=[],releases:Array<()=>void>=[];
 t.after(async()=>{
  for(const release of releases)release();
  try{await runtime.stop();}finally{for(const pid of pids){try{process.kill(pid,'SIGKILL');}catch(e){assert.equal((e as NodeJS.ErrnoException).code,'ESRCH');}await waitFor(async()=>assert.throws(()=>process.kill(pid,0),/ESRCH/));}await rm(root,{recursive:true,force:true});}
 });
 await runtime.recover();
 const child=async(expiresAt=manifest.expiresAt)=>{
  const processId=randomUUID(),home=join(directory,processId),socket=join(root,processId+'.sock'),ready=join(root,processId+'.ready'),control=join(root,processId+'.control');
  await writeFile(control,JSON.stringify({csv:`# pxname,svname,bin,bout,type\ntraffic_user_staff_${route.installationId.replaceAll('-','')},BACKEND,10,25,1\ntraffic_user_public_${route.installationId.replaceAll('-','')},BACKEND,0,0,1\n`}));
  const start={manifest:signManifest({...manifest,expiresAt},issuer.privateKey,began),processId,startedAt:new Date(now).toISOString(),predecessorId:null,socket,command:process.execPath,
   args:[fileURLToPath(new URL('./fixtures/traffic-child.ts',import.meta.url)),JSON.stringify({socket,prepared:join(home,'journal','prepared.json'),ready,control,requests:join(root,processId+'.requests'),release:join(root,processId+'.release'),ignoreTerm:true})]};
  const identity=()=>waitFor(async()=>{const id=JSON.parse(await readFile(ready,'utf8'));if(!pids.includes(id.pid)){pids.push(id.pid);t.diagnostic(`owned child PID ${id.pid}`);}return id;});
  const journal=()=>new TrafficChildJournal({directory:join(home,'journal'),country:'ES',environment:'test',cellId,issuerKey:issuer.publicKey,reporterKey:reporter.privateKey});
  return {start,identity,ready,journal};
 };
 const held=async()=>{
  let entered!:()=>void,release!:()=>void;const enteredPromise=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;});releases.push(release);
  const server=await serveTrafficLifetimes({socket:lifetimeSocket,mappings:[mapping],store:{async recordLifecycle(){entered();await gate;}}});
  t.after(()=>server.close());return {entered:enteredPromise,release};
 };
 return {root,runtime,child,held,setNow:(value:number)=>{now=value;},manifest};
}

// Removing immediate captured-handle signalling leaves a real child serving while delivery is held.
test('withdrawal kills the owned child before a country commit can drain',async t=>{
 const f=await fixture(t),c=await f.child();assert.equal(typeof (f.runtime as any).withdraw,'function','runtime must expose immediate withdrawal');await f.runtime.start(c.start);const id=await c.identity(),held=await f.held();
 const tick=f.runtime.tick().catch(()=>{});await held.entered;
 assert.equal(typeof (f.runtime as any).withdraw,'function','runtime must expose immediate withdrawal');
 let drained=false;const withdrawn=(f.runtime as any).withdraw().then(()=>{drained=true;});
 try{await waitFor(async()=>assert.throws(()=>process.kill(id.pid,0),/ESRCH/));assert.equal(drained,false);assert.equal((await c.journal().restore())?.end,null);}
 finally{held.release();await Promise.all([tick,withdrawn]);}
});

// A start queued before withdrawal must not spawn later when an unrelated commit finishes.
test('withdrawal invalidates a queued start but allows a later authenticated start',async t=>{
 const f=await fixture(t),one=await f.child(),two=await f.child(),three=await f.child();assert.equal(typeof (f.runtime as any).withdraw,'function');await f.runtime.start(one.start);await one.identity();const held=await f.held();
 const tick=f.runtime.tick().catch(()=>{});await held.entered;const queued=assert.rejects(f.runtime.start(two.start),/^Error: gateway_traffic_unavailable$/);
 assert.equal(typeof (f.runtime as any).withdraw,'function');const withdrawn=(f.runtime as any).withdraw();
 held.release();await Promise.all([tick,queued,withdrawn]);await assert.rejects(readFile(two.ready),/ENOENT/);
 await f.runtime.start(three.start);assert.ok((await three.identity()).pid);
});

// Each draining predecessor retains its own signed deadline even after a longer-lived reload.
test('independent expiry kills only expired children while delivery is held',async t=>{
 const f=await fixture(t),one=await f.child(),two=await f.child(f.manifest.expiresAt+60000);assert.equal(typeof (f.runtime as any).expire,'function','expiry must run independently from traffic delivery');await f.runtime.start(one.start);const first=await one.identity();
 await f.runtime.start({...two.start,predecessorId:one.start.processId});const second=await two.identity(),held=await f.held();
 const tick=f.runtime.tick().catch(()=>{});await held.entered;f.setNow(f.manifest.expiresAt);
 assert.equal(typeof (f.runtime as any).expire,'function','expiry must run independently from traffic delivery');const expired=(f.runtime as any).expire();
 try{await waitFor(async()=>assert.throws(()=>process.kill(first.pid,0),/ESRCH/));assert.doesNotThrow(()=>process.kill(second.pid,0));}
 finally{held.release();await Promise.all([tick,expired]);}
 assert.equal((await one.journal().restore())?.end,null);
});

test('expired queued authority cannot spawn using its historical start time',async t=>{
 const f=await fixture(t),one=await f.child(),two=await f.child();await f.runtime.start(one.start);await one.identity();const held=await f.held();
 const tick=f.runtime.tick().catch(()=>{});await held.entered;const queued=assert.rejects(f.runtime.start(two.start),/^Error: gateway_traffic_unavailable$/);
 f.setNow(f.manifest.expiresAt);held.release();await Promise.all([tick,queued]);await assert.rejects(readFile(two.ready),/ENOENT/);
});

// Withdrawal during durable preparation must be observed again immediately before spawn.
test('withdrawal during the spawn claim prevents any child from starting',async t=>{
 const f=await fixture(t),c=await f.child();assert.equal(typeof (f.runtime as any).withdraw,'function');let enter!:()=>void,release!:()=>void;
 const entered=new Promise<void>(r=>{enter=r;}),gate=new Promise<void>(r=>{release=r;});const original=TrafficChildJournal.prototype.claimSpawn;
 const hook=t.mock.method(TrafficChildJournal.prototype,'claimSpawn',async function(this:TrafficChildJournal){await original.call(this);enter();await gate;});
 const started=assert.rejects(f.runtime.start(c.start),/^Error: gateway_traffic_unavailable$/);await entered;
 assert.equal(typeof (f.runtime as any).withdraw,'function');const withdrawn=(f.runtime as any).withdraw();
 release();try{await Promise.all([started,withdrawn]);await assert.rejects(readFile(c.ready),/ENOENT/);}finally{hook.mock.restore();}
});
