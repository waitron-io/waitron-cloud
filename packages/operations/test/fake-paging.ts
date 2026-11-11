import {createHmac,createHash} from 'node:crypto';
import {once} from 'node:events';
import {createServer,type IncomingHttpHeaders} from 'node:http';
export interface Request {url:string;headers:IncomingHttpHeaders;body:string}
export interface Reply {status?:number;json?:unknown;raw?:string;delay?:number;headers?:Record<string,string>}
export async function fakePaging(reply:(request:Request)=>Reply){
 const requests:Request[]=[];
 const server=createServer(async(req,res)=>{
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk as Buffer);
  const request={url:req.url!,headers:req.headers,body:Buffer.concat(chunks).toString()};requests.push(request);
  const answer=reply(request);
  if(answer.delay)await new Promise<void>(resolve=>{const timer=setTimeout(resolve,answer.delay);res.once('close',()=>{clearTimeout(timer);resolve();});});
  if(!res.destroyed){res.writeHead(answer.status??200,{'content-type':'application/json',...answer.headers});res.end(answer.raw??JSON.stringify(answer.json??{}));}
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();
 if(!address||typeof address==='string')throw new Error('fake address');
 const fetcher:typeof fetch=(input,init)=>{
  const url=new URL(String(input));
  if(!['https://api.twilio.com','https://rest.nexmo.com','https://api.nexmo.com'].includes(url.origin))throw new Error('Unexpected provider host');
  return fetch(`http://127.0.0.1:${address.port}${url.pathname}`,init);
 };
 return {requests,fetcher,async close(){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
export const notification={incidentId:'11111111-1111-4111-8111-111111111111',notificationId:'22222222-2222-4222-8222-222222222222',locale:'en' as const,service:'backups' as const,venues:12,since:'2026-11-11T01:02:03Z',fixProposed:true};
export const common={origin:'https://cloud.example.test',to:'+12025550110',from:'+12025550111',timeoutMs:1000};
export const sid='AC'+'a'.repeat(32),message='SM'+'b'.repeat(32),call='CA'+'c'.repeat(32);

export const callbackSecrets={twilio:'synthetic-twilio-token',vonage:'synthetic-signature-secret',apiKey:'synthetic-api-key'};
export function callbackPath(provider:string,kind:string){return `/paging/${notification.incidentId}/${notification.notificationId}/${provider}/${kind}`;}
export async function callbackServer(listener:import('node:http').RequestListener){
 const server=createServer(listener);server.listen(0,'127.0.0.1');await once(server,'listening');
 const address=server.address();if(!address||typeof address==='string')throw Error('callback address');
 return {url:`http://127.0.0.1:${address.port}`,async close(){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}

export const form=(fields:Record<string,string>)=>new URLSearchParams(fields).toString();
// The signer is independent of the receiver and includes every supplied field.
export function signedTwilio(path:string,fields:Record<string,string>,token=callbackSecrets.twilio){
 const input=common.origin+path+Object.keys(fields).sort().map(k=>k+fields[k]).join('');
 return {method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':createHmac('sha1',token).update(input).digest('base64')},body:form(fields)};
}
export function voice(body:string,claims:Record<string,unknown>={},key=callbackSecrets.vonage,header={alg:'HS256',typ:'JWT'}){
 const encode=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');
 const parts=encode(header)+'.'+encode({iss:'Vonage',api_key:callbackSecrets.apiKey,iat:1794360000,jti:'token-1',payload_hash:createHash('sha256').update(body).digest('hex'),...claims});
 return {method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+parts+'.'+createHmac('sha256',key).update(parts).digest('base64url')},body};
}
export function sms(fields:Record<string,string>){
 const input=Object.keys(fields).sort().map(k=>'&'+k+'='+fields[k]!.replace(/[&=]/g,'_')).join('');
 return {...fields,sig:createHmac('sha256',callbackSecrets.vonage).update(input).digest('hex')};
}
