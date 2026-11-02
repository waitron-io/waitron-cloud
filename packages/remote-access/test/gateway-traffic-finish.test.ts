import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {chmod,chown,mkdir,mkdtemp,readFile,readdir,realpath,rename,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {GatewayTrafficRuntime} from '../src/gateway-traffic-runtime.ts';
import {signManifest,type ReportingGatewayManifest} from '../src/manifest.ts';
import {TrafficChildJournal} from '../src/traffic-child-journal.ts';
import {TrafficSpool} from '../src/traffic-spool.ts';
import {verifyTrafficLifecycle} from '../src/traffic-lifecycle.ts';
import {verifyTrafficReport} from '../src/traffic-report.ts';
import {serveTrafficLifetimes} from '../src/traffic-lifetime-transport.ts';

const unavailable=/^Error: gateway_traffic_unavailable$/;
const began=Date.parse('2026-11-02T00:00:00.000Z');
async function waitFor<T>(read:()=>Promise<T>):Promise<T>{
 const until=Date.now()+5000;for(;;){try{return await read();}catch(e){if(Date.now()>until)throw e;await delay(5);}}
}
async function fixture(t:{after:(fn:()=>Promise<void>)=>void;diagnostic:(s:string)=>void}){
 const root=await realpath(await mkdtemp('/tmp/gtf-')),directory=join(root,'state'),reports=join(root,'reports');
 for(const path of [directory,reports,join(root,'country')])await mkdir(path,{mode:0o700});
 await chown(reports,process.geteuid!(),process.getegid!());await chmod(reports,0o2750);
 const issuer=generateKeyPairSync('ed25519'),reporter=generateKeyPairSync('ed25519'),cellId=randomUUID();
 const route={installationId:randomUUID(),venueId:randomUUID(),revision:1,staffHostname:'staff.sol.example.test',publicHostname:'sol.example.test',address:'10.77.0.2',port:443,peerPublicKey:randomBytes(32).toString('base64')};
 const manifest:ReportingGatewayManifest={version:2,audience:'waitron-cloud-gateway',cellId,sequence:1,issuedAt:began,expiresAt:began+60000,reporter:{gatewayId:randomUUID(),generation:1},routes:[route]};
 const mapping={country:'ES' as const,environment:'test' as const,cellId,directory:reports,writerUid:process.geteuid!(),readerGid:process.getegid!()},lifetimeSocket=join(root,'country','life.sock');
 const options={directory,mapping,lifetimeSocket,maxBytes:32768,reporterKey:reporter.privateKey};
 let now=began+1000;const runtimes:GatewayTrafficRuntime[]=[],pids:number[]=[];
 const runtime=()=>{const r=new GatewayTrafficRuntime(options,issuer.publicKey,()=>now);runtimes.push(r);return r;};
 const child=async()=>{
  const processId=randomUUID(),home=join(directory,processId),socket=join(root,processId+'.sock'),ready=join(root,processId+'.ready'),control=join(root,processId+'.control'),requests=join(root,processId+'.requests');
  const csv=(ingress='10',egress='25',active=false)=>`# pxname,svname,bin,bout,type,scur,qcur,status\ningress,FRONTEND,0,0,0,${active?1:0},,PAUSED\npublic_https,FRONTEND,0,0,0,0,,PAUSED\ntraffic_user_staff_${route.installationId.replaceAll('-','')},BACKEND,${ingress},${egress},1,0,0,UP\ntraffic_user_public_${route.installationId.replaceAll('-','')},BACKEND,0,0,1,0,0,UP\n`;
  await writeFile(control,JSON.stringify({csv:csv()}));
  const journal=()=>new TrafficChildJournal({directory:join(home,'journal'),country:'ES',environment:'test',cellId,issuerKey:issuer.publicKey,reporterKey:reporter.privateKey});
  const spool=()=>new TrafficSpool({directory:join(home,'spool'),maxBytes:32768});
  const identity=()=>waitFor(async()=>{const id=JSON.parse(await readFile(ready,'utf8'));if(!pids.includes(id.pid)){pids.push(id.pid);t.diagnostic(`owned child PID ${id.pid}`);}return id;});
  return {processId,home,socket,ready,control,requests,csv,journal,spool,identity,start:{manifest:signManifest(manifest,issuer.privateKey,began),processId,startedAt:new Date(began).toISOString(),predecessorId:null as string|null,socket,command:process.execPath,
   args:[fileURLToPath(new URL('./fixtures/traffic-quiescent-child.ts',import.meta.url)),JSON.stringify({socket,prepared:join(home,'journal','prepared.json'),ready,control,requests})]}};
 };
 t.after(async()=>{
  try{for(const r of runtimes)try{await r.stop();}catch{t.diagnostic('runtime cleanup refused');}}
  finally{
   for(const name of await readdir(root))if(name.endsWith('.ready')){const id=JSON.parse(await readFile(join(root,name),'utf8'));if(!pids.includes(id.pid))pids.push(id.pid);}
   for(const pid of pids){try{process.kill(pid,'SIGKILL');}catch(e){assert.equal((e as NodeJS.ErrnoException).code,'ESRCH');}await waitFor(async()=>assert.throws(()=>process.kill(pid,0),/ESRCH/));}
   await rm(root,{recursive:true,force:true});
  }
 });
 const finish=(r:GatewayTrafficRuntime,id:string):Promise<void>=>{assert.equal(typeof (r as any).finish,'function','runtime must finish an owned predecessor without losing its final socket');return (r as any).finish(id);};
 return {root,directory,reports,reporter,mapping,lifetimeSocket,manifest,runtime,child,finish,setNow:(value:number)=>{now=value;}};
}

// Omitting the runtime finish, final delivery or captured-child cleanup loses the authenticated reload tail.
test('runtime closes and delivers the exact predecessor tail while its successor remains alive',async t=>{
 const f=await fixture(t),r=f.runtime(),one=await f.child(),two=await f.child();await r.recover();await r.start(one.start);const first=await one.identity();await assert.rejects(r.tick(),unavailable);
 await r.start({...two.start,predecessorId:one.processId});const second=await two.identity();f.setNow(began+2000);await writeFile(one.control,JSON.stringify({csv:one.csv('20','50')}));
 const received:unknown[]=[];const server=await serveTrafficLifetimes({socket:f.lifetimeSocket,mappings:[f.mapping],store:{async recordLifecycle(_m,e){received.push(e);}}});
 try{
  await f.finish(r,one.processId);assert.throws(()=>process.kill(first.pid,0),/ESRCH/);assert.doesNotThrow(()=>process.kill(second.pid,0));
  const saved=await one.journal().restore();assert.ok(saved?.end);const end=verifyTrafficLifecycle(saved.end,f.reporter.publicKey);assert.equal(end.finalSequence,2);assert.equal(end.endedAt,'2026-11-02T00:00:02.000Z');
  assert.deepEqual(received,[saved.start,saved.end]);assert.deepEqual(await one.journal().pending(),[]);assert.equal((await one.spool().pending()).length,2,'exported reports stay retained until country collection acknowledges their removal');
  const reports=await Promise.all([1,2].map(async n=>verifyTrafficReport(JSON.parse(await readFile(join(f.reports,one.processId+'.'+n+'.json'),'utf8')),f.reporter.publicKey)));
  assert.deepEqual(reports.map(v=>[v.sequence,v.complete,v.entries[0]?.ingress,v.entries[0]?.egress]),[[1,true,'10','25'],[2,true,'10','25']]);
  const successor=verifyTrafficLifecycle((await two.journal().restore())!.start,f.reporter.publicKey);assert.equal(successor.predecessorId,one.processId);assert.equal((await one.spool().restore()).complete,true);
 }finally{await server.close();}
});

test('failed country delivery retains the exact final record after reaping the predecessor',async t=>{
 const f=await fixture(t),r=f.runtime(),c=await f.child();await r.recover();await r.start(c.start);const id=await c.identity();await assert.rejects(f.finish(r,c.processId),unavailable);
 assert.throws(()=>process.kill(id.pid,0),/ESRCH/);const saved=await c.journal().restore();assert.ok(saved?.end);const reports=await c.spool().pending();assert.equal(reports.length,1);
 const received:unknown[]=[];const server=await serveTrafficLifetimes({socket:f.lifetimeSocket,mappings:[f.mapping],store:{async recordLifecycle(_m,e){received.push(e);}}});
 try{await r.tick();assert.deepEqual(received,[saved.start,saved.end]);assert.deepEqual(JSON.parse(await readFile(join(f.reports,c.processId+'.1.json'),'utf8')),reports[0]);assert.equal((await c.spool().restore()).complete,true);}finally{await server.close();}
});

test('failed drain still reaps the captured predecessor and never invents a final record',async t=>{
 const f=await fixture(t),r=f.runtime(),c=await f.child();await r.recover();await r.start(c.start);const id=await c.identity();await writeFile(c.control,JSON.stringify({disconnect:true,csv:c.csv()}));
 await assert.rejects(f.finish(r,c.processId),unavailable);assert.throws(()=>process.kill(id.pid,0),/ESRCH/);assert.equal((await c.journal().restore())?.end,null);assert.equal((await c.spool().restore()).complete,false);
});

for(const action of ['withdraw','expire'] as const)test(`${action} interrupts predecessor draining without closing its missing tail`,async t=>{
 const f=await fixture(t),r=f.runtime(),one=await f.child();await r.recover();await r.start(one.start);const first=await one.identity();
 await writeFile(one.control,JSON.stringify({csv:one.csv('10','25',true)}));const finish=assert.rejects(f.finish(r,one.processId),unavailable);await waitFor(()=>readFile(one.requests));
 if(action==='expire')f.setNow(f.manifest.expiresAt);
 const stopping=r[action]();await waitFor(async()=>assert.throws(()=>process.kill(first.pid,0),/ESRCH/));await Promise.all([finish,stopping]);assert.equal((await one.journal().restore())?.end,null);assert.equal((await one.spool().restore()).complete,false);
});

test('recovered history never grants finish authority over another runtime owned process',async t=>{
 const f=await fixture(t),owner=f.runtime(),c=await f.child();await owner.recover();await owner.start(c.start);const id=await c.identity();const recovered=f.runtime();await recovered.recover();
 await assert.rejects(f.finish(recovered,c.processId),unavailable);assert.doesNotThrow(()=>process.kill(id.pid,0));assert.equal((await c.journal().restore())?.end,null);
 await assert.rejects(f.finish(owner,randomUUID()),unavailable);assert.doesNotThrow(()=>process.kill(id.pid,0));
});

test('changed state root refuses final closure and still reaps its captured child',async t=>{
 const f=await fixture(t),r=f.runtime(),c=await f.child();await r.recover();await r.start(c.start);const id=await c.identity();const previous=f.directory+'-previous';await rename(f.directory,previous);await mkdir(f.directory,{mode:0o700});
 try{await assert.rejects(f.finish(r,c.processId),unavailable);assert.throws(()=>process.kill(id.pid,0),/ESRCH/);await assert.rejects(readFile(c.requests),/ENOENT/);}
 finally{await rm(f.directory,{recursive:true});await rename(previous,f.directory);}
 assert.equal((await c.journal().restore())?.end,null);assert.equal((await c.spool().restore()).complete,false);
});
