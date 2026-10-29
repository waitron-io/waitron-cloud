import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer,type ServerResponse} from 'node:http';
import {setImmediate} from 'node:timers/promises';
import {test} from 'node:test';
import {deflateSync,gzipSync} from 'node:zlib';
import {translateBatch,type BatchHooks} from '../src/batch-runner.ts';
import {parseJob} from '../src/job-body.ts';
import {createLoopbackOpenAiClient} from '../src/openai-client.ts';
import {responsesBody} from './fake-openai.ts';

const job=parseJob(JSON.stringify({version:1,country:'ES',languages:{default:'es',enabled:['es']},
 items:[{ref:'product:1',kind:'product',family:'product:1',category:null,staffName:'CAFE',existing:{},missing:['es']}],houseStyle:[]}));
const first=responsesBody('{"products":[{"id":"p01","es":"Café","placeholder":false,"corrections":[]}]}',{input_tokens:11,output_tokens:5});
const review=responsesBody('{"changes":[{"id":"p01","language":"es","name":"Café de la casa"}]}',{input_tokens:7,output_tokens:3});

async function within<T>(promise:Promise<T>):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([promise,new Promise<never>((_resolve,reject)=>{
  timer=setTimeout(()=>reject(new Error('local compressed batch did not progress')),5000);
 })]);}finally{clearTimeout(timer);}
}

// Admitting decoded JSON before its checksum would bill and accept an unvalidated reply.
for(const [encoding,compress,trailerLength] of [['gzip',gzipSync,8],['deflate',deflateSync,4]] as const){
 for(const phase of ['first pass','review'] as const)for(const exhaust of [false,true]){
  test(`${phase} ${encoding} checksum failure ${exhaust?'exhausts four attempts':'recovers on the next attempt'} without unvalidated spending`,{timeout:15000},async t=>{
   const targetEffort=phase==='first pass'?'low':'medium',badLimit=exhaust?4:1;
   const raw=Buffer.from(JSON.stringify(phase==='first pass'?first:review)),encoded=compress(raw);
   const trailer=Buffer.from(encoded.subarray(-trailerLength));trailer.writeUInt8(trailer.readUInt8(0)^0xff,0);
   const efforts:string[]=[],events:string[]=[],waits:number[]=[],spent:{inputTokens:number;outputTokens:number}[]=[];
   let bad=0,held:ServerResponse|undefined,decodedBytes=0,resolveDecoded!:()=>void,resolveWait!:()=>void,releaseWait!:()=>void;
   const decoded=new Promise<void>(resolve=>{resolveDecoded=resolve;});
   const waiting=new Promise<void>(resolve=>{resolveWait=resolve;}),resume=new Promise<void>(resolve=>{releaseWait=resolve;});
   const server=createServer(async(req,res)=>{
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk as Buffer);
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8')) as {reasoning:{effort:string}};
    const effort=body.reasoning.effort;efforts.push(effort);
    if(effort===targetEffort&&bad<badLimit){
     bad++;res.writeHead(200,{'content-type':'application/json','content-encoding':encoding,'content-length':encoded.length});
     if(bad===1){held=res;res.write(encoded.subarray(0,-trailerLength));}
     else res.end(Buffer.concat([encoded.subarray(0,-trailerLength),trailer]));
    }else{
     res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(effort==='low'?first:review));
    }
   });
   t.after(async()=>{releaseWait();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
   server.listen(0,'127.0.0.1');await once(server,'listening');
   const address=server.address();assert.ok(address&&typeof address!=='string');
   const nativeFetch=globalThis.fetch;
   t.mock.method(globalThis,'fetch',async(...args:Parameters<typeof fetch>)=>{
    const reply=await nativeFetch(...args),body=reply.body;assert.ok(body);
    if(reply.headers.get('content-encoding')===encoding&&bad===1){
     const nativeGetReader=body.getReader.bind(body);
     t.mock.method(body,'getReader',()=>{
      const reader=nativeGetReader(),nativeRead=reader.read.bind(reader);
      t.mock.method(reader,'read',async()=>{
       const value=await nativeRead();
       if(!value.done){decodedBytes+=value.value.byteLength;if(decodedBytes===raw.length)resolveDecoded();}
       return value;
      });
      return reader;
     });
    }
    return reply;
   });
   const hooks:BatchHooks={
    async mayCall(){events.push('allow');return true;},
    async spent(tokens){events.push('spent');spent.push(tokens);},
    async attempted(){events.push('renew');},
    async wait(ms){events.push('wait');waits.push(ms);if(waits.length===1){resolveWait();await resume;}},
   };
   const client=createLoopbackOpenAiClient({apiKey:'local-compressed-batch',baseUrl:`http://127.0.0.1:${address.port}`,timeoutMs:5000});
   let settled=false;
   const pending=translateBatch(job,job.items,client,hooks,new AbortController().signal)
    .then(value=>({value}),(error:unknown)=>({error})).finally(()=>{settled=true;});
   const previous=phase==='review'?['allow','spent','renew']:[];
   try{
    await within(decoded);await setImmediate();
    assert.equal(decodedBytes,raw.length,'valid names and usage must precede the checksum');
    assert.equal(settled,false);
    assert.deepEqual(events,[...previous,'allow'],'unvalidated response reached a callback');
    assert.deepEqual(spent,phase==='review'?[{inputTokens:11,outputTokens:5}]:[]);
    assert.ok(held);held.end(trailer);
    await within(waiting);await setImmediate();
    assert.deepEqual(events,[...previous,'allow','renew','wait'],'corrupt usage was billed or renewal was skipped');
    assert.deepEqual(efforts,phase==='review'?['low','medium']:['low'],'retry started before its wait completed');
    assert.equal(settled,false);
    releaseWait();
    const outcome=await within(pending);assert.ok('value' in outcome,'compressed failure escaped the bounded retry path');
    assert.deepEqual(waits,exhaust?[2000,8000,30000]:[2000]);
    const failedEvents=Array.from({length:badLimit},(_unused,index)=>['allow','renew',...(index<3?['wait']:[])]).flat();
    if(exhaust){
     assert.deepEqual(events,[...previous,...failedEvents]);
     assert.deepEqual(efforts,phase==='review'?['low','medium','medium','medium','medium']:['low','low','low','low']);
     assert.deepEqual(spent,phase==='review'?[{inputTokens:11,outputTokens:5}]:[]);
     if(phase==='first pass')assert.deepEqual(outcome.value,{kind:'failed',reason:'provider_unavailable'});
     else{
      assert.ok(outcome.value.kind==='done');
      assert.deepEqual([outcome.value.results.map(row=>row.names),outcome.value.reviewFailed,outcome.value.reviewApplied,outcome.value.reviewDropped],[[{es:'Café'}],true,0,0]);
     }
    }else{
     assert.deepEqual(events,[...previous,'allow','renew','wait','allow','spent','renew',...(phase==='first pass'?['allow','spent','renew']:[])]);
     assert.deepEqual(efforts,phase==='review'?['low','medium','medium']:['low','low','medium']);
     assert.deepEqual(spent,[{inputTokens:11,outputTokens:5},{inputTokens:7,outputTokens:3}]);
     assert.ok(outcome.value.kind==='done');
     assert.deepEqual([outcome.value.results.map(row=>row.names),outcome.value.reviewFailed,outcome.value.reviewApplied,outcome.value.reviewDropped],[[{es:'Café de la casa'}],false,1,0]);
    }
   }finally{releaseWait();server.closeAllConnections();await within(pending);}
  });
 }
}
