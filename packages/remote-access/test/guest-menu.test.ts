import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import {BillingStore,createLeaseIssuer,transaction} from '@waitron-cloud/registration';
import {connectedVenue,database} from '../../translation/test/fixtures.ts';
import {waitLock} from '../../registration/test/fixtures/relay-stop-barrier.ts';
import {setTimeout as delay} from 'node:timers/promises';
import * as guest from '../src/guest-menu.ts';
import {guestMenuFixture,startGuestMenuTrial} from './fixtures/guest-menu.ts';
import {guestMenuStatus,setGuestMenuBlocked,readGuestMenu} from '../src/guest-menu.ts';

const origin='https://menus.example.test';
let f:Awaited<ReturnType<typeof guestMenuFixture>>,db:Awaited<ReturnType<typeof guestMenuFixture>>['db'],venueId:string;
before(async()=>{
 f=await guestMenuFixture();({db,venueId}=f);
});
after(async()=>db?.close());

test('a stored public copy has one permanent link; takedown removes bytes and Enable leaves it off',async()=>{
 const status=()=>transaction(db.pool,c=>guestMenuStatus(c,venueId,origin));
 assert.deepEqual(await status(),{version:1,url:`${origin}/m/${venueId}`,revision:0,state:'off',publication:null});
 await f.seed();
 await assert.rejects(db.pool.query("UPDATE guest_menus SET default_language='bad_tag',pages=pages || '{\"bad_tag\":\"menu\"}'::jsonb WHERE venue_id=$1",[venueId]),(error:unknown)=>(error as {constraint?:string}).constraint==='guest_menus_default_language_check');
 assert.equal((await status()).state,'current');
 assert.equal((await readGuestMenu(db.pool,venueId,'es'))?.html,'<h1>Menú</h1>');
 assert.equal((await readGuestMenu(db.pool,venueId,'ca'))?.html,'<h1>Menu</h1>');
 assert.equal(await readGuestMenu(db.pool,randomUUID()),null);
 const blocked=await transaction(db.pool,c=>setGuestMenuBlocked(c,venueId,true,origin));
 assert.equal(blocked.state,'blocked');assert.equal(blocked.revision,2);assert.equal(blocked.publication,null);
 assert.deepEqual(await transaction(db.pool,c=>setGuestMenuBlocked(c,venueId,true,origin)),blocked);
 assert.equal(await readGuestMenu(db.pool,venueId),null);
 assert.equal((await db.pool.query('SELECT pages FROM guest_menus WHERE venue_id=$1',[venueId])).rows[0].pages,null);
 const enabled=await transaction(db.pool,c=>setGuestMenuBlocked(c,venueId,false,origin));
 assert.equal(enabled.state,'off');assert.equal(enabled.revision,3);
 assert.deepEqual(await transaction(db.pool,c=>setGuestMenuBlocked(c,venueId,false,origin)),enabled);
 assert.equal(await readGuestMenu(db.pool,venueId),null);
});

test('stored pages match regional strings and ordered phone preferences with the main page first on ties',async()=>{
 const f=await guestMenuFixture();try{
  await f.seed({en:'<h1>Menu</h1>',es:'<h1>Menú</h1>','ca-ES-valencia':'<h1>Carta</h1>',fr:'<h1>Carte</h1>'});
  await f.db.pool.query('UPDATE guest_menus SET default_language=$1 WHERE venue_id=$2',['fr',f.venueId]);
  assert.equal((await readGuestMenu(f.db.pool,f.venueId,'es-MX'))?.language,'es');
  assert.equal((await readGuestMenu(f.db.pool,f.venueId,['ca','es']))?.language,'ca-ES-valencia');
  assert.equal((await readGuestMenu(f.db.pool,f.venueId,['de','ES-mx']))?.html,'<h1>Menú</h1>');
  assert.equal((await readGuestMenu(f.db.pool,f.venueId,['bad_tag','de']))?.language,'fr');
  assert.equal((await readGuestMenu(f.db.pool,f.venueId,[]))?.language,'fr');
  await f.db.pool.query("UPDATE guest_menus SET pages=pages || $1::jsonb,default_language='ca-ES-valencia' WHERE venue_id=$2",[{'ca-AD':'<h1>Other page</h1>','ca-FR':'<h1>Other Catalan</h1>'},f.venueId]);
  assert.equal((await readGuestMenu(f.db.pool,f.venueId,'ca-BE'))?.language,'ca-ES-valencia');
  await f.db.pool.query("UPDATE guest_menus SET default_language='fr',pages=pages-'ca-AD' WHERE venue_id=$1",[f.venueId]);
  assert.equal((await readGuestMenu(f.db.pool,f.venueId,'ca-BE'))?.language,'ca-ES-valencia');
 }finally{await f.db.close();}
});

