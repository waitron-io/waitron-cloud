import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer,type ServerResponse} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {createLoopbackOpenAiClient,ProviderError} from '../src/openai-client.ts';

const privateText='PRIVATE UNFINISHED TRANSLATION',key='local-timeout-isolation-key';
const unfinished=JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:privateText}]}],usage:{input_tokens:17,output_tokens:23}});
const healthy='{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"Tarta de limón"}]}],"usage":{"input_tokens":3,"output_tokens":5}}';

async function within<T>(promise:Promise<T>):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([promise,new Promise<never>((_resolve,reject)=>{
  timer=setTimeout(()=>reject(new Error('local timeout-isolation operation did not finish')),6000);
 })]);}finally{clearTimeout(timer);}
}

for(const phase of ['headers','body'] as const){
 test(`a timeout during ${phase} leaves a later overlapping request and fresh client deadline usable`,{timeout:15000},async t=>{
  const stop=new AbortController(),inputs:string[]=[];
  let received!:()=>void,firstRead!:()=>void,peerRead!:()=>void,closed!:()=>void;
  const firstReceived=new Promise<void>(resolve=>{received=resolve;});
  const firstBodyRead=new Promise<void>(resolve=>{firstRead=resolve;});
  const peerBodyRead=new Promise<void>(resolve=>{peerRead=resolve;});
  const firstClosed=new Promise<void>(resolve=>{closed=resolve;});
  let firstEnded:boolean|undefined,peerEnded=false,peerSettled=false,peerResponse:ServerResponse|undefined;
  const server=createServer(async(req,res)=>{
   const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
   const input=(JSON.parse(Buffer.concat(chunks).toString()) as {input:string}).input;
   inputs.push(input);
   if(input==='earlier'){
    res.once('close',()=>{firstEnded=res.writableEnded;closed();});
    if(phase==='body'){res.writeHead(200,{'content-type':'application/json'});res.write(unfinished);}
    received();
   }else if(input==='overlapping'){
    peerResponse=res;res.once('close',()=>{peerEnded=true;});
    res.writeHead(200,{'content-type':'application/json'});res.write(healthy);
   }else{res.writeHead(200,{'content-type':'application/json'});res.end(healthy);}
  });
  t.after(async()=>{stop.abort();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const nativeFetch=globalThis.fetch;
  t.mock.method(globalThis,'fetch',async(...args:Parameters<typeof fetch>)=>{
   const input=(JSON.parse(String(args[1]?.body)) as {input:string}).input;
   const reply=await nativeFetch(...args),body=reply.body;
   if(body&&(input==='earlier'||input==='overlapping')){
    const getReader=body.getReader.bind(body);
    t.mock.method(body,'getReader',()=>{
     const reader=getReader(),read=reader.read.bind(reader);let bytes=0;
     t.mock.method(reader,'read',async()=>{
      const result=await read();if(!result.done)bytes+=result.value.byteLength;
      if(input==='earlier'&&bytes===Buffer.byteLength(unfinished))firstRead();
      if(input==='overlapping'&&bytes===Buffer.byteLength(healthy))peerRead();
      return result;
     });
     return reader;
    });
   }
   return reply;
  });
  const client=createLoopbackOpenAiClient({apiKey:key,baseUrl:`http://127.0.0.1:${address.port}`,timeoutMs:3000});
  const call=(input:string)=>({instructions:'Translate the menu',input,effort:'low'} as const);
  const earlier=client.respond(call('earlier'),stop.signal).then(reply=>({reply}),(error:unknown)=>({error}));
  await within(firstReceived);if(phase==='body')await within(firstBodyRead);
  // Stagger real deadlines so the second body can remain pending when the first expires.
  await delay(1500);
  const peer=client.respond(call('overlapping'),stop.signal).finally(()=>{peerSettled=true;});
  void peer.catch(()=>{});
  try{
   await within(peerBodyRead);
   const result=await within(earlier);
   assert.ok('error' in result,'an unfinished request must not return text or usage');
   assert.ok(result.error instanceof ProviderError);
   assert.deepEqual([result.error.kind,result.error.retryable,result.error.usage],['timeout',true,undefined]);
   for(const rendered of [String(result.error),result.error.stack??'',JSON.stringify(result.error)]){
    for(const secret of [key,privateText])assert.equal(rendered.includes(secret),false);
   }
   await within(firstClosed);
   assert.equal(firstEnded,false,'timeout must close the unfinished server response');
   assert.equal(peerSettled,false,'the earlier deadline must not settle its overlapping peer');
   assert.equal(peerEnded,false,'the earlier deadline must not close its overlapping peer');
   assert.ok(peerResponse);peerResponse.end();
   assert.deepEqual(await within(peer),{text:'Tarta de limón',inputTokens:3,outputTokens:5});
   assert.deepEqual(await within(client.respond(call('later'),stop.signal)),{text:'Tarta de limón',inputTokens:3,outputTokens:5});
   assert.deepEqual(inputs,['earlier','overlapping','later'],'timeouts must not cause automatic repeats');
  }finally{stop.abort();server.closeAllConnections();await Promise.allSettled([earlier,peer]);}
 });
}
