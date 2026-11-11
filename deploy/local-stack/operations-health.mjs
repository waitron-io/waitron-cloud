import {get} from 'node:http';
import {Readable} from 'node:stream';
import {parseRequestMetrics} from '../../packages/account-http/src/request-metrics.ts';

export async function readAccountRequests({fetcher=fetch,timeoutMs=2000}={}){
 let reader;
 try{
  const response=await fetcher('http://account:9092/metrics',{redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
  if(response.status!==200)throw Error();
  reader=response.body?.getReader();if(!reader)throw Error();
  const chunks=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384)throw Error();chunks.push(value);}
  return parseRequestMetrics(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))));
 }finally{void reader?.cancel().catch(()=>{});}
}

// Node fetch replaces Host with the destination. Compose DNS is "account", while
// the account API requires its configured localhost authority even on health routes.
export function localHealthFetch(url,{signal}){
 return new Promise((resolve,reject)=>{
  const request=get(url,{headers:{host:'localhost:3000'},signal},response=>{
   try{resolve(new Response(Readable.toWeb(response),{status:response.statusCode,headers:response.headers}));}
   catch(error){response.destroy();reject(error);}
  });
  request.once('error',reject);
 });
}
