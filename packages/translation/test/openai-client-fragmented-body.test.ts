import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer,type ServerResponse} from 'node:http';
import {test,type TestContext} from 'node:test';
import {createLoopbackOpenAiClient,ProviderError} from '../src/index.ts';

const call={instructions:'Translate the menu',input:'Lemon cake',effort:'low'} as const;
const raw='{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"Tarta de limón 🍋"}]}],"usage":{"input_tokens":7,"output_tokens":11}}';
const bytes=Buffer.from(raw);
const emoji=bytes.indexOf(Buffer.from('🍋'));
const fragments=[bytes.subarray(0,emoji+1),bytes.subarray(emoji+1,emoji+3),bytes.subarray(emoji+3)];

async function fragmented(t:TestContext,chunks:readonly Buffer[],finish:boolean){
 let response:ServerResponse|undefined,index=0,resolveClosed!:()=>void;
 const closed=new Promise<void>(resolve=>{resolveClosed=resolve;});
 const reads:number[]=[];
 let requests=0;
 const sendNext=()=>{
  if(response?.destroyed)return;
  if(index<chunks.length)response?.write(chunks[index++]!);
  else if(finish)response?.end();
 };
 const server=createServer(async(req,res)=>{
  for await(const _chunk of req){}
  requests++;response=res;res.once('close',resolveClosed);
  res.writeHead(200,{'content-type':'application/json'});sendNext();
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
 const address=server.address();assert.ok(address&&typeof address!=='string');
 const nativeFetch=globalThis.fetch;
 t.mock.method(globalThis,'fetch',async(...args:Parameters<typeof fetch>)=>{
  const reply=await nativeFetch(...args),body=reply.body;assert.ok(body);
  const nativeGetReader=body.getReader.bind(body);
  t.mock.method(body,'getReader',()=>{
   const reader=nativeGetReader(),nativeRead=reader.read.bind(reader);
   t.mock.method(reader,'read',async()=>{
    const result=await nativeRead();
    // Acknowledge each real network read before sending the next fragment.
    if(!result.done){reads.push(result.value.byteLength);sendNext();}
    return result;
   });
   return reader;
  });
  return reply;
 });
 return {baseUrl:`http://127.0.0.1:${address.port}`,reads,closed,requests:()=>requests};
}

test('split UTF-8 bytes survive a fragmented reply exactly at its cumulative byte limit',async t=>{
 const stream=await fragmented(t,fragments,true);
 const client=createLoopbackOpenAiClient({apiKey:'local-test',baseUrl:stream.baseUrl,maxResponseBytes:bytes.length,timeoutMs:5000});
 assert.deepEqual(await client.respond(call),{text:'Tarta de limón 🍋',inputTokens:7,outputTokens:11});
 assert.deepEqual(stream.reads,fragments.map(chunk=>chunk.length));
 assert.equal(stream.requests(),1);
});

for(const finish of [true,false])test(`cumulative overflow refuses ${finish?'a completed':'an unfinished'} fragmented reply and closes its connection`,async t=>{
 const stream=await fragmented(t,fragments,finish);
 const limit=bytes.length-1;
 assert.ok(fragments.every(chunk=>chunk.length<=limit));
 const client=createLoopbackOpenAiClient({apiKey:'local-test',baseUrl:stream.baseUrl,maxResponseBytes:limit,timeoutMs:5000});
 await assert.rejects(client.respond(call),(error:unknown)=>{
  assert.ok(error instanceof ProviderError);
  assert.deepEqual([error.kind,error.retryable,error.usage],['malformed',true,undefined]);
  assert.equal(error.message.includes('limón'),false);
  return true;
 });
 assert.deepEqual(stream.reads,fragments.map(chunk=>chunk.length));
 assert.equal(stream.requests(),1);
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{assert.equal(await Promise.race([stream.closed.then(()=>true),new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(false),1000);})]),true,'overflow connection retained');}
 finally{clearTimeout(timer);}
});
