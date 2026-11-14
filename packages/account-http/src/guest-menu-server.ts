import {createServer} from 'node:https';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {Pool} from 'pg';
import {readGuestMenu} from '@waitron-cloud/remote-access/guest-menu';
import {isUuid} from '@waitron-cloud/remote-access/manifest';
import {AccountRateLimiter} from './rate-limit.ts';
export function validateGuestOrigin(value:string):string{
 const url=new URL(value);
 if(url.protocol!=='https:'||url.origin!==value)throw Error('guest_origin_invalid');return value;
}
const headers={'cache-control':'no-store','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'",
 'referrer-policy':'no-referrer','x-content-type-options':'nosniff','x-frame-options':'DENY'};
export async function startGuestMenuServer(options:{pool:Pool;rateKey:string;origin:string;tls:{key:Buffer;cert:Buffer};port?:number;host?:string}){
 const origin=validateGuestOrigin(options.origin),limiter=new AccountRateLimiter(options.pool,options.rateKey);let active=0,database=0;
 const respond=(res:ServerResponse,status:number,code:string)=>{if(!res.destroyed){res.writeHead(status,{...headers,'content-type':'application/json','connection':'close'});res.end(JSON.stringify({error:code}));}};
 const serve=async(req:IncomingMessage,res:ServerResponse)=>{
  if(active>=8||database>=2){respond(res,503,'unavailable');return;}
  active++;database++;
  try{
   const url=new URL(req.url??'',origin),id=url.pathname.slice(3),language=url.searchParams.get('lang')??undefined;
   if(url.origin!==origin||req.headers.host!==new URL(origin).host){respond(res,403,'forbidden');return;}
   if(!['GET','HEAD'].includes(req.method??'')){respond(res,405,'method_not_allowed');return;}
   if((req.url??'').split('?')[0]!==url.pathname||!url.pathname.startsWith('/m/')||!isUuid(id)||url.hash||url.searchParams.size>(language?1:0)
    ||(language!==undefined&&!['en','es','ca','gl'].includes(language))
    ||req.headers['transfer-encoding']!==undefined||req.headers.upgrade!==undefined
    ||(req.headers['content-length']!==undefined&&req.headers['content-length']!=='0')){respond(res,400,'invalid_input');return;}
   const rate=await limiter.consume([{scope:'guest-menu-ip',subject:req.socket.remoteAddress??'unknown',limit:120,windowSeconds:60}]);
   if(!rate.allowed){res.setHeader('retry-after',rate.retryAfterSeconds);respond(res,429,'limited');return;}
   const menu=await readGuestMenu(options.pool,id,language);
   if(!menu){respond(res,404,'not_found');return;}
   // A takedown that commits while the copy is buffered must be seen before releasing bytes.
   const current=(await options.pool.query('SELECT revision,state FROM guest_menus WHERE venue_id=$1',[id])).rows[0];
   if(current?.state!=='current'){respond(res,404,'not_found');return;}
   if(Number(current.revision)!==menu.revision){respond(res,503,'unavailable');return;}
   if(!res.destroyed){res.writeHead(200,{...headers,'content-type':'text/html; charset=utf-8','content-language':menu.language,'content-length':Buffer.byteLength(menu.html)});res.end(req.method==='HEAD'?undefined:menu.html);}
  }catch{respond(res,503,'unavailable');}
  finally{database--;active--;}
 };
 const server=createServer({...options.tls,maxHeaderSize:8192,headersTimeout:5000,requestTimeout:5000,connectionsCheckingInterval:1000},(req,res)=>{void serve(req,res);});
 server.maxConnections=200;
 server.on('upgrade',(_req,socket)=>socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(options.port??3443,options.host??'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
 return {server,close:()=>new Promise<void>((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();})};
}
