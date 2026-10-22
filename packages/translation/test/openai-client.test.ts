import assert from 'node:assert/strict';
import {test} from 'node:test';
import {once} from 'node:events';
import {createServer,type ServerResponse} from 'node:http';
import {createLoopbackOpenAiClient,openAiBaseUrl,ProviderError} from '../src/index.ts';
import {responsesBody,startFakeOpenAi,echoFirstPass,emptyReview,isReview,type FakeReply} from './fake-openai.ts';
import {firstPassInput,firstPassInstructions,reviewInstructions,reviewInput,checkFirstPass,type ParsedJob} from '../src/index.ts';
const call={instructions:'I',input:'U',effort:'low'} as const;
async function failure(reply:FakeReply,options:{timeoutMs?:number;maxResponseBytes?:number}={},signal?:AbortSignal):Promise<ProviderError>{
 const fake=await startFakeOpenAi(()=>reply);
 try{
  const error=await createLoopbackOpenAiClient({apiKey:'sk-test-key',baseUrl:fake.baseUrl,...options}).respond(call,signal).then(()=>undefined,(e:unknown)=>e);
  assert.ok(error instanceof ProviderError,String(error));return error;
 }finally{await fake.close();}
}
test('a request carries the pinned model, the effort, store false and the key, and returns text and tokens',async()=>{
 const fake=await startFakeOpenAi(()=>({json:responsesBody('{"products":[]}',{input_tokens:1200,output_tokens:340})}));
 try{
  const client=createLoopbackOpenAiClient({apiKey:'sk-test-key',baseUrl:fake.baseUrl});
  assert.deepEqual(await client.respond(call),{text:'{"products":[]}',inputTokens:1200,outputTokens:340});
  const r=fake.requests[0]!;
  assert.equal(r.path,'/responses');assert.equal(r.headers.authorization,'Bearer sk-test-key');
  assert.deepEqual(r.body,{model:'gpt-6-luna',instructions:'I',input:'U',reasoning:{effort:'low'},store:false});
 }finally{await fake.close();}
});
test('a slow reply times out as a retryable timeout',async()=>{
 const e=await failure({delayMs:500,json:responsesBody('x')},{timeoutMs:100});
 assert.deepEqual([e.kind,e.retryable],['timeout',true]);
});
test("a caller's abort is reported as a network error",async()=>{
 const controller=new AbortController();setTimeout(()=>controller.abort(),50);
 const e=await failure({delayMs:2000,json:responsesBody('x')},{},controller.signal);
 assert.equal(e.kind,'network');
});
test('a server that is not there is a retryable network error',async()=>{
 const fake=await startFakeOpenAi(()=>({json:responsesBody('x')}));await fake.close();
 const e=await createLoopbackOpenAiClient({apiKey:'k',baseUrl:fake.baseUrl}).respond(call).then(()=>undefined,(error:unknown)=>error);
 assert.ok(e instanceof ProviderError);assert.deepEqual([e.kind,e.retryable],['network',true]);
});
test('a 429 carries Retry-After in milliseconds, read as seconds or as a date and capped at 60 seconds',async()=>{
 assert.equal((await failure({status:429,headers:{'retry-after':'3'}})).retryAfterMs,3000);
 assert.equal((await failure({status:429,headers:{'retry-after':'120'}})).retryAfterMs,60000);
 const dated=(await failure({status:429,headers:{'retry-after':new Date(Date.now()+5000).toUTCString()}})).retryAfterMs;
 assert.ok(dated!==undefined&&dated>3000&&dated<=5000,String(dated));
 const plain=await failure({status:429});
 assert.deepEqual([plain.kind,plain.retryable,plain.retryAfterMs],['rate_limited',true,undefined]);
});
test('server errors retry, other refusals do not',async()=>{
 for(const status of [500,503]){const e=await failure({status});assert.deepEqual([e.kind,e.retryable],['server',true]);}
 for(const status of [400,401,403]){const e=await failure({status});assert.deepEqual([e.kind,e.retryable],['refused',false]);}
});
test('a redirect is refused and never followed',async()=>{
 let followed=0;const target=await startFakeOpenAi(()=>{followed++;return {json:responsesBody('x')};});
 const fake=await startFakeOpenAi(()=>({status:307,headers:{location:target.baseUrl+'/responses'}}));
 try{await assert.rejects(createLoopbackOpenAiClient({apiKey:'k',baseUrl:fake.baseUrl}).respond(call),(e:unknown)=>e instanceof ProviderError&&e.kind==='redirect'&&!e.retryable);assert.equal(followed,0);}
 finally{await fake.close();await target.close();}
});
test('a body that is not the Responses shape, an incomplete reply or an oversized body is malformed and retryable',async()=>{
 const cases:[FakeReply,{maxResponseBytes?:number}][]=[[{raw:'not json'},{}],[{json:{...responsesBody('x'),status:'incomplete'}},{}],
  [{json:{...responsesBody('x'),usage:{input_tokens:-1,output_tokens:1}}},{}],[{raw:'x'.repeat(2000)},{maxResponseBytes:1000}]];
 for(const [reply,options] of cases){const e=await failure(reply,options);assert.deepEqual([e.kind,e.retryable],['malformed',true]);}
});
test('an incomplete reply still reports the tokens it was billed for',async()=>{
 const e=await failure({json:{...responsesBody('x',{input_tokens:900,output_tokens:4000}),status:'incomplete'}});
 assert.deepEqual(e.usage,{inputTokens:900,outputTokens:4000});
});
test('the error message never carries the reply or the key',async()=>{
 const e=await failure({status:401,raw:'sk-test-key PRIVATE-NAME'});
 for(const text of [String(e),e.message,e.stack??''])for(const secret of ['sk-test-key','PRIVATE-NAME'])assert.equal(text.includes(secret),false,secret);
});
test('the base URL setting accepts https and loopback http only',()=>{
 assert.equal(openAiBaseUrl({}),'https://api.openai.com/v1');assert.equal(openAiBaseUrl({CLOUD_OPENAI_BASE_URL:''}),'https://api.openai.com/v1');
 assert.equal(openAiBaseUrl({CLOUD_OPENAI_BASE_URL:'http://127.0.0.1:4010/v1'}),'http://127.0.0.1:4010/v1');
 for(const bad of ['http://example.test/v1','ftp://127.0.0.1/','https://user:pw@api.test/v1','https://api.test/v1?x=1','not a url'])assert.throws(()=>openAiBaseUrl({CLOUD_OPENAI_BASE_URL:bad}));
});

