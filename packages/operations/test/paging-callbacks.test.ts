import assert from 'node:assert/strict';
import test from 'node:test';
import {createTwilio} from '../src/paging-twilio.ts';
import {createVonage} from '../src/paging-vonage.ts';
import type {PageAttempt,TrustedEvent} from '../src/paging.ts';
import {common,notification,sid,message,call,callbackSecrets as secrets,callbackPath,callbackServer,form,signedTwilio,voice,sms} from './fake-paging.ts';

const unused:typeof fetch=async()=>{throw Error('unexpected outbound request');};
const twilio=createTwilio({...common,accountSid:sid,token:secrets.twilio,fetcher:unused});
const vonage=createVonage({...common,apiKey:secrets.apiKey,apiSecret:'synthetic',token:async()=>'unused',fetcher:unused});
const attempts:PageAttempt[]=[{...notification,provider:'twilio',text:{state:'accepted',ids:[message]},call:{state:'accepted',ids:[call]}},
 {...notification,provider:'vonage',text:{state:'accepted',ids:['sms-1']},call:{state:'accepted',ids:['call-1']}}];
const options={origin:common.origin,twilio:{provider:twilio,authToken:secrets.twilio},vonage:{provider:vonage,apiKey:secrets.apiKey,signatureSecret:secrets.vonage},attempts:()=>attempts};
const twilioFields={AccountSid:sid,CallSid:call,Digits:'1'};
async function fixture(onEvent?:(e:TrustedEvent)=>void){
 const {createPagingCallbackListener}=await import('../src/paging-callbacks.ts');
 const events:TrustedEvent[]=[];
 const server=await callbackServer(createPagingCallbackListener({...options,onEvent:onEvent??(e=>events.push(e))}));
 return {...server,events,async send(path:string,init?:RequestInit){const r=await fetch(server.url+path,init);const body=await r.text();return {status:r.status,body,type:r.headers.get('content-type')};}};
}

test('Twilio authenticates all fields and URL before emitting a bound input',async()=>{
 const f=await fixture();try{
  const path=callbackPath('twilio','input')+'?extra=one';
  const fields={...twilioFields,FutureField:' a&b=c '};
  const signed=signedTwilio(path,fields);
  const good=await f.send(path,signed);assert.equal(good.status,200);assert.equal(good.body,'<Response/>');assert.match(good.type!,/xml/);
  assert.deepEqual(f.events,[{incidentId:notification.incidentId,notificationId:notification.notificationId,event:{provider:'twilio',kind:'input',id:call,state:'input',digits:'1'}}]);
  for(const init of [signedTwilio(path,fields,'wrong'),{...signed,body:form({...fields,FutureField:'changed'})},{...signed,headers:{...signed.headers,'x-twilio-signature':'bad'}}]){
   assert.equal((await f.send(path,init)).status,403);assert.equal(f.events.length,1);
  }
  assert.equal((await f.send(path.replace('extra=one','extra=two'),signed)).status,403);assert.equal(f.events.length,1);
 }finally{await f.close();}
});

test('Twilio published signature vector validates independently of the fake signer',async()=>{
 const {verifyTwilioSignature}=await import('../src/paging-callbacks.ts');
 assert.equal(verifyTwilioSignature('https://example.com/myapp.php?foo=1&bar=2',{CallSid:'CA1234567890ABCDE',Caller:'+14158675310',Digits:'1234',From:'+14158675310',To:'+18005551212'},'12345','L/OH5YylLD5NRKLltdqwSvS0BnU='),true);
});

test('normalized repeats emit once while later states and ignored callbacks succeed',async()=>{
 const f=await fixture();try{
  const path=callbackPath('twilio','call');
  for(const status of ['ringing','in-progress','in-progress','completed','unknown']){
   assert.equal((await f.send(path,signedTwilio(path,{AccountSid:sid,CallSid:call,CallStatus:status}))).status,204);
  }
  assert.deepEqual(f.events.map(e=>e.event.state),['pending','answered','completed']);
  const input=callbackPath('vonage','input'),body=JSON.stringify({uuid:'call-1',dtmf:{digits:'1'}});
  assert.equal((await f.send(input,voice(body))).status,200);
  assert.equal((await f.send(input,voice(body,{jti:'token-2'}))).status,200);
  assert.equal(f.events.length,4);
  const ignored=await f.send(input,voice(JSON.stringify({dtmf:{timed_out:true}})));
  assert.equal(ignored.status,200);assert.equal(ignored.body,'[]');assert.equal(f.events.length,4);
 }finally{await f.close();}
});

