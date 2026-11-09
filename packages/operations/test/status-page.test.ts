import assert from 'node:assert/strict';
import {test} from 'node:test';
import {renderStatusPage} from '../src/status-page.ts';

const incident={state:'investigating',service:'remote_access',impact:'some',updatedAt:'2026-11-07T23:45:00Z'};

test('each open incident state produces its fixed bilingual public post and a UTC update thirty minutes later',()=>{
 for(const [state,en,es] of [
  ['investigating','Investigating','Investigando'],
  ['fix_being_applied','Fix being applied','Aplicando una solución'],
  ['monitoring','Monitoring','En observación'],
 ]){
  const pages=renderStatusPage({...incident,state});
  assert.deepEqual(Object.keys(pages).sort(),['es/index.html','index.html']);
  for(const [path,heading,service,impact,update,next] of [
   ['index.html',en,'Remote access','Some venues are affected.','Updated','Next update by'],
   ['es/index.html',es,'Acceso remoto','Algunos locales se ven afectados.','Actualizado','Próxima actualización antes de'],
  ] as const){
   const html=pages[path];
   assert.ok(html.includes(`<h1>${heading}</h1>`),state);
   for(const text of [service,impact,update,next,'2026-11-07 23:45:00 UTC','2026-11-08 00:15:00 UTC'])assert.ok(html.includes(text),text);
   assert.ok(html.includes('datetime="2026-11-08T00:15:00Z"'));
   assert.doesNotMatch(html,/will recover|restored by|se restablecerá a las/i);
  }
 }
});

test('setup leads with unverified health and makes no incident-impact or next-update promise',()=>{
 const pages=renderStatusPage({state:'no_incident',updatedAt:incident.updatedAt});
 for(const [path,heading,absence] of [
  ['index.html','Status updates are being set up. Current service health is unverified.','No incident reported.'],
  ['es/index.html','Las actualizaciones de estado están en preparación. El estado actual del servicio no está verificado.','No hay incidencias notificadas.'],
 ] as const){
  assert.ok(pages[path].includes(`<h1>${heading}</h1>`));assert.ok(pages[path].includes(absence));
  assert.ok(pages[path].includes('2026-11-07 23:45:00 UTC'));
  assert.doesNotMatch(pages[path],/Next update|Próxima actualización|Some venues|Algunos locales|Impact|Impacto|healthy|operativos/i);
 }
});

test('service names and impact sentences are chosen from fixed bilingual vocabulary',()=>{
 for(const [service,en,es] of [
  ['cloud','Waitron Cloud','Waitron Cloud'],['remote_access','Remote access','Acceso remoto'],
  ['backups','Backups','Copias de seguridad'],['email','Email','Correo electrónico'],
  ['hosted_servers','Cloud-hosted venue servers','Servidores de locales alojados en Cloud'],
 ] as const)for(const [impact,enImpact,esImpact] of [
  ['some','Some venues are affected.','Algunos locales se ven afectados.'],
  ['all','All venues are affected.','Todos los locales se ven afectados.'],
  ['unknown','The impact is not yet known.','Aún no se conoce el alcance.'],
 ] as const){
  const pages=renderStatusPage({...incident,service,impact});
  assert.ok(pages['index.html'].includes(en));assert.ok(pages['index.html'].includes(enImpact));
  assert.ok(pages['es/index.html'].includes(es));assert.ok(pages['es/index.html'].includes(esImpact));
 }
});

test('UTC next updates handle leap days and year boundaries',()=>{
 for(const [updatedAt,want] of [
  ['2028-02-28T23:45:00Z','2028-02-29T00:15:00Z'],
  ['2026-12-31T23:45:00Z','2027-01-01T00:15:00Z'],
 ])assert.ok(renderStatusPage({...incident,updatedAt})['index.html'].includes(`datetime="${want}"`));
});