test('the private menu read admits a connected trial without a hosted copy until blocked',async()=>{
 const f=await guestMenuFixture();
 try{
  assert.equal(typeof guest.startGuestMenuAuthority,'function','private menu listener is missing');
  const authority=await guest.startGuestMenuAuthority(f.db.pool.options,'127.0.0.1',0);
  try{
   const check=(id:string)=>fetch('http://127.0.0.1:'+authority.port+'/guest-menu/'+id);
   assert.equal((await check(randomUUID())).status,404);
   assert.equal((await check(f.venueId)).status,404);
   await startGuestMenuTrial(f.db.pool,{...f.owner,venueId:f.venueId});
   assert.equal((await check(f.venueId)).status,204);
   await transaction(f.db.pool,c=>setGuestMenuBlocked(c,f.venueId,true,origin));
   assert.equal((await check(f.venueId)).status,404);
   await transaction(f.db.pool,c=>setGuestMenuBlocked(c,f.venueId,false,origin));
   assert.equal((await check(f.venueId)).status,204);
  }finally{await authority.close();}
 }finally{await f.db.close();}
});

test('the private menu read returns unavailable while a database lock stalls eligibility',async()=>{
 const f=await guestMenuFixture();
 const authority=await guest.startGuestMenuAuthority(f.db.pool.options,'127.0.0.1',0);
 try{
  await transaction(f.db.pool,async client=>{
   await client.query('LOCK TABLE guest_menus IN ACCESS EXCLUSIVE MODE');
   const response=await fetch('http://127.0.0.1:'+authority.port+'/guest-menu/'+f.venueId,{signal:AbortSignal.timeout(1100)});
   assert.equal(response.status,503);
  });
 }finally{await authority.close();await f.db.close();}
});

const cloud='https://cloud.example.test';
async function delivery(mode?:'test-venue-levels'){
 const db=await database(),issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
 try{
 const box=await connectedVenue(db,issuer,cloud),machine=new guest.GuestMenuMachine(db.pool,issuer,cloud,origin,undefined,mode);
 const proof=(action:guest.GuestMenuAction,body:unknown={version:1},who=box,lease=who.lease)=>who.proof(action,body,randomUUID(),lease);
 const text=(html='<h1>Menú</h1>')=>JSON.stringify({defaultLanguage:'es',pages:{es:html}});
 const publish=(body=text(),revision=0,who=box)=>machine.execute('guest-menu-publish',proof('guest-menu-publish',{version:1,expectedRevision:revision,bodySha256:createHash('sha256').update(body).digest('hex'),bodyBytes:Buffer.byteLength(body)},who),body);
 const status=(who=box)=>machine.execute('guest-menu-status',proof('guest-menu-status',undefined,who));
 return {db,issuer,box,machine,proof,text,publish,status};
 }catch(error){await db.close();throw error;}
}

for(const language of ['ca-ES-valencia','fr'])test('signed delivery preserves a '+language+' default and exact translated choice',async()=>{
 const f=await delivery();try{
  const body=JSON.stringify({defaultLanguage:language,pages:{[language]:'<h1>Carte</h1>',es:'<h1>Menú</h1>'}});
  assert.equal((await f.publish(body)).publication?.defaultLanguage,language);
  assert.deepEqual(await readGuestMenu(f.db.pool,f.box.venueId),{html:'<h1>Carte</h1>',revision:1,language});
  assert.equal((await readGuestMenu(f.db.pool,f.box.venueId,'es'))?.html,'<h1>Menú</h1>');
 }finally{await f.db.close();}
});

