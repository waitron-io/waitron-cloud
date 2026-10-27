import assert from 'node:assert/strict';
import {test,mock} from 'node:test';
import https from 'node:https';
import {createServer,request,type IncomingMessage} from 'node:http';
import {syncBuiltinESMExports} from 'node:module';
import {execFileSync,spawnSync} from 'node:child_process';
import {createPublicGate} from '../src/public-gate.ts';
import {generateKeyPairSync,randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdtemp,mkdir,chmod,writeFile,readFile,rm,realpath,readdir,symlink,unlink,link} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {GatewayAuthority} from '../src/authority.ts';
import {signManifest,type GatewayManifest} from '../src/manifest.ts';
import {verifyForwardReport} from '../src/forward-report.ts';
const module=await import('../src/gateway-forward-reports.ts').catch(()=>undefined);
const start=1_000_000;
async function fixture(){
 assert.equal(typeof module?.GatewayForwardReports,'function','gateway reporting wiring must exist');
 const root=await realpath(await mkdtemp(join(tmpdir(),'cloud-gateway-report-'))),directory=join(root,'reports');await mkdir(directory);await chmod(directory,0o2750);
 const key=generateKeyPairSync('ed25519'),issuer=generateKeyPairSync('ed25519');const keyFile=join(root,'reporting.pem');await writeFile(keyFile,key.privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600});
 const cellId=randomUUID(),gatewayId=randomUUID();let now=start;
 const route={installationId:randomUUID(),venueId:randomUUID(),staffHostname:'staff.sol.example.test',publicHostname:'sol.example.test',address:'10.77.0.2',port:443,peerPublicKey:randomBytes(32).toString('base64'),revision:7};
 const value={version:2,audience:'waitron-cloud-gateway',cellId,sequence:1,issuedAt:start,expiresAt:start+600000,routes:[route],reporter:{gatewayId,generation:1}};
 const authority=new GatewayAuthority(issuer.publicKey,cellId,{persist:async()=>{},apply:async()=>{},close:async()=>{}},()=>now);
 const publish=(patch:object={})=>authority.accept(signManifest({...value,...patch} as unknown as GatewayManifest,issuer.privateKey,start));await publish();
 const options={directory,keyFile,readerGid:process.getegid!(),now:()=>now};const reports=new module!.GatewayForwardReports(authority,options);await reports.refresh();
 return {root,directory,key,issuer,keyFile,route,value,authority,reports,options,publish,time:()=>now,setTime:(value:number)=>{now=value;},
  read:async()=>verifyForwardReport(JSON.parse(await readFile(join(directory,'report.json'),'utf8')),key.publicKey,now),close:()=>rm(root,{recursive:true,force:true})};
}
test('changed applied authority discards in-flight completions before file delivery',async()=>{
 const f=await fixture();try{
  const complete=f.reports.beginForward(f.route,start)!;assert.equal(typeof complete,'function');
  await f.publish({sequence:2,routes:[{...f.route,revision:8}]});await f.reports.refresh();complete('upstream_transport',start);await f.reports.flush(start);
  assert.equal((await readdir(f.directory)).includes('report.json'),false);
  const current=f.reports.beginForward({...f.route,revision:8},start)!;current(null,start);await f.reports.flush(start);
  const report=await f.read();assert.equal(report.observations[0]!.revision,8);assert.equal(report.observations[0]!.manifestSequence,2);assert.equal(report.observations[0]!.category,null);
  const stale=f.reports.beginForward(f.route,start);assert.equal(stale,undefined,'stale selected route must not acquire current authority');
 }finally{await f.close();}
});
test('expired authority and opting back to v1 suppress delivery',async()=>{
 const f=await fixture();try{
  const complete=f.reports.beginForward(f.route,start)!;f.setTime(start+600000);complete('upstream_timeout',f.time());await f.reports.refresh();await f.reports.flush(f.time());
  assert.equal((await readdir(f.directory)).includes('report.json'),false);
  f.setTime(start);const {reporter,...v1}=f.value;await f.authority.accept(signManifest({...v1,version:1,routes:f.value.routes.map(({revision,...route})=>route),sequence:2} as GatewayManifest,f.issuer.privateKey,start));await f.reports.refresh();
  assert.equal(f.reports.beginForward(f.route,start),undefined);
 }finally{await f.close();}
});
test('absent opt-in and invalid key/storage leave applied routes available',async()=>{
 const f=await fixture();try{
  for(const options of [{},{...f.options,keyFile:join(f.root,'missing')},{...f.options,directory:join(f.root,'missing')},{...f.options,keyFile:join(f.directory,'secret.pem')}]){
   const reports=new module!.GatewayForwardReports(f.authority,options);await reports.refresh();assert.equal(reports.beginForward(f.route,start),undefined);await reports.flush(start);
   assert.equal(f.authority.hasAuthority,true);assert.equal(f.authority.routes.length,1);
  }
  f.reports.beginForward(f.route,start)!(null,start);await f.reports.flush(start);
  await chmod(f.keyFile,0o640);const reports=new module!.GatewayForwardReports(f.authority,f.options);await reports.refresh();assert.equal(reports.beginForward(f.route,start),undefined);
 }finally{await f.close();}
});
test('dedicated reporter key cannot reuse issuer authority',async()=>{
 const f=await fixture();try{
  f.reports.beginForward(f.route,start)!(null,start);await f.reports.flush(start);
  await writeFile(f.keyFile,f.key.privateKey.export({format:'pem',type:'pkcs8'}));
  // The gateway receives the issuer public key separately and must reject reusing it.
  const reports=new module!.GatewayForwardReports(f.authority,{...f.options,issuerKey:f.key.publicKey});await reports.refresh();assert.equal(reports.beginForward(f.route,start),undefined);
 }finally{await f.close();}
});

