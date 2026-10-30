import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {test} from 'node:test';
import {createLoopbackOpenAiClient,parseJob,translateBatch,type BatchHooks} from '../src/index.ts';
import {echoFirstPass,emptyReview,isReview,startFakeOpenAi} from './fake-openai.ts';

const job=parseJob(JSON.stringify({version:1,country:'ES',languages:{default:'es',enabled:['es']},
 items:[{ref:'product:1',kind:'product',family:'product:1',category:null,staffName:'CAFE',existing:{},missing:['es']}],houseStyle:[]}));
const profiles=[
 {name:'zero, padded seconds and a future date',headers:['0','0003','Tue, 01 Jan 2030 00:00:05 GMT'],waits:[0,3000,5000]},
 {name:'invalid fractional, negative and missing headers',headers:['1.5','-3',undefined],waits:[2000,8000,30000]},
 {name:'capped seconds, a capped date and a past date',headers:['120','Tue, 01 Jan 2030 00:02:00 GMT','Mon, 31 Dec 2029 23:59:59 GMT'],waits:[60000,60000,0]},
] as const;
function gate(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}

// Losing parsed waits, treating zero as absent, or bypassing a pause must change observable call order.
for(const phase of ['first pass','review'] as const)for(const profile of profiles)for(const ending of ['recover','exhaust'] as const){
 test(`${phase} HTTP retries use ${profile.name} then ${ending}`,{timeout:5000},async t=>{
  t.mock.method(Date,'now',()=>1893456000000);
  const entered=[gate(),gate(),gate()],pauses=[gate(),gate(),gate()];
  const controller=new AbortController(),usage:{inputTokens:number;outputTokens:number}[]=[],waits:number[]=[];
  let targetCalls=0,allowed=0,renewed=0,settled=false;
  const prior=phase==='review'?1:0;
  const fake=await startFakeOpenAi(request=>{
   if(isReview(request)===(phase==='review')){
    const index=targetCalls++;
    if(index<3||ending==='exhaust'){
     const header=profile.headers[index];
     return {status:index%2===0?429:503,headers:header===undefined?{}:{'retry-after':header},
      raw:'PRIVATE PROVIDER BODY {"usage":{"input_tokens":999,"output_tokens":999}}'};
    }
   }
   return isReview(request)?emptyReview({input_tokens:7,output_tokens:3}):echoFirstPass(request,{input_tokens:11,output_tokens:5});
  });
  const hooks:BatchHooks={
   async mayCall(){allowed++;return true;},
   async spent(tokens){usage.push(tokens);},
   async attempted(){renewed++;},
   async wait(ms,signal){
    assert.equal(signal,controller.signal);
    const index=waits.length;waits.push(ms);assert.ok(index<3,'a fourth retry pause was scheduled');
    entered[index]!.release();await pauses[index]!.promise;
   },
  };
  const client=createLoopbackOpenAiClient({apiKey:'synthetic',baseUrl:fake.baseUrl,timeoutMs:3000});
  const pending=translateBatch(job,job.items,client,hooks,controller.signal).finally(()=>{settled=true;});
  try{
   for(let i=0;i<3;i++){
    await entered[i]!.promise;await setImmediate();await setImmediate();
    assert.equal(settled,false,'batch returned before the retry wait finished');
    assert.deepEqual(waits,profile.waits.slice(0,i+1));
    assert.equal(allowed,prior+i+1,'another call was admitted during the wait');
    assert.equal(fake.requests.length,prior+i+1,'another request started during the wait');
    assert.equal(renewed,prior+i+1,'the refused attempt did not finish its lease callback');
    assert.deepEqual(usage,prior?[{inputTokens:11,outputTokens:5}]:[],'HTTP refusals invented billed usage');
    pauses[i]!.release();
   }
   const outcome=await pending;
   if(ending==='exhaust'&&phase==='first pass')assert.deepEqual(outcome,{kind:'failed',reason:'provider_unavailable'});
   else assert.deepEqual(outcome,{kind:'done',results:[{ref:'product:1',placeholder:false,names:{es:'CAFE [es]'},corrections:[]}],
    reviewApplied:0,reviewDropped:0,reviewFailed:ending==='exhaust'});
   assert.equal(targetCalls,4,'retry exhaustion admitted an extra provider attempt');
   const efforts=phase==='review'?['low','medium','medium','medium','medium']:['low','low','low','low',...(ending==='recover'?['medium']:[])];
   assert.deepEqual(fake.requests.map(request=>request.body.reasoning.effort),efforts);
   assert.equal(allowed,efforts.length);assert.equal(renewed,efforts.length);
   assert.deepEqual(waits,profile.waits);
   assert.deepEqual(usage,ending==='recover'?[{inputTokens:11,outputTokens:5},{inputTokens:7,outputTokens:3}]:prior?[{inputTokens:11,outputTokens:5}]:[]);
  }finally{controller.abort();for(const pause of pauses)pause.release();await pending.catch(()=>{});await fake.close();}
 });
}
