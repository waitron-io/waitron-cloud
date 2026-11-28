import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {EmailOutbox,EmailWorker} from '../src/email-outbox.ts';
import type {EmailDeliveryContext,EmailDeliveryReceipt} from '../src/email-delivery.ts';
import {SignupStore} from '../src/signup.ts';
import {fixture,config,keys} from './fixtures/mail-attempt.ts';
import {applySesFeedback} from '../src/ses-feedback-store.ts';
import {parseSesFeedback} from '../src/ses-feedback-event.ts';
import {feedbackEnvelope,feedbackEvent} from './fixtures/ses-feedback.ts';
import {EmailDeliveryError} from '../src/email-delivery.ts';
import {createLocalAccountMailer} from '../src/local-mailer.ts';
import {captured} from './fixtures/captured-mail.ts';
import {RelayWorker} from '../src/relay-worker.ts';
import {fixture as relayFixture} from './fixtures/relay-worker.ts';
import * as relaySes from '../src/relay-ses-smtp.ts';
import {createSmtpAccountMailer} from '../src/smtp-mailer.ts';
import {tlsSmtp,smtpConfig} from './fixtures/ses-smtp.ts';
import {validateSesFeedbackConfig} from '../src/ses-feedback-config.ts';
import {feedbackFixture} from './fixtures/ses-feedback.ts';
import {BillingStore} from '../src/billing-store.ts';

const outbox=new EmailOutbox({activeKeyId:'payload',keys:{payload:'77'.repeat(32)}});
const ses={config:config(),recipientKeys:keys};
function worker(pool:Awaited<ReturnType<typeof fixture>>['pool'],send:(message:unknown,context?:EmailDeliveryContext)=>Promise<EmailDeliveryReceipt>){
 return new EmailWorker(pool,outbox,{sendVerification:send,sendPasswordReset:send,sendPasswordChanged:send,sendServiceAlert:send},{ses});
}
async function enqueue(pool:Awaited<ReturnType<typeof fixture>>['pool']){
 await new SignupStore(pool,outbox).request('owner@example.test');
 return (await pool.query("SELECT id FROM email_outbox WHERE status='pending'")).rows[0].id as string;
}
async function earlyFeedback(pool:Awaited<ReturnType<typeof fixture>>['pool'],tag:string,id='ses-early'){
 const event=feedbackEvent();event.mail.tags['waitron-attempt']=[tag];event.mail.messageId=id;
 return applySesFeedback(pool,ses.config,keys,parseSesFeedback(JSON.stringify(feedbackEnvelope(event)),ses.config));
}

test('worker passes the committed admission and binds the provider ID separately from its RFC receipt',async()=>{
 const f=await fixture();try{
  const id=await enqueue(f.pool);let sends=0;
  await worker(f.pool,async(_message,context)=>{
   sends++;assert.ok(context?.ses,'SMTP did not receive the committed admission');
   const attempt=(await f.pool.query('SELECT * FROM mail_attempts')).rows[0];
   assert.equal(attempt.attempt_tag,context.ses.attemptTag);assert.equal(attempt.configuration_set,context.ses.configurationSet);
   assert.equal(attempt.recipient_refs_sealed,true);assert.equal(attempt.queue_id,id);
   return {transport:'smtp',messageId:`<${id}@mail.example.test>`,providerReceipt:{provider:'ses',messageId:'ses-receipt-1'}};
  }).runOnce();
  const row=(await f.pool.query('SELECT * FROM email_outbox')).rows[0];
  assert.equal(row.status,'sent');assert.equal(row.message_id,`<${id}@mail.example.test>`);assert.equal(row.payload,null);assert.equal(row.failures,0);assert.equal(sends,1);
  assert.equal((await f.pool.query('SELECT provider_message_id FROM mail_attempts')).rows[0].provider_message_id,'ses-receipt-1');
 }finally{await f.close();}
});

