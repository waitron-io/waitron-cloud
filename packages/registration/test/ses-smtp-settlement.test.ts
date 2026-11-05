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
import {RelayWorker} from '../src/relay-worker.ts';
import {fixture as relayFixture} from './fixtures/relay-worker.ts';
import * as relaySes from '../src/relay-ses-smtp.ts';

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
