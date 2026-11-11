import assert from 'node:assert/strict';
import test from 'node:test';
import {createTwilio} from '../src/paging-twilio.ts';
import {createVonage} from '../src/paging-vonage.ts';
import {createPagingCallbackListener} from '../src/paging-callbacks.ts';
import {sendPage,pageDecision,deliveryConfirmed,type PageAttempt,type TrustedEvent} from '../src/paging.ts';
import {fakePaging,notification,common,sid,message,call,callbackSecrets as secrets,callbackServer,signedTwilio,voice,sms,form} from './fake-paging.ts';

for(const name of ['twilio','vonage'] as const)test(`${name} fake sends reach signed delivery and press-1 acknowledgement`,async()=>{
 const fake=await fakePaging(r=>({json:name==='twilio'?{sid:r.url.endsWith('Messages.json')?message:call,status:'queued'}:
  r.url==='/sms/json'?{'message-count':'1',messages:[{status:'0','message-id':'sms-1'}]}:{uuid:'call-1',status:'started'}}));
 let listener:Awaited<ReturnType<typeof callbackServer>>|undefined;
 try{
  const twilio=createTwilio({...common,accountSid:sid,token:secrets.twilio,fetcher:fake.fetcher});
  const vonage=createVonage({...common,apiKey:secrets.apiKey,apiSecret:'synthetic',token:async()=>'synthetic-token',fetcher:fake.fetcher});
  const attempts:PageAttempt[]=[],events:TrustedEvent[]=[];
  listener=await callbackServer(createPagingCallbackListener({origin:common.origin,twilio:{provider:twilio,authToken:secrets.twilio},
   vonage:{provider:vonage,apiKey:secrets.apiKey,signatureSecret:secrets.vonage},attempts:()=>attempts,onEvent:e=>events.push(e)}));
  const attempt=await sendPage(name==='twilio'?twilio:vonage,notification);attempts.push(attempt);
  assert.equal(pageDecision({notification,attempts,events}).acknowledged,false);
  const [text,callRequest]=fake.requests;
  assert.ok(text);assert.ok(callRequest);
  const textFields=new URLSearchParams(text.body);
  const textUrl=new URL(textFields.get(name==='twilio'?'StatusCallback':'callback')!);
  const callFields=name==='twilio'?new URLSearchParams(callRequest.body):null;
  const callJson=name==='vonage'?JSON.parse(callRequest.body):null;
  const callUrl=new URL(name==='twilio'?callFields!.get('StatusCallback')!:callJson.event_url[0]);
  const inputUrl=new URL(name==='twilio'?/<Gather[^>]*action="([^"]+)"/.exec(callFields!.get('Twiml')!)![1]!:callJson.ncco[1].eventUrl[0]);
  const submit=async(url:URL,init?:RequestInit)=>{const response=await fetch(listener!.url+url.pathname+url.search,init);await response.text();return response.status;};
  if(name==='twilio'){
   assert.equal(await submit(textUrl,signedTwilio(textUrl.pathname,{AccountSid:sid,MessageSid:message,MessageStatus:'delivered'})),204);
   assert.equal(await submit(callUrl,signedTwilio(callUrl.pathname,{AccountSid:sid,CallSid:call,CallStatus:'in-progress'})),204);
   const good=signedTwilio(inputUrl.pathname,{AccountSid:sid,CallSid:call,Digits:'1'});
   assert.equal(await submit(inputUrl,{...good,body:form({AccountSid:sid,CallSid:call,Digits:'2'})}),403);
   assert.equal(pageDecision({notification,attempts,events}).acknowledged,false);
   assert.equal(await submit(inputUrl,good),200);
  }else{
   textUrl.search=form(sms({'api-key':secrets.apiKey,messageId:'sms-1',status:'delivered',timestamp:'1794360000'}));
   assert.equal(await submit(textUrl),204);
   assert.equal(await submit(callUrl,voice(JSON.stringify({uuid:'call-1',status:'answered'}))),204);
   assert.equal(await submit(inputUrl,voice(JSON.stringify({uuid:'call-1',dtmf:{digits:'1'}}))),200);
  }
  assert.equal(deliveryConfirmed(attempt,'text',events),true);
  assert.equal(deliveryConfirmed(attempt,'call',events),true);
  assert.deepEqual(pageDecision({notification,attempts,events}),{backupNeeded:false,acknowledged:true});
 }finally{await listener?.close();await fake.close();}
});
