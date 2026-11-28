import assert from 'node:assert/strict';
import {test,mock} from 'node:test';
import {createServer,request} from 'node:http';
import {IncomingMessage,type RequestListener,type ServerResponse} from 'node:http';
import {Socket} from 'node:net';
import {EventEmitter} from 'node:events';
import {createServer as httpsServer} from 'node:https';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {createPublicGate,type PublicGateOptions} from '../src/public-gate.ts';
const host='sol.example.test';
for(const outcome of ['403','429','network','worker','challenge','success'])test(`served challenge script recovers from ${outcome}`,async()=>{
 const f=await fixture();try{
  const script=await(await f.send('/_cloud/challenge.js')).text();
  const paragraph={textContent:'Please wait a moment. / Espera un momento.',
  get innerHTML(){return this.markup;},
  set innerHTML(value:string){this.markup=value;this.textContent=value.replace(/<[^>]*>/g,'');},
  markup:'Please wait a moment. / Espera un momento.',
 };
  const redirects:string[]=[],requests:{path:string;init?:RequestInit}[]=[],errors:unknown[]=[];
  let browserWorker:{onmessage?:({data}:{data:unknown})=>Promise<void>;onerror?:()=>void;terminate:()=>void};
  let terminated=false;
  const proof={challenge:'browser-proof',nonce:42};
  await runInNewContext(script,{
   AbortController,setTimeout,clearTimeout,
   document:{querySelector:()=>paragraph},location:{replace:(path:string)=>redirects.push(path)},
   Worker:class {
    constructor(path:string){assert.equal(path,'/_cloud/worker.js');browserWorker=this;}
    postMessage(){}
    terminate(){terminated=true;}
   },
   fetch:async(path:string,init?:RequestInit)=>{
    requests.push({path,init});
    if(path==='/_cloud/challenge'){
     if(outcome==='challenge')throw new Error('offline');
     return Response.json({challenge:'browser-proof',difficulty:8});
    }
    assert.equal(path,'/_cloud/solve');
    if(outcome==='network')throw new Error('offline');
    return new Response(null,{status:outcome==='403'?403:outcome==='429'?429:204});
   },
  });
  if(outcome==='worker')browserWorker!.onerror?.();
  else if(outcome!=='challenge')await browserWorker!.onmessage!({data:proof}).catch(error=>errors.push(error));
  if(outcome==='success'){
   assert.deepEqual(redirects,['/public/availability']);
   assert.equal(paragraph.textContent,'Please wait a moment. / Espera un momento.');
  }else{
   if(outcome==='worker'){
    assert.equal(paragraph.textContent,'This browser check could not finish. Try another browser, update it and check that JavaScript is allowed. / No se pudo completar la comprobación. Prueba con otro navegador, actualízalo y comprueba que JavaScript esté permitido.');
    assert.match(paragraph.innerHTML,/<span lang="es">No se pudo completar la comprobación\./);
   }else{
    assert.equal(paragraph.textContent,'Please reload to try again. / Vuelve a cargar para intentarlo de nuevo.');
    assert.match(paragraph.innerHTML,/<span lang="es">Vuelve a cargar para intentarlo de nuevo\.<\/span>/,'the reload message must preserve Spanish pronunciation');
   }
   assert.deepEqual(redirects,[]);
  }
  assert.deepEqual(errors,[],'browser event handlers must contain request failures');
  assert.equal(requests.length,outcome==='worker'||outcome==='challenge'?1:2);
  if(requests.length===2){
   assert.equal(terminated,true);
   assert.equal(requests[1]!.init!.method,'POST');
   assert.equal(new Headers(requests[1]!.init!.headers).get('content-type'),'application/json');
   assert.deepEqual(JSON.parse(requests[1]!.init!.body as string),proof);
  }
 }finally{await f.close();}
});
async function fixture(beginForward?:(route:Readonly<{publicHostname:string;staffHostname:string;address:string;port:number}>,startedAt:number)=>((category:string|null,observedAt:number)=>void)|undefined,
 liveMenu?:{authorize?:NonNullable<PublicGateOptions['menu']>['authorize'];match?:NonNullable<PublicGateOptions['menu']>['match'];respond:RequestListener}){
 let routed=true;
 let now=Date.now(),available=true,disconnect=false,failureStatus=503,mode='normal';
 let start:()=>void=()=>{};const started=new Promise<void>(resolve=>{start=resolve;});
 const root=await mkdtemp(join(tmpdir(),'cloud-gate-pki-'));
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=staff.sol.example.test','-addext','subjectAltName=DNS:staff.sol.example.test','-keyout',join(root,'key.pem'),'-out',join(root,'cert.pem')],{stdio:'ignore'});
 const key=await readFile(join(root,'key.pem')),certificate=await readFile(join(root,'cert.pem'));await rm(root,{recursive:true});
 let upstream=0;let headers:Record<string,unknown>={};
 const venue=httpsServer({key,cert:certificate},(req,res)=>{upstream++;headers=req.headers;start();if(liveMenu&&(req.url==='/'||req.url?.startsWith('/synthetic-menu'))){liveMenu.respond(req,res);return;}if(mode==='timeout'||mode==='cancel')return;if(mode==='limit'){res.end('x'.repeat(65537));return;}if(mode==='partial'){res.writeHead(200,{'Content-Length':'50'});res.write('partial');setImmediate(()=>res.destroy());return;}if(!available){if(disconnect){req.socket.destroy();return;}res.statusCode=failureStatus;res.end('internal failure at staff.sol.example.test: database offline');return;}res.setHeader('Set-Cookie','staff=private');res.end('available');});await new Promise<void>(r=>venue.listen(0,'127.0.0.1',r));const address=venue.address();assert.ok(address&&typeof address!=='string');
 const gate=createPublicGate({key:randomBytes(32),now:()=>now,difficulty:8,ca:certificate,beginForward,menu:liveMenu&&{port:address.port,match:liveMenu.match??(path=>path==='/'||path==='/synthetic-menu'||path==='/synthetic-menu/es'?'page':path==='/synthetic-menu/abc.jpg'?'asset':undefined),authorize:liveMenu.authorize??(async()=>true)},routes:()=>routed?[{publicHostname:host,staffHostname:'staff.sol.example.test',address:'127.0.0.1',get port(){if(mode==='internal')throw 'secret construction failure';return address.port;}}]:[]});
 const server=createServer(gate.handle);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const bound=server.address();assert.ok(bound&&typeof bound!=='string');
 const send=(path='/public/availability',extra:Record<string,string>={},method='GET',body?:string)=>new Promise<Response>((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port:bound.port,path,method,headers:{host,'x-waitron-client-ip':'192.0.2.2','x-waitron-sni':host,...extra}},res=>{const chunks:Buffer[]=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);res.on('end',()=>{const headers=new Headers();for(const [key,value]of Object.entries(res.headers)){if(Array.isArray(value))for(const v of value)headers.append(key,v);else if(value)headers.set(key,value);}resolve(new Response(res.statusCode===204?null:Buffer.concat(chunks),{status:res.statusCode!,headers}));});});req.on('error',reject);req.end(body);
 });
 return {send,gate,started,bound,withdraw:()=>{routed=false;},setMode:(value:string)=>{mode=value;},advance:(ms:number)=>{now+=ms;},unavailable:(dropConnection=false,status=503)=>{available=false;disconnect=dropConnection;failureStatus=status;},recover:()=>{available=true;},count:()=>upstream,headers:()=>headers,async close(){server.closeAllConnections();venue.closeAllConnections();await Promise.all([new Promise<void>(r=>server.close(()=>r())),new Promise<void>(r=>venue.close(()=>r()))]);}};
}
function solve(challenge:string,bits:number){for(let n=0;;n++){const hash=createHash('sha256').update(`${challenge}:${n}`).digest();if(hash.readUInt32BE(0)<2**(32-bits))return n;}}

