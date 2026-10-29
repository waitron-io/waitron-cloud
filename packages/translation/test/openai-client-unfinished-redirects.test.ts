import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {test,type TestContext} from 'node:test';
import {createLoopbackOpenAiClient,ProviderError} from '../src/openai-client.ts';
import {parseJob} from '../src/job-body.ts';
import {translateBatch,type BatchHooks} from '../src/batch-runner.ts';

const call={instructions:'Translate',input:'PRIVATE MENU',effort:'low'} as const;
const key='synthetic-redirect-key';
const job=parseJob(JSON.stringify({version:1,country:'ES',languages:{default:'es',enabled:['es']},
 items:[{ref:'product:1',kind:'product',family:'product:1',category:null,staffName:'CAFE',existing:{},missing:['es']}],houseStyle:[]}));
const firstText='{"products":[{"id":"p01","es":"Café","placeholder":false,"corrections":[]}]}';
const envelope=(text:string)=>JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}],usage:{input_tokens:11,output_tokens:5}});

async function fixture(t:TestContext,status:number,review=false){
 let targetRequests=0,healthy=false,ended=false,closed!:()=>void;
 const connectionClosed=new Promise<void>(resolve=>{closed=resolve;}),efforts:string[]=[],paths:string[]=[];
 const target=createServer(async(req,res)=>{
  for await(const _chunk of req){}
  targetRequests++;res.end(envelope('PRIVATE REDIRECT TARGET'));
 });
 t.after(async()=>{target.closeAllConnections();await new Promise<void>(resolve=>target.close(()=>resolve()));});
 target.listen(0,'127.0.0.1');await once(target,'listening');
 const targetAddress=target.address();assert.ok(targetAddress&&typeof targetAddress!=='string');
 const server=createServer(async(req,res)=>{
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
  const body=JSON.parse(Buffer.concat(chunks).toString()) as {reasoning:{effort:string}};
  efforts.push(body.reasoning.effort);paths.push(`${req.method} ${req.url}`);
  if(healthy||(review&&efforts.length===1)){
   res.writeHead(200,{'content-type':'application/json'});res.end(envelope(firstText));return;
  }
  res.once('close',()=>{ended=res.writableEnded;closed();});
  res.writeHead(status,{'content-type':'application/json',location:`http://127.0.0.1:${targetAddress.port}/private-target`,'retry-after':'9'});
  // A valid JSON envelope in an unfinished body must never supply text or usage for a redirect.
  res.write(envelope('PRIVATE REDIRECT BODY'));
 });
 t.after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const address=server.address();assert.ok(address&&typeof address!=='string');
 const client=createLoopbackOpenAiClient({apiKey:key,baseUrl:`http://127.0.0.1:${address.port}`,timeoutMs:5000});
 return {client,efforts,paths,async released(){
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([connectionClosed,new Promise<never>((_resolve,reject)=>{
   timer=setTimeout(()=>reject(new Error('unfinished redirect connection retained')),2000);
  })]);}finally{clearTimeout(timer);}
  assert.equal(ended,false,'the redirect body must remain unfinished when its connection closes');
  assert.equal(targetRequests,0,'no request may reach the redirect target');
 },async reuse(){
  healthy=true;
  assert.deepEqual(await client.respond(call),{text:firstText,inputTokens:11,outputTokens:5});
  assert.equal(targetRequests,0,'later client use must not follow the earlier redirect');
 }};
}

for(const status of [301,302,303,307,308]){
 test(`unfinished HTTP ${status} closes without following and permits later client reuse`,{timeout:10000},async t=>{
  const f=await fixture(t,status);
  await assert.rejects(f.client.respond(call),(error:unknown)=>{
   assert.ok(error instanceof ProviderError);
   assert.deepEqual([error.kind,error.retryable,error.retryAfterMs,error.usage],['redirect',false,undefined,undefined]);
   assert.equal(error.message,'redirect');
   for(const rendered of [String(error),error.stack??'',JSON.stringify(error)])
    for(const secret of [key,call.input,'PRIVATE REDIRECT BODY','private-target'])assert.equal(rendered.includes(secret),false);
   return true;
  });
  await f.released();assert.deepEqual(f.paths,['POST /responses']);
  await f.reuse();assert.deepEqual(f.paths,['POST /responses','POST /responses']);
 });
 for(const review of [false,true])test(`unfinished HTTP ${status} stops the ${review?'review':'first'} pass without retry or invented usage`,{timeout:10000},async t=>{
  const f=await fixture(t,status,review),events:string[]=[],usage:{inputTokens:number;outputTokens:number}[]=[];
  const hooks:BatchHooks={
   async mayCall(){events.push('allow');return true;},
   async spent(tokens){events.push('spent');usage.push(tokens);},
   async attempted(){events.push('attempted');},
   async wait(){events.push('wait');},
  };
  const result=await translateBatch(job,job.items,f.client,hooks,new AbortController().signal);
  await f.released();
  assert.deepEqual(result,review?{kind:'done',results:[{ref:'product:1',placeholder:false,names:{es:'Café'},corrections:[]}],reviewApplied:0,reviewDropped:0,reviewFailed:true}:{kind:'failed',reason:'provider_unavailable'});
  assert.deepEqual(usage,review?[{inputTokens:11,outputTokens:5}]:[]);
  assert.deepEqual(events,review?['allow','spent','attempted','allow','attempted']:['allow','attempted']);
  assert.deepEqual(f.efforts,review?['low','medium']:['low']);
  assert.deepEqual(f.paths,review?['POST /responses','POST /responses']:['POST /responses']);
  await f.reuse();
 });
}
