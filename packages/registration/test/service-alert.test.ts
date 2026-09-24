import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validServiceAlert} from '../src/service-alert.ts';
import {accountMail} from '../src/account-mail.ts';
const message={email:'owner@example.test',incidentId:'11111111-1111-4111-8111-111111111111',venueId:'22222222-2222-4222-8222-222222222222',revision:1,issue:'disconnected',state:'open'};
test('service alert payloads require literal enums and bounded identities',()=>{
 assert.equal(validServiceAlert(message),true);
 for(const patch of [{issue:['disconnected']},{state:['open']},{revision:0},{revision:1.1},{venueId:'private-object/path'},{incidentId:null},{issue:'constructor'},{state:'suppressed'}])assert.equal(validServiceAlert({...message,...patch}),false);
});
for(const locale of ['en','es'] as const)test('service mail renders fixed '+locale+' incident and recovery copy',()=>{
 for(const state of ['open','recovered'] as const){
  const mail=accountMail(new URL('https://cloud.example.test'),'service_alert',{...message,issue:'disconnected',state,locale});
  assert(mail.text.includes(message.venueId));assert(mail.text.includes('https://cloud.example.test/account'));assert(!mail.text.includes('token='));assert(!mail.text.includes(message.incidentId));
  assert.match(mail.subject,locale==='es'?/local|comprobación/:/venue/);
  if(state==='recovered')assert(mail.text.includes(locale==='es'?'Contacto con Cloud':'Contact with Cloud'));
 }
});
