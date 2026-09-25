import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {X509Certificate,randomBytes} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {createServer as httpsServer} from 'node:https';
import {createServer as netServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Duplex} from 'node:stream';
import {createServer as tlsServer} from 'node:tls';
import {after,test} from 'node:test';
import {probeTarget} from '../src/probe.ts';
import type {RemoteProbeTarget} from '../src/probe-targets.ts';
import {createPublicGate} from '../src/public-gate.ts';

const roots:string[]=[];
after(async()=>{for(const root of roots)await rm(root,{recursive:true,force:true});});
const target=(staffHostname='staff.probe.example.test',publicHostname='probe.example.test'):RemoteProbeTarget=>({installationId:'10000000-0000-4000-8000-000000000001',venueId:'20000000-0000-4000-8000-000000000002',revision:7,staffHostname,publicHostname});
async function certificate(hostname:string){
 const root=await mkdtemp(join(tmpdir(),'cloud-probe-pki-'));roots.push(root);const key=join(root,'key.pem'),cert=join(root,'cert.pem');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','2','-subj',`/CN=${hostname}`,'-addext',`subjectAltName=DNS:${hostname}`,'-keyout',key,'-out',cert],{stdio:'ignore'});
 return {key:await readFile(key),cert:await readFile(cert)};
}
async function listenTls(hostname:string){
 const material=await certificate(hostname),sockets=new Set<import('node:net').Socket>(),server=tlsServer(material,socket=>socket.end());server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const bound=server.address();assert(bound&&typeof bound!=='string');
 return {server,port:bound.port,...material,close:async()=>{for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
async function unusedPort(){const server=netServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert(address&&typeof address!=='string');await new Promise<void>(resolve=>server.close(()=>resolve()));return address.port;}
const connect=(port:number)=>(hostname:string)=>({address:'127.0.0.1',family:4 as const,port,hostname});
async function listenHttps(material:Awaited<ReturnType<typeof certificate>>,handler:Parameters<typeof httpsServer>[1]){
 const sockets=new Set<Duplex>(),server=httpsServer(material,handler);server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const bound=server.address();assert(bound&&typeof bound!=='string');
 return {server,port:bound.port,close:async()=>{for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}

test('address policy refuses loopback unless an exact configured fixture mapping supplies it',async()=>{
 const server=await listenTls('staff.probe.example.test');try{
  const refused=await probeTarget(target('localhost','localhost'),{ca:server.cert});
  assert.equal(refused.staff.status,'failed');if(refused.staff.status==='failed')assert.equal(refused.staff.failure,'address_forbidden');
  const allowed=await probeTarget(target(),{ca:server.cert,connect:connect(server.port)});
  assert.equal(allowed.staff.status,'healthy');if(allowed.staff.status==='healthy'){assert.match(allowed.staff.certificate.notAfter,/Z$/);assert.match(allowed.staff.certificate.fingerprint256,/^[0-9A-F:]+$/);}
 }finally{await server.close();}
});

test('staff TLS distinguishes hostname, trust, refused and timed-out connections without raw diagnostics',async()=>{
 const valid=await listenTls('staff.probe.example.test'),wrong=await listenTls('wrong.probe.example.test'),untrusted=await listenTls('staff.probe.example.test');
 const hangingSockets=new Set<import('node:net').Socket>(),hanging=netServer(socket=>{hangingSockets.add(socket);socket.once('close',()=>hangingSockets.delete(socket));});await new Promise<void>(resolve=>hanging.listen(0,'127.0.0.1',resolve));const hangingAddress=hanging.address();assert(hangingAddress&&typeof hangingAddress!=='string');
 try{
  const mismatch=await probeTarget(target(),{ca:wrong.cert,connect:connect(wrong.port)});assert.equal(mismatch.staff.status,'failed');if(mismatch.staff.status==='failed')assert.equal(mismatch.staff.failure,'tls');
  const trust=await probeTarget(target(),{ca:valid.cert,connect:connect(untrusted.port)});assert.equal(trust.staff.status,'failed');if(trust.staff.status==='failed')assert.equal(trust.staff.failure,'tls');
  const refused=await probeTarget(target(),{ca:valid.cert,connect:connect(await unusedPort())});assert.equal(refused.staff.status,'failed');
  const timed=await probeTarget(target(),{ca:valid.cert,connect:connect(hangingAddress.port)});assert.equal(timed.staff.status,'failed');if(timed.staff.status==='failed')assert.equal(timed.staff.failure,'timeout');
  for(const result of [mismatch,trust,refused,timed]){const text=JSON.stringify(result);assert.doesNotMatch(text,/127\.0\.0\.1|ECONN|certificate|wrong\.probe/i);}
 }finally{for(const socket of hangingSockets)socket.destroy();await new Promise<void>(resolve=>hanging.close(()=>resolve()));await Promise.all([valid.close(),wrong.close(),untrusted.close()]);}
});

test('public probe completes the real challenge before reporting verified HTTPS healthy',async()=>{
 const publicMaterial=await certificate('probe.example.test'),staff=await certificate('staff.probe.example.test');
 const upstream=await listenHttps(staff,(_req,res)=>{res.setHeader('content-type','application/json');res.end('{"available":true}');});
 const gate=createPublicGate({key:randomBytes(32),difficulty:8,ca:staff.cert,routes:()=>[{publicHostname:'probe.example.test',staffHostname:'staff.probe.example.test',address:'127.0.0.1',port:upstream.port}]});
 const ingress=await listenHttps(publicMaterial,(req,res)=>{req.headers['x-waitron-client-ip']='192.0.2.20';req.headers['x-waitron-sni']='probe.example.test';gate.handle(req,res);});
 try{
  const result=await probeTarget(target(),{ca:publicMaterial.cert,connect:connect(ingress.port)});assert.equal(result.public.status,'healthy');
  if(result.public.status==='healthy'){assert.equal(result.public.certificate.fingerprint256,new X509Certificate(publicMaterial.cert).fingerprint256);assert.ok(result.public.elapsedMs>=0);}
  assert.equal(gate.stats().challenged,1);assert.equal(gate.stats().forwarded,1);
 }finally{await Promise.all([ingress.close(),upstream.close()]);}
});

async function protocolFixture(mode:'false-page'|'difficulty'|'duplicate-cookie'|'redirect'|'non-json'|'oversized'){
 const material=await certificate('probe.example.test'),fixture=await listenHttps(material,(req,res)=>{
  if(req.url==='/public/availability'&&!req.headers.cookie){if(mode==='redirect'){res.statusCode=302;res.setHeader('location','https://elsewhere.example/');res.end();return;}res.statusCode=403;res.setHeader('content-type','text/html');res.end(mode==='false-page'?'<h1>Forbidden</h1>':'<script src="/_cloud/challenge.js"></script>');return;}
  if(req.url==='/_cloud/challenge'){res.setHeader('content-type','application/json');res.end(JSON.stringify({challenge:'fixture-challenge',difficulty:mode==='difficulty'?23:8}));return;}
  if(req.url==='/_cloud/solve'){res.statusCode=204;const cookie='__Host-waitron-public=fixture; Path=/; Secure; HttpOnly; SameSite=Strict';res.setHeader('set-cookie',mode==='duplicate-cookie'?[cookie,cookie]:cookie);res.end();return;}
  if(req.url==='/public/availability'&&req.headers.cookie){res.statusCode=200;res.setHeader('content-type','application/json');res.end(mode==='non-json'?'not json':mode==='oversized'?JSON.stringify('x'.repeat(65537)):'{}');return;}
  res.statusCode=404;res.end();
 });return {...fixture,material};
}

test('public probe refuses false challenges, excessive work, duplicate cookies, redirects and invalid responses',async()=>{
 for(const [mode,failure] of [['false-page','challenge'],['difficulty','challenge'],['duplicate-cookie','challenge'],['redirect','http'],['non-json','http'],['oversized','response_limit']] as const){
  const fixture=await protocolFixture(mode);try{const result=await probeTarget(target(),{ca:fixture.material.cert,connect:connect(fixture.port)});assert.equal(result.public.status,'failed',mode);if(result.public.status==='failed')assert.equal(result.public.failure,failure,mode);}finally{await fixture.close();}
 }
});

test('public probe reports refused, timed-out, wrong-host and untrusted TLS with no raw diagnostics',async()=>{
 const trusted=await certificate('probe.example.test'),wrongMaterial=await certificate('wrong.example.test'),untrustedMaterial=await certificate('probe.example.test');
 const wrong=await listenHttps(wrongMaterial,(_req,res)=>res.end()),untrusted=await listenHttps(untrustedMaterial,(_req,res)=>res.end());
 const hangingSockets=new Set<import('node:net').Socket>(),hanging=netServer(socket=>{hangingSockets.add(socket);socket.once('close',()=>hangingSockets.delete(socket));});await new Promise<void>(resolve=>hanging.listen(0,'127.0.0.1',resolve));const address=hanging.address();assert(address&&typeof address!=='string');
 try{
  const cases=[
   await probeTarget(target(),{ca:trusted.cert,connect:connect(await unusedPort())}),
   await probeTarget(target(),{ca:trusted.cert,connect:connect(address.port)}),
   await probeTarget(target(),{ca:wrongMaterial.cert,connect:connect(wrong.port)}),
   await probeTarget(target(),{ca:trusted.cert,connect:connect(untrusted.port)}),
  ];
  assert.deepEqual(cases.map(result=>result.public.status==='failed'&&result.public.failure),['tls','timeout','tls','tls']);
  for(const result of cases){const text=JSON.stringify(result.public);assert.doesNotMatch(text,/127\.0\.0\.1|ECONN|wrong\.example|self.signed/i);}
 }finally{for(const socket of hangingSockets)socket.destroy();await new Promise<void>(resolve=>hanging.close(()=>resolve()));await Promise.all([wrong.close(),untrusted.close()]);}
});
