import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createLoopbackOpenAiClient,parseJob,translateBatch,type BatchHooks} from '../src/index.ts';
import {echoFirstPass,isReview,startFakeOpenAi,type FakeReply} from './fake-openai.ts';

const job=parseJob(JSON.stringify({version:1,country:'ES',languages:{default:'es',enabled:['es']},
 items:[{ref:'product:1',kind:'product',family:'product:1',category:null,staffName:'CAFE',existing:{},missing:['es']}],houseStyle:[]}));

// An unbilled refusal still renews the lease; failed renewal must prevent another call.
for(const phase of ['first pass','review'] as const){
 for(const [name,reply] of [
  ['HTTP refusal',{status:401,raw:'private provider refusal'}],
  ['retryable server refusal',{status:503,headers:{'retry-after':'7'},raw:'private server error'}],
  ['malformed envelope',{raw:'private non-JSON response'}],
 ] as const satisfies readonly (readonly [string,FakeReply])[]){
  test(`${phase} ${name} retains a lease failure without invented usage or another call`,async()=>{
   const failure=new Error('lease storage unavailable'),events:string[]=[];
   const usage:{inputTokens:number;outputTokens:number}[]=[];
   let renewals=0;
   const target=phase==='first pass'?1:2;
   const fake=await startFakeOpenAi(request=>{
    if(phase==='review'&&!isReview(request))return echoFirstPass(request,{input_tokens:11,output_tokens:5});
    return reply;
   });
   try{
    const hooks:BatchHooks={
     async mayCall(){events.push('allow');return true;},
     async spent(tokens){events.push('spent');usage.push(tokens);},
     async attempted(){events.push('renew');if(++renewals===target)throw failure;},
     async wait(){events.push('wait');},
    };
    const client=createLoopbackOpenAiClient({apiKey:'synthetic',baseUrl:fake.baseUrl,timeoutMs:5000});
    await assert.rejects(translateBatch(job,job.items,client,hooks,new AbortController().signal),error=>error===failure);
    assert.equal(renewals,target);
    assert.deepEqual(fake.requests.map(request=>request.body.reasoning.effort),phase==='first pass'?['low']:['low','medium']);
    assert.deepEqual(usage,phase==='first pass'?[]:[{inputTokens:11,outputTokens:5}]);
    assert.deepEqual(events,phase==='first pass'?['allow','renew']:['allow','spent','renew','allow','renew']);
   }finally{await fake.close();}
  });
 }
}
