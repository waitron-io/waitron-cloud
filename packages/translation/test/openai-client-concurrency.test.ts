import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer,type ServerResponse} from 'node:http';
import {setImmediate} from 'node:timers/promises';
import {test} from 'node:test';
import {createLoopbackOpenAiClient,ProviderError} from '../src/index.ts';

const healthyBody='{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"Tarta de limón 🍋"}]}],"usage":{"input_tokens":7,"output_tokens":11}}';
const limit=512;
const failures=[['caller abort','network',true],['overflow','malformed',true],['truncated body','network',true],['HTTP refusal','refused',false]] as const;

for(const [failure,kind,retryable] of failures)for(const healthyFirst of [false,true]){
 test(`concurrent ${failure} leaves its peer usable when the healthy response finishes ${healthyFirst?'first':'last'}`,async()=>{
  let ready!:()=>void,closed!:()=>void;
  const bothReceived=new Promise<void>(resolve=>{ready=resolve;}),failedClosed=new Promise<void>(resolve=>{closed=resolve;});
  const responses=new Map<string,ServerResponse>(),inputs:string[]=[];
  const server=createServer(async(req,res)=>{
   const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
   const body=JSON.parse(Buffer.concat(chunks).toString()) as {input:string};
   inputs.push(body.input);responses.set(body.input,res);
   if(body.input==='failing'){
    res.once('close',closed);
    res.writeHead(failure==='HTTP refusal'?401:200,{'content-type':'application/json',...(failure==='truncated body'?{'content-length':'1000',connection:'close'}:{})});
   }else res.writeHead(200,{'content-type':'application/json'});
   // Hold both real response bodies until the test chooses their completion order.
   if(responses.size===2)ready();
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const client=createLoopbackOpenAiClient({apiKey:'synthetic-key',baseUrl:`http://127.0.0.1:${address.port}`,maxResponseBytes:limit,timeoutMs:5000});
  const controller=new AbortController();
  let healthySettled=false,failedSettled=false;
  const healthy=client.respond({instructions:'Translate',input:'healthy',effort:'low'}).finally(()=>{healthySettled=true;});
  const failed=client.respond({instructions:'Translate',input:'failing',effort:'medium'},controller.signal)
   .then(reply=>({reply}), (error:unknown)=>({error})).finally(()=>{failedSettled=true;});
  // Observe rejection immediately; assertions below still inspect the original promise.
  void healthy.catch(()=>{});
  try{
   await bothReceived;
   const succeed=()=>responses.get('healthy')!.end(healthyBody);
   const refuse=()=>{
    const response=responses.get('failing')!;
    if(failure==='caller abort'){response.flushHeaders();controller.abort();}
    else if(failure==='overflow')response.write('PRIVATE-NAME'.repeat(60));
    else if(failure==='truncated body')response.end('PRIVATE-NAME');
    else response.write('PRIVATE-NAME');
   };
   const checkHealthy=async()=>assert.deepEqual(await healthy,{text:'Tarta de limón 🍋',inputTokens:7,outputTokens:11});
   const checkFailure=async()=>{
    const result=await failed;
    assert.ok('error' in result,'failed request unexpectedly returned a reply');
    assert.ok(result.error instanceof ProviderError);
    assert.deepEqual([result.error.kind,result.error.retryable,result.error.usage],[kind,retryable,undefined]);
    for(const secret of ['PRIVATE-NAME','synthetic-key'])assert.equal(String(result.error.stack).includes(secret),false);
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{assert.equal(await Promise.race([failedClosed.then(()=>true),new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(false),1000);})]),true,'failed response connection retained');}
    finally{clearTimeout(timer);}
   };
   if(healthyFirst){
    succeed();await checkHealthy();await setImmediate();await setImmediate();
    assert.equal(failedSettled,false,'peer settled before its failure was released');
    refuse();await checkFailure();
   }else{
    refuse();await checkFailure();await setImmediate();await setImmediate();
    assert.equal(healthySettled,false,'healthy peer settled before its body was released');
    succeed();await checkHealthy();
   }
   assert.deepEqual(inputs.sort(),['failing','healthy'],'each call must send exactly one request');
  }finally{
   controller.abort();server.closeAllConnections();
   await Promise.allSettled([healthy,failed]);
   await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
 });
}
