import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {chmod,chown,cp,mkdir,mkdtemp,readFile,readdir,realpath,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {signManifest,type ReportingGatewayManifest} from '../src/manifest.ts';
import {serveTrafficLifetimes} from '../src/traffic-lifetime-transport.ts';
import {verifyTrafficReport} from '../src/traffic-report.ts';
import {verifyTrafficLifecycle} from '../src/traffic-lifecycle.ts';

async function waitFor<T>(read:()=>Promise<T>,milliseconds=8000):Promise<T>{
 const until=Date.now()+milliseconds;for(;;){try{return await read();}catch(e){if(Date.now()>until)throw e;await delay(10);}}
}
async function fixture(t:{after:(fn:()=>Promise<void>)=>void;diagnostic:(s:string)=>void},ttl=60000){
 const root=await realpath(await mkdtemp('/tmp/gtc-')),state=join(root,'traffic'),reports=join(root,'reports'),stats=join(root,'stats'),country=join(root,'country'),base=join(root,'gateway'),bin=join(root,'bin');
 for(const p of [state,reports,stats,country,base,bin])await mkdir(p,{mode:0o700});await chown(reports,process.geteuid!(),process.getegid!());await chmod(reports,0o2750);
 const issuer=generateKeyPairSync('ed25519'),reporter=generateKeyPairSync('ed25519'),cellId=randomUUID(),input=join(root,'manifest.json');
 const route={installationId:randomUUID(),venueId:randomUUID(),revision:1,staffHostname:'staff.sol.example.test',publicHostname:'sol.example.test',address:'10.77.0.2',port:443,peerPublicKey:randomBytes(32).toString('base64')};
 const now=Date.now(),manifest:ReportingGatewayManifest={version:2,audience:'waitron-cloud-gateway',cellId,sequence:1,issuedAt:now,expiresAt:now+ttl,reporter:{gatewayId:randomUUID(),generation:1},routes:[route]};
 const publish=async(value=manifest)=>{await writeFile(input,JSON.stringify(signManifest(value,issuer.privateKey)));};await publish();
 await writeFile(join(root,'issuer.pem'),issuer.publicKey.export({type:'spki',format:'pem'}));await writeFile(join(root,'reporter.pem'),reporter.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
 await writeFile(join(root,'wg.key'),randomBytes(32).toString('base64'));await writeFile(join(root,'bot.key'),randomBytes(32));
 await cp(new URL('../src',import.meta.url),join(root,'src'),{recursive:true});
 await cp(new URL('./fixtures/gateway-system.ts',import.meta.url),join(root,'system.ts'));
 const quote=(s:string)=>"'"+s.replaceAll("'","'\\''")+"'";
 for(const name of ['ip','iptables','wg','haproxy'])await writeFile(join(bin,name),`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(join(root,'system.ts'))} ${name} "$@"\n`,{mode:0o700});
 const env={PATH:bin+':'+process.env.PATH,GATEWAY_FIXTURE_ROOT:root,GATEWAY_STATE_DIR:base,GATEWAY_MANIFEST:input,GATEWAY_CELL_ID:cellId,GATEWAY_TRUST_KEY:join(root,'issuer.pem'),GATEWAY_WIREGUARD_KEY:join(root,'wg.key'),GATEWAY_BOT_KEY:join(root,'bot.key'),
  GATEWAY_TRAFFIC_MODE:'test',GATEWAY_TRAFFIC_COUNTRY:'ES',GATEWAY_TRAFFIC_ENVIRONMENT:'test',GATEWAY_TRAFFIC_SOCKET_DIRECTORY:stats,GATEWAY_TRAFFIC_OPERATIONAL_SOURCES:'["127.0.0.2"]',GATEWAY_TRAFFIC_STATE_DIRECTORY:state,GATEWAY_TRAFFIC_REPORTER_KEY:join(root,'reporter.pem'),GATEWAY_TRAFFIC_REPORT_DIRECTORY:reports,GATEWAY_TRAFFIC_LIFETIME_SOCKET:join(country,'life.sock'),GATEWAY_TRAFFIC_READER_GID:String(process.getegid!()),GATEWAY_TRAFFIC_MAX_BYTES:'32768'};
 const children=async():Promise<Array<{pid:number;processId:string;prepared:boolean;args:string[];at:number}>>=>{try{return (await readFile(join(root,'children'),'utf8')).trim().split('\n').map(s=>JSON.parse(s));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}};
 let gateway:ChildProcess|undefined,output='',release:()=>void=()=>{},server:Awaited<ReturnType<typeof serveTrafficLifetimes>>|undefined;const lifetimes:unknown[]=[];
 t.after(async()=>{
  release();if(gateway?.exitCode===null&&gateway.signalCode===null){if(!gateway.killed)gateway.kill('SIGTERM');try{await waitFor(async()=>assert.ok(gateway!.exitCode!==null||gateway!.signalCode!==null),10000);}catch{gateway.kill('SIGKILL');await waitFor(async()=>assert.ok(gateway!.signalCode));}}
  try{await server?.close();}finally{for(const c of await children()){t.diagnostic(`owned child PID ${c.pid}`);try{process.kill(c.pid,'SIGKILL');}catch(e){assert.equal((e as NodeJS.ErrnoException).code,'ESRCH');}await waitFor(async()=>assert.throws(()=>process.kill(c.pid,0),/ESRCH/));}await rm(root,{recursive:true,force:true});}
 });
 const launch=()=>{gateway=spawn(process.execPath,[join(root,'src','gateway-cli.ts')],{env,stdio:['ignore','pipe','pipe']});t.diagnostic(`owned gateway PID ${gateway.pid}`);gateway.stdout!.on('data',b=>{output+=b;});gateway.stderr!.on('data',b=>{output+=b;});return gateway;};
 const holdCountry=async()=>{
  const gate=new Promise<void>(r=>{release=r;});
  server=await serveTrafficLifetimes({socket:env.GATEWAY_TRAFFIC_LIFETIME_SOCKET,mappings:[{country:'ES',environment:'test',cellId,directory:reports,writerUid:process.geteuid!(),readerGid:process.getegid!()}],store:{async recordLifecycle(_m,e){lifetimes.push(e);await gate;}}});
  return {accepted:()=>waitFor(async()=>assert.ok(lifetimes.length,'country command must receive a signed start')),release:()=>release()};
 };
 const prepared=()=>waitFor(async()=>{const cs=await children();assert.ok(cs.length>0,output);assert.equal(cs[0]!.prepared,true,'command must use durable owned traffic preparation');await readFile(join(root,cs[0]!.processId+'.ready'));return cs[0]!;});
 return {root,state,reports,manifest,reporter,publish,children,launch,holdCountry,prepared,lifetimes,output:()=>output};
}

// Omitting command consumption leaves no signed lifetime, sample or durable preparation.
test('source-only gateway command prepares its child and periodically exports exact signed bytes',async t=>{
 const f=await fixture(t),held=await f.holdCountry();f.launch();const c=await f.prepared();await held.accepted();held.release();
 const report=await waitFor(async()=>{const names=await readdir(f.reports);assert.ok(names.length);return verifyTrafficReport(JSON.parse(await readFile(join(f.reports,names[0]!), 'utf8')),f.reporter.publicKey);});
 assert.equal(report.processId,c.processId);assert.deepEqual(report.entries.map(e=>[e.ingress,e.egress]),[['10','25'],['10','25']]);assert.equal(report.complete,true);
 assert.equal(verifyTrafficLifecycle(f.lifetimes[0],f.reporter.publicKey).processId,c.processId);
});

// Waiting on the six-second country reply would miss this real signed deadline.
test('gateway command expires its captured child while country delivery is blocked',async t=>{
 const f=await fixture(t,4000),held=await f.holdCountry();f.launch();const c=await f.prepared();await held.accepted();
 await waitFor(async()=>assert.throws(()=>process.kill(c.pid,0),/ESRCH/),Math.max(1,f.manifest.expiresAt+1600-Date.now()));
 assert.ok(Date.now()<=f.manifest.expiresAt+1600,'country delivery cannot postpone signed expiry');held.release();
});

test('gateway command withdraws routes before draining blocked traffic delivery',async t=>{
 const f=await fixture(t),held=await f.holdCountry();f.launch();const c=await f.prepared();await held.accepted();
 await f.publish({...f.manifest,sequence:2,routes:[]});await waitFor(async()=>{
  assert.throws(()=>process.kill(c.pid,0),/ESRCH/);
  const network=(await readFile(join(f.root,'network'),'utf8')).trim().split('\n').map(s=>JSON.parse(s));assert.ok(!network.at(-1).wireguard.includes('[Peer]'));
 },2200);held.release();
});

test('gateway command reloads the same routes with a new signed process and predecessor',async t=>{
 const f=await fixture(t),held=await f.holdCountry();f.launch();const first=await f.prepared();await held.accepted();held.release();await f.publish({...f.manifest,sequence:2});
 const second=await waitFor(async()=>{const cs=await f.children();assert.equal(cs.length,2,f.output());return cs[1]!;});
 const saved=JSON.parse(await readFile(join(f.state,second.processId,'journal','prepared.json'),'utf8'));
 assert.equal(verifyTrafficLifecycle(saved.start,f.reporter.publicKey).predecessorId,first.processId);assert.ok(second.args.includes('-sf'));assert.ok(second.args.includes(String(first.pid)));
});

test('gateway command withdraws a changed route before its replacement waits on delivery',async t=>{
 const f=await fixture(t),held=await f.holdCountry();f.launch();const first=await f.prepared();await held.accepted();
 await f.publish({...f.manifest,sequence:2,routes:[{...f.manifest.routes[0]!,revision:2}]});
 await waitFor(async()=>assert.throws(()=>process.kill(first.pid,0),/ESRCH/),2200);held.release();
 await waitFor(async()=>assert.equal((await f.children()).length,2,f.output()));
});

test('gateway signal withdraws the child immediately and then drains pending delivery',async t=>{
 const f=await fixture(t),held=await f.holdCountry(),gateway=f.launch(),c=await f.prepared();await held.accepted();gateway.kill('SIGTERM');
 await waitFor(async()=>assert.throws(()=>process.kill(c.pid,0),/ESRCH/),1000);assert.equal(gateway.exitCode,null);assert.equal(gateway.signalCode,null);
 held.release();await waitFor(async()=>assert.equal(gateway.exitCode,0),8000);
});

test('gateway signal cancels a reload queued behind country delivery',async t=>{
 const f=await fixture(t),held=await f.holdCountry(),gateway=f.launch(),c=await f.prepared();await held.accepted();
 await f.publish({...f.manifest,sequence:2});await waitFor(async()=>{
  const config=await readFile(join(f.root,'gateway','haproxy.cfg'),'utf8');assert.ok(config.includes('stats socket '));assert.ok(!config.includes(c.processId));
 });
 await delay(200);gateway.kill('SIGTERM');await waitFor(async()=>assert.throws(()=>process.kill(c.pid,0),/ESRCH/),1000);
 held.release();await waitFor(async()=>assert.equal(gateway.exitCode,0),8000);assert.equal((await f.children()).length,1,'withdrawn queued reload cannot spawn after signal');
});

test('gateway expires the predecessor while authority processing waits on a queued reload',async t=>{
 const f=await fixture(t,4000),held=await f.holdCountry();f.launch();const c=await f.prepared();await held.accepted();
 await f.publish({...f.manifest,sequence:2,expiresAt:f.manifest.expiresAt+60000});
 await waitFor(async()=>{const config=await readFile(join(f.root,'gateway','haproxy.cfg'),'utf8');assert.ok(!config.includes(c.processId));});
 await waitFor(async()=>assert.throws(()=>process.kill(c.pid,0),/ESRCH/),Math.max(1,f.manifest.expiresAt+1600-Date.now()));
 assert.ok(Date.now()<=f.manifest.expiresAt+1600);held.release();
 await waitFor(async()=>assert.equal((await f.children()).length,2,f.output()));
});