async function accessCookie(f:Awaited<ReturnType<typeof fixture>>){
 const challenge=await(await f.send('/_cloud/challenge')).json() as {challenge:string;difficulty:number};
 const reply=await f.send('/_cloud/solve',{'content-type':'application/json'},'POST',JSON.stringify({challenge:challenge.challenge,nonce:solve(challenge.challenge,challenge.difficulty)}));
 assert.equal(reply.status,204);return reply.headers.get('set-cookie')!.split(';')[0]!;
}

for(const status of [201,302,403,404,503])test(`completed_http_is_not_transport: ${status}`,async()=>{
 const calls:unknown[][]=[];let begins=0;
 const f=await fixture((route,startedAt)=>{begins++;assert.equal(route.publicHostname,host);assert.ok(Number.isSafeInteger(startedAt));return (...args)=>{calls.push(args);};});
 try{
  const cookie=await accessCookie(f);f.unavailable(false,status);
  const response=await f.send('/public/availability',{cookie,accept:'application/json'});
  assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'venue_unavailable'});
  assert.equal(begins,1);assert.equal(calls.length,1);assert.equal(calls[0]!.length,2);
  assert.equal(calls[0]![0],'upstream_non_200');assert.ok(Number.isSafeInteger(calls[0]![1]));
  assert.equal(f.gate.stats().forwarded,1);assert.equal(f.gate.stats().unavailable,1);assert.equal(f.gate.stats().active,0);
 }finally{await f.close();}
});

for(const [mode,category] of [['timeout','upstream_timeout'],['limit','upstream_response_limit'],['disconnect','upstream_transport'],['partial','upstream_transport'],['internal','forward_internal']] as const)test(`timeout_limit_transport_internal_are_distinct: ${mode}`,async()=>{
 const calls:unknown[][]=[];const f=await fixture(()=> (...args)=>{calls.push(args);});
 try{
  const cookie=await accessCookie(f);f.setMode(mode);if(mode==='disconnect')f.unavailable(true);
  const response=await f.send('/public/availability',{cookie,accept:'text/html','accept-language':'es'});
  const body=await response.text();assert.equal(response.status,503);assert.match(body,/<h1>Local no disponible<\/h1>/);
  assert.doesNotMatch(body,/secret|staff\.sol|internal failure|127\.0|partial/);
  assert.equal(calls.length,1);assert.deepEqual(calls[0]!.slice(0,1),[category]);assert.equal(calls[0]!.length,2);
  assert.equal(f.gate.stats().unavailable,1);assert.equal(f.gate.stats().active,0);
 }finally{await f.close();}
});

test('cancel_and_local_refusals_emit_nothing',async()=>{
 let begins=0;const calls:unknown[][]=[];const f=await fixture(()=>{begins++;return (...args)=>{calls.push(args);};});
 try{
  for(const [path,status,headers] of [['/public/availability',421,{'x-waitron-sni':'unknown.example.test'}],['/private',404,{}],['/public/availability',403,{}]] as const)assert.equal((await f.send(path,headers)).status,status);
  assert.equal(begins,0);assert.deepEqual(calls,[]);
  const cookie=await accessCookie(f);f.setMode('cancel');
  const req=request({host:'127.0.0.1',port:f.bound.port,path:'/public/availability',headers:{host,'x-waitron-sni':host,'x-waitron-client-ip':'192.0.2.2',cookie}});
  req.on('error',()=>{});req.end();await f.started;req.destroy();
  for(let i=0;i<100&&f.gate.stats().active;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(begins,1);assert.deepEqual(calls,[]);assert.equal(f.gate.stats().active,0);
  assert.equal(f.gate.stats().unavailable,1,'cancellation keeps the existing unavailable counter');
 }finally{await f.close();}
});

for(const phase of ['begin','complete'])test(`observer_throw_does_not_change_public_reply: ${phase}`,async()=>{
 let invocations=0;const f=await fixture(()=>{if(phase==='begin'){invocations++;throw 'private observer failure';}return ()=>{invocations++;throw new Error('private observer failure');};});
 try{
  const cookie=await accessCookie(f);
  assert.equal((await f.send('/public/availability',{cookie})).status,200);
  f.unavailable();const response=await f.send('/public/availability',{cookie,accept:'application/json'});
  assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'venue_unavailable'});
  assert.equal(f.gate.stats().forwarded,2);assert.equal(f.gate.stats().unavailable,1);assert.equal(f.gate.stats().active,0);assert.equal(invocations,2);
 }finally{await f.close();}
});