test('signed delivery serialises retries, revision conflicts, withdrawal and owner block',async()=>{
 const f=await delivery();try{
  assert.equal((await f.status()).revision,0);
  const first=await f.publish();assert.equal(first.revision,1);assert.equal(first.state,'current');assert.equal(first.publication?.defaultLanguage,'es');
  assert.deepEqual(await Promise.all([f.publish(),f.publish()]),[first,first]);
  await assert.rejects(f.publish(f.text('<h1>New menu</h1>')),/conflict/);
  const second=await f.publish(f.text('<h1>New menu</h1>'),1);assert.equal(second.revision,2);
  const withdrawn=await f.machine.execute('guest-menu-withdraw',f.proof('guest-menu-withdraw'));assert.equal(withdrawn.revision,3);assert.equal(withdrawn.state,'off');
  assert.deepEqual(await f.machine.execute('guest-menu-withdraw',f.proof('guest-menu-withdraw')),withdrawn);
  assert.equal(await readGuestMenu(f.db.pool,f.box.venueId),null);
  const blocked=await transaction(f.db.pool,c=>setGuestMenuBlocked(c,f.box.venueId,true,origin));assert.equal(blocked.revision,4);
  await assert.rejects(f.publish(f.text(),4),/blocked/);
  assert.deepEqual(await f.status(),blocked);
  assert.deepEqual(await f.machine.execute('guest-menu-withdraw',f.proof('guest-menu-withdraw')),blocked);
  const enabled=await transaction(f.db.pool,c=>setGuestMenuBlocked(c,f.box.venueId,false,origin));assert.equal(enabled.revision,5);
  assert.equal((await f.publish(f.text(),5)).revision,6);
  const other=await connectedVenue(f.db,f.issuer,cloud);assert.equal((await f.status(other)).state,'off');
  await f.publish(f.text('<h1>Other venue</h1>'),0,other);
  assert.equal((await readGuestMenu(f.db.pool,f.box.venueId))?.html,'<h1>Menú</h1>');
  assert.equal((await readGuestMenu(f.db.pool,other.venueId))?.html,'<h1>Other venue</h1>');
 }finally{await f.db.close();}
});

test('the exact bounded UTF-8 publication body must match its signed fingerprint and language shape',async()=>{
 const f=await delivery();try{
  const body=f.text(),fingerprint={version:1,expectedRevision:0,bodySha256:createHash('sha256').update(body).digest('hex'),bodyBytes:Buffer.byteLength(body)};
  for(const [signed,raw,want] of [
   [fingerprint,body+' ',/forbidden/],
   [fingerprint,body.replace('Menú','Café'),/forbidden/],
   [{...fingerprint,bodyBytes:fingerprint.bodyBytes+1},body,/forbidden/],
   [{...fingerprint,expectedRevision:-1},body,/invalid_input/],
   [fingerprint,'\ud800',/forbidden/],
  ] as const)await assert.rejects(f.machine.execute('guest-menu-publish',f.proof('guest-menu-publish',signed),raw),want);
  for(const value of [{defaultLanguage:'xx',pages:{xx:'menu'}},{defaultLanguage:'bad_tag',pages:{bad_tag:'menu'}},{defaultLanguage:'es',pages:{en:'menu'}},{defaultLanguage:'en',pages:{en:5}},{defaultLanguage:'en',pages:{en:'menu\u0000text'}},{defaultLanguage:'en',pages:{en:'\ud800'}},
   {defaultLanguage:'en',pages:{en:'menu',bad_tag:'menu'}},{defaultLanguage:'en',pages:{en:'menu'},venueId:f.box.venueId}])await assert.rejects(f.publish(JSON.stringify(value)),/invalid_input/);
  const overhead=Buffer.byteLength(f.text('')),exact=f.text('x'.repeat(2097152-overhead));assert.equal(Buffer.byteLength(exact),2097152);
  assert.equal((await f.publish(exact)).state,'current');
  await assert.rejects(f.publish(exact+' ',1),/too_large/);
  await assert.rejects(f.machine.execute('guest-menu-status',f.proof('guest-menu-status',{})),/invalid_input/);
 }finally{await f.db.close();}
});

test('a foreign lease, wrong action, expired lease and retired installation never acquire publication authority',async()=>{
 const f=await delivery();try{
  const other=await connectedVenue(f.db,f.issuer,cloud),now=Date.now();
  await assert.rejects(f.machine.execute('guest-menu-status',f.proof('guest-menu-status',{version:1},f.box,other.lease)),/invalid_proof/);
  await assert.rejects(f.machine.execute('guest-menu-withdraw',f.proof('guest-menu-status')),/invalid_proof/);
  const expired=f.issuer.issue({origin:cloud,installationId:f.box.installationId,venueId:f.box.venueId,publicKey:f.box.installationKey,environment:'test',leaseId:randomUUID(),issuedAt:now-3600000,expiresAt:now-1});
  await assert.rejects(f.machine.execute('guest-menu-status',f.proof('guest-menu-status',{version:1},f.box,expired)),/invalid_proof/);
  await f.db.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[f.box.installationId]);
  await assert.rejects(f.publish(),/revoked/);
  assert.equal((await f.db.pool.query('SELECT count(*) FROM guest_menus')).rows[0].count,'0');
 }finally{await f.db.close();}
});

