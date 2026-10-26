import {X509Certificate,createHash} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {request} from 'node:https';
import {BlockList,isIP} from 'node:net';
import {connect as tlsConnect} from 'node:tls';
import type {ConnectionOptions,TLSSocket} from 'node:tls';
import {performance} from 'node:perf_hooks';
import {setImmediate as immediate} from 'node:timers/promises';
import type {RemoteProbeTarget} from './probe-targets.ts';

export type ProbeFailure='dns'|'address_forbidden'|'timeout'|'tls'|'challenge'|'http'|'response_limit'|'cancelled';
export interface ProbeCertificate {notBefore:string;notAfter:string;fingerprint256:string}
export interface ProbeSuccess {status:'healthy';checkedAt:string;elapsedMs:number;certificate:ProbeCertificate}
export interface ProbeFailureResult {status:'failed';checkedAt:string;elapsedMs:number;failure:ProbeFailure}
export type ProbeServiceResult=ProbeSuccess|ProbeFailureResult;
export interface RemoteProbeResult extends RemoteProbeTarget {version:1;checkedAt:string;public:ProbeServiceResult;staff:ProbeServiceResult}
export interface ProbeConnection {address:string;family:4|6;port:number}
export interface ProbeOptions {
 signal?:AbortSignal;
 ca?:ConnectionOptions['ca'];
 connect?:(hostname:string)=>ProbeConnection|Promise<ProbeConnection>;
}
interface ScopedProbeOptions extends ProbeOptions {externalSignal?:AbortSignal;deadlineSignal?:AbortSignal}

