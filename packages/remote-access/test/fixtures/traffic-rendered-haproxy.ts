import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {chmod,lstat,mkdir,mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {createServer as httpServer} from 'node:http';
import {createServer as httpsServer,request} from 'node:https';
import {type Socket} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {renderHaproxy} from '../../src/config.ts';
import {GatewayTrafficRuntime} from '../../src/gateway-traffic-runtime.ts';
import {signManifest,type ReportingGatewayManifest} from '../../src/manifest.ts';
import {createPublicGate} from '../../src/public-gate.ts';
import {probeTarget} from '../../src/probe.ts';
import {TrafficChildJournal} from '../../src/traffic-child-journal.ts';
import {verifyTrafficLifecycle} from '../../src/traffic-lifecycle.ts';
import {serveTrafficLifetimes} from '../../src/traffic-lifetime-transport.ts';
import {verifyTrafficReport} from '../../src/traffic-report.ts';
import {readTrafficSocket} from '../../src/traffic-socket.ts';
import {TrafficSpool} from '../../src/traffic-spool.ts';
import {TrafficSampler} from '../../src/traffic-sampler.ts';

async function waitFor<T>(read:()=>Promise<T>):Promise<T>{
 const until=Date.now()+5000;
 for(;;)try{return await read();}catch(error){if(Date.now()>=until)throw error;await delay(10);}
}

// Counting probes, shared inner hops or a sibling's backend must disagree with the signed per-child user totals.
test('rendered TLS gateway separates real trusted probes and both venues user bytes through reload and crash',async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'g-tls-'))),sockets=new Set<Socket>();
 const servers:Array<ReturnType<typeof httpServer>|ReturnType<typeof httpsServer>>=[];
 let runtime:GatewayTrafficRuntime|undefined,country:Awaited<ReturnType<typeof serveTrafficLifetimes>>|undefined;
 const pids:number[]=[],addresses:string[]=[],lifetimes:unknown[]=[],held=new Set<()=>void>();
 t.after(async()=>{
  for(const socket of sockets)socket.destroy();
  try{await runtime?.stop();}finally{
   await country?.close();
   await Promise.all(servers.map(async server=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}));
   for(const address of addresses)execFileSync('ip',['address','del',address+'/32','dev','lo']);
   await rm(root,{recursive:true,force:true});
   for(const pid of pids)assert.throws(()=>process.kill(pid,0),/ESRCH/);
   assert.equal(sockets.size,0);assert.ok(servers.every(server=>!server.listening));
   t.diagnostic('owned listeners, children, loopback aliases and temporary state removed');
  }
 });
 const listen=async(server:typeof servers[number],port:number,address:string)=>{
  servers.push(server);server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  await new Promise<void>((r,j)=>{server.once('error',j);server.listen(port,address,()=>{server.removeListener('error',j);r();});});
 };
 const routes=['sol','luna'].map((name,i)=>({installationId:randomUUID(),venueId:randomUUID(),revision:1,staffHostname:`staff.${name}.example.test`,publicHostname:`${name}.example.test`,address:`10.77.0.${i+2}`,port:19443,peerPublicKey:randomBytes(32).toString('base64')}));
 for(const route of routes){execFileSync('ip',['address','add',route.address+'/32','dev','lo']);addresses.push(route.address);}
 const certs=join(root,'certs');await mkdir(certs,{mode:0o700});
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=sol.example.test','-addext',`subjectAltName=${routes.flatMap(r=>[r.staffHostname,r.publicHostname]).map(h=>'DNS:'+h).join(',')}`,'-keyout',join(root,'key.pem'),'-out',join(root,'cert.pem')],{stdio:'ignore'});
 const key=await readFile(join(root,'key.pem')),cert=await readFile(join(root,'cert.pem'));
 await writeFile(join(certs,'venues.pem'),Buffer.concat([key,cert]));
 const observed:Array<{venueId:string;path:string|undefined;host:string|undefined}>=[];
 for(const route of routes)await listen(httpsServer({key,cert},(req,res)=>{
  observed.push({venueId:route.venueId,path:req.url,host:req.headers.host});res.setHeader('Content-Type','application/json');
  if(req.url==='/held'){
   res.write('{"venueId":');const finish=()=>{held.delete(finish);res.end(JSON.stringify(route.venueId)+'}');};held.add(finish);res.once('close',()=>held.delete(finish));
  }else res.end(JSON.stringify({venueId:route.venueId}));
 }),route.port,route.address);
 const gate=createPublicGate({key:randomBytes(32),ca:cert,routes:()=>routes,difficulty:8});
 await listen(httpServer(gate.handle),19083,'127.0.0.1');
 const issuer=generateKeyPairSync('ed25519'),reporter=generateKeyPairSync('ed25519'),cellId=randomUUID();
 const directory=join(root,'state'),reports=join(root,'reports'),countryDirectory=join(root,'country');
 for(const path of [directory,reports,countryDirectory])await mkdir(path,{mode:0o700});await chmod(reports,0o2750);
 const mapping={country:'ES' as const,environment:'test' as const,cellId,directory:reports,writerUid:process.geteuid!(),readerGid:process.getegid!()},lifetimeSocket=join(countryDirectory,'life.sock');
 country=await serveTrafficLifetimes({socket:lifetimeSocket,mappings:[mapping],store:{async recordLifecycle(_m,envelope){lifetimes.push(envelope);}}});
 let now=Date.parse('2026-11-01T23:59:58.000Z');
 runtime=new GatewayTrafficRuntime({directory,mapping,lifetimeSocket,maxBytes:262144,reporterKey:reporter.privateKey},issuer.publicKey,()=>now);await runtime.recover();
 const began=now-1000;
 const manifest:ReportingGatewayManifest={version:2,audience:'waitron-cloud-gateway',cellId,sequence:1,issuedAt:began,expiresAt:began+120000,reporter:{gatewayId:randomUUID(),generation:1},routes};
 const backend=(kind:'user'|'ops',channel:'staff'|'public',index:number)=>`traffic_${kind}_${channel}_${routes[index]!.installationId.replaceAll('-','')}`;
 const backends=(kind:'user'|'ops')=>new Map(routes.flatMap((_,i)=>(['staff','public'] as const).map(channel=>[backend(kind,channel,i),`${i}:${channel}`])));
 const start=async(predecessorId:string|null)=>{
  const processId=randomUUID(),socket=join(root,processId+'.sock'),config=join(root,processId+'.cfg');
  await writeFile(config,renderHaproxy(routes,{port:19080,publicTlsPort:19082,gatePort:19083,certificateDirectory:certs,traffic:{socket,operationalSources:['127.0.0.1']}}));
  // Validation and traffic use the exact renderer output, including both TLS hops and shared limits.
  execFileSync('haproxy',['-c','-f',config],{stdio:'pipe'});
  const startedAt=new Date(now).toISOString();
  await runtime!.start({manifest:signManifest(manifest,issuer.privateKey,began),processId,startedAt,predecessorId,socket,command:'haproxy',args:['-db','-f',config]});
  const pid=runtime!.pid(processId)!;pids.push(pid);t.diagnostic('owned HAProxy PID '+pid);await waitFor(()=>lstat(socket));
  return {processId,pid,socket,startedAt};
 };
 type Counter={ingress:string;egress:string};
 // Read the observed CSV independently of the production counter parser used by the sampler.
 const measured=(csv:string,kind:'user'|'ops')=>{
  const lines=csv.trim().split('\n'),header=lines.shift()!.slice(2).split(','),values=new Map<string,Counter>();
  for(const [backend,name]of backends(kind)){
   const rows=lines.map(line=>line.split(',')).filter(row=>row[header.indexOf('pxname')]===backend&&row[header.indexOf('svname')]==='BACKEND');
   assert.equal(rows.length,1,'each known outer backend must have exactly one observed total');
   values.set(name,{ingress:rows[0]![header.indexOf('bin')]!,egress:rows[0]![header.indexOf('bout')]!});
  }
  return values;
 };
 const counters=async(child:{socket:string},kind:'user'|'ops')=>measured(await readTrafficSocket(child.socket),kind);
 const settled=async(child:{socket:string},kind:'user'|'ops')=>waitFor(async()=>{
  const csv=await readTrafficSocket(child.socket),lines=csv.trim().split('\n'),header=lines.shift()!.slice(2).split(',');
  for(const line of lines){const row=line.split(',');if(['FRONTEND','BACKEND'].includes(row[header.indexOf('svname')]!))assert.equal(row[header.indexOf('scur')],'0','closed TLS sessions must settle before comparing cumulative totals');}
  return measured(csv,kind);
 });
 const tick=async()=>{now+=100;await runtime!.tick();};
 const allZero=(values:Map<string,Counter>)=>{for(const counter of values.values())assert.deepEqual(counter,{ingress:'0',egress:'0'},'trusted probes must leave every user backend at zero');};
 const positive=(values:Map<string,Counter>)=>{assert.equal(values.size,4);for(const counter of values.values()){assert.ok(BigInt(counter.ingress)>0n,'every selected TLS backend must carry measured ingress');assert.ok(BigInt(counter.egress)>0n,'every selected TLS backend must carry measured egress');}};
 const totals=async(processId:string)=>{
  const values=(await new TrafficSpool({directory:join(directory,processId,'spool'),maxBytes:262144}).pending()).map(e=>verifyTrafficReport(e,reporter.publicKey));
  const sums=new Map<string,Counter>();
  for(const report of values){assert.equal(report.processId,processId);assert.equal(report.complete,true);for(const entry of report.entries){
   const index=routes.findIndex(r=>r.installationId===entry.installationId);assert.ok(index>=0);assert.equal(entry.venueId,routes[index]!.venueId);
   const name=`${index}:${entry.channel}`,previous=sums.get(name)??{ingress:'0',egress:'0'};
   sums.set(name,{ingress:String(BigInt(previous.ingress)+BigInt(entry.ingress)),egress:String(BigInt(previous.egress)+BigInt(entry.egress))});
  }}
  return {values,sums};
 };
 // Probes use their actual challenge solver and certificate checks. Only their source address selects operational counters.
 const probe=async()=>{for(const route of routes){const result=await probeTarget(route,{ca:cert,connect:()=>({address:'127.0.0.1',family:4,port:19080})});assert.equal(result.staff.status,'healthy',JSON.stringify(result.staff));assert.equal(result.public.status,'healthy',JSON.stringify(result.public));}};
 const send=async(index:number,channel:'staff'|'public',path='/public/availability',body?:string,cookie?:string)=>{
  const host=channel==='staff'?routes[index]!.staffHostname:routes[index]!.publicHostname;
  return new Promise<{status:number;body:string;cookie:string|undefined}>((resolve,reject)=>{
   const req=request({host:'127.0.0.1',localAddress:'127.0.0.2',port:19080,servername:host,ca:cert,agent:false,path,method:body?'POST':'GET',headers:{host,'x-waitron-client-ip':'127.0.0.1',...(body?{'content-type':'application/json','content-length':Buffer.byteLength(body)}:{}),...(cookie?{cookie}:{})}},res=>{
    let value='';res.on('data',chunk=>value+=chunk);res.once('error',reject);res.once('end',()=>resolve({status:res.statusCode!,body:value,cookie:res.headers['set-cookie']?.[0]?.split(';')[0]}));
   });req.once('error',reject);req.setTimeout(5000,()=>req.destroy(new Error('fixture TLS request timeout')));req.end(body);
  });
 };
 const user=async(index:number)=>{
  const staff=await send(index,'staff');assert.equal(staff.status,200);assert.equal(JSON.parse(staff.body).venueId,routes[index]!.venueId);
  assert.equal((await send(index,'public')).status,403);
  const challenge=await send(index,'public','/_cloud/challenge');assert.equal(challenge.status,200);
  const {challenge:value,difficulty}=JSON.parse(challenge.body);let nonce=0;
  const {createHash}=await import('node:crypto');while(createHash('sha256').update(`${value}:${nonce}`).digest().readUInt32BE(0)>=2**(32-difficulty)){nonce++;assert.ok(nonce<1000000);}
  const answer=await send(index,'public','/_cloud/solve',JSON.stringify({challenge:value,nonce}));assert.equal(answer.status,204);assert.ok(answer.cookie);
  const publicReply=await send(index,'public','/public/availability',undefined,answer.cookie);assert.equal(publicReply.status,200);assert.equal(JSON.parse(publicReply.body).venueId,routes[index]!.venueId);
  assert.equal((await send(1-index,'public','/public/availability',undefined,answer.cookie)).status,403,'sibling cookie must not authorize a venue');
 };
 const first=await start(null);
 await probe();positive(await settled(first,'ops'));allZero(await counters(first,'user'));await tick();
 allZero((await totals(first.processId)).sums);assert.ok(observed.some(v=>v.venueId===routes[0]!.venueId)&&observed.some(v=>v.venueId===routes[1]!.venueId));
 await user(0);const onlyFirst=await settled(first,'user');assert.deepEqual(onlyFirst.get('1:staff'),{ingress:'0',egress:'0'},'a sibling staff route must remain unused');
 await user(1);
 let expected=await settled(first,'user');positive(expected);await tick();
 assert.deepEqual((await totals(first.processId)).sums,expected,'signed user ingress/egress must equal only the four mapped outer backends');
 const repeated=await totals(first.processId);await tick();assert.deepEqual((await totals(first.processId)).sums,repeated.sums,'equal cumulative counters add zero');
 const longRequest=send(0,'staff','/held');const longResult=longRequest.then(value=>({value}),error=>({error}));
 await waitFor(async()=>assert.equal(held.size,1));now=Date.parse('2026-11-01T23:59:59.800Z');await tick();
 now=Date.parse('2026-11-02T00:00:00.100Z');for(const finish of [...held])finish();const longReply=await longResult;
 assert.ok('value'in longReply);assert.equal(longReply.value.status,200);assert.equal(JSON.parse(longReply.value.body).venueId,routes[0]!.venueId);
 expected=await settled(first,'user');await tick();
 const crossed=await totals(first.processId);assert.deepEqual(crossed.sums,expected);
 assert.ok(crossed.values.some(report=>report.from<'2026-11-02T00:00:00.000Z'&&report.until>'2026-11-02T00:00:00.000Z'),'a live TLS request crosses the injected UTC midnight sample boundary');
 const spool=new TrafficSpool({directory:join(directory,first.processId,'spool'),maxBytes:262144}),cursor=await spool.cursor();assert.ok(cursor);
 const restarted=new TrafficSampler({spool,envelope:signManifest(manifest,issuer.privateKey,began),issuerKey:issuer.publicKey,cellId,processId:first.processId,startedAt:first.startedAt,key:reporter.privateKey,fresh:false});
 await user(0);expected=await settled(first,'user');
 now+=100;await restarted.sampleSocket(first.socket,()=>now);const afterRestart=await totals(first.processId);
 assert.equal(afterRestart.values.at(-1)!.sequence,cursor.sequence+1);assert.equal(afterRestart.values.at(-1)!.from,cursor.until);assert.deepEqual(afterRestart.sums,expected,'restarted sampler resumes saved counters without billing the cumulative snapshot again');
 const next=await start(first.processId);now+=100;await runtime.finish(first.processId);
 assert.throws(()=>process.kill(first.pid,0),/ESRCH/);assert.doesNotThrow(()=>process.kill(next.pid,0));
 assert.deepEqual((await totals(first.processId)).sums,expected,'reload preserves the predecessor totals');
 const journal=(id:string)=>new TrafficChildJournal({directory:join(directory,id,'journal'),country:'ES',environment:'test',cellId,issuerKey:issuer.publicKey,reporterKey:reporter.privateKey});
 const saved=await journal(first.processId).restore();assert.ok(saved?.end);const end=verifyTrafficLifecycle(saved.end,reporter.publicKey),oldReports=(await totals(first.processId)).values;
 assert.equal(end.finalSequence,oldReports.at(-1)!.sequence);assert.equal(end.endedAt,oldReports.at(-1)!.until);
 assert.equal(verifyTrafficLifecycle((await journal(next.processId).restore())!.start,reporter.publicKey).predecessorId,first.processId);
 await probe();positive(await settled(next,'ops'));allZero(await counters(next,'user'));
 await user(1);await user(0);const successorExpected=await settled(next,'user');positive(successorExpected);await tick();
 assert.deepEqual((await totals(next.processId)).sums,successorExpected,'successor never inherits predecessor or inner-hop bytes');
 assert.notEqual(first.processId,next.processId);assert.deepEqual(lifetimes.slice(0,2),[saved.start,saved.end]);
 process.kill(next.pid,'SIGKILL');await waitFor(async()=>assert.equal(runtime!.pid(next.processId),undefined));await tick();
 assert.equal((await journal(next.processId).restore())?.end,null);assert.equal((await new TrafficSpool({directory:join(directory,next.processId,'spool'),maxBytes:262144}).restore()).complete,false);
 t.diagnostic('real rendered TLS: four operational backends positive, four user backends zero after probes; exact per-venue/channel deltas, live request across injected UTC midnight, restarted sampler, independent reload identities and incomplete crash history verified');
 t.diagnostic('component scope: injected accounting clock, real TLS and signed private records; database, three-date trial coverage and receipt wrapper remain unqualified');
});
