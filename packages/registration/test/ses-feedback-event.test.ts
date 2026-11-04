import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {validateSesFeedbackConfig} from '../src/ses-feedback-config.ts';
import {parseSesFeedback} from '../src/ses-feedback-event.ts';
import {attemptTag,feedbackFixture,feedbackEvent,feedbackEnvelope} from './fixtures/ses-feedback.ts';

const fixture=feedbackFixture();
const config=()=>validateSesFeedbackConfig(fixture.policy,fixture.input);
const parse=(event:unknown)=>parseSesFeedback(JSON.stringify(feedbackEnvelope(event)),config());

test('one-recipient bounce returns bounded fields and a digest of the whole transport',()=>{
  const body=JSON.stringify(feedbackEnvelope());
  assert.deepEqual(parseSesFeedback(body,config()),{snsId:'sns-message-1',contentDigest:createHash('sha256').update(body).digest('hex'),
    kind:'hard_bounce',eventId:'bounce-1',eventTime:'2026-11-04T10:01:00.000Z',attemptTag,providerMessageId:'ses-message-1',recipient:'owner@example.test'});
  assert.notEqual(parseSesFeedback(body+' ',config()).contentDigest,parseSesFeedback(body,config()).contentDigest);
});

test('rejectsWrongSourceAndMultiRecipient',()=>{
  const changes:((e:any)=>void)[]=[
    e=>{e.mail.sendingAccountId='999999999999';},e=>{e.mail.sourceArn+='-wrong';},e=>{e.mail.tags['ses:configuration-set']=['wrong'];},
    e=>{e.mail.tags['ses:configuration-set'].push('transactional');},e=>{delete e.mail.tags['waitron-attempt'];},
    e=>{e.mail.tags['waitron-attempt'].push(attemptTag);},e=>{e.mail.tags['waitron-attempt']=['A'.repeat(42)+'B'];},
    e=>{e.mail.tags['waitron-attempt']=['short'];},e=>{e.mail.tags['waitron-attempt']=['AAAA'];},e=>{e.mail.destination.push('owner@example.test');},
    e=>{e.bounce.bouncedRecipients.push({emailAddress:'other@example.test'});},
    e=>{e.bounce.bouncedRecipients=[{emailAddress:'other@example.test'}];},
    e=>{e.bounce.bouncedRecipients=[];},e=>{e.mail.destination=[];},e=>{e.mail.destination='owner@example.test';},
    e=>{e.mail.destination=['not-an-address'];},e=>{e.mail.messageId='secret\nvalue';},e=>{e.mail.messageId='é';},
    e=>{e.mail.messageId='';},e=>{e.mail.messageId='a'.repeat(257);},e=>{e.bounce.feedbackId=null;},
    e=>{e.bounce.timestamp='2026-02-30T00:00:00.000Z';},e=>{e.mail.timestamp='tomorrow';},
    e=>{e.delivery={recipients:['other@example.test']};},e=>{e.complaint={complainedRecipients:[{emailAddress:'other@example.test'}]};},
    e=>{e.bounce=null;},e=>{e.eventType=4;},e=>{delete e.mail;},e=>{e.mail.tags=null;},
  ];
  for(const change of changes) {
    const event=feedbackEvent();change(event);
    assert.throws(()=>parse(event),{message:'Invalid SES feedback event'},String(change));
  }
  for(const change of [(e:any)=>{e.Type='SubscriptionConfirmation';},(e:any)=>{e.TopicArn+='-wrong';},
    (e:any)=>{e.MessageId='';},(e:any)=>{e.Timestamp='bad';},(e:any)=>{e.Message={};}]) {
    const envelope=feedbackEnvelope();change(envelope);
    assert.throws(()=>parseSesFeedback(JSON.stringify(envelope),config()),{message:'Invalid SES feedback event'});
  }
  assert.throws(()=>parseSesFeedback(JSON.stringify(feedbackEvent()),config()));
  for(const body of ['null','[]','{','"string"'])assert.throws(()=>parseSesFeedback(body,config()),{message:'Invalid SES feedback event'});
});

test('classifies known permanent, temporary, undetermined and provider-suppressed bounces separately',()=>{
  for(const [bounceType,bounceSubType,kind] of [
    ['Permanent','General','hard_bounce'],['Transient','MailboxFull','temporary'],['Undetermined','Undetermined','unclassified'],
    ['Permanent','Suppressed','provider_suppressed'],['Permanent','OnAccountSuppressionList','provider_suppressed'],
    ['Permanent','OnTenantSuppressionList','provider_suppressed'],['Permanent','EmailValidationSuppressed','provider_suppressed'],
    ['Transient','Suppressed','temporary'],['Future','Suppressed','unclassified'],
  ]) {
    const e=feedbackEvent();e.bounce.bounceType=bounceType!;e.bounce.bounceSubType=bounceSubType!;
    assert.equal(parse(e).kind,kind);
  }
});

