import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {config} from './fixtures/mail-attempt.ts';
import {createSesRelaySender} from '../src/relay-ses-smtp.ts';
import type {RelayContent} from '../src/relay-smtp.ts';
import {tlsSmtp,smtpConfig} from './fixtures/ses-smtp.ts';
import {feedbackFixture} from './fixtures/ses-feedback.ts';
import {validateSesFeedbackConfig} from '../src/ses-feedback-config.ts';

const content=():RelayContent=>({version:1,grantId:randomUUID(),grantRevision:1,messageId:randomUUID(),class:'password_reset',recipient:'guest@example.test',locale:'en',timeZone:'Europe/Madrid',displayName:'La Plaza',token:'T'.repeat(42)+'A',expiresAt:new Date(Date.now()+60000).toISOString(),managementOrigin:'https://venue.example.test'});
const admission={attemptTag:'A'.repeat(43),configurationSet:'transactional'};
test('standalone relay authenticates verified TLS, preserves RFC ID and extracts only separate acceptance metadata',async()=>{
 const create=createSesRelaySender,smtp=await tlsSmtp();
 try{
  const send=create(config(),{...smtpConfig,port:smtp.port},{ca:smtp.cert}),body=content();
  assert.deepEqual(await send(body,admission,new AbortController().signal,{from:'office@venue.example.test',replyTo:'office@venue.example.test'}),{outcome:'accepted',providerReceipt:{provider:'ses',messageId:'ses-message-1'}});
  assert.equal(smtp.captured.length,1);
  const sent=smtp.captured[0]!;assert.equal(sent.secure,true);assert.deepEqual(sent.to,[body.recipient]);assert.equal(sent.from,smtpConfig.from);
  assert.ok(sent.raw.includes(`From: Waitron Cloud <${smtpConfig.from}>`));
  assert.ok(sent.raw.includes(`Message-ID: <${body.messageId}@mail.example.test>`));
  assert.match(sent.raw,/X-SES-CONFIGURATION-SET: transactional/i);
  assert.match(sent.raw.replace(/\r\n[ \t]+/g,' '),new RegExp(`X-SES-MESSAGE-TAGS: waitron-attempt=${admission.attemptTag}`,'i'));
  assert.ok(sent.raw.includes('Reset your Waitron password'));
  for(const invalid of [{...admission,configurationSet:'caller-selected'},{...admission,attemptTag:body.recipient}]){
   await assert.rejects(send(body,invalid,new AbortController().signal),/delivery_configuration/);
  }
  assert.equal(smtp.connections,1);
 }finally{await smtp.close();}
});

test('an admitted venue identity cannot send from another domain',async()=>{
 const {policy,input}=feedbackFixture('eu-north-1',['venue-email']);
 const senderIdentityArn='arn:aws:ses:eu-north-1:123456789012:identity/cafe.example.test';
 const smtpBindings=policy.smtpBindings.map(binding=>({...binding,venueIdentityArn:senderIdentityArn}));
 const settings=validateSesFeedbackConfig({...policy,smtpBindings},{...input,venueIdentityArn:senderIdentityArn});
 const smtp=await tlsSmtp();try{
  const send=createSesRelaySender(settings,{...smtpConfig,port:smtp.port},{ca:smtp.cert});
  await assert.rejects(send(content(),{...admission,senderIdentityArn},new AbortController().signal,
   {from:'office@sub.cafe.example.test',replyTo:'office@cafe.example.test'}),/delivery_configuration/);
  assert.equal(smtp.connections,0);
  const accepted=await send(content(),{...admission,senderIdentityArn},new AbortController().signal,
   {from:'office@cafe.example.test',replyTo:'office@cafe.example.test'});
  assert.equal(accepted.outcome,'accepted');assert.equal(smtp.connections,1);
 }finally{await smtp.close();}
});

test('relay preserves acceptance when provider ID is absent, malformed or oversized',async()=>{
 const create=createSesRelaySender;
 for(const reply of ['Ok','Ok bad id','Ok '+'x'.repeat(257)]){
  let count=0;const smtp=await tlsSmtp({onData(stream,_session,done){stream.resume();stream.on('end',()=>{count++;done(null,reply);});}});
  try{assert.deepEqual(await create(config(),{...smtpConfig,port:smtp.port},{ca:smtp.cert})(content(),admission,new AbortController().signal),{outcome:'accepted'});assert.equal(count,1);}
  finally{await smtp.close();}
 }
});

