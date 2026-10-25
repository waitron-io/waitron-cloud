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
import {isPublicProbeAddress,probeTarget} from '../src/probe.ts';
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

test('address policy refuses IPv6 documentation and NAT64 translations of non-public IPv4',()=>{
 for(const address of ['2001:db8::1','3fff::1','64:ff9b::7f00:1'])assert.equal(isPublicProbeAddress(address,6),false,address);
 assert.equal(isPublicProbeAddress('2606:4700:4700::1111',6),true);
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

async function protocolFixture(mode:'false-page'|'difficulty'|'duplicate-cookie'|'wrong-cookie'|'insecure-cookie'|'redirect'|'non-json'|'oversized'){
 const material=await certificate('probe.example.test'),fixture=await listenHttps(material,(req,res)=>{
  if(req.url==='/public/availability'&&!req.headers.cookie){if(mode==='redirect'){res.statusCode=302;res.setHeader('location','https://elsewhere.example/');res.end();return;}res.statusCode=403;res.setHeader('content-type','text/html');res.end(mode==='false-page'?'<h1>Forbidden</h1>':'<script src="/_cloud/challenge.js"></script>');return;}
  if(req.url==='/_cloud/challenge'){res.setHeader('content-type','application/json');res.end(JSON.stringify({challenge:'fixture-challenge',difficulty:mode==='difficulty'?23:8}));return;}
  if(req.url==='/_cloud/solve'){res.statusCode=204;const cookie=mode==='wrong-cookie'?'session=fixture; Path=/; Secure; HttpOnly; SameSite=Strict':mode==='insecure-cookie'?'__Host-waitron-public=fixture; Path=/; HttpOnly; SameSite=Strict':'__Host-waitron-public=fixture; Path=/; Secure; HttpOnly; SameSite=Strict';res.setHeader('set-cookie',mode==='duplicate-cookie'?[cookie,cookie]:cookie);res.end();return;}
  if(req.url==='/public/availability'&&req.headers.cookie){res.statusCode=200;res.setHeader('content-type','application/json');res.end(mode==='non-json'?'not json':mode==='oversized'?JSON.stringify('x'.repeat(65537)):'{}');return;}
  res.statusCode=404;res.end();
 });return {...fixture,material};
}

test('public probe refuses false challenges, excessive work, malformed cookies, redirects and invalid responses',async()=>{
 for(const [mode,failure] of [['false-page','challenge'],['difficulty','challenge'],['duplicate-cookie','challenge'],['wrong-cookie','challenge'],['insecure-cookie','challenge'],['redirect','http'],['non-json','http'],['oversized','response_limit']] as const){
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

test('public probe refuses a Domain attribute on its host-only challenge cookie',async t=>{
 const material=await certificate('probe.example.test');
 for(const [label,cookie,healthy] of [
  ['first attribute','__Host-waitron-public=fixture; Domain=probe.example.test; Path=/; Secure; HttpOnly; SameSite=Strict',false],
  ['exact host','__Host-waitron-public=fixture; Path=/; Secure; HttpOnly; SameSite=Strict; Domain=probe.example.test',false],
  ['parent domain','__Host-waitron-public=fixture; Path=/; Secure; HttpOnly; SameSite=Strict; Domain=.example.test',false],
  ['mixed case and whitespace','__Host-waitron-public=fixture; Path=/; Secure; HttpOnly; SameSite=Strict; dOmAiN = probe.example.test',false],
  ['empty domain','__Host-waitron-public=fixture; Path=/; Secure; HttpOnly; SameSite=Strict; Domain=',false],
  ['bare domain','__Host-waitron-public=fixture; Path=/; Secure; HttpOnly; SameSite=Strict; Domain',false],
  ['host-only control','__Host-waitron-public=fixture; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=300; DomainHint=ignored',true],
 ] as const)await t.test(label,async()=>{
  let replays=0;
  const fixture=await listenHttps(material,(req,res)=>{
   if(req.url==='/public/availability'){
    if(req.headers.cookie){replays++;res.setHeader('content-type','application/json');res.end('{}');}
    else{res.statusCode=403;res.setHeader('content-type','text/html');res.end('<script src="/_cloud/challenge.js"></script>');}
   }else if(req.url==='/_cloud/challenge'){
    res.setHeader('content-type','application/json');res.end('{"challenge":"fixture-challenge","difficulty":8}');
   }else if(req.url==='/_cloud/solve'){
    res.statusCode=204;res.setHeader('set-cookie',cookie);res.end();
   }else{res.statusCode=404;res.end();}
  });
  try{
   const result=await probeTarget(target(),{ca:material.cert,connect:connect(fixture.port)});
   assert.equal(result.public.status,healthy?'healthy':'failed');
   if(!healthy){assert.equal(result.public.status==='failed'&&result.public.failure,'challenge');}
   assert.equal(replays,healthy?1:0,'A refused cookie must not be sent to the availability endpoint');
  }finally{await fixture.close();}
 });
});

test('public probe uses the last Path attribute before replaying its host-only challenge cookie',async t=>{
 const material=await certificate('probe.example.test');
 for(const [label,cookie,healthy] of [
  ['later wrong path','__Host-waitron-public=fixture; Path=/; Secure; HttpOnly; SameSite=Strict; Path=/other',false],
  ['later empty path','__Host-waitron-public=fixture; Path=/; Secure; HttpOnly; SameSite=Strict; Path=',false],
  ['later bare path','__Host-waitron-public=fixture; Path=/; Secure; HttpOnly; SameSite=Strict; Path',false],
  ['mixed case and whitespace','__Host-waitron-public=fixture; Path=/; Secure; HttpOnly; SameSite=Strict; pAtH = /other',false],
  ['root restored last','__Host-waitron-public=fixture; Path=/other; Secure; HttpOnly; SameSite=Strict; Path=/',true],
  ['duplicate root','__Host-waitron-public=fixture; Path=/; Secure; HttpOnly; SameSite=Strict; Path=/',true],
  ['unrelated path hint','__Host-waitron-public=fixture; Path=/; Secure; HttpOnly; SameSite=Strict; PathHint=/other',true],
  ['no-break space in later name','__Host-waitron-public=fixture; Path=/; Secure; HttpOnly; SameSite=Strict; Path=/other; Path\u00a0=/',false],
  ['no-break space after final value','__Host-waitron-public=fixture; Path=/; Secure; HttpOnly; SameSite=Strict; Path=/other; Path=/\u00a0; Secure',false],
  ['ordinary whitespace before final root value','__Host-waitron-public=fixture; Path=/; Secure; HttpOnly; SameSite=Strict; Path=/other; Path = \t/ \t',true],
  ['equals in final value','__Host-waitron-public=fixture; Path=/; Secure; HttpOnly; SameSite=Strict; Path=/=other',false],
 ] as const)await t.test(label,async()=>{
  let replays=0;
  const fixture=await listenHttps(material,(req,res)=>{
   if(req.url==='/public/availability'){
    if(req.headers.cookie){replays++;res.setHeader('content-type','application/json');res.end('{}');}
    else{res.statusCode=403;res.setHeader('content-type','text/html');res.end('<script src="/_cloud/challenge.js"></script>');}
   }else if(req.url==='/_cloud/challenge'){
    res.setHeader('content-type','application/json');res.end('{"challenge":"fixture-challenge","difficulty":8}');
   }else if(req.url==='/_cloud/solve'){
    res.statusCode=204;res.setHeader('set-cookie',cookie);res.end();
   }else{res.statusCode=404;res.end();}
  });
  try{
   const result=await probeTarget(target(),{ca:material.cert,connect:connect(fixture.port)});
   assert.equal(result.public.status,healthy?'healthy':'failed');
   if(!healthy){assert.equal(result.public.status==='failed'&&result.public.failure,'challenge');}
   assert.equal(replays,healthy?1:0,'A refused cookie must not be sent to the availability endpoint');
  }finally{await fixture.close();}
 });
});

test('public probe refuses a challenge cookie deleted by its last Max-Age attribute',async t=>{
 const material=await certificate('probe.example.test');
 for(const [label,extra,healthy] of [
  ['zero','; Max-Age=0',false],
  ['negative','; Max-Age=-1',false],
  ['negative zero','; Max-Age=-0',false],
  ['zero padded','; Max-Age=000',false],
  ['ordinary whitespace','; mAx-AgE = \t0 \t',false],
  ['positive','; Max-Age=300',true],
  ['session','',true],
  ['deletion last','; Max-Age=300; Max-Age=0',false],
  ['positive restored last','; Max-Age=0; Max-Age=300',true],
  ['invalid last','; Max-Age=0; Max-Age=invalid',true],
  ['positive plus sign','; Max-Age=0; Max-Age=+300',true],
  ['equals ignored','; Max-Age=0; Max-Age=300=extra',true],
  ['nonpositive equals value','; Max-Age=300; Max-Age=0=extra',true],
  ['no-break name ignored','; Max-Age=0; Max-Age\u00a0=300',false],
  ['no-break value ignored','; Max-Age=0; Max-Age=300\u00a0; Secure',true],
  ['nonpositive no-break value','; Max-Age=300; Max-Age=0\u00a0; Secure',true],
  ['bare last','; Max-Age=0; Max-Age',true],
  ['plus zero','; Max-Age=+0',false],
  ['plus zero last','; Max-Age=300; Max-Age=+0',false],
  ['oversized positive last','; Max-Age=0; Max-Age='+'1'.repeat(1025),false],
  ['oversized zero last','; Max-Age=300; Max-Age='+'0'.repeat(1025),true],
  ['boundary positive last','; Max-Age=0; Max-Age='+'1'.repeat(1024),true],
  ['boundary zero last','; Max-Age=300; Max-Age='+'0'.repeat(1024),false],
  ['unrelated hint','; Max-AgeHint=0',true],
 ] as const)await t.test(label,async()=>{
  let replays=0;
  const fixture=await listenHttps(material,(req,res)=>{
   if(req.url==='/public/availability'){
    if(req.headers.cookie){replays++;res.setHeader('content-type','application/json');res.end('{}');}
    else{res.statusCode=403;res.setHeader('content-type','text/html');res.end('<script src="/_cloud/challenge.js"></script>');}
   }else if(req.url==='/_cloud/challenge'){
    res.setHeader('content-type','application/json');res.end('{"challenge":"fixture-challenge","difficulty":8}');
   }else if(req.url==='/_cloud/solve'){
    res.statusCode=204;res.setHeader('set-cookie','__Host-waitron-public=fixture; Path=/; Secure; HttpOnly; SameSite=Strict'+extra);res.end();
   }else{res.statusCode=404;res.end();}
  });
  try{
   const result=await probeTarget(target(),{ca:material.cert,connect:connect(fixture.port)});
   assert.equal(result.public.status,healthy?'healthy':'failed');
   if(!healthy)assert.equal(result.public.status==='failed'&&result.public.failure,'challenge');
   assert.equal(replays,healthy?1:0,'A deleted cookie must not reach the availability endpoint');
  }finally{await fixture.close();}
 });
});


test('public probe ignores oversized Path attributes while enforcing the last effective root path',async t=>{
 const material=await certificate('probe.example.test');
 for(const [label,paths,healthy] of [
  ['oversized after root','Path=/; Path=/'+'x'.repeat(1024),true],
  ['boundary after root','Path=/; Path=/'+'x'.repeat(1023),false],
  ['oversized after wrong path','Path=/; Path=/other; Path=/'+'x'.repeat(1024),false],
  ['oversized then root','Path=/'+'x'.repeat(1024)+'; Path=/',true],
  ['spaced oversized','Path=/; pAtH = \t/'+'x'.repeat(1024)+' \t',true],
  ['spaced boundary','Path=/; pAtH = \t/'+'x'.repeat(1023)+' \t',false],
  ['oversized with equals','Path=/; Path=/'+'x'.repeat(1022)+'=x',true],
  ['boundary with equals','Path=/; Path=/'+'x'.repeat(1021)+'=x',false],
  ['oversized without root','Path=/'+'x'.repeat(1024),false],
  ['UTF-8 bytes over limit','Path=/; Path=/'+Buffer.from('é'.repeat(512),'utf8').toString('latin1'),true],
  ['UTF-8 bytes at limit','Path=/; Path=/x'+Buffer.from('é'.repeat(511),'utf8').toString('latin1'),false],
  ['UTF-8 oversized without root','Path=/'+Buffer.from('é'.repeat(512),'utf8').toString('latin1'),false],
  ['ordinary root','Path=/',true],
  ['ordinary wrong path','Path=/; Path=/other',false],
 ] as const)await t.test(label,async()=>{
  let replays=0;
  const fixture=await listenHttps(material,(req,res)=>{
   if(req.url==='/public/availability'){
    if(req.headers.cookie){replays++;res.setHeader('content-type','application/json');res.end('{}');}
    else{res.statusCode=403;res.setHeader('content-type','text/html');res.end('<script src="/_cloud/challenge.js"></script>');}
   }else if(req.url==='/_cloud/challenge'){
    res.setHeader('content-type','application/json');res.end('{"challenge":"fixture-challenge","difficulty":8}');
   }else if(req.url==='/_cloud/solve'){
    res.statusCode=204;res.setHeader('set-cookie','__Host-waitron-public=fixture; Secure; HttpOnly; SameSite=Strict; '+paths);res.end();
   }else{res.statusCode=404;res.end();}
  });
  try{
   const result=await probeTarget(target(),{ca:material.cert,connect:connect(fixture.port)});
   assert.equal(result.public.status,healthy?'healthy':'failed');
   if(!healthy)assert.equal(result.public.status==='failed'&&result.public.failure,'challenge');
   assert.equal(replays,healthy?1:0,'Only an effective root-path cookie may reach availability');
  }finally{await fixture.close();}
 });
});


test('public probe refuses challenge cookies expired by Expires before replay',async t=>{
 const material=await certificate('probe.example.test');
 const past='Thu, 01 Jan 1970 00:00:00 GMT',future='Thu, 01 Jan 2099 00:00:00 GMT';
 for(const [label,extra,healthy,date] of [
  ['past date',`; Expires=${past}`,false],
  ['future date',`; Expires=${future}`,true],
  ['session control','',true],
  ['mixed case and whitespace',`; eXpIrEs = \t${past} \t`,false],
  ['expired last',`; Expires=${future}; Expires=${past}`,false],
  ['future restored last',`; Expires=${past}; Expires=${future}`,true],
  ['invalid last',`; Expires=${past}; Expires=invalid`,true],
  ['empty last',`; Expires=${past}; Expires=`,true],
  ['bare last',`; Expires=${past}; Expires`,true],
  ['oversized future ignored',`; Expires=${past}; Expires=${future}${' '.repeat(1025-future.length-1)}x`,false],
  ['oversized past ignored',`; Expires=${future}; Expires=${past}${' '.repeat(1025-past.length-1)}x`,true],
  ['boundary past effective',`; Expires=${future}; Expires=${past}${' '.repeat(1024-past.length-1)}x`,false],
  ['boundary future effective',`; Expires=${past}; Expires=${future}${' '.repeat(1024-future.length-1)}x`,true],
  ['positive Max-Age wins',`; Expires=${past}; Max-Age=300`,true],
  ['positive Max-Age before Expires',`; Max-Age=300; Expires=${past}`,true],
  ['zero Max-Age wins',`; Expires=${future}; Max-Age=0`,false],
  ['invalid Max-Age falls back',`; Expires=${past}; Max-Age=invalid`,false],
  ['empty Max-Age falls back',`; Expires=${past}; Max-Age=`,false],
  ['bare Max-Age falls back',`; Expires=${past}; Max-Age`,false],
  ['invalid last Max-Age falls back',`; Expires=${past}; Max-Age=300; Max-Age=invalid`,false],
  ['oversized Max-Age falls back',`; Expires=${past}; Max-Age=${'1'.repeat(1025)}`,false],
  ['positive saturated Max-Age wins',`; Expires=${past}; Max-Age=${'1'.repeat(1024)}`,true],
  ['positive overflow with junk',`; Expires=${past}; Max-Age=${'1'.repeat(30)}x`,true],
  ['negative overflow with junk',`; Expires=${future}; Max-Age=-${'1'.repeat(30)}x`,false],
  ['positive saturated boundary with junk',`; Expires=${past}; Max-Age=9223372036854775807x`,true],
  ['negative saturated boundary with junk',`; Expires=${future}; Max-Age=-9223372036854775808x`,false],
  ['positive below saturation with junk',`; Expires=${past}; Max-Age=9223372036854775806x`,false],
  ['decimal invalid age',`; Expires=${past}; Max-Age=1.2`,false],
  ['extra equals date',`; Expires=${past}=extra`,false],
  ['overflow time then valid','; Expires=01 Jan 1970 4294967296:0:0 00:00:00 GMT',false],
  ['uint boundary time retained','; Expires=01 Jan 1970 4294967295:0:0 00:00:00 GMT',true],
  ['overflow minute then valid','; Expires=01 Jan 1970 0:4294967296:0 00:00:00 GMT',false],
  ['overflow second then valid','; Expires=01 Jan 1970 0:0:4294967296 00:00:00 GMT',false],
  ['first invalid time retained','; Expires=01 Jan 1970 24:00:00 00:00:00 GMT',true],
  ['broken time then valid','; Expires=01 Jan 1970 0: 00:00:00 GMT',false],
  ['year before epoch','; Expires=01 Jan 1600 00:00:00 GMT',false],
  ['non-ASCII date separator','; Expires=01\u00a0Jan 1970 00:00:00 GMT',true],
  ['time lower-width fields','; Expires=1 Jan 1970 0:0:0 GMT',false],
  ['time zero-padded fields','; Expires=1 Jan 1970 000:000:000 GMT',false],
  ['legacy hyphenated date','; Expires=Thursday, 01-Jan-70 00:00:00 GMT',false],
  ['legacy asctime date','; Expires=Thu Jan  1 00:00:00 1970',false],
  ['quoted date',`; Expires="${past}"`,false],
  ['full month name','; Expires=01 January 1970 00:00:00 GMT',false],
  ['early year','; Expires=1970 Jan 01 00:00:00 GMT',false],
  ['abbreviated year zero','; Expires=01 Jan 00 00:00:00 GMT',false],
  ['abbreviated year sixty-nine','; Expires=01 Jan 69 00:00:00 GMT',true],
  ['invalid day','; Expires=32 Jan 1970 00:00:00 GMT',true],
  ['invalid calendar date','; Expires=31 Feb 1970 00:00:00 GMT',true],
  ['invalid hour','; Expires=01 Jan 1970 24:00:00 GMT',true],
  ['invalid minute','; Expires=01 Jan 1970 00:60:00 GMT',true],
  ['invalid second','; Expires=01 Jan 1970 00:00:60 GMT',true],
  ['missing time','; Expires=01 Jan 1970 GMT',true],
  ['missing year','; Expires=01 Jan 00:00:00 GMT',true],
  ['numeric month ignored','; Expires=1970-01-01 00:00:00 GMT',true],
  ['non-ASCII name ignored',`; Expires\u00a0=${past}`,true],
  ['unrelated hint',`; ExpiresHint=${past}`,true],
  ['expiry second after server','; Expires=01 Jan 2000 00:00:01 GMT',true,'Sat, 01 Jan 2000 00:00:00 GMT'],
  ['expiry second before server','; Expires=01 Jan 2000 00:00:00 GMT',false,'Sat, 01 Jan 2000 00:00:01 GMT'],
  ['expiry minute after server','; Expires=01 Jan 2000 00:01:00 GMT',true,'Sat, 01 Jan 2000 00:00:00 GMT'],
  ['expiry hour after server','; Expires=01 Jan 2000 01:00:00 GMT',true,'Sat, 01 Jan 2000 00:00:00 GMT'],
  ['expiry day after server','; Expires=02 Jan 2000 00:00:00 GMT',true,'Sat, 01 Jan 2000 00:00:00 GMT'],
  ['expiry month after server','; Expires=01 Feb 2000 00:00:00 GMT',true,'Sat, 01 Jan 2000 00:00:00 GMT'],
  ['December before server','; Expires=31 Dec 1999 23:59:59 GMT',false,'Sat, 01 Jan 2000 00:00:00 GMT'],
  ['valid leap day','; Expires=29 Feb 2000 00:00:00 GMT',false,'Wed, 01 Mar 2000 00:00:00 GMT'],
  ['invalid leap day','; Expires=29 Feb 2001 00:00:00 GMT',true],
  ['invalid day zero','; Expires=00 Jan 1970 00:00:00 GMT',true],
  ['missing month','; Expires=01 1970 00:00:00 GMT',true],
  ['zoneless expired','; Expires=01 Jan 2000 11:30:00 GMT',false,'Sat, 01 Jan 2000 12:00:00'],
  ['zoneless valid','; Expires=01 Jan 2000 12:30:00 GMT',true,'Sat, 01 Jan 2000 12:00:00'],
  ['asctime expired','; Expires=01 Jan 2000 11:30:00 GMT',false,'Sat Jan  1 12:00:00 2000'],
  ['asctime valid','; Expires=01 Jan 2000 12:30:00 GMT',true,'Sat Jan  1 12:00:00 2000'],
  ['explicit server zone expired','; Expires=01 Jan 2000 19:30:00 GMT',false,'Sat, 01 Jan 2000 12:00:00 PST'],
  ['explicit server zone valid','; Expires=01 Jan 2000 20:30:00 GMT',true,'Sat, 01 Jan 2000 12:00:00 PST'],
  ['server clock behind','; Expires=01 Jan 2001 00:00:00 GMT',true,'Sat, 01 Jan 2000 00:00:00 GMT'],
  ['server clock ahead','; Expires=01 Jan 2099 00:00:00 GMT',false,'Fri, 01 Jan 2100 00:00:00 GMT'],
  ['equal server date','; Expires=01 Jan 2000 00:00:00 GMT',false,'Sat, 01 Jan 2000 00:00:00 GMT'],
  ['invalid server date falls back',`; Expires=${past}`,false,'invalid'],
 ] as const)await t.test(label,async()=>{
  let replays=0;
  const fixture=await listenHttps(material,(req,res)=>{
   if(req.url==='/public/availability'){
    if(req.headers.cookie){replays++;res.setHeader('content-type','application/json');res.end('{}');}
    else{res.statusCode=403;res.setHeader('content-type','text/html');res.end('<script src="/_cloud/challenge.js"></script>');}
   }else if(req.url==='/_cloud/challenge'){
    res.setHeader('content-type','application/json');res.end('{"challenge":"fixture-challenge","difficulty":8}');
   }else if(req.url==='/_cloud/solve'){
    res.sendDate=false;if(date)res.setHeader('date',date);
    res.statusCode=204;res.setHeader('set-cookie','__Host-waitron-public=fixture; Path=/; Secure; HttpOnly; SameSite=Strict'+extra);res.end();
   }else{res.statusCode=404;res.end();}
  });
  try{
   const result=await probeTarget(target(),{ca:material.cert,connect:connect(fixture.port)});
   assert.equal(result.public.status,healthy?'healthy':'failed');
   if(!healthy)assert.equal(result.public.status==='failed'&&result.public.failure,'challenge');
   assert.equal(replays,healthy?1:0,'An expired cookie must not be sent to the availability endpoint');
  }finally{await fixture.close();}
 });
});


test('public probe expiry is independent of the probing machine time zone',()=>{
 for(const zone of ['UTC','Asia/Tokyo','America/Los_Angeles']){
  // A new test runner must not inherit this worker's runner context.
  const env:NodeJS.ProcessEnv={...process.env,TZ:zone};delete env.NODE_TEST_CONTEXT;
  const output=execFileSync(process.execPath,[
   '--test','--test-reporter=tap','--test-name-pattern=^public probe refuses challenge cookies expired by Expires before replay$',import.meta.filename,
  ],{env,encoding:'utf8'});
  assert.match(output,/ok \d+ - zoneless expired/);
  assert.match(output,/ok \d+ - asctime valid/);
 }
});


test('public probe does not normalize non-ASCII whitespace into required cookie parts',async t=>{
 const material=await certificate('probe.example.test');
 for(const [label,attributes,healthy,pair='__Host-waitron-public=fixture'] of [
  ['cookie name leading no-break space','Path=/; Secure; HttpOnly; SameSite=Strict',false,'\u00a0__Host-waitron-public=fixture'],
  ['cookie value trailing no-break space','Path=/; Secure; HttpOnly; SameSite=Strict',false,'__Host-waitron-public=fixture\u00a0'],
  ['cookie name ASCII padding','Path=/; Secure; HttpOnly; SameSite=Strict',true,' \t__Host-waitron-public=fixture'],
  ['cookie value ASCII padding','Path=/; Secure; HttpOnly; SameSite=Strict',true,'__Host-waitron-public=fixture \t'],
  ['Secure trailing no-break space','Path=/; Secure\u00a0; HttpOnly; SameSite=Strict',false],
  ['Secure leading no-break space','Path=/; \u00a0Secure; HttpOnly; SameSite=Strict',false],
  ['HttpOnly trailing no-break space','Path=/; Secure; HttpOnly\u00a0; SameSite=Strict',false],
  ['HttpOnly leading no-break space','Path=/; Secure; \u00a0HttpOnly; SameSite=Strict',false],
  ['SameSite value trailing no-break space','Path=/; Secure; HttpOnly; SameSite=Strict\u00a0; Hint=ignored',false],
  ['SameSite name leading no-break space','Path=/; Secure; HttpOnly; \u00a0SameSite=Strict',false],
  ['ordinary spaces and tabs','Path=/; \tSecure \t; \tHttpOnly \t; \tSameSite=Strict \t',true],
  ['mixed case control','Path=/; sEcUrE; hTtPoNlY; sAmEsItE=sTrIcT',true],
  ['unrelated no-break space','Path=/; Secure; HttpOnly; SameSite=Strict; Hint=\u00a0',true],
 ] as const)await t.test(label,async()=>{
  let replays=0;
  const fixture=await listenHttps(material,(req,res)=>{
   if(req.url==='/public/availability'){
    if(req.headers.cookie){replays++;assert.equal(req.headers.cookie,'__Host-waitron-public=fixture');res.setHeader('content-type','application/json');res.end('{}');}
    else{res.statusCode=403;res.setHeader('content-type','text/html');res.end('<script src="/_cloud/challenge.js"></script>');}
   }else if(req.url==='/_cloud/challenge'){
    res.setHeader('content-type','application/json');res.end('{"challenge":"fixture-challenge","difficulty":8}');
   }else if(req.url==='/_cloud/solve'){
    res.statusCode=204;res.setHeader('set-cookie',pair+'; '+attributes);res.end();
   }else{res.statusCode=404;res.end();}
  });
  try{
   const result=await probeTarget(target(),{ca:material.cert,connect:connect(fixture.port)});
   assert.equal(result.public.status,healthy?'healthy':'failed');
   if(!healthy)assert.equal(result.public.status==='failed'&&result.public.failure,'challenge');
   assert.equal(replays,healthy?1:0,'A refused cookie must not be sent to the availability endpoint');
  }finally{await fixture.close();}
 });
});


test('public probe requires the final effective SameSite attribute to be Strict',async t=>{
 const material=await certificate('probe.example.test');
 for(const [label,attributes,healthy,pair='__Host-waitron-public=fixture'] of [
  ['later Lax overrides Strict','SameSite=Strict; SameSite=Lax',false],
  ['later None overrides Strict','SameSite=Strict; SameSite=None',false],
  ['later invalid overrides Strict','SameSite=Strict; SameSite=unknown',false],
  ['later empty overrides Strict','SameSite=Strict; SameSite=',false],
  ['later bare overrides Strict','SameSite=Strict; SameSite',false],
  ['mixed case later Lax','SameSite=Strict; sAmEsItE = LaX',false],
  ['later no-break space value','SameSite=Strict; SameSite=Strict\u00a0; Hint=end',false],
  ['1024-byte value overrides Strict','SameSite=Strict; SameSite='+'x'.repeat(1024),false],
  ['1025-byte value ignored','SameSite=Strict; SameSite='+'x'.repeat(1025),true],
  ['oversized Strict does not restore','SameSite=Lax; SameSite='+'Strict'+'x'.repeat(1020),false],
  ['Strict restored last','SameSite=Lax; SameSite=Strict',true],
  ['duplicate Strict','SameSite=Strict; SameSite=Strict',true],
  ['case and ASCII whitespace','sAmEsItE = \tsTrIcT \t',true],
  ['unrelated attribute','SameSite=Strict; SameSiteHint=Lax',true],
 ] as const)await t.test(label,async()=>{
  let replays=0;
  const fixture=await listenHttps(material,(req,res)=>{
   if(req.url==='/public/availability'){
    if(req.headers.cookie){replays++;assert.equal(req.headers.cookie,'__Host-waitron-public=fixture');res.setHeader('content-type','application/json');res.end('{}');}
    else{res.statusCode=403;res.setHeader('content-type','text/html');res.end('<script src="/_cloud/challenge.js"></script>');}
   }else if(req.url==='/_cloud/challenge'){
    res.setHeader('content-type','application/json');res.end('{"challenge":"fixture-challenge","difficulty":8}');
   }else if(req.url==='/_cloud/solve'){
    res.statusCode=204;res.setHeader('set-cookie',pair+'; Path=/; Secure; HttpOnly; '+attributes);res.end();
   }else{res.statusCode=404;res.end();}
  });
  try{
   const result=await probeTarget(target(),{ca:material.cert,connect:connect(fixture.port)});
   assert.equal(result.public.status,healthy?'healthy':'failed');
   if(!healthy)assert.equal(result.public.status==='failed'&&result.public.failure,'challenge');
   assert.equal(replays,healthy?1:0,'A refused cookie must not be sent to the availability endpoint');
  }finally{await fixture.close();}
 });
});


test('public probe recognizes effective Secure and HttpOnly flag names with values',async t=>{
 const material=await certificate('probe.example.test');
 for(const [label,attributes,healthy,pair='__Host-waitron-public=fixture'] of [
  ['Secure value','Secure=yes; HttpOnly',true],
  ['HttpOnly value','Secure; HttpOnly=yes',true],
  ['empty flag values','Secure=; HttpOnly=',true],
  ['false-valued flags still apply','Secure=false; HttpOnly=false',true],
  ['case and ASCII whitespace','sEcUrE = \tyes \t; hTtPoNlY = \tno \t',true],
  ['equals inside values','Secure=a=b; HttpOnly=a=b',true],
  ['Secure 1024-byte boundary','Secure='+'x'.repeat(1024)+'; HttpOnly',true],
  ['HttpOnly 1024-byte boundary','Secure; HttpOnly='+'x'.repeat(1024),true],
  ['Secure oversized value ignored','Secure='+'x'.repeat(1025)+'; HttpOnly',false],
  ['HttpOnly oversized value ignored','Secure; HttpOnly='+'x'.repeat(1025),false],
  ['earlier Secure survives ignored duplicate','Secure=yes; Secure='+'x'.repeat(1025)+'; HttpOnly',true],
  ['earlier HttpOnly survives ignored duplicate','Secure; HttpOnly=yes; HttpOnly='+'x'.repeat(1025),true],
  ['Secure 1024 raw non-ASCII bytes','Secure='+'\xe9'.repeat(1024)+'; HttpOnly',true],
  ['Secure 1025 raw non-ASCII bytes ignored','Secure='+'\xe9'.repeat(1025)+'; HttpOnly',false],
  ['HttpOnly 1024 raw non-ASCII bytes','Secure; HttpOnly='+'\x80'.repeat(1024),true],
  ['HttpOnly 1025 raw non-ASCII bytes ignored','Secure; HttpOnly='+'\x80'.repeat(1025),false],
  ['Secure 512 two-byte sequences','Secure='+'\xc3\xa9'.repeat(512)+'; HttpOnly',true],
  ['Secure 513 two-byte sequences ignored','Secure='+'\xc3\xa9'.repeat(513)+'; HttpOnly',false],
  ['HttpOnly 512 two-byte sequences','Secure; HttpOnly='+'\xc3\xa9'.repeat(512),true],
  ['HttpOnly 513 two-byte sequences ignored','Secure; HttpOnly='+'\xc3\xa9'.repeat(513),false],
  ['earlier Secure survives non-ASCII duplicate','Secure=yes; Secure='+'\xe9'.repeat(1025)+'; HttpOnly',true],
  ['earlier HttpOnly survives non-ASCII duplicate','Secure; HttpOnly=yes; HttpOnly='+'\x80'.repeat(1025),true],
  ['Secure trims boundary value','Secure= \t'+'x'.repeat(1024)+' \t; HttpOnly',true],
  ['HttpOnly trims boundary value','Secure; HttpOnly= \t'+'x'.repeat(1024)+' \t',true],
  ['bare flags remain valid','Secure; HttpOnly',true],
  ['Secure missing','HttpOnly',false],
  ['HttpOnly missing','Secure',false],
  ['Secure lookalike','SecureHint=yes; HttpOnly',false],
  ['HttpOnly lookalike','Secure; HttpOnlyHint=yes',false],
  ['Secure no-break space name','Secure\u00a0=yes; HttpOnly',false],
  ['HttpOnly no-break space name','Secure; \u00a0HttpOnly=yes',false],
 ] as const)await t.test(label,async()=>{
  let replays=0;
  const fixture=await listenHttps(material,(req,res)=>{
   if(req.url==='/public/availability'){
    if(req.headers.cookie){replays++;assert.equal(req.headers.cookie,'__Host-waitron-public=fixture');res.setHeader('content-type','application/json');res.end('{}');}
    else{res.statusCode=403;res.setHeader('content-type','text/html');res.end('<script src="/_cloud/challenge.js"></script>');}
   }else if(req.url==='/_cloud/challenge'){
    res.setHeader('content-type','application/json');res.end('{"challenge":"fixture-challenge","difficulty":8}');
   }else if(req.url==='/_cloud/solve'){
    res.statusCode=204;res.setHeader('set-cookie',pair+'; Path=/; SameSite=Strict; '+attributes);res.end();
   }else{res.statusCode=404;res.end();}
  });
  try{
   const result=await probeTarget(target(),{ca:material.cert,connect:connect(fixture.port)});
   assert.equal(result.public.status,healthy?'healthy':'failed');
   if(!healthy)assert.equal(result.public.status==='failed'&&result.public.failure,'challenge');
   assert.equal(replays,healthy?1:0,'A refused cookie must not be sent to the availability endpoint');
  }finally{await fixture.close();}
 });
});


test('public probe accepts effective root Path attributes with ASCII whitespace before replay',async t=>{
 const material=await certificate('probe.example.test');
 for(const [label,paths,healthy] of [
  ['space before equals','Path =/',true],
  ['space after equals','Path= /',true],
  ['spaces around equals','Path = /',true],
  ['tabs around equals','Path\t=\t/',true],
  ['mixed case and outer whitespace',' \tpAtH \t= \t/ \t',true],
  ['non-root replaced by spaced root','Path=/other; Path = /',true],
  ['oversized replaced by spaced root','Path=/'+'x'.repeat(1024)+'; Path = /',true],
  ['spaced root survives oversized duplicate','Path = /; Path=/'+'x'.repeat(1024),true],
  ['spaced duplicate roots','Path = /; pAtH\t=\t/',true],
  ['root restored after empty attribute','Path=; Path = /',true],
  ['ordinary root control','Path=/',true],
  ['missing path','PathHint=/',false],
  ['bare path','Path',false],
  ['empty path','Path = ',false],
  ['non-root path','Path = /other',false],
  ['spaced root overridden by non-root','Path = /; Path=/other',false],
  ['spaced root overridden by empty','Path = /; Path=',false],
  ['spaced root overridden by bare','Path = /; Path',false],
  ['spaced root overridden at byte boundary','Path = /; Path=/'+'x'.repeat(1023),false],
  ['oversized without effective root','Path = /'+'x'.repeat(1024),false],
  ['no-break space in name','Path\u00a0=/',false],
  ['no-break space before value','Path=\u00a0/',false],
  ['no-break space after value','Path=/\u00a0',false],
  ['equals in value','Path = /=',false],
 ] as const)await t.test(label,async()=>{
  let replays=0;
  const fixture=await listenHttps(material,(req,res)=>{
   if(req.url==='/public/availability'){
    if(req.headers.cookie){replays++;assert.equal(req.headers.cookie,'__Host-waitron-public=fixture');res.setHeader('content-type','application/json');res.end('{}');}
    else{res.statusCode=403;res.setHeader('content-type','text/html');res.end('<script src="/_cloud/challenge.js"></script>');}
   }else if(req.url==='/_cloud/challenge'){
    res.setHeader('content-type','application/json');res.end('{"challenge":"fixture-challenge","difficulty":8}');
   }else if(req.url==='/_cloud/solve'){
    res.statusCode=204;res.setHeader('set-cookie','__Host-waitron-public=fixture; Secure; HttpOnly; SameSite=Strict; '+paths);res.end();
   }else{res.statusCode=404;res.end();}
  });
  try{
   const result=await probeTarget(target(),{ca:material.cert,connect:connect(fixture.port)});
   assert.equal(result.public.status,healthy?'healthy':'failed');
   if(!healthy)assert.equal(result.public.status==='failed'&&result.public.failure,'challenge');
   assert.equal(replays,healthy?1:0,'Only an effective root-path cookie may reach availability');
  }finally{await fixture.close();}
 });
});


test('public probe recognises Domain attribute names using only ASCII whitespace',async t=>{
 const material=await certificate('probe.example.test');
 for(const [label,attributes,healthy] of [
  ['domain name trailing no-break space','Domain\u00a0=probe.example.test',true],
  ['domain name leading no-break space','\u00a0Domain=probe.example.test',true],
  ['domain bare name trailing no-break space','Domain\u00a0',true],
  ['domain bare name leading no-break space','\u00a0Domain',true],
  ['domain name surrounded by no-break spaces','\u00a0Domain\u00a0=probe.example.test',true],
  ['domain mixed case with no-break space','dOmAiN\u00a0=probe.example.test',true],
  ['domain lookalike with ordinary outer spaces',' \tDomain\u00a0 \t=probe.example.test',true],
  ['domain lookalike empty value','Domain\u00a0=',true],
  ['domain name ordinary spaces',' \tDomain \t=probe.example.test',false],
  ['domain name ordinary tabs','Domain\t=probe.example.test',false],
  ['domain real populated name','Domain=probe.example.test',false],
  ['domain real mixed case','dOmAiN=probe.example.test',false],
  ['domain real bare name','Domain',false],
  ['domain real empty value','Domain=',false],
  ['domain real name with no-break value','Domain=\u00a0probe.example.test',false],
  ['domain real after lookalike','Domain\u00a0=probe.example.test; Domain=probe.example.test',false],
  ['domain real before lookalike','Domain=probe.example.test; Domain\u00a0=probe.example.test',false],
  ['domain bare real after lookalike','Domain\u00a0=probe.example.test; Domain',false],
  ['domain unrelated hint','DomainHint=probe.example.test',true],
  ['domain no attribute','Other=fixture',true],
 ] as const)await t.test(label,async()=>{
  let replays=0;
  const fixture=await listenHttps(material,(req,res)=>{
   if(req.url==='/public/availability'){
    if(req.headers.cookie){replays++;assert.equal(req.headers.cookie,'__Host-waitron-public=fixture');res.setHeader('content-type','application/json');res.end('{}');}
    else{res.statusCode=403;res.setHeader('content-type','text/html');res.end('<script src="/_cloud/challenge.js"></script>');}
   }else if(req.url==='/_cloud/challenge'){
    res.setHeader('content-type','application/json');res.end('{"challenge":"fixture-challenge","difficulty":8}');
   }else if(req.url==='/_cloud/solve'){
    res.statusCode=204;res.setHeader('set-cookie','__Host-waitron-public=fixture; Path=/; Secure; HttpOnly; SameSite=Strict; '+attributes);res.end();
   }else{res.statusCode=404;res.end();}
  });
  try{
   const result=await probeTarget(target(),{ca:material.cert,connect:connect(fixture.port)});
   assert.equal(result.public.status,healthy?'healthy':'failed');
   if(!healthy)assert.equal(result.public.status==='failed'&&result.public.failure,'challenge');
   assert.equal(replays,healthy?1:0,'Only a cookie without a genuine Domain attribute may reach availability');
  }finally{await fixture.close();}
 });
});


import {setTimeout as setWatchdog,clearTimeout as clearWatchdog} from 'node:timers';

test('probe cancellation during connection resolution prevents network work',async t=>{
 const material=await certificate('probe.example.test');
 for(const turns of [0,1,2,3,4,5,6,7,8])await t.test(`abort after ${turns} promise turns`,async()=>{
  const stop=new AbortController();let connections=0;
  const fixture=await listenHttps(material,(_req,res)=>{res.end();});
  fixture.server.on('connection',()=>connections++);
  try{
   const result=await probeTarget(target('probe.example.test'),{ca:material.cert,signal:stop.signal,connect:()=>{
    const abortLater=(remaining:number)=>remaining?queueMicrotask(()=>abortLater(remaining-1)):stop.abort();
    abortLater(turns);return Promise.resolve({address:'127.0.0.1',family:4,port:fixture.port});
   }});
   for(const service of [result.public,result.staff]){
    assert.equal(service.status,'failed');
    if(service.status==='failed')assert.equal(service.failure,'cancelled');
   }
   assert.equal(connections,0,'Cancelled resolution must not open a network connection');
  }finally{await fixture.close();}
 });
});

test('probe cancellation finishes while both connection resolvers are pending',async()=>{
 const stop=new AbortController();let announce!:()=>void;
 const entered=new Promise<void>(resolve=>{announce=resolve;});
 let count=0;const finish:((value:{address:string;family:4;port:number})=>void)[]=[];
 const result=probeTarget(target(),{signal:stop.signal,connect:()=>new Promise(resolve=>{
  finish.push(resolve);if(++count===2)announce();
 })});
 await entered;stop.abort();
 let cancelWatchdog=()=>{};
 try{
  const value=await Promise.race([result,new Promise<undefined>(resolve=>{const timer=setWatchdog(()=>resolve(undefined),1000);cancelWatchdog=()=>clearWatchdog(timer);})]);
  assert.ok(value,'Cancellation must finish without waiting for the address resolver');
  for(const service of [value.public,value.staff]){
   assert.equal(service.status,'failed');
   if(service.status==='failed')assert.equal(service.failure,'cancelled');
  }
 }finally{
  cancelWatchdog();
  for(const resolve of finish)resolve({address:'127.0.0.1',family:4,port:1});
  await result;
 }
});

test('public and staff probes retain successful deferred connection resolution',async()=>{
 const material=await certificate('probe.example.test');let replays=0;
 const fixture=await listenHttps(material,(req,res)=>{
  if(req.url==='/public/availability'&&!req.headers.cookie){res.statusCode=403;res.setHeader('content-type','text/html');res.end('<script src="/_cloud/challenge.js"></script>');}
  else if(req.url==='/_cloud/challenge'){res.setHeader('content-type','application/json');res.end('{"challenge":"fixture-challenge","difficulty":8}');}
  else if(req.url==='/_cloud/solve'){res.statusCode=204;res.setHeader('set-cookie','__Host-waitron-public=fixture; Path=/; Secure; HttpOnly; SameSite=Strict');res.end();}
  else{replays++;assert.equal(req.headers.cookie,'__Host-waitron-public=fixture');res.setHeader('content-type','application/json');res.end('{}');}
 });
 try{
  const result=await probeTarget(target('probe.example.test'),{ca:material.cert,connect:async()=>{
   await Promise.resolve();return {address:'127.0.0.1',family:4,port:fixture.port};
  }});
  assert.equal(result.public.status,'healthy');assert.equal(result.staff.status,'healthy');assert.equal(replays,1);
 }finally{await fixture.close();}
});


test('probe connection resolution retains the overall deadline failure',async()=>{
 const finish:((value:{address:string;family:4;port:number})=>void)[]=[];
 const result=probeTarget(target(),{connect:()=>new Promise(resolve=>finish.push(resolve))});
 let cancelWatchdog=()=>{};
 try{
  const value=await Promise.race([result,new Promise<undefined>(resolve=>{const timer=setWatchdog(()=>resolve(undefined),17000);cancelWatchdog=()=>clearWatchdog(timer);})]);
  assert.ok(value,'The overall deadline must finish even when address resolution never returns');
  for(const service of [value.public,value.staff]){
   assert.equal(service.status,'failed');
   if(service.status==='failed')assert.equal(service.failure,'timeout');
  }
 }finally{
  cancelWatchdog();
  for(const resolve of finish)resolve({address:'127.0.0.1',family:4,port:1});
  await result;
 }
});

test('probe cancellation consumes an address resolver rejection',async()=>{
 const stop=new AbortController();
 const result=await probeTarget(target(),{signal:stop.signal,connect:async()=>{
  stop.abort();throw new Error('fixture-resolution-refused');
 }});
 for(const service of [result.public,result.staff]){
  assert.equal(service.status,'failed');
  if(service.status==='failed')assert.equal(service.failure,'cancelled');
 }
});


test('probe cancellation prevents queued resolver invocation',async()=>{
 const stop=new AbortController();let calls=0;
 const result=await probeTarget(target(),{signal:stop.signal,connect:()=>{
  calls++;stop.abort();return {address:'127.0.0.1',family:4,port:1};
 }});
 for(const service of [result.public,result.staff]){
  assert.equal(service.status,'failed');
  if(service.status==='failed')assert.equal(service.failure,'cancelled');
 }
 assert.equal(calls,1,'A resolver queued before cancellation must not run after cancellation');
});


import {spawn} from 'node:child_process';

test('staff probe releases its verified TLS connection without waiting for the peer',async()=>{
 const material=await certificate('staff.probe.example.test'),sockets=new Set<import('node:net').Socket>();
 const server=tlsServer({...material,allowHalfOpen:true},socket=>{
  socket.on('error',()=>{});socket.resume();
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert(address&&typeof address!=='string');
 server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
 const publicPort=await unusedPort(),source=`
  import {probeTarget} from ${JSON.stringify(new URL('../src/probe.ts',import.meta.url).href)};
  let input='';for await(const chunk of process.stdin)input+=chunk;
  const {target,ca,staffPort,publicPort}=JSON.parse(input);
  const value=await probeTarget(target,{ca,connect:hostname=>({address:'127.0.0.1',family:4,port:hostname.startsWith('staff.')?staffPort:publicPort})});
  console.log(JSON.stringify(value));
 `;
 const child=spawn(process.execPath,['--input-type=module','--eval',source],{stdio:['pipe','pipe','pipe']});
 let output='',errors='',forced=false,finishTimer:ReturnType<typeof setWatchdog>|undefined;
 const watchdog=setWatchdog(()=>{forced=true;child.kill('SIGKILL');},5000);
 child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('\n')&&!finishTimer)finishTimer=setWatchdog(()=>{forced=true;child.kill('SIGKILL');},1000);});
 child.stderr.on('data',chunk=>{errors+=chunk;});
 const exited=new Promise<{code:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
 child.stdin.end(JSON.stringify({target:target(),ca:material.cert.toString(),staffPort:address.port,publicPort}));
 try{
  const exit=await exited,value=JSON.parse(output);
  assert.equal(value.staff.status,'healthy');assert.equal(value.staff.certificate.fingerprint256,new X509Certificate(material.cert).fingerprint256);
  assert.equal(forced,false,'The completed probe must let its process exit while the peer keeps its write side open');
  assert.deepEqual(exit,{code:0,signal:null},errors);
 }finally{
  clearWatchdog(watchdog);if(finishTimer)clearWatchdog(finishTimer);
  if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited;
  for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));
 }
});
