import {createHmac,randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {publicUnavailable} from './public-unavailable.ts';
import {request} from 'node:https';
import type {IncomingMessage,ServerResponse} from 'node:http';
interface Route {publicHostname:string;staffHostname:string;address:string;port:number}
interface Options {key:Buffer;ca?:string|Buffer;routes:()=>Route[];difficulty?:number;now?:()=>number}
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
 document.querySelector('div').hidden=false;
 let worker,timer,controller,finished=false;
 const stop=()=>{clearTimeout(timer);if(worker)worker.terminate();if(controller)controller.abort();};
 const fail=(browser=false)=>{if(finished)return;finished=true;stop();document.querySelector('p').innerHTML=browser?'This browser check could not finish. Try another browser, update it and check that JavaScript is allowed. / <span lang="es">No se pudo completar la comprobación. Prueba con otro navegador, actualízalo y comprueba que JavaScript esté permitido.</span>':'Please reload to try again. / <span lang="es">Vuelve a cargar para intentarlo de nuevo.</span>';};
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
 404:['This page was not found. Open the venue’s public page.','Esta página no existe. Abre la página pública del local.'],
 405:['This request is not supported. Open the venue’s public page.','Esta solicitud no está admitida. Abre la página pública del local.'],
 400:['This request could not be completed. Check the venue link and try again.','Esta solicitud no se pudo completar. Comprueba el enlace del local e inténtalo de nuevo.'],
 403:['The browser check was not accepted. Open the venue’s public page to start again.','No se aceptó la comprobación del navegador. Abre la página pública del local para empezar de nuevo.'],
};
/** Bind this handler to loopback only, behind HAProxy's overwritten client-IP/SNI headers. */
export function createPublicGate(options:Options){
 if(options.key.length!==32)throw new Error('invalid_gate_key');
 const difficulty=options.difficulty??16;if(!Number.isInteger(difficulty)||difficulty<8||difficulty>22)throw new Error('invalid_difficulty');
 const now=options.now??Date.now,buckets=new Map<string,{count:number;until:number}>();let active=0;
 const counters={challenged:0,rejected:0,forwarded:0,unavailable:0};
 function token(purpose:string,host:string,ip:string,lifetime:number){const payload=Buffer.from(JSON.stringify([purpose,host,ip,now()+lifetime,randomBytes(16).toString('base64url')])).toString('base64url');return payload+'.'+createHmac('sha256',options.key).update(payload).digest('base64url');}
 function valid(value:string,purpose:string,host:string,ip:string){
  try{if(value.length>1024)return false;const parts=value.split('.');if(parts.length!==2)return false;const [payload,signature]=parts as [string,string];const expected=createHmac('sha256',options.key).update(payload).digest();const received=Buffer.from(signature,'base64url');if(received.length!==32||received.toString('base64url')!==signature||!timingSafeEqual(received,expected))return false;
   const bytes=Buffer.from(payload,'base64url');if(bytes.toString('base64url')!==payload)return false;const claims=JSON.parse(bytes.toString());return Array.isArray(claims)&&claims.length===5&&claims[0]===purpose&&claims[1]===host&&claims[2]===ip&&Number.isSafeInteger(claims[3])&&claims[3]>now();
  }catch{return false;}
 }
 async function handle(req:IncomingMessage,res:ServerResponse){
  const reply=(status:number,body='',type='text/plain; charset=utf-8',headers:Record<string,string>={})=>{
   const mode=req.headers['sec-fetch-mode'];
   const navigation=mode==='navigate'||(mode===undefined&&(req.headers.accept??'').split(',').some(value=>value.trim().split(';')[0]==='text/html'));
   if(!body&&navigation&&rejectionText[status]){
    const [en,es]=rejectionText[status];
    body=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>Unable to open page / No se pudo abrir la página</title></head><body><main><h1>Unable to open page / <span lang="es">No se pudo abrir la página</span></h1><p>${en}</p><p><span lang="es">${es}</span></p>${status===421?'':'<a href="/public/availability">Open public page / <span lang="es">Abrir página pública</span></a>'}</main></body></html>`;
    type='text/html; charset=utf-8';
   }
   res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",...headers});res.end(body);
  };
  try{
   const ip=req.headers['x-waitron-client-ip'],sni=req.headers['x-waitron-sni'],host=req.headers.host?.split(':')[0];
   if(typeof ip!=='string'||!isIP(ip)||typeof sni!=='string'||host!==sni||![sni,sni+':443'].includes(req.headers.host??'')){counters.rejected++;reply(421);return;}
   const route=options.routes().find(r=>r.publicHostname===host);if(!route){counters.rejected++;reply(421);return;}
   for(const [key,b]of buckets)if(b.until<=now())buckets.delete(key);
   const source=sourceBucket(ip);
   let bucket=buckets.get(source);if(!bucket){if(buckets.size>=4096){counters.rejected++;reply(429);return;}bucket={count:0,until:now()+60000};buckets.set(source,bucket);}
   if(++bucket.count>120){counters.rejected++;reply(429);return;}
   if(req.headers.upgrade||Number(req.headers['content-length']??0)>2048){counters.rejected++;reply(413);return;}
   const path=req.url;
   if(!['/public/availability','/_cloud/challenge','/_cloud/solve','/_cloud/challenge.js','/_cloud/worker.js'].includes(path??'')){counters.rejected++;reply(404);return;}
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
    counters.challenged++;reply(403,'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light dark"><title>Checking your browser / Comprobando tu navegador</title><body><h1>Checking your browser / <span lang="es">Comprobando tu navegador</span></h1><div hidden><p>Please wait a moment. / <span lang="es">Espera un momento.</span></p></div><noscript><p>Allow JavaScript or try another browser to open this page. / <span lang="es">Permite JavaScript o prueba con otro navegador para abrir esta página.</span></p></noscript><script src="/_cloud/challenge.js" defer></script></body></html>','text/html; charset=utf-8');return;
   }
   if(active>=64){counters.rejected++;reply(429);return;}active++;counters.forwarded++;
   try{
    const result=await new Promise<{status:number;body:Buffer}>((resolve,reject)=>{
     const upstream=request({host:route.address,port:route.port,servername:route.staffHostname,ca:options.ca,method:'GET',path:'/public/availability',headers:{host:route.staffHostname,accept:'application/json'},timeout:5000,agent:false},response=>{
      const chunks:Buffer[]=[];let size=0;response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>65536){upstream.destroy(new Error('response_limit'));return;}chunks.push(chunk);});response.on('error',reject);response.on('end',()=>resolve({status:response.statusCode??502,body:Buffer.concat(chunks)}));
     });upstream.on('timeout',()=>upstream.destroy(new Error('upstream_timeout')));upstream.on('error',reject);
     const cancel=()=>{if(!res.writableEnded)upstream.destroy(new Error('client_closed'));};res.once('close',cancel);upstream.once('close',()=>res.off('close',cancel));upstream.end();
    });
    if(result.status!==200)throw new Error('unavailable');reply(200,result.body.toString(),'application/json');
   }catch{counters.unavailable++;const unavailable=publicUnavailable(req.headers.accept,req.headers['accept-language']);reply(503,unavailable.body,unavailable.type,unavailable.headers);}
   finally{active--;}
  }catch{if(!res.headersSent)reply(400);else res.destroy();}
 }
 return {handle:(req:IncomingMessage,res:ServerResponse)=>{void handle(req,res);},stats:()=>({...counters,active,buckets:buckets.size})};
}
