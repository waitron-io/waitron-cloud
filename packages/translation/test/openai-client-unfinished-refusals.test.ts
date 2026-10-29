import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {test} from 'node:test';
import {createLoopbackOpenAiClient,ProviderError} from '../src/openai-client.ts';

const call={instructions:'Translate the menu',input:'Lemon cake',effort:'low'} as const;
const key='local-unfinished-response-key',privateText='PRIVATE UNPARSED MENU';
const body=JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:privateText}]}],usage:{input_tokens:17,output_tokens:23}});

for(const [status,kind,retryable,retryAfterMs] of [
 [401,'refused',false,undefined],
 [403,'refused',false,undefined],
 [429,'rate_limited',true,2000],
 [500,'server',true,undefined],
 [503,'server',true,2000],
] as const){
 test(`unfinished HTTP ${status} retains its classification and releases its connection`,{timeout:10000},async t=>{
  let requests=0,ended=false,closed=false,releaseClosed!:()=>void;
  const connectionClosed=new Promise<void>(resolve=>{releaseClosed=resolve;});
  const paths:string[]=[];
  const server=createServer(async(req,res)=>{
   for await(const _chunk of req){}
   requests++;paths.push(`${req.method} ${req.url}`);
   if(requests===1){
    res.once('close',()=>{closed=true;ended=res.writableEnded;releaseClosed();});
    res.writeHead(status,{'content-type':'application/json',...(status===429||status===503?{'retry-after':'2'}:{})});
    // The complete JSON remains in an unfinished HTTP body; status must decide before body parsing.
    res.write(body);
   }else{
    res.writeHead(200,{'content-type':'application/json'});
    res.end('{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"Tarta de limón"}]}],"usage":{"input_tokens":3,"output_tokens":5}}');
   }
  });
  t.after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const client=createLoopbackOpenAiClient({apiKey:key,baseUrl:`http://127.0.0.1:${address.port}`,timeoutMs:3000});
  await assert.rejects(client.respond(call),(error:unknown)=>{
   assert.ok(error instanceof ProviderError);
   assert.deepEqual([error.kind,error.retryable,error.retryAfterMs,error.usage],[kind,retryable,retryAfterMs,undefined]);
   assert.equal(error.message,kind);
   for(const rendered of [String(error),error.stack??'',JSON.stringify(error)]){
    assert.equal(rendered.includes(key),false);
    assert.equal(rendered.includes(privateText),false);
   }
   return true;
  });
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   await Promise.race([connectionClosed,new Promise<never>((_resolve,reject)=>{
    timer=setTimeout(()=>reject(new Error('unfinished error response connection retained')),2000);
   })]);
  }finally{clearTimeout(timer);}
  assert.equal(closed,true);
  assert.equal(ended,false,'the server must not finish the error body to release the connection');
  assert.equal(requests,1,'classification must not retry the provider call');
  assert.deepEqual(await client.respond(call),{text:'Tarta de limón',inputTokens:3,outputTokens:5});
  assert.deepEqual(paths,['POST /responses','POST /responses']);
 });
}