test('malformed timestamps and impossible dates cannot produce a misleading public update',()=>{
 for(const updatedAt of ['2026-02-29T10:00:00Z','2026-04-31T10:00:00Z','2026-11-07T24:00:00Z','2026-11-07','2026-11-07T10:00:00+01:00','2026-11-07T10:00:00.000Z','9999-12-31T23:45:00Z',null,1]){
  assert.throws(()=>renderStatusPage({...incident,updatedAt}),{message:'Invalid public status input'});
 }
});

test('private fields, arbitrary text and incomplete inputs are rejected without echoing them',()=>{
 const privateText='Private venue <script>secret@example.test</script>';
 for(const input of [null,[],{},privateText,{...incident,state:privateText},{...incident,service:privateText},{...incident,impact:privateText},
  ...['venueName','venueId','hostname','details','recoveryTime','ownerText'].map(field=>({...incident,[field]:privateText})),
  {state:'no_incident',updatedAt:incident.updatedAt,service:'cloud',impact:'unknown'},
  {state:'investigating',service:'cloud',updatedAt:incident.updatedAt},
 ])assert.throws(()=>renderStatusPage(input),{message:'Invalid public status input'});
});

test('both static pages use local language links and load without scripts or external assets',()=>{
 const pages=renderStatusPage(incident);
 for(const [path,lang,other,href] of [['index.html','en','es','es/index.html'],['es/index.html','es','en','../index.html']] as const){
  const html=pages[path];assert.ok(html.includes(`<html lang="${lang}">`));
  assert.ok(html.includes(`href="${href}" hreflang="${other}"`));
  assert.match(html,/<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.doesNotMatch(html,/<script|https?:|@import|url\(|<(?:img|iframe|link)\b/i);
 }
});

test('resolved posts report past impact and actual UTC resolution time without a next-update promise',()=>{
 for(const [impact,enImpact,esImpact] of [
  ['some','Some venues were affected.','Algunos locales se vieron afectados.'],
  ['all','All venues were affected.','Todos los locales se vieron afectados.'],
  ['unknown','The impact is not yet known.','Aún no se conoce el alcance.'],
 ] as const){
  const pages=renderStatusPage({...incident,state:'resolved',service:'backups',impact});
  for(const [path,heading,label,service,impactText] of [
   ['index.html','Resolved','Resolved at','Backups',enImpact],
   ['es/index.html','Resuelto','Resuelto el','Copias de seguridad',esImpact],
  ] as const){
   const html=pages[path];assert.ok(html.includes(`<h1>${heading}</h1>`));assert.ok(html.includes(label));assert.ok(html.includes(service));assert.ok(html.includes(impactText));
   assert.ok(html.includes('datetime="2026-11-07T23:45:00Z"'));assert.ok(html.includes('2026-11-07 23:45:00 UTC'));
   assert.doesNotMatch(html,/Next update|Próxima actualización|2026-11-08|are affected|se ven afectados/);
  }
 }
});

const past={service:'hosted_servers',impact:'all',startedAt:'2028-02-28T23:45:00Z',resolvedAt:'2028-02-29T00:15:00Z'};

test('missing or empty incident history preserves the complete current bundle',()=>{
 for(const state of ['no_incident','investigating','fix_being_applied','monitoring','resolved']){
  const input=state==='no_incident'?{state,updatedAt:incident.updatedAt}:{...incident,state};
  assert.deepEqual(renderStatusPage({...input,history:[]}),renderStatusPage(input));
 }
});

test('dated history uses literal bilingual public wording and UTC dates without another update promise',()=>{
 const pages=renderStatusPage({...incident,state:'resolved',history:[past]});
 for(const [path,heading,service,impact,started,resolved] of [
  ['index.html','Past incidents','Cloud-hosted venue servers','All venues were affected.','Started','Resolved at'],
  ['es/index.html','Incidencias anteriores','Servidores de locales alojados en Cloud','Todos los locales se vieron afectados.','Inicio','Resuelto el'],
 ] as const){
  const history=pages[path].slice(pages[path].indexOf('<section'));
  for(const text of [`<h2>${heading}</h2>`,service,impact,started,resolved,
   '<time datetime="2028-02-28T23:45:00Z">2028-02-28 23:45:00 UTC</time>',
   '<time datetime="2028-02-29T00:15:00Z">2028-02-29 00:15:00 UTC</time>'])assert.ok(history.includes(text),text);
  assert.match(history,/<ol>/);assert.match(history,/<li>/);
  assert.doesNotMatch(history,/Next update|Próxima actualización|https?:|<script/);
 }
});

test('history keeps every supplied incident in newest resolution order without changing the current article',()=>{
 const older={...past,service:'backups',resolvedAt:'2028-02-29T00:00:00Z'};
 const newest={...past,service:'email',startedAt:'2028-02-29T00:15:00Z',resolvedAt:'2028-02-29T00:15:00Z'};
 const history=[older,past,newest];
 for(const state of ['no_incident','investigating','fix_being_applied','monitoring','resolved']){
  const input=state==='no_incident'?{state,updatedAt:incident.updatedAt}:{...incident,state};
  const legacy=renderStatusPage(input),pages=renderStatusPage({...input,history});
  for(const path of ['index.html','es/index.html'] as const){
   const withoutHistory=pages[path].replace(/<section class="history">[\s\S]*?<\/section>/,'')
    .replace(/\n?\.history[^{}]*\{[^{}]*\}/g,'');
   assert.equal(withoutHistory,legacy[path]);
   const entries=[...pages[path].matchAll(/<li>[\s\S]*?<\/li>/g)].map(match=>match[0]);
   assert.equal(entries.length,3);
   assert.ok(entries[2]!.includes('datetime="2028-02-29T00:00:00Z"'));
   assert.ok(entries[0]!.includes('datetime="2028-02-29T00:15:00Z"'));
   assert.ok(entries[1]!.includes('datetime="2028-02-29T00:15:00Z"'));
  }
 }
 assert.deepEqual(history,[older,past,newest]);
});

test('history retains unknown impact and valid equal, midnight, leap and year-boundary dates',()=>{
 for(const [startedAt,resolvedAt] of [
  ['2028-02-29T00:00:00Z','2028-02-29T00:00:00Z'],
  ['2026-12-31T23:59:59Z','2027-01-01T00:00:00Z'],
 ]){
  const pages=renderStatusPage({...incident,history:[{...past,impact:'unknown',startedAt,resolvedAt}]});
  assert.ok(pages['index.html'].includes('The impact is not yet known.'));
  assert.ok(pages['es/index.html'].includes('Aún no se conoce el alcance.'));
  for(const html of Object.values(pages))assert.ok(html.includes(`datetime="${resolvedAt}"`));
 }
});

test('history rejects private text, unknown fields and malformed dates with the existing redacted error',()=>{
 const privateText='Private venue <script>secret@example.test</script>';
 const entries=[null,[],{},privateText,{...past,service:privateText},{...past,impact:privateText},
  ...['service','impact','startedAt','resolvedAt'].map(field=>Object.fromEntries(Object.entries(past).filter(([key])=>key!==field))),
  ...['venueId','hostname','details','state','updatedAt'].map(field=>({...past,[field]:privateText})),
  ...['2026-02-29T00:00:00Z','2028-02-30T00:00:00Z','2028-02-29T24:00:00Z','2028-02-29','2028-02-29T00:00:00+01:00',null,42].flatMap(value=>[
   {...past,startedAt:value},{...past,resolvedAt:value}]),
  {...past,startedAt:'2028-02-29T00:16:00Z'},
 ];
 for(const history of [null,{},privateText,42,...entries.map(entry=>[entry])]){
  assert.throws(()=>renderStatusPage({...incident,history}),{message:'Invalid public status input'});
 }
});