for(const phase of ['begin','complete'])test(`observer_rejection_does_not_escape: ${phase}`,async()=>{
 let invocations=0;const f=await fixture(()=>{
  if(phase==='begin'){invocations++;return Promise.reject(new Error('private asynchronous begin')) as unknown as undefined;}
  return async()=>{invocations++;throw new Error('private asynchronous completion');};
 });
 try{
  const cookie=await accessCookie(f);
  assert.equal((await f.send('/public/availability',{cookie})).status,200);
  f.unavailable();const response=await f.send('/public/availability',{cookie,accept:'application/json'});
  assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'venue_unavailable'});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(invocations,2);
  assert.equal(f.gate.stats().forwarded,2);assert.equal(f.gate.stats().unavailable,1);assert.equal(f.gate.stats().active,0);
 }finally{await f.close();}
});

test('private_payload_never_escapes and successful completion reports null exactly once',async()=>{
 const calls:unknown[][]=[];const f=await fixture(()=> (...args)=>{calls.push(args);});
 try{
  const cookie=await accessCookie(f);f.unavailable();
  const refused=await f.send('/public/availability',{cookie,authorization:'Bearer PRIVATE-CANARY',accept:'text/html'});
  assert.equal(refused.status,503);assert.doesNotMatch(await refused.text(),/staff\.sol|database offline|PRIVATE-CANARY/);
  f.recover();const recovered=await f.send('/public/availability',{cookie,authorization:'Bearer PRIVATE-CANARY'});
  assert.equal(recovered.status,200);assert.equal(await recovered.text(),'available');assert.equal(recovered.headers.get('set-cookie'),null);
  assert.equal(f.headers().authorization,undefined);assert.equal(f.headers().cookie,undefined);
  assert.equal(calls.length,2);assert.deepEqual(calls.map(args=>args[0]),['upstream_non_200',null]);
  assert.ok(calls.every(args=>args.length===2&&Number.isSafeInteger(args[1])));
  assert.doesNotMatch(JSON.stringify(calls),/staff\.sol|127\.0|database offline|PRIVATE-CANARY|headers|body|path/);
  assert.equal(f.gate.stats().unavailable,1);assert.equal(f.gate.stats().active,0);
 }finally{await f.close();}
});

test('a synchronous visitor reply failure cannot complete one attempt twice',async()=>{
 const calls:unknown[][]=[];const f=await fixture(()=> (...args)=>{calls.push(args);});
 try{
  const cookie=await accessCookie(f);const response=new EventEmitter();let writes=0;
  const ended=new Promise<void>(resolve=>Object.assign(response,{
   writableEnded:false,headersSent:false,
   writeHead(){if(++writes===1)throw new Error('visitor response failure');},end(){resolve();},
  }));
  const req=new IncomingMessage(new Socket());
  Object.assign(req,{headers:{host,'x-waitron-sni':host,'x-waitron-client-ip':'192.0.2.2',cookie},url:'/public/availability',method:'GET'});
  f.gate.handle(req,response as ServerResponse);
  await ended;assert.equal(writes,2);assert.equal(calls.length,1);assert.equal(calls[0]![0],null);
  assert.equal(f.gate.stats().active,0);
 }finally{await f.close();}
});

test('missing upstream status is an internal failure, never an application refusal',async()=>{
 const calls:unknown[][]=[];const f=await fixture(()=> (...args)=>{calls.push(args);});
 let stub:ReturnType<typeof mock.method>|undefined;
 try{
  const cookie=await accessCookie(f);
  // The HTTPS boundary supplies a malformed response to exercise the defensive missing-status branch.
  stub=mock.method(https,'request',((...args:unknown[])=>{
   const onResponse=args.at(-1) as (response:unknown)=>void,upstream=new EventEmitter();
   Object.assign(upstream,{end(){queueMicrotask(()=>{const response=Object.assign(new EventEmitter(),{complete:true});onResponse(response);response.emit('end');upstream.emit('close');});}});
   return upstream;
  }) as unknown as typeof https.request);syncBuiltinESMExports();
  const response=await f.send('/public/availability',{cookie,accept:'application/json'});
  assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'venue_unavailable'});
  assert.equal(calls.length,1);assert.equal(calls[0]![0],'forward_internal');assert.equal(f.gate.stats().active,0);
 }finally{stub?.mock.restore();syncBuiltinESMExports();await f.close();}
});
test('public challenge gates actual HTTPS forwarding and strips staff credentials and cookies',async()=>{
 const f=await fixture();try{
  assert.equal((await f.send('/management-api/session')).status,404);assert.equal((await f.send('/public/availability',{},'POST')).status,405);
  assert.equal((await f.send('/public/availability',{'x-waitron-sni':'other.example.test'})).status,421);
  const blocked=await f.send();assert.equal(blocked.status,403);assert.equal(f.count(),0);
  const challenge=await (await f.send('/_cloud/challenge')).json() as {challenge:string;difficulty:number};
  const answer=await f.send('/_cloud/solve',{'content-type':'application/json'},'POST',JSON.stringify({challenge:challenge.challenge,nonce:solve(challenge.challenge,challenge.difficulty)}));assert.equal(answer.status,204);
  const cookie=answer.headers.get('set-cookie')!.split(';')[0]!;assert.match(answer.headers.get('set-cookie')!,/Secure/);assert.match(answer.headers.get('set-cookie')!,/HttpOnly/);
  const good=await f.send('/public/availability',{cookie:cookie+'; management_session=stolen',authorization:'Bearer staff-secret','x-forwarded-host':'staff.sol.example.test'});
  assert.equal(good.status,200);assert.equal(await good.text(),'available');assert.equal(good.headers.get('set-cookie'),null);assert.equal(f.count(),1);
  assert.equal(f.headers().cookie,undefined);assert.equal(f.headers().authorization,undefined);assert.equal(f.headers()['x-forwarded-host'],undefined);
  assert.equal((await f.send('/public/availability',{cookie:cookie+'x'})).status,403);
  assert.equal((await f.send('/public/availability',{cookie,'x-waitron-client-ip':'192.0.2.3'})).status,403);assert.equal(f.count(),1);
 }finally{await f.close();}
});

