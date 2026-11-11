import assert from 'node:assert/strict';
import test from 'node:test';
import {createTwilio} from '../src/paging-twilio.ts';
import {fakePaging,notification,common,sid,message,call} from './fake-paging.ts';

test('Twilio sends fixed text then inline bilingual Gather with bound callback paths',async()=>{
 const fake=await fakePaging(r=>({json:{sid:r.url.endsWith('Messages.json')?message:call,status:'queued'}}));
 try{
  const p=createTwilio({...common,accountSid:sid,token:'synthetic-secret',fetcher:fake.fetcher});
  assert.deepEqual(await p.text(notification),{state:'accepted',ids:[message]});
  assert.deepEqual(await p.call({...notification,locale:'es'}),{state:'accepted',ids:[call]});
  const [sms,voice]=fake.requests;assert.equal(sms!.url,`/2010-04-01/Accounts/${sid}/Messages.json`);
  assert.equal(sms!.headers.authorization,'Basic '+Buffer.from(sid+':synthetic-secret').toString('base64'));
  const form=new URLSearchParams(sms!.body);assert.equal(form.get('To'),common.to);assert.equal(form.get('From'),common.from);
  assert.equal(form.get('Body'),`Waitron Cloud alert: Backups. Affected venues: 12. Since: 2026-11-11 01:02:03 UTC. A fix is proposed. Details: ${common.origin}/incidents/${notification.incidentId}`);
  assert.equal(form.get('StatusCallback'),`${common.origin}/paging/${notification.incidentId}/${notification.notificationId}/twilio/text`);
  const v=new URLSearchParams(voice!.body);assert.equal(v.get('StatusCallbackMethod'),'POST');assert.deepEqual(v.getAll('StatusCallbackEvent'),['answered','completed']);
  assert.match(v.get('Twiml')!,/<Gather input="dtmf" numDigits="1" timeout="10"/);assert.ok(v.get('Twiml')!.includes(`/twilio/input" method="POST"`));
  assert.ok(v.get('Twiml')!.includes('voice="Google.es-ES-Standard-A" language="es-ES"'));assert.ok(v.get('Twiml')!.includes('Pulsa 1 para confirmar la recepción.'));
  await p.call(notification);assert.ok(new URLSearchParams(fake.requests[2]!.body).get('Twiml')!.includes('voice="Google.en-GB-Standard-N" language="en-GB"'));
 }finally{await fake.close();}
});
test('provider configuration requires injected transport, HTTPS origins and a bounded request timeout',()=>{
 const c={...common,accountSid:sid,token:'synthetic',fetcher:async()=>{throw Error('unused');}};
 for(const bad of [{...c,fetcher:undefined},{...c,timeoutMs:10001},{...c,timeoutMs:0},{...c,origin:'http://cloud.example.test'},{...c,origin:'https://cloud.example.test?token=private'},{...c,to:'private number'}]){
  assert.throws(()=>createTwilio(bad as typeof c),/paging.invalid_config/);
 }
});
test('Twilio trusted readers bind account and resource kind without treating delivery as acknowledgement',()=>{
 const p=createTwilio({...common,accountSid:sid,token:'synthetic',fetcher:async()=>{throw Error('unused');}});
 assert.deepEqual(p.readTrustedEvent('text',{AccountSid:sid,MessageSid:message,MessageStatus:'delivered'}),{provider:'twilio',kind:'text',id:message,state:'delivered'});
 assert.equal(p.readTrustedEvent('text',{AccountSid:'wrong',MessageSid:message,MessageStatus:'delivered'}),null);
 assert.equal(p.readTrustedEvent('input',{AccountSid:sid,CallSid:message,Digits:'1'}),null);
 assert.deepEqual(p.readTrustedEvent('input',{AccountSid:sid,CallSid:call,Digits:'1'}),{provider:'twilio',kind:'input',id:call,state:'input',digits:'1'});
 for(const status of ['busy','failed','no-answer','canceled'])assert.equal(p.readTrustedEvent('call',{AccountSid:sid,CallSid:call,CallStatus:status})?.state,'failed');
 assert.equal(p.readTrustedEvent('call',{AccountSid:sid,CallSid:call,CallStatus:'completed'})?.state,'completed');
 assert.equal(p.readTrustedEvent('text',{AccountSid:sid,MessageSid:message,MessageStatus:'sent'})?.state,'pending');
});
test('Twilio transport refuses redirects, oversized/malformed replies and bounds time with redacted outcomes',async()=>{
 for(const reply of [{status:401,json:{error:'private-secret'}},{status:302,headers:{location:'/redirect-target'},json:{}},{json:{sid:message,status:'queued',padding:'x'.repeat(65536)}},{raw:'invalid-private-json'},{delay:100,json:{sid:message,status:'queued'}}]){
  const fake=await fakePaging(r=>r.url==='/redirect-target'?{json:{sid:message,status:'queued'}}:reply);try{
   const p=createTwilio({...common,timeoutMs:20,accountSid:sid,token:'private-secret',fetcher:fake.fetcher});
   const result=await p.text(notification);assert.equal(result.state,reply.status===401?'failed':'unknown');assert.doesNotMatch(JSON.stringify(result),/private|untrusted/);assert.equal(fake.requests.length,1);
  }finally{await fake.close();}
 }
});