test('the pilot admits only the approved account mailbox and captures other staff mail',async()=>{
 const f=await fixture();try{
  const id=await enqueue(f.pool),staff=`staff-${randomUUID()}@example.test`;
  await new SignupStore(f.pool,outbox).request(staff);
  const send=async(_message:unknown,context?:EmailDeliveryContext):Promise<EmailDeliveryReceipt>=>{
   assert.equal(context?.deliveryId,id);assert.ok(context.ses);
   return {transport:'smtp',messageId:'<pilot@mail.example.test>',providerReceipt:{provider:'ses',messageId:'ses-pilot'}};
  };
  const captureMailer=createLocalAccountMailer({port:Number(process.env.MAILPIT_TEST_SMTP_PORT),portalOrigin:'http://localhost:3000'});
  const w=new EmailWorker(f.pool,outbox,{sendVerification:send,sendPasswordReset:send,sendPasswordChanged:send,sendServiceAlert:send},
    {ses,sesRecipient:{email:' Owner@Example.Test ',captureMailer}});
  assert.equal(await w.runOnce(),true);assert.equal(await w.runOnce(),true);assert.equal(await w.runOnce(),false);
  assert.deepEqual((await f.pool.query('SELECT queue_id,provider_message_id FROM mail_attempts')).rows,[{queue_id:id,provider_message_id:'ses-pilot'}]);
  assert.deepEqual((await f.pool.query("SELECT status FROM email_outbox")).rows,[{status:'sent'},{status:'sent'}]);
  await captured(process.env.MAILPIT_TEST_URL!,'Verify your Waitron Cloud email',staff);
 }finally{await f.close();}
});

test('account retries receive fresh admitted tags while keeping one original queue ID',async()=>{
 const f=await fixture();try{
  const id=await enqueue(f.pool),contexts:EmailDeliveryContext[]=[];
  const w=worker(f.pool,async(_message,context)=>{
   assert.ok(context?.ses);contexts.push(context);
   if(contexts.length===1)throw new EmailDeliveryError('delivery_deferred');
   return {transport:'smtp',messageId:`<${id}@mail.example.test>`,providerReceipt:{provider:'ses',messageId:'ses-second'}};
  });
  await w.runOnce();await f.pool.query('UPDATE email_outbox SET available_at=clock_timestamp()');await w.runOnce();
  assert.equal(contexts.length,2);assert.equal(contexts[0]!.deliveryId,id);assert.equal(contexts[1]!.deliveryId,id);
  assert.notEqual(contexts[0]!.ses!.attemptTag,contexts[1]!.ses!.attemptTag);
  assert.deepEqual((await f.pool.query('SELECT attempt,provider_message_id FROM mail_attempts ORDER BY attempt')).rows,[{attempt:1,provider_message_id:null},{attempt:2,provider_message_id:'ses-second'}]);
  assert.equal((await f.pool.query('SELECT status FROM email_outbox')).rows[0].status,'sent');
 }finally{await f.close();}
});

test('local-proof relay keeps its outcome contract and separate SES settlement changes only the admitted evidence',async()=>{
 const settle=(relaySes as any).settleSesRelayReceipt;
 assert.equal(typeof settle,'function','missing separate relay provider-receipt seam');
 const f=await relayFixture();try{
  const venue=await f.venue(),body=await venue.submit();
  await new RelayWorker(f.pool,{...f.config,ses}).runOnce();
  const before=await f.row(body.messageId),attempt=(await f.pool.query('SELECT * FROM mail_attempts')).rows[0];
  assert.equal(before.state,'accepted');assert.equal(attempt.purpose,'venue-email');
  const admission={attemptTag:attempt.attempt_tag,configurationSet:attempt.configuration_set};
  await settle(f.pool,admission,{outcome:'uncertain',providerReceipt:{provider:'ses',messageId:'must-not-bind'}});
  assert.equal((await f.pool.query('SELECT provider_message_id FROM mail_attempts')).rows[0].provider_message_id,null);
  await settle(f.pool,admission,{outcome:'accepted',providerReceipt:{provider:'ses',messageId:'ses-relay'}});
  assert.equal((await f.pool.query('SELECT provider_message_id FROM mail_attempts')).rows[0].provider_message_id,'ses-relay');
  assert.deepEqual(await f.row(body.messageId),before);
 }finally{await f.close();}
});

test('early feedback and conflicting acceptance metadata never resend or replace the original binding',async t=>{
 for(const providerId of ['ses-early','ses-conflict']){
  const f=await fixture();try{
   const id=await enqueue(f.pool),diagnostics:unknown[][]=[];let sends=0;
   t.mock.method(console,'error',(...args:unknown[])=>diagnostics.push(args));
   const w=worker(f.pool,async(_message,context)=>{
    sends++;assert.ok(context?.ses);assert.equal(await earlyFeedback(f.pool,context.ses.attemptTag),'applied');
    return {transport:'smtp',messageId:`<${id}@mail.example.test>`,providerReceipt:{provider:'ses',messageId:providerId}};
   });
   await assert.doesNotReject(w.runOnce());assert.equal(await w.runOnce(),false);
   const row=(await f.pool.query('SELECT * FROM email_outbox')).rows[0];
   assert.equal(row.status,'sent');assert.equal(row.failures,0);assert.equal(row.attempts,1);assert.equal(sends,1);
   assert.equal((await f.pool.query('SELECT provider_message_id FROM mail_attempts')).rows[0].provider_message_id,'ses-early');
   assert.deepEqual(diagnostics,providerId==='ses-conflict'?[['Email provider receipt conflict']]:[]);
  }finally{t.mock.restoreAll();await f.close();}
 }
});

