import assert from 'node:assert/strict';
import test from 'node:test';
import {pageDecision,sendPage,pagingMessage,type PageAttempt,type TrustedEvent} from '../src/paging.ts';
import {createTwilio} from '../src/paging-twilio.ts';
import {fakePaging,notification,common,sid,message,call} from './fake-paging.ts';
const attempt:PageAttempt={provider:'twilio',incidentId:notification.incidentId,notificationId:notification.notificationId,text:{state:'accepted',ids:[message]},call:{state:'accepted',ids:[call]}};
const event=(kind:TrustedEvent['event']['kind'],state:TrustedEvent['event']['state'],id:string,digits?:string):TrustedEvent=>({incidentId:notification.incidentId,notificationId:notification.notificationId,event:{provider:'twilio',kind,state,id,...(digits===undefined?{}:{digits})}});
test('fixed bilingual wording contains only permitted fields and exact UTC time',()=>{
 const es=pagingMessage({...notification,locale:'es',fixProposed:false},common.origin);
 assert.equal(es.text,`Alerta de Waitron Cloud: Copias de seguridad. Locales afectados: 12. Desde: 2026-11-11 01:02:03 UTC. No se propone ninguna solución. Detalles: ${common.origin}/incidents/${notification.incidentId}`);
 assert.equal(es.voice,'Alerta de Waitron Cloud: Copias de seguridad. Locales afectados: 12. Detalles enviados por SMS. Pulsa 1 para confirmar la recepción.');
 for(const bad of [{...notification,extra:'venue name'},{...notification,venues:-1},{...notification,since:'2026-02-30T00:00:00Z'},{...notification,service:'secret-host'},{...notification,locale:'fr'}])assert.throws(()=>pagingMessage(bad as typeof notification,common.origin),/paging.invalid_notification/);
 assert.throws(()=>pagingMessage(notification,'https://user:secret@cloud.example.test'),/paging.invalid_config/);
});
test('a failed text still gets its call, and only one backup is requested',async()=>{
 const fake=await fakePaging(r=>r.url.endsWith('Messages.json')?{status:403,json:{error:'refused'}}:{json:{sid:call,status:'queued'}});
 try{
  const page=await sendPage(createTwilio({...common,accountSid:sid,token:'synthetic',fetcher:fake.fetcher}),notification);
  assert.equal(fake.requests.length,2);assert.equal(page.text.state,'failed');assert.equal(page.call.state,'accepted');
  assert.deepEqual(pageDecision({notification,attempts:[page],events:[]}),{backupNeeded:true,acknowledged:false});
  assert.equal(pageDecision({notification,attempts:[page,{...attempt,provider:'vonage'}],events:[]}).backupNeeded,false);
 }finally{await fake.close();}
});
test('only a matching placed call press1 acknowledges, including the original call after backup',()=>{
 const backup={...attempt,provider:'vonage' as const};
 const input=event('input','input',call,'1');
 assert.deepEqual(pageDecision({notification,attempts:[attempt,backup],events:[input]}),{backupNeeded:false,acknowledged:true});
 for(const e of [event('input','input','wrong','1'),event('input','input',call,'11'),event('call','completed',call),event('text','delivered',message),{...input,notificationId:'wrong'},{...input,incidentId:'wrong'},{...input,event:{...input.event,provider:'vonage' as const}}]){
  assert.equal(pageDecision({notification,attempts:[attempt],events:[e]}).acknowledged,false);
 }
 assert.equal(pageDecision({notification,attempts:[{...attempt,call:{state:'failed'}}],events:[input]}).acknowledged,false);
  assert.deepEqual(pageDecision({notification,attempts:[{...attempt,call:{state:'unknown'}}],events:[input]}),{backupNeeded:true,acknowledged:false});
});
test('text settles before the call even when an unexpected provider error becomes unknown',async()=>{
 const order:string[]=[];
 const result=await sendPage({provider:'twilio',async text(){order.push('text');await Promise.resolve();order.push('text-error');throw Error('private-provider-error');},async call(){order.push('call');return {state:'accepted',ids:[call]};},readTrustedEvent(){return null;}},notification);
 assert.deepEqual(order,['text','text-error','call']);assert.deepEqual(result.text,{state:'unknown'});assert.equal(result.call.state,'accepted');
 assert.equal(pageDecision({notification,attempts:[result],events:[]}).backupNeeded,true);
});
test('unconfirmed delivery is separate per medium; unrelated and duplicate events do not create attempts',()=>{
 assert.equal(pageDecision({notification,attempts:[attempt],events:[]}).backupNeeded,false);
 assert.equal(pageDecision({notification,attempts:[attempt],events:[],unconfirmed:['text']}).backupNeeded,true);
 const delivered=event('text','delivered',message);
 assert.equal(pageDecision({notification,attempts:[attempt],events:[delivered,delivered],unconfirmed:['text']}).backupNeeded,false);
 assert.equal(pageDecision({notification,attempts:[attempt],events:[delivered],unconfirmed:['call']}).backupNeeded,true);
 assert.equal(pageDecision({notification,attempts:[{...attempt,notificationId:'wrong'}],events:[],unconfirmed:['text']}).backupNeeded,false);
 assert.equal(pageDecision({notification,attempts:[attempt],events:[event('text','failed','wrong')]}).backupNeeded,false);
});
