import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer,type ServerResponse} from 'node:http';
import {test,type TestContext} from 'node:test';
import {brotliCompressSync,deflateSync,gzipSync} from 'node:zlib';
import {createLoopbackOpenAiClient,ProviderError} from '../src/index.ts';

const call={instructions:'Translate the menu',input:'Lemon cake',effort:'low'} as const;
const text='Tarta de limón 🍋'.repeat(512);
const raw=Buffer.from(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}],usage:{input_tokens:7,output_tokens:11}}));
const encodings=[['gzip',gzipSync],['deflate',deflateSync],['br',brotliCompressSync]] as const;

async function listener(t:TestContext,reply:(res:ServerResponse)=>void){
 let requests=0,resolveClosed!:()=>void;
 const closed=new Promise<void>(resolve=>{resolveClosed=resolve;});
 const server=createServer(async(req,res)=>{
  for await(const _chunk of req){}
  requests++;res.once('close',resolveClosed);reply(res);
 });
 t.after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const address=server.address();assert.ok(address&&typeof address!=='string');
 return {baseUrl:`http://127.0.0.1:${address.port}`,closed,requests:()=>requests};
}

function refusal(kind:'malformed'|'network'){
 return (error:unknown)=>{
  assert.ok(error instanceof ProviderError);
  assert.deepEqual([error.kind,error.retryable,error.usage],[kind,true,undefined]);
  for(const diagnostic of [String(error),error.stack??'',JSON.stringify(error)]){
   for(const privateText of ['sk-local-compressed','PRIVATE-MENU', 'Tarta de limón'])assert.equal(diagnostic.includes(privateText),false);
  }
  return true;
 };
}

for(const [encoding,compress] of encodings){
 test(`${encoding} replies admit the exact decoded UTF-8 byte limit`,async t=>{
  const encoded=compress(raw);
  assert.ok(encoded.length<raw.length);
  const server=await listener(t,res=>{
   res.writeHead(200,{'content-type':'application/json','content-encoding':encoding,'content-length':encoded.length});res.end(encoded);
  });
  const client=createLoopbackOpenAiClient({apiKey:'sk-local-compressed',baseUrl:server.baseUrl,maxResponseBytes:raw.length,timeoutMs:5000});
  assert.deepEqual(await client.respond(call),{text,inputTokens:7,outputTokens:11});
  assert.equal(server.requests(),1);
 });

 test(`${encoding} overflow counts decoded bytes and closes an unfinished HTTP response`,async t=>{
  const encoded=compress(raw),limit=raw.length-1;
  assert.ok(encoded.length<limit);
  const server=await listener(t,res=>{
   res.writeHead(200,{'content-type':'application/json','content-encoding':encoding});
   // The compressed stream is complete; HTTP stays open to expose cancellation.
   res.write(encoded);
  });
  const client=createLoopbackOpenAiClient({apiKey:'sk-local-compressed',baseUrl:server.baseUrl,maxResponseBytes:limit,timeoutMs:5000});
  await assert.rejects(client.respond(call),refusal('malformed'));
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   assert.equal(await Promise.race([server.closed.then(()=>true),new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(false),1000);})]),true,'overflow connection retained');
  }finally{clearTimeout(timer);}
  assert.equal(server.requests(),1);
 });

 test(`${encoding} decode failures expose a sanitized network error without usage or retries`,async t=>{
  const server=await listener(t,res=>{
   res.writeHead(200,{'content-type':'application/json','content-encoding':encoding});
   res.end('PRIVATE-MENU sk-local-compressed');
  });
  const client=createLoopbackOpenAiClient({apiKey:'sk-local-compressed',baseUrl:server.baseUrl,timeoutMs:5000});
  await assert.rejects(client.respond(call),refusal('network'));
  assert.equal(server.requests(),1);
 });
}
