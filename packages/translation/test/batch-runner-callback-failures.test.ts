import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createLoopbackOpenAiClient,parseJob,translateBatch,type BatchHooks} from '../src/index.ts';
import {echoFirstPass,emptyReview,isReview,responsesBody,startFakeOpenAi} from './fake-openai.ts';

const job=parseJob(JSON.stringify({version:1,country:'ES',languages:{default:'es',enabled:['es']},
 items:[{ref:'product:1',kind:'product',family:'product:1',category:null,staffName:'CAFE',existing:{},missing:['es']}],houseStyle:[]}));

for(const phase of ['first pass','review'] as const){
 for(const reply of ['valid','invalid text','incomplete'] as const){
  for(const failing of ['spending','renewal','both'] as const){
   test(`${phase} ${reply} reply retains ${failing} callback failures without another paid call`,async()=>{
    const spendError=new Error('spending unavailable'),renewError=new Error('lease unavailable');
    const events:string[]=[],usage:{inputTokens:number;outputTokens:number}[]=[];
    let checks=0,spends=0,renewals=0;
    const target=phase==='first pass'?1:2;
    const fake=await startFakeOpenAi(request=>{
     if(phase==='review'&&!isReview(request))return echoFirstPass(request,{input_tokens:2,output_tokens:1});
     if(reply==='incomplete')return {json:{...responsesBody('partial',{input_tokens:17,output_tokens:5}),status:'incomplete'}};
     if(reply==='invalid text')return {json:responsesBody('not JSON',{input_tokens:17,output_tokens:5})};
     return isReview(request)?emptyReview({input_tokens:17,output_tokens:5}):echoFirstPass(request,{input_tokens:17,output_tokens:5});
    });
    try{
     const hooks:BatchHooks={
      async mayCall(){events.push('allow');checks++;return true;},
      async spent(tokens){
       events.push('spent');usage.push(tokens);spends++;
       if(spends===target&&failing!=='renewal')throw spendError;
      },
      async attempted(){
       events.push('renew');renewals++;
       if(renewals===target&&failing!=='spending')throw renewError;
      },
      async wait(){events.push('wait');},
     };
     const client=createLoopbackOpenAiClient({apiKey:'synthetic',baseUrl:fake.baseUrl,timeoutMs:5000});
     await assert.rejects(translateBatch(job,job.items,client,hooks,new AbortController().signal),(error:unknown)=>{
      if(failing==='both'){
       assert.ok(error instanceof AggregateError);
       assert.equal(error.message,'translation_callbacks_failed');
       assert.equal(error.errors.length,2);
       assert.equal(error.errors[0],spendError);
       assert.equal(error.errors[1],renewError);
      }else assert.equal(error,failing==='spending'?spendError:renewError);
      return true;
     });
     if(phase==='first pass'){
      assert.deepEqual(events,['allow','spent','renew']);
      assert.deepEqual(usage,[{inputTokens:17,outputTokens:5}]);
      assert.deepEqual(fake.requests.map(request=>request.body.reasoning.effort),['low']);
      assert.deepEqual([checks,spends,renewals],[1,1,1]);
     }else{
      assert.deepEqual(events,['allow','spent','renew','allow','spent','renew']);
      assert.deepEqual(usage,[{inputTokens:2,outputTokens:1},{inputTokens:17,outputTokens:5}]);
      assert.deepEqual(fake.requests.map(request=>request.body.reasoning.effort),['low','medium']);
      assert.deepEqual([checks,spends,renewals],[2,2,2]);
     }
    }finally{await fake.close();}
   });
  }
 }
}
