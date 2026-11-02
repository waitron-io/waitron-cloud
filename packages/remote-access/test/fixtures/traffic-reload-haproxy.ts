import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {chmod,chown,lstat,mkdir,mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {connect,createServer,type Socket} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {GatewayTrafficRuntime} from '../../src/gateway-traffic-runtime.ts';
import {TrafficChildJournal} from '../../src/traffic-child-journal.ts';
import {TrafficSpool} from '../../src/traffic-spool.ts';
import {signManifest,type ReportingGatewayManifest} from '../../src/manifest.ts';
import {verifyTrafficReport} from '../../src/traffic-report.ts';
import {verifyTrafficLifecycle} from '../../src/traffic-lifecycle.ts';
import {serveTrafficLifetimes} from '../../src/traffic-lifetime-transport.ts';
import {readTrafficSocket} from '../../src/traffic-socket.ts';

async function waitFor<T>(read:()=>Promise<T>):Promise<T>{const until=Date.now()+4000;for(;;){try{return await read();}catch(e){if(Date.now()>until)throw e;await delay(10);}}}

// Losing the old socket, failing to reap it or attributing its tail to the successor must break these fixed TCP totals.
test('real HAProxy reload retains both child identities and final tail bytes without soft-stop signalling',async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'hrt-'))),sockets=new Set<Socket>();
 const backend=createServer(s=>{sockets.add(s);s.once('close',()=>sockets.delete(s));s.pipe(s);});
 let runtime:GatewayTrafficRuntime|undefined,country:Awaited<ReturnType<typeof serveTrafficLifetimes>>|undefined;
 t.after(async()=>{
  for(const s of sockets)s.destroy();try{await runtime?.stop();}finally{await country?.close();if(backend.listening)await new Promise<void>(r=>backend.close(()=>r()));await rm(root,{recursive:true,force:true});}
 });
 await new Promise<void>(r=>backend.listen(19081,'127.0.0.1',r));
 const issuer=generateKeyPairSync('ed25519'),reporter=generateKeyPairSync('ed25519'),cellId=randomUUID(),installationId=randomUUID(),directory=join(root,'state'),reports=join(root,'reports');
 for(const path of [directory,reports,join(root,'country')])await mkdir(path,{mode:0o700});await chown(reports,process.geteuid!(),process.getegid!());await chmod(reports,0o2750);
 const began=Date.now()-1000,route={installationId,venueId:randomUUID(),revision:1,staffHostname:'staff.sol.example.test',publicHostname:'sol.example.test',address:'10.77.0.2',port:443,peerPublicKey:randomBytes(32).toString('base64')};
 const manifest:ReportingGatewayManifest={version:2,audience:'waitron-cloud-gateway',cellId,sequence:1,issuedAt:began,expiresAt:began+60000,reporter:{gatewayId:randomUUID(),generation:1},routes:[route]};
 const mapping={country:'ES' as const,environment:'test' as const,cellId,directory:reports,writerUid:process.geteuid!(),readerGid:process.getegid!()},lifetimeSocket=join(root,'country','life.sock'),received:unknown[]=[];
 country=await serveTrafficLifetimes({socket:lifetimeSocket,mappings:[mapping],store:{async recordLifecycle(_m,e){received.push(e);}}});
 runtime=new GatewayTrafficRuntime({directory,mapping,lifetimeSocket,maxBytes:32768,reporterKey:reporter.privateKey},issuer.publicKey);await runtime.recover();
 const name=(channel:string)=>`traffic_user_${channel}_${installationId.replaceAll('-','')}`;
 const start=async(predecessorId:string|null)=>{
  const processId=randomUUID(),socket=join(root,processId+'.sock'),config=join(root,processId+'.cfg'),home=join(directory,processId);
  await writeFile(config,`global\n stats socket ${socket} mode 600 level operator\ndefaults\n mode tcp\n timeout connect 1s\n timeout client 10s\n timeout server 10s\nfrontend ingress\n bind 127.0.0.1:19080\n default_backend ${name('staff')}\nfrontend public_https\n bind 127.0.0.1:19082\n default_backend ${name('public')}\nbackend ${name('staff')}\n server echo 127.0.0.1:19081\nbackend ${name('public')}\n server echo 127.0.0.1:19081\n`);
  await runtime!.start({manifest:signManifest(manifest,issuer.privateKey,began),processId,startedAt:new Date(Date.now()).toISOString(),predecessorId,socket,command:'haproxy',args:['-db','-f',config]});
  const pid=runtime!.pid(processId)!;t.diagnostic(`owned HAProxy PID ${pid}`);await waitFor(()=>lstat(socket));
  return {processId,pid,socket,journal:()=>new TrafficChildJournal({directory:join(home,'journal'),country:'ES',environment:'test',cellId,issuerKey:issuer.publicKey,reporterKey:reporter.privateKey}),spool:()=>new TrafficSpool({directory:join(home,'spool'),maxBytes:32768})};
 };
 const open=async(port:number)=>{const c=connect(port,'127.0.0.1');sockets.add(c);c.once('close',()=>sockets.delete(c));await new Promise<void>((r,j)=>{c.once('connect',r);c.once('error',j);});return c;};
 const echo=async(c:Socket,value:string)=>{const got=new Promise<Buffer>((r,j)=>{c.once('data',r);c.once('error',j);});c.write(value);assert.equal((await got).toString(),value);};
 const old=await start(null),staff=await open(19080),publicClient=await open(19082);await echo(staff,'before-pause');await echo(publicClient,'public');await runtime.tick();
 const next=await start(old.processId);assert.doesNotThrow(()=>process.kill(old.pid,0));assert.doesNotThrow(()=>process.kill(next.pid,0));
 assert.equal(typeof (runtime as any).finish,'function','real reload must use runtime quiescent finish');
 let finished=false;const finishing=(runtime as any).finish(old.processId).then(()=>{finished=true;});
 await delay(100);assert.equal(finished,false,'old live sessions must keep its final sample open');
 const newStaff=await open(19080),newPublic=await open(19082);await echo(newStaff,'successor');await echo(newPublic,'next');
 await echo(staff,'after-pause');await echo(publicClient,'tail');
 const ended=[staff,publicClient].map(c=>new Promise<void>(r=>c.once('close',()=>r())));staff.end();publicClient.end();await Promise.all(ended);await finishing;
 assert.throws(()=>process.kill(old.pid,0),/ESRCH/);assert.doesNotThrow(()=>process.kill(next.pid,0));
 const counters=async()=>{const csv=await readTrafficSocket(next.socket);const rows=csv.trim().split('\n'),header=rows.shift()!.slice(2).split(',');return rows.map(r=>r.split(',')).filter(r=>r[header.indexOf('svname')]==='BACKEND').map(r=>[r[header.indexOf('pxname')],r[header.indexOf('bin')],r[header.indexOf('bout')]]);};
 t.diagnostic('successor open-session counters '+JSON.stringify(await counters()));
 const nextEnded=[newStaff,newPublic].map(c=>new Promise<void>(r=>c.once('close',()=>r())));newStaff.end();newPublic.end();await Promise.all(nextEnded);
 t.diagnostic('successor closed-session counters '+JSON.stringify(await counters()));await runtime.tick();
 const totals=async(id:string)=>{
  const envelopes=await new TrafficSpool({directory:join(directory,id,'spool'),maxBytes:32768}).pending();const values=envelopes.map(e=>verifyTrafficReport(e,reporter.publicKey));
  assert.ok(values.length>0);assert.ok(values.every(v=>v.complete));const sums=new Map<string,bigint>();for(const v of values)for(const e of v.entries)sums.set(e.channel,(sums.get(e.channel)??0n)+BigInt(e.ingress)+BigInt(e.egress));return {values,sums:[...sums]};
 };
 const first=await totals(old.processId),second=await totals(next.processId);assert.deepEqual(first.sums,[['staff',46n],['public',20n]]);assert.deepEqual(second.sums,[['staff',18n],['public',8n]]);
 const oldSaved=await old.journal().restore();assert.ok(oldSaved?.end);const end=verifyTrafficLifecycle(oldSaved.end,reporter.publicKey);assert.equal(end.finalSequence,2);assert.equal(end.endedAt,first.values[1]!.until);
 assert.equal(verifyTrafficLifecycle((await next.journal().restore())!.start,reporter.publicKey).predecessorId,old.processId);assert.deepEqual(received.slice(0,2),[oldSaved.start,oldSaved.end]);
 process.kill(next.pid,'SIGKILL');await waitFor(async()=>assert.equal(runtime!.pid(next.processId),undefined));await runtime.tick();assert.equal((await next.journal().restore())?.end,null);assert.equal((await next.spool().restore()).complete,false);
 t.diagnostic('Old child: staff46/public20 bytes; successor: staff18/public8. Final sequence2 retained; crashed successor incomplete. Minimal TCP only; rendered TLS/probe/DB proof remains.');
});