for(const mode of ['takedown','revocation','expiry after insert wait'] as const)test('publication rechecks '+mode+' after database contention',async()=>{
 const f=await delivery(),lock=await f.db.secondPool.connect();let pending:Promise<guest.GuestMenuView>|undefined;
 try{
  const blocker=Number((await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
  await lock.query('BEGIN');
  if(mode==='takedown')await setGuestMenuBlocked(lock,f.box.venueId,true,origin);
  else if(mode==='revocation')await lock.query('SELECT id FROM installations WHERE id=$1 FOR UPDATE',[f.box.installationId]);
  else await lock.query('LOCK TABLE guest_menus IN SHARE MODE');
  const body=f.text(),issuedAt=mode.startsWith('expiry')?Date.now()-58000:Date.now();
  const proof=f.box.proof('guest-menu-publish',{version:1,expectedRevision:0,bodySha256:createHash('sha256').update(body).digest('hex'),bodyBytes:Buffer.byteLength(body)},randomUUID(),f.box.lease,undefined,issuedAt);
  pending=f.machine.execute('guest-menu-publish',proof,body);void pending.catch(()=>{});
  await waitLock(f.db.pool,f.db.schema,mode==='takedown'?'SELECT environment':mode==='revocation'?'SELECT * FROM installations':'INSERT INTO guest_menus',blocker);
  if(mode==='revocation')await lock.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[f.box.installationId]);
  if(mode.startsWith('expiry'))await delay(Math.max(0,issuedAt+60010-Date.now()));
  await lock.query('COMMIT');await assert.rejects(pending,mode==='takedown'?/blocked/:mode==='revocation'?/revoked/:/invalid_proof/);
  assert.equal(await readGuestMenu(f.db.pool,f.box.venueId),null);
 }finally{await lock.query('ROLLBACK');lock.release();await pending?.catch(()=>{});await f.db.close();}
});

test('a never-trialled test venue with no billing row cannot publish',async()=>{
 const f=await delivery('test-venue-levels');try{
  await assert.rejects(f.publish(),{message:'guest_menu_plan_required'});
  assert.equal(await readGuestMenu(f.db.pool,f.box.venueId),null);
 }finally{await f.db.close();}
});

test('an enrolled paid test venue can publish without a trial, including after legacy billing',async()=>{
 const f=await delivery('test-venue-levels');try{
  const billing=new BillingStore(f.db.pool),event=()=>({key:randomUUID(),occurredAt:new Date().toISOString(),source:{kind:'internal' as const}});
  const {organisationId,legalBusinessId,venueId}=f.box,scope={organisationId,legalBusinessId};
  await billing.execute(scope,event(),{type:'ensure_business'});
  const connected={type:'set_venue',venueId,expectedRevision:0,
   value:{level:'connected',connectedFrom:null,lapsedOn:null,scheduledLevel:null,scheduledOn:null}} as const;
  await billing.execute(scope,event(),connected);
  await assert.rejects(f.publish(),{message:'guest_menu_plan_required'});
  await billing.transition(scope,event(),{...connected,expectedRevision:1});
  assert.equal((await f.publish()).state,'current');
 }finally{await f.db.close();}
});

test('a lapse committed during the venue lock wait prevents republishing but allows withdrawal',async()=>{
 const f=await delivery('test-venue-levels'),lock=await f.db.secondPool.connect();let pending:Promise<guest.GuestMenuView>|undefined;
 try{
  await startGuestMenuTrial(f.db.pool,f.box);
  assert.equal((await f.publish()).state,'current');
  const siblingVenueId=randomUUID(),{organisationId,legalBusinessId}=f.box;
  await f.db.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,environment) VALUES($1,$2,$3,'test')",
   [siblingVenueId,organisationId,legalBusinessId]);
  await startGuestMenuTrial(f.db.pool,{organisationId,legalBusinessId,venueId:siblingVenueId});
  const blocker=Number((await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
  await lock.query('BEGIN');
  await lock.query('SELECT id FROM venues WHERE id=$1 FOR NO KEY UPDATE',[f.box.venueId]);
  await lock.query("UPDATE billing_trials SET state='lapsed' WHERE venue_id=$1",[f.box.venueId]);
  pending=f.publish(f.text('<h1>Updated menu</h1>'),1);void pending.catch(()=>{});
  await waitLock(f.db.pool,f.db.schema,'SELECT environment',blocker);
  await lock.query('COMMIT');
  await assert.rejects(pending,{message:'guest_menu_plan_required'});
  assert.equal((await readGuestMenu(f.db.pool,f.box.venueId))?.html,'<h1>Menú</h1>');
  assert.equal((await f.machine.execute('guest-menu-withdraw',f.proof('guest-menu-withdraw'))).state,'off');
  assert.equal(await readGuestMenu(f.db.pool,f.box.venueId),null);
 }finally{await lock.query('ROLLBACK');lock.release();await pending?.catch(()=>{});await f.db.close();}
});