test('malformed Host ports are refused before issuing challenges',async()=>{
 const f=await fixture();try{for(const value of [host+':junk',host+':443:80',host+':0',host+':65536'])assert.equal((await f.send('/_cloud/challenge',{host:value})).status,421,value);assert.equal(f.count(),0);}finally{await f.close();}
});
test('expired proof and access, request quotas and unavailable venues stay bounded',async()=>{
 const f=await fixture();try{
  const challenge=await (await f.send('/_cloud/challenge')).json() as {challenge:string;difficulty:number};const body=JSON.stringify({challenge:challenge.challenge,nonce:solve(challenge.challenge,challenge.difficulty)});
  const answer=await f.send('/_cloud/solve',{},'POST',body);assert.equal(answer.status,204);const cookie=answer.headers.get('set-cookie')!.split(';')[0]!;
  f.unavailable();assert.equal((await f.send('/public/availability',{cookie})).status,503);assert.equal(f.gate.stats().active,0);
  f.advance(120001);assert.equal((await f.send('/_cloud/solve',{},'POST',body)).status,403);
  f.advance(180000);assert.equal((await f.send('/public/availability',{cookie})).status,403);assert.equal(f.count(),1);
  assert.equal((await f.send('/_cloud/solve',{},'POST','{')).status,400);
  assert.equal((await f.send('/_cloud/solve',{},'POST',JSON.stringify({challenge:'forged',nonce:0}))).status,403);
  f.advance(60001);for(let i=0;i<120;i++)assert.equal((await f.send('/_cloud/challenge')).status,200);assert.equal((await f.send('/_cloud/challenge')).status,429);assert.equal(f.count(),1);assert.equal(f.gate.stats().buckets,1);
 }finally{await f.close();}
});

for(const dropConnection of [false,true])test(`unavailable venues return private, localised HTML or JSON (${dropConnection?'connection lost':'HTTP error'})`,async()=>{
 const f=await fixture();try{
  const challenge=await (await f.send('/_cloud/challenge')).json() as {challenge:string;difficulty:number};
  const answer=await f.send('/_cloud/solve',{},'POST',JSON.stringify({challenge:challenge.challenge,nonce:solve(challenge.challenge,challenge.difficulty)}));
  assert.equal(answer.status,204);const cookie=answer.headers.get('set-cookie')!.split(';')[0]!;
  f.unavailable(dropConnection);
  const cases=[
   {accept:'text/html',language:'es-ES, en;q=0.5',want:'es'},
   {accept:'*/*',language:'es;q=0.2,en;q=0.9',want:'en'},
   {accept:'text/html',language:'fr',want:'en'},
   {accept:'text/html',language:'es;q=0,en',want:'en'},
   {accept:'text/html',language:'es;q=0',want:'en'},
   {accept:'application/json;q=0',language:'en',want:'en'},
   {accept:'text/html',language:'es\"><script>alert(1)</script>',want:'en'},
   {accept:'application/json',language:'es',want:'json'},
   {accept:'application/json;q=0,text/html',language:'es',want:'es'},
   {accept:'text/html;q=0.5,application/json;q=1',language:'en',want:'json'},
   {accept:'application/json;q=0.1,text/html;q=1',language:'en',want:'en'},
  ];
  for(const {accept,language,want}of cases){
   const response=await f.send('/public/availability',{cookie,accept,'accept-language':language});
   assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('retry-after'),'30');
   assert.match(response.headers.get('vary')!,/Accept-Language/i);assert.match(response.headers.get('vary')!,/Accept(?:,|$)/i);
   const body=await response.text();assert.doesNotMatch(body,/staff\.|sol\.example|127\.0\.0|database|internal failure|upstream/i);
   if(want==='json'){
    assert.match(response.headers.get('content-type')!,/^application\/json/);assert.deepEqual(JSON.parse(body),{error:'venue_unavailable'});
   }else{
    assert.match(response.headers.get('content-type')!,/^text\/html/);assert.equal(response.headers.get('content-language'),want);
    assert.match(body,new RegExp(`<html lang="${want}">`));assert.match(body,/<main>/);assert.match(body,/<a href="\/public\/availability">/);
    assert.match(body,want==='es'?/<h1>Local no disponible<\/h1>/:/<h1>Venue unavailable<\/h1>/);
    assert.match(response.headers.get('content-security-policy')!,/style-src 'sha256-/);
   }
  }
  assert.equal(f.gate.stats().unavailable,cases.length);assert.equal(f.gate.stats().forwarded,cases.length);assert.equal(f.gate.stats().active,0);
 }finally{await f.close();}
});

test('rotating 4096 addresses in one IPv6 /64 leaves another network able to request a challenge',async()=>{
 const f=await fixture();try{
  const statuses=new Map<number,number>();
  for(let i=0;i<4096;i++){
   const response=await f.send('/_cloud/challenge',{'x-waitron-client-ip':`2001:db8:1234:5678::${i.toString(16)}`});
   statuses.set(response.status,(statuses.get(response.status)??0)+1);
  }
  assert.equal((await f.send('/_cloud/challenge',{'x-waitron-client-ip':'2001:db8:1234:5679::1'})).status,200,'another network must not be locked out');
  assert.deepEqual([...statuses],[[200,120],[429,3976]]);
  assert.equal(f.gate.stats().buckets,2);assert.equal(f.count(),0);
 }finally{await f.close();}
});

