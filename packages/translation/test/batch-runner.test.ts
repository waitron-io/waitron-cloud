import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createOpenAiClient,createLoopbackOpenAiClient,parseJob,translateBatch,type BatchHooks,type ModelClient} from '../src/index.ts';
import {echoFirstPass,emptyReview,isReview,responsesBody,startFakeOpenAi,type FakeReply,type FakeRequest} from './fake-openai.ts';
const job=parseJob(JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es','en']},
 items:[{ref:'product:1',kind:'product',family:'product:1',category:'BAR TAPAS',staffName:'GUILDAS',existing:{},missing:['ca','es','en']},
  {ref:'variant:2',kind:'variant',family:'product:1',category:'BAR TAPAS',staffName:'DOBLE',existing:{en:'Double'},missing:['ca','es']}],houseStyle:[]}));
const echoed=[{ca:'GUILDAS [ca]',es:'GUILDAS [es]',en:'GUILDAS [en]'},{ca:'DOBLE [ca]',es:'DOBLE [es]'}];
function hooksFor(allow:()=>boolean=()=>true){
 const waits:number[]=[],spent:number[]=[];
 const hooks:BatchHooks={mayCall:async()=>allow(),spent:async u=>{spent.push(u.inputTokens+u.outputTokens);},attempted:async()=>{},wait:async ms=>{waits.push(ms);}};
 return {waits,spent,hooks};
}
async function withFake(handler:(r:FakeRequest)=>FakeReply|Promise<FakeReply>,run:(client:ModelClient,fake:Awaited<ReturnType<typeof startFakeOpenAi>>)=>Promise<void>,timeoutMs=100){
 const fake=await startFakeOpenAi(handler);
 try{await run(createLoopbackOpenAiClient({apiKey:'k',baseUrl:fake.baseUrl,timeoutMs}),fake);}finally{await fake.close();}
}
const live=()=>new AbortController().signal;
test('a timeout, malformed JSON and a missing product each retry, then the batch succeeds',async()=>{
 const failures:FakeReply[]=[{delayMs:500,json:{}},{json:responsesBody('no json here')},{json:responsesBody('{"products":[]}')}];
 await withFake(r=>isReview(r)?emptyReview():failures.shift()??echoFirstPass(r),async(client,fake)=>{
  const {waits,hooks}=hooksFor(),outcome=await translateBatch(job,job.items,client,hooks,live());
  assert.equal(outcome.kind,'done');assert.deepEqual(waits,[2000,8000,30000]);
  assert.equal(fake.requests.filter(r=>r.body.reasoning.effort==='low').length,4);
  assert.equal(fake.requests.filter(r=>r.body.reasoning.effort==='medium').length,1);
 });
});
test('a 429 with Retry-After waits what the provider asked, then succeeds',async()=>{
 let first=true;
 await withFake(r=>{if(isReview(r))return emptyReview();if(first){first=false;return {status:429,headers:{'retry-after':'7'}};}return echoFirstPass(r);},async client=>{
  const {waits,hooks}=hooksFor();
  assert.equal((await translateBatch(job,job.items,client,hooks,live())).kind,'done');assert.deepEqual(waits,[7000]);
 });
});
for(const [name,reply] of [['timeout',{delayMs:500,json:{}}],['malformed JSON',{json:responsesBody('no json here')}],['missing product',{json:responsesBody('{"products":[]}')}],['429',{status:429}]] as [string,FakeReply][])
 test(`four ${name} replies fail the batch without a review`,async()=>{
  await withFake(()=>reply,async(client,fake)=>{
   const {waits,hooks}=hooksFor();
   assert.deepEqual(await translateBatch(job,job.items,client,hooks,live()),{kind:'failed',reason:'provider_unavailable'});
   assert.equal(fake.requests.length,4);assert.equal(fake.requests.filter(isReview).length,0);assert.deepEqual(waits,[2000,8000,30000]);
  });
 });