test('delivery is server acceptance and redacted complaint leaves recipient resolution to the durable attempt',()=>{
  const base=feedbackEvent();const {bounce,...event}=base;
  assert.equal(parse({...event,eventType:'Delivery',delivery:{timestamp:bounce.timestamp,recipients:['owner@example.test']}}).kind,'delivery');
  const complaint={timestamp:bounce.timestamp,feedbackId:'complaint-1',complaintFeedbackType:'abuse'};
  assert.equal(parse({...event,eventType:'Complaint',complaint:{...complaint,complainedRecipients:[{emailAddress:'owner@example.test'}]}}).kind,'complaint');
  for(const complainedRecipients of [undefined,[],[{emailAddress:'REDACTED'}]]) {
    const redacted={...event,eventType:'Complaint',mail:{...event.mail,destination:[]},complaint:{...complaint,complainedRecipients}};
    assert.equal(parse(redacted).recipient,null);assert.equal(parse(redacted).kind,'complaint');
  }
  assert.equal(parse({...event,eventType:'Complaint',complaint:{...complaint,complaintFeedbackType:'not-spam'}}).kind,'unclassified');
  assert.equal(parse({...event,eventType:'Complaint',complaint:{...complaint,complaintSubType:'OnAccountSuppressionList'}}).kind,'provider_suppressed');
  assert.throws(()=>parse({...event,eventType:'Complaint',complaint:{...complaint,complainedRecipients:[{},{}]}}));
});

test('neverFetchesEnvelopeUrls',async t=>{
  const trap=()=>{throw new Error('network access forbidden');};
  const fetch=t.mock.method(globalThis,'fetch',trap);
  const http=await import('node:http');const https=await import('node:https');
  const traps=[t.mock.method(http.default,'request',trap),t.mock.method(http.default,'get',trap),
    t.mock.method(https.default,'request',trap),t.mock.method(https.default,'get',trap)];
  const envelope={...feedbackEnvelope(),SigningCertURL:'https://untrusted.example.test/cert',UnsubscribeURL:'https://untrusted.example.test/unsubscribe',
    SubscribeURL:'http://127.0.0.1/private',Signature:'opaque',extra:{url:'https://untrusted.example.test/'}};
  assert.equal(parseSesFeedback(JSON.stringify(envelope),config()).kind,'hard_bounce');
  assert.throws(()=>parseSesFeedback(JSON.stringify({...envelope,Type:'SubscriptionConfirmation'}),config()));
  assert.equal(fetch.mock.callCount(),0);for(const spy of traps)assert.equal(spy.mock.callCount(),0);
});

test('boundsParsingAndToleratesAddedFields',()=>{
  const envelope=feedbackEnvelope();const body=JSON.stringify(envelope);
  assert.equal(parseSesFeedback(body+' '.repeat(256*1024-Buffer.byteLength(body)),config()).kind,'hard_bounce');
  assert.throws(()=>parseSesFeedback(body+' '.repeat(256*1024-Buffer.byteLength(body)+1),config()));
  assert.throws(()=>parseSesFeedback(JSON.stringify({...envelope,Message:envelope.Message+'é'.repeat(70*1024)}),config()));
  const event=feedbackEvent();event.mail.messageId='a'.repeat(256);
  assert.equal(parse({...event,newField:{freeForm:'ignored'},mail:{...event.mail,headers:[{name:'Token',value:'never retained'}]}}).providerMessageId,'a'.repeat(256));
  const message=JSON.stringify(event);const padded=message+' '.repeat(128*1024-Buffer.byteLength(message));
  assert.equal(parseSesFeedback(JSON.stringify({...envelope,Message:padded}),config()).kind,'hard_bounce');
  assert.throws(()=>parseSesFeedback(JSON.stringify({...envelope,Message:padded+' '}),config()));
  const {bounce,...other}=event;
  assert.equal(parse({...other,eventType:'FutureEvent'}).kind,'unclassified');
  assert.equal(parse({...other,eventType:'DeliveryDelay',deliveryDelay:{timestamp:bounce.timestamp,delayedRecipients:[{emailAddress:'owner@example.test'}]}}).kind,'temporary');
});