test('relay separates temporary and permanent refusal without leaking SMTP diagnostics',async()=>{
 const create=createSesRelaySender;
 for(const [responseCode,outcome] of [[451,'temporary'],[550,'refused']] as const){
  const smtp=await tlsSmtp({onRcptTo(_address,_session,done){done(Object.assign(new Error('private recipient diagnostic'),{responseCode}));}});
  try{assert.deepEqual(await create(config(),{...smtpConfig,port:smtp.port},{ca:smtp.cert})(content(),admission,new AbortController().signal),{outcome});assert.equal(smtp.captured.length,0);}
  finally{await smtp.close();}
 }
});

test('relay retains retryable configuration faults before DATA',async()=>{
 const create=createSesRelaySender,smtp=await tlsSmtp(),untrusted=await tlsSmtp();
 try{
  assert.deepEqual(await create(config(),{...smtpConfig,port:smtp.port},{ca:untrusted.cert})(content(),admission,new AbortController().signal),{outcome:'temporary'});
  assert.deepEqual(await create(config(),{...smtpConfig,port:smtp.port,password:'wrong'},{ca:smtp.cert})(content(),admission,new AbortController().signal),{outcome:'temporary'});
  assert.equal(smtp.captured.length,0);
 }finally{await smtp.close();await untrusted.close();}
});

test('relay retries a trusted TLS server that omits authentication without DATA',async()=>{
 const smtp=await tlsSmtp({disabledCommands:['AUTH'],authOptional:true});try{
  assert.deepEqual(await createSesRelaySender(config(),{...smtpConfig,port:smtp.port},{ca:smtp.cert})(content(),admission,new AbortController().signal),{outcome:'temporary'});
  assert.equal(smtp.captured.length,0);
 }finally{await smtp.close();}
});

test('relay deadlines and cancellation destroy the owned stalled socket',async()=>{
 const create=createSesRelaySender;
 for(const external of [false,true]){
  let connected!:()=>void;const ready=new Promise<void>(r=>connected=r);
  const smtp=await tlsSmtp({onConnect(){connected();}}),controller=new AbortController();
  try{
   const pending=create(config(),{...smtpConfig,port:smtp.port,timeoutMs:external?5000:100},{ca:smtp.cert})(content(),admission,controller.signal);
   if(external){await Promise.race([ready,pending.then(()=>assert.fail('send ended before the cancellation fixture connected'))]);controller.abort();}
   assert.deepEqual(await pending,{outcome:'uncertain'});
   for(let i=0;i<100&&smtp.activeConnections;i++)await delay(5);
   assert.equal(smtp.activeConnections,0);
  }finally{await smtp.close();}
 }
});

test('relay loses acknowledgement after DATA conservatively without a resend',async()=>{
 const create=createSesRelaySender;let count=0;
 const smtp=await tlsSmtp({onData(stream){stream.resume();stream.on('end',()=>{count++;smtp.destroyConnections();});}});
 try{
  assert.deepEqual(await create(config(),{...smtpConfig,port:smtp.port},{ca:smtp.cert})(content(),admission,new AbortController().signal),{outcome:'uncertain'});
  assert.equal(count,1);assert.equal(smtp.connections,1);
 }finally{await smtp.close();}
});

test('the TLS relay delivers version 2 as plain text and HTML',async()=>{
 const smtp=await tlsSmtp();
 try{
  const {token: _token,...common}=content() as Extract<RelayContent,{version:1}>;
  const body:RelayContent={...common,version:2,class:'role_membership_changed',
   facts:{change:'added',editorName:'Ana',roleName:'Night service',at:new Date().toISOString()}};
  const send=createSesRelaySender(config(),{...smtpConfig,port:smtp.port},{ca:smtp.cert});
  assert.equal((await send(body,admission,new AbortController().signal)).outcome,'accepted');
  assert.equal(smtp.captured.length,1);
  const {raw}=smtp.captured[0]!;
  assert.match(raw,/Content-Type: text\/plain/i);
  assert.match(raw,/Content-Type: text\/html/i);
  assert.match(raw,/Ana added you to Night service/);
 }finally{await smtp.close();}
});

test('the TLS relay carries a venue name and reply address with the configured sender', async t=>{
 const smtp=await tlsSmtp();t.after(()=>smtp.close());
 const send=createSesRelaySender(config(),{...smtpConfig,port:smtp.port},{ca:smtp.cert});
 const sent=await send(content(),admission,new AbortController().signal,{name:'Cafe Sol',replyTo:'office@example.test'});
 assert.equal(sent.outcome,'accepted');
 assert.equal(smtp.captured[0]!.from,smtpConfig.from);
 assert.ok(smtp.captured[0]!.raw.includes(`From: Cafe Sol <${smtpConfig.from}>`));
 assert.match(smtp.captured[0]!.raw,/^Reply-To: office@example\.test\r?$/m);
});