test('recognized events bind accepted IDs to incident, notification, provider and kind',async()=>{
 const f=await fixture();try{
  for(const [path,fields] of [
   [callbackPath('twilio','input').replace(notification.incidentId,'33333333-3333-4333-8333-333333333333'),twilioFields],
   [callbackPath('twilio','input').replace(notification.notificationId,'33333333-3333-4333-8333-333333333333'),twilioFields],
   [callbackPath('twilio','input'),{...twilioFields,CallSid:'CA'+'d'.repeat(32)}],
  ] as const){assert.equal((await f.send(path,signedTwilio(path,fields))).status,403);}
  const path=callbackPath('vonage','input');
  for(const id of [call,'sms-1'])assert.equal((await f.send(path,voice(JSON.stringify({uuid:id,dtmf:{digits:'1'}})))).status,403);
  assert.deepEqual(f.events,[]);
 }finally{await f.close();}
});

test('Vonage voice authenticates JWT account and exact raw payload before accepting input',async()=>{
 const f=await fixture();try{
  const path=callbackPath('vonage','input'),body=JSON.stringify({uuid:'call-1',dtmf:{digits:'1'}});
  const valid=voice(body);
  for(const init of [
   {...valid,headers:{'content-type':'application/json'}},voice(body,{},'wrong'),voice(body,{api_key:'other'}),voice(body,{iss:'other'}),
   voice(body,{iat:'not-an-integer'}),voice(body,{jti:''}),voice(body,{payload_hash:undefined}),voice(body,{},secrets.vonage,{alg:'none',typ:'JWT'}),
   {...valid,body:body+' '},
  ]){assert.equal((await f.send(path,init)).status,403);assert.equal(f.events.length,0);}
  assert.equal((await f.send(path,valid)).status,200);assert.equal(f.events.length,1);
 }finally{await f.close();}
});

test('Vonage SMS supports signed GET and POST JSON, including sanitized field values',async()=>{
 const f=await fixture();try{
  const path=callbackPath('vonage','text'),fields={'api-key':secrets.apiKey,messageId:'sms-1',status:'delivered',timestamp:'1794360000',extra:'a&b=c'};
  const get=await f.send(path+'?'+form(sms(fields)));assert.equal(get.status,204);assert.equal(f.events.length,1);
  const postFields=sms({...fields,status:'failed'});
  assert.equal((await f.send(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(postFields)})).status,204);
  assert.deepEqual(f.events.map(e=>e.event.state),['delivered','failed']);
  for(const bad of [{...postFields,sig:'0'.repeat(64)},{...postFields,extra:'changed'},{...postFields,sig:postFields.sig+'00'},sms({...fields,'api-key':'other'})]){
   assert.equal((await f.send(path+'?'+form(bad))).status,403);assert.equal(f.events.length,2);
  }
 }finally{await f.close();}
});

test('malformed, oversized and unsupported callbacks finish without emitting',async()=>{
 const f=await fixture();try{
  const path=callbackPath('twilio','input'),valid=signedTwilio(path,twilioFields);
  for(const [target,init,want] of [
   [path,{method:'PUT'},400],[path,{method:'POST',body:'not a form'},400],
   [path,{...valid,body:valid.body+'&Digits=2'},400],
   [path+'?a=1&a=2',valid,400],
   [callbackPath('vonage','text')+'?timestamp=1',{method:'POST',headers:{'content-type':'application/json'},body:'{}'},400],
   [callbackPath('vonage','text'),{method:'POST',headers:{'content-type':'application/json'},body:'{"timestamp":1}'},400],
   [callbackPath('vonage','input'),voice('[]'),400],
   [callbackPath('vonage','input'),voice('{'),400],
   ['/unknown',valid,400],
   [path,{...valid,body:'x'.repeat(65537)},413],
  ] as [string,RequestInit,number][]){const result=await f.send(target,init);assert.equal(result.status,want);assert.doesNotMatch(result.body,/secret|token|api-key/);assert.equal(f.events.length,0);}
 }finally{await f.close();}
});

