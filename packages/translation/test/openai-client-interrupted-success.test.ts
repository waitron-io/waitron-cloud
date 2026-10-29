import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {test} from 'node:test';
import {createLoopbackOpenAiClient,ProviderError} from '../src/openai-client.ts';

const call={instructions:'Translate the menu',input:'Lemon cake',effort:'low'} as const;
const key='local-interrupted-success-key',privateText='PRIVATE UNFINISHED TRANSLATION';
const unfinished=JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:privateText}]}],usage:{input_tokens:17,output_tokens:23}});
const healthy='{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"Tarta de limón"}]}],"usage":{"input_tokens":3,"output_tokens":5}}';

async function within<T>(promise:Promise<T>):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([promise,new Promise<never>((_resolve,reject)=>{
  timer=setTimeout(()=>reject(new Error('local HTTP operation did not finish')),5000);
 })]);}finally{clearTimeout(timer);}
}

for(const mode of ['timeout','caller abort'] as const){
 test(`${mode} closes an unfinished successful body and permits a later request on the same client`,{timeout:12000},async t=>{
  let requests=0,ended:boolean|undefined,releaseClosed!:()=>void,readBytes=0;
  const closed=new Promise<void>(resolve=>{releaseClosed=resolve;});
  const controller=new AbortController();
  const server=createServer(async(req,res)=>{
   for await(const _chunk of req){}
   requests++;
   res.writeHead(200,{'content-type':'application/json'});
   if(requests===1){
    res.once('close',()=>{ended=res.writableEnded;releaseClosed();});
    // JSON completion alone must not admit usage from an unfinished HTTP response.
    res.write(unfinished);
   }else res.end(healthy);
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
      if(!result.done){
       readBytes+=result.value.byteLength;
       if(mode==='caller abort'&&readBytes===Buffer.byteLength(unfinished))controller.abort(new Error(privateText));
      }
      return result;
     });
     return reader;
    });
   }
   return reply;
  });
  const client=createLoopbackOpenAiClient({apiKey:key,baseUrl:`http://127.0.0.1:${address.port}`,timeoutMs:1500});
  await assert.rejects(within(client.respond(call,mode==='caller abort'?controller.signal:undefined)),(error:unknown)=>{
   assert.ok(error instanceof ProviderError);
   assert.deepEqual([error.kind,error.retryable,error.usage],[mode==='timeout'?'timeout':'network',true,undefined]);
   for(const rendered of [String(error),error.stack??'',JSON.stringify(error)])for(const value of [key,privateText])assert.equal(rendered.includes(value),false);
   return true;
  });
  assert.equal(readBytes,Buffer.byteLength(unfinished),'the entire valid JSON body must arrive before interruption');
  await within(closed);
  assert.equal(ended,false,'connection closure must not require the server to finish its body');
  assert.equal(requests,1,'interrupted requests must not retry automatically');
  assert.deepEqual(await within(client.respond(call)),{text:'Tarta de limón',inputTokens:3,outputTokens:5});
  assert.equal(requests,2);
 });
}

test('a pre-aborted caller sends no HTTP request and leaves the client usable',{timeout:12000},async t=>{
 let requests=0;
 const server=createServer(async(req,res)=>{
  for await(const _chunk of req){}
  requests++;res.writeHead(200,{'content-type':'application/json'});res.end(healthy);
 });
 t.after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const address=server.address();assert.ok(address&&typeof address!=='string');
 const client=createLoopbackOpenAiClient({apiKey:key,baseUrl:`http://127.0.0.1:${address.port}`,timeoutMs:1500});
 const controller=new AbortController();controller.abort(new Error(privateText));
 await assert.rejects(within(client.respond(call,controller.signal)),(error:unknown)=>{
  assert.ok(error instanceof ProviderError);
  assert.deepEqual([error.kind,error.retryable,error.usage],['network',true,undefined]);
  assert.equal(String(error).includes(privateText),false);
  return true;
 });
 assert.equal(requests,0);
 assert.deepEqual(await within(client.respond(call)),{text:'Tarta de limón',inputTokens:3,outputTokens:5});
 assert.equal(requests,1);
});
