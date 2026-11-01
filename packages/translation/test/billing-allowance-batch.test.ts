import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createLoopbackOpenAiClient,parseJob,translateBatch,type BatchHooks,type ModelClient} from '../src/index.ts';
import {echoFirstPass,emptyReview,isReview,startFakeOpenAi,type FakeRequest,type FakeReply} from './fake-openai.ts';

// Catch provider calls escaping admission, callback retries, and reply-time trial attribution.
const job=parseJob(JSON.stringify({version:1,country:'ES',languages:{default:'es',enabled:['es','en']},
 items:[{ref:'product:1',kind:'product',family:'product:1',category:'TAPAS',staffName:'GILDAS',existing:{},missing:['es','en']}],houseStyle:[]}));
type AdmissionHooks=BatchHooks&{beforeProvider?():Promise<boolean>;attempted(attemptStartedAt?:string):Promise<void>};
function fixture(){
 const controller=new AbortController(),events:string[]=[],timestamps:(string|undefined)[]=[];
 const hooks:AdmissionHooks={mayCall:async()=>true,spent:async u=>{events.push(`spent:${u.inputTokens}/${u.outputTokens}`);},
  attempted:async at=>{timestamps.push(at);events.push('attempted');},wait:async()=>{events.push('wait');}};
 return {controller,events,timestamps,hooks,run(client:ModelClient){return translateBatch(job,job.items,client,hooks,controller.signal);}};
}
async function withProvider(handler:(request:FakeRequest)=>FakeReply|Promise<FakeReply>,run:(client:ModelClient,server:Awaited<ReturnType<typeof startFakeOpenAi>>)=>Promise<void>){
 const server=await startFakeOpenAi(handler);
 try{await run(createLoopbackOpenAiClient({apiKey:'synthetic',baseUrl:server.baseUrl,timeoutMs:1000}),server);}finally{await server.close();}
}
const success=(r:FakeRequest)=>isReview(r)?emptyReview({input_tokens:3,output_tokens:4}):echoFirstPass(r,{input_tokens:1,output_tokens:2});

test('allowance refusal makes no provider call or confirmed attempt',async()=>{
 const f=fixture();f.hooks.beforeProvider=async()=>false;
 await withProvider(success,async(client,server)=>{
  assert.deepEqual(await f.run(client),{kind:'failed',reason:'provider_unavailable'});
  assert.equal(server.requests.length,0);assert.deepEqual(f.events,[]);assert.deepEqual(f.timestamps,[]);
 });
});

for(const allowed of [false,true])test(`abort during allowance admission prevents a call after its ${allowed} reply`,async()=>{
 const f=fixture();f.hooks.beforeProvider=async()=>{await Promise.resolve();f.controller.abort();return allowed;};
 await withProvider(success,async(client,server)=>{
  assert.deepEqual(await f.run(client),{kind:'aborted'});assert.equal(server.requests.length,0);assert.deepEqual(f.events,[]);
 });
});

test('permission lost during allowance admission prevents the provider call',async()=>{
 const f=fixture();let allowed=true;f.hooks.stillPermitted=async()=>allowed;
 f.hooks.beforeProvider=async()=>{await Promise.resolve();allowed=false;return true;};
 await withProvider(success,async(client,server)=>{
  assert.deepEqual(await f.run(client),{kind:'failed',reason:'provider_unavailable'});
  assert.equal(server.requests.length,0);assert.deepEqual(f.events,[]);
 });
});

test('allowance storage failure escapes without calling or retrying the provider',async()=>{
 const f=fixture(),failure=new Error('synthetic admission storage failure');
 f.hooks.beforeProvider=async()=>{throw failure;};
 await withProvider(success,async(client,server)=>{
  await assert.rejects(f.run(client),error=>error===failure);assert.equal(server.requests.length,0);assert.deepEqual(f.events,[]);
 });
});