for(const {name,first,second}of [
 {name:'IPv6 /64 across compressed and expanded forms',first:'2001:db8:abcd:ffff::1',second:'2001:0DB8:ABCD:FFFF:ffff:ffff:ffff:ffff'},
 {name:'IPv6 /64 with zeroes compressed inside its network prefix',first:'2001:0:0:1::1',second:'2001::1:ffff:ffff:ffff:ffff'},
 {name:'IPv6 /64 with an embedded IPv4 tail',first:'2001:db8:1:2::192.0.2.1',second:'2001:db8:1:2::c000:202'},
 {name:'IPv4-compatible IPv6 stays in its native IPv6 /64',first:'::192.0.2.1',second:'::192.0.2.2'},
 {name:'scoped IPv6 addresses',first:'fe80::1%eth0',second:'FE80:0:0:0:ffff::2%eth0'},
 {name:'IPv4 and its dotted mapped IPv6 form',first:'192.0.2.1',second:'::ffff:192.0.2.1'},
 {name:'IPv4 and its expanded hexadecimal mapped IPv6 form',first:'192.0.2.1',second:'0000:0000:0000:0000:0000:FFFF:C000:0201'},
])test(`public request allowance is shared by ${name}`,async()=>{
 const f=await fixture();try{
  for(let i=0;i<120;i++)assert.equal((await f.send('/_cloud/challenge',{'x-waitron-client-ip':i%2?second:first})).status,200);
  assert.equal((await f.send('/_cloud/challenge',{'x-waitron-client-ip':second})).status,429);
  assert.equal(f.gate.stats().buckets,1);assert.equal(f.count(),0);
  f.advance(60000);
  assert.equal((await f.send('/_cloud/challenge',{'x-waitron-client-ip':first})).status,200);
  assert.equal(f.gate.stats().buckets,1);
 }finally{await f.close();}
});

for(const {name,first,second}of [
 {name:'neighbouring IPv6 /64 networks',first:'2001:db8:1:fffe::1',second:'2001:db8:1:ffff::1'},
 {name:'individual IPv4 addresses',first:'192.0.2.1',second:'192.0.2.2'},
 {name:'different mapped IPv4 addresses',first:'::ffff:192.0.2.1',second:'::ffff:c000:202'},
 {name:'IPv4-compatible IPv6 and IPv4',first:'::192.0.2.1',second:'192.0.2.1'},
])test(`public request allowances stay separate for ${name}`,async()=>{
 const f=await fixture();try{
  for(let i=0;i<120;i++)assert.equal((await f.send('/_cloud/challenge',{'x-waitron-client-ip':first})).status,200);
  assert.equal((await f.send('/_cloud/challenge',{'x-waitron-client-ip':first})).status,429);
  assert.equal((await f.send('/_cloud/challenge',{'x-waitron-client-ip':second})).status,200);
  assert.equal(f.gate.stats().buckets,2);assert.equal(f.count(),0);
 }finally{await f.close();}
});

test('sharing an IPv6 request allowance does not share challenge proofs or access cookies',async()=>{
 const f=await fixture();try{
  const source={'x-waitron-client-ip':'2001:db8:1:2::1'},neighbour={'x-waitron-client-ip':'2001:db8:1:2::2'};
  const challenge=await (await f.send('/_cloud/challenge',source)).json() as {challenge:string;difficulty:number};
  const body=JSON.stringify({challenge:challenge.challenge,nonce:solve(challenge.challenge,challenge.difficulty)});
  assert.equal((await f.send('/_cloud/solve',neighbour,'POST',body)).status,403);
  const answer=await f.send('/_cloud/solve',source,'POST',body);assert.equal(answer.status,204);
  const cookie=answer.headers.get('set-cookie')!.split(';')[0]!;
  assert.equal((await f.send('/public/availability',{...neighbour,cookie})).status,403);assert.equal(f.count(),0);
  assert.equal((await f.send('/public/availability',{...source,cookie})).status,200);assert.equal(f.count(),1);
 }finally{await f.close();}
});

test('4096 distinct source networks still bound the table and expired buckets free capacity',async()=>{
 const f=await fixture();try{
  for(let i=0;i<4096;i++)assert.equal((await f.send('/_cloud/challenge',{'x-waitron-client-ip':`2001:db8:${i.toString(16)}::1`})).status,200);
  assert.equal((await f.send('/_cloud/challenge',{'x-waitron-client-ip':'2001:db9::1'})).status,429);
  assert.equal(f.gate.stats().buckets,4096);assert.equal(f.count(),0);
  f.advance(60000);
  assert.equal((await f.send('/_cloud/challenge',{'x-waitron-client-ip':'2001:db9::1'})).status,200);
  assert.equal(f.gate.stats().buckets,1);
 }finally{await f.close();}
});

for(const language of ['en-GB','es-ES, en;q=0.5'])test(`the bot-check page marks its Spanish text as Spanish (${language})`,async()=>{
 const f=await fixture();try{
  const response=await f.send('/public/availability',{'accept-language':language});
  assert.equal(response.status,403);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('content-security-policy'),"default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  const body=await response.text();
  assert.match(body,/<html lang="en">/);
  assert.match(body,/<title>Checking your browser \/ Comprobando tu navegador<\/title>/,'both languages must be available in the browser tab');
  assert.match(body,/<h1>Checking your browser \/ <span lang="es">Comprobando tu navegador<\/span><\/h1>/);
  assert.match(body,/<p>Please wait a moment\. \/ <span lang="es">Espera un momento\.<\/span><\/p>/);
  assert.match(body,/<script src="\/_cloud\/challenge\.js" defer><\/script>/);
  assert.equal(f.count(),0);
 }finally{await f.close();}
});