test('callback consumer failures release the event for provider retry',async()=>{
 let fail=true;const events:TrustedEvent[]=[];
 const f=await fixture(e=>{if(fail)throw Error('private exception');events.push(e);});try{
  const path=callbackPath('twilio','input'),init=signedTwilio(path,twilioFields);
  const error=await f.send(path,init);assert.equal(error.status,500);assert.doesNotMatch(error.body,/private/);assert.equal(events.length,0);
  fail=false;assert.equal((await f.send(path,init)).status,200);assert.equal(events.length,1);
 }finally{await f.close();}
});

test('listener rejects invalid provider credentials or origins before accepting requests',async()=>{
 const {createPagingCallbackListener}=await import('../src/paging-callbacks.ts');
 const base={...options,onEvent:()=>{}};
 for(const changes of [{origin:'http://cloud.example.test'},{twilio:{...base.twilio,authToken:''}},{vonage:{...base.vonage,apiKey:''}},{twilio:{...base.twilio,provider:vonage}}]){
  assert.throws(()=>createPagingCallbackListener({...base,...changes}),/paging.invalid_config/);
 }
});

// Literal vectors were signed with OpenSSL, independently of the fake callback signer.
test('independent Vonage SMS and JWT vectors reach trusted events',async()=>{
 const f=await fixture();try{
  const text=callbackPath('vonage','text');
  const fields={'api-key':secrets.apiKey,messageId:'sms-1',status:'delivered',timestamp:'1794360000',extra:'a&b=c',sig:"d1a1d2bf7c6510559d092e6ce7b954a80312e6451da1265455ba609171f56832"};
  assert.equal((await f.send(text+'?'+form(fields))).status,204);
  const input=await f.send(callbackPath('vonage','input'),{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJWb25hZ2UiLCJhcGlfa2V5Ijoic3ludGhldGljLWFwaS1rZXkiLCJpYXQiOjE3OTQzNjAwMDAsImp0aSI6Im9wZW5zc2wtdmVjdG9yIiwicGF5bG9hZF9oYXNoIjoiM2E1OTdmMjI5ZWExNGU5ZWRmOTVjNzZhODdlZThkN2Y1Y2FiZWJiYjJiNzRhNTk4YjI1YTE0Yjg4NTA1Mzk4YiJ9.qYqpxND3YyYhdjIJVeSPBVKIlC0ny93yw3aAIJGnnrc'},body:"{\"uuid\":\"call-1\",\"dtmf\":{\"digits\":\"1\"}}"});
  assert.equal(input.status,200);assert.deepEqual(f.events.map(e=>e.event.state),['delivered','input']);
 }finally{await f.close();}
});

test('SMS timestamp and query separation reject otherwise signed reports',async()=>{
 const f=await fixture();try{
  const path=callbackPath('vonage','text');
  const base={'api-key':secrets.apiKey,messageId:'sms-1',status:'delivered'};
  assert.equal((await f.send(path+'?'+form(sms(base)))).status,400);
  const body=JSON.stringify(sms({...base,timestamp:'1794360000'}));
  assert.equal((await f.send(path+'?extra=value',{method:'POST',headers:{'content-type':'application/json'},body})).status,400);
  assert.equal(f.events.length,0);
 }finally{await f.close();}
});

test('noncanonical signature encoding cannot emit an event',async()=>{
 const f=await fixture();try{
  const path=callbackPath('twilio','input'),init=signedTwilio(path,twilioFields);
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const sig=init.headers['x-twilio-signature'];
  const noncanonical=sig.slice(0,-2)+alphabet[alphabet.indexOf(sig.at(-2)!)^1]+'=';
  assert.deepEqual(Buffer.from(noncanonical,'base64'),Buffer.from(sig,'base64'));
  assert.equal((await f.send(path,{...init,headers:{...init.headers,'x-twilio-signature':noncanonical}})).status,403);
  assert.equal(f.events.length,0);
 }finally{await f.close();}
});

test('an asynchronous consumer rejection returns 500 and permits retry',async()=>{
 let fail=true;const events:TrustedEvent[]=[];
 const f=await fixture(async e=>{await Promise.resolve();if(fail)throw Error('private async failure');events.push(e);});try{
  const path=callbackPath('twilio','input'),init=signedTwilio(path,twilioFields);
  const error=await f.send(path,init);assert.equal(error.status,500);assert.doesNotMatch(error.body,/private/);assert.equal(events.length,0);
  fail=false;assert.equal((await f.send(path,init)).status,200);assert.equal(events.length,1);
 }finally{await f.close();}
});