test('late receipts enrich only their original attempt and cannot finish a replacement claim',async()=>{
 const f=await fixture();try{
  const id=await enqueue(f.pool),replacement=randomUUID();
  await worker(f.pool,async(_message,context)=>{
   assert.ok(context?.ses);
   await f.pool.query("UPDATE email_outbox SET claim_id=$2,attempts=2 WHERE id=$1",[id,replacement]);
   return {transport:'smtp',messageId:`<${id}@mail.example.test>`,providerReceipt:{provider:'ses',messageId:'ses-old'}};
  }).runOnce();
  const row=(await f.pool.query('SELECT * FROM email_outbox')).rows[0];
  assert.equal(row.status,'processing');assert.equal(row.claim_id,replacement);assert.equal(row.message_id,null);assert.ok(row.payload);
  const attempt=(await f.pool.query('SELECT * FROM mail_attempts')).rows[0];
  assert.equal(attempt.attempt,1);assert.equal(attempt.provider_message_id,'ses-old');assert.notEqual(attempt.claim_id,replacement);
 }finally{await f.close();}
});

test('malformed optional provider metadata cannot retry or erase a valid original receipt',async()=>{
 const f=await fixture();try{
  for(const providerReceipt of [{provider:'other',messageId:'id'},{provider:'ses',messageId:'x'.repeat(257)},{provider:'ses',messageId:'bad\r\nid'},{provider:'ses',messageId:'bad:id'},{}]){
   const id=await enqueue(f.pool);let sends=0;
   const w=worker(f.pool,async()=>{sends++;return {transport:'smtp',messageId:`<${id}@mail.example.test>`,providerReceipt:providerReceipt as any};});
   await w.runOnce();assert.equal(await w.runOnce(),false);
   const row=(await f.pool.query('SELECT * FROM email_outbox WHERE id=$1',[id])).rows[0];
   assert.equal(row.status,'sent');assert.equal(row.message_id,`<${id}@mail.example.test>`);assert.equal(row.failures,0);assert.equal(sends,1);
   assert.equal((await f.pool.query('SELECT provider_message_id FROM mail_attempts WHERE queue_id=$1',[id])).rows[0].provider_message_id,null);
   await f.pool.query('DELETE FROM signup_requests');
  }
 }finally{await f.close();}
});

test('provider-binding database failure leaves acceptance terminal before the worker reports failure',async()=>{
 const f=await fixture();try{
  const id=await enqueue(f.pool);let sends=0;
  await f.pool.query(`CREATE FUNCTION refuse_provider_receipt() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
   IF NEW.provider_message_id IS NOT NULL THEN RAISE EXCEPTION 'injected receipt write refusal';END IF;RETURN NEW;END$$;
   CREATE TRIGGER refuse_provider_receipt BEFORE UPDATE ON mail_attempts FOR EACH ROW EXECUTE FUNCTION refuse_provider_receipt()`);
  const w=worker(f.pool,async()=>{sends++;return {transport:'smtp',messageId:`<${id}@mail.example.test>`,providerReceipt:{provider:'ses',messageId:'ses-refused-write'}};});
  await assert.rejects(w.runOnce(),/injected receipt write refusal/);
  assert.equal(await w.runOnce(),false);assert.equal(sends,1);
  const row=(await f.pool.query('SELECT * FROM email_outbox')).rows[0];
  assert.equal(row.status,'sent');assert.equal(row.failures,0);assert.equal(row.payload,null);
  assert.equal((await f.pool.query('SELECT provider_message_id FROM mail_attempts')).rows[0].provider_message_id,null);
 }finally{await f.close();}
});

