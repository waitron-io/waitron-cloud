import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer,type ServerResponse} from 'node:http';
import {setImmediate} from 'node:timers/promises';
import {test} from 'node:test';
import {deflateSync,gzipSync} from 'node:zlib';
import {createLoopbackOpenAiClient,ProviderError} from '../src/openai-client.ts';

const call={instructions:'Translate the menu',input:'Lemon cake',effort:'low'} as const;
const key='local-compression-integrity-key',text='PRIVATE Tarta de limón 🍋'.repeat(512);
const raw=Buffer.from(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}],usage:{input_tokens:17,output_tokens:23}}));
const healthy='{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"Tarta de limón"}]}],"usage":{"input_tokens":3,"output_tokens":5}}';

async function within<T>(promise:Promise<T>):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([promise,new Promise<never>((_resolve,reject)=>{
  timer=setTimeout(()=>reject(new Error('local compressed response did not finish')),5000);
 })]);}finally{clearTimeout(timer);}
}

for(const [encoding,compress,trailerLength] of [['gzip',gzipSync,8],['deflate',deflateSync,4]] as const){
 for(const corrupt of [false,true])test(`${encoding} waits for its ${corrupt?'corrupt':'valid'} final checksum before admitting text or usage`,{timeout:12000},async t=>{
  const encoded=compress(raw),trailer=Buffer.from(encoded.subarray(-trailerLength));
  if(corrupt)trailer.writeUInt8(trailer.readUInt8(0)^0xff,0);
  let requests=0,firstResponse:ServerResponse|undefined,readBytes=0,decodedReady!:()=>void;
  const decoded=new Promise<void>(resolve=>{decodedReady=resolve;});
  const server=createServer(async(req,res)=>{
   for await(const _chunk of req){}
   requests++;
   if(requests===1){
    firstResponse=res;
    res.writeHead(200,{'content-type':'application/json','content-encoding':encoding,'content-length':encoded.length});
    // A complete JSON document can be decoded before its compression checksum arrives.
    res.write(encoded.subarray(0,-trailerLength));
   }else{
    res.writeHead(200,{'content-type':'application/json'});res.end(healthy);
   }
  });
  t.after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const nativeFetch=globalThis.fetch;
  t.mock.method(globalThis,'fetch',async(...args:Parameters<typeof fetch>)=>{
   const reply=await nativeFetch(...args),body=reply.body;assert.ok(body);
   if(requests===1){
    const nativeGetReader=body.getReader.bind(body);
    t.mock.method(body,'getReader',()=>{
     const reader=nativeGetReader(),nativeRead=reader.read.bind(reader);
     t.mock.method(reader,'read',async()=>{
      const result=await nativeRead();
      if(!result.done){readBytes+=result.value.byteLength;if(readBytes===raw.length)decodedReady();}
      return result;
     });
     return reader;
    });
   }
   return reply;
  });
  const client=createLoopbackOpenAiClient({apiKey:key,baseUrl:`http://127.0.0.1:${address.port}`,maxResponseBytes:raw.length,timeoutMs:5000});
  let settled=false;
  const result=client.respond(call).then(reply=>({reply}),(error:unknown)=>({error})).finally(()=>{settled=true;});
  await within(decoded);await setImmediate();
  assert.equal(readBytes,raw.length,'all valid JSON bytes must arrive before the checksum');
  assert.equal(settled,false,'text and usage must stay withheld until the compression stream ends');
  assert.ok(firstResponse);assert.equal(firstResponse.writableEnded,false);
  firstResponse.end(trailer);
  const outcome=await within(result);
  if(corrupt){
   assert.ok('error' in outcome,'a corrupt checksum must not admit otherwise valid text or usage');
   assert.ok(outcome.error instanceof ProviderError);
   assert.deepEqual([outcome.error.kind,outcome.error.retryable,outcome.error.usage],['network',true,undefined]);
   for(const diagnostic of [String(outcome.error),outcome.error.stack??'',JSON.stringify(outcome.error)])
    for(const secret of [key,'PRIVATE','Tarta de limón'])assert.equal(diagnostic.includes(secret),false);
  }else{
   assert.deepEqual(outcome,{reply:{text,inputTokens:17,outputTokens:23}});
  }
  assert.equal(requests,1,'the client must not retry internally');
  assert.deepEqual(await within(client.respond(call)),{text:'Tarta de limón',inputTokens:3,outputTokens:5});
  assert.equal(requests,2,'a later call through the same client must remain usable');
 });
}