for(const failure of ['healthy','disk','key'])test(`real HTTPS forwarding continues with reporting ${failure}`,async()=>{
 const f=await fixture();let close=async()=>{};const original=https.request;let restore=()=>{};
 try{
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=staff.sol.example.test','-addext','subjectAltName=DNS:staff.sol.example.test','-keyout',join(f.root,'tls.key'),'-out',join(f.root,'tls.crt')],{stdio:'ignore'});
  const cert=await readFile(join(f.root,'tls.crt')),key=await readFile(join(f.root,'tls.key'));let forwards=0;
  const upstream=https.createServer({key,cert},(_req,res)=>{forwards++;res.end('venue available');});await new Promise<void>(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  const bound=upstream.address();assert.ok(bound&&typeof bound!=='string');
  // Substitute only the private network destination; the real TLS and forwarding code run.
  const patched=mock.method(https,'request',(options:Record<string,unknown>,callback:(response:IncomingMessage)=>void)=>original({...options,host:'127.0.0.1',port:bound.port},callback));syncBuiltinESMExports();restore=()=>{patched.mock.restore();syncBuiltinESMExports();};
  const reports=failure==='key'?new module!.GatewayForwardReports(f.authority,{...f.options,keyFile:join(f.root,'absent.pem')}):f.reports;await reports.refresh();
  if(failure==='disk')await mkdir(join(f.directory,'report.json.tmp'));
  const gate=createPublicGate({key:randomBytes(32),ca:cert,now:f.time,difficulty:8,routes:()=>f.authority.routes,beginForward:(route,time)=>reports.beginForward(route,time)});
  const server=createServer(gate.handle);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  close=async()=>{server.closeAllConnections();upstream.closeAllConnections();await Promise.all([new Promise<void>(resolve=>server.close(()=>resolve())),new Promise<void>(resolve=>upstream.close(()=>resolve()))]);};
  const send=(path:string,method='GET',body?:string,cookie?:string)=>new Promise<{status:number;body:string;cookie?:string}>((resolve,reject)=>{
   const req=request({host:'127.0.0.1',port:address.port,path,method,headers:{host:f.route.publicHostname,'x-waitron-client-ip':'192.0.2.2','x-waitron-sni':f.route.publicHostname,'content-type':'application/json',...(cookie?{cookie}:{})}},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode!,body,cookie:res.headers['set-cookie']?.[0]?.split(';')[0]}));});req.on('error',reject);req.end(body);
  });
  const challenge=JSON.parse((await send('/_cloud/challenge')).body);let nonce=0;while(createHash('sha256').update(`${challenge.challenge}:${nonce}`).digest().readUInt32BE(0)>=2**(32-challenge.difficulty))nonce++;
  const solved=await send('/_cloud/solve','POST',JSON.stringify({challenge:challenge.challenge,nonce}));assert.equal(solved.status,204);
  for(let i=0;i<2;i++){
   const response=await send('/public/availability','GET',undefined,solved.cookie);assert.equal(response.status,200);assert.equal(response.body,'venue available');await reports.flush(f.time());
  }
  assert.equal(forwards,2);assert.equal(gate.stats().unavailable,0);assert.equal(gate.stats().active,0);
  if(failure==='healthy'){const report=await f.read();assert.equal(report.observations[0]!.category,null);assert.equal(report.observations[0]!.revision,7);}
  else assert.equal((await readdir(f.directory)).includes('report.json'),false);
 }finally{restore();await close();await f.close();}
});