test('an unconfigured mailer cannot create provider evidence without its own admitted attempt',async()=>{
 const f=await fixture();try{
  const id=await enqueue(f.pool);
  const send=async()=>({transport:'smtp' as const,messageId:`<${id}@mail.example.test>`,providerReceipt:{provider:'ses' as const,messageId:'unadmitted'}});
  const w=new EmailWorker(f.pool,outbox,{sendVerification:send,sendPasswordReset:send,sendPasswordChanged:send,sendServiceAlert:send});
  await assert.doesNotReject(w.runOnce());
  assert.equal((await f.pool.query('SELECT status FROM email_outbox')).rows[0].status,'sent');
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_attempts')).rows[0].count,'0');
 }finally{await f.close();}
});

test('real TLS account handoff correlates early feedback and acceptance to its committed opaque tag',async()=>{
 const f=await fixture();let smtp:Awaited<ReturnType<typeof tlsSmtp>>|undefined;
 try{
  const id=await enqueue(f.pool);let received=0;
  smtp=await tlsSmtp({onData(stream,session,done){
   let raw='';stream.on('data',bytes=>raw+=bytes);stream.on('end',()=>{
    void (async()=>{
     received++;assert.equal(session.secure,true);
     const tag=/X-SES-MESSAGE-TAGS: waitron-attempt=([A-Za-z0-9_-]{43})/i.exec(raw.replace(/\r\n[ \t]+/g,' '))?.[1];
     assert.ok(tag);assert.ok(raw.includes(`Message-ID: <${id}@mail.example.test>`));
     assert.equal((await f.pool.query('SELECT attempt_tag FROM mail_attempts WHERE queue_id=$1',[id])).rows[0].attempt_tag,tag);
     assert.equal(await earlyFeedback(f.pool,tag,'ses-joint'),'applied');
    })().then(()=>done(null,'Ok ses-joint'),()=>done(new Error('fixture feedback refused')));
   });
  }});
  const mailer=createSmtpAccountMailer({...smtpConfig,port:smtp.port},{ca:smtp.cert},ses.config);
  const w=new EmailWorker(f.pool,outbox,mailer,{ses});
  await w.runOnce();assert.equal(await w.runOnce(),false);assert.equal(received,1);
  const row=(await f.pool.query('SELECT * FROM email_outbox')).rows[0];
  assert.equal(row.status,'sent');assert.equal(row.failures,0);assert.equal(row.payload,null);assert.equal(row.message_id,`<${id}@mail.example.test>`);
  assert.equal((await f.pool.query('SELECT provider_message_id FROM mail_attempts')).rows[0].provider_message_id,'ses-joint');
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_feedback_receipts')).rows[0].count,'1');
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_suppressions')).rows[0].count,'1');
 }finally{await smtp?.close();await f.close();}
});

test('relay SES settings require validated venue admission before claiming',async()=>{
 const f=await relayFixture();try{
  const account=feedbackFixture(),accountOnly=validateSesFeedbackConfig(account.policy,account.input);
  for(const binding of [undefined,{...ses,config:{...ses.config}},{...ses,config:accountOnly}]){
   assert.throws(()=>new RelayWorker(f.pool,{...f.config,ses:binding,sesSmtp:{smtp:smtpConfig}}),/relay_unavailable/);
  }
  assert.throws(()=>new RelayWorker(f.pool,{...f.config,ses,sesSmtp:{smtp:{...smtpConfig,host:'smtp.example.test'}}}),/relay_unavailable/);
 }finally{await f.close();}
});

