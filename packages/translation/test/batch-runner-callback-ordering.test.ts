import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {test} from 'node:test';
import {createLoopbackOpenAiClient,parseJob,translateBatch,type BatchHooks} from '../src/index.ts';
import {echoFirstPass,emptyReview,isReview,startFakeOpenAi} from './fake-openai.ts';

const job=parseJob(JSON.stringify({version:1,country:'ES',languages:{default:'es',enabled:['es']},
 items:[{ref:'product:1',kind:'product',family:'product:1',category:null,staffName:'CAFE',existing:{},missing:['es']}],houseStyle:[]}));

for(const phase of ['first pass','review'] as const)for(const held of ['spent','attempted'] as const)for(const abort of [false,true]){
 test(`${phase} waits for delayed ${held} before ${abort?'returning cancellation':'continuing'}`,async()=>{
  const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
  const controller=new AbortController(),events:string[]=[],usage:{inputTokens:number;outputTokens:number}[]=[];
  const target=phase==='first pass'?1:2;
  let spends=0,renewals=0,settled=false;
  const fake=await startFakeOpenAi(request=>isReview(request)?emptyReview({input_tokens:7,output_tokens:3}):echoFirstPass(request,{input_tokens:11,output_tokens:5}));
  const hooks:BatchHooks={
   async mayCall(){events.push('allow');return true;},
   async spent(tokens){
    usage.push(tokens);events.push('spent:start');spends++;
    if(held==='spent'&&spends===target){entered.resolve();await release.promise;}
    events.push('spent:end');
   },
   async attempted(){
    events.push('renew:start');renewals++;
    if(held==='attempted'&&renewals===target){entered.resolve();await release.promise;}
    events.push('renew:end');
   },
   async wait(){assert.fail('successful replies must not retry');},
  };
  const client=createLoopbackOpenAiClient({apiKey:'synthetic',baseUrl:fake.baseUrl,timeoutMs:5000});
  const pending=translateBatch(job,job.items,client,hooks,controller.signal).finally(()=>{settled=true;});
  const completedCall=['allow','spent:start','spent:end','renew:start','renew:end'];
  try{
   await entered.promise;
   if(abort)controller.abort();
   // Let a missing await advance through the real HTTP and promise callbacks.
   await setImmediate();await setImmediate();
   assert.equal(settled,false,'batch returned before the callback completed');
   assert.deepEqual(events,[...(target===2?completedCall:[]),'allow','spent:start',...(held==='attempted'?['spent:end','renew:start']:[])]);
   assert.equal(fake.requests.length,target,'another paid call began before the callback completed');
   assert.deepEqual(usage,target===1?[{inputTokens:11,outputTokens:5}]:[{inputTokens:11,outputTokens:5},{inputTokens:7,outputTokens:3}]);
   release.resolve();
   const result=await pending;
   if(abort){
    assert.deepEqual(result,{kind:'aborted'});
    assert.deepEqual(events,Array.from({length:target},()=>completedCall).flat());
    assert.deepEqual(fake.requests.map(request=>request.body.reasoning.effort),target===1?['low']:['low','medium']);
   }else{
    assert.deepEqual(result,{kind:'done',results:[{ref:'product:1',placeholder:false,names:{es:'CAFE [es]'},corrections:[]}],reviewApplied:0,reviewDropped:0,reviewFailed:false});
    assert.deepEqual(events,[...completedCall,...completedCall]);
    assert.deepEqual(usage,[{inputTokens:11,outputTokens:5},{inputTokens:7,outputTokens:3}]);
    assert.deepEqual(fake.requests.map(request=>request.body.reasoning.effort),['low','medium']);
   }
  }finally{release.resolve();try{await pending;}finally{await fake.close();}}
 });
}