test('a refusal ends the pass after one call',async()=>{
 await withFake(()=>({status:401}),async(client,fake)=>{
  const {waits,hooks}=hooksFor();
  assert.deepEqual(await translateBatch(job,job.items,client,hooks,live()),{kind:'failed',reason:'provider_unavailable'});
  assert.equal(fake.requests.length,1);assert.deepEqual(waits,[]);
 });
});
test('a review that always times out keeps the first-pass names',async()=>{
 await withFake(r=>isReview(r)?{delayMs:500,json:{}}:echoFirstPass(r),async(client,fake)=>{
  const {hooks,waits}=hooksFor(),outcome=await translateBatch(job,job.items,client,hooks,live());
  assert.ok(outcome.kind==='done');assert.equal(outcome.reviewFailed,true);
  assert.deepEqual(outcome.results.map(r=>r.names),echoed);
  assert.equal(fake.requests.filter(isReview).length,4);assert.deepEqual(waits,[2000,8000,30000]);
 });
});
test('the review applies an allowed change and drops one for a language the venue entered',async()=>{
 const review={json:responsesBody(JSON.stringify({changes:[{id:'p02',language:'en',name:'Not allowed'},{id:'p02',language:'ca',name:'Doble (cervesa)'}]}))};
 await withFake(r=>isReview(r)?review:echoFirstPass(r),async client=>{
  const {hooks}=hooksFor(),outcome=await translateBatch(job,job.items,client,hooks,live());
  assert.ok(outcome.kind==='done');
  assert.deepEqual([outcome.reviewApplied,outcome.reviewDropped,outcome.reviewFailed],[1,1,false]);
  assert.deepEqual(outcome.results[1]!.names,{ca:'Doble (cervesa)',es:'DOBLE [es]'});
 });
});
test('the cap stops a batch before its first call, and skips the review once the first pass is done',async()=>{
 await withFake(r=>isReview(r)?emptyReview():echoFirstPass(r),async(client,fake)=>{
  assert.deepEqual(await translateBatch(job,job.items,client,hooksFor(()=>false).hooks,live()),{kind:'failed',reason:'cap_reached'});
  assert.equal(fake.requests.length,0);
  let calls=0;const outcome=await translateBatch(job,job.items,client,hooksFor(()=>calls++===0).hooks,live());
  assert.ok(outcome.kind==='done');assert.equal(outcome.reviewFailed,false);assert.deepEqual(outcome.results.map(r=>r.names),echoed);
  assert.equal(fake.requests.filter(isReview).length,0);
 });
});
test('tokens are counted for a reply whose text fails the check and for an incomplete reply',async()=>{
 const replies:FakeReply[]=[{json:responsesBody('no json here',{input_tokens:10,output_tokens:5})},{json:{...responsesBody('x',{input_tokens:7,output_tokens:3}),status:'incomplete'}}];
 await withFake(r=>isReview(r)?emptyReview({input_tokens:1,output_tokens:1}):replies.shift()??echoFirstPass(r,{input_tokens:2,output_tokens:2}),async client=>{
  const {spent,hooks}=hooksFor();
  assert.equal((await translateBatch(job,job.items,client,hooks,live())).kind,'done');
  assert.deepEqual(spent,[15,10,4,2]);
 });
});
test('aborting during a first-pass call returns aborted with no wait and no further call',async()=>{
 const controller=new AbortController();
 await withFake(()=>{setTimeout(()=>controller.abort(),50);return {delayMs:2000,json:responsesBody('x')};},async(client,fake)=>{
  const {waits,hooks}=hooksFor();
  assert.deepEqual(await translateBatch(job,job.items,client,hooks,controller.signal),{kind:'aborted'});
  assert.equal(fake.requests.length,1);assert.deepEqual(waits,[]);
 },5000);
});
test('aborting during the review returns aborted, not the first-pass names',async()=>{
 const controller=new AbortController();
 await withFake(r=>{if(!isReview(r))return echoFirstPass(r);setTimeout(()=>controller.abort(),50);return {delayMs:2000,json:{}};},async(client,fake)=>{
  assert.deepEqual(await translateBatch(job,job.items,client,hooksFor().hooks,controller.signal),{kind:'aborted'});
  assert.equal(fake.requests.filter(isReview).length,1);
 },5000);
});