test('real TLS relay handoff binds its provider receipt with and without early feedback',async()=>{
 for(const [withFeedback,feedbackCount] of [[false,'0'],[true,'1']] as const){
 const f=await relayFixture();let smtp:Awaited<ReturnType<typeof tlsSmtp>>|undefined;
 try{
  const venue=await f.venue(),body=await venue.submit({recipient:'owner@example.test'});let received=0;
  smtp=await tlsSmtp({onData(stream,session,done){
   let raw='';stream.on('data',bytes=>raw+=bytes);stream.on('end',()=>{
    void (async()=>{
     received++;assert.equal(session.secure,true);
     const tag=/X-SES-MESSAGE-TAGS: waitron-attempt=([A-Za-z0-9_-]{43})/i.exec(raw.replace(/\r\n[ \t]+/g,' '))?.[1];
     assert.ok(tag);assert.ok(raw.includes(`Message-ID: <${body.messageId}@mail.example.test>`));
     const attempt=(await f.pool.query('SELECT attempt_tag,recipient_refs_sealed FROM mail_attempts WHERE queue_id=$1',[body.messageId])).rows[0];
     assert.equal(attempt.attempt_tag,tag);assert.equal(attempt.recipient_refs_sealed,true);
     if(withFeedback)assert.equal(await earlyFeedback(f.pool,tag,'ses-relay-joint'),'applied');
    })().then(()=>done(null,'Ok ses-relay-joint'),()=>done(new Error('fixture feedback refused')));
   });
  }});
  const w=new RelayWorker(f.pool,{...f.config,ses,sesSmtp:{smtp:{...smtpConfig,port:smtp.port},trust:{ca:smtp.cert}}});
  assert.equal(await w.runOnce(),true);assert.equal(await w.runOnce(),false);assert.equal(received,1);
  const row=await f.row(body.messageId);assert.equal(row.state,'accepted');assert.equal(row.payload,null);assert.equal(row.attempts,1);
  assert.equal((await f.pool.query('SELECT provider_message_id FROM mail_attempts')).rows[0].provider_message_id,'ses-relay-joint');
  assert.equal((await f.pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count,'1');
  assert.equal((await f.pool.query('SELECT count(*) FROM mail_feedback_receipts')).rows[0].count,feedbackCount);
 }finally{await smtp?.close();await f.close();}
 }
});


test('venue SMTP sends directly with fresh signing and retries as Waitron after refusal or expiry',async t=>{
 for(const [label,code,venueIdentity] of [['fresh',250,true],['other account',250,false],['permanent',554,true],['temporary',451,true]] as const)await t.test(label,async()=>{
  const f=await relayFixture();let smtp:Awaited<ReturnType<typeof tlsSmtp>>|undefined;
  try{
   const venue=await f.venue(),body=await venue.submit(),token=randomUUID(),from='orders@cafe.example.test';
   const identity='arn:aws:ses:eu-north-1:123456789012:identity/cafe.example.test';
   const {id,legal_business_id:legalBusinessId}=(await f.pool.query('SELECT id,legal_business_id FROM venues WHERE organisation_id=$1',[venue.organisation])).rows[0];
   const billing=new BillingStore(f.pool),scope={organisationId:venue.organisation,legalBusinessId};
   const event=()=>({key:randomUUID(),occurredAt:new Date().toISOString(),source:{kind:'internal' as const}});
   await billing.execute(scope,event(),{type:'ensure_business'});
   await billing.transition(scope,event(),{type:'set_venue',venueId:id,expectedRevision:0,
    value:{level:'connected',connectedFrom:null,lapsedOn:null,scheduledLevel:null,scheduledOn:null}});
   await f.pool.query('UPDATE venues SET waitron_mail_from=$2,waitron_mail_dns_token=$3,waitron_mail_reply_to=$4 WHERE id=$1',[id,from,token,'reply@cafe.example.test']);
   await f.pool.query(`INSERT INTO venue_mail_signing(venue_id,organisation_id,domain,selector,public_key,ses_region,zone_id,dns_suffix,tag,verified,verified_at,ses_identity_arn)
    VALUES($1,$2,'cafe.example.test',$3,'key','eu-north-1','Z123','cloud.example.test',$4,true,clock_timestamp(),$5)`,
    [id,venue.organisation,token,randomUUID(),venueIdentity?identity:identity.replace('123456789012','999999999999')]);
   const {policy,input}=feedbackFixture('eu-north-1',['venue-email']);
   const smtpBindings=policy.smtpBindings.map(binding=>({...binding,venueIdentityArn:identity}));
   const binding=validateSesFeedbackConfig({...policy,smtpBindings},{...input,venueIdentityArn:identity});
   const deliveries:{from:string;raw:string}[]=[];
   smtp=await tlsSmtp({onData(stream,session,done){
    let raw='';stream.on('data',bytes=>raw+=bytes);stream.on('end',()=>{
     deliveries.push({from:session.envelope.mailFrom&&session.envelope.mailFrom.address||'',raw});
     if(deliveries.length===1&&code!==250)done(Object.assign(Error('fixture refusal'),{responseCode:code}));
     else done(null,'Ok ses-delivery');
    });
   }});
   const w=new RelayWorker(f.pool,{...f.config,ses:{config:binding,recipientKeys:keys},
    sesSmtp:{smtp:{...smtpConfig,port:smtp.port},trust:{ca:smtp.cert}}},'test-venue-levels');
   assert.equal(await w.runOnce(),true);assert.equal(deliveries[0]?.from,venueIdentity?from:smtpConfig.from);
   if(venueIdentity)assert.match(deliveries[0]!.raw,/^From:.*orders@cafe\.example\.test/m);
   else assert.match(deliveries[0]!.raw,/^From:.*accounts@mail\.example\.test/m);
   assert.match(deliveries[0]!.raw,/^Reply-To: reply@cafe\.example\.test/m);
   if(code===250){
    assert.equal((await f.row(body.messageId)).state,'accepted');assert.equal(await w.runOnce(),false);
    assert.deepEqual((await f.pool.query('SELECT sender_identity_arn,provider_message_id FROM mail_attempts')).rows,
     [{sender_identity_arn:venueIdentity?identity:input.identityArn,provider_message_id:'ses-delivery'}]);
    return;
   }
   assert.equal((await f.row(body.messageId)).state,'queued');assert.equal(await w.runOnce(),false);
   if(code===451)await f.pool.query("UPDATE venue_mail_signing SET verified_at=clock_timestamp()-interval '1 hour'");
   await f.pool.query('UPDATE relay_messages SET available_at=clock_timestamp() WHERE message_id=$1',[body.messageId]);
   assert.equal(await w.runOnce(),true);assert.equal((await f.row(body.messageId)).state,'accepted');
   assert.deepEqual(deliveries.map(delivery=>delivery.from),[from,smtpConfig.from]);
   const attempts=(await f.pool.query('SELECT * FROM mail_attempts ORDER BY attempt')).rows;
   assert.notEqual(attempts[0].attempt_tag,attempts[1].attempt_tag);
   assert.deepEqual(attempts.map(attempt=>attempt.sender_identity_arn),[identity,input.identityArn]);
  }finally{await smtp?.close();await f.close();}
 });
});

test('relay receipt-write failure leaves acceptance terminal without a resend',async()=>{
 const f=await relayFixture();let smtp:Awaited<ReturnType<typeof tlsSmtp>>|undefined;
 try{
  const venue=await f.venue(),body=await venue.submit();smtp=await tlsSmtp();
  await f.pool.query(`CREATE FUNCTION refuse_provider_receipt() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
   IF NEW.provider_message_id IS NOT NULL THEN RAISE EXCEPTION 'injected receipt write refusal';END IF;RETURN NEW;END$$;
   CREATE TRIGGER refuse_provider_receipt BEFORE UPDATE ON mail_attempts FOR EACH ROW EXECUTE FUNCTION refuse_provider_receipt()`);
  const w=new RelayWorker(f.pool,{...f.config,ses,sesSmtp:{smtp:{...smtpConfig,port:smtp.port},trust:{ca:smtp.cert}}});
  await assert.rejects(w.runOnce(),/injected receipt write refusal/);
  const row=await f.row(body.messageId);assert.equal(row.state,'accepted');assert.equal(row.payload,null);
  assert.equal(await w.runOnce(),false);assert.equal(smtp.captured.length,1);
 }finally{await smtp?.close();await f.close();}
});


test('relay retries a repaired SMTP credential without losing payload or doubling its reservation',async()=>{
 const f=await relayFixture();let smtp:Awaited<ReturnType<typeof tlsSmtp>>|undefined;
 try{
  const venue=await f.venue(),body=await venue.submit();smtp=await tlsSmtp();
  const configuration={...f.config,ses,sesSmtp:{smtp:{...smtpConfig,port:smtp.port,password:'wrong'},trust:{ca:smtp.cert}}};
  await new RelayWorker(f.pool,configuration).runOnce();
  const held=await f.row(body.messageId);assert.equal(held.state,'queued');assert.ok(held.payload);assert.equal(held.attempts,1);
  await f.pool.query('UPDATE relay_messages SET available_at=clock_timestamp() WHERE message_id=$1',[body.messageId]);
  const w=new RelayWorker(f.pool,{...configuration,sesSmtp:{...configuration.sesSmtp,smtp:{...configuration.sesSmtp.smtp,password:smtpConfig.password}}});
  assert.equal(await w.runOnce(),true);assert.equal(await w.runOnce(),false);
  const sent=await f.row(body.messageId);assert.equal(sent.state,'accepted');assert.equal(sent.payload,null);assert.equal(sent.attempts,2);
  const attempts=(await f.pool.query('SELECT attempt_tag,provider_message_id FROM mail_attempts ORDER BY attempt')).rows;
  assert.equal(attempts.length,2);assert.notEqual(attempts[0].attempt_tag,attempts[1].attempt_tag);
  assert.deepEqual(attempts.map(row=>row.provider_message_id),[null,'ses-message-1']);
  assert.equal((await f.pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count,'1');assert.equal(smtp.captured.length,1);
 }finally{await smtp?.close();await f.close();}
});
