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

// The account API requires its configured authority even when a health reader connects by private address.
export function localHealthFetch(url,{signal,host='localhost:3000',forwardedFor}){
 return new Promise((resolve,reject)=>{
  const headers = forwardedFor ? {host, 'x-forwarded-for': forwardedFor} : {host};
  const request=get(url,{headers,signal},response=>{
   try{resolve(new Response(Readable.toWeb(response),{status:response.statusCode,headers:response.headers}));}
   catch(error){response.destroy();reject(error);}
  });
  request.once('error',reject);
 });
}