test('every HTTP attempt renews once and records billed usage before checking text',async()=>{
 const events:string[]=[];let n=0;
 await withFake(r=>isReview(r)?emptyReview({input_tokens:3,output_tokens:4}):++n===1?{json:responsesBody('bad',{input_tokens:1,output_tokens:2})}:echoFirstPass(r,{input_tokens:5,output_tokens:6}),async client=>{
  const hooks:BatchHooks={mayCall:async()=>{events.push('allow');return true;},spent:async u=>{events.push(`spent ${u.inputTokens}/${u.outputTokens}`);},attempted:async()=>{events.push('attempted');},wait:async ms=>{events.push(`wait ${ms}`);}};
  assert.equal((await translateBatch(job,job.items,client,hooks,live())).kind,'done');
  assert.deepEqual(events,['allow','spent 1/2','attempted','wait 2000','allow','spent 5/6','attempted','allow','spent 3/4','attempted']);
 });
});
test('failed HTTP calls still renew exactly once without inventing usage',async()=>{
 await withFake(()=>({status:503}),async(client,fake)=>{
  let attempts=0;const {hooks,spent}=hooksFor();hooks.attempted=async()=>{attempts++;};
  assert.deepEqual(await translateBatch(job,job.items,client,hooks,live()),{kind:'failed',reason:'provider_unavailable'});
  assert.deepEqual([attempts,fake.requests.length,spent],[4,4,[]]);
 });
});
for(const status of [400,403,408,409,307])test(`HTTP ${status} is not retried`,async()=>{
 await withFake(()=>({status}),async(client,fake)=>{
  const {hooks,waits}=hooksFor();assert.deepEqual(await translateBatch(job,job.items,client,hooks,live()),{kind:'failed',reason:'provider_unavailable'});
  assert.equal(fake.requests.length,1);assert.deepEqual(waits,[]);
 });
});
for(const header of ['0','120'])test(`server retry hint ${header} replaces the backoff`,async()=>{
 let n=0;await withFake(r=>isReview(r)?emptyReview():++n===1?{status:503,headers:{'retry-after':header}}:echoFirstPass(r),async client=>{
  const {hooks,waits}=hooksFor();assert.equal((await translateBatch(job,job.items,client,hooks,live())).kind,'done');assert.deepEqual(waits,[header==='0'?0:60000]);
 });
});
test('the cap is checked again before a first-pass retry',async()=>{
 await withFake(()=>({status:500}),async(client,fake)=>{
  let checks=0;const {hooks}=hooksFor(()=>checks++===0);
  assert.deepEqual(await translateBatch(job,job.items,client,hooks,live()),{kind:'failed',reason:'cap_reached'});assert.equal(fake.requests.length,1);
 });
});
test('the cap skips a review retry while preserving the first-pass names',async()=>{
 await withFake(r=>isReview(r)?{status:500}:echoFirstPass(r),async(client,fake)=>{
  let checks=0;const {hooks}=hooksFor(()=>checks++<2),outcome=await translateBatch(job,job.items,client,hooks,live());
  assert.ok(outcome.kind==='done');assert.equal(outcome.reviewFailed,false);assert.deepEqual(outcome.results.map(r=>r.names),echoed);assert.equal(fake.requests.length,2);
 });
});
test('an unusable review is retried, counted and merged only when valid',async()=>{
 let n=0;await withFake(r=>!isReview(r)?echoFirstPass(r):++n===1?{json:responsesBody('{"products":[]}',{input_tokens:7,output_tokens:8})}:emptyReview({input_tokens:9,output_tokens:10}),async(client,fake)=>{
  const {hooks,spent,waits}=hooksFor(),outcome=await translateBatch(job,job.items,client,hooks,live());
  assert.ok(outcome.kind==='done');assert.equal(outcome.reviewFailed,false);assert.deepEqual(spent,[150,15,19]);assert.deepEqual(waits,[2000]);assert.equal(fake.requests.filter(isReview).length,2);
 });
});
test('a refused review keeps first-pass names and reports failed review without waiting',async()=>{
 await withFake(r=>isReview(r)?{status:401}:echoFirstPass(r),async(client,fake)=>{
  const {hooks,waits}=hooksFor(),outcome=await translateBatch(job,job.items,client,hooks,live());
  assert.ok(outcome.kind==='done');assert.equal(outcome.reviewFailed,true);assert.deepEqual(outcome.results.map(r=>r.names),echoed);assert.equal(fake.requests.length,2);assert.deepEqual(waits,[]);
 });
});
const placeholders=()=>({json:responsesBody(JSON.stringify({products:[{id:'p01',placeholder:true},{id:'p02',placeholder:true}]}))});
test('an all-placeholder batch skips review and retains corrections and original refs',async()=>{
 await withFake(()=>({json:responsesBody('{"products":[{"id":"p01","placeholder":true,"corrections":[{"field":"internal","wrong":"GUILDAS","right":"GILDAS"}]},{"id":"p02","placeholder":true}]}')}),async(client,fake)=>{
  const {hooks}=hooksFor(),outcome=await translateBatch(job,job.items,client,hooks,live());
  assert.deepEqual(outcome,{kind:'done',results:[{ref:'product:1',placeholder:true,names:{},corrections:[{field:'internal',wrong:'GUILDAS',right:'GILDAS'}]},{ref:'variant:2',placeholder:true,names:{},corrections:[]}],reviewApplied:0,reviewDropped:0,reviewFailed:false});assert.equal(fake.requests.length,1);
 });
});
test('a signal already aborted prevents cap checks and all provider calls',async()=>{
 await withFake(echoFirstPass,async(client,fake)=>{
  const controller=new AbortController();controller.abort();let checks=0;
  assert.deepEqual(await translateBatch(job,job.items,client,hooksFor(()=>{checks++;return true;}).hooks,controller.signal),{kind:'aborted'});assert.equal(checks,0);assert.equal(fake.requests.length,0);
 });
});
for(const allow of [true,false])test(`aborting during the cap hook takes priority over its ${allow} reply`,async()=>{
 await withFake(echoFirstPass,async(client,fake)=>{
  const controller=new AbortController(),{hooks}=hooksFor();hooks.mayCall=async()=>{await Promise.resolve();controller.abort();return allow;};
  assert.deepEqual(await translateBatch(job,job.items,client,hooks,controller.signal),{kind:'aborted'});assert.equal(fake.requests.length,0);
 });
});
for(const phase of ['first','review','placeholder'] as const)for(const hook of ['spent','attempted'] as const)test(`aborting in ${hook} after a successful ${phase} returns no result`,async()=>{
 const controller=new AbortController();await withFake(r=>phase==='placeholder'?placeholders():isReview(r)?emptyReview():echoFirstPass(r),async(client,fake)=>{
  const {hooks}=hooksFor();let calls=0;hooks[hook]=async()=>{if(++calls===(phase==='review'?2:1))controller.abort();};
  assert.deepEqual(await translateBatch(job,job.items,client,hooks,controller.signal),{kind:'aborted'});assert.equal(fake.requests.length,phase==='review'?2:1);
 });
});
for(const reject of [false,true])test(`aborting during retry wait${reject?' with rejection':''} stops the batch`,async()=>{
 const controller=new AbortController();await withFake(()=>({status:500}),async(client,fake)=>{
  const {hooks}=hooksFor();hooks.wait=async(_ms,signal)=>{assert.equal(signal,controller.signal);controller.abort();if(reject)throw new Error('aborted wait');};
  assert.deepEqual(await translateBatch(job,job.items,client,hooks,controller.signal),{kind:'aborted'});assert.equal(fake.requests.length,1);
 });
});
for(const hook of ['spent','attempted','wait','mayCall'] as const)test(`a ${hook} infrastructure failure escapes without retrying paid work`,async()=>{
 const error=new Error('storage unavailable');await withFake(r=>hook==='wait'?{status:500}:isReview(r)?emptyReview():echoFirstPass(r),async(client,fake)=>{
  const {hooks}=hooksFor();let attempts=0;hooks.attempted=async()=>{attempts++;};hooks[hook]=async()=>{throw error;};
  await assert.rejects(translateBatch(job,job.items,client,hooks,live()),e=>e===error);
  assert.equal(fake.requests.length,hook==='mayCall'?0:1);if(hook==='spent')assert.equal(attempts,1);
 });
});

