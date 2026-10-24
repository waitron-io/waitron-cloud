import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer,request} from 'node:http';
import {createServer as httpsServer} from 'node:https';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {createPublicGate} from '../src/public-gate.ts';
const host='sol.example.test';
async function fixture(){
 let now=Date.now(),available=true,disconnect=false;
 const root=await mkdtemp(join(tmpdir(),'cloud-gate-pki-'));
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=staff.sol.example.test','-addext','subjectAltName=DNS:staff.sol.example.test','-keyout',join(root,'key.pem'),'-out',join(root,'cert.pem')],{stdio:'ignore'});
 const key=await readFile(join(root,'key.pem')),certificate=await readFile(join(root,'cert.pem'));await rm(root,{recursive:true});
 let upstream=0;let headers:Record<string,unknown>={};
 const venue=httpsServer({key,cert:certificate},(req,res)=>{upstream++;headers=req.headers;if(!available){if(disconnect){req.socket.destroy();return;}res.statusCode=503;res.end('internal failure at staff.sol.example.test: database offline');return;}res.setHeader('Set-Cookie','staff=private');res.end('available');});await new Promise<void>(r=>venue.listen(0,'127.0.0.1',r));const address=venue.address();assert.ok(address&&typeof address!=='string');
 const gate=createPublicGate({key:randomBytes(32),now:()=>now,difficulty:8,ca:certificate,routes:()=>[{publicHostname:host,staffHostname:'staff.sol.example.test',address:'127.0.0.1',port:address.port}]});
 const server=createServer(gate.handle);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const bound=server.address();assert.ok(bound&&typeof bound!=='string');
 const send=(path='/public/availability',extra:Record<string,string>={},method='GET',body?:string)=>new Promise<Response>((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port:bound.port,path,method,headers:{host,'x-waitron-client-ip':'192.0.2.2','x-waitron-sni':host,...extra}},res=>{const chunks:Buffer[]=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{const headers=new Headers();for(const [key,value]of Object.entries(res.headers)){if(Array.isArray(value))for(const v of value)headers.append(key,v);else if(value)headers.set(key,value);}resolve(new Response(res.statusCode===204?null:Buffer.concat(chunks),{status:res.statusCode!,headers}));});});req.on('error',reject);req.end(body);
 });
 return {send,gate,advance:(ms:number)=>{now+=ms;},unavailable:(dropConnection=false)=>{available=false;disconnect=dropConnection;},count:()=>upstream,headers:()=>headers,async close(){server.closeAllConnections();venue.closeAllConnections();await Promise.all([new Promise<void>(r=>server.close(()=>r())),new Promise<void>(r=>venue.close(()=>r()))]);}};
}
function solve(challenge:string,bits:number){for(let n=0;;n++){const hash=createHash('sha256').update(`${challenge}:${n}`).digest();if(hash.readUInt32BE(0)<2**(32-bits))return n;}}
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
    assert.match(body,want==='es'?/No disponible temporalmente/:/Temporarily unavailable/);
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
