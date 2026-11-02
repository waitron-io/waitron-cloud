import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {chmod,lstat,mkdir,mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {createServer as httpServer} from 'node:http';
import {createServer as httpsServer,request} from 'node:https';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {venueServiceFixture,event} from '../../packages/registration/test/fixtures/venue-service.ts';
import {transaction} from '../../packages/registration/src/transaction.ts';
import {readTrialUsage} from '../../packages/registration/src/billing-trial-usage.ts';
import {trialWasUsed} from '../../packages/registration/src/billing-trials.ts';
import {RemoteAccessStore} from '../../packages/remote-access/src/placement.ts';
import {registerForwardReporter} from '../../packages/remote-access/src/forward-observations.ts';
import {renderHaproxy} from '../../packages/remote-access/src/config.ts';
import {GatewayTrafficRuntime} from '../../packages/remote-access/src/gateway-traffic-runtime.ts';
import {signManifest} from '../../packages/remote-access/src/manifest.ts';
import {createPublicGate} from '../../packages/remote-access/src/public-gate.ts';
import {probeTarget} from '../../packages/remote-access/src/probe.ts';
import {collectTraffic} from '../../packages/remote-access/src/traffic-collector.ts';
import {TrafficCoverageStore} from '../../packages/remote-access/src/traffic-coverage.ts';
import {serveTrafficLifetimes} from '../../packages/remote-access/src/traffic-lifetime-transport.ts';
import {readTrafficSocket} from '../../packages/remote-access/src/traffic-socket.ts';
import {TrafficStore} from '../../packages/remote-access/src/traffic-store.ts';
import {TrafficSpool} from '../../packages/remote-access/src/traffic-spool.ts';

const begin=Date.parse('2026-11-01T00:00:00.000Z'),end=Date.parse('2026-12-01T00:00:00.000Z'),tenMinutes=600000;
async function waitFor(read){const until=Date.now()+5000;for(;;)try{return await read();}catch(error){if(Date.now()>=until)throw error;await delay(10);}}

// Wrong probe classification, crossed venues, duplicate replay or an uncovered interval must change the stored trial outcome.
for(const {users,crash} of [{users:false,crash:false},{users:true,crash:false},{users:true,crash:true}])test(`real rendered gateway and PostgreSQL prove ${crash?'an incomplete crashed child':users?'three user dates':'zero operational dates'} in the exact stored trial`,{timeout:150000},async t=>{
 const f=await venueServiceFixture(),root=await realpath(await mkdtemp(join(tmpdir(),'g-trial-')));
 const servers=[],sockets=new Set(),addresses=[],pids=[];
 let runtime,country,now=begin,routeManifest;
 t.after(async()=>{
  for(const socket of sockets)socket.destroy();
  try{await runtime?.stop();}finally{
   await country?.close();
   await Promise.all(servers.map(async server=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}));
   for(const address of addresses)execFileSync('ip',['address','del',address+'/32','dev','lo']);
   await f.close();await rm(root,{recursive:true,force:true});
   for(const pid of pids)assert.throws(()=>process.kill(pid,0),/ESRCH/);
   assert.equal(sockets.size,0);assert.ok(servers.every(server=>!server.listening));
   t.diagnostic('owned gateway children, listeners, aliases, database schema and temporary state removed');
  }
 });
 // Both clock consumers use one controlled UTC instant; PostgreSQL still executes every authority and ledger query.
 await f.pool.query('CREATE TABLE fixture_clock(at timestamptz NOT NULL)');
 await f.pool.query('INSERT INTO fixture_clock VALUES($1)',[new Date(now)]);
 await f.pool.query(`CREATE FUNCTION ${f.schema}.clock_timestamp() RETURNS timestamptz LANGUAGE SQL STABLE AS 'SELECT at FROM ${f.schema}.fixture_clock'`);
 const search=`SET search_path=${f.schema},pg_catalog`;
 f.pool.on('connect',client=>{void client.query(search);});f.peer.on('connect',client=>{void client.query(search);});await f.pool.query(search);
 const clock=async value=>{now=value;await f.pool.query('UPDATE fixture_clock SET at=$1',[new Date(now)]);};
 for(const venueId of f.venues)await f.store.transition(f.scope,event(),{type:'start_trial',venueId,level:'connected',on:'2026-11-01'});
 const trials=await Promise.all(f.venues.map(async id=>(await f.store.history(f.scope,id)).trials[0]));
 assert.ok(trials.every(trial=>trial.startedOn==='2026-11-01'&&trial.endsOn==='2026-12-01'));
 const cellId=randomUUID(),gatewayId=randomUUID(),issuer=generateKeyPairSync('ed25519'),reporter=generateKeyPairSync('ed25519');
 const coverage=new TrafficCoverageStore(f.pool),remote=new RemoteAccessStore(f.pool,'test-venue-levels',coverage),traffic=new TrafficStore(f.pool);
 await remote.createCell({id:cellId,country:'ES',provider:'aws',environment:'test',suffix:'trial.example.test',subnet:24,publicKey:randomBytes(32).toString('base64'),endpoint:'gateway.example.test:51820'});
 for(const venueId of f.venues){
  const installationId=(await f.pool.query('SELECT id FROM installations WHERE venue_id=$1 AND revoked_at IS NULL',[venueId])).rows[0].id;
  await remote.provision(installationId,cellId,randomBytes(32).toString('base64'));
 }
 await f.pool.query('UPDATE remote_placements SET port=19443 WHERE cell_id=$1',[cellId]);
 await transaction(f.pool,client=>registerForwardReporter(client,{cellId,gatewayId,generation:1,publicKey:reporter.publicKey.export({type:'spki',format:'pem'}).toString()}));
 const publish=async()=>{
  let value;await remote.publishReportingManifest(cellId,async manifest=>{value=manifest;},now);
  assert.equal(value.version,2);return value;
 };
 const enable=async state=>f.pool.query("UPDATE installation_services SET state=$1 WHERE service='remote_access' AND installation_id IN (SELECT installation_id FROM remote_placements WHERE cell_id=$2)",[state,cellId]);
 routeManifest=await publish();assert.equal(routeManifest.routes.length,2);
 const routes=routeManifest.routes;
 const listen=async(server,port,address)=>{
  servers.push(server);server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,address,()=>{server.removeListener('error',reject);resolve();});});
 };
 const certs=join(root,'certs');await mkdir(certs,{mode:0o700});
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=trial.example.test','-addext',`subjectAltName=${routes.flatMap(r=>[r.staffHostname,r.publicHostname]).map(h=>'DNS:'+h).join(',')}`,'-keyout',join(root,'key.pem'),'-out',join(root,'cert.pem')],{stdio:'ignore'});
 const key=await readFile(join(root,'key.pem')),cert=await readFile(join(root,'cert.pem'));
 await writeFile(join(certs,'venues.pem'),Buffer.concat([key,cert]));
 for(const route of routes){
  execFileSync('ip',['address','add',route.address+'/32','dev','lo']);addresses.push(route.address);
  await listen(httpsServer({key,cert},(_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({venueId:route.venueId}));}),route.port,route.address);
 }
 const gate=createPublicGate({key:randomBytes(32),ca:cert,routes:()=>routes,difficulty:8});
 await listen(httpServer(gate.handle),19083,'127.0.0.1');
 const directory=join(root,'state'),reports=join(root,'reports'),countryDirectory=join(root,'country');
 for(const path of [directory,reports,countryDirectory])await mkdir(path,{mode:0o700});await chmod(reports,0o2750);
 const mapping={country:'ES',environment:'test',cellId,directory:reports,writerUid:process.geteuid(),readerGid:process.getegid()},lifetimeSocket=join(countryDirectory,'life.sock');
 country=await serveTrafficLifetimes({socket:lifetimeSocket,mappings:[mapping],store:coverage});
 runtime=new GatewayTrafficRuntime({directory,mapping,lifetimeSocket,maxBytes:262144,reporterKey:reporter.privateKey},issuer.publicKey,()=>now);await runtime.recover();
 const read=async index=>transaction(f.pool,client=>readTrialUsage(client,f.scope,routes[index].venueId,trials[f.venues.indexOf(routes[index].venueId)]));
 const ledger=async()=> (await f.pool.query("SELECT venue_id,channel,sum(ingress)::text AS ingress,sum(egress)::text AS egress FROM remote_traffic_samples GROUP BY 1,2 ORDER BY 1,2")).rows;
 const expected=new Map(routes.flatMap(r=>['staff','public'].map(channel=>[r.venueId+':'+channel,{ingress:0n,egress:0n}])));
 const measured=async(socket,kind)=>{
  const csv=await readTrafficSocket(socket),lines=csv.trim().split('\n'),header=lines.shift().slice(2).split(',');
  const rows=lines.map(line=>line.split(','));
  for(const row of rows)if(['FRONTEND','BACKEND'].includes(row[header.indexOf('svname')]))assert.equal(row[header.indexOf('scur')],'0','closed sessions must settle before counter comparison');
  return routes.flatMap(r=>['staff','public'].map(channel=>{
   const name=`traffic_${kind}_${channel}_${r.installationId.replaceAll('-','')}`;
   const selected=rows.filter(row=>row[header.indexOf('pxname')]===name&&row[header.indexOf('svname')]==='BACKEND');assert.equal(selected.length,1);
   return {venueId:r.venueId,channel,ingress:BigInt(selected[0][header.indexOf('bin')]),egress:BigInt(selected[0][header.indexOf('bout')])};
  }));
 };
 const send=async(index,channel,path='/public/availability',body,cookie)=>{
  const host=channel==='staff'?routes[index].staffHostname:routes[index].publicHostname;
  return new Promise((resolve,reject)=>{
   const req=request({host:'127.0.0.1',localAddress:'127.0.0.2',port:19080,servername:host,ca:cert,agent:false,path,method:body?'POST':'GET',headers:{host,...(body?{'content-type':'application/json','content-length':Buffer.byteLength(body)}:{}),...(cookie?{cookie}:{})}},res=>{
    let value='';res.on('data',chunk=>value+=chunk);res.once('error',reject);res.once('end',()=>resolve({status:res.statusCode,body:value,cookie:res.headers['set-cookie']?.[0]?.split(';')[0]}));
   });req.once('error',reject);req.setTimeout(5000,()=>req.destroy(Error('trial TLS timeout')));req.end(body);
  });
 };
 const user=async index=>{
  const staff=await send(index,'staff');assert.equal(staff.status,200);assert.equal(JSON.parse(staff.body).venueId,routes[index].venueId);
  const challenge=await send(index,'public','/_cloud/challenge');assert.equal(challenge.status,200);
  const {challenge:value,difficulty}=JSON.parse(challenge.body);let nonce=0;
  while(createHash('sha256').update(`${value}:${nonce}`).digest().readUInt32BE(0)>=2**(32-difficulty)){nonce++;assert.ok(nonce<1000000);}
  const answer=await send(index,'public','/_cloud/solve',JSON.stringify({challenge:value,nonce}));assert.equal(answer.status,204);assert.ok(answer.cookie);
  const reply=await send(index,'public','/public/availability',undefined,answer.cookie);assert.equal(reply.status,200);assert.equal(JSON.parse(reply.body).venueId,routes[index].venueId);
  assert.equal((await send(1-index,'public','/public/availability',undefined,answer.cookie)).status,403);
 };
 // Unpublished time is covered only by explicitly journalled empty authority after all owned children are reaped.
 const emptyUntil=async until=>{
  await enable('unconfigured');
  await transaction(f.pool,async client=>{
   while(now<until){
    await client.query('UPDATE fixture_clock SET at=$1',[new Date(now)]);
    const sequence=Number((await client.query('UPDATE remote_cells SET sequence=sequence+1 WHERE id=$1 RETURNING sequence',[cellId])).rows[0].sequence);
    const empty={...routeManifest,sequence,issuedAt:now,expiresAt:Math.min(now+tenMinutes,until),routes:[]};
    await remote.journalTrafficManifest(client,empty);now=empty.expiresAt;
   }
   await client.query('UPDATE fixture_clock SET at=$1',[new Date(now)]);
  });
 };
 for(let day=0;day<3;day++){
  assert.equal(now,begin+day*86400000);await enable('ready');if(day)routeManifest=await publish();
  const processId=randomUUID(),socket=join(root,processId+'.sock'),config=join(root,processId+'.cfg'),startedAt=new Date(now).toISOString();
  await writeFile(config,renderHaproxy(routes,{port:19080,publicTlsPort:19082,gatePort:19083,certificateDirectory:certs,traffic:{socket,operationalSources:['127.0.0.1']}}));
  execFileSync('haproxy',['-c','-f',config],{stdio:'pipe'});
  await runtime.start({manifest:signManifest(routeManifest,issuer.privateKey,now),processId,startedAt,predecessorId:null,socket,command:'haproxy',args:['-db','-f',config]});
  const pid=runtime.pid(processId);assert.ok(pid);pids.push(pid);t.diagnostic('owned trial HAProxy PID '+pid);await waitFor(()=>lstat(socket));
  for(const route of routes){const result=await probeTarget(route,{ca:cert,connect:()=>({address:'127.0.0.1',family:4,port:19080})});assert.equal(result.staff.status,'healthy');assert.equal(result.public.status,'healthy');}
  const operational=await waitFor(()=>measured(socket,'ops'));for(const row of operational){assert.ok(row.ingress>0n);assert.ok(row.egress>0n);}
  for(const row of await measured(socket,'user'))assert.deepEqual([row.ingress,row.egress],[0n,0n],'real operational probes must not become user bytes');
  await clock(now+100);await runtime.tick();await collectTraffic(mapping,traffic);
  assert.equal((await f.pool.query("SELECT count(*) FROM usage_events WHERE event_type='remote_access.traffic_bytes'")).rows[0].count,String(users?day*4:0),'probes must add no traffic ledger events');
  if(users){await user(0);await user(1);}
  const observed=await waitFor(()=>measured(socket,'user'));
  for(const row of observed){if(users){assert.ok(row.ingress>0n);assert.ok(row.egress>0n);}else assert.deepEqual([row.ingress,row.egress],[0n,0n]);const sum=expected.get(row.venueId+':'+row.channel);sum.ingress+=row.ingress;sum.egress+=row.egress;}
  await clock(begin+day*86400000+200);await runtime.tick();
  // Simulate a lost reply after the durable commit; the retained bytes must replay into the same rows.
  await assert.rejects(collectTraffic(mapping,{async record(m,e){await traffic.record(m,e);throw Error('lost database acknowledgement');}}),/traffic_collection_unavailable/);
  const before=await ledger();await new TrafficSpool({directory:join(directory,processId,'spool'),maxBytes:262144}).transfer(mapping);
  await collectTraffic(mapping,new TrafficStore(f.peer));assert.deepEqual(await ledger(),before,'reconnect must not debit cumulative bytes twice');
  // Advance to the signed authority boundary only after all TLS sessions have closed.
  if(crash&&day===2){
   process.kill(pid,'SIGKILL');await waitFor(async()=>assert.equal(runtime.pid(processId),undefined));
   await clock(begin+day*86400000+tenMinutes);await runtime.tick();await collectTraffic(mapping,traffic);
   const saved=(await f.pool.query('SELECT ended_at,end_payload FROM remote_traffic_processes WHERE process_id=$1',[processId])).rows[0];
   assert.deepEqual(saved,{ended_at:null,end_payload:null},'a killed gateway must never manufacture a final lifetime record');
  }else {await clock(begin+day*86400000+tenMinutes);await runtime.finish(processId);await collectTraffic(mapping,traffic);}
  assert.throws(()=>process.kill(pid,0),/ESRCH/);
  for(const row of await ledger())assert.deepEqual([row.ingress,row.egress],[String(expected.get(row.venue_id+':'+row.channel).ingress),String(expected.get(row.venue_id+':'+row.channel).egress)],'stored ingress and egress must equal independently selected outer backend totals');
  await emptyUntil(day===2?end:begin+(day+1)*86400000);
 }
 for(let index=0;index<2;index++){
  const result=await read(index);assert.deepEqual(result,{complete:!crash,usage:{remoteTrafficDays:users&&!crash?3:0,translationRuns:0,solverRuns:0}});
  assert.equal(trialWasUsed(result.usage),users&&!crash,'only three distinct real user dates may qualify a trial');
  const days=await traffic.days(f.scope,routes[index].venueId,'2026-11-01','2026-12-01');assert.equal(days.complete,!crash);
  assert.deepEqual(days.days.map(d=>d.on),users&&!crash?['2026-11-01','2026-11-02','2026-11-03']:[]);
 }
 await assert.rejects(transaction(f.pool,client=>readTrialUsage(client,f.foreign,routes[0].venueId,trials[0])),{code:'billing_scope_not_found'});
 const usage=(await f.pool.query("SELECT venue_id,sum(quantity)::text AS bytes FROM usage_events WHERE event_type='remote_access.traffic_bytes' GROUP BY 1")).rows;
 assert.equal(usage.length,users?2:0);
 for(const row of usage){const total=['staff','public'].reduce((sum,channel)=>{const v=expected.get(row.venue_id+':'+channel);return sum+v.ingress+v.egress;},0n);assert.equal(row.bytes,String(total));}
 t.diagnostic('controlled UTC accounting clock; real rendered TLS, signed spool/lifetimes, PostgreSQL collector and full stored 30-day trial; no live calendar or provider qualification');
});
