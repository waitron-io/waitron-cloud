import {createHmac,randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {publicUnavailable} from './public-unavailable.ts';
import {request} from 'node:https';
import {pipeline} from 'node:stream/promises';
import {setTimeout as wait} from 'node:timers/promises';
import {isDeepStrictEqual} from 'node:util';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {ForwardCause} from './forward-report.ts';
export interface PublicGateRoute {publicHostname:string;staffHostname:string;address:string;port:number}
type MenuKind='page'|'asset';
interface MenuForward<R> {
 port:number;
 match:(target:string)=>MenuKind|undefined;
 authorize:(route:Readonly<R>,signal:AbortSignal)=>Promise<boolean>;
}
export interface PublicGateOptions<R extends PublicGateRoute=PublicGateRoute> {
 key:Buffer;ca?:string|Buffer;routes:()=>R[];difficulty?:number;now?:()=>number;
 menu?:MenuForward<R>;
 beginForward?:(route:Readonly<R>,startedAt:number)=>((category:ForwardCause|null,observedAt:number)=>void)|undefined;
}
function sourceBucket(ip:string):string{
 if(isIP(ip)===4)return ip;
 // URL canonicalisation handles embedded IPv4 without adding a dependency to the source-only gateway image.
 const address=new URL(`http://[${ip.split('%')[0]}]/`).hostname.slice(1,-1);
 const [start,end]=address.split('::'),left=start!.split(':').filter(Boolean),right=(end??'').split(':').filter(Boolean);
 const words=(end===undefined?left:[...left,...Array<string>(8-left.length-right.length).fill('0'),...right]).map(word=>parseInt(word,16));
 if(words.slice(0,5).every(word=>word===0)&&words[5]===0xffff)return [words[6]!>>>8,words[6]!&255,words[7]!>>>8,words[7]!&255].join('.');
 return words.slice(0,4).map(word=>word.toString(16)).join(':')+'/64';
}
const worker=`onmessage=async({data})=>{try{const encoder=new TextEncoder(),until=performance.now()+20000;for(let nonce=0;nonce<1000000000&&performance.now()<until;nonce++){const hash=new DataView(await crypto.subtle.digest('SHA-256',encoder.encode(data.challenge+':'+nonce)));if(hash.getUint32(0)<2**(32-data.difficulty)){postMessage({challenge:data.challenge,nonce});return;}}postMessage({error:'exhausted'});}catch{postMessage({error:'unsupported'});}};`;
const script=`(async()=>{
 const guidance=document.querySelector('#browser-guidance');if(guidance)guidance.hidden=true;
 const staticGuidance=document.querySelector('#browser-static-guidance');if(staticGuidance)staticGuidance.hidden=true;
 document.querySelector('div').hidden=false;
 let worker,timer,controller,finished=false;
 const stop=()=>{clearTimeout(timer);if(worker)worker.terminate();if(controller)controller.abort();};
 const fail=(browser=false)=>{if(finished)return;finished=true;stop();if(guidance)guidance.hidden=false;document.querySelector('p').innerHTML=browser?'This browser check could not finish. Try another browser, update it and check that JavaScript is allowed. / <span lang="es">No se pudo completar la comprobación. Prueba con otro navegador, actualízalo y comprueba que JavaScript esté permitido.</span>':'Please reload to try again. / <span lang="es">Vuelve a cargar para intentarlo de nuevo.</span>';};
 try{
  timer=setTimeout(()=>fail(true),30000);
  try{controller=new AbortController();}catch{fail(true);return;}
  const challenge=await(await fetch('/_cloud/challenge',{signal:controller.signal})).json();if(finished)return;
  try{worker=new Worker('/_cloud/worker.js');}catch{fail(true);return;}
  worker.onmessage=async({data})=>{if(finished)return;if(data&&data.error){fail(true);return;}try{worker.terminate();const reply=await fetch('/_cloud/solve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:controller.signal});if(finished)return;if(!reply.ok)throw Error();finished=true;stop();location.replace('/public/availability');}catch{fail();}};
  worker.onerror=()=>fail(true);worker.postMessage(challenge);
 }catch{fail();}
})();`;
const rejectionText:Record<number,[string,string]>={
 421:['This venue link is unavailable. Check the original venue link and open it again.','Este enlace del local no está disponible. Comprueba el enlace original del local y ábrelo de nuevo.'],
 429:['Too many requests. Wait a minute, then try the venue’s public page again.','Demasiadas solicitudes. Espera un minuto y vuelve a abrir la página pública del local.'],
 413:['This request is too large or uses an unsupported connection. Open the venue’s public page.','Esta solicitud es demasiado grande o usa una conexión no admitida. Abre la página pública del local.'],
 404:['This page was not found.','Esta página no existe.'],
 405:['This request is not supported. Open the venue’s public page.','Esta solicitud no está admitida. Abre la página pública del local.'],
 400:['This request could not be completed. Check the venue link and try again.','Esta solicitud no se pudo completar. Comprueba el enlace del local e inténtalo de nuevo.'],
 403:['The browser check was not accepted. Open the venue’s public page to start again.','No se aceptó la comprobación del navegador. Abre la página pública del local para empezar de nuevo.'],
};
const menuRefusals:Record<number,[string,string]>={
 404:['This menu is unavailable.','Este menú no está disponible.'],
 429:['Too many requests. Wait a moment and try again.','Demasiadas solicitudes. Espera un momento y vuelve a intentarlo.'],
 503:['Try again shortly.','Inténtalo de nuevo en unos instantes.'],
};
const availabilityPaths=['/public/availability','/_cloud/challenge','/_cloud/solve','/_cloud/challenge.js','/_cloud/worker.js'];
const menuBytes=2*1024*1024;
function menuHeaders(response:IncomingMessage,kind:MenuKind):Record<string,string>{
 const headers:Record<string,string>={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
 for(const name of ['content-type','content-language','content-encoding','content-length','vary']){
  const value=response.headers[name];
  if(typeof value==='string')headers[name]=value;
 }
 const cache=/^public,\s*max-age=(\d+)(,\s*immutable)?$/i.exec(response.headers['cache-control']??'');
 const age=response.headers.age;
 if(cache&&(age===undefined||/^\d+$/.test(age))){
  const maxAge=Math.min(Number(cache[1]),kind==='asset'?31536000:60);
  headers['Cache-Control']=`public, max-age=${maxAge}${kind==='asset'&&cache[2]?', immutable':''}`;
  if(age!==undefined)headers.Age=age;
 }
 return headers;
}
/** Bind this handler to loopback only, behind HAProxy's overwritten client-IP/SNI headers. */
export function createPublicGate<R extends PublicGateRoute>(options:PublicGateOptions<R>){
 if(options.key.length!==32)throw new Error('invalid_gate_key');
 const difficulty=options.difficulty??16;if(!Number.isInteger(difficulty)||difficulty<8||difficulty>22)throw new Error('invalid_difficulty');
 const now=options.now??Date.now;
 const buckets=new Map<string,{count:number;until:number}>(),menuBuckets=new Map<string,{count:number;until:number}>();
 const menuByHost=new Map<string,number>();
 let active=0,menuActive=0;
 const counters={challenged:0,rejected:0,forwarded:0,unavailable:0},menuCounters={forwarded:0,rejected:0};
 function admits(counts:typeof buckets,source:string){
  const time=now();
  for(const [key,b]of counts)if(b.until<=time)counts.delete(key);
  let bucket=counts.get(source);
  if(!bucket){
   if(counts.size>=4096)return false;
   bucket={count:0,until:time+60000};counts.set(source,bucket);
  }
  return ++bucket.count<=120;
 }
 async function forwardMenu(menu:MenuForward<R>,route:R,path:string,kind:MenuKind,req:IncomingMessage,res:ServerResponse,refuse:(status:number)=>void){
  const visitor=new AbortController(),host=route.publicHostname;
  const close=()=>{if(!res.writableFinished)visitor.abort();};
  res.once('close',close);
  const signal=AbortSignal.any([visitor.signal,AbortSignal.timeout(10000)]);
  const current=()=>options.routes().some(candidate=>isDeepStrictEqual(candidate,route));
  let reserved=false,upstream:IncomingMessage|undefined;
  try{
   const deadline=performance.now()+250;
   while(menuActive>=16||(menuByHost.get(host)??0)>=4){
    if(performance.now()>=deadline){refuse(429);return;}
    await wait(20,undefined,{signal});
   }
   menuActive++;menuByHost.set(host,(menuByHost.get(host)??0)+1);reserved=true;
   if(!current()||!await menu.authorize(route,signal)||!current()){refuse(404);return;}
   menuCounters.forwarded++;
   upstream=await new Promise<IncomingMessage>((resolve,reject)=>{
    const headers:Record<string,string>={host:route.staffHostname};
    if(req.headers.accept)headers.accept=req.headers.accept;
    if(req.headers['accept-language'])headers['accept-language']=req.headers['accept-language'];
    const outbound=request({host:route.address,port:menu.port,servername:route.staffHostname,ca:options.ca,
     method:req.method,path,headers,timeout:5000,signal,agent:false},response=>{
      // The body stays paused during the second authority read.
      response.on('error',()=>{});resolve(response);
     });
    outbound.once('timeout',()=>outbound.destroy(new Error('menu_upstream_timeout')));
    outbound.once('error',reject);outbound.end();
   });
   if(!await menu.authorize(route,signal)||!current()){refuse(404);return;}
   if(upstream.statusCode===404||upstream.statusCode===429){refuse(upstream.statusCode);return;}
   if(upstream.destroyed||upstream.statusCode!==200||Number(upstream.headers['content-length']??0)>menuBytes){refuse(503);return;}
   signal.throwIfAborted();
   res.writeHead(200,menuHeaders(upstream,kind));
   await pipeline(upstream,async function*(chunks:AsyncIterable<Buffer>){
    let bytes=0;
    for await(const chunk of chunks){
     bytes+=chunk.length;
     if(bytes>menuBytes)throw new Error('menu_response_limit');
     yield chunk;
    }
   },res,{signal});
  }catch{
   if(!res.destroyed&&!res.headersSent)refuse(503);
   else if(!res.writableFinished)res.destroy();
  }finally{
   upstream?.destroy();res.off('close',close);
   if(reserved){
    menuActive--;
    const count=menuByHost.get(host)!;
    if(count===1)menuByHost.delete(host);else menuByHost.set(host,count-1);
   }
  }
 }
 function token(purpose:string,host:string,ip:string,lifetime:number){const payload=Buffer.from(JSON.stringify([purpose,host,ip,now()+lifetime,randomBytes(16).toString('base64url')])).toString('base64url');return payload+'.'+createHmac('sha256',options.key).update(payload).digest('base64url');}
 function valid(value:string,purpose:string,host:string,ip:string){
  try{if(value.length>1024)return false;const parts=value.split('.');if(parts.length!==2)return false;const [payload,signature]=parts as [string,string];const expected=createHmac('sha256',options.key).update(payload).digest();const received=Buffer.from(signature,'base64url');if(received.length!==32||received.toString('base64url')!==signature||!timingSafeEqual(received,expected))return false;
   const bytes=Buffer.from(payload,'base64url');if(bytes.toString('base64url')!==payload)return false;const claims=JSON.parse(bytes.toString());return Array.isArray(claims)&&claims.length===5&&claims[0]===purpose&&claims[1]===host&&claims[2]===ip&&Number.isSafeInteger(claims[3])&&claims[3]>now();
  }catch{return false;}
 }
 async function handle(req:IncomingMessage,res:ServerResponse){
  const reply=(status:number,body='',type='text/plain; charset=utf-8',headers:Record<string,string>={},menu=false)=>{
   const mode=req.headers['sec-fetch-mode'];
   const navigation=mode==='navigate'||(mode===undefined&&(req.headers.accept??'').split(',').some(value=>value.trim().split(';')[0]==='text/html'));
   const text=(menu?menuRefusals[status]:undefined)??rejectionText[status];
   if(!body&&navigation&&text){
    const [en,es]=text;
    body=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>Unable to open page / No se pudo abrir la página</title></head><body><main><h1>Unable to open page / <span lang="es">No se pudo abrir la página</span></h1><p>${en}</p><p><span lang="es">${es}</span></p>${menu||status===421||status===404?'':'<a href="/public/availability">Open public page / <span lang="es">Abrir página pública</span></a>'}</main></body></html>`;
    type='text/html; charset=utf-8';
   }
   res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",...headers});res.end(body);
  };
  try{
   const ip=req.headers['x-waitron-client-ip'],sni=req.headers['x-waitron-sni'],host=req.headers.host?.split(':')[0];
   if(typeof ip!=='string'||!isIP(ip)||typeof sni!=='string'||host!==sni||![sni,sni+':443'].includes(req.headers.host??'')){counters.rejected++;reply(421);return;}
   const route=options.routes().find(r=>r.publicHostname===host);if(!route){counters.rejected++;reply(421);return;}
   const path=req.url??'',availability=availabilityPaths.includes(path),menu=options.menu;
   const menuKind=!availability&&path.startsWith('/')&&!path.startsWith('//')?menu?.match(path):undefined;
   const source=sourceBucket(ip);
   if(menu&&menuKind){
    const refuse=(status:number)=>{menuCounters.rejected++;reply(status,undefined,undefined,status===503?{'Retry-After':'1'}:{},true);};
    if(!admits(menuBuckets,source)){refuse(429);return;}
    if(req.method!=='GET'&&req.method!=='HEAD'){refuse(405);return;}
    if(req.headers.upgrade||req.headers['transfer-encoding']||Number(req.headers['content-length']??0)!==0){refuse(413);return;}
    await forwardMenu(menu,route,path,menuKind,req,res,refuse);return;
   }
   if(!admits(buckets,source)){counters.rejected++;reply(429);return;}
   if(req.headers.upgrade||Number(req.headers['content-length']??0)>2048){counters.rejected++;reply(413);return;}
   if(!availability){counters.rejected++;reply(404);return;}
   if(req.method!==(path==='/_cloud/solve'?'POST':'GET')){counters.rejected++;reply(405);return;}
   if(path==='/_cloud/challenge.js'){reply(200,script,'application/javascript');return;}
   if(path==='/_cloud/worker.js'){reply(200,worker,'application/javascript');return;}
   if(path==='/_cloud/challenge'){reply(200,JSON.stringify({challenge:token('challenge',host!,ip,120000),difficulty}),'application/json');return;}
   if(path==='/_cloud/solve'){
    let body='';for await(const chunk of req){body+=chunk.toString();if(Buffer.byteLength(body)>2048){counters.rejected++;reply(413);return;}}
    let value;try{value=JSON.parse(body);}catch{reply(400);return;}
    if(!value||Object.keys(value).sort().join(',')!=='challenge,nonce'||typeof value.challenge!=='string'||!Number.isSafeInteger(value.nonce)||value.nonce<0||value.nonce>=1000000000
     ||!valid(value.challenge,'challenge',host!,ip)||createHash('sha256').update(`${value.challenge}:${value.nonce}`).digest().readUInt32BE(0)>=2**(32-difficulty)){counters.rejected++;reply(403);return;}
    res.setHeader('Set-Cookie',`__Host-waitron-public=${token('access',host!,ip,300000)}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=300`);reply(204);return;
   }
   const cookies=(req.headers.cookie??'').split(';').map(s=>s.trim()).filter(s=>s.startsWith('__Host-waitron-public='));
   if(cookies.length!==1||!valid(cookies[0]!.slice('__Host-waitron-public='.length),'access',host!,ip)){
    counters.challenged++;reply(403,'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light dark"><title>Checking your browser / Comprobando tu navegador</title><body><main><h1>Checking your browser / <span lang="es">Comprobando tu navegador</span></h1><div hidden role="status"><p>Please wait a moment. / <span lang="es">Espera un momento.</span></p></div><p id="browser-guidance"><a href="/public/availability">Reload page / <span lang="es">Volver a cargar</span></a><span id="browser-static-guidance"><br>Allow JavaScript or try another browser to open this page. / <span lang="es">Permite JavaScript o prueba con otro navegador para abrir esta página.</span></span></p><script src="/_cloud/challenge.js" defer></script></main></body></html>','text/html; charset=utf-8');return;
   }
   if(active>=64){counters.rejected++;reply(429);return;}active++;counters.forwarded++;
   let complete:((category:ForwardCause|null,observedAt:number)=>void)|undefined;
   try{const observer=options.beginForward?.(route,now());if(typeof observer==='function')complete=observer;else void Promise.resolve(observer).catch(()=>{});}catch{}
   let cancelled=false,observed=false,category:ForwardCause='forward_internal';
   const observe=(outcome:ForwardCause|null)=>{if(cancelled||observed)return;observed=true;try{void Promise.resolve(complete?.(outcome,now())).catch(()=>{});}catch{}};
   try{
    const result=await new Promise<{status:number|undefined;body:Buffer}>((resolve,reject)=>{
     const upstream=request({host:route.address,port:route.port,servername:route.staffHostname,ca:options.ca,method:'GET',path:'/public/availability',headers:{host:route.staffHostname,accept:'application/json'},timeout:5000,agent:false},response=>{
      const chunks:Buffer[]=[];let size=0;response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>65536){category='upstream_response_limit';upstream.destroy(new Error('response_limit'));return;}chunks.push(chunk);});
      response.on('error',reject);response.on('aborted',()=>reject(new Error('upstream_aborted')));
      response.on('close',()=>{if(!response.complete)reject(new Error('upstream_closed'));});
      response.on('end',()=>resolve({status:response.statusCode,body:Buffer.concat(chunks)}));
     });
     category='upstream_transport';
     upstream.on('timeout',()=>{category='upstream_timeout';upstream.destroy(new Error('upstream_timeout'));});upstream.on('error',reject);
     // A visitor disconnect establishes no venue fault, including subsequent socket errors.
     const cancel=()=>{if(!res.writableEnded){cancelled=true;upstream.destroy(new Error('client_closed'));}};
     res.once('close',cancel);upstream.once('close',()=>res.off('close',cancel));upstream.end();
    });
    if(result.status!==200){category=result.status===undefined?'forward_internal':'upstream_non_200';throw new Error('unavailable');}
    observe(null);reply(200,result.body.toString(),'application/json');
   }catch{observe(category);counters.unavailable++;const unavailable=publicUnavailable(req.headers.accept,req.headers['accept-language']);reply(503,unavailable.body,unavailable.type,unavailable.headers);}
   finally{active--;}
  }catch{if(!res.headersSent)reply(400);else res.destroy();}
 }
 return {handle:(req:IncomingMessage,res:ServerResponse)=>{void handle(req,res);},stats:()=>({...counters,active,buckets:buckets.size,...(options.menu?{menu:{...menuCounters,active:menuActive,buckets:menuBuckets.size}}:{})})};
}