for(const disconnect of [false,true])test(`unavailable response respects application wildcard preferences (${disconnect?'connection lost':'HTTP error'})`,async t=>{
 const f=await fixture();try{
  const challenge=await (await f.send('/_cloud/challenge')).json() as {challenge:string;difficulty:number};
  const answer=await f.send('/_cloud/solve',{'content-type':'application/json'},'POST',JSON.stringify({challenge:challenge.challenge,nonce:solve(challenge.challenge,challenge.difficulty)}));
  assert.equal(answer.status,204);const cookie=answer.headers.get('set-cookie')!.split(';')[0]!;
  f.unavailable(disconnect);
  for(const [label,accept,json] of [
   ['application wildcard only','application/*',true],
   ['application wildcard preferred','text/html;q=0.5,application/*;q=1',true],
   ['case and whitespace',' Application/* ; q=0.8, text/html;q=0.2',true],
   ['HTML preferred','application/*;q=0.5,text/html;q=1',false],
   ['equal preference application first','application/*,text/html',true],
   ['equal preference HTML first','text/html,application/*',true],
   ['explicit JSON exclusion','application/*;q=1,application/json;q=0,text/html;q=0.5',false],
   ['explicit JSON overrides wildcard','application/*;q=0,application/json;q=0.8,text/html;q=0.5',true],
   ['explicit JSON lower preference','application/*;q=1,application/json;q=0.2,text/html;q=0.5',false],
   ['wildcard exclusion','application/*;q=0,text/html;q=0.5',false],
   ['invalid wildcard quality','application/*;q=invalid,text/html;q=0.5',false],
   ['browser default','*/*',false],
   ['HTML type wildcard','application/*;q=0.5,text/*;q=1',false],
  ] as const)await t.test(label,async()=>{
   const response=await f.send('/public/availability',{cookie,accept,'accept-language':'es'}),body=await response.text();
   assert.equal(response.status,503);assert.equal(response.headers.get('retry-after'),'30');
   assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('vary'),'Accept, Accept-Language');
   assert.equal(response.headers.get('set-cookie'),null);assert.equal(response.headers.get('x-content-type-options'),'nosniff');
   assert.doesNotMatch(body,/staff\.sol|database|internal failure|127\.0\.0\.1/);
   if(json){assert.match(response.headers.get('content-type')!,/^application\/json/);assert.deepEqual(JSON.parse(body),{error:'venue_unavailable'});}
   else{assert.match(response.headers.get('content-type')!,/^text\/html/);assert.equal(response.headers.get('content-language'),'es');assert.match(body,/<h1>Local no disponible<\/h1>/);}
  });
  assert.equal(f.gate.stats().active,0);
 }finally{await f.close();}
});


for(const locale of ['en','es'])for(const failure of [403,404,503,'disconnect'] as const)test(`${locale}: public retry can stay unavailable then recover after ${failure}`,async()=>{
 const f=await fixture();try{
  const challenge=await(await f.send('/_cloud/challenge')).json() as {challenge:string;difficulty:number};
  const answer=await f.send('/_cloud/solve',{'content-type':'application/json'},'POST',JSON.stringify({challenge:challenge.challenge,nonce:solve(challenge.challenge,challenge.difficulty)}));
  assert.equal(answer.status,204);const cookie=answer.headers.get('set-cookie')!.split(';')[0]!;
  const headers={cookie,accept:'text/html','accept-language':locale};
  f.unavailable(failure==='disconnect',typeof failure==='number'?failure:503);
  let path='/public/availability';
  for(let attempt=1;attempt<=2;attempt++){
   const response=await f.send(path,headers),body=await response.text();
   assert.equal(response.status,503);assert.equal(response.headers.get('retry-after'),'30');
   assert.equal(response.headers.get('content-language'),locale);assert.equal(response.headers.get('cache-control'),'no-store');
   assert.equal(response.headers.get('set-cookie'),null);
   assert.match(body,locale==='es'?/<title>Local no disponible<\/title>/:/<title>Venue unavailable<\/title>/);
   assert.match(body,locale==='es'?/<h1>Local no disponible<\/h1>/:/<h1>Venue unavailable<\/h1>/);
   assert.match(body,locale==='es'?/<p>La página de este local no está disponible\. Puedes volver a intentarlo\.<\/p>/:/<p>This venue’s page is unavailable\. You can try again\.<\/p>/);
   assert.doesNotMatch(body,/temporar|temporal|in a moment|en unos momentos|staff\.|database|internal failure|upstream|127\.0\.0/i);
   const retry=body.match(/<a href="([^"]+)">([^<]+)<\/a>/);
   assert.ok(retry);assert.equal(retry[1],'/public/availability');
   assert.equal(retry[2],locale==='es'?'Volver a intentar':'Try again');path=retry[1];
   assert.equal(f.count(),attempt);assert.equal(f.gate.stats().active,0);
  }
  f.recover();const recovered=await f.send(path,headers);
  assert.equal(recovered.status,200);assert.equal(await recovered.text(),'available');
  assert.equal(recovered.headers.get('set-cookie'),null);assert.equal(f.count(),3);
  assert.equal(f.gate.stats().unavailable,2);assert.equal(f.gate.stats().forwarded,3);assert.equal(f.gate.stats().active,0);
 }finally{await f.close();}
});