test('unusable 200 replies retain valid billed usage even when output is missing',async()=>{
 for(const status of ['incomplete','failed','cancelled','completed']){
  const e=await failure({json:{status,usage:{input_tokens:12,output_tokens:34}}});
  assert.deepEqual([e.kind,e.retryable,e.usage],['malformed',true,{inputTokens:12,outputTokens:34}]);
 }
});
test('HTTP refusal and rate-limit classification does not depend on error body size',async()=>{
 for(const [status,kind,retryable] of [[401,'refused',false],[429,'rate_limited',true],[503,'server',true]] as const){
  const e=await failure({status,raw:'PRIVATE-NAME'.repeat(1000),headers:{'retry-after':'2'}},{maxResponseBytes:8});
  assert.deepEqual([e.kind,e.retryable,e.retryAfterMs],[kind,retryable,status===401?undefined:2000]);
 }
});
test('ordered output text is joined across messages, ignoring reasoning and refusal parts',async()=>{
 const fake=await startFakeOpenAi(()=>({json:{...responsesBody(''),output:[
  {type:'reasoning',content:[{type:'output_text',text:'PRIVATE REASONING'}]},
  {type:'message',content:[{type:'refusal',refusal:'no',text:'NOT OUTPUT'},{type:'output_text',text:'one'}]},
  {type:'message',content:[{type:'output_text',text:'two'},{type:'output_text',text:42}]},null,
 ]}}));
 try{assert.deepEqual(await createLoopbackOpenAiClient({apiKey:'k',baseUrl:fake.baseUrl+'/v1/'}).respond({...call,effort:'medium'}),{text:'onetwo',inputTokens:100,outputTokens:50});
 assert.equal(fake.requests[0]!.path,'/v1/responses');assert.equal(fake.requests[0]!.body.reasoning.effort,'medium');}
 finally{await fake.close();}
});
test('usage requires nonnegative safe integers for both token counts',async()=>{
 for(const value of [-1,0.5,'1',null,Number.MAX_SAFE_INTEGER+1])for(const field of ['input_tokens','output_tokens']){
  const e=await failure({json:{...responsesBody('x'),usage:{input_tokens:0,output_tokens:0,[field]:value}}});
  assert.deepEqual([e.kind,e.retryable,e.usage],['malformed',true,undefined]);
 }
 const fake=await startFakeOpenAi(()=>({json:responsesBody('',{input_tokens:0,output_tokens:0})}));
 try{assert.deepEqual(await createLoopbackOpenAiClient({apiKey:'k',baseUrl:fake.baseUrl}).respond(call),{text:'',inputTokens:0,outputTokens:0});}finally{await fake.close();}
});
test('JSON primitives, arrays and missing output are malformed',async()=>{
 for(const json of [null,[],42,'text',{}, {...responsesBody('x'),output:{}}]){
  const e=await failure({json});assert.deepEqual([e.kind,e.retryable],['malformed',true]);
 }
});
test('the response bound counts UTF-8 bytes and allows the exact boundary',async()=>{
 const json=responsesBody('🍋'.repeat(30)),raw=JSON.stringify(json),size=Buffer.byteLength(raw);
 assert.ok(size>raw.length);
 const fake=await startFakeOpenAi(()=>({raw}));
 try{
  const client=createLoopbackOpenAiClient({apiKey:'k',baseUrl:fake.baseUrl,maxResponseBytes:size});
  assert.equal((await client.respond(call)).text,'🍋'.repeat(30));
  const e=await failure({raw},{maxResponseBytes:size-1});assert.equal(e.kind,'malformed');
 }finally{await fake.close();}
});
test('retry-after ignores invalid dates, floors past dates and caps server delays',async()=>{
 for(const [header,want] of [['nonsense',undefined],['1.5',undefined],['foo 5',undefined],['-3',undefined],['Thu, 01 Jan 1970 00:00:00 GMT',0],['0',0],['999999999',60000]] as const){
  const e=await failure({status:503,headers:{'retry-after':header}});assert.deepEqual([e.kind,e.retryable,e.retryAfterMs],['server',true,want]);
 }
});
test('all redirect statuses are refused without sending the key to the target',async()=>{
 const target=await startFakeOpenAi(()=>({json:responsesBody('x')}));
 try{for(const status of [301,302,303,307,308]){
  const e=await failure({status,headers:{location:target.baseUrl+'/responses'}});assert.deepEqual([e.kind,e.retryable],['redirect',false]);
 }assert.equal(target.requests.length,0);}finally{await target.close();}
});
test('the base URL setting rejects fragments and credentials and normalizes one trailing slash',()=>{
 for(const bad of ['https://api.test/v1#secret','https://api.test/v1#','https://api.test/v1?','https://user@api.test/v1','http://localhost.example.test/v1','http://[::1]/v1'])assert.throws(()=>openAiBaseUrl({CLOUD_OPENAI_BASE_URL:bad}));
 assert.equal(openAiBaseUrl({CLOUD_OPENAI_BASE_URL:'http://localhost:4000/v1/'}),'http://localhost:4000/v1');
 assert.equal(openAiBaseUrl({CLOUD_OPENAI_BASE_URL:'https://api.test/v1/'}),'https://api.test/v1');
});

