import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import type {IncomingMessage,RequestListener} from 'node:http';
import {origin,type PagingProvider,type PageAttempt,type TrustedEvent,type Kind} from './paging.ts';
interface Options {
 origin:string;
 twilio:{provider:PagingProvider;authToken:string};
 vonage:{provider:PagingProvider;apiKey:string;signatureSecret:string};
 attempts:()=>readonly PageAttempt[];
 onEvent:(event:TrustedEvent)=>void|Promise<void>;
}
const malformed=()=>Object.assign(Error(),{status:400});
const forbidden=()=>Object.assign(Error(),{status:403});
function equal(encoded:unknown,want:Buffer,encoding:'hex'|'base64'|'base64url'){
 if(typeof encoded!=='string')return false;
 const pattern=encoding==='hex'?/^[a-fA-F0-9]+$/:encoding==='base64'?/^[A-Za-z0-9+/]+={0,2}$/:/^[A-Za-z0-9_-]+$/;
 if(!pattern.test(encoded))return false;
 const actual=Buffer.from(encoded,encoding);
 if(actual.length!==want.length||actual.toString(encoding)!==(encoding==='hex'?encoded.toLowerCase():encoded))return false;
 return timingSafeEqual(actual,want);
}
export function verifyTwilioSignature(url:string,fields:Record<string,string>,token:string,signature:unknown){
 const data=url+Object.keys(fields).sort().map(key=>key+fields[key]).join('');
 return equal(signature,createHmac('sha1',token).update(data).digest(),'base64');
}
function fields(raw:string){
 if(/%(?![0-9a-f]{2})/i.test(raw))throw malformed();
 const values=new URLSearchParams(raw),seen=new Set<string>();
 for(const [key] of values){if(seen.has(key))throw malformed();seen.add(key);}
 return Object.fromEntries(values);
}
function object(raw:string):Record<string,unknown>{
 try{const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}
 catch{throw malformed();}
}
function readBody(request:IncomingMessage):Promise<string>{
 return new Promise((resolve,reject)=>{
  const chunks:Buffer[]=[];let size=0,oversized=false;
  request.on('data',(chunk:Buffer)=>{
   size+=chunk.length;
   if(size>65536){if(!oversized){oversized=true;reject(Object.assign(Error(),{status:413}));}return;}
   chunks.push(chunk);
  });
  request.once('end',()=>{if(oversized)return;try{resolve(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{reject(malformed());}});
  request.once('error',()=>reject(malformed()));
 });
}
function voiceAuthenticated(request:IncomingMessage,raw:string,c:Options['vonage']){
 const authorization=request.headers.authorization;
 if(!authorization?.startsWith('Bearer '))throw forbidden();
 const parts=authorization.slice(7).split('.');
 if(parts.length!==3||parts.some(part=>!part||!/^[A-Za-z0-9_-]+$/.test(part)))throw forbidden();
 try{
  const header=JSON.parse(Buffer.from(parts[0]!,'base64url').toString()),claims=JSON.parse(Buffer.from(parts[1]!,'base64url').toString());
  if(header?.alg!=='HS256'||!equal(parts[2],createHmac('sha256',c.signatureSecret).update(parts[0]+'.'+parts[1]).digest(),'base64url')
   ||claims?.iss!=='Vonage'||claims.api_key!==c.apiKey||!Number.isSafeInteger(claims.iat)||typeof claims.jti!=='string'||!claims.jti.length
   ||!equal(claims.payload_hash,createHash('sha256').update(raw).digest(),'hex'))throw Error();
 }catch{throw forbidden();}
}
export function createPagingCallbackListener(options:Options):RequestListener{
 origin(options.origin);
 if(options.twilio.provider.provider!=='twilio'||options.vonage.provider.provider!=='vonage'
  ||![options.twilio.authToken,options.vonage.apiKey,options.vonage.signatureSecret].every(v=>typeof v==='string'&&v.length>0)
  ||typeof options.attempts!=='function'||typeof options.onEvent!=='function')throw Error('paging.invalid_config');
 const seen=new Set<string>();
 return (request,response)=>{void (async()=>{
  try{
   const url=request.url??'',match=/^\/paging\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/(twilio|vonage)\/(text|call|input)(?:\?[^#]*)?$/.exec(url);
   if(!match)throw malformed();
   const incidentId=match[1]!,notificationId=match[2]!,provider=match[3] as 'twilio'|'vonage',kind=match[4] as Kind;
   const query=url.includes('?')?url.slice(url.indexOf('?')+1):'',queryFields=fields(query);
   const get=provider==='vonage'&&kind==='text'&&request.method==='GET';
   const media=request.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
   if(!get&&(request.method!=='POST'||media!==(provider==='twilio'?'application/x-www-form-urlencoded':'application/json')))throw malformed();
   const raw=await readBody(request);
   let body:Record<string,unknown>;
   if(provider==='twilio'){
    const values=fields(raw);
    if(!verifyTwilioSignature(options.origin+url,values,options.twilio.authToken,request.headers['x-twilio-signature']))throw forbidden();
    body=values;
   }else if(kind==='text'){
    if(get&&raw.length||!get&&query.length)throw malformed();
    body=get?queryFields:object(raw);
    if(Object.values(body).some(v=>typeof v!=='string')||typeof body.timestamp!=='string'||!/^\d+$/.test(body.timestamp))throw malformed();
    const {sig,...values}=body;
    const data=Object.keys(values).sort().map(key=>'&'+key+'='+String(values[key]).replace(/[&=]/g,'_')).join('');
    if(!equal(sig,createHmac('sha256',options.vonage.signatureSecret).update(data).digest(),'hex')||body['api-key']!==options.vonage.apiKey)throw forbidden();
   }else{
    voiceAuthenticated(request,raw,options.vonage);body=object(raw);
   }
   const event=options[provider].provider.readTrustedEvent(kind,body);
   if(event){
    const submission=kind==='text'?'text':'call';
    const bound=options.attempts().some(a=>a.provider===provider&&a.incidentId===incidentId&&a.notificationId===notificationId
     &&a[submission].state==='accepted'&&a[submission].ids.includes(event.id));
    if(!bound)throw forbidden();
    const key=JSON.stringify([provider,event.id,kind,event.state,event.digits??null]);
    // Reserve before delivery; a failed consumer must leave the event retryable.
    if(!seen.has(key)){
     seen.add(key);
     try{await options.onEvent({incidentId,notificationId,event});}catch{seen.delete(key);throw Error();}
    }
   }
   response.setHeader('cache-control','no-store');
   if(kind==='input'){
    response.setHeader('content-type',provider==='twilio'?'application/xml':'application/json');
    response.end(provider==='twilio'?'<Response/>':'[]');
   }else{response.writeHead(204);response.end();}
  }catch(error){
   const status=(error as {status?:number}).status??500;
   response.writeHead(status,{'content-type':'text/plain','cache-control':'no-store'});response.end('Paging callback refused.\n');
  }
 })();};
}