test('rejects duplicate JSON members, excessive nesting and unvalidated configurations',()=>{
  const event=JSON.stringify(feedbackEvent());
  const duplicate=event.replace('"waitron-attempt":',`"waitron-attempt":["${attemptTag}"],"waitron-attempt":`);
  assert.throws(()=>parseSesFeedback(JSON.stringify({...feedbackEnvelope(),Message:duplicate}),config()));
  const body=JSON.stringify(feedbackEnvelope());
  assert.throws(()=>parseSesFeedback(body.replace('"Type":','"Type":"Notification","Type":'),config()));
  assert.throws(()=>parseSesFeedback(body,{...config()}));
  assert.throws(()=>parse({...feedbackEvent(),extra:JSON.parse('['.repeat(40)+'0'+']'.repeat(40))}));
});

test('malformed and undetermined classifications cannot become blocking outcomes',()=>{
  const {bounce,...base}=feedbackEvent();
  const complaint={timestamp:bounce.timestamp,feedbackId:'complaint-2'};
  for(const complaintFeedbackType of [123,['not-spam'],{}]) {
    assert.throws(()=>parse({...base,eventType:'Complaint',complaint:{...complaint,complaintFeedbackType}}),{message:'Invalid SES feedback event'});
  }
  for(const complaintFeedbackType of ['NOT-SPAM','not-spam ','future-type'])
    assert.equal(parse({...base,eventType:'Complaint',complaint:{...complaint,complaintFeedbackType}}).kind,'unclassified');
  for(const complaintFeedbackType of [undefined,'abuse','auth-failure','fraud','other','virus'])
    assert.equal(parse({...base,eventType:'Complaint',complaint:{...complaint,complaintFeedbackType}}).kind,'complaint');
  for(const bounceSubType of ['Undetermined','FutureSubtype'])
    assert.equal(parse({...base,eventType:'Bounce',bounce:{...bounce,bounceSubType}}).kind,'unclassified');
  assert.equal(parse({...base,eventType:'Bounce',bounce:{...bounce,bounceSubType:'NoEmail'}}).kind,'hard_bounce');
});

test('contradictory outcome sections refuse even when their recipients agree',()=>{
  const e=feedbackEvent();
  assert.throws(()=>parse({...e,delivery:{timestamp:e.bounce.timestamp,recipients:['owner@example.test']}}),{message:'Invalid SES feedback event'});
  assert.throws(()=>parse({...e,eventType:'Complaint',bounce:{...e.bounce,bounceType:'Transient'},
    complaint:{timestamp:e.bounce.timestamp,feedbackId:'complaint-2',complaintFeedbackType:'abuse'}}),{message:'Invalid SES feedback event'});
});

test('complaint identities and every outcome timestamp remain distinct from mail acceptance',()=>{
  const {bounce,...base}=feedbackEvent();const time='2026-11-04T10:03:00.500Z';
  const cases=[
    {eventType:'Complaint',complaint:{timestamp:time,feedbackId:'complaint-2',complaintSubType:'OnTenantSuppressionList'}},
    {eventType:'Delivery',delivery:{timestamp:time,recipients:['owner@example.test']}},
    {eventType:'DeliveryDelay',deliveryDelay:{timestamp:time,delayedRecipients:[{emailAddress:'owner@example.test'}]}},
  ];
  for(const [index,outcome] of cases.entries()) {
    const result=parse({...base,...outcome});
    assert.equal(result.eventTime,time);assert.equal(result.eventId,index===0?'complaint-2':null);
    assert.equal(result.kind,['provider_suppressed','delivery','temporary'][index]);
    const key=['complaint','delivery','deliveryDelay'][index]!;
    assert.throws(()=>parse({...base,...outcome,[key]:{...(outcome as any)[key],timestamp:'invalid'}}));
  }
  assert.throws(()=>parse({...base,eventType:'Complaint',complaint:{timestamp:time}}));
  assert.throws(()=>parse({...base,eventType:'Bounce',bounce:{...bounce,bounceSubType:undefined}}));
});

test('UTF-8 size limits reject oversized valid JSON rather than relying on malformed padding',()=>{
  assert.throws(()=>parse({...feedbackEvent(),extra:'é'.repeat(70*1024)}));
  assert.throws(()=>parseSesFeedback(JSON.stringify({...feedbackEnvelope(),extra:'é'.repeat(130*1024)}),config()));
});

test('nesting permits depth32 and refuses depth33 in both envelope and message',()=>{
  const nested=(depth:number)=>JSON.parse('['.repeat(depth)+'0'+']'.repeat(depth));
  assert.equal(parse({...feedbackEvent(),extra:nested(31)}).kind,'hard_bounce');
  assert.throws(()=>parse({...feedbackEvent(),extra:nested(32)}));
  assert.equal(parseSesFeedback(JSON.stringify({...feedbackEnvelope(),extra:nested(31)}),config()).kind,'hard_bounce');
  assert.throws(()=>parseSesFeedback(JSON.stringify({...feedbackEnvelope(),extra:nested(32)}),config()));
});
