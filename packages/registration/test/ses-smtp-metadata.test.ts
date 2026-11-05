import assert from 'node:assert/strict';
import {test} from 'node:test';
import {config} from './fixtures/mail-attempt.ts';
import {sesSmtpHeaders,sesProviderReceipt} from '../src/ses-smtp-metadata.ts';
import {randomUUID} from 'node:crypto';
import {createSmtpAccountMailer} from '../src/smtp-mailer.ts';
import {tlsSmtp,smtpConfig} from './fixtures/ses-smtp.ts';
import {createSesRelaySender} from '../src/relay-ses-smtp.ts';
import {feedbackFixture} from './fixtures/ses-feedback.ts';
import {validateSesFeedbackConfig} from '../src/ses-feedback-config.ts';

// Removing header validation would let a caller select a different feedback stream.
test('SES headers contain only the qualified configuration set and canonical opaque attempt',async()=>{
 const metadata={sesSmtpHeaders,sesProviderReceipt};
 assert.equal(typeof metadata.sesSmtpHeaders,'function','missing trusted SES metadata builder');
 const trusted=config(),admission={configurationSet:'transactional',attemptTag:'A'.repeat(43)};
 assert.deepEqual(metadata.sesSmtpHeaders(trusted,admission),{
  'X-SES-CONFIGURATION-SET':'transactional','X-SES-MESSAGE-TAGS':`waitron-attempt=${'A'.repeat(43)}`});
 for(const bad of [undefined,{...admission,configurationSet:'other'},{...admission,attemptTag:'B'.repeat(43)},
  {...admission,attemptTag:'owner@example.test'},{...admission,attemptTag:'A'.repeat(43)+'\r\nBcc: leak@example.test'}]){
  assert.throws(()=>metadata.sesSmtpHeaders(trusted,bad as any),/delivery_configuration/);
 }
 assert.throws(()=>metadata.sesSmtpHeaders({...trusted},admission),/delivery_configuration/);
});

test('account SES retries keep the original RFC ID and emit only fresh opaque attempt tags over verified TLS',async()=>{
 const smtp=await tlsSmtp();
 try{
  const mailer=createSmtpAccountMailer({...smtpConfig,port:smtp.port},{ca:smtp.cert},config());
  const deliveryId=randomUUID(),message={email:'owner@example.test',token:'T'.repeat(43),expiresAt:new Date(Date.now()+60000).toISOString()};
  for(const tag of ['A'.repeat(43),'C'.repeat(42)+'A']){
   const receipt=await mailer.sendVerification(message,{deliveryId,signal:new AbortController().signal,ses:{attemptTag:tag,configurationSet:'transactional'}});
   assert.deepEqual(receipt,{transport:'smtp',messageId:`<${deliveryId}@mail.example.test>`,providerReceipt:{provider:'ses',messageId:'ses-message-1'}});
   const sent=smtp.captured.at(-1)!;
   assert.equal(sent.secure,true);assert.deepEqual(sent.to,[message.email]);assert.equal(sent.from,smtpConfig.from);
   const headers=sent.raw.split('\r\n\r\n')[0]!.replace(/\r\n[ \t]+/g,' ').split('\r\n').filter(h=>/^X-SES-/i.test(h)).map(h=>h.replace(/^([^:]+)/,name=>name.toUpperCase()));
   assert.deepEqual(headers,['X-SES-CONFIGURATION-SET: transactional',`X-SES-MESSAGE-TAGS: waitron-attempt=${tag}`]);
   assert.ok(sent.raw.includes(`Message-ID: <${deliveryId}@mail.example.test>`));
  }
  assert.equal(smtp.captured.length,2);
  await assert.rejects(mailer.sendVerification(message,{deliveryId,signal:new AbortController().signal}),{code:'delivery_configuration'});
  assert.equal(smtp.connections,2);
 }finally{await smtp.close();}
});

test('direct SES hosts cannot bypass qualified handoff and mismatched resource or sender bindings refuse construction',()=>{
 for(const host of ['email-smtp.eu-north-1.amazonaws.com','email-smtp.us-east-1.amazonaws.com','EMAIL-SMTP.EU-WEST-3.AMAZONAWS.COM','email-smtp-fips.us-gov-west-1.amazonaws.com','email-smtp.eu-north-1.api.aws','email-smtp-fips.us-gov-west-1.api.aws']){
  assert.throws(()=>createSmtpAccountMailer({...smtpConfig,host}),/Invalid production mail configuration/);
 }
 const trusted=config();
 assert.throws(()=>createSmtpAccountMailer({...smtpConfig,host:trusted.smtpHost},{},{...trusted}),/Invalid production mail configuration/);
 for(const override of [{host:'smtp.example.test'},{port:587},{from:'other@example.test'}]){
  assert.throws(()=>createSmtpAccountMailer({...smtpConfig,host:trusted.smtpHost,...override},{},trusted),/Invalid production mail configuration/);
 }
 const accountOnly=feedbackFixture(),accountConfig=validateSesFeedbackConfig(accountOnly.policy,accountOnly.input);
 assert.throws(()=>createSesRelaySender(accountConfig,{...smtpConfig,host:accountConfig.smtpHost}),/Invalid production mail configuration/);
 const venueOnly=feedbackFixture('eu-north-1',['venue-email']),venueConfig=validateSesFeedbackConfig(venueOnly.policy,venueOnly.input);
 assert.throws(()=>createSmtpAccountMailer({...smtpConfig,host:venueConfig.smtpHost},{},venueConfig),/Invalid production mail configuration/);
});

test('generic SMTP hostnames outside the SES service retain their explicit transport',()=>{
 assert.doesNotThrow(()=>createSmtpAccountMailer({...smtpConfig,host:'email-smtp.example.test'}));
});

test('generic SMTP cannot silently discard an SES handoff',async()=>{
 const smtp=await tlsSmtp();try{
  const mailer=createSmtpAccountMailer({...smtpConfig,port:smtp.port},{ca:smtp.cert});
  await assert.rejects(mailer.sendPasswordChanged({email:'owner@example.test'},{deliveryId:randomUUID(),signal:new AbortController().signal,ses:{attemptTag:'A'.repeat(43),configurationSet:'transactional'}}),{code:'delivery_configuration'});
  assert.equal(smtp.connections,0);
 }finally{await smtp.close();}
});

// Parsing optional provider metadata must never turn an accepted send into a retry.
test('only bounded SES acceptance IDs produce a separate provider receipt',async()=>{
 const metadata={sesSmtpHeaders,sesProviderReceipt};
 assert.equal(typeof metadata.sesProviderReceipt,'function','missing bounded SES receipt parser');
 assert.deepEqual(metadata.sesProviderReceipt('250 Ok ses-message-1'),{provider:'ses',messageId:'ses-message-1'});
 assert.deepEqual(metadata.sesProviderReceipt('250 Ok '+'p'.repeat(256)),{provider:'ses',messageId:'p'.repeat(256)});
 for(const raw of [undefined,null,{},250,'250 Ok','250 Ok '+'p'.repeat(257),'250 Ok bad id','250 Ok id\r\nsecret',
  '250 queued id','451 Ok id','250 Ok <id>','250 Ok '+'x'.repeat(65536)])assert.equal(metadata.sesProviderReceipt(raw),undefined);
});
