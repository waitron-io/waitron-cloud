import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {config} from './fixtures/mail-attempt.ts';
import {createSesRelaySender} from '../src/relay-ses-smtp.ts';
import type {RelayContent} from '../src/relay-smtp.ts';
import {tlsSmtp,smtpConfig} from './fixtures/ses-smtp.ts';

const content=():RelayContent=>({version:1,grantId:randomUUID(),grantRevision:1,messageId:randomUUID(),class:'password_reset',recipient:'guest@example.test',locale:'en',timeZone:'Europe/Madrid',displayName:'La Plaza',token:'T'.repeat(42)+'A',expiresAt:new Date(Date.now()+60000).toISOString(),managementOrigin:'https://venue.example.test'});
const admission={attemptTag:'A'.repeat(43),configurationSet:'transactional'};
test('standalone relay authenticates verified TLS, preserves RFC ID and extracts only separate acceptance metadata',async()=>{
 const create=createSesRelaySender,smtp=await tlsSmtp();
 try{
  const send=create(config(),{...smtpConfig,port:smtp.port},{ca:smtp.cert}),body=content();
  assert.deepEqual(await send(body,admission,new AbortController().signal),{outcome:'accepted',providerReceipt:{provider:'ses',messageId:'ses-message-1'}});
  assert.equal(smtp.captured.length,1);
  const sent=smtp.captured[0]!;assert.equal(sent.secure,true);assert.deepEqual(sent.to,[body.recipient]);assert.equal(sent.from,smtpConfig.from);
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

test('relay refuses untrusted certificates and authentication failure before DATA',async()=>{
 const create=createSesRelaySender,smtp=await tlsSmtp(),untrusted=await tlsSmtp();
 try{
  assert.deepEqual(await create(config(),{...smtpConfig,port:smtp.port},{ca:untrusted.cert})(content(),admission,new AbortController().signal),{outcome:'refused'});
  assert.deepEqual(await create(config(),{...smtpConfig,port:smtp.port,password:'wrong'},{ca:smtp.cert})(content(),admission,new AbortController().signal),{outcome:'refused'});
  assert.equal(smtp.captured.length,0);
 }finally{await smtp.close();await untrusted.close();}
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
