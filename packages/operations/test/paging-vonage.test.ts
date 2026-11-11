import assert from 'node:assert/strict';
import test from 'node:test';
import {createVonage} from '../src/paging-vonage.ts';
import {deliveryConfirmed,pageDecision,sendPage,type PageAttempt,type TrustedEvent} from '../src/paging.ts';
import {fakePaging,notification,common} from './fake-paging.ts';
const options={...common,apiKey:'synthetic-key',apiSecret:'synthetic-secret'};
const voiceId='33333333-3333-4333-8333-333333333333';
test('Vonage uses the message language for encoding and a fresh JWT for each inline NCCO call',async()=>{
 const fake=await fakePaging(r=>({json:r.url==='/sms/json'?{'message-count':'2',messages:[{status:'0','message-id':'part1'},{status:'0','message-id':'part2'}]}:{uuid:voiceId,status:'started'}}));
 try{
  let tokens=0;const p=createVonage({...options,fetcher:fake.fetcher,token:async()=>`synthetic-jwt-${++tokens}`});
  assert.deepEqual(await p.text({...notification,locale:'es'}),{state:'accepted',ids:['part1','part2']});
  await p.call(notification);await p.call({...notification,locale:'es'});assert.equal(tokens,2);
  const sms=fake.requests[0]!,form=new URLSearchParams(sms.body);
  assert.equal(sms.headers.authorization,'Basic '+Buffer.from('synthetic-key:synthetic-secret').toString('base64'));
  assert.equal(form.get('type'),'unicode');assert.equal(form.get('status-report-req'),'true');assert.equal(form.get('to'),'12025550110');assert.equal(form.get('from'),'12025550111');
  assert.ok(form.get('text')!.includes('Copias de seguridad'));assert.equal(form.get('callback'),`${common.origin}/paging/${notification.incidentId}/${notification.notificationId}/vonage/text`);
  const call=JSON.parse(fake.requests[1]!.body);assert.deepEqual(call.to,[{type:'phone',number:'12025550110'}]);assert.deepEqual(call.from,{type:'phone',number:'12025550111'});
  assert.equal(fake.requests[1]!.headers.authorization,'Bearer synthetic-jwt-1');assert.equal(fake.requests[2]!.headers.authorization,'Bearer synthetic-jwt-2');
  assert.equal(call.event_method,'POST');assert.deepEqual(call.event_url,[`${common.origin}/paging/${notification.incidentId}/${notification.notificationId}/vonage/call`]);
  assert.equal(call.ncco[0].language,'en-GB');assert.equal(JSON.parse(fake.requests[2]!.body).ncco[0].language,'es-ES');
  assert.equal(call.ncco[0].bargeIn,true,'press 1 must also be collected during the spoken prompt');assert.deepEqual(call.ncco[0].bargeInType,['dtmf']);
  assert.deepEqual(call.ncco[1],{action:'input',type:['dtmf'],dtmf:{maxDigits:1,timeOut:10},eventUrl:[`${common.origin}/paging/${notification.incidentId}/${notification.notificationId}/vonage/input`],eventMethod:'POST'});
  await p.text(notification);assert.equal(new URLSearchParams(fake.requests[3]!.body).get('type'),'text','English fixed wording uses GSM text rather than Unicode segments');
 }finally{await fake.close();}
});
test('Vonage checks returned call IDs, refusal statuses and JWT syntax',async()=>{
 let reply:unknown={};const fake=await fakePaging(()=>({json:reply}));try{
  const p=createVonage({...options,fetcher:fake.fetcher,token:async()=>'synthetic'});
  for(const [body,want] of [[{uuid:'bad?id',status:'started'},'unknown'],[{uuid:voiceId,status:'failed'},'failed']] as const){reply=body;assert.equal((await p.call(notification)).state,want);}
  const before=fake.requests.length;assert.deepEqual(await createVonage({...options,fetcher:fake.fetcher,token:async()=>'invalid JWT syntax'}).call(notification),{state:'unknown'});assert.equal(fake.requests.length,before);
 }finally{await fake.close();}
});
test('multipart acceptance requires every successful unique part; a refusal still gets its call',async()=>{
 for(const body of [ {'message-count':'2',messages:[{status:'0','message-id':'part1'},{status:'1','message-id':'part2'}]}, {'message-count':'2',messages:[{status:'0','message-id':'part1'}]}, {'message-count':'2',messages:[{status:'0','message-id':'part1'},{status:'0','message-id':'part1'}]} ]){
  const fake=await fakePaging(r=>({json:r.url==='/sms/json'?body:{uuid:voiceId,status:'started'}}));try{
   const page=await sendPage(createVonage({...options,fetcher:fake.fetcher,token:async()=>'synthetic'}),notification);
   assert.notEqual(page.text.state,'accepted');assert.equal(page.call.state,'accepted');assert.equal(fake.requests.length,2);
  }finally{await fake.close();}
 }
});
test('trusted multipart delivery needs all IDs and matching context; input needs its call identity',()=>{
 const p=createVonage({...options,fetcher:async()=>{throw Error('unused');},token:async()=>'synthetic'});
 const page:PageAttempt={provider:'vonage',incidentId:notification.incidentId,notificationId:notification.notificationId,text:{state:'accepted',ids:['part1','part2']},call:{state:'accepted',ids:[voiceId]}};
 const trusted=(id:string):TrustedEvent=>({incidentId:notification.incidentId,notificationId:notification.notificationId,event:p.readTrustedEvent('text',{'api-key':options.apiKey,messageId:id,status:'delivered'})!});
 const first=trusted('part1'),second=trusted('part2');assert.equal(deliveryConfirmed(page,'text',[first,first]),false);assert.equal(deliveryConfirmed(page,'text',[first,second]),true);
 assert.equal(deliveryConfirmed(page,'text',[first,{...second,notificationId:'wrong'}]),false);
 assert.equal(p.readTrustedEvent('text',{'api-key':'wrong',messageId:'part1',status:'delivered'}),null);
 assert.equal(p.readTrustedEvent('input',{dtmf:{digits:'1'}}),null);
 assert.deepEqual(p.readTrustedEvent('input',{uuid:voiceId,dtmf:{digits:'1'}}),{provider:'vonage',kind:'input',id:voiceId,state:'input',digits:'1'});
  assert.deepEqual(pageDecision({notification,attempts:[page],events:[{incidentId:notification.incidentId,notificationId:notification.notificationId,event:p.readTrustedEvent('input',{uuid:voiceId,dtmf:{digits:'1'}})!}]}),{backupNeeded:false,acknowledged:true});
 assert.equal(p.readTrustedEvent('call',{uuid:voiceId,status:'answered'})?.state,'answered');
 assert.equal(p.readTrustedEvent('call',{uuid:voiceId,status:'completed'})?.state,'completed');
 for(const status of ['failed','rejected','busy','timeout','unanswered','cancelled'])assert.equal(p.readTrustedEvent('call',{uuid:voiceId,status})?.state,'failed');
});
test('a refused or stalled JWT returns a redacted unknown outcome without an API request',async()=>{
 const fake=await fakePaging(()=>({json:{uuid:voiceId,status:'started'}}));try{
  for(const token of [async()=>{throw Error('private-signing-key');},()=>new Promise<string>(()=>{})]){
   const p=createVonage({...options,timeoutMs:20,fetcher:fake.fetcher,token});assert.deepEqual(await p.call(notification),{state:'unknown'});
  }
  assert.equal(fake.requests.length,0);
 }finally{await fake.close();}
});