class ProbeError extends Error {readonly failure:ProbeFailure;constructor(failure:ProbeFailure){super(failure);this.failure=failure;}}
// Keep families separate: mapped IPv6 subnets also match direct IPv4 in BlockList.
const ipv4Blocked=new BlockList(),ipv6Blocked=new BlockList();
for(const [network,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const)ipv4Blocked.addSubnet(network,prefix,'ipv4');
for(const [network,prefix] of [['::',128],['::1',128],['::ffff:0:0',96],['64:ff9b::',96],['64:ff9b:1::',48],['100::',64],['2001::',23],['2001:db8::',32],['3fff::',20],['4000::',3],['6000::',3],['8000::',3],['a000::',3],['c000::',3],['e000::',4],['f000::',5],['f800::',6],['fc00::',7],['fe00::',9],['fe80::',10],['fec0::',10],['ff00::',8]] as const)ipv6Blocked.addSubnet(network,prefix,'ipv6');

export function isPublicProbeAddress(address:string,family:number):address is string {
 if((family!==4&&family!==6)||isIP(address)!==family||(family===4?ipv4Blocked:ipv6Blocked).check(address,family===4?'ipv4':'ipv6'))return false;
 if(family===4)return true;
 // Canonical hex also covers dotted IPv4 tails; expand before locating the tunnel endpoint.
 const canonical=new URL(`http://[${address.split('%',1)[0]}]`).hostname.slice(1,-1);
 const [head,tail]=canonical.split('::'),leading=head?head.split(':'):[],trailing=tail?tail.split(':'):[];
 const words=[...leading,...Array<string>(8-leading.length-trailing.length).fill('0'),...trailing].map(word=>parseInt(word,16));
 // Translated addresses carry IPv4 after ::ffff:0:0:0/96, distinct from mapped addresses.
 const translated=words.slice(0,4).every(word=>word===0)&&words[4]===0xffff&&words[5]===0;
 const offset=words[0]===0x2002?1:translated||words.slice(0,6).every(word=>word===0)?6:undefined;
 // Unhandled ::/8 forms are reserved; embedded IPv4 keeps its separate validation.
 if(offset===undefined)return words[0]!>=0x100;
 const high=words[offset]!,low=words[offset+1]!,ipv4=[high>>>8,high&255,low>>>8,low&255].join('.');
 return !ipv4Blocked.check(ipv4,'ipv4');
}
function abortFailure(options:ScopedProbeOptions):ProbeFailure {return options.externalSignal?.aborted?'cancelled':'timeout';}
async function abortable<T>(promise:Promise<T>,options:ScopedProbeOptions):Promise<T> {
 const signal=options.signal;if(!signal)return promise;if(signal.aborted)throw new ProbeError(abortFailure(options));
 return new Promise<T>((resolve,reject)=>{let settled=false;const done=(error?:unknown,value?:T)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);if(error)reject(error);else resolve(value!);},abort=()=>done(new ProbeError(abortFailure(options)));signal.addEventListener('abort',abort,{once:true});promise.then(value=>done(undefined,value),done);});
}
async function connections(hostname:string,options:ScopedProbeOptions):Promise<ProbeConnection[]> {
 if(options.signal?.aborted)throw new ProbeError(abortFailure(options));
 if(options.connect){
  // Attach cancellation and rejection handlers before a resolver can cancel synchronously.
  const connection=await abortable(Promise.resolve().then(()=>{
   if(options.signal?.aborted)throw new ProbeError(abortFailure(options));
   return options.connect!(hostname);
  }),options);
  return [connection];
 }
 let answers;try{answers=await abortable(lookup(hostname,{all:true,verbatim:true}),options);}catch(error){if(error instanceof ProbeError)throw error;if(options.signal?.aborted)throw new ProbeError(abortFailure(options));throw new ProbeError('dns');}
 const values=answers.slice(0,4),allowed=values.filter(v=>isPublicProbeAddress(v.address,v.family)).map(v=>({address:v.address,family:v.family as 4|6,port:443}));
 if(!allowed.length)throw new ProbeError(values.length?'address_forbidden':'dns');return allowed;
}
function certificate(raw:Buffer):ProbeCertificate {
 const value=new X509Certificate(raw);return {notBefore:new Date(value.validFrom).toISOString(),notAfter:new Date(value.validTo).toISOString(),fingerprint256:value.fingerprint256};
}
const elapsed=(started:number)=>Math.max(0,Math.round(performance.now()-started));
function failed(started:number,failure:ProbeFailure):ProbeFailureResult{return {status:'failed',checkedAt:new Date().toISOString(),elapsedMs:elapsed(started),failure};}
function classify(error:unknown,options:ScopedProbeOptions):ProbeFailure {
 if(error instanceof ProbeError)return error.failure;if(options.signal?.aborted)return abortFailure(options);return 'tls';
}
async function staffOnce(hostname:string,connection:ProbeConnection,options:ScopedProbeOptions):Promise<ProbeCertificate> {
 if(options.signal?.aborted)throw new ProbeError(abortFailure(options));
 return new Promise((resolve,reject)=>{
  let settled=false;const done=(error?:unknown,value?:ProbeCertificate)=>{if(settled)return;settled=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve(value!);};
  const settings:ConnectionOptions={host:connection.address,port:connection.port,servername:hostname,ca:options.ca,rejectUnauthorized:true};
  const socket=tlsConnect(settings,()=>{
   // Flush the handshake before releasing the socket without waiting for the peer.
   try{const peer=socket.getPeerCertificate(true);if(!peer.raw)throw new ProbeError('tls');const evidence=certificate(peer.raw);socket.end(()=>socket.destroy());done(undefined,evidence);}catch(error){socket.destroy();done(error);}
  });
  const timer=setTimeout(()=>{socket.destroy();done(new ProbeError('timeout'));},5000);
  const abort=()=>{socket.destroy();done(new ProbeError(abortFailure(options)));};
  options.signal?.addEventListener('abort',abort,{once:true});socket.once('error',error=>done(error));
 });
}
async function probeStaff(target:RemoteProbeTarget,options:ScopedProbeOptions):Promise<ProbeServiceResult> {
 const started=performance.now();try{
  const candidates=await connections(target.staffHostname,options);let last:unknown;
  for(const connection of candidates){try{const evidence=await staffOnce(target.staffHostname,connection,options);return {status:'healthy',checkedAt:new Date().toISOString(),elapsedMs:elapsed(started),certificate:evidence};}catch(error){last=error;if(options.signal?.aborted)break;}}
  return failed(started,classify(last,options));
 }catch(error){return failed(started,classify(error,options));}
}
interface HttpsResult {status:number;headers:import('node:http').IncomingHttpHeaders;body:Buffer;certificate:ProbeCertificate}
async function https(target:string,connection:ProbeConnection,path:string,method:'GET'|'POST',options:ScopedProbeOptions,body?:string,cookie?:string):Promise<HttpsResult> {
 if(options.signal?.aborted)throw new ProbeError(abortFailure(options));
 return new Promise((resolve,reject)=>{
  let settled=false,req:ReturnType<typeof request>;
  const done=(error?:unknown,value?:HttpsResult)=>{if(settled)return;settled=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve(value!);};
  req=request({host:connection.address,port:connection.port,family:connection.family,servername:target,ca:options.ca,rejectUnauthorized:true,method,path,agent:false,headers:{host:target,accept:'application/json',...(body?{'content-type':'application/json','content-length':Buffer.byteLength(body)}:{}),...(cookie?{cookie}:{})}},response=>{
   let size=0;const chunks:Buffer[]=[];let evidence:ProbeCertificate;
   try{const peer=(response.socket as TLSSocket).getPeerCertificate(true);if(!peer.raw)throw new ProbeError('tls');evidence=certificate(peer.raw);}catch(error){response.destroy();done(error);return;}
   response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>65536){response.destroy(new ProbeError('response_limit'));return;}chunks.push(chunk);});
   response.once('error',error=>done(error));response.once('end',()=>done(undefined,{status:response.statusCode??0,headers:response.headers,body:Buffer.concat(chunks),certificate:evidence}));
  });
  const timer=setTimeout(()=>req.destroy(new ProbeError('timeout')),5000),abort=()=>req.destroy(new ProbeError(abortFailure(options)));
  options.signal?.addEventListener('abort',abort,{once:true});req.once('error',error=>done(error));req.end(body);
 });
}
function contentType(result:HttpsResult,type:string){return result.headers['content-type']?.split(';',1)[0]?.trim().toLowerCase()===type;}
async function solve(challenge:string,difficulty:number,options:ScopedProbeOptions){
 const maximum=Math.min(1_000_000_000,2**difficulty*16);
 for(let nonce=0;nonce<maximum;nonce++){
  if(createHash('sha256').update(`${challenge}:${nonce}`).digest().readUInt32BE(0)<2**(32-difficulty))return nonce;
  if((nonce&2047)===2047){if(options.signal?.aborted)throw new ProbeError(abortFailure(options));await immediate();}
 }
 throw new ProbeError('challenge');
}
function cookieExpiry(value:string):number|undefined {
 // Cookie dates accept legacy separators and year forms, but not calendar rollover.
 const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
 let day:number|undefined,month:number|undefined,year:number|undefined,time:number[]|undefined;
 for(const token of value.split(/[\t\x20-\x2f\x3b-\x40\x5b-\x60\x7b-\x7e]+/).filter(Boolean)){
  if(!/^[0-9]/.test(token)){
   if(month===undefined){const index=months.indexOf(token.slice(0,3).toLowerCase());if(index>=0)month=index;}
  }else if(token.includes(':')){
   if(time===undefined&&/^\d+:\d+:\d+$/.test(token)){const fields=token.split(':').map(Number);if(fields.every(value=>value<=4294967295))time=fields;}
  }else if(/^\d+$/.test(token)){
   if(day===undefined&&token.length<=2)day=Number(token);
   else if(year===undefined&&token.length<=5)year=Number(token);
  }
 }
 if(day===undefined||month===undefined||year===undefined||!time)return;
 if(year<=69)year+=2000;else if(year<=99)year+=1900;
 const [hour,minute,second]=time as [number,number,number];
 if(day<1||day>31||hour>23||minute>59||second>59)return;
 const date=new Date(Date.UTC(year,month,day,hour,minute,second));
 if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month||date.getUTCDate()!==day)return;
 return date.getTime();
}
function accessCookie(headers:import('node:http').IncomingHttpHeaders){
 const values=headers['set-cookie'];if(!values||values.length!==1)throw new ProbeError('challenge');
 // Trim only ASCII space and tab around cookie parts; broader trimming can invent required tokens.
 const parts=values[0]!.split(';').map(value=>value.replace(/^[ \t]+|[ \t]+$/g,'')),match=/^__Host-waitron-public=([A-Za-z0-9._~-]{1,1024})$/.exec(parts[0]??'');if(!match)throw new ProbeError('challenge');
 if(parts.slice(1).some(part=>part.split('=',1)[0]!.replace(/^[ \t]+|[ \t]+$/g,'').toLowerCase()==='domain'))throw new ProbeError('challenge');
 // Host-prefixed cookies require the last effective Path to be root.
 // Chromium ignores oversized values, leaving the earlier Path effective.
 const trimPath=(value:string)=>value.replace(/^[ \t]+|[ \t]+$/g,'');
 const paths=values[0]!.split(';').slice(1).map(value=>value.split('=')).filter(value=>trimPath(value[0]!).toLowerCase()==='path').filter(value=>trimPath(value.slice(1).join('=')).length<=1024);
 if(trimPath(paths.at(-1)?.slice(1).join('=')??'')!=='/')throw new ProbeError('challenge');
 // A nonpositive final Max-Age deletes the cookie before a browser can replay it.
 // Chromium ignores oversized attribute values, leaving the earlier one effective.
 const maxAges=values[0]!.split(';').slice(1).map(value=>value.split('=')).filter(value=>trimPath(value[0]!).toLowerCase()==='max-age').filter(value=>trimPath(value.slice(1).join('=')).length<=1024);
 const maxAge=trimPath(maxAges.at(-1)?.slice(1).join('=')??'');
 // Chromium also saturates a signed 64-bit limit reached before an invalid suffix.
 const agePrefix=/^[+-]?\d+/.exec(maxAge)?.[0];
 const validMaxAge=/^[+-]?\d+$/.test(maxAge)||(agePrefix!==undefined&&(BigInt(agePrefix)>=9223372036854775807n||BigInt(agePrefix)<=-9223372036854775808n));
 if(validMaxAge&&Number(agePrefix)<=0)throw new ProbeError('challenge');
 // A valid Max-Age takes precedence; otherwise the final effective Expires applies.
 if(!validMaxAge){
  const expires=values[0]!.split(';').slice(1).map(value=>value.split('=')).filter(value=>trimPath(value[0]!).toLowerCase()==='expires').filter(value=>trimPath(value.slice(1).join('=')).length<=1024);
  const expiry=cookieExpiry(trimPath(expires.at(-1)?.slice(1).join('=')??''));
  // Browsers adjust Expires for the server clock carried by the response Date.
  // HTTP dates without a time zone are UTC on every probing machine.
  const serverDate=headers.date??'',serverTime=Date.parse(/(?:[A-Za-z]|[+-]\d{2}:?\d{2})[ \t]*$/.test(serverDate)?serverDate:serverDate+' GMT');
  if(expiry!==undefined&&expiry<=(Number.isFinite(serverTime)?serverTime:Date.now()))throw new ProbeError('challenge');
 }
 // Only the final effective SameSite controls the browser's cross-site restriction.
 const sameSites=parts.slice(1).map(value=>value.split('=')).filter(value=>trimPath(value[0]!).toLowerCase()==='samesite').filter(value=>trimPath(value.slice(1).join('=')).length<=1024);
 if(trimPath(sameSites.at(-1)?.slice(1).join('=')??'').toLowerCase()!=='strict')throw new ProbeError('challenge');
 // Secure and HttpOnly are presence flags, even with values; oversized values are ignored.
 const flags=new Set(parts.slice(1).map(value=>value.split('=')).filter(value=>trimPath(value.slice(1).join('=')).length<=1024).map(value=>trimPath(value[0]!).toLowerCase()));
 if(!flags.has('secure')||!flags.has('httponly'))throw new ProbeError('challenge');
 return parts[0]!;
}
async function publicOnce(target:RemoteProbeTarget,connection:ProbeConnection,options:ScopedProbeOptions):Promise<ProbeCertificate> {
 const blocked=await https(target.publicHostname,connection,'/public/availability','GET',options);
 if(blocked.status!==403){throw new ProbeError('http');}
 if(!contentType(blocked,'text/html')||!blocked.body.toString('utf8').includes('src="/_cloud/challenge.js"'))throw new ProbeError('challenge');
 const reply=await https(target.publicHostname,connection,'/_cloud/challenge','GET',options);if(reply.status!==200||!contentType(reply,'application/json'))throw new ProbeError('challenge');
 let value:unknown;try{value=JSON.parse(reply.body.toString('utf8'));}catch{throw new ProbeError('challenge');}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='challenge,difficulty')throw new ProbeError('challenge');
 const challenge=(value as Record<string,unknown>).challenge,difficulty=(value as Record<string,unknown>).difficulty;
 if(typeof challenge!=='string'||challenge.length<1||challenge.length>2048||!Number.isInteger(difficulty)||Number(difficulty)<8||Number(difficulty)>22)throw new ProbeError('challenge');
 const nonce=await solve(challenge,Number(difficulty),options),answer=await https(target.publicHostname,connection,'/_cloud/solve','POST',options,JSON.stringify({challenge,nonce}));
 if(answer.status!==204||answer.body.length)throw new ProbeError('challenge');const cookie=accessCookie(answer.headers);
 const available=await https(target.publicHostname,connection,'/public/availability','GET',options,undefined,cookie);if(available.status!==200||!contentType(available,'application/json'))throw new ProbeError('http');
 try{JSON.parse(available.body.toString('utf8'));}catch{throw new ProbeError('http');}return available.certificate;
}
async function probePublic(target:RemoteProbeTarget,options:ScopedProbeOptions):Promise<ProbeServiceResult> {
 const started=performance.now();try{
  const candidates=await connections(target.publicHostname,options);let last:unknown;
  for(const connection of candidates){try{const evidence=await publicOnce(target,connection,options);return {status:'healthy',checkedAt:new Date().toISOString(),elapsedMs:elapsed(started),certificate:evidence};}catch(error){last=error;const failure=classify(error,options);if(!['tls','timeout'].includes(failure)||options.signal?.aborted)break;}}
  return failed(started,classify(last,options));
 }catch(error){return failed(started,classify(error,options));}
}

export async function probeTarget(target:RemoteProbeTarget,options:ProbeOptions={}):Promise<RemoteProbeResult> {
 const deadline=AbortSignal.timeout(15000),signal=options.signal?AbortSignal.any([options.signal,deadline]):deadline,scoped:ScopedProbeOptions={...options,signal,externalSignal:options.signal,deadlineSignal:deadline};
 const [publicResult,staff]=await Promise.all([probePublic(target,scoped),probeStaff(target,scoped)]);
 return {version:1,...target,checkedAt:new Date().toISOString(),public:publicResult,staff};
}