test('spending and renewal failures are both retained without repeating the paid call',async()=>{
 const spend=new Error('spend failed'),renew=new Error('renew failed');
 await withFake(r=>echoFirstPass(r),async(client,fake)=>{
  const {hooks}=hooksFor();hooks.spent=async()=>{throw spend;};hooks.attempted=async()=>{throw renew;};
  await assert.rejects(translateBatch(job,job.items,client,hooks,live()),(e:unknown)=>{
   assert.ok(e instanceof AggregateError);assert.equal(e.message,'translation_callbacks_failed');assert.deepEqual(e.errors,[spend,renew]);return true;
  });
  assert.equal(fake.requests.length,1);
 });
});

test('the production refusal ends the batch without review, waiting or spending',async t=>{
 let requests=0,attempts=0;
 t.mock.method(globalThis,'fetch',async()=>{requests++;throw Error('must not send');});
 const {waits,spent,hooks}=hooksFor();hooks.attempted=async()=>{attempts++;};
 const outcome=await translateBatch(job,job.items,createOpenAiClient({apiKey:'synthetic'}),hooks,live());
 assert.deepEqual(outcome,{kind:'failed',reason:'provider_unavailable'});
 assert.deepEqual(waits,[]);assert.deepEqual(spent,[]);assert.equal(requests,0);assert.equal(attempts,1);
});