for(const change of ['route','manifest','generation','removed'])test(`changed ${change} authority discards in-flight evidence`,async()=>{
 const f=await fixture();try{
  const complete=f.reports.beginForward(f.route,start)!;
  const patch=change==='route'?{routes:[{...f.route,port:444}]}:change==='generation'?{reporter:{...f.value.reporter,generation:2}}:change==='removed'?{routes:[]}:{};
  await f.publish({...patch,sequence:2});complete('upstream_transport',start);await f.reports.flush(start);
  assert.equal((await readdir(f.directory)).includes('report.json'),false);
 }finally{await f.close();}
});
test('gateway rotation reloads a fresh dedicated signing key for the new generation',async()=>{
 const f=await fixture();try{
  f.reports.beginForward(f.route,start)!(null,start);await f.reports.flush(start);
  const fresh=generateKeyPairSync('ed25519');await writeFile(f.keyFile,fresh.privateKey.export({type:'pkcs8',format:'pem'}));
  await f.publish({sequence:2,reporter:{...f.value.reporter,generation:2}});await f.reports.refresh();
  f.reports.beginForward(f.route,start)!('upstream_timeout',start);await f.reports.flush(start);
  const envelope=JSON.parse(await readFile(join(f.directory,'report.json'),'utf8'));const report=verifyForwardReport(envelope,fresh.publicKey,start);
  assert.equal(report.generation,2);assert.equal(report.sequence,1);assert.equal(report.observations[0]!.category,'upstream_timeout');assert.throws(()=>verifyForwardReport(envelope,f.key.publicKey,start),/invalid_forward_report/);
 }finally{await f.close();}
});

test('existing private key inside the collector mount or behind a parent symlink is refused',async()=>{
 const f=await fixture();try{
  f.reports.beginForward(f.route,start)!(null,start);await f.reports.flush(start);
  const inside=join(f.directory,'secret.pem');await writeFile(inside,f.key.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
  await symlink(f.root,join(f.root,'alias'));
  for(const keyFile of [inside,join(f.root,'alias','reporting.pem')]){
   const reports=new module!.GatewayForwardReports(f.authority,{...f.options,keyFile});await reports.refresh();assert.equal(reports.beginForward(f.route,start),undefined);
  }
 }finally{await f.close();}
});

test('a named pipe cannot block the optional key loader',async()=>{
 const f=await fixture();try{
  await unlink(f.keyFile);execFileSync('mkfifo',[f.keyFile]);
  const script=`import {generateKeyPairSync} from 'node:crypto';import {GatewayAuthority} from './packages/remote-access/src/authority.ts';import {signManifest} from './packages/remote-access/src/manifest.ts';import {GatewayForwardReports} from './packages/remote-access/src/gateway-forward-reports.ts';const keys=generateKeyPairSync('ed25519'),value=JSON.parse(process.argv[2]);const authority=new GatewayAuthority(keys.publicKey,value.cellId,{persist:async()=>{},apply:async()=>{},close:async()=>{}},()=>${start});await authority.accept(signManifest(value,keys.privateKey,${start}));const reports=new GatewayForwardReports(authority,{keyFile:process.argv[1],directory:process.argv[3],readerGid:process.getegid(),now:()=>${start}});await reports.refresh();if(reports.beginForward(value.routes[0],${start})!==undefined)process.exitCode=1;`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script,f.keyFile,JSON.stringify(f.value),f.directory],{encoding:'utf8',timeout:2000});assert.equal(child.status,0,`key loader must reject a named pipe promptly: ${child.error?.message??child.stderr}`);
 }finally{await f.close();}
});

test('a hard-linked or known bot signing key cannot become reporting authority',async()=>{
 const f=await fixture();try{
  f.reports.beginForward(f.route,start)!(null,start);await f.reports.flush(start);
  await link(f.keyFile,join(f.root,'linked-key'));const linked=new module!.GatewayForwardReports(f.authority,f.options);await linked.refresh();assert.equal(linked.beginForward(f.route,start),undefined);
  await unlink(join(f.root,'linked-key'));
  await symlink(f.keyFile,join(f.root,'bot-key-alias'));
  for(const other of [f.keyFile,join(f.root,'bot-key-alias')]){
   const shared=new module!.GatewayForwardReports(f.authority,{...f.options,otherKeyFiles:[other]});await shared.refresh();assert.equal(shared.beginForward(f.route,start),undefined);
  }
 }finally{await f.close();}
});