const menuPath='/synthetic-menu',menuAccept={accept:'text/html'};
test('public menu forwards only an allowed GET or HEAD over verified box TLS',async()=>{
 const requests:string[]=[];
 const f=await fixture(undefined,{respond:(req,res)=>{
  requests.push(req.method!);
  assert.equal(req.headers.host,'staff.sol.example.test');
  assert.equal(req.headers.cookie,undefined);
  assert.equal(req.headers.authorization,undefined);
  assert.equal(req.headers['accept-language'],'es');
  res.writeHead(200,{'content-type':'text/html','content-language':'es','cache-control':'public, max-age=120','age':'17','set-cookie':'private=value','x-frame-options':'DENY'});
  res.end('Menú');
 }});
 try{
  const headers={...menuAccept,'accept-language':'es',cookie:'session=private',authorization:'Bearer private'};
  const page=await f.send(menuPath,headers);
  assert.equal(page.status,200);
  assert.equal(await page.text(),'Menú');
  assert.equal(page.headers.get('content-language'),'es');
  assert.equal(page.headers.get('cache-control'),'public, max-age=60');
  assert.equal(page.headers.get('age'),'17');
  assert.equal(page.headers.get('set-cookie'),null);
  assert.equal(page.headers.get('x-frame-options'),null);
  assert.doesNotMatch(page.headers.get('content-security-policy')??'',/frame-ancestors/);
  assert.equal(await (await f.send(menuPath,headers,'HEAD')).text(),'');
  assert.equal((await f.send(menuPath,headers,'POST')).status,405);
  assert.equal((await f.send(menuPath+'?unknown=1',headers)).status,404);
  assert.equal((await f.send(menuPath,{...headers,'x-waitron-sni':'other.example.test'})).status,421);
  assert.equal((await f.send('/public/availability')).status,403);
  assert.deepEqual(requests,['GET','HEAD']);
  assert.equal(f.gate.stats().forwarded,0);
 }finally{await f.close();}
});

test('public menu forwards an empty relative redirect and serves its destination on the next request',async()=>{
 const f=await fixture(undefined,{respond:(req,res)=>{
  if(req.url==='/synthetic-menu/es'){res.end('Menú');return;}
  res.writeHead(302,{location:'/synthetic-menu/es','cache-control':'public, max-age=120',age:'17',vary:'Accept-Language','content-length':'3'});
  res.end('box');
 }});
 try{
  for(const path of ['/',menuPath]){
   const redirect=await f.send(path,menuAccept);
   assert.equal(redirect.status,302);
   assert.equal(redirect.headers.get('location'),'/synthetic-menu/es');
   assert.equal(redirect.headers.get('cache-control'),'public, max-age=60');
   assert.equal(redirect.headers.get('age'),'17');
   assert.equal(redirect.headers.get('vary'),'Accept-Language');
   assert.equal(redirect.headers.get('x-content-type-options'),'nosniff');
   assert.equal(redirect.headers.get('referrer-policy'),'no-referrer');
   assert.equal(await redirect.text(),'');
   const page=await f.send(redirect.headers.get('location')!,menuAccept);
   assert.equal(page.status,200);
   assert.equal(await page.text(),'Menú');
  }
 }finally{await f.close();}
});

for(const [path,location,destinationKind] of [
 [menuPath,'/synthetic-menu\\es','page'],
 [menuPath,'//elsewhere.example.test','page'],
 [menuPath,'https://elsewhere.example.test/menu','page'],
 [menuPath,'/public/availability','page'],
 [menuPath,'/other-menu',undefined],
 [menuPath,'/synthetic-menu/photo','asset'],
 ['/synthetic-menu/abc.jpg','/synthetic-menu/es','page'],
] as const)test(`public menu rejects a redirect from ${path} to ${location}`,async()=>{
 const f=await fixture(undefined,{
  match:target=>target==='/synthetic-menu/abc.jpg'?'asset':target===path?'page':target===location?destinationKind:undefined,
  respond:(_req,res)=>{res.writeHead(302,{location});res.end();},
 });
 try{
  const response=await f.send(path,menuAccept);
  assert.equal(response.status,503);
  assert.equal(response.headers.get('location'),null);
 }finally{await f.close();}
});

test('public menu withholds a redirect when sharing is blocked at box headers',async()=>{
 let reads=0;
 const f=await fixture(undefined,{
  authorize:async()=>++reads===1,
  respond:(_req,res)=>{res.writeHead(302,{location:'/synthetic-menu/es'});res.end();},
 });
 try{
  const response=await f.send(menuPath,menuAccept);
  assert.equal(response.status,404);
  assert.equal(response.headers.get('location'),null);
  assert.equal(f.count(),1);
 }finally{await f.close();}
});

for(const [change,status] of [['off',404],['blocked',404],['read failure',503],['blocked at headers',404],['withdrawn at headers',404]] as const)
 test(`public menu withholds box bytes when ${change}`,async()=>{
  let reads=0;
  const f=await fixture(undefined,change==='off'?undefined:{
   authorize:async()=>{
    reads++;
    if(change==='read failure')throw Error('private authority error');
    return change!=='blocked'&&(change!=='blocked at headers'||reads===1);
   },
   respond:(_req,res)=>{if(change==='withdrawn at headers')f.withdraw();res.end('private box bytes');},
  });
  try{
   const response=await f.send(menuPath,menuAccept);
   assert.equal(response.status,status);
   assert.equal(response.headers.get('cache-control'),'no-store');
   const body=await response.text();
   assert.match(body,/<h1>/);
   assert.doesNotMatch(body,/private/);
   if(change!=='off'){
    assert.doesNotMatch(body,/public\/availability/);
    assert.equal(response.headers.get('content-security-policy'),"default-src 'none'; base-uri 'none'");
   }
   assert.equal(f.count(),change.endsWith('headers')?1:0);
  }finally{await f.close();}
 });