async function streaming(handler:(res:ServerResponse)=>void){
 const server=createServer((_req,res)=>handler(res));server.listen(0,'127.0.0.1');await once(server,'listening');
 const address=server.address();assert.ok(address&&typeof address!=='string');
 return {baseUrl:`http://127.0.0.1:${address.port}`,async close(){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
test('the timeout remains active after response headers arrive',async()=>{
 const fake=await streaming(res=>{res.writeHead(200,{'content-type':'application/json'});res.flushHeaders();res.write('{');});
 try{await assert.rejects(createLoopbackOpenAiClient({apiKey:'k',baseUrl:fake.baseUrl,timeoutMs:100}).respond(call),(e:unknown)=>e instanceof ProviderError&&e.kind==='timeout'&&e.retryable);}finally{await fake.close();}
});
test('a caller abort while reading the response stays a retryable network error',async()=>{
 const controller=new AbortController();
 const fake=await streaming(res=>{res.writeHead(200);res.flushHeaders();res.write('{');controller.abort();});
 try{await assert.rejects(createLoopbackOpenAiClient({apiKey:'k',baseUrl:fake.baseUrl}).respond(call,controller.signal),(e:unknown)=>e instanceof ProviderError&&e.kind==='network'&&e.retryable);}finally{await fake.close();}
});
test('the size bound cancels an unfinished response as soon as it exceeds the bound',async()=>{
 let resolveClosed!:()=>void;const closed=new Promise<void>(resolve=>{resolveClosed=resolve;});
 const fake=await streaming(res=>{res.once('close',resolveClosed);res.writeHead(200);res.write('x'.repeat(1001));});
 try{await assert.rejects(createLoopbackOpenAiClient({apiKey:'k',baseUrl:fake.baseUrl,maxResponseBytes:1000,timeoutMs:500}).respond(call),(e:unknown)=>e instanceof ProviderError&&e.kind==='malformed');await Promise.race([closed,new Promise<never>((_resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('response connection retained')),300);timer.unref();})]);}finally{await fake.close();}
});
test('a broken response stream becomes a sanitized network error',async()=>{
 const fake=await streaming(res=>{res.writeHead(200,{'content-length':'1000',connection:'close'});res.write('PRIVATE-NAME');res.end();});
 try{await assert.rejects(createLoopbackOpenAiClient({apiKey:'sk-test-key',baseUrl:fake.baseUrl,timeoutMs:500}).respond(call),(e:unknown)=>e instanceof ProviderError&&e.kind==='network'&&!e.message.includes('PRIVATE-NAME'));}finally{await fake.close();}
});
test('fake helpers accept actual assembled prompts through the HTTP client',async()=>{
 const job:ParsedJob={country:'ES',languages:{default:'ca',enabled:['es','ca','en']},houseStyle:[],items:[{ref:'product:1',kind:'product',family:'product:1',category:'Snacks',staffName:'OLIVES',existing:{},missing:['ca','es','en']}]};
 const fake=await startFakeOpenAi(r=>isReview(r)?emptyReview({input_tokens:4,output_tokens:5}):echoFirstPass(r,{input_tokens:2,output_tokens:3}));
 try{
  const client=createLoopbackOpenAiClient({apiKey:'k',baseUrl:fake.baseUrl});
  const first=await client.respond({instructions:firstPassInstructions(job),input:firstPassInput(job,job.items),effort:'low'});
  assert.deepEqual(JSON.parse(first.text),{products:[{id:'p01',ca:'OLIVES [ca]',es:'OLIVES [es]',en:'OLIVES [en]',placeholder:false,corrections:[]}]});
  assert.deepEqual([first.inputTokens,first.outputTokens],[2,3]);
  assert.deepEqual(await client.respond({instructions:reviewInstructions(job),input:reviewInput(job,job.items,checkFirstPass(job,job.items,first.text))!,effort:'medium'}),{text:'{"changes": []}',inputTokens:4,outputTokens:5});
 }finally{await fake.close();}
});
test('the fake server refuses malformed requests without an unhandled rejection',async()=>{
 const fake=await startFakeOpenAi(()=>({json:responsesBody('x')}));
 try{
  const response=await fetch(fake.baseUrl+'/responses',{method:'POST',body:'not json',signal:AbortSignal.timeout(200)});
  assert.equal(response.status,400);assert.equal(fake.requests.length,0);
 }finally{await fake.close();}
});

test('an HTTP error cancels its unread response connection',async()=>{
 let resolveClosed!:()=>void;const closed=new Promise<void>(resolve=>{resolveClosed=resolve;});
 const fake=await streaming(res=>{res.once('close',resolveClosed);res.writeHead(401);res.write('PRIVATE-NAME');});
 try{
  await assert.rejects(createLoopbackOpenAiClient({apiKey:'k',baseUrl:fake.baseUrl,timeoutMs:5000}).respond(call),(e:unknown)=>e instanceof ProviderError&&e.kind==='refused');
  await Promise.race([closed,new Promise<never>((_resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('error connection retained')),300);timer.unref();})]);
 }finally{await fake.close();}
});
test('default requests receive a 120-second timeout and explicit limits override it',async t=>{
 const requested:number[]=[],timeout=AbortSignal.timeout;
 t.mock.method(AbortSignal,'timeout',(ms:number)=>{requested.push(ms);return timeout(ms);});
 const fake=await startFakeOpenAi(()=>({json:responsesBody('x')}));
 try{
  await createLoopbackOpenAiClient({apiKey:'k',baseUrl:fake.baseUrl}).respond(call);
  await createLoopbackOpenAiClient({apiKey:'k',baseUrl:fake.baseUrl,timeoutMs:5000}).respond(call);
  assert.deepEqual(requested,[120000,5000]);
 }finally{await fake.close();}
});
test('the default response bound admits exactly 4 MiB and refuses the next byte',async()=>{
 const limit=4194304,body=responsesBody(''),overhead=Buffer.byteLength(JSON.stringify(body));let extra=0;
 const fake=await startFakeOpenAi(()=>({json:responsesBody('x'.repeat(limit-overhead+extra))}));
 try{
  const client=createLoopbackOpenAiClient({apiKey:'k',baseUrl:fake.baseUrl});
  assert.equal((await client.respond(call)).text.length,limit-overhead);extra=1;
  await assert.rejects(client.respond(call),(e:unknown)=>e instanceof ProviderError&&e.kind==='malformed');
 }finally{await fake.close();}
});
