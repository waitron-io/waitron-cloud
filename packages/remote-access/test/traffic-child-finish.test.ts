import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
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
 const csv=(ingress='10',egress='25')=>`# pxname,svname,bin,bout,type,scur,qcur,status\ningress,FRONTEND,0,0,0,0,,PAUSED\npublic_https,FRONTEND,0,0,0,0,,PAUSED\ntraffic_user_staff_${route.installationId.replaceAll('-','')},BACKEND,${ingress},${egress},1,0,0,UP\ntraffic_user_public_${route.installationId.replaceAll('-','')},BACKEND,0,0,1,0,0,UP\n`;
 await writeFile(control,JSON.stringify({csv:csv()}));
 const args=[fileURLToPath(new URL('./fixtures/traffic-quiescent-child.ts',import.meta.url)),JSON.stringify({socket,prepared:join(directory,'prepared.json'),ready,control,requests,release,ignoreTerm})];
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

// Closing before the paused, drained final sample or dropping the signed end must fail these checks.
test('quiescent finish captures tail bytes, retains the signed end and reaps the owned child',async t=>{
 const f=await fixture(t);let n=0;const child=f.child({now:()=>Date.parse(startedAt)+1000*++n});await child.start();const id=await f.identity();await child.sample();
 await writeFile(f.control,JSON.stringify({csv:f.csv('20','50')}));assert.equal(typeof child.finish,'function','quiescent child finish must exist');await child.finish();
 assert.equal(child.running,false);assert.throws(()=>process.kill(id.pid,0),/ESRCH/);
 const reports=(await f.spool.pending()).map(e=>verifyTrafficReport(e,f.reporter.publicKey));assert.deepEqual(reports.map(r=>[r.sequence,r.complete,r.entries[0]?.ingress,r.entries[0]?.egress]),[[1,true,'10','25'],[2,true,'10','25']]);
 const saved=await f.journal().restore();assert.ok(saved?.end);const end=verifyTrafficLifecycle(saved.end,f.reporter.publicKey);assert.equal(end.finalSequence,2);assert.equal(end.endedAt,'2026-11-02T00:00:02.000Z');
 assert.equal((await f.spool.restore()).complete,true);await assert.rejects(readFile(join(f.root,'spool','gap')),/ENOENT/);
 const received:unknown[]=[];const server=await serveTrafficLifetimes({socket:f.lifetimeSocket,mappings:[f.mapping],store:{async recordLifecycle(_mapping,envelope){received.push(envelope);}}});
 try{await child.flush();assert.deepEqual(received,[saved.start,saved.end]);assert.equal((await readdir(f.mapping.directory)).length,2);}finally{await server.close();}
});
test('a crashed child cannot gain a final lifetime through finish',async t=>{
 const f=await fixture(t),child=f.child();await child.start();const id=await f.identity();await child.sample();process.kill(id.pid,'SIGKILL');await waitFor(async()=>assert.equal(child.running,false));
 assert.equal(typeof child.finish,'function');await assert.rejects(child.finish(),unavailable);assert.equal((await f.journal().restore())?.end,null);assert.equal((await f.spool.restore()).complete,false);
});
test('lost private stats connection leaves the child unclosed and incomplete',async t=>{
 const f=await fixture(t),child=f.child();await child.start();await f.identity();await child.sample();await writeFile(f.control,JSON.stringify({disconnect:true,csv:f.csv()}));
 assert.equal(typeof child.finish,'function');await assert.rejects(child.finish(),unavailable);assert.equal((await f.journal().restore())?.end,null);assert.equal((await f.spool.restore()).complete,false);
});
test('a full final-report spool refuses a signed end instead of losing tail bytes',async t=>{
 const f=await fixture(t),spool=new TrafficSpool({directory:join(f.root,'small-spool'),maxBytes:1024}),child=f.child({spool});await child.start();await f.identity();
 assert.equal(typeof child.finish,'function');await assert.rejects(child.finish(),unavailable);assert.equal((await f.journal().restore())?.end,null);assert.equal((await spool.restore()).complete,false);
});
test('withdrawal interrupts an active quiescence read without signing an end',async t=>{
 const f=await fixture(t),child=f.child();await child.start();const id=await f.identity();
 await writeFile(f.control,JSON.stringify({csv:f.csv().replace('ingress,FRONTEND,0,0,0,0,','ingress,FRONTEND,0,0,0,1,')}));
 assert.equal(typeof child.finish,'function');const closing=child.finish(),refused=assert.rejects(closing,unavailable);await waitFor(()=>readFile(f.requests));
 await child.withdraw();await refused;assert.throws(()=>process.kill(id.pid,0),/ESRCH/);assert.equal((await f.journal().restore())?.end,null);assert.equal((await f.spool.restore()).complete,false);
});