test('public menu keeps forward slots while bodies stream and waits briefly for a slot',async()=>{
 const held:ServerResponse[]=[];
 const f=await fixture(undefined,{respond:(_req,res)=>{
  if(held.length===4){res.end('next');return;}
  held.push(res);res.write('part');
 }});
 const first=Array.from({length:4},()=>f.send(menuPath));
 try{
  for(let i=0;i<100&&held.length<4;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(held.length,4);
  const next=f.send(menuPath);
  await new Promise(resolve=>setTimeout(resolve,350));
  assert.equal(f.count(),4);
  held[0]!.end(' done');
  assert.equal(await (await first[0]!).text(),'part done');
  const response=await next;
  assert.equal(response.status,200);
  assert.equal(await response.text(),'next');
  for(const res of held.slice(1))res.end();
  await Promise.all(first);
 }finally{
  const settled=Promise.allSettled(first);
  await f.close();
  await settled;
 }
});

test('public menu replaces an oversized response declared at headers with a readable 503',async()=>{
 const f=await fixture(undefined,{respond:(_req,res)=>{
  res.writeHead(200,{'content-length':String(2*1024*1024+1)});res.end('private box bytes');
 }});
 try{
  const response=await f.send(menuPath,menuAccept);
  assert.equal(response.status,503);
  assert.doesNotMatch(await response.text(),/private box bytes|public\/availability/);
 }finally{await f.close();}
});

test('gateway refuses public menu with signed metering before network startup',()=>{
 const result=spawnSync(process.execPath,[new URL('../src/gateway-cli.ts',import.meta.url).pathname],{
  encoding:'utf8',timeout:5000,env:{PATH:process.env.PATH,GATEWAY_LIVE_GUEST_MENU:'1',
   GATEWAY_CELL_ID:'00000000-0000-0000-0000-000000000001',GATEWAY_TRAFFIC_MODE:'test',GATEWAY_TRAFFIC_COUNTRY:'ES',
   GATEWAY_TRAFFIC_ENVIRONMENT:'test',GATEWAY_TRAFFIC_SOCKET_DIRECTORY:'/state/traffic',GATEWAY_TRAFFIC_OPERATIONAL_SOURCES:'["127.0.0.2"]'},
 });
 assert.equal(result.status,1);
 assert.match(result.stderr,/guest_menu_metering_incompatible/);
});

test('public menu returns readable 429 when the wait expires and keeps availability separate',async()=>{
 const held:ServerResponse[]=[];
 const f=await fixture(undefined,{respond:(_req,res)=>{held.push(res);res.write('part');}});
 try{
  const first=Array.from({length:4},()=>f.send(menuPath));
  for(let i=0;i<100&&held.length<4;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(held.length,4);
  const refused=await f.send(menuPath,menuAccept);
  assert.equal(refused.status,429);
  const body=await refused.text();
  assert.match(body,/<h1>/);
  assert.doesNotMatch(body,/public\/availability/);
  assert.equal(f.count(),4);
  assert.equal((await f.send('/public/availability')).status,403);
  for(const res of held)res.end();
  await Promise.all(first);
 }finally{await f.close();}
});

test('public menu stops an oversized stream after delivering its first bytes',async()=>{
 const f=await fixture(undefined,{respond:(_req,res)=>{
  res.writeHead(200,{'content-type':'text/html'});res.write('first');
  setTimeout(()=>res.end('x'.repeat(2*1024*1024)),150).unref();
 }});
 try{
  let body='';
  await assert.rejects(new Promise<void>((resolve,reject)=>{
   const req=request({host:'127.0.0.1',port:f.bound.port,path:menuPath,headers:{
    host,'x-waitron-client-ip':'192.0.2.2','x-waitron-sni':host,
   }},res=>{
    res.on('data',chunk=>{body+=chunk;});res.on('end',resolve);res.on('error',reject);
   });
   req.on('error',reject);req.end();
  }),/aborted/);
  assert.ok(body.startsWith('first'));
  assert.ok(Buffer.byteLength(body)<=2*1024*1024);
 }finally{await f.close();}
});

test('public menu releases its slot when a box tries to upgrade the response',async()=>{
 const f=await fixture(undefined,{respond:(_req,res)=>{
  res.writeHead(101,{Connection:'Upgrade',Upgrade:'synthetic'});res.end();
 }});
 try{
  const deadline=AbortSignal.timeout(750);
  const response=await Promise.race([f.send(menuPath,menuAccept),new Promise<never>((_resolve,reject)=>{
   deadline.addEventListener('abort',()=>reject(Error('gateway gave no reply after upgrade')),{once:true});
  })]);
  assert.equal(response.status,503);
  assert.equal(f.gate.stats().menu?.active,0);
 }finally{await f.close();}
});

for(const heldRead of [1,2])test(`public menu releases the slot if the visitor leaves during authority read ${heldRead}`,async()=>{
 let entered!:()=>void,reads=0;
 const reading=new Promise<void>(resolve=>{entered=resolve;});
 const f=await fixture(undefined,{authorize:async()=>{
  if(++reads!==heldRead)return true;
  entered();return new Promise(()=>{});
 },respond:(_req,res)=>res.end('menu')});
 try{
  const req=request({host:'127.0.0.1',port:f.bound.port,path:menuPath,headers:{
   host,'x-waitron-client-ip':'192.0.2.2','x-waitron-sni':host,
  }});
  req.on('error',()=>{});req.end();
  await reading;
  req.destroy();
  for(let i=0;i<50&&f.gate.stats().menu?.active;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(f.gate.stats().menu?.active,0);
  assert.equal(f.count(),heldRead-1);
 }finally{await f.close();}
});

test('public menu returns 503 at its deadline even when the authority reader stays pending',async t=>{
 const timeout=AbortSignal.timeout;
 t.mock.method(AbortSignal,'timeout',(ms:number)=>timeout(ms===10000?100:ms));
 const f=await fixture(undefined,{authorize:()=>new Promise(()=>{}),respond:(_req,res)=>res.end()});
 try{
  const response=await Promise.race([f.send(menuPath),new Promise<never>((_resolve,reject)=>{
   timeout(750).addEventListener('abort',()=>reject(Error('gateway missed the forward deadline')),{once:true});
  })]);
  assert.equal(response.status,503);
  assert.equal(f.gate.stats().menu?.active,0);
 }finally{await f.close();}
});
