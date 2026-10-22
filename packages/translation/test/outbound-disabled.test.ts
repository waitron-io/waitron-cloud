import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as api from '../src/index.ts';
import {responsesBody,startFakeOpenAi} from './fake-openai.ts';

test('production denies every first pass, review and repeated call before reading input or fetching',async t=>{
 let requests=0;
 t.mock.method(globalThis,'fetch',async()=>{requests++;throw new Error('unexpected request');});
 for(const baseUrl of [undefined,'https://api.openai.com/v1','https://eu.api.openai.com/v1','http://127.0.0.1:4010/v1']){
  const client=api.createOpenAiClient({apiKey:'synthetic-private-key',baseUrl});
  for(const effort of ['low','medium','medium'] as const)for(const input of ['Croquetas','Marta 600123456, sin frutos secos']){
   await assert.rejects(client.respond({instructions:'private house style',input,effort}),(error:unknown)=>{
    assert.ok(error instanceof api.ProviderError);assert.equal(error.kind,'refused');assert.equal(error.retryable,false);assert.equal(error.usage,undefined);
    for(const secret of [input,'private house style','synthetic-private-key'])assert.equal(String(error.stack).includes(secret),false);
    return true;
   });
  }
  const unread={get input():string{throw Error('input was inspected');},get instructions():string{throw Error('instructions were inspected');},effort:'low' as const};
  await assert.rejects(client.respond(unread),(error:unknown)=>error instanceof api.ProviderError&&error.kind==='refused');
 }
 const saved={...process.env};
 try{for(const value of ['1','true']){
  process.env.CLOUD_TRANSLATION_LOCAL_PROOF=value;process.env.CLOUD_TRANSLATION='1';process.env.CLOUD_AI_ENABLED='1';
  await assert.rejects(api.createOpenAiClient({apiKey:'synthetic'}).respond({instructions:'I',input:'Croquetas',effort:'low'}),api.ProviderError);
 }}finally{process.env=saved;}
 assert.equal(requests,0);
});

test('loopback requires exact raw authority with an explicit usable port',()=>{
 assert.equal(typeof api.createLoopbackOpenAiClient,'function');
 for(const baseUrl of ['https://127.0.0.1:4010','http://localhost:4010','http://127.1:4010','http://2130706433:4010',
  'http://0177.0.0.1:4010','http://0x7f000001:4010','http://127.0.0.1','http://127.0.0.1:0','http://127.0.0.1:65536',
  'http://127.0.0.1:04010','http://user@127.0.0.1:4010','http://127.0.0.1:4010?','http://127.0.0.1:4010#',
  'http://127.0.0.1:4010/v1?key=private','http://127.0.0.1:4010/v1#private','http://[::1]:4010','http://remote.test:4010',
  ' http://127.0.0.1:4010','http://127.0.0.1:4010\n','http://127.0.0.1:4010\\@remote.test', 'HTTP://127.0.0.1:4010']){
  assert.throws(()=>api.createLoopbackOpenAiClient({apiKey:'synthetic',baseUrl}),/invalid_openai_base_url/,baseUrl);
 }
});

test('explicit loopback preserves request and response, but never follows a redirect',async()=>{
 assert.equal(typeof api.createLoopbackOpenAiClient,'function');
 const target=await startFakeOpenAi(()=>({json:responsesBody('outside')}));
 const fake=await startFakeOpenAi(r=>r.body.reasoning.effort==='medium'?{status:307,headers:{location:target.baseUrl+'/responses'}}:{json:responsesBody('synthetic')});
 try{
  const client=api.createLoopbackOpenAiClient({apiKey:'synthetic',baseUrl:fake.baseUrl+'/v1'});
  assert.deepEqual(await client.respond({instructions:'I',input:'Croquetas',effort:'low'}),{text:'synthetic',inputTokens:100,outputTokens:50});
  assert.deepEqual(fake.requests[0]!.body,{model:'gpt-6-luna',instructions:'I',input:'Croquetas',reasoning:{effort:'low'},store:false});
  assert.equal(fake.requests[0]!.path,'/v1/responses');assert.equal(fake.requests[0]!.headers.authorization,'Bearer synthetic');
  await assert.rejects(client.respond({instructions:'I',input:'Croquetas',effort:'medium'}),(e:unknown)=>e instanceof api.ProviderError&&e.kind==='redirect'&&!e.retryable);
  assert.equal(target.requests.length,0);
 }finally{await fake.close();await target.close();}
});