test('the independent money cap refuses before allowance admission',async()=>{
 const f=fixture();f.hooks.mayCall=async()=>false;f.hooks.beforeProvider=async()=>{f.events.push('admitted');return true;};
 await withProvider(success,async(client,server)=>{
  assert.deepEqual(await f.run(client),{kind:'failed',reason:'cap_reached'});assert.equal(server.requests.length,0);assert.deepEqual(f.events,[]);
 });
});

test('each retry and review is admitted before its call and accounted in the original order',async()=>{
 const f=fixture();let first=true;f.hooks.beforeProvider=async()=>{f.events.push('admitted');return true;};
 await withProvider(r=>{f.events.push('provider');if(first){first=false;return {status:503};}return success(r);},async(client,server)=>{
  assert.equal((await f.run(client)).kind,'done');assert.equal(server.requests.length,3);
  assert.deepEqual(f.events,['admitted','provider','attempted','wait','admitted','provider','spent:1/2','attempted','admitted','provider','spent:3/4','attempted']);
 });
});

for(const at of ['retry','review'] as const)test(`refusal before a ${at} preserves the previous paid attempt without another call`,async()=>{
 const f=fixture();let admissions=0;f.hooks.beforeProvider=async()=>++admissions===1;
 await withProvider(at==='retry'?()=>({status:503}):success,async(client,server)=>{
  const result=await f.run(client);
  if(at==='retry')assert.deepEqual(result,{kind:'failed',reason:'provider_unavailable'});
  else {assert.equal(result.kind,'done');if(result.kind==='done'){assert.equal(result.reviewFailed,false);assert.equal(result.results.length,1);assert.deepEqual(result.results[0]!.names,{es:'GILDAS [es]',en:'GILDAS [en]'});}}
  assert.equal(server.requests.length,1);assert.equal(f.timestamps.length,1);
  assert.deepEqual(f.events,at==='retry'?['attempted','wait']:['spent:1/2','attempted']);
 });
});

for(const reply of ['success','billed-failure','unbilled-failure'] as const)test(`a ${reply} records the call-start instant across midnight, after admission`,async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-30T23:59:58.000Z')});
 const f=fixture();let admissions=0;
 f.hooks.beforeProvider=async()=>{if(++admissions>1)return false;t.mock.timers.setTime(new Date('2026-11-30T23:59:59.000Z').getTime());return true;};
 await withProvider(r=>{
  t.mock.timers.setTime(new Date('2026-12-01T00:00:01.000Z').getTime());
  if(reply==='unbilled-failure')return {status:503};
  if(reply==='billed-failure')return {json:{status:'incomplete',usage:{input_tokens:5,output_tokens:6},output:[]}};
  return success(r);
 },async(client,server)=>{
  const result=await f.run(client);assert.equal(result.kind,reply==='success'?'done':'failed');
  assert.equal(server.requests.length,1);
  assert.deepEqual(f.timestamps,['2026-11-30T23:59:59.000Z']);
  assert.deepEqual(f.events,reply==='success'?['spent:1/2','attempted']:reply==='billed-failure'?['spent:5/6','attempted','wait']:['attempted','wait']);
 });
});

for(const hook of ['spent','attempted'] as const)test(`a ${hook} failure retains the confirmed start and never repeats the paid call`,async()=>{
 const f=fixture(),failure=new Error('synthetic callback failure');f.hooks.beforeProvider=async()=>true;
 if(hook==='spent')f.hooks.spent=async()=>{throw failure;};
 else f.hooks.attempted=async at=>{f.timestamps.push(at);throw failure;};
 await withProvider(success,async(client,server)=>{
  await assert.rejects(f.run(client),error=>error===failure);assert.equal(server.requests.length,1);
  assert.equal(f.timestamps.length,1);assert.match(f.timestamps[0]??'',/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
 });
});

test('absent allowance hook preserves the existing provider and callback sequence',async()=>{
 const f=fixture();
 await withProvider(success,async(client,server)=>{
  assert.equal((await f.run(client)).kind,'done');assert.equal(server.requests.length,2);
  assert.deepEqual(f.events,['spent:1/2','attempted','spent:3/4','attempted']);
 });
});
