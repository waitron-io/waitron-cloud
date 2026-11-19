import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validServiceAlert} from '../src/service-alert.ts';
import {accountMail} from '../src/account-mail.ts';
const message={email:'owner@example.test',incidentId:'11111111-1111-4111-8111-111111111111',venueId:'22222222-2222-4222-8222-222222222222',revision:1,issue:'disconnected',state:'open'};
test('service alert payloads require literal enums and bounded identities',()=>{
 assert.equal(validServiceAlert(message),true);
 for(const patch of [{issue:['disconnected']},{state:['open']},{revision:0},{revision:1.1},{venueId:'private-object/path'},{incidentId:null},{issue:'constructor'},{state:'suppressed'},{checkedAt:'today'},{failure:'timeout'}])assert.equal(validServiceAlert({...message,...patch}),false);
});
for(const locale of ['en','es'] as const)test('service mail renders fixed '+locale+' incident and recovery copy',()=>{
 for(const state of ['open','recovered'] as const){
  const mail=accountMail(new URL('https://cloud.example.test'),'service_alert',{...message,issue:'disconnected',state,locale});
  assert(mail.text.includes(message.venueId));assert(mail.text.includes('https://cloud.example.test/account'));assert(!mail.text.includes('token='));assert(!mail.text.includes(message.incidentId));
  assert.match(mail.subject,locale==='es'?/local|comprobación/:/venue/);
  if(state==='recovered')assert(mail.text.includes(locale==='es'?'Contacto con Cloud':'Contact with Cloud'));
  assert(mail.text.includes(locale==='es'?'En Cloud, abre Locales para consultar el estado actual de los servicios.':'In Cloud, open Venues to check current service status.'));
 }
});

const checkedAt='2026-09-25T12:00:00.000Z',certificateNotAfter='2026-10-01T12:00:00.000Z';
const remote=[
 ['public_route_failed',{checkedAt}],['staff_route_failed',{checkedAt}],['public_probe_stale',{checkedAt}],['staff_probe_stale',{}],
] as const;
for(const [issue,evidence] of remote)test(`${issue} payload and bilingual mail expose only bounded evidence`,()=>{
 const alert={...message,issue,...evidence};assert.equal(validServiceAlert(alert),true);
 for(const locale of ['en','es'] as const)for(const state of ['open','recovered'] as const){
  const mail=accountMail(new URL('https://cloud.example.test'),'service_alert',{...alert,locale,state});
  assert(mail.text.includes(locale==='en'?(issue.startsWith('public_')?'Public website':'Staff access'):(issue.startsWith('public_')?'Sitio público':'Acceso del personal')));
  if('checkedAt' in evidence)assert(mail.text.includes(locale==='en'?'Sep 25, 2026, 12:00:00 PM UTC':'25 sept 2026, 12:00:00 UTC'));
  assert(!mail.text.includes('AA:BB'));assert(!mail.text.includes('timeout'));
 }
});
test('remote alert evidence is canonical and matched to its incident kind',()=>{
 const base={...message,issue:'public_route_failed'};
 for(const patch of [{checkedAt:'2026-09-25T12:00:00Z'},{checkedAt,certificateNotAfter},{issue:'public_certificate_expiring',checkedAt},{issue:'public_probe_stale',checkedAt,failure:'timeout'}])assert.equal(validServiceAlert({...base,...patch}),false);
 assert.equal(validServiceAlert({...base,issue:'public_probe_stale'}),true);
});

test('reminder discriminator accepts only an open reminder with canonical evidence',()=>{
 assert.equal(validServiceAlert({...message,notification:'reminder'}),true);
 assert.equal(validServiceAlert({...message,notification:'reminder',issue:'public_route_failed',checkedAt}),true);
 for(const patch of [{notification:null},{notification:['reminder']},{notification:'transition'},{notification:'other'},{notification:'reminder',state:'recovered'},{notification:'reminder',failure:'timeout'},{notification:'reminder',issue:'public_route_failed',checkedAt:'2026-09-25T12:00:00Z'}])assert.equal(validServiceAlert({...message,...patch}),false);
});
for(const locale of ['en','es'] as const)test('reminder renders the agreed '+locale+' copy and bounded evidence',()=>{
 const alert={...message,locale,issue:'public_route_failed' as const,state:'open' as const,notification:'reminder' as const,checkedAt};
 const mail=accountMail(new URL('https://cloud.example.test'),'service_alert',alert);
 assert.equal(mail.subject,locale==='en'?'Waitron Cloud: a venue still needs attention':'Waitron Cloud: un local sigue necesitando atención');
 assert(mail.text.includes(locale==='en'?'This issue is still open. In Cloud, open Venues to check current service status.':'Esta incidencia sigue abierta. En Cloud, abre Locales para consultar el estado actual de los servicios.'));
 assert(mail.text.includes(message.venueId));assert(mail.text.includes('https://cloud.example.test/account'));
 assert(mail.text.includes(locale==='en'?'Public website':'Sitio público'));assert(mail.text.includes(locale==='en'?'Sep 25, 2026, 12:00:00 PM UTC':'25 sept 2026, 12:00:00 UTC'));
 assert(!mail.text.includes(message.incidentId));assert(!mail.text.includes('reminder'));assert(!mail.text.includes('token='));
});

for(const issue of ['public_certificate_expiring','staff_certificate_expiring'])test(issue+' is refused as an owner alert',()=>{
 assert.equal(validServiceAlert({...message,issue,checkedAt,certificateNotAfter}),false);
});

const movedAlert = {
  ...message,
  issue: 'staff_record_moved',
  hostname: 'staff.cafe.example.test',
  target: 'staff-123.cloud.example.test',
};
test('record-moved alerts require two hostnames and refuse probe expiry evidence', () => {
  assert.equal(validServiceAlert(movedAlert), true);
  assert.equal(validServiceAlert({...movedAlert, certificateNotAfter}), false);
  assert.equal(validServiceAlert({...movedAlert, issue: 'public_record_moved'}), true);
  for (const patch of [
    {target: undefined}, {hostname: 'https://staff.cafe.example.test'}, {target: 'a..example.test'},
    {certificateNotAfter: '2026-10-01'}, {checkedAt}, {issue: 'disconnected'},
  ]) assert.equal(validServiceAlert({...movedAlert, ...patch}), false);
});

test('record-moved opening mail gives the owner the DNS target in their language', () => {
  const expected = [
    ['en', 'Your DNS record for staff.cafe.example.test no longer points at Waitron Cloud. Point it back to staff-123.cloud.example.test, or this address stops working when its certificate expires.'],
    ['es', 'Tu registro DNS de staff.cafe.example.test ya no apunta a Waitron Cloud. Vuelve a dirigirlo a staff-123.cloud.example.test; si no, esta dirección dejará de funcionar cuando caduque su certificado.'],
  ] as const;
  for (const [locale, text] of expected) {
    const mail = accountMail(new URL('https://cloud.example.test'), 'service_alert', {
      ...movedAlert, locale,
    });
    assert(mail.text.split('\n').includes(text), mail.text);
  }
});
